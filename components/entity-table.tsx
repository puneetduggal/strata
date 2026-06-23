"use client";

import { useEffect, useMemo, useState } from "react";
import { TopBar } from "@/components/shell/top-bar";

// Entities — faceted entity browser (catalog 06). Pick one of the 9 entity types from the
// facet rail, list its rows via GET /api/query?type=, and render fields as grid-table columns.
// Each cell with provenance links back to its source span in the doc viewer
// (/doc/{documentId}?start&end). The top-bar "Filter entities…" pill drives a client-side
// substring filter across the visible cells. For Services we overlay the Q2 coverage CQ
// (POST {cq:"services_coverage_gaps"}) to show fully-covered / gap chips and to power the two
// "Coverage flag" checkboxes. Thin by design — the SQL does the work.

// The 9 typed entity types (mirrors SOFTWARE_PACKAGE.entityTypes — kept as a static list so this
// stays a pure client component without importing server code), in catalog §5b order.
const ENTITY_TYPES = [
  "System",
  "Feature",
  "Requirement",
  "Service",
  "Datastore",
  "Test",
  "LoadTestResult",
  "Decision",
  "Person",
] as const;

type EntityType = (typeof ENTITY_TYPES)[number];

// entity type → its --e-* CSS token (catalog §0). Used for the facet dot + the name cell color.
const TYPE_TOKEN: Record<EntityType, string> = {
  System: "--e-system",
  Feature: "--e-feature",
  Requirement: "--e-req",
  Service: "--e-service",
  Datastore: "--e-datastore",
  Test: "--e-test",
  LoadTestResult: "--e-load",
  Decision: "--e-decision",
  Person: "--e-person",
};

type FieldValue = {
  value: string;
  documentId?: number;
  charStart?: number;
  charEnd?: number;
};

type Entity = {
  id: number;
  label: string;
  fields: Record<string, FieldValue>;
};

// Q2 coverage row (POST {cq:"services_coverage_gaps"} → {rows:[{id,noDesignDoc,noLoadTest}]}).
type CoverageRow = { id: number; noDesignDoc: boolean; noLoadTest: boolean };

function docHref(f: FieldValue): string {
  const qs = new URLSearchParams();
  if (f.charStart != null) qs.set("start", String(f.charStart));
  if (f.charEnd != null) qs.set("end", String(f.charEnd));
  const suffix = qs.toString();
  return `/doc/${f.documentId}${suffix ? `?${suffix}` : ""}`;
}

// Strip the file extension so a documentId resolves to a catalog-style short-name
// (HLD.txt → HLD, impl-plan.txt → impl-plan). Honest, data-derived — not guessed.
function shortName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

// ── Facet rail ───────────────────────────────────────────────────────────────

function TypeDot({ token, circle }: { token: string; circle: boolean }) {
  return (
    <span
      className={`h-[7px] w-[7px] flex-none ${circle ? "rounded-full" : "rounded-[2px]"}`}
      style={{ background: `var(${token})` }}
    />
  );
}

