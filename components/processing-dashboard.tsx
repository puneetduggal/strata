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

function StatusBadge({ status }: { status: string }) {
  if (status === "ready") {
    return <Badge className="bg-green-100 text-green-800">ready</Badge>;
  }
  if (status === "failed") {
    return <Badge className="bg-red-100 text-red-700">failed</Badge>;
  }
  if (status === "unrouted") {
    return (
      <Badge className="bg-gray-100 text-gray-500">off-domain / substrate only</Badge>
    );
  }
  return <Badge className="bg-blue-100 text-blue-800">{status}</Badge>;
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function ProgressBar({ status }: { status: string }) {
  // unrouted/failed don't ride the software_dev rail — render a flat track instead.
  if (status === "unrouted" || status === "failed") {
    return <div className="h-1.5 w-full rounded-full bg-gray-100" />;
  }
  const pct = progressOf(status);
  const color = status === "ready" ? "bg-green-500" : "bg-blue-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-100">
      <div
        className={`h-1.5 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

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
    <div className="space-y-3">
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load status: {error}
        </p>
      )}

      {docs.length === 0 && !error ? (
        <p className="text-sm text-gray-500">
          No documents yet. Upload some to see them processed here.
        </p>
      ) : (
        <ul className="space-y-2">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm font-medium text-gray-900">
                    {doc.filename}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {doc.docType ?? "—"}
                    {doc.domain ? ` · ${doc.domain}` : ""}
                  </p>
                </div>
                <StatusBadge status={doc.status} />
              </div>
              <div className="mt-3">
                <ProgressBar status={doc.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
