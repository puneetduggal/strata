// Task 6 — pure stress-matrix + markdown report.
//
// Pure module: no DB / fs / network. The harness (Task 7) gathers the live-graph facts into a
// MatrixInputs, calls buildMatrix() to map them to the 20-row stress matrix (spec §4), then
// renderReport() to produce the markdown artifact. Kept side-effect-free so it stays trivially
// testable and deterministic.

import { type Scorecard, formatScorecard } from "../../test/eval/scorecard";

export type IntegrityResult = {
  spanViolations: number;
  endpointViolations: number;
  apCount: number;
  activeEdgeCount: number;
};

export type MatrixInputs = {
  scorecard: Scorecard;
  integrity: IntegrityResult;
  statuses: Record<string, string>;
  distinctKinds: string[];
  q3Count: number;
  q6Pass: { m4Passed: boolean | null; m5Passed: boolean | null };
  q8PaymentOwners: string[];
  sharedDatastore: boolean;
  resolutionByKey: Record<string, number>;
  identityProvenanceDocs: number;
  marketingEntityCount: number;
  expectedInDomain: number; // # of software_dev docs the oracle expects (row 19 completeness guard)
};

export type MatrixRow = { n: number; name: string; pass: boolean; detail: string };

// The six edge kinds the graph must surface (spec §4 row 5).
const REQUIRED_KINDS = ["CALLS", "CONFIG", "USES_LIBRARY", "SHARES_DATA", "CONSUMES_EVENT", "READS_FROM"];

export function buildMatrix(inp: MatrixInputs): MatrixRow[] {
  // CQ lookup by id; absent / not-ok => false.
  const cq = (id: string): boolean => inp.scorecard.cq.perCQ.find((c) => c.id === id)?.ok ?? false;

  const distinct = new Set(inp.distinctKinds);
  const missingKinds = REQUIRED_KINDS.filter((k) => !distinct.has(k));
  const inDomainStatuses = Object.entries(inp.statuses).filter(([f]) => f !== "marketing-brief.pdf");
  const inDomainReady = inDomainStatuses.filter(([, s]) => s === "ready");
  const classOk =
    inp.scorecard.classification.perDoc.find((d) => d.file === "ARD-meridian.pdf")?.ok ?? false;

  const rows: MatrixRow[] = [
    { n: 1, name: "Dependency path resolves (Q10)", pass: cq("Q10"), detail: `Q10 ok=${cq("Q10")}` },
    {
      n: 2,
      name: "Cycle-safe blast radius + path (Q3 & Q10)",
      pass: cq("Q3") && cq("Q10"),
      detail: `Q3=${cq("Q3")} Q10=${cq("Q10")}`,
    },
    { n: 3, name: "Service blast radius breadth", pass: inp.q3Count >= 3, detail: `q3Count=${inp.q3Count} (>=3)` },
    { n: 4, name: "Feature blast radius (Q9)", pass: cq("Q9"), detail: `Q9 ok=${cq("Q9")}` },
    {
      n: 5,
      name: "All six edge kinds present",
      pass: missingKinds.length === 0,
      detail: missingKinds.length === 0 ? "all 6 kinds present" : `missing: ${missingKinds.join(",")}`,
    },
    { n: 6, name: "Requirements without test (Q1)", pass: cq("Q1"), detail: `Q1 ok=${cq("Q1")}` },
    { n: 7, name: "Services coverage gaps (Q2)", pass: cq("Q2"), detail: `Q2 ok=${cq("Q2")}` },
    { n: 8, name: "Coverage-gap recall (Q2)", pass: cq("Q2"), detail: `Q2 ok=${cq("Q2")}` },
    {
      n: 9,
      name: "Loadtest vs target (M4 fail, M5 pass)",
      pass: inp.q6Pass.m4Passed === false && inp.q6Pass.m5Passed === true,
      detail: `m4Passed=${inp.q6Pass.m4Passed} m5Passed=${inp.q6Pass.m5Passed}`,
    },
    {
      n: 10,
      name: "Shared datastore + service datastore (Q5)",
      pass: inp.sharedDatastore && cq("Q5"),
      detail: `sharedDatastore=${inp.sharedDatastore} Q5=${cq("Q5")}`,
    },
    { n: 11, name: "Service decisions (Q7)", pass: cq("Q7"), detail: `Q7 ok=${cq("Q7")}` },
    {
      n: 12,
      name: "Service owner, no payment owners (Q8)",
      pass: cq("Q8") && inp.q8PaymentOwners.length === 0,
      detail: `Q8=${cq("Q8")} paymentOwners=${inp.q8PaymentOwners.length}`,
    },
    {
      n: 13,
      name: "Identity service resolves to one node",
      pass: inp.resolutionByKey["Service:identity-service"] === 1,
      detail: `identity-service found=${inp.resolutionByKey["Service:identity-service"] ?? 0}`,
    },
    {
      n: 14,
      name: "Payment + payments-gateway resolve to one node each",
      pass:
        inp.resolutionByKey["Service:payment-service"] === 1 &&
        inp.resolutionByKey["Service:payments-gateway-service"] === 1,
      detail: `payment=${inp.resolutionByKey["Service:payment-service"] ?? 0} payments-gateway=${inp.resolutionByKey["Service:payments-gateway-service"] ?? 0}`,
    },
    {
      n: 15,
      name: "Marketing brief unrouted, no entities",
      pass: inp.statuses["marketing-brief.pdf"] === "unrouted" && inp.marketingEntityCount === 0,
      detail: `status=${inp.statuses["marketing-brief.pdf"]} entities=${inp.marketingEntityCount}`,
    },
    {
      n: 16,
      name: "ARD classified correctly",
      pass: classOk,
      detail: `ARD-meridian.pdf classification ok=${classOk}`,
    },
    {
      n: 17,
      name: "No span violations",
      pass: inp.integrity.spanViolations === 0,
      detail: `spanViolations=${inp.integrity.spanViolations}`,
    },
    {
      n: 18,
      name: "Identity provenance across docs",
      pass: inp.identityProvenanceDocs >= 2,
      detail: `identityProvenanceDocs=${inp.identityProvenanceDocs} (>=2)`,
    },
    {
      n: 19,
      name: "All in-domain docs ready",
      pass:
        inp.expectedInDomain > 0 &&
        inDomainStatuses.length === inp.expectedInDomain &&
        inDomainStatuses.every(([, s]) => s === "ready"),
      detail: `ready ${inDomainReady.length}/${inp.expectedInDomain} in-domain docs (present ${inDomainStatuses.length})`,
    },
    {
      n: 20,
      name: "Edge integrity clean (spans + endpoints)",
      pass: inp.integrity.spanViolations === 0 && inp.integrity.endpointViolations === 0,
      detail: `spanViolations=${inp.integrity.spanViolations} endpointViolations=${inp.integrity.endpointViolations}`,
    },
  ];

  return rows;
}

