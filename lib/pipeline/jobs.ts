import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents, jobs } from "@/lib/db/schema";

// Pipeline stages, in order. `ingest` happens at upload; the rest are run by advance().
export const STAGES = ["ingest", "classify", "index", "extract", "resolve", "link", "done"] as const;
export type Stage = (typeof STAGES)[number];

// documents.status vocabulary (design spec)
export type DocStatus =
  | "ingested" | "classified" | "indexed" | "extracted" | "resolved" | "linked"
  | "ready" | "failed" | "unrouted";

// The stage to run next given a doc's current status. A freshly-ingested doc → classify.
const STATUS_TO_NEXT_STAGE: Record<string, Stage> = {
  ingested: "classify",
  classified: "index",
  indexed: "extract",
  extracted: "resolve",
  resolved: "link",
  linked: "done",
};

// The status to set after a stage completes successfully.
export const STAGE_TO_DONE_STATUS: Partial<Record<Stage, DocStatus>> = {
  classify: "classified",
  index: "indexed",
  extract: "extracted",
  resolve: "resolved",
  link: "linked",
};

export function nextStage(current: Stage): Stage {
  const i = STAGES.indexOf(current);
  return STAGES[Math.min(i + 1, STAGES.length - 1)];
}

export function nextStageForStatus(status: string): Stage | null {
  return STATUS_TO_NEXT_STAGE[status] ?? null;
}

export type JobStatus = "pending" | "running" | "completed" | "failed";

export async function setStatus(documentId: number, stage: Stage, status: JobStatus, error?: string): Promise<void> {
  await db.insert(jobs).values({ documentId, stage, status, error: error ?? null });
}

export async function markDoc(documentId: number, status: DocStatus): Promise<void> {
  await db.update(documents).set({ status }).where(eq(documents.id, documentId));
}
