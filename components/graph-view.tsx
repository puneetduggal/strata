import Link from "next/link";
import type { GraphEdge, GraphNode, SystemGraph } from "@/lib/query/graph";

// Task 14 — the traceability "money shot". A lightweight, dependency-free graph rendered as
// typed lanes of nodes + a typed edge list. No graph library: at demo scale, grouping nodes by
// entity type and listing the edges (each with its relation + click-through evidence) reads
// more clearly than a force-directed blob.
//
// The two coverage overlays this view exists to make obvious:
//   • Requirements with flags.noTest are painted RED ("no verifying test").
//   • Service nodes carry two DISTINCT badges — one for `noDesignDoc`, one for `noLoadTest` —
//     each shown only when that specific flag is set.

const TYPE_ORDER: GraphNode["type"][] = [
  "System",
  "Feature",
  "Requirement",
  "Service",
  "Datastore",
  "Test",
  "LoadTestResult",
  "Person",
  "Decision",
];

const TYPE_LABEL: Record<GraphNode["type"], string> = {
  System: "Systems",
  Feature: "Features",
  Requirement: "Requirements",
  Service: "Services",
  Datastore: "Datastores",
  Test: "Tests",
  LoadTestResult: "Load Test Results",
  Person: "Owners",
  Decision: "Decisions",
};

// Per-type chip colors (Tailwind classes are static strings so they survive purge).
const TYPE_CHIP: Record<GraphNode["type"], string> = {
  System: "border-slate-300 bg-slate-50 text-slate-800",
  Feature: "border-indigo-200 bg-indigo-50 text-indigo-800",
  Requirement: "border-sky-200 bg-sky-50 text-sky-800",
  Service: "border-emerald-200 bg-emerald-50 text-emerald-800",
  Datastore: "border-amber-200 bg-amber-50 text-amber-800",
  Test: "border-teal-200 bg-teal-50 text-teal-800",
  LoadTestResult: "border-cyan-200 bg-cyan-50 text-cyan-800",
  Person: "border-violet-200 bg-violet-50 text-violet-800",
  Decision: "border-rose-200 bg-rose-50 text-rose-800",
};

function NodeChip({ node }: { node: GraphNode }) {
  // A requirement with no verifying test is the headline gap → paint it red, overriding its
  // default sky chip.
  const isUncovered = node.type === "Requirement" && node.flags?.noTest;
  const chip = isUncovered
    ? "border-red-300 bg-red-50 text-red-800"
    : TYPE_CHIP[node.type];

  return (
    <div className={`rounded-md border px-2.5 py-1.5 text-xs ${chip}`}>
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{node.label}</span>
        <span className="text-[10px] opacity-60">#{node.id}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {isUncovered && (
          <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            no test
          </span>
        )}
        {node.type === "Service" && node.flags?.noDesignDoc && (
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            no design doc
          </span>
        )}
        {node.type === "Service" && node.flags?.noLoadTest && (
          <span className="rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            no load test
          </span>
        )}
      </div>
    </div>
  );
}

function EdgeRow({ edge, labelFor }: { edge: GraphEdge; labelFor: (type: string, id: number) => string }) {
  const src = labelFor(edge.sourceType, edge.sourceId);
  const tgt = labelFor(edge.targetType, edge.targetId);
  const hasEvidence = edge.evidenceDocumentId != null;
  const href = hasEvidence
    ? `/doc/${edge.evidenceDocumentId}?start=${edge.charStart ?? 0}&end=${edge.charEnd ?? 0}`
    : null;

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-gray-100 py-1.5 text-xs last:border-0">
      <span className="font-medium text-gray-800">{src}</span>
      <span className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
        {edge.relationType}
        {edge.relationType === "DEPENDS_ON" && edge.kind ? `:${edge.kind}` : ""}
      </span>
      <span className="text-gray-400">→</span>
      <span className="font-medium text-gray-800">{tgt}</span>
      {href ? (
        <Link
          href={href}
          className="ml-auto text-[11px] font-medium text-blue-600 hover:underline"
          title={edge.snippet ?? undefined}
        >
          evidence
        </Link>
      ) : (
        <span className="ml-auto text-[11px] text-gray-300">no evidence</span>
      )}
    </li>
  );
}

export default function GraphView({ graph }: { graph: SystemGraph }) {
  const { system, nodes, edges } = graph;

  // (type,id) → label, for rendering edge endpoints by name.
  const labelMap = new Map<string, string>();
  for (const n of nodes) labelMap.set(`${n.type}:${n.id}`, n.label);
  const labelFor = (type: string, id: number) => labelMap.get(`${type}:${id}`) ?? `${type} #${id}`;

  // Group nodes into typed lanes in a stable order.
  const lanes = TYPE_ORDER.map((type) => ({
    type,
    nodes: nodes.filter((n) => n.type === type),
  })).filter((lane) => lane.nodes.length > 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">
          {system ? system.label : "Traceability graph"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Requirements with no verifying test are highlighted in red; services flag missing
          design docs and load tests. Every edge links to its source evidence.
        </p>
      </header>

      {/* Node lanes, one column per entity type */}
      <section className="flex gap-4 overflow-x-auto pb-2">
        {lanes.map((lane) => (
          <div key={lane.type} className="min-w-[160px] shrink-0">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
              {TYPE_LABEL[lane.type]} ({lane.nodes.length})
            </h2>
            <div className="space-y-2">
              {lane.nodes.map((n) => (
                <NodeChip key={`${n.type}-${n.id}`} node={n} />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Typed edge list with click-through evidence */}
      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Relations ({edges.length})
        </h2>
        {edges.length === 0 ? (
          <p className="text-sm text-gray-500">No active relations in this subgraph.</p>
        ) : (
          <ul className="rounded-lg border border-gray-200 bg-white px-4 py-1 shadow-sm">
            {edges.map((e, i) => (
              <EdgeRow key={i} edge={e} labelFor={labelFor} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
