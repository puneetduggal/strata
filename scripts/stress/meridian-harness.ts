import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rawSql } from "@/lib/db/client";
import { relinkAll } from "@/lib/pipeline/run";
import { runCQ } from "@/lib/query/templates";
import { checkEdgeIntegrity, type EdgeEndpoints } from "@/lib/graph/integrity";
import { locateSpan } from "@/lib/provenance/locate";
import { formatScorecard } from "../../test/eval/scorecard";
import {
  truncateAll, ingestBundle, scoreAll, idByLabel,
  type Labels, type LinkCase, type EvalConfig,
} from "../../test/eval/scorers";
import { buildMatrix, renderReport, type IntegrityResult, type MatrixInputs } from "./meridian-report";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const FIX = path.join(ROOT, "fixtures", "meridian");
const REPORT = path.join(ROOT, "stress-report.md");
const log = (m: string) => process.stdout.write(m + "\n");

const MERIDIAN_LINK_CASES: LinkCase[] = [
  { mention: "the login / auth service", type: "Service", expectedLabel: "identity-service" },
  { mention: "order lifecycle service", type: "Service", expectedLabel: "order-service" },
  { mention: "the orders database", type: "Datastore", expectedLabel: "orders-db" },
  { mention: "JWT sessions decision", type: "Decision", expectedLabel: "ADR-M001" },
];

const cfg: EvalConfig = {
  bundleDir: path.join(FIX, "pdf"),
  labelsPath: path.join(FIX, "labels.json"),
  accept: (f) => f.endsWith(".pdf"),
  mime: "application/pdf",
  linkCases: MERIDIAN_LINK_CASES,
};

async function runIntegrity(): Promise<IntegrityResult> {
  const ap = (await rawSql`SELECT ap.snippet, d.raw_text FROM attribute_provenance ap JOIN documents d ON d.id = ap.document_id`) as Array<{ snippet: string | null; raw_text: string }>;
  const ed = (await rawSql`SELECT e.snippet, d.raw_text FROM edges e JOIN documents d ON d.id = e.evidence_document_id WHERE e.active`) as Array<{ snippet: string | null; raw_text: string }>;
  let spanViolations = 0;
  for (const r of [...ap, ...ed]) if (!r.snippet || locateSpan(r.raw_text, r.snippet) === null) spanViolations++;
  const all = (await rawSql`SELECT id, source_type, source_id, target_type, target_id FROM edges WHERE active`) as any[];
  const endpoints: EdgeEndpoints[] = all.map((e) => ({ id: e.id, sourceType: e.source_type, sourceId: e.source_id, targetType: e.target_type, targetId: e.target_id }));
  const endpointViolations = (await checkEdgeIntegrity(endpoints)).length;
  return { spanViolations, endpointViolations, apCount: ap.length, activeEdgeCount: ed.length };
}

async function main(): Promise<void> {
  if (process.env.MERIDIAN !== "live") {
    log("[meridian] MERIDIAN!=live — skipping the live stress harness. Set MERIDIAN=live to run. Exit 0.");
    process.exit(0);
  }
  const host = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@");
  log(`[meridian] target DB: ${host}`);
  if (/neon|vercel|amazonaws|supabase/i.test(host) && process.env.STRESS_CONFIRM !== "yes") {
    log("[meridian] target looks like a PROD database. Re-run with STRESS_CONFIRM=yes to proceed.");
    process.exit(1);
  }

  const labels = JSON.parse(fs.readFileSync(cfg.labelsPath, "utf8")) as Labels;
  await truncateAll();
  const statusMap = await ingestBundle(cfg);          // file -> {id, status}
  await relinkAll();
  const scorecard = await scoreAll(cfg, labels);
  const integrity = await runIntegrity();

  // Extra signals for the matrix.
  const statuses: Record<string, string> = {};
  for (const [f, r] of statusMap) statuses[f] = r.status;
  const kindsRows = (await rawSql`SELECT DISTINCT kind FROM edges WHERE relation_type = 'DEPENDS_ON' AND active AND kind IS NOT NULL`) as Array<{ kind: string }>;
  const idServiceId = await idByLabel("Service", "identity-service");
  const q3 = await runCQ("service_blast_radius", { serviceId: idServiceId! });
  const m4 = await idByLabel("Requirement", "REQ-M4");
  const m5 = await idByLabel("Requirement", "REQ-M5");
  const q6m4 = (await runCQ("loadtest_vs_target", { requirementId: m4! })).rows[0]?.passed ?? null;
  const q6m5 = (await runCQ("loadtest_vs_target", { requirementId: m5! })).rows[0]?.passed ?? null;
  const payId = await idByLabel("Service", "payment-service");
  const q8 = await runCQ("service_owner", { serviceId: payId! });
  const orderUses = (await runCQ("service_datastore", { serviceId: (await idByLabel("Service", "order-service"))! })).rows.map((r: any) => r.label);
  const notifUses = (await runCQ("service_datastore", { serviceId: (await idByLabel("Service", "notification-service"))! })).rows.map((r: any) => r.label);

  // Resolution counts by label (from the scorecard's resolution detail).
  const resolutionByKey: Record<string, number> = {};
  for (const d of scorecard.resolution.detail) resolutionByKey[d.key] = (resolutionByKey[d.key] ?? 0) + d.found;

  // identity-service provenance breadth (distinct source docs) — matrix #18.
  const idProv = (await rawSql`
    SELECT COUNT(DISTINCT ap.document_id)::int AS n FROM attribute_provenance ap
    WHERE ap.entity_type = 'Service' AND ap.entity_id = ${idServiceId!}
  `) as Array<{ n: number }>;

  // marketing-brief produced no graph entities (only chunks) — matrix #15.
  const marketingDoc = (await rawSql`SELECT id FROM documents WHERE filename = 'marketing-brief.pdf'`) as Array<{ id: number }>;
  const marketingProv = (await rawSql`SELECT COUNT(*)::int AS n FROM attribute_provenance WHERE document_id = ${marketingDoc[0]?.id ?? -1}`) as Array<{ n: number }>;

  const expectedInDomain = Object.values(labels.classification).filter((c) => c.domain === "software_dev").length;

  const inputs: MatrixInputs = {
    scorecard, integrity, statuses, expectedInDomain,
    distinctKinds: kindsRows.map((k) => k.kind),
    q3Count: q3.rows.length,
    q6Pass: { m4Passed: q6m4 === null ? null : Boolean(q6m4), m5Passed: q6m5 === null ? null : Boolean(q6m5) },
    q8PaymentOwners: q8.rows.map((r: any) => r.label),
    sharedDatastore: orderUses.includes("orders-db") && notifUses.includes("orders-db"),
    resolutionByKey,
    identityProvenanceDocs: idProv[0]?.n ?? 0,
    marketingEntityCount: marketingProv[0]?.n ?? 0,
  };

  const matrix = buildMatrix(inputs);
  const report = renderReport(scorecard, matrix, integrity);
  fs.writeFileSync(REPORT, report);
  log(report);
  const failed = matrix.filter((r) => !r.pass);
  log(`[meridian] matrix: ${matrix.length - failed.length}/${matrix.length} passed. Report -> ${REPORT}`);
  await rawSql.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => { log(`[meridian] FATAL: ${e instanceof Error ? e.stack : String(e)}`); try { await rawSql.end(); } catch {} process.exit(1); });
