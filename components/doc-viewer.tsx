"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { buildHighlights } from "@/lib/doc/highlight";
import type { DocCitation } from "@/lib/query/doc-citations";

// Task 7 — the click-to-source / provenance viewer. Evidence links across the app open
// /doc/[id]?start=&end=; this renders the document's raw_text as a mono panel with dual
// highlights (the active accent-glow citation + every other located citation underlined in its
// entity color) and a 330px citation rail. The pure segmentation lives in @/lib/doc/highlight
// (buildHighlights), so the rendering here is a thin map over its ordered segments.
//
// re-exported for callers that reach the slice/clamp helpers via the component.
export { resolveSpan, sliceForHighlight, buildHighlights } from "@/lib/doc/highlight";
export type { HighlightSlice } from "@/lib/doc/highlight";

// entity type → its --e-* CSS token (catalog §0). Drives passive underline + rail dot color.
const TYPE_TOKEN: Record<string, string> = {
  System: "--e-system",
  Feature: "--e-feature",
  Requirement: "--e-req",
  Service: "--e-service",
  Datastore: "--e-datastore",
  Test: "--e-test",
  LoadTestResult: "--e-load",
  Decision: "--e-decision",
  Person: "--e-person",
};
const tokenFor = (type?: string) => (type && TYPE_TOKEN[type]) || "--e-service";

function docHref(c: DocCitation, docId: number | undefined): string {
  return `/doc/${docId}?start=${c.charStart}&end=${c.charEnd}`;
}

