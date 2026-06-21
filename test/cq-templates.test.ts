import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "@/lib/db/client";
import {
  documents,
  chunks,
  systems,
  features,
  requirements,
  services,
  datastores,
  tests as testsTable,
  loadTestResults,
  decisions,
  persons,
  edges,
} from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { runCQ } from "@/lib/query/templates";

// Task 13 — the 10 CQ SQL templates, asserted against the EXACT golden graph from the brief.
//
// Golden graph (all edges active=true):
//   System S; Feature F; F --PART_OF--> S
//   R1, R2 --SPECIFIES--> F
//   Service A --IMPLEMENTS--> R1
//   A --DEPENDS_ON--> B --DEPENDS_ON--> C   (outgoing chain)
//   Test T1 --VERIFIES--> R1   (R2 has NO verifying test)
//   LoadTestResult LT --VALIDATES--> R1
//   HLD document with a chunk --MENTIONS--> A  (so A is "design-doc covered")
//   B and C have NEITHER a design-doc MENTIONS nor a LoadTestResult
//   Datastore DS; A --USES--> DS
//   Person P --OWNS--> A
//   Decision DEC --AFFECTS--> A
//
// Shared-DB safe: every label carries a unique per-run token; we only ever assert over the
// ids we create (and labels carrying our token). We never count or truncate shared tables,
// and we clean up everything we insert in afterAll.

