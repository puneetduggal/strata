import Link from "next/link";
import GraphView from "@/components/graph-view";
import { getSystemGraph } from "@/lib/query/graph";

// Server component: resolve the system subgraph (with Q1/Q2 coverage overlays) and render it.
// Handles a missing/non-numeric/unknown systemId gracefully rather than 500-ing.
export default async function GraphPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = await params;
  const id = Number(systemId);

  if (!Number.isInteger(id) || id <= 0) {
    return <NotFound message={`"${systemId}" is not a valid system id.`} />;
  }

  const graph = await getSystemGraph(id);
  if (!graph.system) {
    return <NotFound message={`No system found with id ${id}.`} />;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <div className="mt-4">
        <GraphView graph={graph} />
      </div>
    </main>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-gray-900">System not found</h1>
      <p className="mt-1 text-sm text-gray-500">{message}</p>
    </main>
  );
}
