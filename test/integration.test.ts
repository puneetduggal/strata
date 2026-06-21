import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";

// Task 21 — full-pipeline integration test, OFFLINE + DETERMINISTIC via the record/replay shim.
//
// Mirrors the proven eval harness flow (test/eval/harness.ts): extractText → insert document →
// advance() to a terminal status for the whole golden bundle, then the order-independent relinkAll()
// sweep. It then ASSERTS (vs the harness's score): all 10 CQ golden answers from fixtures/labels.json,
// that every returned provenance span re-grounds via locateSpan, and that a malformed doc fails in
// ISOLATION (the bundle stays ready). Unlike the harness it routes the LLM/embedding seams through
// the committed cassettes so it runs with NO network (EVAL=live bypasses the cache to re-verify live).
//
// Isolation: this truncates the shared knowledge tables + asserts GLOBAL answers, so it runs ALONE
// and SERIALLY via vitest.integration.config.ts (excluded from the parallel unit pass).

import { hashRequest, recordReplay, mode, flush } from "./record-replay";
import { sameSet, sameOrdered } from "./eval/scorecard";

// Route the three non-deterministic seams through the cassette. The factory pulls the REAL impl via
// importOriginal() and wraps each call in recordReplay (live | record | replay per env). The eval
// harness keeps using the real modules — this mock is scoped to this test file only.
vi.mock("@/lib/llm/claude", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/llm/claude")>();
  return {
    ...real,
    extractStructured: (opts: { system?: string; user: string }) =>
      recordReplay("extract", hashRequest("extract", opts.system ?? "", canonicalizeUser(opts.user)), () => real.extractStructured(opts as never)),
    narrate: (opts: { system?: string; user: string }) =>
      recordReplay("narrate", hashRequest("narrate", opts.system ?? "", canonicalizeUser(opts.user)), () => real.narrate(opts as never)),
  };
});

// Canonicalize a prompt before hashing so the cassette key is invariant to the ONE volatile input
// in the pipeline's LLM prompts: the link stage lists candidate-partner entities via an unordered
// `SELECT ... FROM entity_index`, so Postgres heap order (affected by resolve-stage UPDATEs / vacuum)
// can reorder those lines run-to-run for the SAME logical graph. The model's answer (the set of
// proposed edges) does not depend on that ordering, so sorting the contiguous run of partner lines
// (`- (Type) label`) maps every ordering to one stable cassette entry — deterministic offline replay
// without touching pipeline code. (All other prompts are pure functions of doc text and are unaffected.)
function canonicalizeUser(user: string): string {
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
vi.mock("@/lib/embed/voyage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/embed/voyage")>();
  // Key PER TEXT so a different batching of the same strings reuses the cached vectors. We resolve
  // each text individually (sequentially) so recording only calls the real API for misses.
  const embed = async (texts: string[]): Promise<number[][]> => {
    const out: number[][] = [];
    for (const t of texts) {
      out.push(await recordReplay("embed", hashRequest(t), async () => (await real.embed([t]))[0]));
    }
    return out;
  };
  return { ...real, embed };
});

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
} from "@/lib/db/schema";
import { extractText } from "@/lib/ingest/extract-text";
import { advance, relinkAll } from "@/lib/pipeline/run";
import { runCQ, type EdgeRef } from "@/lib/query/templates";
import { locateSpan } from "@/lib/provenance/locate";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const BUNDLE_DIR = path.join(ROOT, "fixtures", "software-bundle");
const LABELS_PATH = path.join(ROOT, "fixtures", "labels.json");

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

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

type Labels = {
  classification: Record<string, { docType: string; domain: string }>;
  cqAnswers: Record<string, { template: string; question: string; params: Record<string, unknown>; answer: unknown }>;
};

const labels = JSON.parse(fs.readFileSync(LABELS_PATH, "utf8")) as Labels;

// ---------------------------------------------------------------------------
// Live-graph helpers (mirrors harness label→id resolution via label OR alias).
// ---------------------------------------------------------------------------
async function liveEntities(type: TypeName): Promise<Array<Record<string, any>>> {
  return (await db.select().from(TABLES_BY_TYPE[type])) as Array<Record<string, any>>;
}

async function aliasMap(type: TypeName): Promise<Map<number, string[]>> {
  const rows = (await rawSql`
    SELECT entity_id, aliases FROM entity_index WHERE entity_type = ${type}
  `) as Array<{ entity_id: number; aliases: string[] | null }>;
  const m = new Map<number, string[]>();
  for (const r of rows) m.set(r.entity_id, r.aliases ?? []);
  return m;
}

function matchNodes(live: Array<Record<string, any>>, aliases: Map<number, string[]>, label: string) {
  const want = norm(label);
  return live.filter((n) => norm(String(n.label)) === want || (aliases.get(n.id) ?? []).some((a) => norm(a) === want));
}

async function idByLabel(type: TypeName, label: string): Promise<number | null> {
  const m = matchNodes(await liveEntities(type), await aliasMap(type), label);
  return m[0]?.id ?? null;
}

