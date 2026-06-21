// Task 20 — scorecard: metric computation + pretty-print.
//
// Pure functions only. The harness gathers labeled (ground-truth) and predicted (live-graph)
// data, calls these to compute P/R/F1 + accuracy, and hands the assembled Scorecard to
// formatScorecard() for a readable stdout table. No DB / LLM access here — that lives in
// harness.ts so this stays trivially testable and deterministic.

export type PR = { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number };

// Precision/recall/F1 from raw counts. Guards the 0/0 cases to 0 (vacuously) so a metric with
// nothing to measure reports 0 rather than NaN.
export function prf(tp: number, fp: number, fn: number): PR {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}

// P/R/F1 by comparing two string-keyed sets (each key = one canonical item). tp = present in
// both, fp = predicted-not-labeled, fn = labeled-not-predicted.
export function prfFromSets(labeled: Set<string>, predicted: Set<string>): PR {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const k of predicted) (labeled.has(k) ? tp++ : fp++);
  for (const k of labeled) if (!predicted.has(k)) fn++;
  return prf(tp, fp, fn);
}

// Order-insensitive multiset/array equality (used for CQ answer-set comparisons).
export function sameSet(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (x: unknown) => JSON.stringify(x);
  const bv = b.map(norm).sort();
  const av = a.map(norm).sort();
  return av.every((x, i) => x === bv[i]);
}

// Order-sensitive array equality (used for ordered CQ answers like dependency paths).
export function sameOrdered(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => JSON.stringify(x) === JSON.stringify(b[i]));
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const f3 = (n: number) => n.toFixed(3);

// ---------------------------------------------------------------------------
// Scorecard shape — assembled by the harness, rendered here.
// ---------------------------------------------------------------------------
export type ThresholdRow = { t: number; pr: PR };

export type Scorecard = {
  classification: {
    perDoc: Array<{ file: string; predicted: string; labeled: string; ok: boolean }>;
    accuracy: number; // fraction of docs whose {docType,domain} both match
  };
  extraction: {
    entityPR: PR; // entity-level (type+label) presence
    fieldPR: PR; // field-level (type+label+key+value) presence
    perType: Array<{ type: string; entity: PR; field: PR }>;
    missing: string[]; // labeled items not found live (notable shortfalls)
    extra: string[]; // live items not in labels (notable shortfalls)
  };
  resolution: {
    pr: PR; // "one node per real-world thing"
    detail: Array<{ key: string; expected: 1; found: number; verdict: string }>;
  };
  linking: {
    cases: Array<{ mention: string; expectedLabel: string; gotLabel: string | null; ok: boolean }>;
    accuracy: number;
  };
  links: {
    sweep: ThresholdRow[];
    chosen: number; // the picked LINK_THRESHOLD
    chosenPR: PR;
    precisionTarget: number;
    activeAtChosen: number; // how many edges survive at the chosen threshold
    labeledCount: number;
    missing: string[]; // golden links missing at the chosen threshold
    falsePositives: string[]; // active links not in the golden set at the chosen threshold
  };
  cq: {
    perCQ: Array<{ id: string; template: string; ok: boolean; note?: string }>;
    passed: number;
    total: number;
  };
};

function bar(label: string): string {
  return `\n${"=".repeat(72)}\n  ${label}\n${"=".repeat(72)}`;
}