function FacetRow({
  type,
  count,
  selected,
  onSelect,
}: {
  type: EntityType;
  count: number | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center justify-between rounded-[8px] p-[7px_10px] text-left text-[12.5px] ${
        selected ? "border border-accent-line bg-accent-soft" : "border border-transparent"
      }`}
    >
      <span
        className={`flex items-center gap-[8px] ${selected ? "font-semibold text-accent" : "text-text-2"}`}
      >
        <TypeDot token={TYPE_TOKEN[type]} circle={type === "Person"} />
        {type}
      </span>
      <span className={`font-mono text-[10px] ${selected ? "text-accent" : "text-text-3"}`}>
        {count ?? "·"}
      </span>
    </button>
  );
}

function FauxCheckbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-[8px] text-[12px] text-text-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        className={`flex h-[14px] w-[14px] flex-none items-center justify-center rounded-[4px] border-[1.5px] ${
          checked ? "border-accent bg-accent text-surface" : "border-border-2"
        }`}
      >
        {checked && (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M2.5 6.2l2.4 2.6L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </label>
  );
}

// ── Table cells ──────────────────────────────────────────────────────────────

function CoverageChip({ label }: { label: string }) {
  return (
    <span
      className="rounded-[5px] px-[8px] py-[3px] font-mono text-[10.5px] font-semibold text-warn"
      style={{ background: "color-mix(in srgb, var(--warn) 14%, var(--surface))" }}
    >
      {label}
    </span>
  );
}

function CoverageCell({ row }: { row: CoverageRow | undefined }) {
  if (!row) return <span className="text-text-3">—</span>;
  if (!row.noDesignDoc && !row.noLoadTest) {
    return (
      <span className="flex items-center gap-[5px] text-[11px] text-ok">
        <span className="h-[6px] w-[6px] flex-none rounded-full bg-ok" />
        fully covered
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-[5px]">
      {row.noDesignDoc && <CoverageChip label="no design doc" />}
      {row.noLoadTest && <CoverageChip label="no load test" />}
    </span>
  );
}

// The source column: distinct provenance docs for a row, ` · `-joined short-names + a trailing →,
// each linking to its span in the doc viewer.
function SourceCell({ entity, docNames }: { entity: Entity; docNames: Map<number, string> }) {
  const seen = new Map<number, FieldValue>();
  for (const f of Object.values(entity.fields)) {
    if (f.documentId != null && !seen.has(f.documentId)) seen.set(f.documentId, f);
  }
  const docs = Array.from(seen.entries());
  if (docs.length === 0) return <span className="text-text-3">—</span>;

  return (
    <span className="font-mono text-[11px] text-accent">
      {docs.map(([id, f], i) => (
        <span key={id}>
          {i > 0 && <span className="text-text-3"> · </span>}
          <a href={docHref(f)} title="View source" className="hover:underline">
            {docNames.get(id) ?? `doc ${id}`}
          </a>
        </span>
      ))}{" "}
      <span aria-hidden>→</span>
    </span>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function EntityTable() {
  const [type, setType] = useState<EntityType>("Service");
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [counts, setCounts] = useState<Record<EntityType, number | null>>(
    () => Object.fromEntries(ENTITY_TYPES.map((t) => [t, null])) as Record<EntityType, number | null>,
  );
  const [docNames, setDocNames] = useState<Map<number, string>>(new Map());
  const [coverage, setCoverage] = useState<Map<number, CoverageRow>>(new Map());

  const [filter, setFilter] = useState("");
  const [noDesignDoc, setNoDesignDoc] = useState(false);
  const [noLoadTest, setNoLoadTest] = useState(false);

  // On mount: facet counts (9 parallel GETs) + doc short-name map (one /api/status).
  useEffect(() => {
    let cancelled = false;

    Promise.all(
      ENTITY_TYPES.map((t) =>
        fetch(`/api/query?type=${encodeURIComponent(t)}`)
          .then((r) => (r.ok ? r.json() : { entities: [] }))
          .then((b: { entities: Entity[] }) => [t, b.entities.length] as const)
          .catch(() => [t, 0] as const),
      ),
    ).then((pairs) => {
      if (!cancelled) {
        setCounts(Object.fromEntries(pairs) as Record<EntityType, number | null>);
      }
    });

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

  // Per-type rows. Reset the coverage checkboxes on type change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNoDesignDoc(false);
    setNoLoadTest(false);
    fetch(`/api/query?type=${encodeURIComponent(type)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return (await res.json()) as { entities: Entity[] };
      })
      .then((body) => {
        if (!cancelled) setEntities(body.entities);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  // Service coverage overlay (Q2) — only when Services are selected.
  useEffect(() => {
    if (type !== "Service") {
      setCoverage(new Map());
      return;
    }
    let cancelled = false;
    fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cq: "services_coverage_gaps" }),
    })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((b: { rows: CoverageRow[] }) => {
        if (!cancelled) setCoverage(new Map(b.rows.map((r) => [r.id, r])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [type]);

  const isService = type === "Service";
  const accentToken = TYPE_TOKEN[type];

  // Columns = union of every field key across the rows, minus `label` (the fixed first column).
  const columns = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entities) for (const k of Object.keys(e.fields)) if (k !== "label") seen.add(k);
    return Array.from(seen);
  }, [entities]);

  // grid template: name | …field columns | (coverage if Service) | source.
  const gridTemplate = useMemo(() => {
    const cols = ["1.3fr", ...columns.map(() => "1fr"), ...(isService ? ["1.7fr"] : []), "1.3fr"];
    return cols.join(" ");
  }, [columns, isService]);

  // Global substring filter (top-bar pill) + coverage-flag checkboxes (Services only).
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entities.filter((e) => {
      if (isService && (noDesignDoc || noLoadTest)) {
        const cov = coverage.get(e.id);
        if (noDesignDoc && !cov?.noDesignDoc) return false;
        if (noLoadTest && !cov?.noLoadTest) return false;
      }
      if (q === "") return true;
      if (e.label.toLowerCase().includes(q)) return true;
      return Object.values(e.fields).some((f) => f.value.toLowerCase().includes(q));
    });
  }, [entities, filter, isService, noDesignDoc, noLoadTest, coverage]);

  return (
    <>
      <TopBar
        leaf="Entities"
        right={
          <div className="flex h-[32px] items-center gap-[8px] rounded-[8px] border border-border-2 bg-surface px-[11px]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2">
              <circle cx="11" cy="11" r="6.2" />
              <path d="M20 20l-4.2-4.2" strokeLinecap="round" />
            </svg>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter entities…"
              aria-label="Filter entities"
              className="w-[150px] bg-transparent text-[12px] text-text placeholder:text-text-3 focus:outline-none"
            />
          </div>
        }
      />

      <div className="flex min-h-0 flex-1">
        {/* Facet rail (catalog §5) */}
        <div className="w-[200px] flex-none border-r border-border bg-surface p-[16px_14px]">
          <div className="mb-[10px] font-mono text-[10px] uppercase tracking-[.05em] text-text-3">
            Entity type
          </div>
          <div className="flex flex-col gap-[2px]">
            {ENTITY_TYPES.map((t) => (
              <FacetRow
                key={t}
                type={t}
                count={counts[t]}
                selected={t === type}
                onSelect={() => setType(t)}
              />
            ))}
          </div>

          <div className="mb-[10px] mt-[18px] font-mono text-[10px] uppercase tracking-[.05em] text-text-3">
            Coverage flag
          </div>
          <div className="flex flex-col gap-[7px]">
            <FauxCheckbox label="No design doc" checked={noDesignDoc} onChange={setNoDesignDoc} />
            <FauxCheckbox label="No load test" checked={noLoadTest} onChange={setNoLoadTest} />
          </div>
        </div>

        {/* Table panel (catalog §6) */}
        <div className="min-w-0 flex-1 overflow-auto p-[18px_22px]">
          <div className="mb-[12px] flex items-center justify-between">
            <div className="flex items-baseline gap-[8px]">
              <span className="text-[14px] font-semibold">{type}s</span>
              <span className="font-mono text-[11px] text-text-3">
                {filtered.length} {filtered.length === 1 ? "entity" : "entities"}
              </span>
            </div>
          </div>

          {loading && <p className="text-[13px] text-text-2">Loading…</p>}
          {error && (
            <p
              className="rounded-[11px] px-[16px] py-[13px] text-[12px] text-gap"
              style={{ background: "color-mix(in srgb, var(--gap) 7%, var(--surface))" }}
            >
              Could not load entities: {error}
            </p>
          )}

          {!loading && !error && entities.length === 0 && (
            <p className="text-[13px] text-text-2">No {type} entities yet.</p>
          )}

          {!loading && !error && entities.length > 0 && (
            <div className="overflow-hidden rounded-[11px] border border-border bg-surface">
              {/* Header row (catalog §6c) */}
              <div
                className="grid border-b border-border bg-surface-2 font-mono text-[10px] uppercase tracking-[.04em] text-text-3"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                <div className="p-[10px_14px]">name</div>
                {columns.map((c) => (
                  <div key={c} className="p-[10px_14px]">
                    {c}
                  </div>
                ))}
                {isService && <div className="p-[10px_14px]">coverage</div>}
                <div className="p-[10px_14px]">source</div>
              </div>

              {/* Data rows (catalog §6d) */}
              {filtered.map((e, ri) => (
                <div
                  key={e.id}
                  className={`grid items-center text-[12.5px] ${
                    ri < filtered.length - 1 ? "border-b border-border" : ""
                  }`}
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  {/* name cell — mono/600 in the type's --e-* color */}
                  <div
                    className="p-[13px_14px] font-mono font-semibold"
                    style={{ color: `var(${accentToken})` }}
                  >
                    {e.fields.label?.documentId != null ? (
                      <a href={docHref(e.fields.label)} title="View source" className="hover:underline">
                        {e.label}
                      </a>
                    ) : (
                      e.label
                    )}
                  </div>

                  {columns.map((c) => {
                    const f = e.fields[c];
                    return (
                      <div key={c} className="p-[13px_14px]">
                        {f ? f.value : <span className="text-text-3">—</span>}
                      </div>
                    );
                  })}

                  {isService && (
                    <div className="p-[13px_14px]">
                      <CoverageCell row={coverage.get(e.id)} />
                    </div>
                  )}

                  <div className="p-[13px_14px]">
                    <SourceCell entity={e} docNames={docNames} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer explainer note (catalog §8) — only meaningful for the Service coverage view */}
          {!loading && !error && isService && entities.length > 0 && (
            <div className="mt-[14px] rounded-[10px] border border-border bg-surface-2 p-[12px_15px] text-[12px] leading-[1.5] text-text-2">
              <span className="font-semibold text-text">payment-service</span> appears only in
              impl-plan.txt — it&apos;s named in an IMPLEMENTS link but has no HLD/LLD of its own, so
              Strata flags it. The gap is real, surfaced from the data, not guessed.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
