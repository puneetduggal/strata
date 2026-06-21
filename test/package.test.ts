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

  test("relation triples match canonical type/sourceType/targetType/inverse", () => {
    const expected = [
      { type: "PART_OF", sourceType: "Feature", targetType: "System", inverse: "HAS_FEATURE" },
      { type: "SPECIFIES", sourceType: "Requirement", targetType: "Feature", inverse: "SPECIFIED_BY" },
      { type: "IMPLEMENTS", sourceType: "Service", targetType: "Requirement", inverse: "IMPLEMENTED_BY" },
      { type: "DEPENDS_ON", sourceType: "Service", targetType: "Service", inverse: "DEPENDED_ON_BY" },
      { type: "USES", sourceType: "Service", targetType: "Datastore", inverse: "USED_BY" },
      { type: "VERIFIES", sourceType: "Test", targetType: "Requirement", inverse: "VERIFIED_BY" },
      { type: "VALIDATES", sourceType: "LoadTestResult", targetType: "Requirement", inverse: "VALIDATED_BY" },
      { type: "AFFECTS", sourceType: "Decision", targetType: "Service", inverse: "AFFECTED_BY" },
      { type: "OWNS", sourceType: "Person", targetType: "Service", inverse: "OWNED_BY" },
      { type: "MENTIONS", sourceType: "chunk", targetType: "*", inverse: "MENTIONED_IN" },
    ];
    const actual = SOFTWARE_PACKAGE.relations.map((r) => ({
      type: r.type,
      sourceType: r.sourceType,
      targetType: r.targetType,
      inverse: r.inverse,
    }));
    expect(actual).toEqual(expected);
  });

  test("each CQ kind matches the canonical id->kind map", () => {
    const expectedKinds: Record<string, string> = {
      Q1: "coverage_gap",
      Q2: "coverage_gap",
      Q3: "impact",
      Q4: "trace",
      Q5: "lookup",
      Q6: "reconcile",
      Q7: "rationale",
      Q8: "lookup",
      Q9: "impact",
      Q10: "impact",
    };
    const actualKinds = Object.fromEntries(
      SOFTWARE_PACKAGE.competencyQuestions.map((cq) => [cq.id, cq.kind]),
    );
    expect(actualKinds).toEqual(expectedKinds);
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
