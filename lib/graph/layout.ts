import type { GraphNode, GraphNodeType } from "@/lib/query/graph";

// Deterministic radial "star" layout for the traceability canvas (catalog 03-graph §4.2).
//
// The graph reads as left-to-right concentric columns of increasing depth: System (anchor) →
// Features → Requirements → Services → Leaves, with Decision/Person hanging off as satellites.
// We assign each node a column `x` (a percentage 0–100 of the canvas width, from the catalog's
// left% table) and spread the nodes that share a column down a vertical band so none overlap.
//
// Output is keyed `${type}#${id}` and is a pure function of the input (sorted by type+id), so the
// SVG edge layer (authored in viewBox units) and the absolutely-%-positioned node chips agree by
// ratio. Data-driven: it positions whatever nodes are present, not just the Helios demo.

export type Point = { x: number; y: number };

// Column left% per entity type (catalog §4.2). The three leaf types share the leaf column;
// Decision/Person are satellites sitting over the service / leaf columns respectively.
export const COLUMN_LEFT: Record<GraphNodeType, number> = {
  System: 8.9,
  Feature: 24.4,
  Requirement: 41.7,
  Service: 61.1,
  Datastore: 84.4,
  Test: 84.4,
  LoadTestResult: 84.4,
  Decision: 61.1, // satellite over the service column
  Person: 84.4, // satellite over the leaf column
};

// Which logical column a type belongs to (leaves collapse into one shared column so they stack
// together rather than tripling up at the same x).
const COLUMN_OF: Record<GraphNodeType, string> = {
  System: "system",
  Feature: "feature",
  Requirement: "requirement",
  Service: "service",
  Datastore: "leaf",
  Test: "leaf",
  LoadTestResult: "leaf",
  Decision: "decision",
  Person: "person",
};

// Vertical band each column distributes its nodes across (top%..bottom% of the canvas height).
// The main spine fills a wide band; satellites take narrower off-ring bands (Decision floats high,
// Person sits low) so they read as hanging off the structure rather than being part of a ring.
const BAND: Record<string, { top: number; bottom: number }> = {
  system: { top: 57.4, bottom: 57.4 }, // single anchor, centred
  feature: { top: 32, bottom: 91 },
  requirement: { top: 15, bottom: 91 },
  service: { top: 26, bottom: 91 },
  leaf: { top: 15, bottom: 91 },
  decision: { top: 9.6, bottom: 30 }, // satellite, upper band
  person: { top: 52, bottom: 66 }, // satellite, lower band
};

const COLUMN_ORDER = [
  "system",
  "decision",
  "feature",
  "requirement",
  "service",
  "leaf",
  "person",
];

// Deterministic sort: by the type's column order, then numeric id. Independent of input order.
function sortNodes(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => {
    const ca = COLUMN_ORDER.indexOf(COLUMN_OF[a.type]);
    const cb = COLUMN_ORDER.indexOf(COLUMN_OF[b.type]);
    if (ca !== cb) return ca - cb;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.id - b.id;
  });
}

/**
 * Position every node on the canvas. Returns a Map keyed `${type}#${id}` → {x,y} percentages.
 * Deterministic for a given set of nodes (input order does not matter).
 */
export function layoutGraph(nodes: GraphNode[]): Map<string, Point> {
  // Bucket nodes into their logical column, in deterministic order.
  const buckets = new Map<string, GraphNode[]>();
  for (const node of sortNodes(nodes)) {
    const col = COLUMN_OF[node.type];
    (buckets.get(col) ?? buckets.set(col, []).get(col)!).push(node);
  }

  const pos = new Map<string, Point>();
  for (const [col, members] of buckets) {
    const { top, bottom } = BAND[col];
    members.forEach((node, i) => {
      // Evenly distribute across the band; a single member sits at the band's midpoint.
      const y =
        members.length === 1 ? (top + bottom) / 2 : top + (i * (bottom - top)) / (members.length - 1);
      pos.set(`${node.type}#${node.id}`, { x: COLUMN_LEFT[node.type], y });
    });
  }
  return pos;
}
