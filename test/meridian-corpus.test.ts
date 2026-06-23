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

const SRC_DIR = path.join(ROOT, "fixtures/meridian/src");
const srcFor = (pdfName: string) => fs.readFileSync(path.join(SRC_DIR, pdfName.replace(/\.pdf$/, ".md")), "utf8");

describe("meridian corpus consistency (docs match oracle)", () => {
  test("one .md src per classified .pdf", () => {
    for (const pdf of Object.keys(LABELS.classification)) {
      expect(fs.existsSync(path.join(SRC_DIR, pdf.replace(/\.pdf$/, ".md"))), pdf).toBe(true);
    }
  });
  test("every entity label appears verbatim in each of its sourceDocs", () => {
    for (const [type, list] of Object.entries(LABELS.entities) as [string, any[]][]) {
      for (const e of list) {
        for (const doc of e.sourceDocs) {
          expect(srcFor(doc).includes(e.label), `${type}:${e.label} in ${doc}`).toBe(true);
        }
      }
    }
  });
  test("every link's source+target labels appear verbatim in its groundedIn doc", () => {
    for (const l of LABELS.links as any[]) {
      const txt = srcFor(l.groundedIn);
      expect(txt.includes(l.source), `${l.relationType} source ${l.source} in ${l.groundedIn}`).toBe(true);
      expect(txt.includes(l.target), `${l.relationType} target ${l.target} in ${l.groundedIn}`).toBe(true);
    }
  });
  test("notification-service appears in NO HLD/LLD/ARD doc (noDesignDoc invariant)", () => {
    for (const pdf of ["HLD-meridian.pdf","LLD-identity.pdf","LLD-order.pdf","LLD-payment.pdf","LLD-gateway.pdf","ARD-meridian.pdf"]) {
      expect(srcFor(pdf).includes("notification-service"), `notification-service must NOT be in ${pdf}`).toBe(false);
    }
  });
  test("marketing-brief mentions no service label (stays off-domain)", () => {
    const txt = srcFor("marketing-brief.pdf");
    for (const s of (LABELS.entities.Service as any[])) {
      expect(txt.includes(s.label), `marketing brief must not name ${s.label}`).toBe(false);
    }
  });
});
