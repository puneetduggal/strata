import { describe, expect, it } from "vitest";
import { layoutGraph, COLUMN_LEFT } from "@/lib/graph/layout";
import type { GraphNode } from "@/lib/query/graph";

// A tiny GraphNode factory — layout only reads `type` + `id`.
const n = (type: GraphNode["type"], id: number): GraphNode => ({ type, id, label: `${type}-${id}` });

const key = (node: GraphNode) => `${node.type}#${node.id}`;

// The Helios-shaped reference set (system 1) drives the column assertions.
const helios: GraphNode[] = [
  n("System", 1),
  n("Feature", 1),
  n("Feature", 2),
  n("Requirement", 1),
  n("Requirement", 2),
  n("Requirement", 3),
  n("Requirement", 4),
  n("Service", 1),
  n("Service", 6),
  n("Datastore", 1),
  n("Test", 1),
  n("Test", 2),
  n("LoadTestResult", 1),
  n("Person", 1),
  n("Decision", 1),
];

describe("layoutGraph", () => {
  it("keys every positioned node by `${type}#${id}` and positions all of them", () => {
    const pos = layoutGraph(helios);
    expect(pos.size).toBe(helios.length);
    for (const node of helios) expect(pos.has(key(node))).toBe(true);
  });

  it("places the System at the leftmost column (8.9%)", () => {
    const pos = layoutGraph(helios);
    const sys = pos.get("System#1")!;
    expect(sys.x).toBeCloseTo(COLUMN_LEFT.System, 5);
    // It is strictly left of every other entity column.
    for (const [k, p] of pos) {
      if (k === "System#1") continue;
      expect(sys.x).toBeLessThan(p.x);
    }
  });

  it("lands each entity ring at its catalog column left% (System 8.9 → Feature 24.4 → Req 41.7 → Service 61.1 → Leaf 84.4)", () => {
    const pos = layoutGraph(helios);
    expect(pos.get("System#1")!.x).toBeCloseTo(8.9, 5);
    expect(pos.get("Feature#1")!.x).toBeCloseTo(24.4, 5);
    expect(pos.get("Feature#2")!.x).toBeCloseTo(24.4, 5);
    expect(pos.get("Requirement#1")!.x).toBeCloseTo(41.7, 5);
    expect(pos.get("Requirement#4")!.x).toBeCloseTo(41.7, 5);
    expect(pos.get("Service#1")!.x).toBeCloseTo(61.1, 5);
    // The three leaf types share the leaf column.
    expect(pos.get("Datastore#1")!.x).toBeCloseTo(84.4, 5);
    expect(pos.get("Test#1")!.x).toBeCloseTo(84.4, 5);
    expect(pos.get("LoadTestResult#1")!.x).toBeCloseTo(84.4, 5);
  });

  it("spreads multiple nodes in one ring to distinct, non-overlapping y positions", () => {
    const pos = layoutGraph(helios);
    const reqYs = [1, 2, 3, 4].map((id) => pos.get(`Requirement#${id}`)!.y);
    const unique = new Set(reqYs);
    expect(unique.size).toBe(4); // all distinct
    const sorted = [...reqYs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(8); // a real gap, no overlap
    }
    // y values stay within the canvas band.
    for (const y of reqYs) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(100);
    }
  });

  it("places Decision and Person off-ring as satellites", () => {
    const pos = layoutGraph(helios);
    // Decision satellites float over the service column; Person satellites over the leaf column.
    expect(pos.get("Decision#1")!.x).toBeCloseTo(COLUMN_LEFT.Decision, 5);
    expect(pos.get("Person#1")!.x).toBeCloseTo(COLUMN_LEFT.Person, 5);
    // The Decision satellite floats in the upper band.
    expect(pos.get("Decision#1")!.y).toBeLessThan(40);
  });

  it("is deterministic — same input yields identical output", () => {
    const a = layoutGraph(helios);
    const b = layoutGraph(helios);
    expect([...a.entries()]).toEqual([...b.entries()]);
    // Order of the input array must not change the assigned positions (sorted by id internally).
    const shuffled = [...helios].reverse();
    const c = layoutGraph(shuffled);
    for (const node of helios) {
      expect(c.get(key(node))).toEqual(a.get(key(node)));
    }
  });

  it("generalizes beyond Helios: a lone System still lands at its column, no satellites needed", () => {
    const pos = layoutGraph([n("System", 99)]);
    expect(pos.size).toBe(1);
    expect(pos.get("System#99")!.x).toBeCloseTo(8.9, 5);
  });
});
