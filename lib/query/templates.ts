import { rawSql } from "@/lib/db/client";

// Task 13 — the deterministic query layer.
//
// THE DETERMINISM GUARDRAIL: every answer below is the rowset returned by SQL over the
// structured columns. The LLM never decides set membership. ALL traversal queries filter
// `edges.active = true`. Transitive queries use `WITH RECURSIVE` with a visited-set (path
// array) so cycles can't loop. User inputs are ALWAYS parameterized (never string-concat).
//
// `runCQ(templateId, params)` returns `{ rows, provenance }`:
//   - rows: the deterministic answer (shape varies per template).
//   - provenance: the active edges the answer relied on, for click-through evidence.

/** The slice of an edge row used for click-through evidence. */
export type EdgeRef = {
  id: number;
  relationType: string;
  kind: string | null;
  sourceType: string;
  sourceId: number;
  targetType: string;
  targetId: number;
  evidenceDocumentId: number | null;
  chunkId: number | null;
  charStart: number | null;
  charEnd: number | null;
  snippet: string | null;
};

export type CQResult = { rows: any[]; provenance: EdgeRef[] };

// Map a raw `edges` row (snake_case from postgres-js) to an EdgeRef.
function toEdgeRef(r: Record<string, any>): EdgeRef {
  return {
    id: r.id,
    relationType: r.relation_type,
    kind: r.kind,
    sourceType: r.source_type,
    sourceId: r.source_id,
    targetType: r.target_type,
    targetId: r.target_id,
    evidenceDocumentId: r.evidence_document_id,
    chunkId: r.chunk_id,
    charStart: r.char_start,
    charEnd: r.char_end,
    snippet: r.snippet,
  };
}

function asInt(params: Record<string, unknown>, key: string): number {
  const v = params[key];
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n)) throw new Error(`runCQ: param "${key}" must be an integer, got ${String(v)}`);
  return n;
}

// ---------------------------------------------------------------------------
// Q1 — requirements_without_test (anti-join)
// Requirements with no active VERIFIES edge from any Test. Pure lookup → no provenance
// (the answer is the ABSENCE of edges, so there is nothing to click through to).
// ---------------------------------------------------------------------------
async function requirementsWithoutTest(): Promise<CQResult> {
  const rows = (await rawSql`
    SELECT r.*
    FROM requirements r
    WHERE NOT EXISTS (
      SELECT 1 FROM edges e
      WHERE e.active
        AND e.relation_type = 'VERIFIES'
        AND e.target_type = 'Requirement'
        AND e.target_id = r.id
    )
    ORDER BY r.id
  `) as any[];
  return { rows, provenance: [] };
}

// ---------------------------------------------------------------------------
// Q2 — services_coverage_gaps
// Per-service { noDesignDoc, noLoadTest } booleans (reference SQL in brief).
//   noDesignDoc: no active chunk MENTIONS edge for the service whose evidence document is
//                a design doc (HLD/LLD/ARD).
//   noLoadTest:  no active VALIDATES edge from any LoadTestResult to a requirement the
//                service IMPLEMENTS.
// ---------------------------------------------------------------------------
async function servicesCoverageGaps(): Promise<CQResult> {
  const rows = (await rawSql`
    SELECT s.*,
      NOT EXISTS (
        SELECT 1 FROM edges m
        JOIN documents d ON d.id = m.evidence_document_id
        WHERE m.active AND m.relation_type = 'MENTIONS'
          AND m.target_type = 'Service' AND m.target_id = s.id
          AND d.doc_type IN ('HLD','LLD','ARD')
      ) AS "noDesignDoc",
      NOT EXISTS (
        SELECT 1 FROM edges v
        WHERE v.active AND v.relation_type = 'VALIDATES'
          AND v.source_type = 'LoadTestResult'
          AND v.target_type = 'Requirement'
          AND v.target_id IN (
            SELECT i.target_id FROM edges i
            WHERE i.active AND i.relation_type = 'IMPLEMENTS'
              AND i.source_type = 'Service' AND i.source_id = s.id
          )
      ) AS "noLoadTest"
    FROM services s
    ORDER BY s.id
  `) as any[];
  return { rows, provenance: [] };
}

