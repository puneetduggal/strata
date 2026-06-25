"use client";

import { SOFTWARE_PACKAGE } from "@/lib/packages/software";
import { buildInlinePath, nodeKey, nodeLabel, type EdgeRef } from "@/lib/query/ask-path";
import type { Suggestion } from "@/lib/query/suggestions";

export { buildInlinePath };
export type { EdgeRef, Suggestion };

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

// Citation link label: the doc's filename short-name when known, else `doc #{id}` (catalog §3c).
function docName(docNames: Map<number, string>, documentId: number): string {
  return docNames.get(documentId) ?? `doc #${documentId}`;
}

// ---------------------------------------------------------------------------
// Grouped competency-question chips (catalog §3b).
//
// The chips are now corpus-driven: `/api/suggestions` inspects the CURRENT graph and returns
// ready-to-render { id, group, label, question } entries with real entity names, so a parameterized
// chip submits a question the router can resolve (token-service etc. are no longer hard-coded). This
// component only renders them, grouping by `group` in arrival order. Category label color:
//   gaps → --gap, impact → --accent, lookup → --e-service.
// Clicking a chip fills + submits that suggestion's question.
// ---------------------------------------------------------------------------
const GROUP_COLOR: Record<string, string> = {
  gaps: "var(--gap)",
  impact: "var(--accent)",
  lookup: "var(--e-service)",
};

// Bucket suggestions by group, preserving first-seen group order and within-group order.
function groupSuggestions(suggestions: Suggestion[]): { name: string; items: Suggestion[] }[] {
  const groups: { name: string; items: Suggestion[] }[] = [];
  for (const s of suggestions) {
    let g = groups.find((x) => x.name === s.group);
    if (!g) {
      g = { name: s.group, items: [] };
      groups.push(g);
    }
    g.items.push(s);
  }
  return groups;
}

export default function AskBox({
  question,
  loading,
  error,
  result,
  activeCQ,
  suggestions,
  onQuestionChange,
  onSubmit,
  onSelectCQ,
  docNames,
}: {
  question: string;
  loading: boolean;
  error: string | null;
  result: AskResult | null;
  activeCQ: string | null;
  suggestions: Suggestion[];
  onQuestionChange: (q: string) => void;
  onSubmit: () => void;
  onSelectCQ: (id: string, question: string) => void;
  docNames: Map<number, string>;
}) {
  // Placeholder mirrors the blast-radius (impact) suggestion when one exists, so the example in the
  // input is also grounded in the current corpus; neutral fallback before suggestions load / empty graph.
  const placeholder =
    suggestions.find((s) => s.id === "Q3")?.question ??
    "Ask about a service, feature, or requirement…";
  const groups = groupSuggestions(suggestions);
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
            placeholder={placeholder}
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

      {/* §3b grouped CQ chips — corpus-driven (see groupSuggestions / /api/suggestions) */}
      <div className="mb-[18px] flex flex-col gap-[9px]">
        {groups.map((g) => (
          <div key={g.name} className="flex items-center gap-[9px]">
            <span
              className="w-[64px] flex-none font-mono text-[9.5px] uppercase tracking-[.05em]"
              style={{ color: GROUP_COLOR[g.name] ?? "var(--text-3)" }}
            >
              {g.name}
            </span>
            <div className="flex flex-wrap items-center gap-[9px]">
              {g.items.map((s) => {
                const selected = activeCQ === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    title={s.question}
                    onClick={() => onSelectCQ(s.id, s.question)}
                    className={`rounded-[7px] border px-[10px] py-[5px] text-[11.5px] ${
                      selected
                        ? "border-accent-line bg-accent-soft font-medium text-accent"
                        : "border-border bg-surface-2 text-text-2"
                    }`}
                  >
                    {s.label}
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

      {result && (
        <AnswerCard result={result} question={question} activeCQ={activeCQ} docNames={docNames} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §3c answer card
// ---------------------------------------------------------------------------
function AnswerCard({
  result,
  question,
  activeCQ,
  docNames,
}: {
  result: AskResult;
  question: string;
  activeCQ: string | null;
  docNames: Map<number, string>;
}) {
  const isTemplate = result.tier === "template";
  const edges = isTemplate ? (result.provenance.filter(isEdgeRef) as EdgeRef[]) : [];
  const chunks = !isTemplate ? (result.provenance.filter((p) => !isEdgeRef(p)) as ChunkRef[]) : [];
  const path = isTemplate ? buildInlinePath(edges) : null;

  // Method-meta string: the active CQ's template name. A clicked chip submits a corpus-specific
  // question (so an exact question-text match no longer works) — resolve by the chip's CQ id when
  // present, falling back to a question-text match for free-typed questions.
  const cq = activeCQ
    ? SOFTWARE_PACKAGE.competencyQuestions.find((c) => c.id === activeCQ)
    : SOFTWARE_PACKAGE.competencyQuestions.find((c) => c.question === question);
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
                ? edges.map((e) => <EdgeCard key={e.id} edge={e} docNames={docNames} />)
                : chunks.map((c) => <ChunkCard key={c.chunkId} chunk={c} docNames={docNames} />)}
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

function EdgeCard({ edge, docNames }: { edge: EdgeRef; docNames: Map<number, string> }) {
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
            {docName(docNames, edge.evidenceDocumentId)} →
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

function ChunkCard({ chunk, docNames }: { chunk: ChunkRef; docNames: Map<number, string> }) {
  return (
    <a
      href={docHref(chunk.documentId, chunk.charStart, chunk.charEnd)}
      className="block rounded-[9px] border border-border p-[9px_12px] hover:border-accent-line"
    >
      <div className="mb-[3px] flex items-center gap-[8px] text-[11.5px]">
        <span className="text-text-2">p.{chunk.page}</span>
        <span className="ml-auto flex-none font-mono text-[10px] text-accent">
          {docName(docNames, chunk.documentId)} →
        </span>
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
