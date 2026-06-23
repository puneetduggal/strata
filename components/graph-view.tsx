"use client";

import { useMemo, useState } from "react";
import GraphInspector from "@/components/graph-inspector";
import { layoutGraph, type Point } from "@/lib/graph/layout";
import type { GraphNode, GraphNodeType, SystemGraph } from "@/lib/query/graph";

// Task 8 — the "money shot": a radial star graph of one System's traceability subgraph
// (catalog 03-graph). A dot-grid canvas holds an SVG edge layer (straight lines in a stretched
// 900×540 viewBox so it scales with the canvas) plus absolutely-%-positioned node chips laid out
// by layoutGraph(). Coverage gaps glow red (requirements with no test), services flag missing
// load-tests / design-docs, DEPENDS_ON edges march (animated dash), and clicking a node lifts a
// detailed selection into the right inspector. Token-driven throughout (no hardcoded colors).

// entity type → its --e-* CSS token (catalog §0).
const TYPE_TOKEN: Record<GraphNodeType, string> = {
  System: "--e-system",
  Feature: "--e-feature",
  Requirement: "--e-req",
  Service: "--e-service",
  Datastore: "--e-datastore",
  Test: "--e-test",
  LoadTestResult: "--e-load",
  Person: "--e-person",
  Decision: "--e-decision",
};

// ALL-CAPS type label shown on the chip (catalog §5).
const TYPE_LABEL: Record<GraphNodeType, string> = {
  System: "System",
  Feature: "Feature",
  Requirement: "Requirement",
  Service: "Service",
  Datastore: "Datastore",
  Test: "Test",
  LoadTestResult: "LoadTest",
  Person: "Person",
  Decision: "Decision",
};

const nodeKey = (type: string, id: number) => `${type}#${id}`;

// viewBox is 900×540; positions are percentages → viewBox units (catalog §4.1: the layers agree
// by ratio, the SVG stretches with preserveAspectRatio:none).
const VB_W = 900;
const VB_H = 540;
const toVB = (p: Point) => ({ x: (p.x / 100) * VB_W, y: (p.y / 100) * VB_H });

// Per-relation edge styling (catalog §4.3). Grey base group for the structural spine; DEPENDS_ON
// is the animated accent marching-ants; VALIDATES is solid cyan; satellite edges (AFFECTS/OWNS)
// are fine dotted half-opacity. `marker` picks one of the three arrowhead defs.
type EdgeStyle = {
  stroke: string;
  width: number;
  dash?: string;
  opacity?: number;
  animated?: boolean;
  marker: string;
};
const EDGE_STYLE: Record<string, EdgeStyle> = {
  PART_OF: { stroke: "var(--text-3)", width: 1.5, opacity: 0.55, marker: "ah" },
  SPECIFIES: { stroke: "var(--text-3)", width: 1.5, opacity: 0.55, marker: "ah" },
  IMPLEMENTS: { stroke: "var(--text-3)", width: 1.5, opacity: 0.55, marker: "ah" },
  USES: { stroke: "var(--text-3)", width: 1.5, opacity: 0.55, marker: "ah" },
  VERIFIES: { stroke: "var(--text-3)", width: 1.5, opacity: 0.55, marker: "ah" },
  DEPENDS_ON: { stroke: "var(--accent)", width: 1.8, dash: "5 4", animated: true, marker: "aha" },
  VALIDATES: { stroke: "var(--cyan)", width: 1.6, marker: "ah" },
  AFFECTS: { stroke: "var(--text-3)", width: 1.4, opacity: 0.5, dash: "3 3", marker: "ah" },
  OWNS: { stroke: "var(--text-3)", width: 1.4, opacity: 0.5, dash: "3 3", marker: "ah" },
};
const DEFAULT_STYLE: EdgeStyle = { stroke: "var(--text-3)", width: 1.5, opacity: 0.55, marker: "ah" };

