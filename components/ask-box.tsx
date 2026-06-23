"use client";

import { SOFTWARE_PACKAGE } from "@/lib/packages/software";
import { buildInlinePath, nodeKey, nodeLabel, type EdgeRef } from "@/lib/query/ask-path";

export { buildInlinePath };
export type { EdgeRef };

// Task 18 (reskin: catalog 04) — the ask conversation column.
// Posts a question to /api/ask and renders the cited, tiered answer. The router returns one of
// two tiers, each with its own provenance shape:
//   • "template" — a deterministic CQ answered it; provenance is the graph EDGES it traversed
//     (each carries evidenceDocumentId + char span + snippet → links to the source doc).
//   • "rag"      — free-text fallback; provenance is CHUNK refs (documentId + char span + snippet).
// Both link through to /doc/{documentId}?start&end (the Task 15 viewer). No new LLM calls here —
// this only calls the existing route. The page owns the shared result state so the right-panel
// router ladder + entity-linking box can render from the same AskResult.

export type ChunkRef = {
  chunkId: number;
  documentId: number;
  page: number;
  charStart: number;
  charEnd: number;
  snippet: string;
};

export type AskResult = {
  tier: "template" | "rag";
  answer: string;
  provenance: Array<EdgeRef | ChunkRef>;
};

function docHref(documentId: number, start?: number | null, end?: number | null): string {
  const qs = new URLSearchParams();
  if (start != null) qs.set("start", String(start));
  if (end != null) qs.set("end", String(end));
  const suffix = qs.toString();
  return `/doc/${documentId}${suffix ? `?${suffix}` : ""}`;
}

function isEdgeRef(p: EdgeRef | ChunkRef): p is EdgeRef {
  return "relationType" in p;
}

// ---------------------------------------------------------------------------
// Grouped competency-question chips (catalog §3b).
//
// The 10 CQs are bucketed under the catalog's category labels. Label color per category:
//   gaps → --gap, impact → --accent, lookup/trace/reconcile/rationale → --e-service.
// The verbatim catalog example strings are used as the chip face where they map cleanly to a CQ;
// otherwise the CQ's own `question` text is shown. Clicking a chip fills + submits that CQ.
// ---------------------------------------------------------------------------
const CQ_LABEL: Record<string, string> = {
  Q1: "Which requirements have no test?",
  Q2: "Services with no load test?",
  Q3: "What breaks if token-service changes?",
  Q9: "Blast radius of User Auth?",
  Q10: "How does Service X depend on Z?",
  Q4: "PRD→LLD→impl→load-test chain?",
  Q5: "What datastore does Service X use?",
  Q8: "Who owns auth-service?",
  Q6: "Did the load test meet target?",
  Q7: "What decisions affected Service X?",
};

const CQ_GROUPS: { label: string; color: string; ids: string[] }[] = [
  { label: "gaps", color: "var(--gap)", ids: ["Q1", "Q2"] },
  { label: "impact", color: "var(--accent)", ids: ["Q3", "Q9", "Q10"] },
  { label: "lookup", color: "var(--e-service)", ids: ["Q5", "Q8", "Q4", "Q6", "Q7"] },
];

const CQ_BY_ID = Object.fromEntries(SOFTWARE_PACKAGE.competencyQuestions.map((c) => [c.id, c]));

