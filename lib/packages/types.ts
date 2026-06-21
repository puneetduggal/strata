export type RelationDef = { type: string; inverse: string; sourceType: string; targetType: string; kinds?: string[] };
export type EntityTypeDef = { type: string; table: string; searchFields: string[] };
export type CQ = { id: string; question: string; kind: "lookup" | "coverage_gap" | "impact" | "trace" | "reconcile" | "rationale"; template: string };
export type GraphPackage = {
  id: string; docTypes: string[]; docTypeSources: Record<string, string[]>; entityTypes: EntityTypeDef[]; relations: RelationDef[]; competencyQuestions: CQ[];
};
