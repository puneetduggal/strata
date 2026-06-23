import Link from "next/link";
import { eq } from "drizzle-orm";
import DocViewer from "@/components/doc-viewer";
import { TopBar } from "@/components/shell/top-bar";
import { resolveSpan } from "@/lib/doc/highlight";
import { getDocCitations } from "@/lib/query/doc-citations";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";

// Task 7 / Task 15 — the click-to-source destination. Evidence links across the app target
// /doc/[id]?start=&end=; this server component loads the document, resolves the active span from
// the search params, loads every citation grounded in the doc (getDocCitations), and renders the
// two-pane provenance viewer: mono doc panel with dual highlights + 330px citation rail.
// Missing/invalid id or unknown document is handled gracefully rather than 500-ing.
export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  const { id } = await params;
  const { start: rawStart, end: rawEnd } = await searchParams;

  const docId = Number(id);
  if (!Number.isInteger(docId) || docId <= 0) {
    return <NotFound message={`"${id}" is not a valid document id.`} />;
  }

  const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
  if (!doc) {
    return <NotFound message={`No document found with id ${docId}.`} />;
  }

  const { start, end } = resolveSpan(rawStart, rawEnd, doc.rawText.length);
  const citations = await getDocCitations(docId);

  const charCaption = start != null && end != null ? `char ${start}–${end}` : null;

  return (
    <>
      <TopBar
        root="Docs"
        leaf={doc.filename}
        right={
          <div className="flex items-center gap-[10px]">
            {charCaption && (
              <span className="font-mono text-[11px] text-text-3">{charCaption}</span>
            )}
            {doc.docType && <DocTypePill docType={doc.docType} domain={doc.domain} />}
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <DocViewer
          rawText={doc.rawText}
          start={start}
          end={end}
          citations={citations}
          docId={doc.id}
          title={doc.title}
          authors={doc.authors}
          docDate={doc.docDate}
          docStatus={doc.status}
        />
      </div>
    </>
  );
}

// ── Doc-type pill (catalog §4a): entity-tinted rounded pill in the top bar's right slot. ───────
// Doc-type → its --e-* tint token (catalog §4a: HLD pill is --e-service). Design docs read as
// "service"-colored; specs as feature; decisions as decision; people docs as person. Anything
// else falls back to the service green so the pill always renders an entity tint, not accent.
const DOCTYPE_TOKEN: Record<string, string> = {
  HLD: "--e-service",
  LLD: "--e-service",
  PRD: "--e-feature",
  impl_plan: "--e-feature",
  load_test_report: "--e-load",
  ADR: "--e-decision",
  resume: "--e-person",
};

function DocTypePill({ docType, domain }: { docType: string; domain: string | null }) {
  const token = DOCTYPE_TOKEN[docType] ?? "--e-service";
  return (
    <span
      className="rounded-[20px] px-[9px] py-[3px] font-mono text-[10.5px] font-semibold"
      style={{
        color: `var(${token})`,
        background: `color-mix(in srgb, var(${token}) 13%, var(--surface))`,
      }}
    >
      {domain ? `${docType} · ${domain}` : docType}
    </span>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <>
      <TopBar root="Docs" leaf="Not found" />
      <div className="flex min-h-0 flex-1 flex-col items-start p-[28px_36px]">
        <h1 className="text-[15px] font-semibold text-text">Document not found</h1>
        <p className="mt-[6px] text-[13px] text-text-2">{message}</p>
        <Link
          href="/graph/1"
          className="mt-[18px] flex h-[38px] items-center gap-[7px] rounded-[9px] border border-border-2 bg-surface px-[14px] text-[12.5px] font-medium text-text"
        >
          <span className="font-mono text-[11px] text-accent">{"←"}</span> Back to graph
        </Link>
      </div>
    </>
  );
}
