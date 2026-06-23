import Link from "next/link";
import GraphView from "@/components/graph-view";
import { TopBar } from "@/components/shell/top-bar";
import { getSystemGraph } from "@/lib/query/graph";

// Server component: resolve the system subgraph (with Q1/Q2 coverage overlays) and render the
// radial traceability canvas (catalog 03-graph). The page owns the frame chrome — breadcrumb top
// bar + a "System: <name> ▾" scope chip — and the two-pane body (flex-1 canvas + 336px inspector,
// both rendered by the client <GraphView/> which holds node-selection state). Invalid/unknown ids
// are handled gracefully rather than 500-ing.
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
    <>
      <TopBar
        leaf="Graph"
        right={
          <div className="flex items-center gap-[8px]">
            <span className="text-[12px] text-text-3">Scope</span>
            <span className="rounded-[8px] border border-accent-line bg-accent-soft px-[11px] py-[5px] font-mono text-[11.5px] font-medium text-accent">
              System: {graph.system.label} ▾
            </span>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        <GraphView graph={graph} />
      </div>
    </>
  );
}

function NotFound({ message }: { message: string }) {
  return (
    <>
      <TopBar leaf="Not found" />
      <div className="flex min-h-0 flex-1 flex-col items-start p-[28px_36px]">
        <h1 className="text-[15px] font-semibold text-text">System not found</h1>
        <p className="mt-[6px] text-[13px] text-text-2">{message}</p>
        <Link
          href="/"
          className="mt-[18px] flex h-[38px] items-center gap-[7px] rounded-[9px] border border-border-2 bg-surface px-[14px] text-[12.5px] font-medium text-text"
        >
          <span className="font-mono text-[11px] text-accent">{"←"}</span> Back home
        </Link>
      </div>
    </>
  );
}