// ---------------------------------------------------------------------------
// Q3 — service_blast_radius (incoming DEPENDS_ON, recursive, cycle-safe)
// "What depends on Service X / what breaks if it changes?" — follows INCOMING DEPENDS_ON
// (who depends on X) transitively. Cycle-safe via a visited path array: a service is never
// re-expanded once it's on the path. Provenance = the DEPENDS_ON edges traversed.
// ---------------------------------------------------------------------------
async function serviceBlastRadius(params: Record<string, unknown>): Promise<CQResult> {
  const id = asInt(params, "serviceId");
  const rows = (await rawSql`
    WITH RECURSIVE impact(id, path) AS (
        SELECT ${id}::int, ARRAY[${id}::int]
      UNION ALL
        SELECT e.source_id, impact.path || e.source_id
        FROM edges e
        JOIN impact ON e.target_type = 'Service' AND e.target_id = impact.id
        WHERE e.active AND e.relation_type = 'DEPENDS_ON'
          AND NOT e.source_id = ANY(impact.path)
    )
    SELECT DISTINCT s.* FROM impact JOIN services s ON s.id = impact.id
    WHERE impact.id <> ${id}::int
    ORDER BY s.id
  `) as any[];

  // Provenance: the active incoming-DEPENDS_ON edges reachable from X (the traversal frontier).
  const prov = (await rawSql`
    WITH RECURSIVE impact(id, path) AS (
        SELECT ${id}::int, ARRAY[${id}::int]
      UNION ALL
        SELECT e.source_id, impact.path || e.source_id
        FROM edges e
        JOIN impact ON e.target_type = 'Service' AND e.target_id = impact.id
        WHERE e.active AND e.relation_type = 'DEPENDS_ON'
          AND NOT e.source_id = ANY(impact.path)
    )
    SELECT DISTINCT e.* FROM edges e
    JOIN impact ON e.target_type = 'Service' AND e.target_id = impact.id
    WHERE e.active AND e.relation_type = 'DEPENDS_ON'
  `) as Record<string, any>[];
  return { rows, provenance: prov.map(toEdgeRef) };
}

// ---------------------------------------------------------------------------
// Q4 — feature_chain (trace Feature → reqs → services → tests/loadtests)
// Returns one row { requirements, services, tests, loadTestResults } describing the full
// PRD→impl→test chain rooted at the feature. Requirements = those that SPECIFY the feature;
// services = those that IMPLEMENT those requirements; tests = VERIFIES those requirements;
// loadTestResults = VALIDATES those requirements. (No recursion — a single bounded trace.)
// ---------------------------------------------------------------------------
async function featureChain(params: Record<string, unknown>): Promise<CQResult> {
  const id = asInt(params, "featureId");
  const rows = (await rawSql`
    WITH reqs AS (
      SELECT e.source_id AS id FROM edges e
      WHERE e.active AND e.relation_type = 'SPECIFIES'
        AND e.source_type = 'Requirement' AND e.target_type = 'Feature' AND e.target_id = ${id}::int
    )
    SELECT
      (SELECT json_agg(r.* ORDER BY r.id) FROM requirements r WHERE r.id IN (SELECT id FROM reqs)) AS requirements,
      (SELECT json_agg(s.* ORDER BY s.id) FROM services s WHERE s.id IN (
          SELECT e.source_id FROM edges e WHERE e.active AND e.relation_type = 'IMPLEMENTS'
            AND e.source_type = 'Service' AND e.target_type = 'Requirement' AND e.target_id IN (SELECT id FROM reqs)
       )) AS services,
      (SELECT json_agg(t.* ORDER BY t.id) FROM tests t WHERE t.id IN (
          SELECT e.source_id FROM edges e WHERE e.active AND e.relation_type = 'VERIFIES'
            AND e.source_type = 'Test' AND e.target_type = 'Requirement' AND e.target_id IN (SELECT id FROM reqs)
       )) AS tests,
      (SELECT json_agg(l.* ORDER BY l.id) FROM load_test_results l WHERE l.id IN (
          SELECT e.source_id FROM edges e WHERE e.active AND e.relation_type = 'VALIDATES'
            AND e.source_type = 'LoadTestResult' AND e.target_type = 'Requirement' AND e.target_id IN (SELECT id FROM reqs)
       )) AS "loadTestResults"
  `) as any[];

  const prov = (await rawSql`
    WITH reqs AS (
      SELECT e.source_id AS id FROM edges e
      WHERE e.active AND e.relation_type = 'SPECIFIES'
        AND e.source_type = 'Requirement' AND e.target_type = 'Feature' AND e.target_id = ${id}::int
    )
    SELECT * FROM edges e WHERE e.active AND (
      (e.relation_type = 'SPECIFIES' AND e.target_type = 'Feature' AND e.target_id = ${id}::int)
      OR (e.relation_type IN ('IMPLEMENTS','VERIFIES','VALIDATES') AND e.target_type = 'Requirement' AND e.target_id IN (SELECT id FROM reqs))
    )
  `) as Record<string, any>[];

  // Normalize null json_agg → [] for the consumer.
  const r = rows[0] ?? {};
  return {
    rows: [{
      requirements: r.requirements ?? [],
      services: r.services ?? [],
      tests: r.tests ?? [],
      loadTestResults: r.loadTestResults ?? [],
    }],
    provenance: prov.map(toEdgeRef),
  };
}

