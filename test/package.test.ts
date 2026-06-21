import { describe, expect, test } from "vitest";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software";

describe("SOFTWARE_PACKAGE structural invariants", () => {
  test("has 9 entity types", () => {
    expect(SOFTWARE_PACKAGE.entityTypes).toHaveLength(9);
  });

  test("has 10 relations", () => {
    expect(SOFTWARE_PACKAGE.relations).toHaveLength(10);
  });

  test("has 10 competency questions", () => {
    expect(SOFTWARE_PACKAGE.competencyQuestions).toHaveLength(10);
  });

  test("DEPENDS_ON has its 6 dependency kinds", () => {
    const dependsOn = SOFTWARE_PACKAGE.relations.find((r) => r.type === "DEPENDS_ON");
    expect(dependsOn).toBeDefined();
    expect(dependsOn?.kinds).toEqual(["CALLS", "CONSUMES_EVENT", "READS_FROM", "USES_LIBRARY", "SHARES_DATA", "CONFIG"]);
    expect(dependsOn?.kinds).toHaveLength(6);
  });

  test("every CQ template is unique", () => {
    const templates = SOFTWARE_PACKAGE.competencyQuestions.map((cq) => cq.template);
    expect(new Set(templates).size).toBe(templates.length);
  });

  test("every docTypeSources key is a declared docType", () => {
    const docTypes = new Set(SOFTWARE_PACKAGE.docTypes);
    for (const key of Object.keys(SOFTWARE_PACKAGE.docTypeSources)) {
      expect(docTypes).toContain(key);
    }
  });

  test("every sourced entity-type name is a declared entityTypes[].type", () => {
    const declared = new Set(SOFTWARE_PACKAGE.entityTypes.map((e) => e.type));
    for (const sourced of Object.values(SOFTWARE_PACKAGE.docTypeSources)) {
      for (const type of sourced) {
        expect(declared).toContain(type);
      }
    }
  });
});
