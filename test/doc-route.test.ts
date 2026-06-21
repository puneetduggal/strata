import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { resolveSpan, sliceForHighlight } from "@/lib/doc/highlight";

// Task 15 — the doc viewer / click-to-source route. Evidence links across the app open
// /doc/[id]?start=&end= and must render documents.raw_text with the [start, end) span
// highlighted. The invariant under test: highlight === rawText.slice(start, end) exactly.
//
// Shared-DB safe: we insert ONE document with a unique filename, scope all assertions by the
// id we created, and clean it up in afterAll. Vitest runs files in parallel against one
// Postgres, so we never count/truncate shared tables.

const token = `dr-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const RAW = "The login service reads from the sessions store.\nIt depends on auth-svc.";
let docId: number;

beforeAll(async () => {
  const [d] = await db
    .insert(documents)
    .values({ filename: `doc-viewer-${token}.md`, mimeType: "text/markdown", rawText: RAW })
    .returning();
  docId = d.id;
});

afterAll(async () => {
  await db.delete(documents).where(eq(documents.id, docId));
});

describe("sliceForHighlight (pure)", () => {
  test("highlight equals rawText.slice(start, end) exactly", () => {
    const start = 4;
    const end = 17; // "login service"
    const { before, highlight, after } = sliceForHighlight(RAW, start, end);
    expect(highlight).toBe(RAW.slice(start, end));
    expect(highlight).toBe("login service");
    // Lossless: the three pieces reconstruct the original.
    expect(before + highlight + after).toBe(RAW);
  });

  test("absent span (undefined) → full text in `before`, no highlight", () => {
    const { before, highlight, after } = sliceForHighlight(RAW, undefined, undefined);
    expect(before).toBe(RAW);
    expect(highlight).toBe("");
    expect(after).toBe("");
  });

  test("out-of-range span → full text in `before`, no highlight", () => {
    const { before, highlight, after } = sliceForHighlight(RAW, 5, RAW.length + 100);
    expect(before).toBe(RAW);
    expect(highlight).toBe("");
    expect(after).toBe("");
  });

  test("inverted span (start > end) → no highlight", () => {
    const { before, highlight } = sliceForHighlight(RAW, 20, 5);
    expect(before).toBe(RAW);
    expect(highlight).toBe("");
  });
});

describe("resolveSpan (searchParam parsing + clamping)", () => {
  test("valid numeric strings parse to numbers", () => {
    expect(resolveSpan("4", "17", RAW.length)).toEqual({ start: 4, end: 17 });
  });

  test("clamps over-range end down to rawText.length", () => {
    expect(resolveSpan("4", "9999", RAW.length)).toEqual({ start: 4, end: RAW.length });
  });

  test("clamps negative start up to 0", () => {
    expect(resolveSpan("-5", "10", RAW.length)).toEqual({ start: 0, end: 10 });
  });

  test("absent params → undefined span", () => {
    expect(resolveSpan(undefined, undefined, RAW.length)).toEqual({ start: undefined, end: undefined });
  });

  test("non-numeric params → undefined span", () => {
    expect(resolveSpan("abc", "xyz", RAW.length)).toEqual({ start: undefined, end: undefined });
  });
});

describe("doc route slice resolution (DB-backed)", () => {
  test("resolved highlight from the stored document equals rawText.slice(start, end)", async () => {
    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc).toBeDefined();

    const { start, end } = resolveSpan("4", "17", doc.rawText.length);
    const { highlight } = sliceForHighlight(doc.rawText, start, end);
    expect(highlight).toBe(doc.rawText.slice(4, 17));
    expect(highlight).toBe("login service");
  });

  test("over-range query against the stored document → full text, no highlight", async () => {
    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    const { start, end } = resolveSpan("0", "999999", doc.rawText.length);
    // end clamps to length, so [0, len) is the WHOLE text — a valid full-doc highlight.
    const full = sliceForHighlight(doc.rawText, start, end);
    expect(full.highlight).toBe(doc.rawText);

    // A truly invalid (non-numeric) query yields no highlight at all.
    const none = resolveSpan("nope", undefined, doc.rawText.length);
    const { before, highlight } = sliceForHighlight(doc.rawText, none.start, none.end);
    expect(before).toBe(doc.rawText);
    expect(highlight).toBe("");
  });
});
