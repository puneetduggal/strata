import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documents,
  edges,
  entityIndex,
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
import { classifyDoc } from "./classify";
import { indexDoc } from "./index";
import { extractDoc } from "./extract";
import { resolveDoc } from "./resolve";
import { linkEntity } from "./link";
import {
  nextStageForStatus,
  setStatus,
  markDoc,
  STAGE_TO_DONE_STATUS,
  type Stage,
} from "./jobs";

// Package type name → typed table (for the label fallback when an entity has no entity_index row).
const TABLES_BY_TYPE = {
  System: systems,
  Feature: features,
  Requirement: requirements,
  Service: services,
  Datastore: datastores,
  Test: tests,
  LoadTestResult: loadTestResults,
  Decision: decisions,
  Person: persons,
} as const;

// Resolve an entity's current label (entity_index first, typed-table fallback). Returns null when
// the entity has been merged away (no index row and no typed row).
async function labelOf(entityType: string, entityId: number): Promise<string | null> {
  const [idx] = await db
    .select({ label: entityIndex.label })
    .from(entityIndex)
    .where(and(eq(entityIndex.entityType, entityType), eq(entityIndex.entityId, entityId)));
  if (idx?.label !== undefined) return idx.label;

  const table = TABLES_BY_TYPE[entityType as keyof typeof TABLES_BY_TYPE];
  if (!table) return null; // unknown type → nothing to link
  const [row] = await db.select({ label: table.label }).from(table).where(eq(table.id, entityId));
  return row?.label ?? null; // null ⇒ entity merged away
}

// Entities MENTIONED in a doc = the distinct (targetType,targetId) of that doc's deterministic
// chunk —MENTIONS→ entity edges (evidence_document_id = documentId). This is the doc's full entity
// surface — broader than attribute_provenance (which is only entities the doc was the PRIMARY source
// for), so it lets the linker propose edges grounded in this doc between ANY entities it mentions.
async function mentionedEntities(documentId: number): Promise<Array<{ entityType: string; entityId: number }>> {
  const rows = await db
    .selectDistinct({ entityType: edges.targetType, entityId: edges.targetId })
    .from(edges)
    .where(and(eq(edges.relationType, "MENTIONS"), eq(edges.evidenceDocumentId, documentId)));
  return rows;
}

// Link stage: link every entity MENTIONED in this doc to the rest of the graph.
// We derive entities from the doc's MENTIONS edges (not just attribute_provenance) so an edge whose
// grounding lives in THIS doc can form even when only ONE endpoint was extracted here. linkEntity is
// order-independent + idempotent, so this is safe to re-run (see relinkAll).
async function linkStage(documentId: number): Promise<void> {
  for (const { entityType, entityId } of await mentionedEntities(documentId)) {
    const label = await labelOf(entityType, entityId);
    if (label === null) continue; // merged away / unknown type → skip
    await linkEntity({ type: entityType, id: entityId, label }, documentId);
  }
}

// Order-independent re-link sweep. Per-doc linking can only form an edge whose partner already
// exists when that doc is processed; a relation grounded in an EARLY doc between entities born in a
// LATER doc therefore never forms (e.g. AFFECTS is grounded in ADR-001 but auth-service is born in
// HLD). Run this ONCE after all docs are ingested: with the full graph present, re-run linking for
// every entity mentioned in every doc, grounding each candidate edge in the doc whose text supports
// it. linkEntity's idempotent upsert makes the re-run safe (existing edges are updated, not dupl'd).
//
// documentIds scopes the sweep (default: every document). The eval truncates first so the default is
// correct there; tests pass their own ids to stay isolated in the shared DB.
export async function relinkAll(documentIds?: number[]): Promise<void> {
  const ids = documentIds ?? (await db.select({ id: documents.id }).from(documents)).map((d) => d.id);
  for (const id of ids) {
    await linkStage(id);
  }
}

// Stage handlers. classify/index set documents.status themselves; extract/resolve/link rely on
// STAGE_TO_DONE_STATUS for the post-stage status.
const HANDLERS: Partial<Record<Stage, (documentId: number) => Promise<void>>> = {
  classify: classifyDoc,
  index: indexDoc,
  // extractDoc returns EntityRef[]; the orchestrator ignores the value, so wrap to Promise<void>.
  extract: async (documentId: number) => { await extractDoc(documentId); },
  resolve: resolveDoc,
  link: linkStage,
};

// Run the next pending stage for a document and return the resulting state.
// Idempotent per stage: the next stage is derived from documents.status, so re-running
// a doc whose status hasn't moved re-runs the same stage; once it advances, advance() moves on.
//
// Routing: classify + index run for EVERY doc (off-domain docs are still chunked + embedded
// so they are RAG-queryable substrate). The unrouted decision happens AFTER index: a doc whose
// domain isn't software_dev stops at "unrouted" (substrate only, no graph), while a software_dev
// doc proceeds into the graph stages (extract/resolve/link).
export async function advance(documentId: number): Promise<{ stage: string; status: string }> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Error(`advance: document ${documentId} not found`);

  // Terminal states: unrouted has finished routing; failed/ready/done stop here.
  if (doc.status === "unrouted") return { stage: "done", status: "unrouted" };

  // After index, route off-domain docs to "unrouted" (substrate only — skip the graph stages).
  // This runs BEFORE deriving the next stage so non-software docs never enter extract.
  if (doc.status === "indexed" && doc.domain !== "software_dev") {
    await markDoc(documentId, "unrouted");
    return { stage: "done", status: "unrouted" };
  }

  const stage = nextStageForStatus(doc.status);
  if (!stage || stage === "done") return { stage: "done", status: doc.status };

  const handler = HANDLERS[stage];
  if (!handler) {
    // Stage exists in the pipeline but has no handler — leave the doc where it is.
    return { stage, status: doc.status };
  }

  await setStatus(documentId, stage, "running");
  try {
    await handler(documentId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markDoc(documentId, "failed");
    await setStatus(documentId, stage, "failed", message);
    return { stage, status: "failed" };
  }

  // Re-read status and apply the stage's done-status (handlers may set it themselves).
  const [updated] = await db.select().from(documents).where(eq(documents.id, documentId));
  const doneStatus = STAGE_TO_DONE_STATUS[stage];
  if (doneStatus && updated.status !== doneStatus) await markDoc(documentId, doneStatus);
  await setStatus(documentId, stage, "completed");
  return { stage, status: doneStatus ?? updated.status };
}
