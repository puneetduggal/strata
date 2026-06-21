"use client";

import { useEffect, useRef } from "react";
import { sliceForHighlight } from "@/lib/doc/highlight";

// Task 15 — the click-to-source viewer. Evidence links across the app open
// /doc/[id]?start=&end= which renders a document's raw_text with the [start, end)
// character span highlighted and scrolled into view. The pure slice/clamp logic lives in
// @/lib/doc/highlight (so it's unit-testable without a JSX transform); re-exported here for
// callers that reach for it via the component.
export { resolveSpan, sliceForHighlight } from "@/lib/doc/highlight";
export type { HighlightSlice } from "@/lib/doc/highlight";

export default function DocViewer({
  rawText,
  start,
  end,
}: {
  rawText: string;
  start?: number;
  end?: number;
}) {
  const { before, highlight, after } = sliceForHighlight(rawText, start, end);
  const markRef = useRef<HTMLElement>(null);

  // Scroll the highlighted span into view on mount (needs the DOM, hence client-side).
  useEffect(() => {
    if (highlight) {
      markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlight]);

  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-gray-800">
      {before}
      {highlight && (
        <mark
          ref={markRef}
          className="rounded bg-yellow-200 px-0.5 text-gray-900 ring-1 ring-yellow-400"
        >
          {highlight}
        </mark>
      )}
      {after}
    </pre>
  );
}