async function labelsOf(type: TypeName, ids: number[]): Promise<string[]> {
  const byId = new Map((await liveEntities(type)).map((n) => [n.id, String(n.label)]));
  return ids.map((id) => byId.get(id) ?? `#${id}`);
}

// Resolve each CQ's labeled params to live ids (same mapping the harness uses).
async function resolveCQParams(template: string, params: Record<string, unknown>): Promise<Record<string, number>> {
  const r: Record<string, number> = {};
  const need = async (key: string, type: TypeName, labelKey: string) => {
    const id = await idByLabel(type, params[labelKey] as string);
    expect(id, `param ${labelKey}="${params[labelKey]}" should resolve in the live graph`).not.toBeNull();
    r[key] = id!;
  };
  switch (template) {
    case "requirements_without_test":
    case "services_coverage_gaps":
      return {};
    case "service_blast_radius":
    case "service_datastore":
    case "service_decisions":
    case "service_owner":
      await need("serviceId", "Service", "service");
      return r;
    case "feature_chain":
    case "feature_blast_radius":
      await need("featureId", "Feature", "feature");
      return r;
    case "loadtest_vs_target":
      await need("requirementId", "Requirement", "requirement");
      return r;
    case "dependency_path":
      await need("sourceId", "Service", "source");
      await need("targetId", "Service", "target");
      return r;
    default:
      throw new Error(`unknown CQ template ${template}`);
  }
}

// Per-template assertion of the live runCQ result vs the golden answer (mirrors the harness's
// compareCQ semantics — set vs ordered vs flag-map — but expect()s instead of scoring).
async function assertCQ(template: string, rows: any[], gold: any): Promise<void> {
  switch (template) {
    case "requirements_without_test":
    case "service_blast_radius":
    case "service_datastore":
    case "service_owner": {
      expect(sameSet(rows.map((r) => r.label), gold)).toBe(true);
      return;
    }
    case "services_coverage_gaps": {
      const goldMap = gold as Record<string, { noDesignDoc: boolean; noLoadTest: boolean }>;
      expect(rows.map((r) => norm(r.label)).sort()).toEqual(Object.keys(goldMap).map(norm).sort());
      for (const [svc, g] of Object.entries(goldMap)) {
        const row = rows.find((r) => norm(r.label) === norm(svc))!;
        expect(Boolean(row.noDesignDoc), `${svc}.noDesignDoc`).toBe(g.noDesignDoc);
        expect(Boolean(row.noLoadTest), `${svc}.noLoadTest`).toBe(g.noLoadTest);
      }
      return;
    }
    case "feature_chain":
    case "feature_blast_radius": {
      const r = rows[0] ?? {};
      const g = gold as Record<string, string[]>;
      for (const key of ["requirements", "services", "tests", "loadTestResults"] as const) {
        expect(sameSet((r[key] ?? []).map((x: any) => x.label), g[key] ?? []), `${template}.${key}`).toBe(true);
      }
      return;
    }
    case "loadtest_vs_target": {
      const r = rows[0];
      const g = gold as { passed: boolean; observedValue: string };
      expect(r, "loadtest row present").toBeTruthy();
      expect(r.passed, "passed extracted (not null)").not.toBeNull();
      expect(Boolean(r.passed)).toBe(g.passed);
      const obsLive = norm(String(r.observedValue ?? ""));
      const obsGold = norm(String(g.observedValue ?? ""));
      expect(obsLive.length > 0 && (obsLive === obsGold || obsLive.includes(obsGold) || obsGold.includes(obsLive))).toBe(true);
      return;
    }
    case "service_decisions": {
      const want = (gold as Array<{ decision: string }>).map((d) => d.decision);
      expect(sameSet(rows.map((r) => r.label), want)).toBe(true);
      return;
    }
    case "dependency_path": {
      const g = gold as { forward: string[] };
      const path = rows[0]?.path as number[] | undefined;
      expect(path, "dependency path present").toBeTruthy();
      expect(sameOrdered(await labelsOf("Service", path!.map(Number)), g.forward)).toBe(true);
      return;
    }
    default:
      throw new Error(`unknown CQ template ${template}`);
  }
}

