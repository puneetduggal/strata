import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { classifyDoc } from "./classify";
import { indexDoc } from "./index";
import {
  nextStageForStatus,
  setStatus,
  markDoc,
  STAGE_TO_DONE_STATUS,
  type Stage,
} from "./jobs";

// Stage handlers implemented so far. classify/index set documents.status themselves.
const HANDLERS: Partial<Record<Stage, (documentId: number) => Promise<void>>> = {
  classify: classifyDoc,
  index: indexDoc,
};

// Run the next pending stage for a document and return the resulting state.
// Idempotent per stage: the next stage is derived from documents.status, so re-running
// a doc whose status hasn't moved re-runs the same stage; once it advances, advance() moves on.
export async function advance(documentId: number): Promise<{ stage: string; status: string }> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Error(`advance: document ${documentId} not found`);

  // Terminal states: unrouted short-circuits remaining stages; failed/ready/done stop here.
  if (doc.status === "unrouted") return { stage: "done", status: "unrouted" };

  const stage = nextStageForStatus(doc.status);
  if (!stage || stage === "done") return { stage: "done", status: doc.status };

  const handler = HANDLERS[stage];
  if (!handler) {
    // Stage exists in the pipeline but isn't implemented yet (extract/resolve/link).
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

  // Re-read status: classify may have set "unrouted"; otherwise apply the stage's done-status.
  const [updated] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (updated.status === "unrouted") {
    await setStatus(documentId, stage, "completed");
    return { stage, status: "unrouted" };
  }

  const doneStatus = STAGE_TO_DONE_STATUS[stage];
  if (doneStatus && updated.status !== doneStatus) await markDoc(documentId, doneStatus);
  await setStatus(documentId, stage, "completed");
  return { stage, status: doneStatus ?? updated.status };
}
