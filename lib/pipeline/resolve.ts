import { and, eq } from "drizzle-orm";
import { db, rawSql } from "@/lib/db/client";
import {
  documents,
  chunks,
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
  edges,
  entityIndex,
} from "@/lib/db/schema";
import { embed } from "@/lib/embed/voyage";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software";

// Map package type name (as stored in attribute_provenance.entity_type / entity_index.entity_type)
// → its typed table + the searchFields used to build search_text.
const TABLES = {
  System: systems,
  Feature: features,
  Requirement: requirements,
  Service: services,
  Datastore: datastores,
  Test: tests,
  LoadTestResult: loadTestResults,
  Decision: decisions,
  Person: persons,
} as const;

type EntityType = keyof typeof TABLES;

const SEARCH_FIELDS: Record<string, string[]> = Object.fromEntries(
  SOFTWARE_PACKAGE.entityTypes.map((e) => [e.type, e.searchFields]),
);

const TRIGRAM_THRESHOLD = 0.6;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// Build search_text = label + " " + values of the type's searchFields (excluding label),
// from the typed-table row.
function buildSearchText(type: EntityType, row: Record<string, unknown>): string {
  const fields = SEARCH_FIELDS[type] ?? ["label"];
  const parts: string[] = [String(row.label ?? "")];
  for (const f of fields) {
    if (f === "label") continue;
    const v = row[f];
    if (v != null && String(v).length > 0) parts.push(String(v));
  }
  return parts.join(" ").trim();
}

type ExistingMatch = { entityId: number; label: string; searchText: string; sim: number; exact: boolean };

// Find the best EXISTING entity_index row of the same type (≠ this entity) that matches by
// (a) normalized label equality, else (b) trigram similarity(search_text, query) ≥ 0.6.
// Prefer an exact label match; otherwise the highest similarity ≥ threshold.
async function findExistingMatch(
  type: EntityType,
  selfId: number,
  label: string,
  searchText: string,
): Promise<ExistingMatch | null> {
  const query = searchText.length > 0 ? searchText : label;
  const normLabel = norm(label);

  const rows = (await rawSql`
    SELECT entity_id, label, search_text,
           similarity(search_text, ${query}) AS sim
    FROM entity_index
    WHERE entity_type = ${type}
      AND entity_id <> ${selfId}
  `) as Array<{ entity_id: number; label: string; search_text: string; sim: number }>;

  let exact: ExistingMatch | null = null;
  let best: ExistingMatch | null = null;
  for (const r of rows) {
    const sim = Number(r.sim);
    if (norm(r.label) === normLabel) {
      if (!exact || sim > exact.sim) {
        exact = { entityId: r.entity_id, label: r.label, searchText: r.search_text, sim, exact: true };
      }
    }
    if (sim >= TRIGRAM_THRESHOLD && (!best || sim > best.sim)) {
      best = { entityId: r.entity_id, label: r.label, searchText: r.search_text, sim, exact: false };
    }
  }
  return exact ?? best;
}

// Repoint this entity's provenance onto the canonical, drop this entity's index + typed row,
// and fold its label into the canonical's aliases. Returns the canonical id.
async function mergeInto(type: EntityType, canonicalId: number, thisId: number, thisLabel: string): Promise<void> {
  await db
    .update(attributeProvenance)
    .set({ entityId: canonicalId })
    .where(and(eq(attributeProvenance.entityType, type), eq(attributeProvenance.entityId, thisId)));

  await db
    .delete(entityIndex)
    .where(and(eq(entityIndex.entityType, type), eq(entityIndex.entityId, thisId)));

  const table = TABLES[type];
  await db.delete(table).where(eq(table.id, thisId));

  // Fold this label into the canonical's aliases (distinct, excluding the canonical's own label).
  const [canonicalIdx] = await db
    .select()
    .from(entityIndex)
    .where(and(eq(entityIndex.entityType, type), eq(entityIndex.entityId, canonicalId)));
  if (canonicalIdx) {
    const aliases = new Set(canonicalIdx.aliases ?? []);
    if (norm(thisLabel) !== norm(canonicalIdx.label)) aliases.add(thisLabel);
    await db
      .update(entityIndex)
      .set({ aliases: Array.from(aliases) })
      .where(and(eq(entityIndex.entityType, type), eq(entityIndex.entityId, canonicalId)));
  }
}