// Ingest one file through the full pipeline to a terminal status (mirrors the harness loop).
async function ingestFile(file: string): Promise<{ id: number; status: string }> {
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
const bundleFiles = fs.readdirSync(BUNDLE_DIR).filter((f) => f.endsWith(".txt")).sort();
const resultByFile = new Map<string, { id: number; status: string }>();

beforeAll(async () => {
  // Truncate the shared knowledge/substrate tables so GLOBAL CQ answers reflect exactly this bundle
  // (same set as the harness's truncateAll). Isolated to this serial config.
  await rawSql`
    TRUNCATE TABLE
      documents, chunks,
      systems, features, requirements, services, datastores, tests, load_test_results, decisions, persons,
      edges, attribute_provenance, entity_index, jobs
    RESTART IDENTITY
  `;
  for (const file of bundleFiles) {
    resultByFile.set(file, await ingestFile(file));
  }
  await relinkAll();
}, 1_800_000); // generous headroom for the one-time RECORD run under Voyage's free-tier throttle

afterAll(async () => {
  if (mode() === "record") flush(); // persist any newly-recorded cassette entries
  await rawSql.end();
});

test("every software_dev doc reaches ready; the off-domain resume reaches unrouted", () => {
  for (const [file, gold] of Object.entries(labels.classification)) {
    const r = resultByFile.get(file)!;
    expect(r, `${file} ingested`).toBeTruthy();
    expect(r.status, `${file} terminal status`).toBe(gold.domain === "software_dev" ? "ready" : "unrouted");
  }
});

// Each CQ asserts its golden answer AND that any provenance it carries re-grounds in the doc text.
for (const [id, spec] of Object.entries(labels.cqAnswers)) {
  test(`${id} (${spec.template}): golden answer + resolvable provenance`, async () => {
    const params = await resolveCQParams(spec.template, spec.params);
    const { rows, provenance } = await runCQ(spec.template, params);
    await assertCQ(spec.template, rows, spec.answer);
    await assertProvenanceResolvable(provenance);
  });
}

// Provenance resolvability: each carried edge re-grounds via locateSpan against its evidence doc's
// raw_text, and the stored offsets fall within that text. We re-ground (NOT slice===snippet): the
// stored snippet is the model's text and may differ from raw_text by whitespace.
async function assertProvenanceResolvable(provenance: EdgeRef[]): Promise<void> {
  for (const e of provenance) {
    if (e.snippet === null || e.evidenceDocumentId === null) continue; // nothing to re-ground
    const [doc] = await db.select({ rawText: documents.rawText }).from(documents).where(eq(documents.id, e.evidenceDocumentId));
    expect(doc, `evidence doc ${e.evidenceDocumentId} exists`).toBeTruthy();
    const span = locateSpan(doc.rawText, e.snippet);
    expect(span, `edge ${e.id} snippet re-grounds in doc ${e.evidenceDocumentId}`).not.toBeNull();
    if (e.charStart !== null && e.charEnd !== null) {
      expect(e.charStart).toBeGreaterThanOrEqual(0);
      expect(e.charEnd).toBeLessThanOrEqual(doc.rawText.length);
      expect(e.charStart).toBeLessThanOrEqual(e.charEnd);
    }
  }
}

test("attribute_provenance spans re-ground via locateSpan within the source doc", async () => {
  // A representative sample across the graph (light, CQ-scoped check; Task 22 does the global one).
  const rows = (await rawSql`
    SELECT ap.snippet, ap.char_start, ap.char_end, d.raw_text
    FROM attribute_provenance ap
    JOIN documents d ON d.id = ap.document_id
    ORDER BY ap.id
    LIMIT 40
  `) as Array<{ snippet: string; char_start: number; char_end: number; raw_text: string }>;
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(locateSpan(r.raw_text, r.snippet), `attribute snippet "${r.snippet.slice(0, 40)}…" re-grounds`).not.toBeNull();
    expect(r.char_start).toBeGreaterThanOrEqual(0);
    expect(r.char_end).toBeLessThanOrEqual(r.raw_text.length);
  }
});

describe("failure isolation", () => {
  test("a malformed doc ends failed via advance()'s per-doc try/catch while the bundle stays ready", async () => {
    // Determinism: the doc is pre-seeded at status "indexed"/software_dev so advance() goes STRAIGHT
    // to the extract stage (no classify/index → zero cassette dependency). We then spy that one stage
    // to throw for THIS doc id only. The failure is a pure in-process throw on every run, offline —
    // it can NEVER be a flaky cassette miss. extractDoc is read through run.ts's live ESM binding, so
    // the spy intercepts the pipeline's call. Other docs are untouched.
    const extract = await import("@/lib/pipeline/extract");
    const [doc] = await db
      .insert(documents)
      .values({
        filename: "__malformed__.txt",
        mimeType: "text/plain",
        rawText: "REQ-X malformed.",
        docType: "PRD",
        domain: "software_dev",
        status: "indexed",
      })
      .returning();

    const spy = vi.spyOn(extract, "extractDoc").mockImplementation(async (documentId: number) => {
      if (documentId === doc.id) throw new Error("forced extract failure (deterministic, offline)");
      throw new Error("unexpected extractDoc call");
    });

    try {
      let status = "";
      for (let i = 0; i < 12; i++) {
        const res = await advance(doc.id);
        status = res.status;
        if (status === "ready" || status === "failed" || status === "unrouted") break;
      }
      expect(status).toBe("failed");
      expect(spy).toHaveBeenCalled(); // proves the forced throw is what failed it (not something else)

      const [reread] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, doc.id));
      expect(reread.status).toBe("failed");
    } finally {
      spy.mockRestore();
    }

    // Isolation: every bundle software_dev doc is still ready, and a CQ still answers correctly.
    for (const [file, gold] of Object.entries(labels.classification)) {
      if (gold.domain !== "software_dev") continue;
      const [d] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, resultByFile.get(file)!.id));
      expect(d.status, `${file} still ready after the malformed doc failed`).toBe("ready");
    }
    const q1 = await runCQ("requirements_without_test", {});
    await assertCQ("requirements_without_test", q1.rows, labels.cqAnswers.Q1.answer);
  });
});
