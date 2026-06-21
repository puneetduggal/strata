import { expect, test, vi, beforeEach } from "vitest";
// Mock the linker's LLM call. extractStructured is what linkEntity uses to propose typed-edge
// candidates from a doc's text; we make it deterministic so this test has no live dependency.
vi.mock("@/lib/llm/claude", () => ({ extractStructured: vi.fn(), MODEL: "claude-opus-4-8" }));
import { extractStructured } from "@/lib/llm/claude";
import { db } from "@/lib/db/client";
import {
  documents,
  chunks,
  services,
  requirements,
  decisions,
  edges,
  entityIndex,
} from "@/lib/db/schema";
import { relinkAll } from "@/lib/pipeline/run";
import { and, eq } from "drizzle-orm";

// Reproduces the order-dependence bug and proves the relinkAll() fix.
//
// The bug: linkEntity grounds candidate edges ONLY in the current doc's text and links only entities
// that exist when that doc is processed. So a relation grounded in an EARLY doc, between an entity
// born early (the source) and one born LATER (the partner), never forms in-pass — when the early doc
// is linked the partner does not yet exist, and the early doc is never revisited. AFFECTS is the
// canonical victim (grounded in ADR-001, but auth-service is born in HLD).
//
// The fix: relinkAll() re-runs linking for every entity MENTIONED in every doc AFTER all docs are
// ingested, so the partner now exists and the edge forms — idempotently.
//
// Shared-DB safe: unique per-run labels, all assertions scoped to the ids we create, relinkAll is
// scoped to our doc ids, and we never use global counts or truncate.

type Candidate = {
  relationType: string;
  kind?: string;
  otherEntityLabel: string;
  direction: "out" | "in";
  confidence: number;
  snippet: string;
};

// Build a doc + a single full-coverage chunk (charStart 0 ⇒ raw_text offsets), plus a deterministic
// chunk —MENTIONS→ entity edge for `mentions` (the entities this doc's chunk references). This is
// what relinkAll/linkStage iterates to decide which entities to (re-)link against this doc.
async function makeDoc(
  filename: string,
  rawText: string,
  mentions: Array<{ type: string; id: number }>,
): Promise<number> {
  const [doc] = await db
    .insert(documents)
    .values({ filename, mimeType: "text/plain", rawText, docType: "ADR", domain: "software_dev", status: "ready" })
    .returning();
  const [chunk] = await db
    .insert(chunks)
    .values({ documentId: doc.id, page: 1, charStart: 0, charEnd: rawText.length, text: rawText })
    .returning();
  for (const m of mentions) {
    await db.insert(edges).values({
      relationType: "MENTIONS",
      sourceType: "chunk",
      sourceId: chunk.id,
      targetType: m.type,
      targetId: m.id,
      confidence: 1,
      active: true,
      evidenceDocumentId: doc.id,
      chunkId: chunk.id,
      charStart: 0,
      charEnd: 0,
      snippet: "",
    });
  }
  return doc.id;
}

async function indexEntity(type: string, id: number, label: string): Promise<void> {
  await db.insert(entityIndex).values({ entityType: type, entityId: id, label, aliases: [], searchText: label });
}

// Route extractStructured by the THIS-entity line in the link prompt: the linker proposes candidates
// for one entity at a time, so we return the right candidate only when that entity is being linked.
function routeLinker(handlers: Array<{ match: string; candidates: Candidate[] }>): void {
  vi.mocked(extractStructured).mockImplementation(async (args: { user: string }) => {
    for (const h of handlers) {
      if (args.user.includes(h.match)) return { candidates: h.candidates } as never;
    }
    return { candidates: [] } as never;
  });
}

async function findEdge(relationType: string, sourceType: string, sourceId: number, targetType: string, targetId: number) {
  return db
    .select()
    .from(edges)
    .where(
      and(
        eq(edges.relationType, relationType),
        eq(edges.sourceType, sourceType),
        eq(edges.sourceId, sourceId),
        eq(edges.targetType, targetType),
        eq(edges.targetId, targetId),
      ),
    );
}

beforeEach(() => {
  vi.mocked(extractStructured).mockReset();
});

