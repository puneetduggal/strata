import { expect, test, vi, beforeEach } from "vitest";
vi.mock("@/lib/llm/claude", () => ({ extractStructured: vi.fn(), MODEL: "claude-opus-4-8" }));
import { extractStructured } from "@/lib/llm/claude";
import { db } from "@/lib/db/client";
import { documents, requirements, tests as testsTable, edges, entityIndex } from "@/lib/db/schema";
import { linkEntity } from "@/lib/pipeline/link";
import { and, eq } from "drizzle-orm";

// Shared-DB isolation: unique per-run suffix; every assertion is scoped to the ids we create.
// We never use global table counts and never truncate shared tables.
type Candidate = {
  relationType: string;
  kind?: string;
  otherEntityLabel: string;
  direction: "out" | "in";
  confidence: number;
  snippet: string;
};

function mockCandidates(candidates: Candidate[]) {
  vi.mocked(extractStructured).mockResolvedValueOnce({ candidates } as never);
}

// Create a Test + Requirement pair, each with a typed-table row AND an entity_index row so the
// linker can resolve labels → existing ids. Returns the refs + a document whose rawText grounds
// the snippet. The snippet is guaranteed present in rawText.
async function fixture(suffix: string, snippet: string) {
  const reqLabel = `REQ-${suffix}`;
  const testLabel = `T-${suffix}`;
  const rawText = `Verification matrix.\n\n${snippet}\n\nEnd of document for ${suffix}.`;
  expect(rawText.indexOf(snippet)).toBeGreaterThan(0);

  const [doc] = await db
    .insert(documents)
    .values({ filename: `link-${suffix}.txt`, mimeType: "text/plain", rawText, docType: "LLD", domain: "software_dev", status: "resolved" })
    .returning();

  const [req] = await db.insert(requirements).values({ label: reqLabel, text: "must do X" }).returning();
  const [t] = await db.insert(testsTable).values({ label: testLabel, kind: "integration" }).returning();

  await db.insert(entityIndex).values([
    { entityType: "Requirement", entityId: req.id, label: reqLabel, aliases: [], searchText: reqLabel },
    { entityType: "Test", entityId: t.id, label: testLabel, aliases: [], searchText: testLabel },
  ]);

  return { doc, req, testEntity: t, reqLabel, testLabel, rawText, snippet };
}

// Find the VERIFIES edge between exactly the ids we created (Test=source, Requirement=target).
async function findVerifiesEdge(testId: number, reqId: number) {
  const rows = await db
    .select()
    .from(edges)
    .where(
      and(
        eq(edges.relationType, "VERIFIES"),
        eq(edges.sourceType, "Test"),
        eq(edges.sourceId, testId),
        eq(edges.targetType, "Requirement"),
        eq(edges.targetId, reqId),
      ),
    );
  return rows;
}

beforeEach(() => {
  vi.mocked(extractStructured).mockReset();
});

test("R1/T1: grounded high-confidence VERIFIES candidate becomes an ACTIVE typed edge with provenance", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const snippet = `The integration test T-${suffix} verifies requirement REQ-${suffix}.`;
  const { doc, req, testEntity, reqLabel, rawText } = await fixture(suffix, snippet);

  // Test=source, Requirement=target ⇒ direction "out" from the Test's perspective.
  mockCandidates([
    { relationType: "VERIFIES", otherEntityLabel: reqLabel, direction: "out", confidence: 0.9, snippet },
  ]);

  await linkEntity({ type: "Test", id: testEntity.id, label: testEntity.label }, doc.id);

  const rows = await findVerifiesEdge(testEntity.id, req.id);
  expect(rows).toHaveLength(1);
  const e = rows[0];
  expect(e.active).toBe(true);
  expect(e.confidence).toBeCloseTo(0.9, 5);
  expect(e.evidenceDocumentId).toBe(doc.id);
  expect(e.charStart).not.toBeNull();
  expect(e.charEnd).not.toBeNull();
  const slice = rawText.slice(e.charStart!, e.charEnd!);
  expect(slice === e.snippet || slice.replace(/\s+/g, " ") === e.snippet!.replace(/\s+/g, " ")).toBe(true);
});

test("below-threshold confidence: grounded candidate creates an INACTIVE edge (row exists, active=false)", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const snippet = `Test T-${suffix} loosely relates to REQ-${suffix}.`;
  const { doc, req, testEntity, reqLabel } = await fixture(suffix, snippet);

  mockCandidates([
    { relationType: "VERIFIES", otherEntityLabel: reqLabel, direction: "out", confidence: 0.5, snippet },
  ]);

  await linkEntity({ type: "Test", id: testEntity.id, label: testEntity.label }, doc.id);

  const rows = await findVerifiesEdge(testEntity.id, req.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].active).toBe(false);
  expect(rows[0].confidence).toBeCloseTo(0.5, 5);
});

