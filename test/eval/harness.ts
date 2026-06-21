import "dotenv/config";
// Task 20 — LIVE eval harness.
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

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db, rawSql } from "@/lib/db/client";
import {
  documents,
  systems,
  features,
  requirements,
  services,
  datastores,
  tests,
  loadTestResults,
  decisions,
  persons,
  entityIndex,
} from "@/lib/db/schema";
import { extractText } from "@/lib/ingest/extract-text";
import { advance, relinkAll } from "@/lib/pipeline/run";
import { runCQ } from "@/lib/query/templates";
import { linkMention } from "@/lib/search/entity-index";
import {
  prf,
  prfFromSets,
  sameSet,
  sameOrdered,
  pickThreshold,
  formatScorecard,
  type PR,
  type Scorecard,
  type ThresholdRow,
} from "./scorecard";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const BUNDLE_DIR = path.join(ROOT, "fixtures", "software-bundle");
const LABELS_PATH = path.join(ROOT, "fixtures", "labels.json");

const PRECISION_TARGET = 0.9; // link-sweep precision target (then max F1/recall)
const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// Typed table per package type name (for label/field lookups against the live graph).
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
type TypeName = keyof typeof TABLES_BY_TYPE;

// Schema column name per labels.json field key (labels use the schema/DB-ish names already).
// Identity ("label"/"text"/"sourceDocs"/"note") fields are excluded from field scoring here.
// The label-equivalent identity field per type is handled by entity-level matching.
const FIELD_KEYS: Record<TypeName, string[]> = {
  System: ["description"],
  Feature: ["description"],
  Requirement: ["kind", "priority", "metric", "targetValue"], // "text" is the identity-ish body, scored as part of entity match
  Service: ["language", "owner", "description"],
  Datastore: ["engine", "purpose"],
  Test: ["kind", "description"],
  LoadTestResult: ["scenario", "metric", "observedValue", "targetValue", "passed"],
  Decision: ["status", "rationale"],
  Person: ["role"],
};
// labels.json key -> live column accessor (camelCase prop on the drizzle row).
const COLUMN_OF: Record<string, string> = {
  description: "description",
  kind: "kind",
  priority: "priority",
  metric: "metric",
  targetValue: "targetValue",
  language: "language",
  owner: "owner",
  engine: "engine",
  purpose: "purpose",
  scenario: "scenario",
  observedValue: "observedValue",
  passed: "passed",
  status: "status",
  rationale: "rationale",
  role: "role",
};
// Enum-ish fields compared by exact normalized equality; the rest are free-text (containment ok).
const EXACT_FIELDS = new Set(["kind", "priority", "status", "language", "engine", "passed"]);

