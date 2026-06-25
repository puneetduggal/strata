"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/shell/top-bar";
import AskBox, { type AskResult, type Suggestion } from "@/components/ask-box";

// Shown before /api/suggestions resolves and as the fallback when the graph is empty / the fetch
// fails. Only the two entity-free coverage-gap CQs — never references a specific (possibly stale)
// entity, so it can't reintroduce the "questions about a previous corpus" bug.
const FALLBACK_SUGGESTIONS: Suggestion[] = [
  {
    id: "Q1",
    group: "gaps",
    label: "Which requirements have no test?",
    question: "Which requirements have no verifying test?",
  },
  {
    id: "Q2",
    group: "gaps",
    label: "Which services lack a design doc or load test?",
    question: "Which services have no design doc / no load test?",
  },
];

// Strip the file extension so a documentId resolves to a catalog-style short-name
// (HLD.txt → HLD, HLD-auth.txt → HLD-auth) — matches the table/doc/graph short-name.
function shortName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

// Task 18 (reskin: catalog 04) — the Ask surface. A two-column body: the conversation column
// (input, grouped CQ chips, tiered answer card) and a 300px right panel (the 3-tier router ladder
// "How this was answered" + the entity-linking / disambiguation box). This page owns the shared
// AskResult state + the /api/ask fetch so both columns render from the same answer. The 60px icon
// rail and the <main> wrapper live in the global app shell (app/layout.tsx).
export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [activeCQ, setActiveCQ] = useState<string | null>(null);

  // Doc id → short-name for citation link labels (existing /api/status route; fetched once on
  // mount; graceful fallback to `doc #{id}` when the map lacks the id or the fetch fails).
  const [docNames, setDocNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((b: { docs: { id: number; filename: string }[] }) => {
        if (!cancelled) setDocNames(new Map(b.docs.map((d) => [d.id, shortName(d.filename)])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Starter-question chips, derived from the CURRENT graph (/api/suggestions). Falls back to the
  // entity-free gap questions until it resolves, or if the graph is empty / the fetch fails. The
  // same call returns a small sample of current service names for the entity-linking explainer.
  const [suggestions, setSuggestions] = useState<Suggestion[]>(FALLBACK_SUGGESTIONS);
  const [services, setServices] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/suggestions")
      .then((r) => (r.ok ? r.json() : { suggestions: [], services: [] }))
      .then((b: { suggestions: Suggestion[]; services?: string[] }) => {
        if (cancelled) return;
        if (b.suggestions?.length) setSuggestions(b.suggestions);
        if (b.services?.length) setServices(b.services);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function ask(q: string) {
    const trimmed = q.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
        return;
      }
      setResult((await res.json()) as AskResult);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  function selectCQ(id: string, q: string) {
    setActiveCQ(id);
    setQuestion(q);
    void ask(q);
  }

  return (
    <>
      <TopBar
        leaf="Ask"
        right={
          <span className="font-mono text-[11px] text-text-3">router: template · ToG · rag</span>
        }
      />
      <div className="flex min-h-0 flex-1">
        <AskBox
          question={question}
          loading={loading}
          error={error}
          result={result}
          activeCQ={activeCQ}
          suggestions={suggestions}
          onQuestionChange={(q) => {
            setQuestion(q);
            setActiveCQ(null);
          }}
          onSubmit={() => void ask(question)}
          onSelectCQ={selectCQ}
          docNames={docNames}
        />
        {result && <RightPanel result={result} services={services} />}
      </div>
    </>
  );
}

// §4 right panel — renders only once an answer exists.
function RightPanel({ result, services }: { result: AskResult; services: string[] }) {
  return (
    <aside className="flex w-[300px] flex-none flex-col gap-[18px] border-l border-border bg-surface p-[18px]">
      <RouterLadder tier={result.tier} />
      <EntityLinking services={services} />
    </aside>
  );
}

// §4a "How this was answered" — the 3-tier router ladder. The tier that produced this answer is
// highlighted; Think-on-Graph is always dimmed (a future tier, not implemented).
const LADDER: { n: string; title: string; sub: string; tier: "template" | "tog" | "rag" }[] = [
  { n: "1", title: "Template", sub: "10 known CQs · SQL", tier: "template" },
  { n: "2", title: "Think-on-Graph", sub: "bounded agent walk", tier: "tog" },
  { n: "3", title: "RAG", sub: "free-text fallback", tier: "rag" },
];

function RouterLadder({ tier }: { tier: "template" | "rag" }) {
  return (
    <div>
      <div className="mb-[10px] font-mono text-[10px] uppercase tracking-[.05em] text-text-3">
        How this was answered
      </div>
      <div className="flex flex-col gap-[7px]">
        {LADDER.map((row) => {
          // Think-on-Graph is never active; Template/RAG light up when they answered.
          const active = row.tier === tier;
          return (
            <div
              key={row.n}
              className={`flex items-center gap-[9px] rounded-[9px] p-[9px_11px] ${
                active ? "border border-accent-line bg-accent-soft" : "border border-border opacity-60"
              }`}
            >
              <span
                className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] font-mono text-[10px] font-bold ${
                  active ? "bg-accent text-white" : "bg-surface-2 text-text-2"
                }`}
              >
                {row.n}
              </span>
              <div className="min-w-0">
                <div className={`text-[12px] font-semibold ${active ? "text-accent" : ""}`}>
                  {row.title}
                </div>
                <div className="text-[10.5px] text-text-2">{row.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// §4b entity-linking / disambiguation box. The API exposes no resolved-mention metadata on the
// result, so this is an explainer of the hybrid-retrieval disambiguation UI (the "did you mean…"
// Strata shows when a mention is ambiguous). The example names are drawn from the CURRENT corpus
// (most-connected services from /api/suggestions) so it never shows a previous doc set's entities;
// the match scores are illustrative of the mechanism, not from this answer.
function EntityLinking({ services }: { services: string[] }) {
  const primary = services[0] ?? "your-service";
  const alt = services[1] ?? "another-service";
  return (
    <div className="rounded-[11px] border border-border bg-surface-2 p-[13px]">
      <div className="mb-[8px] font-mono text-[10px] uppercase tracking-[.05em] text-text-3">
        Entity linking
      </div>
      <p className="mb-[10px] text-[12px] leading-[1.5] text-text-2">
        “{primary}” matched <span className="font-semibold text-text">1 entity</span> via
        pgvector + trigram (RRF). When ambiguous, Strata asks:
      </p>
      <p className="mb-[8px] text-[11.5px] text-text">Did you mean…</p>
      <div className="flex flex-col gap-[6px]">
        <div className="rounded-[8px] border border-accent-line bg-surface p-[7px_10px] font-mono text-[11.5px] font-medium text-accent">
          {primary}<span className="font-normal text-text-3"> · 0.94</span>
        </div>
        <div className="rounded-[8px] border border-border bg-surface p-[7px_10px] font-mono text-[11.5px] text-text-2">
          {alt}<span className="text-text-3"> · 0.41</span>
        </div>
      </div>
      <p className="mt-[8px] font-mono text-[9.5px] text-text-3">scores illustrative</p>
    </div>
  );
}