export default function AskBox({
  question,
  loading,
  error,
  result,
  activeCQ,
  onQuestionChange,
  onSubmit,
  onSelectCQ,
}: {
  question: string;
  loading: boolean;
  error: string | null;
  result: AskResult | null;
  activeCQ: string | null;
  onQuestionChange: (q: string) => void;
  onSubmit: () => void;
  onSelectCQ: (id: string, question: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-[24px_30px]">
      {/* §3a input row */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="mb-[14px] flex gap-[10px]"
      >
        <div className="flex h-[46px] flex-1 items-center gap-[10px] rounded-[11px] border border-border-2 bg-surface px-[15px] shadow-sm">
          <SearchIcon />
          <input
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            placeholder="What depends on the token-service — what breaks if it changes?"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-text outline-none placeholder:text-text-3"
          />
        </div>
        <button
          type="submit"
          disabled={loading || question.trim().length === 0}
          aria-label="Ask"
          className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-[11px] bg-accent text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Spinner /> : <ArrowIcon />}
        </button>
      </form>

      {/* §3b grouped CQ chips */}
      <div className="mb-[18px] flex flex-col gap-[9px]">
        {CQ_GROUPS.map((g) => (
          <div key={g.label} className="flex items-center gap-[9px]">
            <span
              className="w-[64px] flex-none font-mono text-[9.5px] uppercase tracking-[.05em]"
              style={{ color: g.color }}
            >
              {g.label}
            </span>
            <div className="flex flex-wrap items-center gap-[9px]">
              {g.ids.map((id) => {
                const cq = CQ_BY_ID[id];
                if (!cq) return null;
                const selected = activeCQ === id;
                return (
                  <button
                    key={id}
                    type="button"
                    title={cq.question}
                    onClick={() => onSelectCQ(id, cq.question)}
                    className={`rounded-[7px] border px-[10px] py-[5px] text-[11.5px] ${
                      selected
                        ? "border-accent-line bg-accent-soft font-medium text-accent"
                        : "border-border bg-surface-2 text-text-2"
                    }`}
                  >
                    {CQ_LABEL[id] ?? cq.question}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p
          className="mb-[14px] rounded-[9px] border px-[12px] py-[9px] text-[12px] text-gap"
          style={{ borderColor: "color-mix(in srgb, var(--gap) 35%, var(--border))", background: "color-mix(in srgb, var(--gap) 7%, var(--surface))" }}
        >
          {error}
        </p>
      )}

      {result && <AnswerCard result={result} question={question} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §3c answer card
// ---------------------------------------------------------------------------
function AnswerCard({ result, question }: { result: AskResult; question: string }) {
  const isTemplate = result.tier === "template";
  const edges = isTemplate ? (result.provenance.filter(isEdgeRef) as EdgeRef[]) : [];
  const chunks = !isTemplate ? (result.provenance.filter((p) => !isEdgeRef(p)) as ChunkRef[]) : [];
  const path = isTemplate ? buildInlinePath(edges) : null;

  // Method-meta string: the active CQ's template name (best-effort match by question text).
  const cq = SOFTWARE_PACKAGE.competencyQuestions.find((c) => c.question === question);
  const method = isTemplate
    ? cq
      ? `${cq.template} · deterministic SQL`
      : "deterministic SQL over the graph"
    : "pgvector cosine · free-text chunks";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[13px] border border-border bg-surface">
      {/* header */}
      <div className="flex items-center gap-[9px] border-b border-border p-[11px_16px]">
        <TierBadge tier={result.tier} />
        <span className="truncate font-mono text-[10.5px] text-text-3">{method}</span>
        <span className="ml-auto flex-none font-mono text-[11px] text-text-3">
          {result.provenance.length} citation{result.provenance.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* body */}
      <div className="overflow-auto p-[16px]">
        <AnswerProse answer={result.answer} />

        {path && (
          <div className="mb-[14px] flex flex-wrap items-center gap-[8px] rounded-[10px] bg-surface-2 p-[10px_13px]">
            {path.nodes.map((n, i) => {
              const focal = i === path.nodes.length - 1;
              return (
                <span key={nodeKey(n)} className="flex items-center gap-[8px]">
                  <span
                    className={`rounded-[6px] border px-[8px] py-[3px] font-mono text-[11.5px] font-semibold ${
                      focal
                        ? "border-accent-line bg-accent-soft text-accent"
                        : "border-border-2 bg-surface"
                    }`}
                  >
                    {nodeLabel(n)}
                  </span>
                  {i < path.steps.length && (
                    <span className="font-mono text-[9px] text-accent">
                      {path.steps[i].relationType} →
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {result.provenance.length > 0 && (
          <>
            <div className="mb-[8px] text-[10px] uppercase tracking-[.04em] text-text-3">
              {isTemplate ? "Contributing edges" : "Sources"}
            </div>
            <div className="flex flex-col gap-[7px]">
              {isTemplate
                ? edges.map((e) => <EdgeCard key={e.id} edge={e} />)
                : chunks.map((c) => <ChunkCard key={c.chunkId} chunk={c} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: "template" | "rag" }) {
  const tierColor = tier === "template" ? "var(--ok)" : "var(--cyan)";
  const label = tier === "template" ? "GRAPH · template" : "RAG";
  return (
    <span
      className="flex flex-none items-center gap-[5px] rounded-[20px] px-[9px] py-[3px] font-mono text-[10px] font-semibold"
      style={{ color: tierColor, background: `color-mix(in srgb, ${tierColor} 13%, var(--surface))` }}
    >
      <span className="h-[6px] w-[6px] rounded-[2px]" style={{ background: tierColor }} />
      {label}
    </span>
  );
}

// Prose with best-effort mono highlight of service-like names (kebab-case tokens such as
// `token-service`) that appear in the answer. The API returns no entity spans, so this is purely
// a presentational highlight keyed on the answer text itself; non-matching text renders normally.
const SERVICE_TOKEN = /\b([a-z0-9]+(?:-[a-z0-9]+)+)\b/g;
function AnswerProse({ answer }: { answer: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  SERVICE_TOKEN.lastIndex = 0;
  while ((m = SERVICE_TOKEN.exec(answer)) !== null) {
    if (m.index > last) parts.push(answer.slice(last, m.index));
    const isService = m[1].endsWith("-service");
    parts.push(
      <span
        key={m.index}
        className="font-mono font-semibold"
        style={isService ? { color: "var(--e-service)" } : undefined}
      >
        {m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < answer.length) parts.push(answer.slice(last));

  return (
    <p className="mb-[14px] whitespace-pre-wrap text-[13.5px] leading-[1.6] text-text">{parts}</p>
  );
}

function EdgeCard({ edge }: { edge: EdgeRef }) {
  const tag = edge.kind ? `${edge.relationType} · ${edge.kind}` : edge.relationType;
  const body = (
    <>
      <div className="mb-[3px] flex items-center gap-[8px] text-[11.5px]">
        <span className="rounded-[4px] bg-accent-soft px-[6px] py-[2px] font-mono text-[9.5px] font-semibold text-accent">
          {tag}
        </span>
        <span className="text-text-2">
          {edge.sourceType} #{edge.sourceId} → {edge.targetType} #{edge.targetId}
        </span>
        {edge.evidenceDocumentId != null && (
          <span className="ml-auto flex-none font-mono text-[10px] text-accent">
            doc #{edge.evidenceDocumentId} →
          </span>
        )}
      </div>
      {edge.snippet && (
        <p className="text-[11.5px] italic text-text-2">“{edge.snippet}”</p>
      )}
    </>
  );

  const cls = "block rounded-[9px] border border-border p-[9px_12px]";
  if (edge.evidenceDocumentId == null) return <div className={cls}>{body}</div>;
  return (
    <a href={docHref(edge.evidenceDocumentId, edge.charStart, edge.charEnd)} className={`${cls} hover:border-accent-line`}>
      {body}
    </a>
  );
}

function ChunkCard({ chunk }: { chunk: ChunkRef }) {
  return (
    <a
      href={docHref(chunk.documentId, chunk.charStart, chunk.charEnd)}
      className="block rounded-[9px] border border-border p-[9px_12px] hover:border-accent-line"
    >
      <div className="mb-[3px] flex items-center gap-[8px] text-[11.5px]">
        <span className="text-text-2">
          doc #{chunk.documentId} · p.{chunk.page}
        </span>
        <span className="ml-auto flex-none font-mono text-[10px] text-accent">doc #{chunk.documentId} →</span>
      </div>
      <p className="line-clamp-3 text-[11.5px] italic text-text-2">“{chunk.snippet}”</p>
    </a>
  );
}

// --- icons ------------------------------------------------------------------
function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" className="flex-none">
      <circle cx="11" cy="11" r="6.2" stroke="var(--text-3)" strokeWidth="1.8" />
      <path d="M20 20l-4.2-4.2" stroke="var(--text-3)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
