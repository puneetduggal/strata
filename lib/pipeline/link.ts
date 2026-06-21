import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, rawSql } from "@/lib/db/client";
import { documents, edges } from "@/lib/db/schema";
import { extractStructured } from "@/lib/llm/claude";
import { locateSpan } from "@/lib/provenance/locate";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software";

// Stage 5 — reactive linker. Called once per resolved entity (Task 12 orchestrates).
// Proposes typed semantic edges between this entity and OTHER existing entities, grounds each
// against the source doc, thresholds the active flag, and idempotently upserts the edge row.

// The 9 SEMANTIC relations we link. MENTIONS is handled deterministically by the resolve stage.
const SEMANTIC = SOFTWARE_PACKAGE.relations.filter((r) => r.type !== "MENTIONS");

const LinkSchema = z.object({
  candidates: z.array(
    z.object({
      relationType: z.string(),
      kind: z.string().optional(),
      otherEntityLabel: z.string(),
      direction: z.enum(["out", "in"]),
      confidence: z.number(),
      snippet: z.string(),
    }),
  ),
});
type LinkResult = z.infer<typeof LinkSchema>;

type EntityRef = { type: string; id: number; label: string };

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const SYSTEM = `You connect ONE entity to OTHER existing entities in a software-engineering knowledge graph by proposing typed relation edges.

Only propose an edge when the document text supports it. For each candidate provide:
- relationType: one of the allowed relations below.
- kind: ONLY for DEPENDS_ON, one of its listed kinds; omit otherwise.
- otherEntityLabel: the label of the OTHER existing entity (choose from the candidate partners list).
- direction: "out" if THIS entity is the SOURCE (this --relation--> other), "in" if THIS entity is the TARGET (other --relation--> this).
- confidence: 0..1, how strongly the text supports this edge.
- snippet: an EXACT verbatim substring copied character-for-character from the document text that evidences the edge. If you cannot copy a verbatim snippet, do not propose the edge.

Do not invent entities or relations. Do not propose edges whose source/target types are not allowed by the relation definitions.`;

// Build the per-call user prompt: this entity, the relations it can participate in (with direction
// semantics + DEPENDS_ON kinds), the candidate partner labels, and the document text.
function buildUserPrompt(
  entity: EntityRef,
  relevant: typeof SEMANTIC,
  partners: Array<{ entityType: string; label: string }>,
  rawText: string,
): string {
  const relLines = relevant
    .map((r) => {
      const k = r.kinds ? ` (kinds: ${r.kinds.join(", ")})` : "";
      return `- ${r.type}: ${r.sourceType} --${r.type}--> ${r.targetType}${k}`;
    })
    .join("\n");

  const partnerLines = partners.length
    ? partners.map((p) => `- (${p.entityType}) ${p.label}`).join("\n")
    : "- (none yet)";

  return `THIS entity: type=${entity.type}, label="${entity.label}"

Allowed relations (with direction = source --relation--> target):
${relLines}

Candidate partner entities to consider (resolve otherEntityLabel to one of these labels):
${partnerLines}

--- DOCUMENT TEXT ---
${rawText}`;
}

// Resolve a free-text label to an existing entity id of the expected type, by normalized label
// equality OR membership in aliases. entity_index is the canonical search surface.
async function resolvePartner(entityType: string, label: string): Promise<number | null> {
  const target = norm(label);
  const rows = (await rawSql`
    SELECT entity_id, label, aliases
    FROM entity_index
    WHERE entity_type = ${entityType}
  `) as Array<{ entity_id: number; label: string; aliases: string[] | null }>;

  for (const r of rows) {
    if (norm(r.label) === target) return r.entity_id;
    for (const a of r.aliases ?? []) {
      if (norm(a) === target) return r.entity_id;
    }
  }
  return null;
}