const token = `cq-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const L = (name: string) => `${name}-${token}`;

// ids captured at insert time
const ids: {
  doc?: number;
  chunk?: number;
  S?: number;
  F?: number;
  R1?: number;
  R2?: number;
  A?: number;
  B?: number;
  C?: number;
  T1?: number;
  LT?: number;
  DS?: number;
  P?: number;
  DEC?: number;
} = {};
const edgeIds: number[] = [];

async function addEdge(v: typeof edges.$inferInsert) {
  const [e] = await db.insert(edges).values({ active: true, confidence: 1, ...v }).returning();
  edgeIds.push(e.id);
  return e;
}

beforeAll(async () => {
  const [doc] = await db
    .insert(documents)
    .values({ filename: `${L("hld")}.txt`, mimeType: "text/plain", rawText: "design", docType: "HLD", domain: "software_dev", status: "ready" })
    .returning();
  ids.doc = doc.id;
  const [chunk] = await db
    .insert(chunks)
    .values({ documentId: doc.id, page: 1, charStart: 0, charEnd: 6, text: "design" })
    .returning();
  ids.chunk = chunk.id;

  const [S] = await db.insert(systems).values({ label: L("S"), description: "system S" }).returning();
  const [F] = await db.insert(features).values({ label: L("F"), description: "feature F", systemId: S.id }).returning();
  const [R1] = await db.insert(requirements).values({ label: L("R1"), text: "req one", kind: "functional", metric: "p95", targetValue: "200ms", priority: "P0" }).returning();
  const [R2] = await db.insert(requirements).values({ label: L("R2"), text: "req two", kind: "functional" }).returning();
  const [A] = await db.insert(services).values({ label: L("A"), description: "service A", language: "go" }).returning();
  const [B] = await db.insert(services).values({ label: L("B"), description: "service B", language: "go" }).returning();
  const [C] = await db.insert(services).values({ label: L("C"), description: "service C", language: "go" }).returning();
  const [T1] = await db.insert(testsTable).values({ label: L("T1"), kind: "integration", description: "verifies R1" }).returning();
  const [LT] = await db.insert(loadTestResults).values({ label: L("LT"), scenario: "spike", metric: "p95", observedValue: "180ms", targetValue: "200ms", passed: true }).returning();
  const [DS] = await db.insert(datastores).values({ label: L("DS"), engine: "postgres", purpose: "primary" }).returning();
  const [P] = await db.insert(persons).values({ label: L("P"), role: "Tech Lead" }).returning();
  const [DEC] = await db.insert(decisions).values({ label: L("DEC"), status: "accepted", rationale: "use event sourcing" }).returning();

  Object.assign(ids, { S: S.id, F: F.id, R1: R1.id, R2: R2.id, A: A.id, B: B.id, C: C.id, T1: T1.id, LT: LT.id, DS: DS.id, P: P.id, DEC: DEC.id });

  // Structural edges
  await addEdge({ relationType: "PART_OF", sourceType: "Feature", sourceId: F.id, targetType: "System", targetId: S.id });
  await addEdge({ relationType: "SPECIFIES", sourceType: "Requirement", sourceId: R1.id, targetType: "Feature", targetId: F.id });
  await addEdge({ relationType: "SPECIFIES", sourceType: "Requirement", sourceId: R2.id, targetType: "Feature", targetId: F.id });
  await addEdge({ relationType: "IMPLEMENTS", sourceType: "Service", sourceId: A.id, targetType: "Requirement", targetId: R1.id });
  // Dependency chain A -> B -> C (outgoing)
  await addEdge({ relationType: "DEPENDS_ON", kind: "CALLS", sourceType: "Service", sourceId: A.id, targetType: "Service", targetId: B.id });
  await addEdge({ relationType: "DEPENDS_ON", kind: "CALLS", sourceType: "Service", sourceId: B.id, targetType: "Service", targetId: C.id });
  // Verification artifacts on R1 only
  await addEdge({ relationType: "VERIFIES", sourceType: "Test", sourceId: T1.id, targetType: "Requirement", targetId: R1.id });
  await addEdge({ relationType: "VALIDATES", sourceType: "LoadTestResult", sourceId: LT.id, targetType: "Requirement", targetId: R1.id });
  // A is design-doc covered: chunk MENTIONS A, evidence doc is an HLD
  await addEdge({ relationType: "MENTIONS", sourceType: "chunk", sourceId: chunk.id, targetType: "Service", targetId: A.id, evidenceDocumentId: doc.id, chunkId: chunk.id });
  // Lookups: USES, OWNS, AFFECTS
  await addEdge({ relationType: "USES", sourceType: "Service", sourceId: A.id, targetType: "Datastore", targetId: DS.id });
  await addEdge({ relationType: "OWNS", sourceType: "Person", sourceId: P.id, targetType: "Service", targetId: A.id });
  await addEdge({ relationType: "AFFECTS", sourceType: "Decision", sourceId: DEC.id, targetType: "Service", targetId: A.id, snippet: "use event sourcing" });
});

afterAll(async () => {
  if (edgeIds.length) await db.delete(edges).where(inArray(edges.id, edgeIds));
  if (ids.S) await db.delete(systems).where(eq(systems.id, ids.S));
  if (ids.F) await db.delete(features).where(eq(features.id, ids.F));
  if (ids.R1) await db.delete(requirements).where(inArray(requirements.id, [ids.R1, ids.R2!]));
  if (ids.A) await db.delete(services).where(inArray(services.id, [ids.A, ids.B!, ids.C!]));
  if (ids.T1) await db.delete(testsTable).where(eq(testsTable.id, ids.T1));
  if (ids.LT) await db.delete(loadTestResults).where(eq(loadTestResults.id, ids.LT));
  if (ids.DS) await db.delete(datastores).where(eq(datastores.id, ids.DS));
  if (ids.P) await db.delete(persons).where(eq(persons.id, ids.P));
  if (ids.DEC) await db.delete(decisions).where(eq(decisions.id, ids.DEC));
  if (ids.chunk) await db.delete(chunks).where(eq(chunks.id, ids.chunk));
  if (ids.doc) await db.delete(documents).where(eq(documents.id, ids.doc));
});

// helper: restrict a rowset to ids we created (shared-DB safety) and return their ids
const idsOf = (rows: Array<{ id: number }>, keep: number[]) => rows.filter((r) => keep.includes(r.id)).map((r) => r.id).sort((a, b) => a - b);

describe("CQ templates against the golden graph", () => {
  test("Q1 requirements_without_test → exactly {R2}", async () => {
    const { rows } = await runCQ("requirements_without_test", {});
    const mine = idsOf(rows, [ids.R1!, ids.R2!]);
    expect(mine).toEqual([ids.R2!]);
  });

  test("Q2 services_coverage_gaps → A both false; B,C both true", async () => {
    const { rows } = await runCQ("services_coverage_gaps", {});
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(ids.A!)).toMatchObject({ noDesignDoc: false, noLoadTest: false });
    expect(byId.get(ids.B!)).toMatchObject({ noDesignDoc: true, noLoadTest: true });
    expect(byId.get(ids.C!)).toMatchObject({ noDesignDoc: true, noLoadTest: true });
  });

  test("Q3 service_blast_radius of C → {B, A}", async () => {
    const { rows, provenance } = await runCQ("service_blast_radius", { serviceId: ids.C });
    const mine = idsOf(rows, [ids.A!, ids.B!, ids.C!]);
    expect(mine).toEqual([ids.A!, ids.B!].sort((a, b) => a - b));
    // provenance carries the DEPENDS_ON edges traversed
    expect(provenance.length).toBeGreaterThanOrEqual(2);
    expect(provenance.every((p) => p.relationType === "DEPENDS_ON")).toBe(true);
  });

  test("Q4 feature_chain for F → reqs/services/tests/loadtests resolved", async () => {
    const { rows } = await runCQ("feature_chain", { featureId: ids.F });
    expect(rows).toHaveLength(1);
    const chain = rows[0];
    const rIds = (chain.requirements ?? []).map((r: { id: number }) => r.id).sort((a: number, b: number) => a - b);
    expect(rIds).toEqual([ids.R1!, ids.R2!].sort((a, b) => a - b));
    const sIds = (chain.services ?? []).map((s: { id: number }) => s.id);
    expect(sIds).toContain(ids.A!);
    const tIds = (chain.tests ?? []).map((t: { id: number }) => t.id);
    expect(tIds).toContain(ids.T1!);
    const ltIds = (chain.loadTestResults ?? []).map((l: { id: number }) => l.id);
    expect(ltIds).toContain(ids.LT!);
  });

  test("Q5 service_datastore for A → DS", async () => {
    const { rows } = await runCQ("service_datastore", { serviceId: ids.A });
    expect(rows.map((r) => r.id)).toContain(ids.DS!);
  });

  test("Q6 loadtest_vs_target for R1 → observed vs target carried", async () => {
    const { rows } = await runCQ("loadtest_vs_target", { requirementId: ids.R1 });
    const lt = rows.find((r) => r.id === ids.LT!);
    expect(lt).toBeTruthy();
    expect(lt.observedValue).toBe("180ms");
    expect(lt.targetValue).toBe("200ms");
    expect(lt.passed).toBe(true);
  });

  test("Q7 service_decisions for A → DEC with rationale", async () => {
    const { rows } = await runCQ("service_decisions", { serviceId: ids.A });
    const dec = rows.find((r) => r.id === ids.DEC!);
    expect(dec).toBeTruthy();
    expect(dec.rationale).toBe("use event sourcing");
  });

  test("Q8 service_owner for A → P", async () => {
    const { rows } = await runCQ("service_owner", { serviceId: ids.A });
    expect(rows.map((r) => r.id)).toContain(ids.P!);
  });

  test("Q9 feature_blast_radius for F → services + verification artifacts", async () => {
    const { rows } = await runCQ("feature_blast_radius", { featureId: ids.F });
    expect(rows).toHaveLength(1);
    const br = rows[0];
    const reqIds = (br.requirements ?? []).map((r: { id: number }) => r.id).sort((a: number, b: number) => a - b);
    expect(reqIds).toEqual([ids.R1!, ids.R2!].sort((a, b) => a - b));
    // services = implementing (A) + transitive dependents — but A has no incoming DEPENDS_ON,
    // so the impacted set here is just {A} (A depends on B/C, not the other way around).
    const svcIds = (br.services ?? []).map((s: { id: number }) => s.id);
    expect(svcIds).toContain(ids.A!);
    // verification artifacts attached to impacted requirements
    const tIds = (br.tests ?? []).map((t: { id: number }) => t.id);
    expect(tIds).toContain(ids.T1!);
    const ltIds = (br.loadTestResults ?? []).map((l: { id: number }) => l.id);
    expect(ltIds).toContain(ids.LT!);
  });

  test("Q10 dependency_path A→C → ordered [A,B,C]; reverse C→A → none", async () => {
    const fwd = await runCQ("dependency_path", { sourceId: ids.A, targetId: ids.C });
    expect(fwd.rows).toHaveLength(1);
    expect(fwd.rows[0].path).toEqual([ids.A!, ids.B!, ids.C!]);
    expect(fwd.provenance.length).toBeGreaterThanOrEqual(2);

    const rev = await runCQ("dependency_path", { sourceId: ids.C, targetId: ids.A });
    expect(rev.rows).toHaveLength(0);
  });

  test("a cycle A→B→A does not loop (Q3 + Q10 terminate)", async () => {
    // Add a back-edge B -> A so {A,B} form a cycle. Recursion must still terminate.
    const back = await addEdge({ relationType: "DEPENDS_ON", kind: "CALLS", sourceType: "Service", sourceId: ids.B!, targetType: "Service", targetId: ids.A! });
    try {
      // Q3 blast radius of A: with the cycle, B now depends on A → B is impacted, but no infinite loop.
      const br = await runCQ("service_blast_radius", { serviceId: ids.A });
      const mine = idsOf(br.rows, [ids.A!, ids.B!, ids.C!]);
      expect(mine).toEqual([ids.B!]); // only B depends on A; terminates despite cycle
      // Q10 outgoing path A -> C still resolves and terminates.
      const fwd = await runCQ("dependency_path", { sourceId: ids.A, targetId: ids.C });
      expect(fwd.rows[0].path).toEqual([ids.A!, ids.B!, ids.C!]);
    } finally {
      await db.delete(edges).where(eq(edges.id, back.id));
      const i = edgeIds.indexOf(back.id);
      if (i >= 0) edgeIds.splice(i, 1);
    }
  });
});