// Upsert the canonical's entity_index row: label, aliases, search_text, embedding.
async function upsertIndex(type: EntityType, entityId: number): Promise<void> {
  const table = TABLES[type];
  const [row] = await db.select().from(table).where(eq(table.id, entityId));
  if (!row) return; // entity was merged away; nothing to index

  const label = String((row as { label: string }).label);
  const searchText = buildSearchText(type, row as Record<string, unknown>);
  const embedding = (await embed([searchText]))[0];

  const [existing] = await db
    .select()
    .from(entityIndex)
    .where(and(eq(entityIndex.entityType, type), eq(entityIndex.entityId, entityId)));

  if (existing) {
    const aliases = new Set(existing.aliases ?? []);
    await db
      .update(entityIndex)
      .set({ label, aliases: Array.from(aliases), searchText, embedding })
      .where(and(eq(entityIndex.entityType, type), eq(entityIndex.entityId, entityId)));
  } else {
    await db
      .insert(entityIndex)
      .values({ entityType: type, entityId, label, aliases: [], searchText, embedding });
  }
}

// Insert deterministic chunk —MENTIONS→ entity edges (confidence 1, active true) for every chunk
// whose text contains the entity label. Offsets are raw_text-relative (chunk.charStart is too),
// so raw_text.slice(charStart,charEnd) === label. Idempotent per (chunk, entity).
async function addMentions(
  type: EntityType,
  entityId: number,
  label: string,
  docChunks: Array<{ id: number; documentId: number; charStart: number; text: string }>,
): Promise<void> {
  for (const chunk of docChunks) {
    const at = chunk.text.indexOf(label);
    if (at < 0) continue;

    const charStart = chunk.charStart + at;
    const charEnd = charStart + label.length;

    const existing = await db
      .select({ id: edges.id })
      .from(edges)
      .where(
        and(
          eq(edges.relationType, "MENTIONS"),
          eq(edges.sourceType, "chunk"),
          eq(edges.sourceId, chunk.id),
          eq(edges.targetType, type),
          eq(edges.targetId, entityId),
        ),
      );
    if (existing.length > 0) continue;

    await db.insert(edges).values({
      relationType: "MENTIONS",
      sourceType: "chunk",
      sourceId: chunk.id,
      targetType: type,
      targetId: entityId,
      confidence: 1,
      active: true,
      evidenceDocumentId: chunk.documentId,
      chunkId: chunk.id,
      charStart,
      charEnd,
      snippet: label,
    });
  }
}

// Stage 4 — entity resolution + entity_index upsert + deterministic MENTIONS edges for one doc.
export async function resolveDoc(documentId: number): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Error(`resolve: document ${documentId} not found`);

  // 1) Freshly-extracted entities of this doc (those with at least one located field).
  const freshRows = await db
    .selectDistinct({ entityType: attributeProvenance.entityType, entityId: attributeProvenance.entityId })
    .from(attributeProvenance)
    .where(eq(attributeProvenance.documentId, documentId));

  // 3) (shared) This doc's chunks, for MENTIONS.
  const docChunks = await db
    .select({ id: chunks.id, documentId: chunks.documentId, charStart: chunks.charStart, text: chunks.text })
    .from(chunks)
    .where(eq(chunks.documentId, documentId));

  // 2) Process one entity at a time so earlier ones become canonical for later matches.
  for (const fresh of freshRows) {
    const type = fresh.entityType as EntityType;
    const table = TABLES[type];
    if (!table) continue; // unknown type → skip

    const [thisRow] = await db.select().from(table).where(eq(table.id, fresh.entityId));
    if (!thisRow) continue; // already merged away earlier in this loop

    const thisLabel = String((thisRow as { label: string }).label);
    const thisSearch = buildSearchText(type, thisRow as Record<string, unknown>);

    const match = await findExistingMatch(type, fresh.entityId, thisLabel, thisSearch);

    let canonicalId = fresh.entityId;
    if (match) {
      canonicalId = match.entityId;
      await mergeInto(type, canonicalId, fresh.entityId, thisLabel);
    }

    // Upsert the canonical's entity_index row (rebuild search_text/embedding from canonical row).
    await upsertIndex(type, canonicalId);

    // MENTIONS edges for the canonical using its (possibly canonical) label.
    const [canonicalRow] = await db.select().from(table).where(eq(table.id, canonicalId));
    const canonicalLabel = canonicalRow ? String((canonicalRow as { label: string }).label) : thisLabel;
    await addMentions(type, canonicalId, canonicalLabel, docChunks);
  }
}
