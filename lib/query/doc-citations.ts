import { rawSql } from "@/lib/db/client";

// Task 7 — the doc viewer's provenance loader. Given a documentId, collect every citation that
// grounds in that document so the viewer can (a) highlight the located spans inline and (b) list
// them in the citation rail. Two sources, one shape:
//   • attribute_provenance WHERE document_id = $id   — field-level value spans  → kind "attr"
//   • edges WHERE active AND evidence_document_id = $id — relation evidence spans → kind "edge"
//
// `entityType` drives the --e-* highlight/dot color: for an attribute it's the entity that owns
// the field; for an edge it's the SOURCE entity's type (so OWNS shows person, USES shows
// datastore-of-the-target… see below). Internal page loader only — no /api contract here.

export type DocCitation = {
  kind: "attr" | "edge";
  label: string; // human label for the rail chip (entity label / endpoint pair)
  relationOrField: string; // OWNS / USES / language / owner …
  entityType: string; // GraphNodeType-ish; drives the --e-* token
  charStart: number;
  charEnd: number;
  snippet: string | null;
  confidence: number; // extraction/link confidence (drives the rail card's Confidence stat)
  endpoints?: string; // "source → target" for edges
};

// entity type → typed table (mirrors SOFTWARE_PACKAGE.entityTypes). Trusted, never user input.
const TABLE_BY_TYPE: Record<string, string> = {
  System: "systems",
  Feature: "features",
  Requirement: "requirements",
  Service: "services",
  Datastore: "datastores",
  Test: "tests",
  LoadTestResult: "load_test_results",
  Decision: "decisions",
  Person: "persons",
};

// For an edge, which endpoint's entity type colors the citation. The catalog colors each edge by
// the "subject" of the relation — the same end the graph/table use for that relation's dot:
//   OWNS → person (source), USES → datastore (target), AFFECTS → decision (source),
//   DEPENDS_ON → service (source). Default to the source type.
const EDGE_COLOR_END: Record<string, "source" | "target"> = {
  USES: "target", // Service uses Datastore → datastore color
};

// Resolve labels for a batch of (entityType, entityId) refs in as few queries as possible
// (one query per distinct type). Returns a Map keyed by `${type}:${id}`.
async function resolveLabels(refs: Array<{ type: string; id: number }>): Promise<Map<string, string>> {
  const byType = new Map<string, Set<number>>();
  for (const r of refs) {
    const table = TABLE_BY_TYPE[r.type];
    if (!table) continue;
    let set = byType.get(r.type);
    if (!set) byType.set(r.type, (set = new Set()));
    set.add(r.id);
  }

  const out = new Map<string, string>();
  for (const [type, ids] of byType) {
    const table = TABLE_BY_TYPE[type];
    const rows = (await rawSql`
      SELECT id, label FROM ${rawSql(table)} WHERE id = ANY(${[...ids]}::int[])
    `) as Array<{ id: number; label: string }>;
    for (const row of rows) out.set(`${type}:${row.id}`, row.label);
  }
  return out;
}

/**
 * Every citation grounded in document `documentId`, from both provenance sources.
 * Returns `[]` for an unknown / citation-free document (never throws on empty).
 */
export async function getDocCitations(documentId: number): Promise<DocCitation[]> {
  if (!Number.isInteger(documentId) || documentId <= 0) return [];

  // --- Field-level attribute provenance (one row per extracted field span) ---
  const attrRows = (await rawSql`
    SELECT entity_type, entity_id, field, value, char_start, char_end, snippet, confidence
    FROM attribute_provenance
    WHERE document_id = ${documentId}::int
    ORDER BY char_start, char_end
  `) as Array<{
    entity_type: string;
    entity_id: number;
    field: string;
    value: string | null;
    char_start: number;
    char_end: number;
    snippet: string;
    confidence: number;
  }>;

  // --- Active edges whose evidence lives in this doc (one row per relation span) ---
  // Exclude MENTIONS (the chunk→entity lexical-mention layer): they're not entity-to-entity
  // citations — their endpoints are chunk ids and they'd swamp the rail. The rail shows the
  // typed structural relations (OWNS/USES/AFFECTS/DEPENDS_ON/…), matching the catalog.
  const edgeRows = (await rawSql`
    SELECT relation_type, kind, source_type, source_id, target_type, target_id,
           confidence, char_start, char_end, snippet
    FROM edges
    WHERE active AND evidence_document_id = ${documentId}::int
      AND char_start IS NOT NULL AND char_end IS NOT NULL
      AND relation_type <> 'MENTIONS'
    ORDER BY char_start, char_end
  `) as Array<{
    relation_type: string;
    kind: string | null;
    source_type: string;
    source_id: number;
    target_type: string;
    target_id: number;
    confidence: number;
    char_start: number;
    char_end: number;
    snippet: string | null;
  }>;

  // Resolve all endpoint labels referenced by the edges in one batched pass.
  const labelRefs: Array<{ type: string; id: number }> = [];
  for (const e of edgeRows) {
    labelRefs.push({ type: e.source_type, id: e.source_id });
    labelRefs.push({ type: e.target_type, id: e.target_id });
  }
  const labels = await resolveLabels(labelRefs);
  const labelOf = (type: string, id: number) => labels.get(`${type}:${id}`) ?? `${type}#${id}`;

  const attrCitations: DocCitation[] = attrRows.map((r) => ({
    kind: "attr",
    label: r.value && r.value.trim() !== "" ? r.value : r.field,
    relationOrField: r.field,
    entityType: r.entity_type,
    charStart: r.char_start,
    charEnd: r.char_end,
    snippet: r.snippet,
    confidence: r.confidence,
  }));

  const edgeCitations: DocCitation[] = edgeRows.map((e) => {
    const colorEnd = EDGE_COLOR_END[e.relation_type] ?? "source";
    const entityType = colorEnd === "target" ? e.target_type : e.source_type;
    const src = labelOf(e.source_type, e.source_id);
    const tgt = labelOf(e.target_type, e.target_id);
    const relation = e.kind ? `${e.relation_type} · ${e.kind}` : e.relation_type;
    return {
      kind: "edge",
      label: `${src} → ${tgt}`,
      relationOrField: relation,
      entityType,
      charStart: e.char_start,
      charEnd: e.char_end,
      snippet: e.snippet,
      confidence: e.confidence,
      endpoints: `${src} → ${tgt}`,
    };
  });

  // One ordered list, sorted by span start so the rail reads top-to-bottom with the doc.
  return [...attrCitations, ...edgeCitations].sort((a, b) => a.charStart - b.charStart || a.charEnd - b.charEnd);
}