export function renderReport(scorecard: Scorecard, matrix: MatrixRow[], integrity: IntegrityResult): string {
  // Headline counts.
  const cqPassed = scorecard.cq.passed;
  const cqTotal = scorecard.cq.total;
  const passCount = matrix.filter((r) => r.pass).length;
  // In-domain readiness, derived from classification (marketing-brief.pdf is out-of-domain).
  const inDomainReadyCount = scorecard.classification.perDoc.filter(
    (d) => d.file !== "marketing-brief.pdf" && d.ok,
  ).length;

  const out: string[] = [];
  out.push("# Meridian Stress Report");
  out.push("");
  out.push(
    `**Headline:** CQ ${cqPassed}/${cqTotal} | in-domain ready ${inDomainReadyCount} | ` +
      `matrix ${passCount}/${matrix.length} rows passing | ` +
      `integrity spanViolations=${integrity.spanViolations} endpointViolations=${integrity.endpointViolations} ` +
      `apCount=${integrity.apCount} activeEdgeCount=${integrity.activeEdgeCount}`,
  );
  out.push("");
  out.push("| # | scenario | result | detail |");
  out.push("| --- | --- | --- | --- |");
  for (const r of matrix) {
    out.push(`| ${r.n} | ${r.name} | ${r.pass ? "PASS" : "FAIL"} | ${r.detail} |`);
  }
  out.push("");
  out.push("## Scorecard");
  out.push("");
  out.push("```");
  // The harness always passes a fully-assembled Scorecard; guard so a partial one (e.g. tests)
  // still renders a report rather than throwing.
  try {
    out.push(formatScorecard(scorecard));
  } catch {
    out.push("(scorecard unavailable)");
  }
  out.push("```");
  out.push("");

  return out.join("\n");
}
