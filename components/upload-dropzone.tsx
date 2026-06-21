"use client";

import { useRef, useState } from "react";

const TERMINAL = new Set(["ready", "failed", "unrouted"]);
const MAX_STEPS = 12; // safety cap so a stuck pipeline never loops forever

type FileState = {
  name: string;
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

export default function UploadDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<FileState[]>([]);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0 || busy) return;
    const picked = Array.from(list);
    setBusy(true);
    setFiles(picked.map((f) => ({ name: f.name, stage: "queued", status: "" })));

    // Process sequentially — keeps the live demo legible and avoids hammering the LLM/embed APIs.
    for (let i = 0; i < picked.length; i++) {
      await processFile(picked[i], (s) =>
        setFiles((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...s } : row))),
      );
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors ${
          dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 bg-gray-50"
        } ${busy ? "cursor-not-allowed opacity-60" : "hover:border-gray-400"}`}
      >
        <p className="text-sm font-medium text-gray-700">
          {busy ? "Processing…" : "Drop files here or click to choose"}
        </p>
        <p className="mt-1 text-xs text-gray-500">PDF, DOCX, or TXT</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,application/pdf,text/plain"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <span className="truncate font-mono text-gray-800">{f.name}</span>
              <span className="ml-3 shrink-0 text-xs text-gray-600">
                {f.status === "failed" ? (
                  <span className="text-red-600">{f.stage}</span>
                ) : (
                  f.stage
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
