import Link from "next/link";
import { eq } from "drizzle-orm";
import DocViewer from "@/components/doc-viewer";
import { resolveSpan } from "@/lib/doc/highlight";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";

// Task 15 — the click-to-source destination. Evidence links across the app target
// /doc/[id]?start=&end=; this server component loads the document, resolves the span from the
// search params, and renders the raw text with the [start, end) slice highlighted.
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

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <header className="mt-4 border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-semibold text-gray-900">{doc.filename}</h1>
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
          {doc.docType && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium">{doc.docType}</span>
          )}
          {doc.domain && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium">{doc.domain}</span>
          )}
          <span className="text-gray-400">#{doc.id}</span>
        </div>
      </header>

      <article className="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <DocViewer rawText={doc.rawText} start={start} end={end} />
      </article>
    </main>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-gray-900">Document not found</h1>
      <p className="mt-1 text-sm text-gray-500">{message}</p>
    </main>
  );
}
