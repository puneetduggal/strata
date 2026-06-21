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
