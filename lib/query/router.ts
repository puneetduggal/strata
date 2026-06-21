import { z } from "zod";
import { extractStructured, narrate } from "@/lib/llm/claude";
import { linkMention } from "@/lib/search/entity-index";
import { runCQ, isKnownCQ } from "@/lib/query/templates";
import { embed } from "@/lib/embed/voyage";
import { rawSql } from "@/lib/db/client";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software";

// Task 17 — the intent router.
//
// route(question) decides ONE of two tiers and always returns provenance:
//   - "template": the question maps to a deterministic competency-question (CQ) template. Claude
//     classifies the template + extracts entity mentions; linkMention fills the typed slots;
//     runCQ produces the rowset (the GROUND TRUTH — the LLM never decides set membership); narrate
//     phrases that rowset. Provenance = the active edges the CQ traversed.
//   - "rag": no template fits (or a required slot can't be resolved) → embed the question, fetch
//     the nearest chunks by cosine, narrate them with inline citations. Provenance = chunk refs
//     (documentId + char span) for click-through.

export type ChunkRef = {
  chunkId: number;
  documentId: number;
  page: number;
  charStart: number;
  charEnd: number;
  snippet: string;
};

export type RouteResult = {
  tier: "template" | "rag";
  answer: string;
  provenance: any[];
};

// ---------------------------------------------------------------------------
// Slot specification per template (single source of truth for slot filling).
//
// Each template declares the entity TYPE each slot expects and the param KEY runCQ wants. The
// classify step only returns a flat `mentions: string[]`; we map mentions positionally to slots,
// resolving each via linkMention scoped to the slot's type. The 0-param CQs declare `[]`.
// ---------------------------------------------------------------------------
type Slot = { type: string; param: string };

const SLOT_SPEC: Record<string, Slot[]> = {
  requirements_without_test: [],
  services_coverage_gaps: [],
  service_blast_radius: [{ type: "Service", param: "serviceId" }],
  service_datastore: [{ type: "Service", param: "serviceId" }],
  service_decisions: [{ type: "Service", param: "serviceId" }],
  service_owner: [{ type: "Service", param: "serviceId" }],
  feature_chain: [{ type: "Feature", param: "featureId" }],
  feature_blast_radius: [{ type: "Feature", param: "featureId" }],
  loadtest_vs_target: [{ type: "Requirement", param: "requirementId" }],
  dependency_path: [
    { type: "Service", param: "sourceId" },
    { type: "Service", param: "targetId" },
  ],
};

// ---------------------------------------------------------------------------
// Classify (one structured call). The system prompt is the CQ menu so Claude picks a template id
// or the "none" sentinel, and lists the entity phrases to resolve.
// ---------------------------------------------------------------------------
const ClassifySchema = z.object({
  template: z.string(), // one of the 10 CQ template ids, or "none"
  mentions: z.array(z.string()), // free-text entity phrases, in the order the template's slots expect
});

function classifySystemPrompt(): string {
  const menu = SOFTWARE_PACKAGE.competencyQuestions
    .map((cq) => `- ${cq.template}: ${cq.question}`)
    .join("\n");
  return [
    "You route a user's question to a deterministic query template, or to free-text search.",
    "Pick the SINGLE template whose question matches the user's intent, and return its template id.",
    "If none of the templates fit, return template = \"none\".",
    "Also extract the entity phrase(s) the question refers to, in the order the template needs them",
    "(e.g. dependency_path needs the source service first, then the target service).",
    "Return only the phrases as the user wrote them; do not resolve ids.",
    "",
    "Templates:",
    menu,
  ].join("\n");
}

// Format a JS number[] as a pgvector literal, passed as a BOUND param and cast with ::vector so
// postgres-js still parameterizes the value (no string interpolation into SQL). Mirrors Task 16.
function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

// ---------------------------------------------------------------------------
// RAG tier — nearest chunks by cosine, narrated with inline citations.
// ---------------------------------------------------------------------------
async function ragAnswer(question: string): Promise<RouteResult> {
  const [qvec] = await embed([question]);
  const qlit = toVectorLiteral(qvec);

  const rows = (await rawSql`
    SELECT id, document_id, page, char_start, char_end, text
    FROM chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> ${qlit}::vector ASC
    LIMIT 5
  `) as Array<{
    id: number;
    document_id: number;
    page: number;
    char_start: number;
    char_end: number;
    text: string;
  }>;

  const refs: ChunkRef[] = rows.map((r) => ({
    chunkId: r.id,
    documentId: r.document_id,
    page: r.page,
    charStart: r.char_start,
    charEnd: r.char_end,
    snippet: r.text,
  }));

  // Hand the retrieved chunk texts to the phrasing layer as ground truth, numbered for citation.
  const context = rows
    .map((r, i) => `[${i + 1}] (chunk ${r.id}, doc ${r.document_id}) ${r.text}`)
    .join("\n\n");
  const answer = await narrate({
    system:
      "Answer the question using ONLY the numbered context passages below. Cite the passages you " +
      "use inline as [1], [2], etc. If the context does not contain the answer, say so.",
    user: `Question: ${question}\n\nContext:\n${context}`,
  });

  return { tier: "rag", answer, provenance: refs };
}

export async function route(question: string): Promise<RouteResult> {
  // 1. Classify.
  const { template, mentions } = await extractStructured({
    system: classifySystemPrompt(),
    user: question,
    schema: ClassifySchema,
  });

  // 2. Template tier — only if the classified id is a real template.
  if (isKnownCQ(template)) {
    const slots = SLOT_SPEC[template] ?? [];
    const params: Record<string, number> = {};
    let allResolved = true;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const mention = mentions[i];
      if (!mention) {
        allResolved = false; // not enough mentions for this template's slots
        break;
      }
      const [hit] = await linkMention(mention, { type: slot.type });
      if (!hit) {
        allResolved = false; // mention didn't resolve to an entity of the required type
        break;
      }
      params[slot.param] = hit.entityId;
    }

    if (allResolved) {
      const result = await runCQ(template, params);
      const answer = await narrate({
        system:
          "Phrase a concise answer to the question using ONLY the structured result rows below as " +
          "ground truth. The rows ARE the answer set — do not add, drop, or invent members. If the " +
          "rows are empty, say nothing matched.",
        user: `Question: ${question}\n\nResult rows (JSON):\n${JSON.stringify(result.rows)}`,
      });
      return { tier: "template", answer, provenance: result.provenance };
    }
    // Unresolved slot → fall through to RAG (don't crash).
  }

  // 3. RAG tier (template === "none", unknown id, or an unresolved slot).
  return ragAnswer(question);
}
