import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Live deployment 1:1 verification.
//
// Proves the DEPLOYED Vercel app serves the Meridian graph identically to the local stress
// result. It drives the real HTTP surface (POST /api/query for all 10 CQs, GET /api/status,
// POST /api/ask probes) against STRATA_URL and compares every deterministic answer to the
// oracle in fixtures/meridian/labels.json. Entity IDs (which restart on each rebuild) are
// resolved by label from the same Neon DB the app reads, so the CQ params are correct.
//
//   DATABASE_URL=<neon> STRATA_URL=<live> tsx scripts/stress/verify-live.ts
//
// Exit 0 iff every gated row passes.

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const LABELS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "fixtures", "meridian", "labels.json"), "utf8"),
) as any;

const BASE = (process.env.STRATA_URL ?? "https://strata-eight-green.vercel.app").replace(/\/$/, "");
const sql = postgres(process.env.DATABASE_URL!, { max: 3 });
const log = (m: string) => process.stdout.write(m + "\n");

type Row = { n: string; name: string; pass: boolean; detail: string };
const rows: Row[] = [];
const add = (n: string, name: string, pass: boolean, detail: string) => rows.push({ n, name, pass, detail });

const sortLabels = (arr: any[]): string[] => (arr ?? []).map((r) => r.label).filter(Boolean).sort();
const eqSet = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const fmt = (a: string[]) => `[${a.join(",")}]`;

async function cq(template: string, params: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cq: template, params }),
  });
  if (!res.ok) throw new Error(`POST /api/query ${template} -> HTTP ${res.status}`);
  return res.json();
}

async function ask(question: string): Promise<any> {
  const res = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) throw new Error(`POST /api/ask -> HTTP ${res.status}`);
  return res.json();
}

