import { rawSql } from "@/lib/db/client";
import { runCQ } from "@/lib/query/templates";

// Task 14 — the traceability subgraph for one System.
//
// Given a system id we walk the structural spine and pull in everything hanging off it:
//   System --PART_OF<-- Features --SPECIFIES<-- Requirements --IMPLEMENTS<-- Services
//   Services --USES--> Datastores, --DEPENDS_ON--> Services
//   Requirements <--VERIFIES-- Tests, <--VALIDATES-- LoadTestResults
//   Services <--OWNS-- Persons, <--AFFECTS-- Decisions
// Every traversal filters edges.active = true. Then we overlay the two coverage CQs:
//   Q1 requirements_without_test → flags.noTest on Requirement nodes
//   Q2 services_coverage_gaps     → flags.noDesignDoc / flags.noLoadTest on Service nodes
//
// Demo scale, so a small set of targeted queries (one per entity layer) is plenty and stays
// readable. The shape is deliberately UI-friendly: a flat node list keyed by (type,id) plus a
// flat edge list carrying relationType/kind and the evidence span for click-through.

export type GraphNodeType =
  | "System"
  | "Feature"
  | "Requirement"
  | "Service"
  | "Datastore"
  | "Test"
  | "LoadTestResult"
  | "Person"
  | "Decision";

export type NodeFlags = {
  noTest?: boolean; // Requirement: no verifying Test (Q1)
  noDesignDoc?: boolean; // Service: not mentioned by any design doc (Q2)
  noLoadTest?: boolean; // Service: no load test on the requirements it implements (Q2)
};

export type GraphNode = {
  type: GraphNodeType;
  id: number;
  label: string;
  flags?: NodeFlags;
};

export type GraphEdge = {
  relationType: string;
  kind: string | null;
  sourceType: string;
  sourceId: number;
  targetType: string;
  targetId: number;
  evidenceDocumentId: number | null;
  charStart: number | null;
  charEnd: number | null;
  snippet: string | null;
};