type LabeledEntity = Record<string, unknown> & { label: string };
type Labels = {
  classification: Record<string, { docType: string; domain: string }>;
  entities: Record<string, LabeledEntity[]>;
  links: Array<{ relationType: string; source: string; target: string; sourceType: string; targetType: string }>;
  cqAnswers: Record<string, { template: string; params: Record<string, unknown>; answer: unknown }>;
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
// Live-graph helpers
// ---------------------------------------------------------------------------
async function liveEntities(type: TypeName): Promise<Array<Record<string, any>>> {
  const table = TABLES_BY_TYPE[type];
  return (await db.select().from(table)) as Array<Record<string, any>>;
}

// Aliases per (type,label-of-canonical), from entity_index, so a merged-away label still matches.
async function aliasMap(type: TypeName): Promise<Map<number, string[]>> {
  const rows = (await rawSql`
    SELECT entity_id, aliases FROM entity_index WHERE entity_type = ${type}
  `) as Array<{ entity_id: number; aliases: string[] | null }>;
  const m = new Map<number, string[]>();
  for (const r of rows) m.set(r.entity_id, r.aliases ?? []);
  return m;
}

// Find the live node(s) of `type` whose label OR alias normalizes to the labeled label.
function matchNodes(
  live: Array<Record<string, any>>,
  aliases: Map<number, string[]>,
  label: string,
): Array<Record<string, any>> {
  const want = norm(label);
  return live.filter((n) => {
    if (norm(String(n.label)) === want) return true;
    return (aliases.get(n.id) ?? []).some((a) => norm(a) === want);
  });
}

// Resolve a labeled entity label -> its live entity id (first match), via label/alias.
async function idByLabel(type: TypeName, label: string): Promise<number | null> {
  const live = await liveEntities(type);
  const aliases = await aliasMap(type);
  const m = matchNodes(live, aliases, label);
  return m[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// 1. Classification
// ---------------------------------------------------------------------------
async function scoreClassification(labels: Labels): Promise<Scorecard["classification"]> {
  const docs = (await db.select().from(documents)) as Array<Record<string, any>>;
  const byFile = new Map(docs.map((d) => [d.filename, d]));
  const perDoc: Scorecard["classification"]["perDoc"] = [];
  for (const [file, gold] of Object.entries(labels.classification)) {
    const d = byFile.get(file);
    const predDocType = d?.docType ?? "(missing)";
    const predDomain = d?.domain ?? "(missing)";
    const ok = predDocType === gold.docType && predDomain === gold.domain;
    perDoc.push({
      file,
      predicted: `${predDocType}/${predDomain}`,
      labeled: `${gold.docType}/${gold.domain}`,
      ok,
    });
  }
  const accuracy = perDoc.length ? perDoc.filter((d) => d.ok).length / perDoc.length : 0;
  return { perDoc, accuracy };
}

// ---------------------------------------------------------------------------
// 2. Extraction P/R (entity-level + field-level)
// ---------------------------------------------------------------------------
function fieldMatch(key: string, gold: unknown, live: unknown): boolean {
  if (gold === null || gold === undefined) return true; // nothing labeled to match
  if (key === "passed") return Boolean(gold) === Boolean(live);
  const g = norm(String(gold));
  const l = live === null || live === undefined ? "" : norm(String(live));
  if (l.length === 0) return false;
  if (EXACT_FIELDS.has(key)) return g === l;
  // Free-text: count a match if either contains the other (LLM wording varies).
  return g === l || g.includes(l) || l.includes(g);
}

async function scoreExtraction(labels: Labels): Promise<Scorecard["extraction"]> {
  let eTp = 0, eFp = 0, eFn = 0;
  let fTp = 0, fFp = 0, fFn = 0;
  const perType: Scorecard["extraction"]["perType"] = [];
  const missing: string[] = [];
  const extra: string[] = [];

  for (const type of Object.keys(labels.entities) as TypeName[]) {
    const goldList = labels.entities[type];
    const live = await liveEntities(type);
    const aliases = await aliasMap(type);

    const matchedLiveIds = new Set<number>();
    let teTp = 0, teFp = 0, teFn = 0;
    let tfTp = 0, tfFp = 0, tfFn = 0;

    // Recall side + field scoring: walk labeled entities, find a live match.
    for (const gold of goldList) {
      const nodes = matchNodes(live, aliases, gold.label);
      if (nodes.length === 0) {
        teFn++;
        missing.push(`${type}:${gold.label}`);
        // Each labeled field of a missing entity is also a field-FN.
        for (const key of FIELD_KEYS[type]) {
          const gv = (gold as Record<string, unknown>)[key];
          if (gv !== null && gv !== undefined) fFn++, tfFn++;
        }
        continue;
      }
      teTp++;
      const node = nodes[0];
      matchedLiveIds.add(node.id);

      for (const key of FIELD_KEYS[type]) {
        const gv = (gold as Record<string, unknown>)[key];
        if (gv === null || gv === undefined) continue; // not labeled → not scored
        const col = COLUMN_OF[key];
        const lv = node[col];
        if (fieldMatch(key, gv, lv)) {
          fTp++; tfTp++;
        } else if (lv === null || lv === undefined || String(lv).length === 0) {
          // Labeled field we failed to populate → recall miss only.
          fFn++; tfFn++;
        } else {
          // Labeled field populated with a WRONG value → both a recall miss and a precision hit.
          fFn++; tfFn++;
          fFp++; tfFp++;
        }
      }
    }

    // Precision side (entities): live nodes never matched to a labeled entity = spurious.
    for (const n of live) {
      if (!matchedLiveIds.has(n.id)) {
        teFp++;
        extra.push(`${type}:${n.label}`);
      }
    }

    eTp += teTp; eFp += teFp; eFn += teFn;
    perType.push({ type, entity: prf(teTp, teFp, teFn), field: prf(tfTp, tfFp, tfFn) });
  }

  return {
    entityPR: prf(eTp, eFp, eFn),
    fieldPR: prf(fTp, fFp, fFn),
    perType,
    missing,
    extra,
  };
}

// ---------------------------------------------------------------------------
// 3. Entity-resolution P/R — "one node per real-world thing"
// ---------------------------------------------------------------------------
async function scoreResolution(labels: Labels): Promise<Scorecard["resolution"]> {
  const detail: Scorecard["resolution"]["detail"] = [];
  let tp = 0, fp = 0, fn = 0;

  for (const type of Object.keys(labels.entities) as TypeName[]) {
    const live = await liveEntities(type);
    const aliases = await aliasMap(type);
    const matchedLiveIds = new Set<number>();
    for (const gold of labels.entities[type]) {
      const nodes = matchNodes(live, aliases, gold.label);
      for (const n of nodes) matchedLiveIds.add(n.id);
      const found = nodes.length;
      let verdict: string;
      if (found === 1) {
        verdict = "OK";
        tp++;
      } else if (found === 0) {
        verdict = "MISSING";
        fn++;
      } else {
        verdict = "DUPLICATED";
        tp++; // the thing exists…
        fp += found - 1; // …but extra copies are false positives (resolution failed to merge)
      }
      detail.push({ key: `${type}:${gold.label}`, expected: 1, found, verdict });
    }
    // SPURIOUS live nodes: a live node of this type matching NO labeled entity is a resolution
    // false positive (same `extra` set the extraction scorer computes). Without this, precision
    // could read 1.0 while spurious nodes exist.
    for (const n of live) {
      if (!matchedLiveIds.has(n.id)) {
        fp++;
        detail.push({ key: `${type}:${n.label}`, expected: 0, found: 1, verdict: "SPURIOUS" });
      }
    }
  }
  return { pr: prf(tp, fp, fn), detail };
}

// ---------------------------------------------------------------------------
// 4. Entity-linking accuracy — mention -> correct entity, top-1
// ---------------------------------------------------------------------------
// A few labeled mentions that exercise lexical + semantic linking (paraphrases grounded in the
// fixture text), each expecting a specific canonical entity as the top hit.
const LINK_CASES: Array<{ mention: string; type: TypeName; expectedLabel: string }> = [
  { mention: "login system", type: "Service", expectedLabel: "auth-service" },
  { mention: "sign-in service", type: "Service", expectedLabel: "auth-service" },
  { mention: "session token minting service", type: "Service", expectedLabel: "token-service" },
  { mention: "user database", type: "Datastore", expectedLabel: "user-db" },
  { mention: "authentication feature", type: "Feature", expectedLabel: "User Authentication" },
  { mention: "JWT decision", type: "Decision", expectedLabel: "ADR-001" },
];

async function scoreLinking(): Promise<Scorecard["linking"]> {
  const cases: Scorecard["linking"]["cases"] = [];
  for (const c of LINK_CASES) {
    const hits = await linkMention(c.mention, { type: c.type });
    const gotLabel = hits[0]?.label ?? null;
    const ok = gotLabel !== null && norm(gotLabel) === norm(c.expectedLabel);
    cases.push({ mention: c.mention, expectedLabel: c.expectedLabel, gotLabel, ok });
  }
  const accuracy = cases.length ? cases.filter((c) => c.ok).length / cases.length : 0;
  return { cases, accuracy };
}

// ---------------------------------------------------------------------------
// 5. Link P/R @ threshold, swept 0.5 -> 0.9
// ---------------------------------------------------------------------------
// Read every stored SEMANTIC edge (exclude deterministic MENTIONS), resolve endpoints to labels,
// and key by relationType|sourceLabel|targetLabel. Sweep thresholds in memory over edge.confidence.
async function loadSemanticEdges(): Promise<Array<{ key: string; confidence: number }>> {
  const rows = (await rawSql`
    SELECT relation_type, source_type, source_id, target_type, target_id, confidence
    FROM edges
    WHERE relation_type <> 'MENTIONS'
  `) as Array<{
    relation_type: string;
    source_type: string;
    source_id: number;
    target_type: string;
    target_id: number;
    confidence: number;
  }>;

  // Cache label lookups per (type,id).
  const labelCache = new Map<string, string>();
  const labelOf = async (type: string, id: number): Promise<string> => {
    const ck = `${type}:${id}`;
    if (labelCache.has(ck)) return labelCache.get(ck)!;
    const table = TABLES_BY_TYPE[type as TypeName];
    let label = `${type}#${id}`;
    if (table) {
      const [r] = await db.select({ label: table.label }).from(table).where(eq(table.id, id));
      if (r) label = r.label;
    }
    labelCache.set(ck, label);
    return label;
  };

  const out: Array<{ key: string; confidence: number }> = [];
  for (const r of rows) {
    const s = await labelOf(r.source_type, r.source_id);
    const t = await labelOf(r.target_type, r.target_id);
    out.push({ key: `${r.relation_type}|${norm(s)}|${norm(t)}`, confidence: Number(r.confidence) });
  }
  return out;
}

async function scoreLinks(labels: Labels): Promise<Scorecard["links"]> {
  const goldSet = new Set(labels.links.map((l) => `${l.relationType}|${norm(l.source)}|${norm(l.target)}`));
  const edges = await loadSemanticEdges();

  const sweep: ThresholdRow[] = THRESHOLDS.map((t) => {
    const active = new Set(edges.filter((e) => e.confidence >= t).map((e) => e.key));
    return { t, pr: prfFromSets(goldSet, active) };
  });

  const chosenRow = pickThreshold(sweep, PRECISION_TARGET);
  const activeAtChosen = new Set(edges.filter((e) => e.confidence >= chosenRow.t).map((e) => e.key));
  const missing = [...goldSet].filter((k) => !activeAtChosen.has(k));
  const falsePositives = [...activeAtChosen].filter((k) => !goldSet.has(k));

  return {
    sweep,
    chosen: chosenRow.t,
    chosenPR: chosenRow.pr,
    precisionTarget: PRECISION_TARGET,
    activeAtChosen: activeAtChosen.size,
    labeledCount: goldSet.size,
    missing,
    falsePositives,
  };
}

// ---------------------------------------------------------------------------
// 6. CQ-answer correctness
// ---------------------------------------------------------------------------
// Resolve each CQ's params from the live graph (label -> id), run runCQ, compare to golden.
async function resolveCQParams(template: string, params: Record<string, unknown>): Promise<Record<string, number> | null> {
  const r: Record<string, number> = {};
  const need = async (key: string, type: TypeName, labelKey: string) => {
    const lbl = params[labelKey] as string;
    const id = await idByLabel(type, lbl);
    if (id === null) return false;
    r[key] = id;
    return true;
  };
  switch (template) {
    case "requirements_without_test":
    case "services_coverage_gaps":
      return {};
    case "service_blast_radius":
    case "service_datastore":
    case "service_decisions":
    case "service_owner":
      return (await need("serviceId", "Service", "service")) ? r : null;
    case "feature_chain":
    case "feature_blast_radius":
      return (await need("featureId", "Feature", "feature")) ? r : null;
    case "loadtest_vs_target":
      return (await need("requirementId", "Requirement", "requirement")) ? r : null;
    case "dependency_path": {
      const okS = await need("sourceId", "Service", "source");
      const okT = await need("targetId", "Service", "target");
      return okS && okT ? r : null;
    }
    default:
      return null;
  }
}

// Resolve a set of live ids back to a sorted set of labels for comparison.
async function labelsOf(type: TypeName, ids: number[]): Promise<string[]> {
  const live = await liveEntities(type);
  const byId = new Map(live.map((n) => [n.id, String(n.label)]));
  return ids.map((id) => byId.get(id) ?? `#${id}`);
}

// Per-template comparison of the live runCQ result vs the golden answer.
async function compareCQ(
  id: string,
  template: string,
  rows: any[],
  gold: any,
): Promise<{ ok: boolean; note?: string }> {
  switch (template) {
    case "requirements_without_test": {
      const got = rows.map((r) => r.label);
      const ok = sameSet(got, gold);
      return { ok, note: ok ? undefined : `got [${got.join(",")}] want [${gold.join(",")}]` };
    }
    case "services_coverage_gaps": {
      // gold: { svcLabel: {noDesignDoc,noLoadTest} }. rows carry label + booleans.
      let ok = true;
      const notes: string[] = [];
      const goldMap = gold as Record<string, any>;
      for (const [svc, g] of Object.entries(goldMap)) {
        const row = rows.find((r) => norm(r.label) === norm(svc));
        if (!row) { ok = false; notes.push(`${svc}:missing`); continue; }
        if (Boolean(row.noDesignDoc) !== g.noDesignDoc || Boolean(row.noLoadTest) !== g.noLoadTest) {
          ok = false;
          notes.push(`${svc}:{dd=${row.noDesignDoc},lt=${row.noLoadTest}} want {dd=${g.noDesignDoc},lt=${g.noLoadTest}}`);
        }
      }
      // Spurious services: a live coverage row whose label is not in the gold map.
      const goldLabels = new Set(Object.keys(goldMap).map(norm));
      for (const row of rows) {
        if (!goldLabels.has(norm(row.label))) { ok = false; notes.push(`${row.label}:spurious`); }
      }
      return { ok, note: ok ? undefined : notes.join(" ") };
    }
    case "service_blast_radius": {
      const got = rows.map((r) => r.label);
      const ok = sameSet(got, gold);
      return { ok, note: ok ? undefined : `got [${got.join(",")}] want [${gold.join(",")}]` };
    }
    case "service_datastore":
    case "service_owner": {
      const got = rows.map((r) => r.label);
      const ok = sameSet(got, gold);
      return { ok, note: ok ? undefined : `got [${got.join(",")}] want [${gold.join(",")}]` };
    }
    case "feature_chain":
    case "feature_blast_radius": {
      const r = rows[0] ?? {};
      const g = gold as Record<string, any>;
      const cmp = (a: any[], key: string) => sameSet((a ?? []).map((x: any) => x.label), g[key] ?? []);
      const checks = {
        requirements: cmp(r.requirements, "requirements"),
        services: cmp(r.services, "services"),
        tests: cmp(r.tests, "tests"),
        loadTestResults: cmp(r.loadTestResults, "loadTestResults"),
      };
      const ok = Object.values(checks).every(Boolean);
      const fails = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      return { ok, note: ok ? undefined : `mismatch: ${fails.join(",")}` };
    }
    case "loadtest_vs_target": {
      const r = rows[0];
      const g = gold as Record<string, any>;
      if (!r) return { ok: false, note: "no loadtest row" };
      // The verdict must be COMPUTED from extracted data. A NULL/never-extracted `passed` means the
      // verdict was never determined → FAIL (don't let Boolean(null)===false sneak a pass through).
      if (r.passed === null || r.passed === undefined) {
        return { ok: false, note: `passed not extracted (null) obs="${r.observedValue}"` };
      }
      const passedOk = Boolean(r.passed) === g.passed;
      // Compare observed structurally to the golden observedValue (no hardcoded literal): the
      // free-text wording varies, so accept either-contains-the-other on the normalized strings.
      const obsLive = norm(String(r.observedValue ?? ""));
      const obsGold = norm(String(g.observedValue ?? ""));
      const obsOk = obsLive.length > 0 && (obsLive === obsGold || obsLive.includes(obsGold) || obsGold.includes(obsLive));
      const ok = passedOk && obsOk;
      return { ok, note: ok ? undefined : `passed=${r.passed} obs="${r.observedValue}"` };
    }
    case "service_decisions": {
      // gold: [{decision,...}]. rows: decision entity rows (label = ADR id).
      const got = rows.map((r) => r.label);
      const want = (gold as any[]).map((d) => d.decision);
      const ok = sameSet(got, want);
      return { ok, note: ok ? undefined : `got [${got.join(",")}] want [${want.join(",")}]` };
    }
    case "dependency_path": {
      const g = gold as { forward: string[] };
      const got = rows[0]?.path as number[] | undefined;
      if (!got) return { ok: false, note: "no path" };
      const labels = await labelsOf("Service", got.map(Number));
      const ok = sameOrdered(labels, g.forward);
      return { ok, note: ok ? undefined : `got [${labels.join("->")}] want [${g.forward.join("->")}]` };
    }
    default:
      return { ok: false, note: "unknown template" };
  }
}

async function scoreCQ(labels: Labels): Promise<Scorecard["cq"]> {
  const perCQ: Scorecard["cq"]["perCQ"] = [];
  for (const [id, spec] of Object.entries(labels.cqAnswers)) {
    const params = await resolveCQParams(spec.template, spec.params);
    if (params === null) {
      perCQ.push({ id, template: spec.template, ok: false, note: "param entity unresolved in live graph" });
      continue;
    }
    let result;
    try {
      result = await runCQ(spec.template, params);
    } catch (e) {
      perCQ.push({ id, template: spec.template, ok: false, note: `runCQ error: ${(e as Error).message}` });
      continue;
    }
    const { ok, note } = await compareCQ(id, spec.template, result.rows, spec.answer);
    perCQ.push({ id, template: spec.template, ok, note });
  }
  return { perCQ, passed: perCQ.filter((c) => c.ok).length, total: perCQ.length };
}

// ---------------------------------------------------------------------------
// Pipeline ingest
// ---------------------------------------------------------------------------
async function truncateAll(): Promise<void> {
  // CASCADE-free truncate of every knowledge/substrate table (no FKs declared in schema, but
  // RESTART IDENTITY keeps ids small/clean for the demo graph).
  await rawSql`
    TRUNCATE TABLE
      documents, chunks,
      systems, features, requirements, services, datastores, tests, load_test_results, decisions, persons,
      edges, attribute_provenance, entity_index, jobs
    RESTART IDENTITY
  `;
  log("[eval] truncated documents, chunks, 9 entity tables, edges, attribute_provenance, entity_index, jobs.");
}

async function ingestBundle(): Promise<void> {
  const files = fs.readdirSync(BUNDLE_DIR).filter((f) => f.endsWith(".txt")).sort();
  log(`[eval] ingesting ${files.length} fixture files live (classify -> index -> extract -> resolve -> link)...`);
  for (const file of files) {
    const buf = fs.readFileSync(path.join(BUNDLE_DIR, file));
    const { rawText } = await extractText(buf, "text/plain");
    const [doc] = await db
      .insert(documents)
      .values({ filename: file, mimeType: "text/plain", rawText, status: "ingested" })
      .returning();

    let prev = "";
    let cur = "";
    for (let i = 0; i < 12; i++) {
      const res = await advance(doc.id);
      cur = res.status;
      if (cur === prev) break; // status stopped moving
      prev = cur;
      if (cur === "ready" || cur === "failed" || cur === "unrouted") break;
    }
    log(`[eval]   ${file.padEnd(16)} -> ${cur}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const labels = JSON.parse(fs.readFileSync(LABELS_PATH, "utf8")) as Labels;

  log("[eval] === STRATA LIVE EVAL (Task 20) ===");
  await truncateAll();
  await ingestBundle();

  // Order-independent re-link sweep: with all docs now ingested, re-run linking over the full graph
  // so relations grounded in an early doc between entities born later (e.g. AFFECTS, DEPENDS_ON,
  // IMPLEMENTS) form regardless of ingest order. Idempotent, so this only adds the missing edges.
  log("[eval] re-linking across the full graph (order-independent sweep)...");
  await relinkAll();

  log("[eval] computing scorecard...");
  const classification = await scoreClassification(labels);
  const extraction = await scoreExtraction(labels);
  const resolution = await scoreResolution(labels);
  const linking = await scoreLinking();
  const links = await scoreLinks(labels);
  const cq = await scoreCQ(labels);

  const sc: Scorecard = { classification, extraction, resolution, linking, links, cq };
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
