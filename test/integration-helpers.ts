// Shared, non-hoisted helpers for the integration suites (Task 21's integration.test.ts and Task 22's
// provenance-integrity.test.ts). The `vi.mock(...)` seams are HOISTED per-file and CANNOT live here, so
// each test file keeps a small mock block whose factory delegates to `canonicalizeUser` + `recordReplay`.
// Everything else (the ingest loop, the truncate SQL, the bundle/labels paths) is identical across both
// consumers and lives here once.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, rawSql } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { extractText } from "@/lib/ingest/extract-text";
import { advance } from "@/lib/pipeline/run";

export const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
export const BUNDLE_DIR = path.join(ROOT, "fixtures", "software-bundle");
export const LABELS_PATH = path.join(ROOT, "fixtures", "labels.json");

// Canonicalize a prompt before hashing so the cassette key is invariant to the ONE volatile input
// in the pipeline's LLM prompts: the link stage lists candidate-partner entities via an unordered
// `SELECT ... FROM entity_index`, so Postgres heap order (affected by resolve-stage UPDATEs / vacuum)
// can reorder those lines run-to-run for the SAME logical graph. The model's answer (the set of
// proposed edges) does not depend on that ordering, so sorting the contiguous run of partner lines
// (`- (Type) label`) maps every ordering to one stable cassette entry — deterministic offline replay
// without touching pipeline code. (All other prompts are pure functions of doc text and are unaffected.)
export function canonicalizeUser(user: string): string {
  const lines = user.split("\n");
  const isPartner = (l: string) => /^- \([^)]+\) /.test(l);
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (isPartner(lines[i])) {
      let j = i;
      while (j < lines.length && isPartner(lines[j])) j++;
      out.push(...lines.slice(i, j).sort());
      i = j;
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n");
}

// Truncate the shared knowledge/substrate tables so GLOBAL answers reflect exactly the ingested bundle
// (same set as the eval harness's truncateAll). Isolated to the serial integration config.
export async function truncateKnowledge(): Promise<void> {
  await rawSql`
    TRUNCATE TABLE
      documents, chunks,
      systems, features, requirements, services, datastores, tests, load_test_results, decisions, persons,
      edges, attribute_provenance, entity_index, jobs
    RESTART IDENTITY
  `;
}

// Ingest one file through the full pipeline to a terminal status (mirrors the harness loop).
export async function ingestFile(file: string): Promise<{ id: number; status: string }> {
  const buf = fs.readFileSync(path.join(BUNDLE_DIR, file));
  const { rawText } = await extractText(buf, "text/plain");
  const [doc] = await db
    .insert(documents)
    .values({ filename: file, mimeType: "text/plain", rawText, status: "ingested" })
    .returning();
  let prev = "";
  let status = "";
  for (let i = 0; i < 12; i++) {
    const res = await advance(doc.id);
    status = res.status;
    if (status === prev) break;
    prev = status;
    if (status === "ready" || status === "failed" || status === "unrouted") break;
  }
  return { id: doc.id, status };
}