export function formatScorecard(sc: Scorecard): string {
  const out: string[] = [];

  out.push(bar("STRATA EVAL SCORECARD  (live pipeline vs fixtures/labels.json)"));

  // --- Classification ---
  out.push(bar("1. Classification accuracy (per-doc docType + domain)"));
  for (const d of sc.classification.perDoc) {
    out.push(`  ${d.ok ? "PASS" : "FAIL"}  ${d.file.padEnd(16)}  pred=${d.predicted.padEnd(28)} gold=${d.labeled}`);
  }
  out.push(`  -> accuracy: ${pct(sc.classification.accuracy)}  (${sc.classification.perDoc.filter((d) => d.ok).length}/${sc.classification.perDoc.length})`);

  // --- Extraction ---
  out.push(bar("2. Extraction P/R/F1"));
  out.push(`  entities (type+label):  P=${f3(sc.extraction.entityPR.precision)} R=${f3(sc.extraction.entityPR.recall)} F1=${f3(sc.extraction.entityPR.f1)}  (tp=${sc.extraction.entityPR.tp} fp=${sc.extraction.entityPR.fp} fn=${sc.extraction.entityPR.fn})`);
  out.push(`  fields   (key+value):   P=${f3(sc.extraction.fieldPR.precision)} R=${f3(sc.extraction.fieldPR.recall)} F1=${f3(sc.extraction.fieldPR.f1)}  (tp=${sc.extraction.fieldPR.tp} fp=${sc.extraction.fieldPR.fp} fn=${sc.extraction.fieldPR.fn})`);
  out.push(`  per entity type:`);
  for (const t of sc.extraction.perType) {
    out.push(`    ${t.type.padEnd(15)} entity F1=${f3(t.entity.f1)}  field F1=${f3(t.field.f1)} (field tp=${t.field.tp} fp=${t.field.fp} fn=${t.field.fn})`);
  }
  if (sc.extraction.missing.length) out.push(`  MISSING (labeled, not extracted): ${sc.extraction.missing.join("; ")}`);
  if (sc.extraction.extra.length) out.push(`  EXTRA (extracted, not labeled):   ${sc.extraction.extra.join("; ")}`);

  // --- Resolution ---
  out.push(bar("3. Entity-resolution P/R  (\"one node per real-world thing\")"));
  for (const d of sc.resolution.detail) {
    out.push(`  ${d.verdict.padEnd(12)} ${d.key.padEnd(28)} expected=1 found=${d.found}`);
  }
  out.push(`  -> P=${f3(sc.resolution.pr.precision)} R=${f3(sc.resolution.pr.recall)} F1=${f3(sc.resolution.pr.f1)}  (tp=${sc.resolution.pr.tp} fp=${sc.resolution.pr.fp} fn=${sc.resolution.pr.fn})`);

  // --- Linking ---
  out.push(bar("4. Entity-linking accuracy  (mention -> correct entity, top-1)"));
  for (const c of sc.linking.cases) {
    out.push(`  ${c.ok ? "PASS" : "FAIL"}  "${c.mention}" -> ${c.gotLabel ?? "(none)"}  (expected ${c.expectedLabel})`);
  }
  out.push(`  -> accuracy: ${pct(sc.linking.accuracy)}  (${sc.linking.cases.filter((c) => c.ok).length}/${sc.linking.cases.length})`);

  // --- Link P/R sweep ---
  out.push(bar("5. Link P/R/F1 @ threshold (swept 0.5 -> 0.9)"));
  out.push(`  threshold   P       R       F1      tp  fp  fn   active`);
  for (const row of sc.links.sweep) {
    const star = row.t === sc.links.chosen ? " <- CHOSEN" : "";
    out.push(
      `    ${row.t.toFixed(2)}     ${f3(row.pr.precision)}  ${f3(row.pr.recall)}  ${f3(row.pr.f1)}   ${String(row.pr.tp).padStart(2)}  ${String(row.pr.fp).padStart(2)}  ${String(row.pr.fn).padStart(2)}${star}`,
    );
  }
  out.push(`  golden links: ${sc.links.labeledCount}`);
  out.push(`  precision target: P >= ${f3(sc.links.precisionTarget)} (then max F1/recall)`);
  out.push(`  -> CHOSEN LINK_THRESHOLD = ${sc.links.chosen.toFixed(2)}  (P=${f3(sc.links.chosenPR.precision)} R=${f3(sc.links.chosenPR.recall)} F1=${f3(sc.links.chosenPR.f1)}, ${sc.links.activeAtChosen} active edges)`);
  if (sc.links.missing.length) out.push(`  MISSING golden links @chosen: ${sc.links.missing.join("; ")}`);
  if (sc.links.falsePositives.length) out.push(`  FALSE-POSITIVE links @chosen: ${sc.links.falsePositives.join("; ")}`);

  // --- CQ ---
  out.push(bar("6. CQ-answer correctness (10 templates vs labels.json.cqAnswers)"));
  for (const c of sc.cq.perCQ) {
    out.push(`  ${c.ok ? "PASS" : "FAIL"}  ${c.id.padEnd(4)} ${c.template.padEnd(26)}${c.note ? "  " + c.note : ""}`);
  }
  out.push(`  -> CQ pass: ${sc.cq.passed}/${sc.cq.total}`);

  // --- Headline ---
  out.push(bar("HEADLINE"));
  out.push(`  classification accuracy : ${pct(sc.classification.accuracy)}`);
  out.push(`  extraction F1 (entity)  : ${f3(sc.extraction.entityPR.f1)}`);
  out.push(`  extraction F1 (field)   : ${f3(sc.extraction.fieldPR.f1)}`);
  out.push(`  resolution F1           : ${f3(sc.resolution.pr.f1)}`);
  out.push(`  entity-linking accuracy : ${pct(sc.linking.accuracy)}`);
  out.push(`  link F1 @ chosen        : ${f3(sc.links.chosenPR.f1)}  (P=${f3(sc.links.chosenPR.precision)} R=${f3(sc.links.chosenPR.recall)})`);
  out.push(`  CQ pass                 : ${sc.cq.passed}/${sc.cq.total}`);
  out.push(`  CHOSEN LINK_THRESHOLD   : ${sc.links.chosen.toFixed(2)}`);
  out.push("");

  return out.join("\n");
}

// Pick the threshold meeting the precision target, then maximizing F1 (recall tiebreak). If no
// threshold meets the target, fall back to the max-F1 threshold so we always return one.
export function pickThreshold(sweep: ThresholdRow[], precisionTarget: number): ThresholdRow {
  const meeting = sweep.filter((r) => r.pr.precision >= precisionTarget);
  const pool = meeting.length > 0 ? meeting : sweep;
  return [...pool].sort((a, b) => {
    if (b.pr.f1 !== a.pr.f1) return b.pr.f1 - a.pr.f1;
    if (b.pr.recall !== a.pr.recall) return b.pr.recall - a.pr.recall;
    return a.t - b.t; // prefer the lower threshold on a full tie (more recall headroom)
  })[0];
}
