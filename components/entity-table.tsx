"use client";

import { useEffect, useMemo, useState } from "react";

// Task 18 — the faceted entity table. Pick one of the 9 entity types, list its rows via
// GET /api/query?type=, and show each row's fields as columns with simple per-column substring
// filters (client-side). Each cell that has provenance links to its attribute_provenance span in
// the doc viewer (/doc/{documentId}?start&end). Thin by design — the SQL does the work.

// The 9 typed entity types (mirrors SOFTWARE_PACKAGE.entityTypes — kept as a static list so this
// stays a pure client component without importing server code).
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

function docHref(f: FieldValue): string {
  const qs = new URLSearchParams();
  if (f.charStart != null) qs.set("start", String(f.charStart));
  if (f.charEnd != null) qs.set("end", String(f.charEnd));
  const suffix = qs.toString();
  return `/doc/${f.documentId}${suffix ? `?${suffix}` : ""}`;
}

export default function EntityTable() {
  const [type, setType] = useState<(typeof ENTITY_TYPES)[number]>("Service");
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFilters({});
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

  // Columns = union of every field key across the rows, minus `label` (rendered as the fixed
  // first column below).
  const columns = useMemo(() => {
    const seen = new Set<string>();
    for (const e of entities) for (const k of Object.keys(e.fields)) if (k !== "label") seen.add(k);
    return Array.from(seen);
  }, [entities]);

  // Apply the per-column substring filters (case-insensitive). "label" filters on the row label.
  const filtered = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v.trim() !== "");
    if (active.length === 0) return entities;
    return entities.filter((e) =>
      active.every(([col, q]) => {
        const hay = col === "label" ? e.label : e.fields[col]?.value ?? "";
        return hay.toLowerCase().includes(q.toLowerCase());
      }),
    );
  }, [entities, filters]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label htmlFor="type" className="text-sm font-medium text-gray-700">
          Type
        </label>
        <select
          id="type"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof ENTITY_TYPES)[number])}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {!loading && !error && (
          <span className="text-xs text-gray-400">
            {filtered.length} of {entities.length} row{entities.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {!loading && !error && entities.length === 0 && (
        <p className="text-sm text-gray-500">No {type} entities yet.</p>
      )}

      {!loading && !error && entities.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <Th name="label" filter={filters.label ?? ""} onFilter={setFilters} />
                {columns.map((c) => (
                  <Th key={c} name={c} filter={filters[c] ?? ""} onFilter={setFilters} />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filtered.map((e) => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {e.fields.label?.documentId != null ? (
                      <a href={docHref(e.fields.label)} title="View source" className="text-blue-600 hover:underline">
                        {e.label}
                      </a>
                    ) : (
                      e.label
                    )}
                  </td>
                  {columns.map((c) => {
                    const f = e.fields[c];
                    if (!f) return <td key={c} className="px-3 py-2 text-gray-300">—</td>;
                    if (f.documentId != null) {
                      return (
                        <td key={c} className="px-3 py-2">
                          <a
                            href={docHref(f)}
                            title="View source"
                            className="text-blue-600 hover:underline"
                          >
                            {f.value}
                          </a>
                        </td>
                      );
                    }
                    return <td key={c} className="px-3 py-2 text-gray-700">{f.value}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  name,
  filter,
  onFilter,
}: {
  name: string;
  filter: string;
  onFilter: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  return (
    <th className="px-3 py-2 text-left align-top">
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{name}</div>
      <input
        value={filter}
        onChange={(e) => onFilter((prev) => ({ ...prev, [name]: e.target.value }))}
        placeholder="filter…"
        className="mt-1 w-full min-w-[6rem] rounded border border-gray-200 px-1.5 py-0.5 text-xs font-normal normal-case focus:border-blue-400 focus:outline-none"
      />
    </th>
  );
}
