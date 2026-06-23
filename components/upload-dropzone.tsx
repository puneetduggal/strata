"use client";

import { useRef, useState } from "react";

const TERMINAL = new Set(["ready", "failed", "unrouted"]);
const MAX_STEPS = 12; // safety cap so a stuck pipeline never loops forever

type FileState = {
  name: string;
  size: number; // bytes, for the staged-row size column
  stage: string; // current pipeline message
  status: string; // last status returned by /api/process
  error?: string;
};

// Ingest one file, then drive /api/process until the doc reaches a terminal status.
async function processFile(
  file: File,
  onUpdate: (s: Partial<FileState>) => void,
): Promise<void> {
  onUpdate({ stage: "uploading", status: "" });

  const form = new FormData();
  form.append("file", file);
  const ingestRes = await fetch("/api/ingest", { method: "POST", body: form });
  if (!ingestRes.ok) {
    onUpdate({ stage: "ingest failed", status: "failed", error: await ingestRes.text() });
    return;
  }
  const { id } = (await ingestRes.json()) as { id: number };
  onUpdate({ stage: "ingested", status: "ingested" });

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documentId: id }),
    });
    if (!res.ok) {
      onUpdate({ stage: "process error", status: "failed", error: await res.text() });
      return;
    }
    const { stage, status } = (await res.json()) as { stage: string; status: string };
    onUpdate({ stage, status });
    if (TERMINAL.has(status)) return;
  }
  onUpdate({ stage: "stopped (max steps)", status: "failed" });
}

// ── Badge / entity derivation (catalog 01 §6b) ───────────────────────────────
// A staged file's type badge is keyed to the graph entity it will produce. We
// derive the doc type from the filename before classification has run; anything
// we can't place is the neutral off-domain "?" variant (indexed-to-substrate).
type Badge = { label: string; color: string; description: string } | null;

const DOC_BADGES: { test: RegExp; badge: NonNullable<Badge> }[] = [
  { test: /\bprd\b/, badge: { label: "PRD", color: "var(--e-feature)", description: "Features, requirements & NFR targets" } },
  { test: /\bhld\b/, badge: { label: "HLD", color: "var(--e-service)", description: "Services, dependencies, datastores" } },
  { test: /\blld\b/, badge: { label: "LLD", color: "var(--e-service)", description: "Service internals, USES datastore" } },
  { test: /\badr\b/, badge: { label: "ADR", color: "var(--e-decision)", description: "Decisions + AFFECTS links" } },
  { test: /impl|plan/, badge: { label: "IMPL", color: "var(--e-req)", description: "IMPLEMENTS links (Service → Requirement)" } },
  { test: /load|perf|bench/, badge: { label: "LOAD", color: "var(--e-load)", description: "LoadTestResults + VALIDATES" } },
];

