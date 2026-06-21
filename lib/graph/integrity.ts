import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  chunks,
  systems,
  features,
  requirements,
  services,
  datastores,
  tests,
  loadTestResults,
  decisions,
  persons,
} from "@/lib/db/schema";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software";

// Design spec §5c.4 — Polymorphic edge integrity invariant.
// Every active edge's (sourceType, sourceId) and (targetType, targetId) must resolve to a live
// row in the table named by the *_type: entity types via SOFTWARE_PACKAGE.entityTypes (type→table),
// plus the special source type "chunk" (MENTIONS edges) → the chunks table.

// Map the package's table name (entityTypes[].table) → its drizzle table object (each has id + label).
const TABLE_BY_NAME = {
  systems,
  features,
  requirements,
  services,
  datastores,
  tests,
  load_test_results: loadTestResults,
  decisions,
  persons,
} as const;

type TypedTable = (typeof TABLE_BY_NAME)[keyof typeof TABLE_BY_NAME] | typeof chunks;

// type name (as stored in edges.*_type) → drizzle table. Built from the package registry so a new
// entity type is a config row, not a code change here; the special "chunk" type is added explicitly.
const TABLE_BY_TYPE: Record<string, TypedTable> = (() => {
  const m: Record<string, TypedTable> = { chunk: chunks };
  for (const e of SOFTWARE_PACKAGE.entityTypes) {
    const table = TABLE_BY_NAME[e.table as keyof typeof TABLE_BY_NAME];
    if (table) m[e.type] = table;
  }
  return m;
})();

export type EdgeEndpoints = {
  id: number;
  sourceType: string;
  sourceId: number;
  targetType: string;
  targetId: number;
};

export type IntegrityViolation = {
  edgeId: number;
  endpoint: "source" | "target";
  type: string;
  refId: number;
  // "unknown_type" if the *_type names no known table; "dangling" if the row doesn't exist.
  reason: "unknown_type" | "dangling";
};

// Verify each given edge's endpoints resolve to a live row in the table named by their *_type.
// Returns one violation per offending endpoint (empty array ⇒ the invariant holds for these edges).
// Resolves existence with a single batched SELECT per (type) set of ids — no row counts of shared
// tables, only membership of the specific ids referenced by the passed-in edges.
export async function checkEdgeIntegrity(edges: EdgeEndpoints[]): Promise<IntegrityViolation[]> {
  // Collect the ids we need to verify, grouped by type. Track unknown types as their own violations.
  const idsByType = new Map<string, Set<number>>();
  const violations: IntegrityViolation[] = [];

  const note = (edgeId: number, endpoint: "source" | "target", type: string, refId: number) => {
    const table = TABLE_BY_TYPE[type];
    if (!table) {
      violations.push({ edgeId, endpoint, type, refId, reason: "unknown_type" });
      return;
    }
    let set = idsByType.get(type);
    if (!set) idsByType.set(type, (set = new Set()));
    set.add(refId);
  };

  for (const e of edges) {
    note(e.id, "source", e.sourceType, e.sourceId);
    note(e.id, "target", e.targetType, e.targetId);
  }

  // For each type, fetch which of the referenced ids actually exist (one batched query per type).
  const liveByType = new Map<string, Set<number>>();
  for (const [type, ids] of idsByType) {
    const table = TABLE_BY_TYPE[type];
    const rows = (await db
      .select({ id: table.id })
      .from(table)
      .where(inArray(table.id, Array.from(ids)))) as Array<{ id: number }>;
    liveByType.set(type, new Set(rows.map((r) => r.id)));
  }

  // Flag any endpoint whose id isn't live.
  const isLive = (type: string, id: number) => liveByType.get(type)?.has(id) ?? false;
  for (const e of edges) {
    if (TABLE_BY_TYPE[e.sourceType] && !isLive(e.sourceType, e.sourceId)) {
      violations.push({ edgeId: e.id, endpoint: "source", type: e.sourceType, refId: e.sourceId, reason: "dangling" });
    }
    if (TABLE_BY_TYPE[e.targetType] && !isLive(e.targetType, e.targetId)) {
      violations.push({ edgeId: e.id, endpoint: "target", type: e.targetType, refId: e.targetId, reason: "dangling" });
    }
  }

  return violations;
}