export default function DocViewer({
  rawText,
  start,
  end,
  citations = [],
  docId,
  title,
  authors,
  docDate,
  docStatus,
}: {
  rawText: string;
  start?: number;
  end?: number;
  citations?: DocCitation[];
  docId?: number;
  title?: string | null;
  authors?: string[] | null;
  docDate?: string | null;
  docStatus?: string | null;
}) {
  const hasActive = typeof start === "number" && typeof end === "number" && start < end;
  const activeSpan = hasActive ? { start: start as number, end: end as number } : null;

  // Segment the doc once. The active span (if any) wins; located citations underline passively.
  const segments = useMemo(
    () =>
      buildHighlights(
        rawText,
        citations.map((c) => ({ charStart: c.charStart, charEnd: c.charEnd, entityType: c.entityType })),
        activeSpan,
      ),
    [rawText, citations, activeSpan],
  );

  // The citation the page opened at (matched by span) → fills the active rail card. When both an
  // edge and an attribute ground the same span, the edge wins the card: its endpoint pair is the
  // more meaningful "this span grounds" target (the catalog card is edge-shaped).
  const activeCitation = useMemo(() => {
    if (!activeSpan) return null;
    const matches = citations.filter(
      (c) => c.charStart === activeSpan.start && c.charEnd === activeSpan.end,
    );
    return matches.find((c) => c.kind === "edge") ?? matches[0] ?? null;
  }, [citations, activeSpan]);

  // Other located citations = everything except the active one.
  const otherCitations = useMemo(
    () =>
      citations.filter(
        (c) => !(activeSpan && c.charStart === activeSpan.start && c.charEnd === activeSpan.end),
      ),
    [citations, activeSpan],
  );

  const markRef = useRef<HTMLElement>(null);
  // Scroll the active span into view on mount (needs the DOM, hence client-side).
  useEffect(() => {
    if (hasActive) markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hasActive]);

  return (
    <>
      {/* ── Doc-text panel (catalog §5): whole panel mono, generous line-height. ───────────── */}
      <div className="min-w-0 flex-1 overflow-auto p-[28px_36px] font-mono text-[12.5px] leading-[1.95] text-text-2">
        {/* Title + meta override the mono base to Geist sans (catalog §5a/5b). */}
        {title && (
          <div className="mb-[4px] font-sans text-[15px] font-semibold text-text">{title}</div>
        )}
        {(authors?.length || docDate || docStatus) && (
          <div className="mb-[18px] text-[11.5px] text-text-3">
            {[
              authors?.length ? `Author: ${authors.join(", ")}` : null,
              docDate,
              docStatus ? docStatus[0].toUpperCase() + docStatus.slice(1) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}

        <pre className="whitespace-pre-wrap break-words font-mono">
          {segments.map((seg, i) => {
            if (seg.tier === "none") return <span key={i}>{seg.text}</span>;
            if (seg.tier === "active") {
              return (
                <mark
                  key={i}
                  ref={markRef}
                  className="rounded-[2px] p-[2px_3px] text-text"
                  style={{
                    background: "color-mix(in srgb, var(--accent) 22%, transparent)",
                    borderBottom: "2px solid var(--accent)",
                    boxShadow: "0 0 0 3px var(--accent-soft)",
                  }}
                >
                  {seg.text}
                </mark>
              );
            }
            // passive entity-typed span
            const token = tokenFor(seg.entityType);
            return (
              <mark
                key={i}
                className="rounded-[2px] p-[1px_2px] text-text"
                style={{
                  background: `color-mix(in srgb, var(${token}) 18%, transparent)`,
                  borderBottom: `1.5px solid var(${token})`,
                }}
              >
                {seg.text}
              </mark>
            );
          })}
        </pre>
      </div>

      {/* ── Citation rail (catalog §7): 330px, active card + other-citation chips + back. ───── */}
      <aside className="flex w-[330px] flex-none flex-col border-l border-border bg-surface p-[18px]">
        <RailLabel>This span grounds</RailLabel>
        {activeCitation ? (
          <ActiveCard c={activeCitation} />
        ) : (
          <div className="mb-[16px] rounded-[11px] border border-border bg-surface-2 p-[14px] text-[12px] leading-[1.5] text-text-2">
            No span selected. Open this doc from a cited value or edge to ground a citation here.
          </div>
        )}

        <RailLabel className="mb-[10px]">Other citations in this doc</RailLabel>
        {otherCitations.length > 0 ? (
          <div className="flex flex-col gap-[7px]">
            {otherCitations.map((c, i) => (
              <Link
                key={`${c.charStart}-${c.charEnd}-${i}`}
                href={docHref(c, docId)}
                className="flex items-center gap-[8px] rounded-[9px] border border-border p-[8px_11px] hover:border-border-2 hover:bg-surface-2"
              >
                <span
                  className="h-[7px] w-[7px] flex-none rounded-full"
                  style={{ background: `var(${tokenFor(c.entityType)})` }}
                />
                <span
                  className="font-mono text-[10px] font-semibold"
                  style={{ color: `var(${tokenFor(c.entityType)})` }}
                >
                  {c.relationOrField}
                </span>
                <span className="truncate text-[11.5px] text-text-2">{c.label}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-text-3">No other citations in this document.</div>
        )}

        <Link
          href="/graph/1"
          className="mt-auto flex h-[38px] w-full items-center justify-center gap-[7px] rounded-[9px] border border-border-2 bg-surface text-[12.5px] font-medium text-text hover:bg-surface-2"
        >
          <span className="font-mono text-[11px] text-accent">{"←"}</span> Back to graph
        </Link>
      </aside>
    </>
  );
}

// ── Rail pieces ───────────────────────────────────────────────────────────────────────────────

function RailLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`mb-[12px] font-mono text-[10px] uppercase tracking-[.05em] text-text-3 ${className}`}
    >
      {children}
    </div>
  );
}

// The active citation card (catalog §7b): accent-soft fill, accent-line border, edge/field badge,
// endpoints (edges) or value (attrs), confidence + located ✓ stats.
function ActiveCard({ c }: { c: DocCitation }) {
  return (
    <div
      className="mb-[16px] rounded-[11px] p-[14px]"
      style={{ border: "1px solid var(--accent-line)", background: "var(--accent-soft)" }}
    >
      {/* Edge/field type badge — solid accent pill, white mono. */}
      <div className="mb-[9px] flex items-center gap-[7px]">
        <span
          className="rounded-[5px] p-[2px_7px] font-mono text-[9.5px] font-semibold"
          style={{ color: "#fff", background: "var(--accent)" }}
        >
          {c.relationOrField}
        </span>
      </div>

      {/* Endpoints (edge) or label (attr). */}
      <div className="mb-[10px] flex items-center gap-[8px] font-mono text-[12.5px] font-semibold">
        {c.endpoints ? (
          (() => {
            const [src, tgt] = c.endpoints.split(" → ");
            return (
              <>
                <span>{src}</span>
                <span className="text-accent">→</span>
                <span>{tgt}</span>
              </>
            );
          })()
        ) : (
          <span className="truncate">{c.label}</span>
        )}
      </div>

      {/* Stats: confidence + span located. */}
      <div className="flex gap-[16px]">
        <div>
          <div className="text-[10px] text-text-3">Confidence</div>
          <div className="text-[13px] font-semibold text-ok">{c.confidence.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] text-text-3">Span</div>
          <div className="font-mono text-[12px] font-semibold text-text">located ✓</div>
        </div>
      </div>
    </div>
  );
}