// null badge ⇒ off-domain row: neutral "?" badge, dashed/tinted row, warn description.
function badgeFor(name: string): Badge {
  const key = name.toLowerCase();
  for (const { test, badge } of DOC_BADGES) if (test.test(key)) return badge;
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// ── Staged file row (catalog 01 §6b) ─────────────────────────────────────────

function TypeBadge({ badge }: { badge: Badge }) {
  // Off-domain: neutral "?" with a border (the only badge with a border).
  if (!badge) {
    return (
      <span className="w-[42px] flex-none rounded-[5px] border border-border bg-surface px-[6px] py-[4px] text-center font-mono text-[10px] font-semibold text-text-3">
        ?
      </span>
    );
  }
  return (
    <span
      className="w-[42px] flex-none rounded-[5px] px-[6px] py-[4px] text-center font-mono text-[10px] font-semibold"
      style={{
        color: badge.color,
        background: `color-mix(in srgb, ${badge.color} 13%, var(--surface))`,
      }}
    >
      {badge.label}
    </span>
  );
}

function StagedRow({ file }: { file: FileState }) {
  const badge = badgeFor(file.name);
  const offDomain = badge === null;
  // While processing, the live pipeline stage replaces the resting description.
  const processing = file.status !== "" || file.stage !== "staged";
  const description = processing
    ? file.stage
    : offDomain
      ? "off-domain — indexed to substrate, no graph package yet"
      : badge.description;
  const failed = file.status === "failed";
  const descColor = failed
    ? "text-gap"
    : offDomain && !processing
      ? "text-warn"
      : "text-text-3";

  return (
    <li
      className="flex items-center gap-3 rounded-[10px] p-[11px_14px]"
      style={
        offDomain
          ? { border: "1px dashed var(--border-2)", background: "var(--surface-2)" }
          : { border: "1px solid var(--border)", background: "var(--surface)" }
      }
    >
      <TypeBadge badge={badge} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[12.5px] font-medium">{file.name}</div>
        <div className={`truncate text-[11px] ${descColor}`}>{description}</div>
      </div>
      <span className="flex-none font-mono text-[11px] text-text-3">
        {formatSize(file.size)}
      </span>
    </li>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function UploadDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  // Staged File objects (kept alongside their UI FileState by index) so the
  // ingest button can drive the existing process loop over them.
  const [staged, setStaged] = useState<File[]>([]);
  const [files, setFiles] = useState<FileState[]>([]);

  // Drop/select now STAGES files; the explicit Ingest button runs the loop.
  function stageFiles(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    const picked = Array.from(list);
    setStaged(picked);
    setFiles(picked.map((f) => ({ name: f.name, size: f.size, stage: "staged", status: "" })));
  }

  async function ingest() {
    if (staged.length === 0 || busy) return;
    setBusy(true);
    // Process sequentially — keeps the live demo legible and avoids hammering the LLM/embed APIs.
    for (let i = 0; i < staged.length; i++) {
      await processFile(staged[i], (s) =>
        setFiles((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...s } : row))),
      );
    }
    setBusy(false);
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <>
      {/* LEFT COLUMN — dropzone + callout (catalog 01 §5) */}
      <div className="flex flex-col">
        <div
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            stageFiles(e.dataTransfer.files);
          }}
          className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-[14px] border-2 border-dashed p-[30px] text-center transition-colors ${
            busy ? "cursor-not-allowed opacity-60" : ""
          }`}
          style={
            dragOver
              ? {
                  borderColor: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 7%, var(--surface-2))",
                }
              : { borderColor: "var(--border-2)", background: "var(--surface-2)" }
          }
        >
          <span className="mb-[18px] flex h-[58px] w-[58px] items-center justify-center rounded-[15px] bg-accent-soft text-accent">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V5 M12 5l-4.5 4.5 M12 5l4.5 4.5" />
              <path d="M4 19h16" />
            </svg>
          </span>
          <p className="text-[16px] font-semibold">Drop documents to ingest</p>
          <p className="mt-1 max-w-[300px] text-[13px] leading-[1.5] text-text-2">
            or <span className="font-medium text-accent">browse files</span>. Digital PDF, DOCX
            &amp; TXT. OCR / scanned docs are out of scope in v1.
          </p>
          <div className="mt-[18px] flex gap-[7px]">
            {[".pdf", ".docx", ".txt"].map((ext) => (
              <span
                key={ext}
                className="rounded-[5px] border border-border bg-surface px-[8px] py-[3px] font-mono text-[10.5px] text-text-2"
              >
                {ext}
              </span>
            ))}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,application/pdf,text/plain"
            className="hidden"
            onChange={(e) => stageFiles(e.target.files)}
          />
        </div>

        {/* "One connected story." callout (catalog 01 §5b) */}
        <div
          className="mt-[16px] flex items-start gap-[11px] rounded-[11px] p-[14px_16px]"
          style={{
            background: "color-mix(in srgb, var(--accent) 7%, var(--surface))",
            border: "1px solid var(--accent-line)",
          }}
        >
          <span className="mt-[5px] h-[7px] w-[7px] flex-none rounded-full bg-accent" />
          <p className="text-[12.5px] leading-[1.5] text-text-2">
            <span className="font-semibold text-text">One connected story.</span> Don&apos;t just
            drop one file — drop the whole bundle. Strata recovers the links{" "}
            <em>between</em> a PRD, its design docs, the tests, and the load report.
          </p>
        </div>
      </div>

      {/* RIGHT COLUMN — staged list + ingest button (catalog 01 §6) */}
      <div className="flex min-h-0 flex-col">
        <div className="mb-[12px] flex items-center justify-between">
          <span className="text-[13px] font-semibold">
            Staged — {files.length} {files.length === 1 ? "file" : "files"}
          </span>
          {files.length > 0 && (
            <span className="font-mono text-[11px] text-text-3">
              ~{formatSize(totalSize)} · Helios bundle
            </span>
          )}
        </div>

        {files.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-[10px] border border-dashed border-border-2 text-[12.5px] text-text-3">
            Drop or browse files to stage them here.
          </div>
        ) : (
          <ul className="flex flex-1 flex-col gap-[8px] overflow-auto">
            {files.map((f, i) => (
              <StagedRow key={i} file={f} />
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={ingest}
          disabled={files.length === 0 || busy}
          className="mt-[14px] flex h-[42px] items-center justify-center gap-[8px] rounded-[10px] bg-accent text-[13.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Ingesting…" : `Ingest ${files.length} ${files.length === 1 ? "document" : "documents"}`}
          <span className="font-mono text-[11px] opacity-80">→</span>
        </button>
      </div>
    </>
  );
}
