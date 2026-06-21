import { NextResponse } from "next/server";
import { runCQ, isKnownCQ } from "@/lib/query/templates";

// The deterministic-query gateway: POST {cq, params} → runCQ(cq, params) → {rows, provenance}.
// `cq` must be a known template id; anything else (or a non-JSON body / missing cq) → 400.
// The allowlist is derived from the TEMPLATES dispatch table (via isKnownCQ) so it can't drift.

export async function POST(req: Request) {
  let body: { cq?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const cq = body?.cq;
  if (typeof cq !== "string" || !isKnownCQ(cq)) {
    return NextResponse.json({ error: `unknown query template: ${String(cq)}` }, { status: 400 });
  }

  const params = (body.params ?? {}) as Record<string, unknown>;
  const { rows, provenance } = await runCQ(cq, params);
  return NextResponse.json({ rows, provenance });
}