// ── Arrowhead markers (catalog §4.3) ───────────────────────────────────────────
function Markers() {
  const tri = "M0,0 L7,3 L0,6 Z";
  return (
    <defs>
      <marker id="ah" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto">
        <path d={tri} fill="var(--text-3)" />
      </marker>
      <marker id="ahg" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto">
        <path d={tri} fill="var(--gap)" />
      </marker>
      <marker id="aha" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto">
        <path d={tri} fill="var(--accent)" />
      </marker>
    </defs>
  );
}

// ── Badges (catalog §5.3/§5.4) ──────────────────────────────────────────────────
function Badge({ label, tone }: { label: string; tone: "gap" | "warn" }) {
  return (
    <span
      className="rounded-[4px] px-[4px] py-[1px] font-mono text-[8px] font-bold text-white"
      style={{ background: `var(--${tone})` }}
    >
      {label}
    </span>
  );
}

// ── Type dot (catalog §5) — 7×7 square, Person is a circle ──────────────────────
function TypeDot({ token, circle }: { token: string; circle: boolean }) {
  return (
    <span
      className={`h-[7px] w-[7px] flex-none ${circle ? "rounded-full" : "rounded-[2px]"}`}
      style={{ background: `var(${token})` }}
    />
  );
}

// ── A single node chip (catalog §5.1–§5.6) ──────────────────────────────────────
function NodeChip({
  node,
  point,
  selected,
  onSelect,
}: {
  node: GraphNode;
  point: Point;
  selected: boolean;
  onSelect: () => void;
}) {
  const token = TYPE_TOKEN[node.type];
  const isGapReq = node.type === "Requirement" && node.flags?.noTest;
  const isSatellite = node.type === "Decision" || node.type === "Person";
  const small = node.type === "Requirement" || isLeaf(node.type) || isSatellite;

  // Border + background per state (catalog §5.7). Selected service wins; gap req is red; otherwise
  // a 1px border mixed 45% toward the type color.
  const border = selected
    ? "2px solid var(--accent)"
    : isGapReq
      ? "1.5px solid var(--gap)"
      : `1px solid color-mix(in srgb, var(${token}) 45%, var(--border))`;
  const background = isGapReq
    ? "color-mix(in srgb, var(--gap) 8%, var(--surface))"
    : "var(--surface)";
  const boxShadow = selected
    ? "0 0 0 4px var(--accent-soft), var(--shadow)"
    : "var(--shadow-sm)";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`absolute z-[1] flex flex-col gap-[2px] rounded-[9px] text-left ${
        small ? "p-[7px_9px]" : "p-[8px_10px]"
      }`}
      style={{
        left: `${point.x}%`,
        top: `${point.y}%`,
        transform: "translate(-50%, -50%)",
        width: chipWidth(node.type),
        border,
        background,
        boxShadow,
        ...(isGapReq ? { animation: "gapPulse 2.6s ease-in-out infinite" } : {}),
      }}
    >
      {/* header row: type label (+ dot) on the left, status badges on the right */}
      <div className="flex items-center justify-between gap-[6px]">
        <span className="flex items-center gap-[5px]">
          {!isSatellite && <TypeDot token={token} circle={node.type === "Person"} />}
          {node.type === "Requirement" ? (
            <span
              className="font-mono text-[11px] font-semibold"
              style={{ color: isGapReq ? "var(--gap)" : "var(--e-req)" }}
            >
              {node.label}
            </span>
          ) : isSatellite ? (
            <SatelliteLabel node={node} token={token} />
          ) : (
            <span className="font-mono text-[9px] uppercase tracking-[.04em] text-text-3">
              {TYPE_LABEL[node.type]}
              {selected && node.type === "Service" ? " · selected" : ""}
            </span>
          )}
        </span>
        <span className="flex flex-wrap justify-end gap-[5px]">
          {isGapReq && <Badge label="NO TEST" tone="gap" />}
          {node.type === "Service" && node.flags?.noLoadTest && (
            <Badge label="NO LOAD TEST" tone="warn" />
          )}
          {node.type === "Service" && node.flags?.noDesignDoc && (
            <Badge label="NO DESIGN DOC" tone="warn" />
          )}
        </span>
      </div>

      {/* title line — satellites render their title inline above, so skip them here */}
      {!isSatellite && node.type !== "Requirement" && (
        <span className={`mt-[1px] ${titleFont(node.type)}`}>{node.label}</span>
      )}
      {/* requirement sub-label: the requirement text (catalog §5.3) */}
      {node.type === "Requirement" && node.fields?.text && (
        <span className="text-[10px] leading-[1.25] text-text-2">{truncate(node.fields.text, 42)}</span>
      )}
    </button>
  );
}

