// Pure helper behind the inline graph path in the Ask answer card (catalog 04 §3c). Ordering the
// EdgeRef provenance into a single source→target chain is the one bit of real logic in an
// otherwise presentational reskin, so it lives here as a plain module the component re-exports and
// a focused unit test imports (the .tsx component can't be transformed by the test runner).

export type EdgeRef = {
  id: number;
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

// A single graph node identity as it appears on an edge endpoint. The API returns no labels, so we
// key on `${type}#${id}` and the renderer shows that as the chip text.
export type PathNode = { type: string; id: number };
export const nodeKey = (n: PathNode) => `${n.type}#${n.id}`;
export const nodeLabel = (n: PathNode) => `${n.type} #${n.id}`;

export type PathStep = { relationType: string; kind: string | null };
export type InlinePath = { nodes: PathNode[]; steps: PathStep[] } | null;

// buildInlinePath — order EdgeRefs into a single source→target chain, if they form one.
// Returns null when the edges don't chain (a single edge / branching / disconnected / cyclic), in
// which case only the contributing-edge cards render. When they chain, the LAST node is the focal
// node (the entity the question is about) and is accent-highlighted by the renderer.
export function buildInlinePath(edges: EdgeRef[]): InlinePath {
  if (edges.length < 2) return null;

  const srcOf = (e: EdgeRef): PathNode => ({ type: e.sourceType, id: e.sourceId });
  const tgtOf = (e: EdgeRef): PathNode => ({ type: e.targetType, id: e.targetId });

  // Index out-edges by node and track in/out degree to find a unique chain head.
  const outBy = new Map<string, EdgeRef>();
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const e of edges) {
    const s = nodeKey(srcOf(e));
    const t = nodeKey(tgtOf(e));
    if (outBy.has(s)) return null; // branch on source — not a simple chain
    outBy.set(s, e);
    outDeg.set(s, (outDeg.get(s) ?? 0) + 1);
    inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
    if ((inDeg.get(t) ?? 0) > 1) return null; // branch on target
  }

  const heads = [...outDeg.keys()].filter((k) => (inDeg.get(k) ?? 0) === 0);
  if (heads.length !== 1) return null; // not exactly one start → not a simple chain

  const nodes: PathNode[] = [];
  const steps: PathStep[] = [];
  const seen = new Set<string>();
  let cur: PathNode | undefined = srcOf(outBy.get(heads[0])!);

  while (cur) {
    const key = nodeKey(cur);
    if (seen.has(key)) return null; // cycle → bail
    seen.add(key);
    nodes.push(cur);
    const e = outBy.get(key);
    if (!e) break;
    steps.push({ relationType: e.relationType, kind: e.kind });
    cur = tgtOf(e);
  }

  // Every edge must have been consumed for the chain to represent the whole provenance.
  if (steps.length !== edges.length) return null;
  return { nodes, steps };
}
