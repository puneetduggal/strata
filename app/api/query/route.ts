import { NextResponse } from "next/server";
import { runCQ } from "@/lib/query/templates";

// The deterministic-query gateway: POST {cq, params} → runCQ(cq, params) → {rows, provenance}.
// `cq` must be a known template id; anything else (or a non-JSON body / missing cq) → 400.

// Whitelist of valid template ids (must match the dispatch table in lib/query/templates.ts).
const KNOWN_CQ = new Set([
  "requirements_without_test",
  "services_coverage_gaps",
  "service_blast_radius",
  "feature_chain",
  "service_datastore",
  "loadtest_vs_target",
  "service_decisions",
  "service_owner",
  "feature_blast_radius",
  "dependency_path",
]);

export async function POST(req: Request) {
  let body: { cq?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const cq = body?.cq;
  if (typeof cq !== "string" || !KNOWN_CQ.has(cq)) {
    return NextResponse.json({ error: `unknown query template: ${String(cq)}` }, { status: 400 });
  }

  const params = (body.params ?? {}) as Record<string, unknown>;
  const { rows, provenance } = await runCQ(cq, params);
  return NextResponse.json({ rows, provenance });
}
