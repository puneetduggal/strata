"use client";

import { useEffect, useState } from "react";

type Doc = {
  id: number;
  filename: string;
  docType: string | null;
  domain: string | null;
  status: string;
};

// Linear pipeline for software_dev docs. Index of a status = how far it has progressed.
const PIPELINE = [
  "ingested",
  "classified",
  "indexed",
  "extracted",
  "resolved",
  "linked",
  "ready",
] as const;

function progressOf(status: string): number {
  const i = PIPELINE.indexOf(status as (typeof PIPELINE)[number]);
  return i < 0 ? 0 : (i / (PIPELINE.length - 1)) * 100;
}

// A doc rides one of four lifecycle "lanes". The lane drives the row variant,
// badge, and progress-bar recipe (catalog 02 §5a–d, §6).
type Lane = "ready" | "inflight" | "unrouted" | "failed";

function laneOf(status: string): Lane {
  if (status === "ready") return "ready";
  if (status === "unrouted") return "unrouted";
  if (status === "failed") return "failed";
  return "inflight"; // any non-terminal pipeline state
}

// Summary-tile counts derived from the polled docs (catalog 02 §3).
export function tileCounts(docs: Doc[]) {
  const counts = { ready: 0, inflight: 0, unrouted: 0, failed: 0 };
  for (const doc of docs) counts[laneOf(doc.status)]++;
  return counts;
}

// ── Summary tiles ────────────────────────────────────────────────────────────

function SummaryTiles({ docs }: { docs: Doc[] }) {
  const c = tileCounts(docs);
  const tiles: { count: number; color: string; caption: React.ReactNode }[] = [
    { count: c.ready, color: "text-text", caption: "Ready · graph-queryable" },
    {
      count: c.inflight,
      color: "text-accent",
      caption: (
        <>
          In&nbsp;flight · extracting
        </>
      ),
    },
    { count: c.unrouted, color: "text-warn", caption: "Off-domain · substrate only" },
    { count: c.failed, color: "text-gap", caption: "Failed · isolated, retryable" },
  ];

  return (
    <div className="mb-[18px] flex gap-[12px]">
      {tiles.map((t, i) => (
        <div
          key={i}
          className="flex-1 rounded-[11px] border border-border bg-surface p-[13px_16px]"
        >
          <div className={`text-[24px] font-bold tracking-[-.02em] ${t.color}`}>
            {t.count}
          </div>
          <div className="mt-px text-[11.5px] text-text-2">{t.caption}</div>
        </div>
      ))}
    </div>
  );
}

// ── Stage-rail legend (catalog 02 §4) ────────────────────────────────────────

function StageRail() {
  const stems = ["ingest", "classify", "index", "extract", "resolve", "link"];
  return (
    <div className="flex items-center gap-0 p-[0_4px_14px] font-mono text-[10px] text-text-3">
      {stems.map((s) => (
        <span key={s} className="flex-1">
          {s}
        </span>
      ))}
      <span className="w-[64px] text-right">ready</span>
    </div>
  );
}

// ── Badges (catalog 02 §6) ───────────────────────────────────────────────────

const BADGE_BASE =
  "rounded-[20px] px-[9px] py-[3px] font-mono text-[10.5px] font-semibold";

function StatusBadge({ status }: { status: string }) {
  const lane = laneOf(status);

  if (lane === "ready") {
    return (
      <span
        className={`${BADGE_BASE} text-ok`}
        style={{ background: "color-mix(in srgb, var(--ok) 14%, var(--surface))" }}
      >
        ready
      </span>
    );
  }

  if (lane === "failed") {
    return (
      <span
        className={`${BADGE_BASE} text-gap`}
        style={{ background: "color-mix(in srgb, var(--gap) 14%, var(--surface))" }}
      >
        failed
      </span>
    );
  }

  if (lane === "unrouted") {
    // Outlined neutral pill (no fill tint).
    return (
      <span className={`${BADGE_BASE} border border-border bg-surface text-text-2`}>
        unrouted · substrate
      </span>
    );
  }

  // in-flight: accent pill with a leading live dot, label = current status.
  return (
    <span
      className={`${BADGE_BASE} flex items-center gap-[6px] bg-accent-soft text-accent`}
    >
      <span className="h-[6px] w-[6px] rounded-full bg-accent" />
      {status}
    </span>
  );
}

// ── Progress bar (catalog 02 §5–§6) ──────────────────────────────────────────

