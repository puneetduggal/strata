import { rawSql } from "@/lib/db/client";

// Corpus-driven Ask starter questions.
//
// The /ask page shows starter competency-question (CQ) chips. Their entity slots (Service X,
// Feature F, …) must reflect the CURRENTLY ingested graph — not a hard-coded example corpus —
// otherwise a freshly uploaded doc set still shows questions about services that no longer exist,
// and the parameterized CQs never resolve to a graph answer (the router can't link "Service X").
//
// buildSuggestions() picks ONE representative entity per parameterized CQ, preferring entities
// that actually carry the relationship that CQ traverses, so each suggested question yields a
// non-empty, on-corpus answer. A CQ whose slot type has no qualifying entity is omitted (we don't
// suggest a question nothing in the graph can answer). The two coverage-gap CQs (Q1/Q2) need no
// entity slot and are always included.

export type Suggestion = {
  id: string; // CQ id (Q1…Q10) — drives chip highlight + the answer-card method label
  group: "gaps" | "impact" | "lookup";
  label: string; // short chip face
  question: string; // text submitted to /api/ask — contains a real entity name so the router resolves it
};

// Run a single-column `SELECT label …` and return the first row's label (or null when empty).
async function topLabel(query: Promise<Array<{ label: string }>>): Promise<string | null> {
  const rows = await query;
  return rows[0]?.label ?? null;
}

export async function buildSuggestions(): Promise<Suggestion[]> {
  const out: Suggestion[] = [];

  // gaps — anti-join CQs, no entity slot, always answerable.
  out.push({
    id: "Q1",
    group: "gaps",
    label: "Which requirements have no test?",
    question: "Which requirements have no verifying test?",
  });
  out.push({
    id: "Q2",
    group: "gaps",
    label: "Which services lack a design doc or load test?",
    question: "Which services have no design doc / no load test?",
  });

  // impact — pick the service with the most incoming DEPENDS_ON (the most interesting blast radius).
  const blastSvc = await topLabel(rawSql`
    SELECT s.label FROM services s
    JOIN edges e ON e.active AND e.relation_type = 'DEPENDS_ON'
      AND e.target_type = 'Service' AND e.target_id = s.id
    GROUP BY s.id, s.label
    ORDER BY count(*) DESC, s.id ASC
    LIMIT 1`);
  if (blastSvc)
    out.push({
      id: "Q3",
      group: "impact",
      label: `What breaks if ${blastSvc} changes?`,
      question: `What depends on ${blastSvc} — what breaks if it changes?`,
    });

  // The feature with the most specifying requirements — reused by Q9 (blast radius) and Q4 (chain).
  const feature = await topLabel(rawSql`
    SELECT f.label FROM features f
    JOIN edges e ON e.active AND e.relation_type = 'SPECIFIES'
      AND e.source_type = 'Requirement' AND e.target_type = 'Feature' AND e.target_id = f.id
    GROUP BY f.id, f.label
    ORDER BY count(*) DESC, f.id ASC
    LIMIT 1`);
  if (feature)
    out.push({
      id: "Q9",
      group: "impact",
      label: `Blast radius of ${feature}?`,
      question: `If ${feature} changes, what is the full blast radius?`,
    });

  // A real DEPENDS_ON pair, preferring a source service with the highest out-degree (richer path).
  const pair = (await rawSql`
    SELECT a.label AS source, b.label AS target,
      (SELECT count(*) FROM edges o WHERE o.active AND o.relation_type = 'DEPENDS_ON'
         AND o.source_type = 'Service' AND o.source_id = a.id) AS deg
    FROM edges e
    JOIN services a ON a.id = e.source_id
    JOIN services b ON b.id = e.target_id
    WHERE e.active AND e.relation_type = 'DEPENDS_ON'
      AND e.source_type = 'Service' AND e.target_type = 'Service'
    ORDER BY deg DESC, a.id ASC, b.id ASC
    LIMIT 1`) as Array<{ source: string; target: string }>;
  if (pair[0])
    out.push({
      id: "Q10",
      group: "impact",
      label: `How does ${pair[0].source} depend on ${pair[0].target}?`,
      question: `How does ${pair[0].source} transitively depend on ${pair[0].target}?`,
    });

  // lookup — a service that USES a datastore.
  const dsSvc = await topLabel(rawSql`
    SELECT s.label FROM services s
    JOIN edges e ON e.active AND e.relation_type = 'USES'
      AND e.source_type = 'Service' AND e.source_id = s.id AND e.target_type = 'Datastore'
    GROUP BY s.id, s.label
    ORDER BY s.id ASC
    LIMIT 1`);
  if (dsSvc)
    out.push({
      id: "Q5",
      group: "lookup",
      label: `What datastore does ${dsSvc} use?`,
      question: `What datastore does ${dsSvc} use?`,
    });

  // A service that has an owner.
  const ownSvc = await topLabel(rawSql`
    SELECT s.label FROM services s
    JOIN edges e ON e.active AND e.relation_type = 'OWNS'
      AND e.source_type = 'Person' AND e.target_type = 'Service' AND e.target_id = s.id
    GROUP BY s.id, s.label
    ORDER BY s.id ASC
    LIMIT 1`);
  if (ownSvc)
    out.push({
      id: "Q8",
      group: "lookup",
      label: `Who owns ${ownSvc}?`,
      question: `Who owns ${ownSvc}?`,
    });

  // Q4 reuses the feature picked above (a feature with a real PRD→impl→test chain).
  if (feature)
    out.push({
      id: "Q4",
      group: "lookup",
      label: `${feature}: PRD→impl→test chain?`,
      question: `Show the PRD→LLD→impl→load-test chain for ${feature}`,
    });

  // A requirement validated by a load test (so the reconcile actually has values to compare).
  const ltReq = await topLabel(rawSql`
    SELECT r.label FROM requirements r
    JOIN edges e ON e.active AND e.relation_type = 'VALIDATES'
      AND e.source_type = 'LoadTestResult' AND e.target_type = 'Requirement' AND e.target_id = r.id
    GROUP BY r.id, r.label
    ORDER BY r.id ASC
    LIMIT 1`);
  if (ltReq)
    out.push({
      id: "Q6",
      group: "lookup",
      label: `Did the load test meet target for ${ltReq}?`,
      question: `Did the load test meet the PRD target for ${ltReq}?`,
    });

  // A service affected by a decision.
  const decSvc = await topLabel(rawSql`
    SELECT s.label FROM services s
    JOIN edges e ON e.active AND e.relation_type = 'AFFECTS'
      AND e.source_type = 'Decision' AND e.target_type = 'Service' AND e.target_id = s.id
    GROUP BY s.id, s.label
    ORDER BY count(*) DESC, s.id ASC
    LIMIT 1`);
  if (decSvc)
    out.push({
      id: "Q7",
      group: "lookup",
      label: `What decisions affected ${decSvc}?`,
      question: `What decisions affected ${decSvc}, and why?`,
    });

  return out;
}

// The most-connected service labels (by active-edge degree), for the /ask entity-linking explainer
// so its example names also reflect the current corpus. Returns up to `limit` distinct labels.
export async function topServiceLabels(limit = 2): Promise<string[]> {
  const rows = (await rawSql`
    SELECT s.label,
      (SELECT count(*) FROM edges e WHERE e.active
         AND ((e.source_type = 'Service' AND e.source_id = s.id)
           OR (e.target_type = 'Service' AND e.target_id = s.id))) AS deg
    FROM services s
    ORDER BY deg DESC, s.id ASC
    LIMIT ${limit}`) as Array<{ label: string }>;
  return rows.map((r) => r.label);
}