// ---------------------------------------------------------------------------
// Q5 — service_datastore (USES lookup)
// Datastores the service actively USES. Provenance = the USES edges.
// ---------------------------------------------------------------------------
async function serviceDatastore(params: Record<string, unknown>): Promise<CQResult> {
  const id = asInt(params, "serviceId");
  const rows = (await rawSql`
    SELECT ds.* FROM datastores ds
    JOIN edges e ON e.active AND e.relation_type = 'USES'
      AND e.source_type = 'Service' AND e.source_id = ${id}::int
      AND e.target_type = 'Datastore' AND e.target_id = ds.id
    ORDER BY ds.id
  `) as any[];
  const prov = (await rawSql`
    SELECT * FROM edges e
    WHERE e.active AND e.relation_type = 'USES'
      AND e.source_type = 'Service' AND e.source_id = ${id}::int
      AND e.target_type = 'Datastore'
  `) as Record<string, any>[];
  return { rows, provenance: prov.map(toEdgeRef) };
}

// ---------------------------------------------------------------------------
// Q6 — loadtest_vs_target (reconcile observed vs target)
// The LoadTestResult row(s) that VALIDATE the given requirement, carrying observedValue,
// targetValue and the persisted `passed` flag so a met/missed determination is possible
// downstream (the rowset carries the values; phrasing is downstream).
// ---------------------------------------------------------------------------
async function loadtestVsTarget(params: Record<string, unknown>): Promise<CQResult> {
  const id = asInt(params, "requirementId");
  const rows = (await rawSql`
    SELECT l.id, l.label, l.scenario, l.metric,
           l.observed_value AS "observedValue",
           l.target_value AS "targetValue",
           l.passed,
           r.target_value AS "requirementTarget",
           r.metric AS "requirementMetric"
    FROM load_test_results l
    JOIN edges e ON e.active AND e.relation_type = 'VALIDATES'
      AND e.source_type = 'LoadTestResult' AND e.source_id = l.id
      AND e.target_type = 'Requirement' AND e.target_id = ${id}::int
    JOIN requirements r ON r.id = ${id}::int
    ORDER BY l.id
  `) as any[];
  const prov = (await rawSql`
    SELECT * FROM edges e
    WHERE e.active AND e.relation_type = 'VALIDATES'
      AND e.source_type = 'LoadTestResult'
      AND e.target_type = 'Requirement' AND e.target_id = ${id}::int
  `) as Record<string, any>[];
  return { rows, provenance: prov.map(toEdgeRef) };
}

// ---------------------------------------------------------------------------
// Q7 — service_decisions (AFFECTS + rationale)
// Decisions that actively AFFECT the service, with their rationale. Provenance = AFFECTS edges.
// ---------------------------------------------------------------------------
async function serviceDecisions(params: Record<string, unknown>): Promise<CQResult> {
  const id = asInt(params, "serviceId");
  const rows = (await rawSql`
    SELECT d.* FROM decisions d
    JOIN edges e ON e.active AND e.relation_type = 'AFFECTS'
      AND e.source_type = 'Decision' AND e.source_id = d.id
      AND e.target_type = 'Service' AND e.target_id = ${id}::int
    ORDER BY d.id
  `) as any[];
  const prov = (await rawSql`
    SELECT * FROM edges e
    WHERE e.active AND e.relation_type = 'AFFECTS'
      AND e.target_type = 'Service' AND e.target_id = ${id}::int
      AND e.source_type = 'Decision'
  `) as Record<string, any>[];
  return { rows, provenance: prov.map(toEdgeRef) };
}

