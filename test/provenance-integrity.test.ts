import "dotenv/config";
import fs from "node:fs";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

// Task 22 — GLOBAL provenance-integrity invariant test.
//
// Strata's central guarantee is END-TO-END PROVENANCE: no attribute_provenance row and no ACTIVE edge
// may exist without a span that re-grounds in its source documents.raw_text. This test PROVES that
// guarantee across the WHOLE database (no sampling / no LIMIT): after ingesting the golden bundle
// through the real pipeline (offline, via the committed cassettes), it scans EVERY attribute_provenance
// row and EVERY active edge and asserts that each re-grounds via locateSpan, with in-bounds offsets
// whose stored slice ws-equals the model snippet. Expect 100%.
//
// Self-contained: it does NOT depend on Task 21 having run first (vitest file order isn't guaranteed).
// Its own beforeAll truncates the knowledge tables, re-ingests the bundle, and relinkAll()s — offline
// replay of the whole bundle is fast (<1s). Reuses Task 21's record/replay machinery + shared helpers.
//
// Isolation: truncates the shared DB + scans globally, so it runs ALONE and SERIALLY via
// vitest.integration.config.ts (excluded from the parallel unit pass).

import { hashRequest, recordReplay, mode, flush } from "./record-replay";
import { BUNDLE_DIR, canonicalizeUser, ingestFile, truncateKnowledge } from "./integration-helpers";

// Route the non-deterministic seams through the cassette (mirrors integration.test.ts). The mock is
// hoisted per-file so it must stay here, but its factory delegates to the SHARED canonicalizeUser +
// recordReplay so the cassette keys match Task 21's committed cassettes (expect zero new recordings).
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
vi.mock("@/lib/embed/voyage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/embed/voyage")>();
  const embed = async (texts: string[]): Promise<number[][]> => {
    const out: number[][] = [];
    for (const t of texts) {
      out.push(await recordReplay("embed", hashRequest(t), async () => (await real.embed([t]))[0]));
    }
    return out;
  };
  return { ...real, embed };
});

import { rawSql } from "@/lib/db/client";
import { relinkAll } from "@/lib/pipeline/run";
import { locateSpan } from "@/lib/provenance/locate";

// ws-normalize: locateSpan does ws-normalized back-mapping, so the stored slice should ws-equal the
// model snippet (Task 11 caveat — the stored snippet is the model's text, raw_text may differ by ws).
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const bundleFiles = fs.readdirSync(BUNDLE_DIR).filter((f) => f.endsWith(".txt")).sort();

beforeAll(async () => {
  // Self-contained: truncate + re-ingest the whole bundle through the real pipeline, then the
  // order-independent relinkAll() sweep. Offline replay is fast; this does not assume Task 21 ran.
  await truncateKnowledge();
  for (const file of bundleFiles) await ingestFile(file);
  await relinkAll();
}, 1_800_000); // generous headroom for the one-time RECORD run under Voyage's free-tier throttle

afterAll(async () => {
  if (mode() === "record") flush(); // persist any newly-recorded cassette entries
  await rawSql.end();
});

// Assert one span re-grounds in its source doc: non-null fields, locateSpan finds it, offsets in
// bounds, and the stored slice ws-equals the model snippet. `where` identifies the offending row.
function assertSpanReGrounds(row: {
  snippet: string | null;
  char_start: number | null;
  char_end: number | null;
  raw_text: string;
}, where: string): void {
  expect(row.snippet, `${where}: snippet non-null`).not.toBeNull();
  expect(row.char_start, `${where}: char_start non-null`).not.toBeNull();
  expect(row.char_end, `${where}: char_end non-null`).not.toBeNull();
  const snippet = row.snippet!;
  const charStart = row.char_start!;
  const charEnd = row.char_end!;
  const len = row.raw_text.length;
  // offsets valid: 0 <= char_start <= char_end <= raw_text.length
  expect(charStart, `${where}: char_start >= 0`).toBeGreaterThanOrEqual(0);
  expect(charStart, `${where}: char_start <= char_end`).toBeLessThanOrEqual(charEnd);
  expect(charEnd, `${where}: char_end <= raw_text.length (${len})`).toBeLessThanOrEqual(len);
  // anti-phantom: the snippet re-grounds in the source doc.
  expect(locateSpan(row.raw_text, snippet), `${where}: locateSpan re-grounds "${snippet.slice(0, 40)}…"`).not.toBeNull();
  // STRONG: the stored offsets actually locate the snippet (ws-normalized).
  expect(norm(row.raw_text.slice(charStart, charEnd)), `${where}: stored slice ws-equals snippet "${snippet.slice(0, 40)}…"`).toBe(norm(snippet));
}

test("EVERY attribute_provenance span re-grounds in its source document (whole DB, 100%)", async () => {
  const rows = (await rawSql`
    SELECT ap.id, ap.entity_type, ap.entity_id, ap.field,
           ap.snippet, ap.document_id, ap.char_start, ap.char_end, d.raw_text
    FROM attribute_provenance ap
    JOIN documents d ON d.id = ap.document_id
    ORDER BY ap.id
  `) as Array<{
    id: number; entity_type: string; entity_id: number; field: string;
    snippet: string | null; document_id: number; char_start: number | null; char_end: number | null; raw_text: string;
  }>;
  // NON-VACUOUS: a truncated/empty DB must not pass trivially.
  expect(rows.length, "attribute_provenance rows scanned").toBeGreaterThan(0);
  for (const r of rows) {
    assertSpanReGrounds(
      r,
      `attribute_provenance id=${r.id} (${r.entity_type}#${r.entity_id}.${r.field}, doc=${r.document_id})`,
    );
  }
});

test("EVERY active edge span re-grounds in its evidence document (whole DB, 100%)", async () => {
  const rows = (await rawSql`
    SELECT e.id, e.relation_type, e.source_type, e.source_id, e.target_type, e.target_id,
           e.snippet, e.evidence_document_id, e.char_start, e.char_end, d.raw_text
    FROM edges e
    JOIN documents d ON d.id = e.evidence_document_id
    WHERE e.active = true
    ORDER BY e.id
  `) as Array<{
    id: number; relation_type: string; source_type: string; source_id: number; target_type: string; target_id: number;
    snippet: string | null; evidence_document_id: number | null; char_start: number | null; char_end: number | null; raw_text: string;
  }>;
  // NON-VACUOUS: a truncated/empty DB must not pass trivially.
  expect(rows.length, "active edges scanned").toBeGreaterThan(0);
  // Every active edge MUST join an evidence doc — none may be dropped by the JOIN. Cross-check the
  // joined count against the raw active-edge count so a NULL evidence_document_id can't hide a span.
  const [{ count: activeCount }] = (await rawSql`
    SELECT COUNT(*)::int AS count FROM edges WHERE active = true
  `) as Array<{ count: number }>;
  expect(rows.length, "every active edge has an evidence document (none dropped by the JOIN)").toBe(activeCount);
  for (const r of rows) {
    assertSpanReGrounds(
      r,
      `edge id=${r.id} (${r.relation_type}: ${r.source_type}#${r.source_id}→${r.target_type}#${r.target_id}, evidence_doc=${r.evidence_document_id})`,
    );
  }
});
