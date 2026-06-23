import { describe, expect, test } from "vitest";
import { buildMatrix, renderReport, type MatrixInputs } from "../scripts/stress/meridian-report";

function passingInputs(): MatrixInputs {
  return {
    scorecard: { cq: { perCQ: [
      { id: "Q1", template: "requirements_without_test", ok: true },
      { id: "Q3", template: "service_blast_radius", ok: true },
      { id: "Q4", template: "feature_chain", ok: true },
      { id: "Q5", template: "service_datastore", ok: true },
      { id: "Q7", template: "service_decisions", ok: true },
      { id: "Q9", template: "feature_blast_radius", ok: true },
      { id: "Q10", template: "dependency_path", ok: true },
      { id: "Q2", template: "services_coverage_gaps", ok: true },
      { id: "Q6", template: "loadtest_vs_target", ok: true },
      { id: "Q8", template: "service_owner", ok: true },
    ], passed: 10, total: 10 }, classification: { perDoc: [{ file: "ARD-meridian.pdf", predicted: "ARD/software_dev", labeled: "ARD/software_dev", ok: true }], accuracy: 1 } } as any,
    integrity: { spanViolations: 0, endpointViolations: 0, apCount: 80, activeEdgeCount: 60 },
    statuses: { "PRD-meridian.pdf": "ready", "marketing-brief.pdf": "unrouted" },
    distinctKinds: ["CALLS","CONFIG","USES_LIBRARY","SHARES_DATA","CONSUMES_EVENT","READS_FROM"],
    q3Count: 4, q6Pass: { m4Passed: false, m5Passed: true }, q8PaymentOwners: [],
    sharedDatastore: true, resolutionByKey: { "Service:identity-service": 1, "Service:payment-service": 1, "Service:payments-gateway-service": 1 },
    identityProvenanceDocs: 3, marketingEntityCount: 0,
  };
}

describe("buildMatrix / renderReport", () => {
  test("all-green inputs produce 20 passing rows", () => {
    const m = buildMatrix(passingInputs());
    expect(m).toHaveLength(20);
    expect(m.every((r) => r.pass)).toBe(true);
  });
  test("a span violation fails the integrity rows (#17, #20)", () => {
    const inp = passingInputs(); inp.integrity.spanViolations = 3;
    const m = buildMatrix(inp);
    expect(m.find((r) => r.n === 17)!.pass).toBe(false);
    expect(m.find((r) => r.n === 20)!.pass).toBe(false);
  });
  test("missing DEPENDS_ON kind fails #5", () => {
    const inp = passingInputs(); inp.distinctKinds = ["CALLS"];
    expect(buildMatrix(inp).find((r) => r.n === 5)!.pass).toBe(false);
  });
  test("renderReport emits a markdown matrix with PASS/FAIL", () => {
    const md = renderReport(passingInputs().scorecard, buildMatrix(passingInputs()), passingInputs().integrity);
    expect(md).toContain("# Meridian Stress Report");
    expect(md).toMatch(/PASS|FAIL/);
  });
});
