import { beforeAll, expect, test, vi } from "vitest";
vi.mock("@/lib/embed/voyage", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => Array(1024).fill(0.02))) }));
import { embed } from "@/lib/embed/voyage";
import { db } from "@/lib/db/client";
import { documents, chunks, services, attributeProvenance, edges, entityIndex } from "@/lib/db/schema";
import { resolveDoc } from "@/lib/pipeline/resolve";
import { and, eq, inArray } from "drizzle-orm";

// The suite shares a Postgres DB with no per-test truncation. Resolution matches a fresh entity
// against ALL existing Service rows in entity_index via trigram similarity, so Service entity_index
// rows left by earlier runs of this test would act as merge magnets and steal our entities.
// resolveDoc is the only writer of entity_index and this is its only caller, so clearing the
// Service-typed entity_index here is safe from concurrent test files. (We additionally use a
// unique per-run label below, so concurrent plain "auth-service" rows can't affect our counts.)
beforeAll(async () => {
  await db.delete(entityIndex).where(eq(entityIndex.entityType, "Service"));
});

test("resolveDoc merges same-label entities across docs and writes deterministic MENTIONS edges", async () => {
  vi.mocked(embed).mockClear();
  // Unique label per run so assertions are isolated from accumulated DB state in the shared
  // test database (the suite has no truncation between tests). It still contains "auth-service".
  const label = `auth-service-${Date.now()}`;

  // Two documents, each whose rawText contains the label at a known raw_text offset.
  const rawA = `System overview.\n\nThe ${label} handles login. It is written in Go.`;
  const rawB = `Design doc.\n\nWe call into ${label} for tokens.`;
  expect(rawA.indexOf(label)).toBeGreaterThan(0);
  expect(rawB.indexOf(label)).toBeGreaterThan(0);

  const [docA] = await db
    .insert(documents)
    .values({ filename: "a.txt", mimeType: "text/plain", rawText: rawA, docType: "HLD", domain: "software_dev", status: "extracted" })
    .returning();
  const [docB] = await db
    .insert(documents)
    .values({ filename: "b.txt", mimeType: "text/plain", rawText: rawB, docType: "LLD", domain: "software_dev", status: "extracted" })
    .returning();

  // One chunk per doc covering the whole rawText (charStart=0 → real raw_text offsets).
  await db
    .insert(chunks)
    .values({ documentId: docA.id, page: 1, charStart: 0, charEnd: rawA.length, text: rawA, embedding: Array(1024).fill(0.02) });
  await db
    .insert(chunks)
    .values({ documentId: docB.id, page: 1, charStart: 0, charEnd: rawB.length, text: rawB, embedding: Array(1024).fill(0.02) });

  // A services entity per doc, each tied to its doc via attribute_provenance.
  const [svcA] = await db.insert(services).values({ label, description: "written in Go" }).returning();
  const [svcB] = await db.insert(services).values({ label, description: "token issuer" }).returning();
  await db.insert(attributeProvenance).values({
    entityType: "Service", entityId: svcA.id, field: "description", value: "written in Go",
    documentId: docA.id, charStart: rawA.indexOf("written in Go"), charEnd: rawA.indexOf("written in Go") + "written in Go".length, snippet: "written in Go",
  });
  await db.insert(attributeProvenance).values({
    entityType: "Service", entityId: svcB.id, field: "description", value: "token issuer",
    documentId: docB.id, charStart: rawB.indexOf("tokens"), charEnd: rawB.indexOf("tokens") + "tokens".length, snippet: "tokens",
  });

  // Resolve doc A first (svcA becomes canonical), then doc B (svcB should merge into svcA).
  await resolveDoc(docA.id);
  await resolveDoc(docB.id);

  // Exactly ONE services row with this (unique) label survives.
  const survivors = await db.select().from(services).where(eq(services.label, label));
  expect(survivors).toHaveLength(1);
  const canonical = survivors[0];
  // It is one of the two we created (svcA, by resolve order).
  expect([svcA.id, svcB.id]).toContain(canonical.id);

  // MENTIONS edges target the surviving entity, ≥2 of them.
  const mentions = await db
    .select()
    .from(edges)
    .where(and(eq(edges.relationType, "MENTIONS"), eq(edges.targetType, "Service"), eq(edges.targetId, canonical.id)));
  expect(mentions.length).toBeGreaterThanOrEqual(2);

  const rawByDoc: Record<number, string> = { [docA.id]: rawA, [docB.id]: rawB };
  for (const m of mentions) {
    expect(m.active).toBe(true);
    expect(m.confidence).toBe(1);
    expect(m.evidenceDocumentId).not.toBeNull();
    // evidence_document_id equals the chunk's document_id
    const [c] = await db.select().from(chunks).where(eq(chunks.id, m.chunkId!));
    expect(m.evidenceDocumentId).toBe(c.documentId);
    // span round-trips against the evidence doc's raw_text
    const raw = rawByDoc[m.evidenceDocumentId!];
    expect(raw.slice(m.charStart!, m.charEnd!)).toBe(label);
  }

  // Surviving entity has an entity_index row with a non-null 1024-dim embedding.
  const [idx] = await db
    .select()
    .from(entityIndex)
    .where(and(eq(entityIndex.entityType, "Service"), eq(entityIndex.entityId, canonical.id)));
  expect(idx).toBeTruthy();
  expect(idx.embedding).not.toBeNull();
  expect(idx.embedding!.length).toBe(1024);

  // The merged entity's typed-table row was deleted; only the canonical remains among the pair.
  const remaining = await db.select().from(services).where(inArray(services.id, [svcA.id, svcB.id]));
  expect(remaining).toHaveLength(1);

  // The merged entity's provenance was repointed onto the canonical (both docs' rows present).
  const prov = await db
    .select()
    .from(attributeProvenance)
    .where(and(eq(attributeProvenance.entityType, "Service"), eq(attributeProvenance.entityId, canonical.id)));
  const docIds = new Set(prov.map((p) => p.documentId));
  expect(docIds.has(docA.id)).toBe(true);
  expect(docIds.has(docB.id)).toBe(true);

  // embed was called (search_text embedded for the canonical).
  expect(vi.mocked(embed)).toHaveBeenCalled();
});
