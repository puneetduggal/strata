import { rawSql } from "@/lib/db/client";
import { embed } from "@/lib/embed/voyage";

export type EntityHit = {
  entityType: string;
  entityId: number;
  label: string;
  score: number;
};

type IndexRow = { entity_type: string; entity_id: number; label: string };

const PER_LIST = 20; // top-N kept from each ranked list before fusion
const TOP_K = 5; // final results returned
const RRF_K = 60; // Reciprocal Rank Fusion constant (standard default; dampens top-rank dominance)

// Format a JS number[] as a pgvector literal string, matching the schema's custom vector driver
// representation. We pass this string as a bound parameter and cast it with `::vector` so postgres-js
// still parameterizes the value (no string interpolation into the query).
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

// Map a row's identity to a stable key for fusion across the two ranked lists.
function keyOf(r: IndexRow): string {
  return `${r.entity_type}:${r.entity_id}`;
}

/**
 * Link a free-text mention to concrete entity ids using hybrid retrieval:
 *   1. Trigram lexical ranking over entity_index.search_text (pg_trgm word_similarity).
 *   2. Vector semantic ranking over entity_index.embedding (pgvector cosine distance).
 * The two ranked lists are fused with Reciprocal Rank Fusion and the top-k returned.
 */
export async function linkMention(
  mention: string,
  opts?: { type?: string },
): Promise<EntityHit[]> {
  const q = mention.trim();
  if (q.length === 0) return [];

  const type = opts?.type;

  // ---- Trigram list: rank by word_similarity(search_text, mention) desc ----
  const trigramRows = (await rawSql`
    SELECT entity_type, entity_id, label
    FROM entity_index
    WHERE word_similarity(search_text, ${q}) > 0
      ${type ? rawSql`AND entity_type = ${type}` : rawSql``}
    ORDER BY word_similarity(search_text, ${q}) DESC
    LIMIT ${PER_LIST}
  `) as IndexRow[];

  // ---- Vector list: rank by cosine closeness (embedding <=> qvec) asc ----
  const [qvec] = await embed([q]);
  const qlit = toVectorLiteral(qvec);
  const vectorRows = (await rawSql`
    SELECT entity_type, entity_id, label
    FROM entity_index
    WHERE embedding IS NOT NULL
      ${type ? rawSql`AND entity_type = ${type}` : rawSql``}
    ORDER BY embedding <=> ${qlit}::vector ASC
    LIMIT ${PER_LIST}
  `) as IndexRow[];

  // ---- Reciprocal Rank Fusion: score = Σ over lists of 1/(RRF_K + rank), 0-based rank ----
  const fused = new Map<string, { row: IndexRow; score: number }>();
  const fold = (rows: IndexRow[]) => {
    rows.forEach((row, rank) => {
      const key = keyOf(row);
      const prev = fused.get(key);
      const contribution = 1 / (RRF_K + rank);
      if (prev) prev.score += contribution;
      else fused.set(key, { row, score: contribution });
    });
  };
  fold(trigramRows);
  fold(vectorRows);

  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map(({ row, score }) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      label: row.label,
      score,
    }));
}
