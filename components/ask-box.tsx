"use client";

import { useState } from "react";

// Task 18 — the ask box. Posts a question to /api/ask and renders the cited answer.
// The router returns one of two tiers, each with its own provenance shape:
//   • "template" — a deterministic CQ answered it; provenance is the graph EDGES it traversed
//     (each carries evidenceDocumentId + char span + snippet → links to the source doc).
//   • "rag"      — free-text fallback; provenance is CHUNK refs (documentId + char span + snippet).
// Both link through to /doc/{documentId}?start&end (the Task 15 viewer). A small badge shows which
// tier answered. No new LLM calls here — this only calls the existing route.

type EdgeRef = {
  id: number;
  relationType: string;
  kind: string | null;
  sourceType: string;
  sourceId: number;
  targetType: string;
  targetId: number;
  evidenceDocumentId: number | null;
  charStart: number | null;
  charEnd: number | null;
  snippet: string | null;
};

type ChunkRef = {
  chunkId: number;
  documentId: number;
  page: number;
  charStart: number;
  charEnd: number;
  snippet: string;
};

type AskResult = {
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

export default function AskBox() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
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

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about the system — e.g. what depends on the auth service?"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || question.trim().length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Asking…" : "Ask"}
        </button>
      </form>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <TierBadge tier={result.tier} />
            <span className="text-xs text-gray-400">
              {result.provenance.length} citation{result.provenance.length === 1 ? "" : "s"}
            </span>
          </div>

          <p className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-800 shadow-sm">
            {result.answer}
          </p>

          {result.provenance.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {result.tier === "template" ? "Contributing edges" : "Sources"}
              </h2>
              <ul className="space-y-2">
                {result.tier === "template"
                  ? (result.provenance as EdgeRef[]).map((e) => <EdgeCitation key={e.id} edge={e} />)
                  : (result.provenance as ChunkRef[]).map((c) => <ChunkCitation key={c.chunkId} chunk={c} />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TierBadge({ tier }: { tier: "template" | "rag" }) {
  const styles =
    tier === "template"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-sky-200 bg-sky-50 text-sky-700";
  const label = tier === "template" ? "graph" : "search";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${styles}`}>
      {label} ({tier})
    </span>
  );
}

function EdgeCitation({ edge }: { edge: EdgeRef }) {
  const rel = edge.kind ? `${edge.relationType} · ${edge.kind}` : edge.relationType;
  const inner = (
    <>
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">{rel}</span>
        <span className="text-gray-500">
          {edge.sourceType} #{edge.sourceId} → {edge.targetType} #{edge.targetId}
        </span>
      </div>
      {edge.snippet && <p className="mt-1 text-sm italic text-gray-600">“{edge.snippet}”</p>}
    </>
  );

  if (edge.evidenceDocumentId == null) {
    return <li className="rounded-md border border-gray-200 bg-white px-3 py-2">{inner}</li>;
  }
  return (
    <li>
      <a
        href={docHref(edge.evidenceDocumentId, edge.charStart, edge.charEnd)}
        className="block rounded-md border border-gray-200 bg-white px-3 py-2 hover:border-blue-300 hover:bg-blue-50"
      >
        {inner}
      </a>
    </li>
  );
}

function ChunkCitation({ chunk }: { chunk: ChunkRef }) {
  return (
    <li>
      <a
        href={docHref(chunk.documentId, chunk.charStart, chunk.charEnd)}
        className="block rounded-md border border-gray-200 bg-white px-3 py-2 hover:border-blue-300 hover:bg-blue-50"
      >
        <div className="text-xs text-gray-500">
          doc #{chunk.documentId} · p.{chunk.page}
        </div>
        <p className="mt-1 line-clamp-3 text-sm italic text-gray-600">“{chunk.snippet}”</p>
      </a>
    </li>
  );
}
