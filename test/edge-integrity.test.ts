import { expect, test } from "vitest";
import { db } from "@/lib/db/client";
import {
  documents,
  chunks,
  services,
  requirements,
  edges,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { checkEdgeIntegrity, type EdgeEndpoints } from "@/lib/graph/integrity";

// Design spec §5c.4 — Polymorphic edge integrity: every `active` edge's
// (sourceType, sourceId) and (targetType, targetId) resolve to a live row in the
// table named by the *_type (entity types via SOFTWARE_PACKAGE.entityTypes, plus the
// special source type "chunk" → chunks). The check below is exercised both ways:
// it must PASS on a valid graph and FLAG a dangling endpoint.
//
// Shared-DB safe: a unique per-run suffix scopes every row we create; we only ever pass
// the edges we created into the check, and never count or truncate shared tables.

test("integrity check passes on a valid graph and flags a dangling endpoint", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const svcLabel = `svc-int-${suffix}`;
  const reqLabel = `req-int-${suffix}`;
  const rawText = `Service ${svcLabel} implements requirement ${reqLabel}.`;

  // Real rows for both endpoints of a semantic edge, plus a doc+chunk for a MENTIONS edge.
  const [doc] = await db
    .insert(documents)
    .values({ filename: `int-${suffix}.txt`, mimeType: "text/plain", rawText, docType: "LLD", domain: "software_dev", status: "ready" })
    .returning();
  const [chunk] = await db
    .insert(chunks)
    .values({ documentId: doc.id, page: 1, charStart: 0, charEnd: rawText.length, text: rawText })
    .returning();
  const [svc] = await db.insert(services).values({ label: svcLabel, description: "x" }).returning();
  const [req] = await db.insert(requirements).values({ label: reqLabel, text: "y" }).returning();

  // ≥1 semantic active edge (Service --IMPLEMENTS--> Requirement) between two typed entities.
  const [semanticEdge] = await db
    .insert(edges)
    .values({
      relationType: "IMPLEMENTS",
      sourceType: "Service", sourceId: svc.id,
      targetType: "Requirement", targetId: req.id,
      confidence: 0.9, active: true,
      evidenceDocumentId: doc.id, charStart: 0, charEnd: rawText.length, snippet: rawText,
    })
    .returning();

  // ≥1 MENTIONS active edge (chunk --MENTIONS--> entity), source type "chunk" → chunks table.
  const [mentionsEdge] = await db
    .insert(edges)
    .values({
      relationType: "MENTIONS",
      sourceType: "chunk", sourceId: chunk.id,
      targetType: "Service", targetId: svc.id,
      confidence: 1, active: true,
      evidenceDocumentId: doc.id, chunkId: chunk.id,
      charStart: rawText.indexOf(svcLabel), charEnd: rawText.indexOf(svcLabel) + svcLabel.length, snippet: svcLabel,
    })
    .returning();

  const createdIds = [semanticEdge.id, mentionsEdge.id];

  const toEndpoints = (rows: typeof edges.$inferSelect[]): EdgeEndpoints[] =>
    rows.map((e) => ({
      id: e.id,
      sourceType: e.sourceType, sourceId: e.sourceId,
      targetType: e.targetType, targetId: e.targetId,
    }));

  // Positive: both endpoints of both edges resolve to live rows → no violations.
  const goodRows = await db.select().from(edges).where(inArray(edges.id, createdIds));
  const goodViolations = await checkEdgeIntegrity(toEndpoints(goodRows));
  expect(goodViolations).toEqual([]);

  // Negative: an active edge pointing at a non-existent sourceId must be FLAGGED.
  // Use an id guaranteed not to exist (negative ids are never produced by serial PKs).
  const danglingSourceId = -999_000_000 - Math.floor(Math.random() * 1e6);
  const [badEdge] = await db
    .insert(edges)
    .values({
      relationType: "IMPLEMENTS",
      sourceType: "Service", sourceId: danglingSourceId,
      targetType: "Requirement", targetId: req.id,
      confidence: 0.9, active: true,
      evidenceDocumentId: doc.id, charStart: 0, charEnd: rawText.length, snippet: rawText,
    })
    .returning();

  try {
    const withBad = await db.select().from(edges).where(inArray(edges.id, [...createdIds, badEdge.id]));
    const violations = await checkEdgeIntegrity(toEndpoints(withBad));
    // Exactly the bad edge is flagged, on its source endpoint.
    expect(violations).toHaveLength(1);
    expect(violations[0].edgeId).toBe(badEdge.id);
    expect(violations[0].endpoint).toBe("source");
    expect(violations[0].type).toBe("Service");
    expect(violations[0].refId).toBe(danglingSourceId);
  } finally {
    // Clean up the deliberately-broken edge so it can never leak into other checks.
    await db.delete(edges).where(eq(edges.id, badEdge.id));
  }
});
