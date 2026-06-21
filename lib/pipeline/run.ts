import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documents,
  attributeProvenance,
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

// Link stage: link every canonical entity of this doc to the rest of the graph.
// Derive the doc's entities the same way resolve does — DISTINCT (entity_type, entity_id) from
// attribute_provenance for this doc — fetch each label (entity_index, falling back to the typed
// table), then call linkEntity once per entity. Order-independent + idempotent by linkEntity's
// contract, so this is safe to re-run.
async function linkStage(documentId: number): Promise<void> {
  const rows = await db
    .selectDistinct({ entityType: attributeProvenance.entityType, entityId: attributeProvenance.entityId })
    .from(attributeProvenance)
    .where(eq(attributeProvenance.documentId, documentId));

  for (const { entityType, entityId } of rows) {
    const [idx] = await db
      .select({ label: entityIndex.label })
      .from(entityIndex)
      .where(and(eq(entityIndex.entityType, entityType), eq(entityIndex.entityId, entityId)));

    let label = idx?.label;
    if (label === undefined) {
      const table = TABLES_BY_TYPE[entityType as keyof typeof TABLES_BY_TYPE];
      if (!table) continue; // unknown type → nothing to link
      const [row] = await db.select({ label: table.label }).from(table).where(eq(table.id, entityId));
      if (!row) continue; // entity merged away → skip
      label = row.label;
    }

    await linkEntity({ type: entityType, id: entityId, label }, documentId);
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
