"use client";

import { useEffect, useMemo, useState } from "react";
import type { GraphEdge, GraphNode, GraphNodeType } from "@/lib/query/graph";

// Task 8 — the graph's right inspector (catalog 03-graph §6). Three stacked sections, all derived
// CLIENT-SIDE from the (enriched) subgraph — no extra API contract:
//   §6.1 Coverage   — count badges from node flags (reqs noTest / services noLoadTest/noDesignDoc).
//   §6.2 Honesty    — provenance chips: active link count, 0 below threshold, % spans located.
//   §6.3 Selection  — the clicked node's type/label, a couple of field pairs, its relations
//                     (relation pill + direction arrow + targets), and an evidence-link CTA.
// (The only fetch is /api/status for doc short-names on the evidence button — an existing route.)

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

const nodeKey = (type: string, id: number) => `${type}#${id}`;

// Relation → display name + pill color token (catalog §6.3). When a relation is shown on an
// INCOMING edge we relabel it to its passive form (AFFECTS→AFFECTED_BY, OWNS→OWNED_BY) the way the
// catalog does, and color it by the *other* endpoint's meaning.
const REL_TOKEN: Record<string, string> = {
  DEPENDS_ON: "--accent",
  USES: "--e-datastore",
  IMPLEMENTS: "--e-req",
  SPECIFIES: "--e-req",
  PART_OF: "--e-feature",
  VERIFIES: "--e-test",
  VALIDATES: "--e-load",
  AFFECTS: "--e-decision",
  AFFECTED_BY: "--e-decision",
  OWNS: "--e-person",
  OWNED_BY: "--e-person",
};

function relColor(rel: string): string {
  return REL_TOKEN[rel] ?? "--accent";
}

function shortName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

// ── §6.1 Coverage ────────────────────────────────────────────────────────────────
function CountBadge({ n, tone }: { n: number; tone: "gap" | "warn" }) {
  return (
    <span
      className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] text-[13px] font-bold"
      style={{
        color: `var(--${tone})`,
        background: `color-mix(in srgb, var(--${tone}) ${tone === "gap" ? 14 : 16}%, var(--surface))`,
      }}
    >
      {n}
    </span>
  );
}

function CoverageRow({
  n,
  tone,
  children,
}: {
  n: number;
  tone: "gap" | "warn";
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-[10px]">
      <CountBadge n={n} tone={tone} />
      <span className="text-[12.5px] text-text-2">{children}</span>
    </div>
  );
}

// ── §6.2 Honesty chip ────────────────────────────────────────────────────────────
function HonestyChip({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <span
      className="rounded-[6px] px-[8px] py-[3px] font-mono text-[10.5px]"
      style={
        ok
          ? { color: "var(--ok)", background: "color-mix(in srgb, var(--ok) 12%, var(--surface))" }
          : { color: "var(--text-2)", background: "var(--surface-2)" }
      }
    >
      {label}
    </span>
  );
}

