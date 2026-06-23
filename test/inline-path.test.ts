import { expect, test } from "vitest";
import { buildInlinePath, type EdgeRef } from "@/lib/query/ask-path";

// buildInlinePath orders a set of EdgeRefs into a single source→target chain when (and only when)
// they form one. It's the pure helper behind the inline graph path in the answer card.

function edge(
  id: number,
  sourceId: number,
  targetId: number,
  relationType = "DEPENDS_ON",
  kind: string | null = null,
): EdgeRef {
  return {
    id,
    relationType,
    kind,
    sourceType: "Service",
    sourceId,
    targetType: "Service",
    targetId,
    evidenceDocumentId: null,
    charStart: null,
    charEnd: null,
    snippet: null,
  };
}

test("chains edges source→target; last node is the focal node", () => {
  // payment(3) → auth(2) → token(1)
  const path = buildInlinePath([edge(10, 2, 1), edge(11, 3, 2)]);
  expect(path).not.toBeNull();
  expect(path!.nodes.map((n) => n.id)).toEqual([3, 2, 1]);
  expect(path!.steps).toHaveLength(2);
  expect(path!.nodes[path!.nodes.length - 1].id).toBe(1); // focal = terminus
});

test("returns null for a single edge (no chain to draw)", () => {
  expect(buildInlinePath([edge(10, 2, 1)])).toBeNull();
});

test("returns null when edges branch (not a simple chain)", () => {
  // auth(2) → token(1) AND auth(2) → db(4): two out-edges from the same node.
  expect(buildInlinePath([edge(10, 2, 1), edge(11, 2, 4)])).toBeNull();
});

test("returns null when edges are disconnected", () => {
  // 2→1 and 5→4 share no node — two separate components.
  expect(buildInlinePath([edge(10, 2, 1), edge(11, 5, 4)])).toBeNull();
});

test("returns null on a cycle", () => {
  // 1→2→3→1
  expect(buildInlinePath([edge(10, 1, 2), edge(11, 2, 3), edge(12, 3, 1)])).toBeNull();
});