test("anti-phantom: an ungrounded snippet (not in rawText) creates NO edge row at all", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const snippet = `Test T-${suffix} verifies REQ-${suffix}.`;
  const { doc, req, testEntity, reqLabel } = await fixture(suffix, snippet);

  // The proposed snippet is NOT a substring of rawText → must be dropped entirely.
  mockCandidates([
    {
      relationType: "VERIFIES",
      otherEntityLabel: reqLabel,
      direction: "out",
      confidence: 0.95,
      snippet: `THIS PHANTOM TEXT ${suffix} IS NOT IN THE DOCUMENT`,
    },
  ]);

  await linkEntity({ type: "Test", id: testEntity.id, label: testEntity.label }, doc.id);

  const rows = await findVerifiesEdge(testEntity.id, req.id);
  expect(rows).toHaveLength(0);
});

test("registry guard: an illegal pair (VERIFIES with Requirement as source) is rejected — NO edge", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const snippet = `REQ-${suffix} is verified by T-${suffix}.`;
  const { doc, req, testEntity, testLabel } = await fixture(suffix, snippet);

  // Process the REQUIREMENT. direction "out" ⇒ Requirement=source, Test=target.
  // Registry VERIFIES is {sourceType:Test, targetType:Requirement} → this pair is illegal.
  mockCandidates([
    { relationType: "VERIFIES", otherEntityLabel: testLabel, direction: "out", confidence: 0.95, snippet },
  ]);

  await linkEntity({ type: "Requirement", id: req.id, label: req.label }, doc.id);

  // No edge in either orientation between these two ids.
  const asTestSource = await findVerifiesEdge(testEntity.id, req.id);
  const asReqSource = await db
    .select()
    .from(edges)
    .where(
      and(
        eq(edges.relationType, "VERIFIES"),
        eq(edges.sourceType, "Requirement"),
        eq(edges.sourceId, req.id),
      ),
    );
  expect(asTestSource).toHaveLength(0);
  expect(asReqSource).toHaveLength(0);
});

test("idempotency: linking the same grounded candidate twice yields exactly ONE row (updated, not duplicated)", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const snippet = `T-${suffix} verifies REQ-${suffix} fully.`;
  const { doc, req, testEntity, reqLabel } = await fixture(suffix, snippet);

  // First pass: below threshold → inactive.
  mockCandidates([
    { relationType: "VERIFIES", otherEntityLabel: reqLabel, direction: "out", confidence: 0.4, snippet },
  ]);
  await linkEntity({ type: "Test", id: testEntity.id, label: testEntity.label }, doc.id);

  let rows = await findVerifiesEdge(testEntity.id, req.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].active).toBe(false);
  const firstId = rows[0].id;

  // Second pass: above threshold → same row updated to active, no duplicate.
  mockCandidates([
    { relationType: "VERIFIES", otherEntityLabel: reqLabel, direction: "out", confidence: 0.92, snippet },
  ]);
  await linkEntity({ type: "Test", id: testEntity.id, label: testEntity.label }, doc.id);

  rows = await findVerifiesEdge(testEntity.id, req.id);
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(firstId);
  expect(rows[0].active).toBe(true);
  expect(rows[0].confidence).toBeCloseTo(0.92, 5);
});

test("alias resolution + threshold env: an aliased partner label resolves and LINK_THRESHOLD gates active", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const snippet = `T-${suffix} verifies the latency requirement REQ-${suffix}.`;
  const { doc, req, testEntity } = await fixture(suffix, snippet);

  // Add an alias to the Requirement's entity_index row; the candidate references the alias.
  const aliasLabel = `latency-requirement-${suffix}`;
  await db
    .update(entityIndex)
    .set({ aliases: [aliasLabel] })
    .where(and(eq(entityIndex.entityType, "Requirement"), eq(entityIndex.entityId, req.id)));

  const prev = process.env.LINK_THRESHOLD;
  process.env.LINK_THRESHOLD = "0.95"; // raise the bar so 0.9 is now INACTIVE
  try {
    mockCandidates([
      { relationType: "VERIFIES", otherEntityLabel: aliasLabel, direction: "out", confidence: 0.9, snippet },
    ]);
    await linkEntity({ type: "Test", id: testEntity.id, label: testEntity.label }, doc.id);
  } finally {
    if (prev === undefined) delete process.env.LINK_THRESHOLD;
    else process.env.LINK_THRESHOLD = prev;
  }

  const rows = await findVerifiesEdge(testEntity.id, req.id);
  expect(rows).toHaveLength(1); // alias resolved to the Requirement id
  expect(rows[0].active).toBe(false); // 0.9 < 0.95 threshold
});
