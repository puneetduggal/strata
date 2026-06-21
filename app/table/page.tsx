import Link from "next/link";
import EntityTable from "@/components/entity-table";

// Task 18 — the faceted entity table surface. A thin server page framing the client EntityTable.
export default function TablePage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <header className="mt-4 mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Entities</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse extracted entities by type. Filter any column; each cell links to the document span
          it was extracted from.
        </p>
      </header>
      <EntityTable />
    </main>
  );
}
