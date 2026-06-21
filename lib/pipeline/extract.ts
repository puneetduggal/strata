import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  documents,
  systems,
  features,
  requirements,
  services,
  datastores,
  tests,
  loadTestResults,
  decisions,
  persons,
  attributeProvenance,
} from "@/lib/db/schema";
import { extractStructured } from "@/lib/llm/claude";
import { locateSpan } from "@/lib/provenance/locate";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software";

// Each typed entity table + the non-identity columns Claude may fill (the field keys
// it returns are matched against these; unknown keys are ignored).
const TABLES = {
  System: { table: systems, columns: ["description"] },
  Feature: { table: features, columns: ["description", "systemId"] },
  Requirement: { table: requirements, columns: ["text", "kind", "metric", "targetValue", "priority"] },
  Service: { table: services, columns: ["language", "description", "owner"] },
  Datastore: { table: datastores, columns: ["engine", "purpose"] },
  Test: { table: tests, columns: ["kind", "description"] },
  LoadTestResult: { table: loadTestResults, columns: ["scenario", "metric", "observedValue", "targetValue"] },
  Decision: { table: decisions, columns: ["status", "rationale"] },
  Person: { table: persons, columns: ["role"] },
} as const;

type EntityType = keyof typeof TABLES;

const ExtractSchema = z.object({
  entities: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      fields: z.record(z.string(), z.object({ value: z.string(), snippet: z.string() })),
    }),
  ),
});
type ExtractResult = z.infer<typeof ExtractSchema>;

export type EntityRef = { type: string; id: number; label: string };

const SYSTEM = `You extract typed entities from a single software-engineering document into a knowledge graph.

Return ONLY entities of the requested types. For each entity give a short identifying "label", and a "fields" object mapping each relevant field name to { value, snippet }.

CRITICAL provenance rule: every field's "snippet" MUST be an EXACT verbatim substring copied character-for-character from the document text. Do not paraphrase, summarize, or reformat a snippet. "value" is the cleaned/normalized value you read; "snippet" is the literal source text that supports it. If you cannot find a verbatim snippet for a field, omit that field entirely.`;

function buildUserPrompt(docType: string, types: EntityType[], rawText: string): string {
  const typeLines = types
    .map((t) => `- ${t}: fields [${(TABLES[t].columns as readonly string[]).join(", ")}]`)
    .join("\n");
  return `Document type: ${docType}

Extract ONLY these entity types and their fields (omit any field you cannot ground in a verbatim snippet):
${typeLines}

Always provide a "label" for each entity (the snippet rule does not apply to label).

--- DOCUMENT TEXT ---
${rawText}`;
}

export async function extractDoc(documentId: number): Promise<EntityRef[]> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Error(`extract: document ${documentId} not found`);

  const types = (SOFTWARE_PACKAGE.docTypeSources[doc.docType ?? ""] ?? []) as EntityType[];
  if (types.length === 0 || !doc.rawText) return [];

  const result: ExtractResult = await extractStructured<ExtractResult>({
    system: SYSTEM,
    user: buildUserPrompt(doc.docType!, types, doc.rawText),
    schema: ExtractSchema,
  });

  const refs: EntityRef[] = [];
  for (const entity of result.entities) {
    const spec = TABLES[entity.type as EntityType];
    if (!spec) continue; // ignore an entity type we didn't ask for / don't model

    const ref = await insertEntity(entity.type as EntityType, entity.label, entity.fields, doc.id, doc.rawText);
    refs.push(ref);
  }
  return refs;
}

async function insertEntity(
  type: EntityType,
  label: string,
  fields: Record<string, { value: string; snippet: string }>,
  documentId: number,
  rawText: string,
): Promise<EntityRef> {
  const spec = TABLES[type];
  const columns = spec.columns as readonly string[];

  // 1) Decide which fields are KEPT: a real column for this table AND its snippet locates.
  //    An unlocatable (hallucinated) field is dropped — its column never gets set and no
  //    provenance row is written.
  const kept: Array<{ field: string; value: string; snippet: string; charStart: number; charEnd: number }> = [];
  for (const [field, fv] of Object.entries(fields)) {
    if (!columns.includes(field)) continue; // unknown key → ignore
    const span = locateSpan(rawText, fv.snippet);
    if (!span) continue; // unlocatable → drop the field entirely
    kept.push({ field, value: fv.value, snippet: fv.snippet, ...span });
  }

  // 2) Insert the entity row with label + ONLY the kept columns.
  const row: Record<string, unknown> = { label };
  for (const k of kept) row[k.field] = k.value;
  const [inserted] = await db.insert(spec.table).values(row as never).returning({ id: spec.table.id });

  // 3) Provenance row per kept field.
  if (kept.length > 0) {
    await db.insert(attributeProvenance).values(
      kept.map((k) => ({
        entityType: type,
        entityId: inserted.id,
        field: k.field,
        value: k.value,
        documentId,
        charStart: k.charStart,
        charEnd: k.charEnd,
        snippet: k.snippet,
        confidence: 1,
      })),
    );
  }

  return { type, id: inserted.id, label };
}
