import { NextResponse } from "next/server";
import { buildSuggestions, topServiceLabels } from "@/lib/query/suggestions";

// GET → { suggestions, services } — corpus-driven Ask starter questions plus a small sample of the
// most-connected service names for the entity-linking explainer (see lib/query/suggestions.ts).
// force-dynamic: both must reflect the current graph on every request, never a build snapshot,
// since the ingested corpus changes between deploys.
export const dynamic = "force-dynamic";

export async function GET() {
  const [suggestions, services] = await Promise.all([buildSuggestions(), topServiceLabels(2)]);
  return NextResponse.json({ suggestions, services });
}