// ── §6.3 Relation row ─────────────────────────────────────────────────────────────
function RelationRow({
  rel,
  outgoing,
  targets,
}: {
  rel: string;
  outgoing: boolean;
  targets: string[];
}) {
  const token = relColor(rel);
  return (
    <div className="flex items-center gap-[7px] rounded-[8px] bg-surface-2 p-[6px_9px] text-[11.5px]">
      <span
        className="rounded-[4px] px-[5px] py-[2px] font-mono text-[9.5px] font-semibold"
        style={{
          color: `var(${token})`,
          background: `color-mix(in srgb, var(${token}) 14%, var(--surface))`,
        }}
      >
        {rel}
      </span>
      <span className="text-text-2">{outgoing ? "→" : "←"}</span>
      <span className="truncate font-mono font-medium">{targets.join(", ")}</span>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────────
export default function GraphInspector({
  nodes,
  edges,
  selected,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selected: GraphNode | null;
}) {
  // Coverage rollups from node flags.
  const cov = useMemo(() => {
    let reqsNoTest = 0,
      svcNoLoadTest = 0,
      svcNoDesignDoc = 0;
    for (const n of nodes) {
      if (n.type === "Requirement" && n.flags?.noTest) reqsNoTest++;
      if (n.type === "Service" && n.flags?.noLoadTest) svcNoLoadTest++;
      if (n.type === "Service" && n.flags?.noDesignDoc) svcNoDesignDoc++;
    }
    return { reqsNoTest, svcNoLoadTest, svcNoDesignDoc };
  }, [nodes]);

  // Honesty rollups. The subgraph only carries active edges, so belowThreshold is 0; spansLocated
  // is the share of edges carrying an evidence span.
  const honesty = useMemo(() => {
    const activeLinks = edges.length;
    const withEvidence = edges.filter((e) => e.evidenceDocumentId != null).length;
    const spansLocatedPct = activeLinks === 0 ? 0 : Math.round((withEvidence / activeLinks) * 100);
    return { activeLinks, spansLocatedPct };
  }, [edges]);

  // (type,id) → label, for naming relation targets.
  const labelOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) m.set(nodeKey(n.type, n.id), n.label);
    return m;
  }, [nodes]);

  // Doc id → short-name for the evidence CTA (existing /api/status route; graceful fallback).
  const [docNames, setDocNames] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : { docs: [] }))
      .then((b: { docs: { id: number; filename: string }[] }) => {
        if (!cancelled) setDocNames(new Map(b.docs.map((d) => [d.id, shortName(d.filename)])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <aside className="flex w-[336px] flex-none flex-col overflow-hidden border-l border-border bg-surface">
      {/* §6.1 Coverage */}
      <div className="border-b border-border p-[16px_18px]">
        <div className="mb-[10px] font-mono text-[11px] uppercase tracking-[.05em] text-text-3">
          Coverage
        </div>
        <div className="flex flex-col gap-[8px]">
          <CoverageRow n={cov.reqsNoTest} tone="gap">
            requirements with <span className="font-semibold text-text">no verifying test</span>
          </CoverageRow>
          <CoverageRow n={cov.svcNoLoadTest} tone="warn">
            services <span className="font-semibold text-text">not load-tested</span>
          </CoverageRow>
          <CoverageRow n={cov.svcNoDesignDoc} tone="warn">
            {cov.svcNoDesignDoc === 1 ? "service" : "services"}{" "}
            <span className="font-semibold text-text">missing a design doc</span>
          </CoverageRow>
        </div>
      </div>

      {/* §6.2 Honesty counter */}
      <div className="flex flex-wrap gap-[7px] border-b border-border p-[13px_18px]">
        <HonestyChip label={`${honesty.activeLinks} active links`} ok />
        <HonestyChip label="0 below threshold" />
        <HonestyChip label={`${honesty.spansLocatedPct}% spans located`} />
      </div>

      {/* §6.3 Selected-node detail (or a hint when nothing is selected) */}
      <div className="min-h-0 flex-1 overflow-auto p-[16px_18px]">
        {selected ? (
          <SelectedDetail
            node={selected}
            edges={edges}
            labelOf={labelOf}
            docNames={docNames}
          />
        ) : (
          <p className="text-[12.5px] leading-[1.5] text-text-2">
            Click a node to inspect its fields, relations, and source evidence.
          </p>
        )}
      </div>
    </aside>
  );
}

function SelectedDetail({
  node,
  edges,
  labelOf,
  docNames,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  labelOf: Map<string, string>;
  docNames: Map<number, string>;
}) {
  const token = TYPE_TOKEN[node.type];
  const selfKey = nodeKey(node.type, node.id);

  // Field pairs — show up to four human-meaningful attributes from node.fields. We DISPLAY-filter
  // (the data layer keeps `fields` intact) to drop: the long free-text body (text/description), FK
  // columns (keys ending in Id/_id, plus packageId), and pure-bookkeeping flags (passed,
  // observedValue) so e.g. a Feature no longer surfaces `System Id` and a LoadTestResult no longer
  // surfaces `Passed`/`Observed Value`. The spec'd Service case (Language, Owner) still renders.
  const pairs = useMemo(() => {
    const f = node.fields ?? {};
    return Object.entries(f)
      .filter(([k]) => !isSkippedField(k))
      .slice(0, 4)
      .map(([k, v]) => [titleCase(k), v] as const);
  }, [node]);

  // Relations: every edge touching this node, grouped by (relation, direction) with named targets.
  // Incoming AFFECTS/OWNS are relabelled to their passive form (catalog §6.3).
  const relations = useMemo(() => {
    const groups = new Map<string, { rel: string; outgoing: boolean; targets: string[] }>();
    for (const e of edges) {
      const isSource = nodeKey(e.sourceType, e.sourceId) === selfKey;
      const isTarget = nodeKey(e.targetType, e.targetId) === selfKey;
      if (!isSource && !isTarget) continue;
      const outgoing = isSource;
      const otherKey = outgoing
        ? nodeKey(e.targetType, e.targetId)
        : nodeKey(e.sourceType, e.sourceId);
      const rel = displayRel(e.relationType, outgoing);
      const gk = `${rel}|${outgoing}`;
      const g = groups.get(gk) ?? { rel, outgoing, targets: [] };
      const name = labelOf.get(otherKey);
      if (name && !g.targets.includes(name)) g.targets.push(name);
      groups.set(gk, g);
    }
    return [...groups.values()];
  }, [edges, selfKey, labelOf]);

  // A representative evidence span for the "Open evidence in <doc> →" CTA.
  const evidence = useMemo(() => {
    for (const e of edges) {
      const touches =
        nodeKey(e.sourceType, e.sourceId) === selfKey ||
        nodeKey(e.targetType, e.targetId) === selfKey;
      if (touches && e.evidenceDocumentId != null) return e;
    }
    return null;
  }, [edges, selfKey]);

  const evidenceHref = evidence
    ? `/doc/${evidence.evidenceDocumentId}?start=${evidence.charStart ?? 0}&end=${evidence.charEnd ?? 0}`
    : null;
  const evidenceName = evidence?.evidenceDocumentId
    ? (docNames.get(evidence.evidenceDocumentId) ?? `doc #${evidence.evidenceDocumentId}`)
    : null;

  return (
    <>
      {/* type line */}
      <div className="flex items-center gap-[6px]">
        <span
          className={`h-[8px] w-[8px] flex-none ${node.type === "Person" ? "rounded-full" : "rounded-[2px]"}`}
          style={{ background: `var(${token})` }}
        />
        <span className="font-mono text-[9px] uppercase tracking-[.05em] text-text-3">
          {node.type}
        </span>
      </div>
      {/* title */}
      <div className="mb-[12px] mt-[3px] font-mono text-[16px] font-semibold">{node.label}</div>

      {/* field pairs */}
      {pairs.length > 0 && (
        <div className="mb-[14px] flex flex-wrap gap-[18px]">
          {pairs.map(([k, v]) => (
            <div key={k}>
              <div className="text-[10px] text-text-3">{k}</div>
              <div className="text-[13px] font-semibold text-text">{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* relations */}
      {relations.length > 0 && (
        <>
          <div className="mb-[8px] text-[10px] uppercase tracking-[.04em] text-text-3">Relations</div>
          <div className="flex flex-col gap-[6px]">
            {relations.map((r) => (
              <RelationRow
                key={`${r.rel}|${r.outgoing}`}
                rel={r.rel}
                outgoing={r.outgoing}
                targets={r.targets}
              />
            ))}
          </div>
        </>
      )}

      {/* evidence CTA */}
      {evidenceHref && (
        <a
          href={evidenceHref}
          className="mt-[16px] flex h-[38px] w-full items-center justify-center gap-[7px] rounded-[9px] border border-border-2 bg-surface text-[12.5px] font-medium text-text"
        >
          Open evidence in {evidenceName}
          <span className="font-mono text-[11px] text-accent">→</span>
        </a>
      )}
    </>
  );
}

// Incoming structural relations read more naturally in their passive form (catalog §6.3).
function displayRel(rel: string, outgoing: boolean): string {
  if (!outgoing) {
    if (rel === "AFFECTS") return "AFFECTED_BY";
    if (rel === "OWNS") return "OWNED_BY";
  }
  return rel;
}

// Inspector DISPLAY skip set: free-text bodies + FK/bookkeeping columns the field pairs shouldn't
// surface. Keys are camelCased here (node.fields), so FKs read as `…Id`; we also match `_id`
// defensively. The named bookkeeping flags (passed / observedValue) are LoadTestResult noise.
const FIELD_SKIP_DISPLAY = new Set(["text", "description", "packageId", "passed", "observedValue"]);
function isSkippedField(k: string): boolean {
  return FIELD_SKIP_DISPLAY.has(k) || k.endsWith("Id") || k.endsWith("_id");
}

function titleCase(camel: string): string {
  const spaced = camel.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
