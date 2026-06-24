import "dotenv/config";
// Task 20 — LIVE eval harness (Helios entry).
//
// Runs the REAL pipeline (live Claude + Voyage) over fixtures/software-bundle/*, then scores the
// resulting graph + CQ answers against fixtures/labels.json (ground truth). Opt-in:
//   EVAL=live pnpm tsx test/eval/harness.ts
// Without EVAL=live it prints a notice and exits 0 (CI determinism via record/replay is a later
// task — this is the dedicated manual eval that runs against the live APIs).
//
// It TRUNCATEs the knowledge tables first so metrics are measured on exactly the fixture bundle
// (and leaves a clean, demo-ready graph behind). Then for each file: extractText -> insert
// document -> advance() to a terminal status. Finally it computes the scorecard and prints it.
//
// The reusable scoring/ingest internals live in ./scorers (shared with the Meridian stress
// harness). This file just wires a Helios EvalConfig into them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rawSql } from "@/lib/db/client";
import { relinkAll } from "@/lib/pipeline/run";
import { formatScorecard, type Scorecard } from "./scorecard";
import {
  truncateAll,
  ingestBundle,
  scoreAll,
  type Labels,
  type LinkCase,
  type EvalConfig,
} from "./scorers";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");

// A few labeled mentions that exercise lexical + semantic linking (paraphrases grounded in the
// fixture text), each expecting a specific canonical entity as the top hit.
const HELIOS_LINK_CASES: LinkCase[] = [
  { mention: "login system", type: "Service", expectedLabel: "auth-service" },
  { mention: "sign-in service", type: "Service", expectedLabel: "auth-service" },
  { mention: "session token minting service", type: "Service", expectedLabel: "token-service" },
  { mention: "user database", type: "Datastore", expectedLabel: "user-db" },
  { mention: "authentication feature", type: "Feature", expectedLabel: "User Authentication" },
  { mention: "JWT decision", type: "Decision", expectedLabel: "ADR-001" },
];

const cfg: EvalConfig = {
  bundleDir: path.join(ROOT, "fixtures", "software-bundle"),
  labelsPath: path.join(ROOT, "fixtures", "labels.json"),
  accept: (f) => f.endsWith(".txt"),
  mime: "text/plain",
  linkCases: HELIOS_LINK_CASES,
};

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

// ---------------------------------------------------------------------------
// 0. Entry guard
// ---------------------------------------------------------------------------
if (process.env.EVAL !== "live") {
  log("[eval] EVAL!=live — skipping the LIVE eval harness (set EVAL=live to run against the real APIs). Exit 0.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const labels = JSON.parse(fs.readFileSync(cfg.labelsPath, "utf8")) as Labels;

  log("[eval] === STRATA LIVE EVAL (Task 20) ===");
  await truncateAll();
  await ingestBundle(cfg);

  // Order-independent re-link sweep: with all docs now ingested, re-run linking over the full graph
  // so relations grounded in an early doc between entities born later (e.g. AFFECTS, DEPENDS_ON,
  // IMPLEMENTS) form regardless of ingest order. Idempotent, so this only adds the missing edges.
  log("[eval] re-linking across the full graph (order-independent sweep)...");
  await relinkAll();

  log("[eval] computing scorecard...");
  const sc: Scorecard = await scoreAll(cfg, labels);
  log(formatScorecard(sc));

  log(`LINK_THRESHOLD=${sc.links.chosen.toFixed(2)}`);
}

main()
  .then(async () => {
    await rawSql.end();
    process.exit(0);
  })
  .catch(async (err) => {
    log(`[eval] FATAL: ${err instanceof Error ? err.stack : String(err)}`);
    try { await rawSql.end(); } catch {}
    process.exit(1);
  });