// ---------------------------------------------------------------------------
// Q8 — service_owner (OWNS lookup)
// Persons who actively OWN the service. Provenance = OWNS edges.
// ---------------------------------------------------------------------------
async function serviceOwner(params: Record<string, unknown>): Promise<CQResult> {
  const id = asInt(params, "serviceId");
  const rows = (await rawSql`
    SELECT p.* FROM persons p
    JOIN edges e ON e.active AND e.relation_type = 'OWNS'
      AND e.source_type = 'Person' AND e.source_id = p.id
      AND e.target_type = 'Service' AND e.target_id = ${id}::int
    ORDER BY p.id
  `) as any[];
  const prov = (await rawSql`
    SELECT * FROM edges e
    WHERE e.active AND e.relation_type = 'OWNS'
      AND e.target_type = 'Service' AND e.target_id = ${id}::int
      AND e.source_type = 'Person'
  `) as Record<string, any>[];
  return { rows, provenance: prov.map(toEdgeRef) };
}

// ---------------------------------------------------------------------------
// Q9 — feature_blast_radius (reference SQL in brief)
// Feature → SPECIFIES-incoming requirements → IMPLEMENTS-incoming services, then those
// services + their transitive INCOMING DEPENDS_ON dependents (cycle-safe), plus the
// verification artifacts (VERIFIES tests + VALIDATES loadtests) on the impacted requirements.
// Returns one row { requirements, services, tests, loadTestResults }.
// Cycle-safety: the `svc` CTE uses UNION (not UNION ALL); UNION dedupes the working set, so a
// node already produced is not re-expanded → recursion terminates even on a DEPENDS_ON cycle.
// ---------------------------------------------------------------------------
async function featureBlastRadius(params: Record<string, unknown>): Promise<CQResult> {
  const id = asInt(params, "featureId");
  const rows = (await rawSql`
    WITH RECURSIVE reqs AS (
      SELECT e.source_id AS id FROM edges e
      WHERE e.active AND e.relation_type = 'SPECIFIES'
        AND e.source_type = 'Requirement' AND e.target_type = 'Feature' AND e.target_id = ${id}::int
    ), impl AS (
      SELECT e.source_id AS id FROM edges e JOIN reqs ON e.target_id = reqs.id
      WHERE e.active AND e.relation_type = 'IMPLEMENTS'
        AND e.source_type = 'Service' AND e.target_type = 'Requirement'
    ), svc(id) AS (
        SELECT id FROM impl
      UNION
        SELECT e.source_id FROM edges e JOIN svc ON e.target_type = 'Service' AND e.target_id = svc.id
        WHERE e.active AND e.relation_type = 'DEPENDS_ON'
    )
    SELECT
      (SELECT json_agg(r.* ORDER BY r.id) FROM requirements r WHERE r.id IN (SELECT id FROM reqs)) AS requirements,
      (SELECT json_agg(s.* ORDER BY s.id) FROM services s WHERE s.id IN (SELECT id FROM svc)) AS services,
      (SELECT json_agg(t.* ORDER BY t.id) FROM tests t WHERE t.id IN (
          SELECT e.source_id FROM edges e WHERE e.active AND e.relation_type = 'VERIFIES'
            AND e.source_type = 'Test' AND e.target_type = 'Requirement' AND e.target_id IN (SELECT id FROM reqs)
       )) AS tests,
      (SELECT json_agg(l.* ORDER BY l.id) FROM load_test_results l WHERE l.id IN (
          SELECT e.source_id FROM edges e WHERE e.active AND e.relation_type = 'VALIDATES'
            AND e.source_type = 'LoadTestResult' AND e.target_type = 'Requirement' AND e.target_id IN (SELECT id FROM reqs)
       )) AS "loadTestResults"
  `) as any[];

  // Provenance: structural edges of the impacted subgraph (SPECIFIES into F, IMPLEMENTS/
  // VERIFIES/VALIDATES into impacted reqs, and DEPENDS_ON among impacted services).
  const prov = (await rawSql`
    WITH RECURSIVE reqs AS (
      SELECT e.source_id AS id FROM edges e
      WHERE e.active AND e.relation_type = 'SPECIFIES'
        AND e.source_type = 'Requirement' AND e.target_type = 'Feature' AND e.target_id = ${id}::int
    ), impl AS (
      SELECT e.source_id AS id FROM edges e JOIN reqs ON e.target_id = reqs.id
      WHERE e.active AND e.relation_type = 'IMPLEMENTS'
        AND e.source_type = 'Service' AND e.target_type = 'Requirement'
    ), svc(id) AS (
        SELECT id FROM impl
      UNION
        SELECT e.source_id FROM edges e JOIN svc ON e.target_type = 'Service' AND e.target_id = svc.id
        WHERE e.active AND e.relation_type = 'DEPENDS_ON'
    )
    SELECT DISTINCT * FROM edges e WHERE e.active AND (
      (e.relation_type = 'SPECIFIES' AND e.target_type = 'Feature' AND e.target_id = ${id}::int)
      OR (e.relation_type IN ('IMPLEMENTS','VERIFIES','VALIDATES') AND e.target_type = 'Requirement' AND e.target_id IN (SELECT id FROM reqs))
      OR (e.relation_type = 'DEPENDS_ON' AND e.target_type = 'Service' AND e.target_id IN (SELECT id FROM svc))
    )
  `) as Record<string, any>[];

  const r = rows[0] ?? {};
  return {
    rows: [{
      requirements: r.requirements ?? [],
      services: r.services ?? [],
      tests: r.tests ?? [],
      loadTestResults: r.loadTestResults ?? [],
    }],
    provenance: prov.map(toEdgeRef),
  };
}