test("AFFECTS (Decision→Service) grounded in an EARLY doc forms only after relinkAll once the later-born Service exists", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const adrLabel = `ADR-${suffix}`;
  const svcLabel = `auth-service-${suffix}`;
  const affectsSnippet = `This decision affects the ${svcLabel}.`;

  // Doc A (early, ADR-like): the Decision is born here and the AFFECTS grounding lives here.
  const rawA = `Decision record ${adrLabel}.\n\n${affectsSnippet}\n\nNo other service is impacted.`;
  expect(rawA.indexOf(affectsSnippet)).toBeGreaterThan(0);

  // The Decision exists at doc-A time; the Service does NOT yet.
  const [decision] = await db.insert(decisions).values({ label: adrLabel, status: "Accepted" }).returning();
  await indexEntity("Decision", decision.id, adrLabel);
  const docA = await makeDoc(`adr-${suffix}.txt`, rawA, [{ type: "Decision", id: decision.id }]);

  // Linker proposes AFFECTS when (and only when) it is linking THIS Decision.
  routeLinker([
    {
      match: `label="${adrLabel}"`,
      candidates: [{ relationType: "AFFECTS", otherEntityLabel: svcLabel, direction: "out", confidence: 0.9, snippet: affectsSnippet }],
    },
  ]);

  // Linking at doc-A time: the Service does not exist yet ⇒ NO AFFECTS edge (reproduces the bug —
  // even a re-sweep can't form it while the partner is missing).
  await relinkAll([docA]);
  expect(await findEdge("AFFECTS", "Decision", decision.id, "Service", 0)).toHaveLength(0);
  let any = await db
    .select()
    .from(edges)
    .where(and(eq(edges.relationType, "AFFECTS"), eq(edges.sourceType, "Decision"), eq(edges.sourceId, decision.id)));
  expect(any).toHaveLength(0);

  // Doc B (later): the Service is born now. Its label is also present in doc A's text, but the bug is
  // that doc A was already linked — only an order-independent re-sweep can revisit it.
  const [service] = await db.insert(services).values({ label: svcLabel, language: "Go" }).returning();
  await indexEntity("Service", service.id, svcLabel);
  await makeDoc(`hld-${suffix}.txt`, `${svcLabel} handles sign-in.`, [{ type: "Service", id: service.id }]);

  // The fix: relink the full (scoped) graph. Doc A is revisited with the Service now present.
  await relinkAll([docA]);

  const affects = await findEdge("AFFECTS", "Decision", decision.id, "Service", service.id);
  expect(affects).toHaveLength(1);
  expect(affects[0].active).toBe(true);
  expect(affects[0].confidence).toBeCloseTo(0.9, 5);
  expect(affects[0].evidenceDocumentId).toBe(docA);
  // Grounded in doc A's text.
  expect(rawA.slice(affects[0].charStart!, affects[0].charEnd!)).toBe(affectsSnippet);

  // Idempotency: a second sweep updates the same row, never duplicates.
  const firstId = affects[0].id;
  await relinkAll([docA]);
  const again = await findEdge("AFFECTS", "Decision", decision.id, "Service", service.id);
  expect(again).toHaveLength(1);
  expect(again[0].id).toBe(firstId);
});

test("IMPLEMENTS (Service→Requirement) also forms via relinkAll regardless of which endpoint arrived first", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const svcLabel = `auth-service-${suffix}`;
  const reqLabel = `REQ-${suffix}`;
  const implSnippet = `${svcLabel} implements ${reqLabel}.`;

  // Impl-plan-like doc: the Service is born here and the IMPLEMENTS grounding lives here. The
  // Requirement is born LATER, so in-pass linking at this doc's time would skip the edge.
  const rawC = `Service-to-requirement mapping.\n\n${implSnippet}\n\nSequencing follows.`;
  expect(rawC.indexOf(implSnippet)).toBeGreaterThan(0);

  const [service] = await db.insert(services).values({ label: svcLabel, language: "Go" }).returning();
  await indexEntity("Service", service.id, svcLabel);
  const docC = await makeDoc(`impl-${suffix}.txt`, rawC, [{ type: "Service", id: service.id }]);

  routeLinker([
    {
      match: `label="${svcLabel}"`,
      candidates: [{ relationType: "IMPLEMENTS", otherEntityLabel: reqLabel, direction: "out", confidence: 0.95, snippet: implSnippet }],
    },
  ]);

  // Requirement absent ⇒ no edge yet.
  await relinkAll([docC]);
  let any = await db
    .select()
    .from(edges)
    .where(and(eq(edges.relationType, "IMPLEMENTS"), eq(edges.sourceType, "Service"), eq(edges.sourceId, service.id)));
  expect(any).toHaveLength(0);

  // Requirement arrives later.
  const [req] = await db.insert(requirements).values({ label: reqLabel, text: "authenticate" }).returning();
  await indexEntity("Requirement", req.id, reqLabel);

  await relinkAll([docC]);

  const impl = await findEdge("IMPLEMENTS", "Service", service.id, "Requirement", req.id);
  expect(impl).toHaveLength(1);
  expect(impl[0].active).toBe(true);
  expect(impl[0].evidenceDocumentId).toBe(docC);
});