export type SystemGraph = {
  system: { id: number; label: string } | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// Map a raw `edges` row (snake_case from postgres-js) to a GraphEdge.
function toGraphEdge(r: Record<string, any>): GraphEdge {
  return {
    relationType: r.relation_type,
    kind: r.kind,
    sourceType: r.source_type,
    sourceId: r.source_id,
    targetType: r.target_type,
    targetId: r.target_id,
    evidenceDocumentId: r.evidence_document_id,
    charStart: r.char_start,
    charEnd: r.char_end,
    snippet: r.snippet,
  };
}

const idList = (rows: Array<{ id: number }>) => rows.map((r) => r.id);

/**
 * Build the traceability subgraph for one system.
 * Returns `{ system: null, nodes: [], edges: [] }` when the system id doesn't exist.
 */
export async function getSystemGraph(systemId: number): Promise<SystemGraph> {
  const [system] = (await rawSql`
    SELECT id, label FROM systems WHERE id = ${systemId}::int
  `) as Array<{ id: number; label: string }>;
  if (!system) return { system: null, nodes: [], edges: [] };

  // --- Walk the structural layers (each filtered to active edges) ---
  const features = (await rawSql`
    SELECT f.id, f.label FROM features f
    JOIN edges e ON e.active AND e.relation_type = 'PART_OF'
      AND e.source_type = 'Feature' AND e.source_id = f.id
      AND e.target_type = 'System' AND e.target_id = ${systemId}::int
    ORDER BY f.id
  `) as Array<{ id: number; label: string }>;
  const featureIds = idList(features);

  const reqs = featureIds.length
    ? ((await rawSql`
        SELECT DISTINCT r.id, r.label FROM requirements r
        JOIN edges e ON e.active AND e.relation_type = 'SPECIFIES'
          AND e.source_type = 'Requirement' AND e.source_id = r.id
          AND e.target_type = 'Feature' AND e.target_id = ANY(${featureIds}::int[])
        ORDER BY r.id
      `) as Array<{ id: number; label: string }>)
    : [];
  const reqIds = idList(reqs);

  const svcs = reqIds.length
    ? ((await rawSql`
        SELECT DISTINCT s.id, s.label FROM services s
        JOIN edges e ON e.active AND e.relation_type = 'IMPLEMENTS'
          AND e.source_type = 'Service' AND e.source_id = s.id
          AND e.target_type = 'Requirement' AND e.target_id = ANY(${reqIds}::int[])
        ORDER BY s.id
      `) as Array<{ id: number; label: string }>)
    : [];
  const svcIds = idList(svcs);

  const datastores = svcIds.length
    ? ((await rawSql`
        SELECT DISTINCT ds.id, ds.label FROM datastores ds
        JOIN edges e ON e.active AND e.relation_type = 'USES'
          AND e.source_type = 'Service' AND e.source_id = ANY(${svcIds}::int[])
          AND e.target_type = 'Datastore' AND e.target_id = ds.id
        ORDER BY ds.id
      `) as Array<{ id: number; label: string }>)
    : [];

  const testNodes = reqIds.length
    ? ((await rawSql`
        SELECT DISTINCT t.id, t.label FROM tests t
        JOIN edges e ON e.active AND e.relation_type = 'VERIFIES'
          AND e.source_type = 'Test' AND e.source_id = t.id
          AND e.target_type = 'Requirement' AND e.target_id = ANY(${reqIds}::int[])
        ORDER BY t.id
      `) as Array<{ id: number; label: string }>)
    : [];

  const loadTests = reqIds.length
    ? ((await rawSql`
        SELECT DISTINCT l.id, l.label FROM load_test_results l
        JOIN edges e ON e.active AND e.relation_type = 'VALIDATES'
          AND e.source_type = 'LoadTestResult' AND e.source_id = l.id
          AND e.target_type = 'Requirement' AND e.target_id = ANY(${reqIds}::int[])
        ORDER BY l.id
      `) as Array<{ id: number; label: string }>)
    : [];

  const owners = svcIds.length
    ? ((await rawSql`
        SELECT DISTINCT p.id, p.label FROM persons p
        JOIN edges e ON e.active AND e.relation_type = 'OWNS'
          AND e.source_type = 'Person' AND e.source_id = p.id
          AND e.target_type = 'Service' AND e.target_id = ANY(${svcIds}::int[])
        ORDER BY p.id
      `) as Array<{ id: number; label: string }>)
    : [];

  const decisions = svcIds.length
    ? ((await rawSql`
        SELECT DISTINCT d.id, d.label FROM decisions d
        JOIN edges e ON e.active AND e.relation_type = 'AFFECTS'
          AND e.source_type = 'Decision' AND e.source_id = d.id
          AND e.target_type = 'Service' AND e.target_id = ANY(${svcIds}::int[])
        ORDER BY d.id
      `) as Array<{ id: number; label: string }>)
    : [];

  // --- Collect the edges that connect nodes within the subgraph (active only) ---
  const edgeRows = (await rawSql`
    SELECT * FROM edges e WHERE e.active AND (
      (e.relation_type = 'PART_OF'    AND e.target_type = 'System'      AND e.target_id = ${systemId}::int
                                      AND e.source_type = 'Feature'     AND e.source_id = ANY(${featureIds}::int[]))
      OR (e.relation_type = 'SPECIFIES'  AND e.target_type = 'Feature'     AND e.target_id = ANY(${featureIds}::int[])
                                         AND e.source_type = 'Requirement' AND e.source_id = ANY(${reqIds}::int[]))
      OR (e.relation_type = 'IMPLEMENTS' AND e.target_type = 'Requirement' AND e.target_id = ANY(${reqIds}::int[])
                                         AND e.source_type = 'Service'     AND e.source_id = ANY(${svcIds}::int[]))
      OR (e.relation_type = 'USES'       AND e.source_type = 'Service'     AND e.source_id = ANY(${svcIds}::int[])
                                         AND e.target_type = 'Datastore')
      OR (e.relation_type = 'VERIFIES'   AND e.target_type = 'Requirement' AND e.target_id = ANY(${reqIds}::int[])
                                         AND e.source_type = 'Test')
      OR (e.relation_type = 'VALIDATES'  AND e.target_type = 'Requirement' AND e.target_id = ANY(${reqIds}::int[])
                                         AND e.source_type = 'LoadTestResult')
      OR (e.relation_type = 'OWNS'       AND e.target_type = 'Service'     AND e.target_id = ANY(${svcIds}::int[])
                                         AND e.source_type = 'Person')
      OR (e.relation_type = 'AFFECTS'    AND e.target_type = 'Service'     AND e.target_id = ANY(${svcIds}::int[])
                                         AND e.source_type = 'Decision')
      OR (e.relation_type = 'DEPENDS_ON' AND e.source_type = 'Service'     AND e.source_id = ANY(${svcIds}::int[])
                                         AND e.target_type = 'Service'     AND e.target_id = ANY(${svcIds}::int[]))
    )
    ORDER BY e.id
  `) as Record<string, any>[];

  // --- Overlay coverage flags from Q1 / Q2 (the deterministic CQ layer) ---
  const noTestReqIds = new Set<number>();
  const { rows: q1Rows } = await runCQ("requirements_without_test", {});
  for (const r of q1Rows as Array<{ id: number }>) noTestReqIds.add(r.id);

  const gapByService = new Map<number, { noDesignDoc: boolean; noLoadTest: boolean }>();
  const { rows: q2Rows } = await runCQ("services_coverage_gaps", {});
  for (const r of q2Rows as Array<{ id: number; noDesignDoc: boolean; noLoadTest: boolean }>) {
    gapByService.set(r.id, { noDesignDoc: r.noDesignDoc, noLoadTest: r.noLoadTest });
  }

  // --- Assemble the node list, applying flags where they belong ---
  const nodes: GraphNode[] = [
    { type: "System", id: system.id, label: system.label },
    ...features.map((f) => ({ type: "Feature" as const, id: f.id, label: f.label })),
    ...reqs.map((r) => ({
      type: "Requirement" as const,
      id: r.id,
      label: r.label,
      ...(noTestReqIds.has(r.id) ? { flags: { noTest: true } } : {}),
    })),
    ...svcs.map((s) => {
      const gap = gapByService.get(s.id);
      const flags: NodeFlags = {};
      if (gap?.noDesignDoc) flags.noDesignDoc = true;
      if (gap?.noLoadTest) flags.noLoadTest = true;
      return {
        type: "Service" as const,
        id: s.id,
        label: s.label,
        ...(Object.keys(flags).length ? { flags } : {}),
      };
    }),
    ...datastores.map((d) => ({ type: "Datastore" as const, id: d.id, label: d.label })),
    ...testNodes.map((t) => ({ type: "Test" as const, id: t.id, label: t.label })),
    ...loadTests.map((l) => ({ type: "LoadTestResult" as const, id: l.id, label: l.label })),
    ...owners.map((p) => ({ type: "Person" as const, id: p.id, label: p.label })),
    ...decisions.map((d) => ({ type: "Decision" as const, id: d.id, label: d.label })),
  ];

  return { system, nodes, edges: edgeRows.map(toGraphEdge) };
}