function SatelliteLabel({ node, token }: { node: GraphNode; token: string }) {
  // Decision: square dot + mono label. Person: circular dot + sans label (catalog §5.6).
  if (node.type === "Person") {
    return (
      <span className="flex items-center gap-[5px]">
        <TypeDot token={token} circle />
        <span className="text-[11px] font-semibold">{node.label}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-[5px]">
      <TypeDot token={token} circle={false} />
      <span className="font-mono text-[11px] font-semibold">{node.label}</span>
    </span>
  );
}

function isLeaf(type: GraphNodeType) {
  return type === "Datastore" || type === "Test" || type === "LoadTestResult";
}
function chipWidth(type: GraphNodeType): number {
  if (type === "System") return 120;
  if (type === "Feature" || type === "Service") return 132;
  if (type === "Decision") return 150;
  if (type === "Person") return 120;
  return 116; // requirements + leaves
}
// Service + leaf titles are mono; system + feature titles are sans (catalog §5).
function titleFont(type: GraphNodeType): string {
  if (type === "Service" || isLeaf(type)) return "font-mono text-[11.5px] font-semibold text-text";
  return "text-[12.5px] font-semibold text-text";
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Main ────────────────────────────────────────────────────────────────────────
export default function GraphView({ graph }: { graph: SystemGraph }) {
  const { nodes, edges } = graph;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const pos = useMemo(() => layoutGraph(nodes), [nodes]);

  // Resolve each edge's endpoints from the node positions (skip edges whose endpoints aren't both
  // present in the laid-out subgraph). Deterministic — drawn in edge order.
  const drawnEdges = useMemo(() => {
    return edges
      .map((e, i) => {
        const a = pos.get(nodeKey(e.sourceType, e.sourceId));
        const b = pos.get(nodeKey(e.targetType, e.targetId));
        if (!a || !b) return null;
        const p1 = toVB(a);
        const p2 = toVB(b);
        const style = EDGE_STYLE[e.relationType] ?? DEFAULT_STYLE;
        return { i, p1, p2, style, edge: e };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [edges, pos]);

  const selectedNode = selectedKey
    ? nodes.find((n) => nodeKey(n.type, n.id) === selectedKey) ?? null
    : null;

  return (
    <>
      {/* Canvas — dot-grid background + SVG edge layer + absolutely-positioned node chips */}
      <div
        className="relative min-w-0 flex-1 overflow-hidden bg-app"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in srgb, var(--text-3) 22%, transparent) .8px, transparent .8px)",
          backgroundSize: "22px 22px",
        }}
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <Markers />
          {drawnEdges.map(({ i, p1, p2, style }) => (
            <line
              key={i}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={style.stroke}
              strokeWidth={style.width}
              opacity={style.opacity ?? 1}
              strokeDasharray={style.dash}
              markerEnd={`url(#${style.marker})`}
              style={style.animated ? { animation: "flow 1s linear infinite" } : undefined}
            />
          ))}
        </svg>

        {nodes.map((n) => {
          const key = nodeKey(n.type, n.id);
          const point = pos.get(key);
          if (!point) return null;
          return (
            <NodeChip
              key={key}
              node={n}
              point={point}
              selected={key === selectedKey}
              onSelect={() => setSelectedKey((k) => (k === key ? null : key))}
            />
          );
        })}
      </div>

      {/* Right inspector — coverage + honesty counter + selected-node detail */}
      <GraphInspector nodes={nodes} edges={edges} selected={selectedNode} />
    </>
  );
}
