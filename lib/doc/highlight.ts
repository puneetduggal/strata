// Task 15 — pure slice/clamp logic for the click-to-source doc viewer. Kept in a plain .ts
// module (not the .tsx component) so it stays unit-testable without a JSX transform.

export interface HighlightSlice {
  before: string;
  highlight: string;
  after: string;
}

/**
 * Split rawText into the three pieces around a [start, end) character span.
 *
 * Invariant: when a valid span is given, `highlight === rawText.slice(start, end)` exactly,
 * and `before + highlight + after === rawText` (lossless).
 *
 * A span is valid only when both bounds are present integers and 0 <= start < end <= length.
 * For an absent / out-of-range / inverted / empty span we render the whole document with NO
 * highlight (full text in `before`) rather than crashing.
 */
export function sliceForHighlight(
  rawText: string,
  start: number | undefined,
  end: number | undefined,
): HighlightSlice {
  const valid =
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    end <= rawText.length &&
    start < end;

  if (!valid) {
    return { before: rawText, highlight: "", after: "" };
  }

  return {
    before: rawText.slice(0, start),
    highlight: rawText.slice(start, end),
    after: rawText.slice(end),
  };
}

/**
 * Parse raw `start`/`end` search params into a clamped numeric span.
 *
 * - Non-numeric / absent params → `undefined` (no highlight).
 * - `start` clamps up to 0, `end` clamps down to `length` so an over-range evidence link
 *   still resolves to a sensible in-bounds span instead of being dropped.
 */
export function resolveSpan(
  rawStart: string | undefined,
  rawEnd: string | undefined,
  length: number,
): { start: number | undefined; end: number | undefined } {
  const parse = (v: string | undefined): number | undefined => {
    if (v == null || v.trim() === "") return undefined;
    const n = Number(v);
    return Number.isInteger(n) ? n : undefined;
  };

  let start = parse(rawStart);
  let end = parse(rawEnd);

  if (start != null) start = Math.max(0, Math.min(start, length));
  if (end != null) end = Math.max(0, Math.min(end, length));

  return { start, end };
}

// Task 7 — the doc viewer renders MANY highlights at once (the active citation + every other
// located citation in the doc). buildHighlights collapses a set of character spans into an
// ordered, non-overlapping list of segments the JSX can map 1:1, so we never have to nest or
// overlap inline <span>s. Kept pure (no JSX) so it's unit-testable.

export type HighlightTier = "active" | "passive" | "none";

export interface HighlightSpan {
  charStart: number;
  charEnd: number;
  entityType?: string;
}

export interface HighlightSegment {
  text: string;
  tier: HighlightTier;
  entityType?: string;
}

/**
 * Split `rawText` into ordered, non-overlapping segments for rendering.
 *
 * - The span equal to `activeSpan` (matched by start/end) becomes tier "active" (no entityType —
 *   it's the accent-glow citation the page opened at).
 * - Every other in-range span becomes tier "passive", carrying its `entityType` (drives --e-*).
 * - The text between spans becomes tier "none".
 *
 * Overlap handling is greedy left-to-right by input order: when two spans overlap, the one
 * listed first claims the contested characters; a later span only contributes the portion not
 * already covered. Out-of-range / inverted / empty spans are ignored. Reassembling the segment
 * texts in order always reproduces `rawText` exactly.
 */
export function buildHighlights(
  rawText: string,
  spans: HighlightSpan[],
  activeSpan: { start: number; end: number } | null,
): HighlightSegment[] {
  const len = rawText.length;

  // Per-character ownership map. -1 = not covered; otherwise the index of the owning span
  // (in the combined list below). First writer wins so earlier spans take precedence on overlap.
  const owner = new Int32Array(len).fill(-1);

  // The active span is span index 0 so it always wins ties; the located spans follow.
  type Claim = { tier: HighlightTier; entityType?: string };
  const claims: Claim[] = [];

  const claim = (start: number, end: number, c: Claim) => {
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > len ||
      start >= end
    ) {
      return; // out-of-range / inverted / empty → ignore
    }
    const idx = claims.push(c) - 1;
    for (let i = start; i < end; i++) {
      if (owner[i] === -1) owner[i] = idx;
    }
  };

  if (activeSpan) claim(activeSpan.start, activeSpan.end, { tier: "active" });
  for (const s of spans) {
    // A located span that exactly matches the active span is already painted as active — skip it
    // so it doesn't double as a passive segment.
    if (activeSpan && s.charStart === activeSpan.start && s.charEnd === activeSpan.end) continue;
    claim(s.charStart, s.charEnd, { tier: "passive", entityType: s.entityType });
  }

  // Walk the ownership map, coalescing runs of identical ownership into segments.
  const segments: HighlightSegment[] = [];
  let i = 0;
  while (i < len) {
    const o = owner[i];
    let j = i + 1;
    while (j < len && owner[j] === o) j++;
    const text = rawText.slice(i, j);
    if (o === -1) {
      segments.push({ text, tier: "none" });
    } else {
      const c = claims[o];
      segments.push(c.entityType ? { text, tier: c.tier, entityType: c.entityType } : { text, tier: c.tier });
    }
    i = j;
  }

  if (segments.length === 0) return [{ text: rawText, tier: "none" }];
  return segments;
}