function ProgressBar({ status }: { status: string }) {
  const lane = laneOf(status);

  // unrouted / failed don't ride the software_dev rail — flat empty track.
  if (lane === "unrouted" || lane === "failed") {
    return <div className="h-[5px] w-full rounded-[3px] bg-surface-2" />;
  }

  const pct = lane === "ready" ? 100 : progressOf(status);
  const fill = lane === "ready" ? "var(--ok)" : "var(--accent)";
  return (
    <div className="h-[5px] w-full overflow-hidden rounded-[3px] bg-surface-2">
      <div
        className="h-full rounded-[3px] transition-all duration-500"
        style={{ width: `${pct}%`, background: fill }}
      />
    </div>
  );
}

// ── Doc row (catalog 02 §5a–d) ───────────────────────────────────────────────

function rowStyle(lane: Lane): React.CSSProperties {
  switch (lane) {
    case "inflight":
      return {
        border: "1px solid var(--accent-line)",
        background: "color-mix(in srgb, var(--accent) 5%, var(--surface))",
      };
    case "unrouted":
      return { border: "1px dashed var(--border-2)", background: "var(--surface-2)" };
    case "failed":
      return {
        border: "1px solid color-mix(in srgb, var(--gap) 35%, var(--border))",
        background: "color-mix(in srgb, var(--gap) 5%, var(--surface))",
      };
    case "ready":
      return { border: "1px solid var(--border)", background: "var(--surface)" };
  }
}

function subtitle(doc: Doc): { text: string; className: string } {
  const lane = laneOf(doc.status);
  const meta = [doc.docType, doc.domain].filter(Boolean).join(" · ") || "—";
  if (lane === "unrouted") {
    const dom = doc.domain ?? "off-domain";
    return {
      text: `${doc.docType ?? "doc"} · ${dom} — no package yet`,
      className: "text-warn",
    };
  }
  if (lane === "failed") {
    return { text: "parse failed · no text extracted", className: "text-gap" };
  }
  return { text: meta, className: "text-text-3" };
}

function DocRow({ doc }: { doc: Doc }) {
  const lane = laneOf(doc.status);
  const sub = subtitle(doc);

  return (
    <li className="rounded-[11px] p-[13px_16px]" style={rowStyle(lane)}>
      <div className="mb-[9px] flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-[10px]">
          <span className="truncate font-mono text-[13px] font-medium">
            {doc.filename}
          </span>
          <span className={`truncate text-[11px] ${sub.className}`}>{sub.text}</span>
        </div>
        {lane === "failed" ? (
          <div className="flex flex-none items-center gap-[8px]">
            <button
              type="button"
              className="rounded-[20px] border border-border-2 bg-surface px-[10px] py-[3px] font-mono text-[10.5px] font-semibold text-text-2"
            >
              retry
            </button>
            <StatusBadge status={doc.status} />
          </div>
        ) : (
          <StatusBadge status={doc.status} />
        )}
      </div>

      <ProgressBar status={doc.status} />

      {lane === "unrouted" && (
        <p className="mt-[8px] text-[11px] text-text-3">
          Classified, chunked &amp; embedded — still RAG-queryable. It will join the graph
          the moment a Hiring package is registered. No pipeline change.
        </p>
      )}
    </li>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export default function ProcessingDashboard() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const body = (await res.json()) as { docs: Doc[] };
        if (alive) {
          setDocs(body.docs);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    }

    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section>
      {/* Section header (catalog 02 §1) */}
      <div className="mb-[14px] flex items-baseline gap-[12px]">
        <span className="font-mono text-[12px] font-semibold text-accent">02</span>
        <span className="text-[15px] font-semibold">Processing pipeline</span>
        <span className="text-[13px] text-text-2">
          A Postgres jobs state machine moves each doc through six isolated, idempotent
          stages. One doc failing never blocks the pile.
        </span>
      </div>

      <SummaryTiles docs={docs} />
      <StageRail />

      {error && (
        <p
          className="mb-[9px] rounded-[11px] px-[16px] py-[13px] text-[12px] text-gap"
          style={{ background: "color-mix(in srgb, var(--gap) 7%, var(--surface))" }}
        >
          Could not load status: {error}
        </p>
      )}

      {docs.length === 0 && !error ? (
        <p className="text-[13px] text-text-2">
          No documents yet. Upload some to see them processed here.
        </p>
      ) : (
        <ul className="flex flex-col gap-[9px]">
          {docs.map((doc) => (
            <DocRow key={doc.id} doc={doc} />
          ))}
        </ul>
      )}
    </section>
  );
}