// Idempotent upsert keyed on (relationType, sourceType, sourceId, targetType, targetId).
async function upsertEdge(row: {
  relationType: string;
  kind: string | null;
  sourceType: string;
  sourceId: number;
  targetType: string;
  targetId: number;
  confidence: number;
  active: boolean;
  evidenceDocumentId: number;
  charStart: number;
  charEnd: number;
  snippet: string;
}): Promise<void> {
  const [existing] = await db
    .select({ id: edges.id })
    .from(edges)
    .where(
      and(
        eq(edges.relationType, row.relationType),
        eq(edges.sourceType, row.sourceType),
        eq(edges.sourceId, row.sourceId),
        eq(edges.targetType, row.targetType),
        eq(edges.targetId, row.targetId),
      ),
    );

  if (existing) {
    await db
      .update(edges)
      .set({
        kind: row.kind,
        confidence: row.confidence,
        active: row.active,
        evidenceDocumentId: row.evidenceDocumentId,
        chunkId: null,
        charStart: row.charStart,
        charEnd: row.charEnd,
        snippet: row.snippet,
      })
      .where(eq(edges.id, existing.id));
  } else {
    await db.insert(edges).values({
      relationType: row.relationType,
      kind: row.kind,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      targetType: row.targetType,
      targetId: row.targetId,
      confidence: row.confidence,
      active: row.active,
      evidenceDocumentId: row.evidenceDocumentId,
      chunkId: null,
      charStart: row.charStart,
      charEnd: row.charEnd,
      snippet: row.snippet,
    });
  }
}

export async function linkEntity(entity: EntityRef, documentId: number): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Error(`link: document ${documentId} not found`);
  const rawText = doc.rawText;
  if (!rawText) return;

  // 1) Relation shapes where this entity could be source OR target.
  const relevant = SEMANTIC.filter((r) => r.sourceType === entity.type || r.targetType === entity.type);
  if (relevant.length === 0) return;

  // The partner types this entity can connect to (the opposite endpoint of each relevant relation).
  const partnerTypes = new Set<string>();
  for (const r of relevant) {
    if (r.sourceType === entity.type) partnerTypes.add(r.targetType);
    if (r.targetType === entity.type) partnerTypes.add(r.sourceType);
  }

  // 2) Pull existing entities of the partner types to give the model real targets.
  const partners: Array<{ entityType: string; label: string }> = [];
  for (const pt of partnerTypes) {
    const rows = (await rawSql`
      SELECT entity_type, label
      FROM entity_index
      WHERE entity_type = ${pt}
    `) as Array<{ entity_type: string; label: string }>;
    for (const r of rows) partners.push({ entityType: r.entity_type, label: r.label });
  }

  const result: LinkResult = await extractStructured<LinkResult>({
    system: SYSTEM,
    user: buildUserPrompt(entity, relevant, partners, rawText),
    schema: LinkSchema,
  });

  // Read THRESHOLD at call time so Task 24's sweep can vary LINK_THRESHOLD per run.
  const THRESHOLD = Number(process.env.LINK_THRESHOLD ?? 0.7);

  for (const c of result.candidates) {
    // (b-prep) Find the registry relation for this relationType.
    const rel = relevant.find((r) => r.type === c.relationType);
    if (!rel) continue; // unknown / not a relation this entity can be in → skip

    // Compute (sourceType, targetType) from direction + this entity's type + partner type.
    const otherType = rel.sourceType === entity.type ? rel.targetType : rel.sourceType;
    const sourceType = c.direction === "out" ? entity.type : otherType;
    const targetType = c.direction === "out" ? otherType : entity.type;

    // (b) Registry guard: the computed pair MUST match the registry relation's declared shape.
    if (sourceType !== rel.sourceType || targetType !== rel.targetType) continue;

    // (b) kind guard: kinds only allowed when the relation declares them (DEPENDS_ON).
    let kind: string | null = null;
    if (c.kind) {
      if (!rel.kinds || !rel.kinds.includes(c.kind)) continue; // illegal kind → skip
      kind = c.kind;
    }

    // (a) Resolve the partner label to an existing entity of otherType; skip if none yet exists
    //     (order-independence: the edge gets proposed from the other side later).
    const otherId = await resolvePartner(otherType, c.otherEntityLabel);
    if (otherId === null) continue;

    const sourceId = c.direction === "out" ? entity.id : otherId;
    const targetId = c.direction === "out" ? otherId : entity.id;

    // (c) Ground the snippet — anti-phantom: no span ⇒ no row at all.
    const span = locateSpan(rawText, c.snippet);
    if (!span) continue;

    // (d) active = confidence ≥ THRESHOLD (span already located).
    const active = c.confidence >= THRESHOLD;

    // (e) Idempotent upsert.
    await upsertEdge({
      relationType: rel.type,
      kind,
      sourceType,
      sourceId,
      targetType,
      targetId,
      confidence: c.confidence,
      active,
      evidenceDocumentId: documentId,
      charStart: span.charStart,
      charEnd: span.charEnd,
      snippet: c.snippet,
    });
  }
}
