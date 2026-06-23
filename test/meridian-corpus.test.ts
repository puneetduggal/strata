import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const LABELS = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/meridian/labels.json"), "utf8"));

const ENTITY_TYPES = ["System","Feature","Requirement","Service","Datastore","Test","LoadTestResult","Decision","Person"];
const CQ_TEMPLATES = new Set(["requirements_without_test","services_coverage_gaps","service_blast_radius","feature_chain","service_datastore","loadtest_vs_target","service_decisions","service_owner","feature_blast_radius","dependency_path"]);

describe("meridian oracle shape", () => {
  test("top-level keys present", () => {
    for (const k of ["_about","system","classification","entities","links","cqAnswers"]) {
      expect(LABELS, k).toHaveProperty(k);
    }
    expect(LABELS.system).toBe("Meridian");
  });
  test("18 docs classified; exactly one off-domain", () => {
    const cls = Object.values(LABELS.classification) as Array<{domain:string}>;
    expect(Object.keys(LABELS.classification)).toHaveLength(18);
    expect(cls.filter((c) => c.domain !== "software_dev")).toHaveLength(1);
  });
  test("entity types are a subset of the package types", () => {
    for (const t of Object.keys(LABELS.entities)) expect(ENTITY_TYPES).toContain(t);
  });
  test("every link names a known relationType and the 6 DEPENDS_ON kinds all appear", () => {
    const kinds = new Set(LABELS.links.filter((l:any) => l.relationType === "DEPENDS_ON").map((l:any) => l.kind));
    for (const k of ["CALLS","CONFIG","USES_LIBRARY","SHARES_DATA","CONSUMES_EVENT","READS_FROM"]) {
      expect([...kinds], `kind ${k}`).toContain(k);
    }
  });
  test("all 10 CQs present with known templates", () => {
    expect(Object.keys(LABELS.cqAnswers)).toHaveLength(10);
    for (const spec of Object.values(LABELS.cqAnswers) as Array<{template:string}>) {
      expect(CQ_TEMPLATES.has(spec.template)).toBe(true);
    }
  });
});