// ---------------------------------------------------------------------------
// Q10 — dependency_path (OUTGOING DEPENDS_ON, recursive path, cycle-safe)
// "How does Service X (sourceId) transitively depend on Service Z (targetId)?" → the ordered
// outgoing path X → … → Z (the things X depends on). Opposite direction to Q3. Cycle-safe via
// the visited path array: a node already on the path is never revisited, so a DEPENDS_ON cycle
// cannot loop. Returns the shortest path (fewest hops) when one exists, else no rows.
// ---------------------------------------------------------------------------
async function dependencyPath(params: Record<string, unknown>): Promise<CQResult> {
  const source = asInt(params, "sourceId");
  const target = asInt(params, "targetId");
  const rows = (await rawSql`
    WITH RECURSIVE dep(id, path) AS (
        SELECT ${source}::int, ARRAY[${source}::int]
      UNION ALL
        SELECT e.target_id, dep.path || e.target_id
        FROM edges e
        JOIN dep ON e.source_type = 'Service' AND e.source_id = dep.id
        WHERE e.active AND e.relation_type = 'DEPENDS_ON'
          AND NOT e.target_id = ANY(dep.path)
    )
    SELECT path FROM dep WHERE id = ${target}::int
    ORDER BY array_length(path, 1)
    LIMIT 1
  `) as Array<{ path: number[] }>;

  if (rows.length === 0) return { rows: [], provenance: [] };

  // Provenance: the DEPENDS_ON edges that form the returned ordered path (consecutive hops).
  const path = rows[0].path.map((n) => Number(n));
  const prov: EdgeRef[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const hop = (await rawSql`
      SELECT * FROM edges e
      WHERE e.active AND e.relation_type = 'DEPENDS_ON'
        AND e.source_type = 'Service' AND e.source_id = ${path[i]}::int
        AND e.target_type = 'Service' AND e.target_id = ${path[i + 1]}::int
      ORDER BY e.id
      LIMIT 1
    `) as Record<string, any>[];
    if (hop[0]) prov.push(toEdgeRef(hop[0]));
  }
  return { rows: [{ path }], provenance: prov };
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const TEMPLATES: Record<string, (p: Record<string, unknown>) => Promise<CQResult>> = {
  requirements_without_test: () => requirementsWithoutTest(),
  services_coverage_gaps: () => servicesCoverageGaps(),
  service_blast_radius: serviceBlastRadius,
  feature_chain: featureChain,
  service_datastore: serviceDatastore,
  loadtest_vs_target: loadtestVsTarget,
  service_decisions: serviceDecisions,
  service_owner: serviceOwner,
  feature_blast_radius: featureBlastRadius,
  dependency_path: dependencyPath,
};

// The known template ids, derived from TEMPLATES so the route's allowlist can never drift
// from the dispatch table (single source of truth).
export function isKnownCQ(id: string): boolean {
  return id in TEMPLATES;
}

export async function runCQ(templateId: string, params: Record<string, unknown>): Promise<CQResult> {
  const impl = TEMPLATES[templateId];
  if (!impl) throw new Error(`runCQ: unknown template "${templateId}"`);
  return impl(params ?? {});
}