async function main(): Promise<void> {
  log(`[verify-live] target app: ${BASE}`);

  // --- resolve label -> id (and id -> label for path decoding) from the live DB ---
  const svc = (await sql`SELECT id, label FROM services`) as Array<{ id: number; label: string }>;
  const feat = (await sql`SELECT id, label FROM features`) as Array<{ id: number; label: string }>;
  const req = (await sql`SELECT id, label FROM requirements`) as Array<{ id: number; label: string }>;
  const sid = Object.fromEntries(svc.map((r) => [r.label, r.id]));
  const fid = Object.fromEntries(feat.map((r) => [r.label, r.id]));
  const rid = Object.fromEntries(req.map((r) => [r.label, r.id]));
  const svcLabel = Object.fromEntries(svc.map((r) => [Number(r.id), r.label]));

  // --- GET /api/status : doc readiness (17 in-domain ready, marketing unrouted) ---
  try {
    const st = await (await fetch(`${BASE}/api/status`)).json();
    const docs: any[] = st.docs ?? [];
    const ready = docs.filter((d) => d.status === "ready").length;
    const mk = docs.find((d) => d.filename === "marketing-brief.pdf");
    const ok = docs.length === 18 && ready === 17 && mk?.status === "unrouted";
    add("status", "18 docs, 17 ready, marketing unrouted", ok, `total=${docs.length} ready=${ready} marketing=${mk?.status}`);
  } catch (e) {
    add("status", "GET /api/status", false, String(e));
  }

  // --- Q1 requirements_without_test ---
  {
    const got = sortLabels((await cq("requirements_without_test", {})).rows);
    const want = [...LABELS.cqAnswers.Q1.answer].sort();
    add("Q1", "requirements_without_test", eqSet(got, want), `got ${fmt(got)} want ${fmt(want)}`);
  }

  // --- Q2 services_coverage_gaps ---
  {
    const r = (await cq("services_coverage_gaps", {})).rows as any[];
    const want = LABELS.cqAnswers.Q2.answer as Record<string, { noDesignDoc: boolean; noLoadTest: boolean }>;
    const got = Object.fromEntries(r.map((x) => [x.label, { noDesignDoc: x.noDesignDoc, noLoadTest: x.noLoadTest }]));
    const mismatches = Object.keys(want).filter(
      (k) => !got[k] || got[k].noDesignDoc !== want[k].noDesignDoc || got[k].noLoadTest !== want[k].noLoadTest,
    );
    add("Q2", "services_coverage_gaps", mismatches.length === 0, mismatches.length ? `mismatch: ${mismatches.join(",")}` : `all ${Object.keys(want).length} services match`);
  }

  // --- Q3 service_blast_radius(identity-service) ---
  {
    const got = sortLabels((await cq("service_blast_radius", { serviceId: sid["identity-service"] })).rows);
    const want = [...LABELS.cqAnswers.Q3.answer].sort();
    add("Q3", "service_blast_radius(identity)", eqSet(got, want), `got ${fmt(got)} want ${fmt(want)}`);
  }

  // --- Q4 feature_chain(Checkout) ---
  {
    const r = (await cq("feature_chain", { featureId: fid["Checkout"] })).rows[0];
    const w = LABELS.cqAnswers.Q4.answer;
    const checks = [
      eqSet(sortLabels(r.requirements), [...w.requirements].sort()),
      eqSet(sortLabels(r.services), [...w.services].sort()),
      eqSet(sortLabels(r.tests), [...w.tests].sort()),
      eqSet(sortLabels(r.loadTestResults), [...w.loadTestResults].sort()),
    ];
    add("Q4", "feature_chain(Checkout)", checks.every(Boolean), `reqs ${fmt(sortLabels(r.requirements))} svc ${fmt(sortLabels(r.services))} tests ${fmt(sortLabels(r.tests))} lt ${fmt(sortLabels(r.loadTestResults))}`);
  }

  // --- Q5 service_datastore(order-service) ---
  {
    const got = sortLabels((await cq("service_datastore", { serviceId: sid["order-service"] })).rows);
    const want = [...LABELS.cqAnswers.Q5.answer].sort();
    add("Q5", "service_datastore(order)", eqSet(got, want), `got ${fmt(got)} want ${fmt(want)}`);
  }

  // --- Q6 loadtest_vs_target(REQ-M4) ---
  {
    const r = (await cq("loadtest_vs_target", { requirementId: rid["REQ-M4"] })).rows[0];
    const w = LABELS.cqAnswers.Q6.answer;
    const ok = r && r.passed === w.passed && String(r.observedValue).includes("6,000");
    add("Q6", "loadtest_vs_target(REQ-M4)", !!ok, `passed=${r?.passed} observed="${r?.observedValue}"`);
  }

  // --- Q7 service_decisions(order-service) ---
  {
    const got = sortLabels((await cq("service_decisions", { serviceId: sid["order-service"] })).rows);
    const want = LABELS.cqAnswers.Q7.answer.map((d: any) => d.decision).sort();
    add("Q7", "service_decisions(order)", eqSet(got, want), `got ${fmt(got)} want ${fmt(want)}`);
  }

  // --- Q8 service_owner(payment-service) -> none ---
  {
    const got = sortLabels((await cq("service_owner", { serviceId: sid["payment-service"] })).rows);
    add("Q8", "service_owner(payment) -> none", got.length === 0, `owners ${fmt(got)} (want [])`);
  }

  // --- Q9 feature_blast_radius(User Login) ---
  {
    const r = (await cq("feature_blast_radius", { featureId: fid["User Login"] })).rows[0];
    const w = LABELS.cqAnswers.Q9.answer;
    const checks = [
      eqSet(sortLabels(r.requirements), [...w.requirements].sort()),
      eqSet(sortLabels(r.services), [...w.services].sort()),
      eqSet(sortLabels(r.tests), [...w.tests].sort()),
      eqSet(sortLabels(r.loadTestResults), [...w.loadTestResults].sort()),
    ];
    add("Q9", "feature_blast_radius(User Login)", checks.every(Boolean), `reqs ${fmt(sortLabels(r.requirements))} svc ${fmt(sortLabels(r.services))} tests ${fmt(sortLabels(r.tests))} lt ${fmt(sortLabels(r.loadTestResults))}`);
  }

  // --- Q10 dependency_path(api-gateway -> payment-service) ---
  {
    const r = (await cq("dependency_path", { sourceId: sid["api-gateway"], targetId: sid["payment-service"] })).rows[0];
    const got = (r?.path ?? []).map((n: number) => svcLabel[Number(n)]);
    const want = LABELS.cqAnswers.Q10.answer.forward;
    add("Q10", "dependency_path(gateway->payment)", JSON.stringify(got) === JSON.stringify(want), `got ${fmt(got)} want ${fmt(want)}`);
  }

  // --- /api/ask probes (informational: LLM narration over the same deterministic rowset) ---
  const probes = [
    { q: "What datastore does order-service use?", expect: "orders-db" },
    { q: "Who owns payment-service?", expect: null },
    { q: "Which requirements have no verifying test?", expect: "REQ-M" },
  ];
  for (const p of probes) {
    try {
      const a = await ask(p.q);
      const ans = String(a.answer ?? "");
      const hit = p.expect ? ans.toLowerCase().includes(p.expect.toLowerCase()) : ans.length > 0;
      add("ask", `ask: "${p.q}"`, !!a.tier && ans.length > 0 && hit, `tier=${a.tier} ${p.expect ? `contains "${p.expect}"=${hit}` : `len=${ans.length}`}`);
    } catch (e) {
      add("ask", `ask: "${p.q}"`, false, String(e));
    }
  }

  // --- report ---
  log("");
  log("| check | scenario | result | detail |");
  log("| --- | --- | --- | --- |");
  for (const r of rows) log(`| ${r.n} | ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail} |`);
  const gated = rows.filter((r) => r.n !== "ask");
  const failed = gated.filter((r) => !r.pass);
  const askRows = rows.filter((r) => r.n === "ask");
  log("");
  log(`[verify-live] gated: ${gated.length - failed.length}/${gated.length} passed | ask probes: ${askRows.filter((r) => r.pass).length}/${askRows.length} ok`);
  await sql.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => {
  log(`[verify-live] FATAL: ${e instanceof Error ? e.stack : String(e)}`);
  try { await sql.end(); } catch {}
  process.exit(1);
});
