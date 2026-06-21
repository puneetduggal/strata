import Link from "next/link";
import ProcessingDashboard from "@/components/processing-dashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Strata</h1>
          <p className="mt-1 text-sm text-gray-500">
            Documents to knowledge graph — live processing status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/ask"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Ask
          </Link>
          <Link
            href="/table"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Entities
          </Link>
          <Link
            href="/upload"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Upload
          </Link>
        </div>
      </div>
      <ProcessingDashboard />
    </main>
  );
}
