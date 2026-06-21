import { expect, test, vi } from "vitest";
import { extractStructured } from "@/lib/llm/claude";
vi.mock("@/lib/llm/claude", () => ({ extractStructured: vi.fn(async () => ({ domain: "software_dev", docType: "PRD", title: "Auth PRD", authors: ["A"], docDate: "2026-01-01", summary: "..." })), MODEL: "claude-opus-4-8" }));
vi.mock("@/lib/embed/voyage", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => Array(1024).fill(0.01))) }));
import { db } from "@/lib/db/client";
import { documents, chunks } from "@/lib/db/schema";
import { advance } from "@/lib/pipeline/run";
import { chunkText, indexDoc } from "@/lib/pipeline/index";
import { eq } from "drizzle-orm";

test("ingest→classify→index advances status and creates chunks", async () => {
  const [doc] = await db.insert(documents).values({ filename: "prd.txt", mimeType: "text/plain", rawText: "REQ-1: handle 10k req/s.\n\nThe auth-service implements it.", status: "ingested" }).returning();
  await advance(doc.id); // classify
  await advance(doc.id); // index
  const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
  expect(after.domain).toBe("software_dev");
  const c = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
  expect(c.length).toBeGreaterThan(0);
  expect(after.rawText.slice(c[0].charStart, c[0].charEnd)).toBe(c[0].text); // offset invariant
});

test("non-software doc is indexed (chunks created) then routed to unrouted", async () => {
  // Classify this one as off-domain ("hiring") to exercise the unrouted path.
  vi.mocked(extractStructured).mockResolvedValueOnce({ domain: "hiring", docType: "resume", title: "Jane's Resume", authors: ["Jane"], docDate: "2026-01-01", summary: "..." });
  const [doc] = await db.insert(documents).values({ filename: "resume.txt", mimeType: "text/plain", rawText: "Jane Doe — Software Engineer.\n\n10 years building distributed systems.", status: "ingested" }).returning();

  // Advance until status stops changing (classify → index → unrouted).
  let prev = "";
  let cur = doc.status;
  while (cur !== prev) {
    prev = cur;
    cur = (await advance(doc.id)).status;
  }

  const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
  expect(after.domain).toBe("hiring");
  expect(after.status).toBe("unrouted"); // graph stages skipped
  const c = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
  expect(c.length).toBeGreaterThan(0); // proves index ran for the non-software doc
});

test("chunkText offset invariant holds across a multi-chunk input", async () => {
  // Build several paragraphs separated by \n\n; each paragraph alone exceeds the ~1000-char
  // window so the chunker closes a window per paragraph → ≥3 chunks, total > 1000 chars.
  const para = (n: number) => `Paragraph ${n}: ` + "lorem ipsum dolor sit amet ".repeat(45).trim();
  const rawText = [para(1), para(2), para(3), para(4)].join("\n\n");
  expect(rawText.length).toBeGreaterThan(1000);

  const spans = chunkText(rawText);
  expect(spans.length).toBeGreaterThanOrEqual(3);

  // Drive the real indexDoc path so chunks.text comes from production code, then assert
  // the load-bearing provenance invariant: rawText.slice(charStart, charEnd) === chunk.text.
  const [doc] = await db.insert(documents).values({ filename: "multi.txt", mimeType: "text/plain", rawText, status: "classified" }).returning();
  await indexDoc(doc.id);
  const c = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
  expect(c.length).toBe(spans.length);
  expect(c.length).toBeGreaterThanOrEqual(3);

  for (const chunk of c) {
    expect(chunk.charStart).toBeGreaterThanOrEqual(0);
    expect(chunk.charEnd).toBeLessThanOrEqual(rawText.length);
    expect(chunk.charStart).toBeLessThan(chunk.charEnd);
    expect(rawText.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text); // offset invariant
  }

  // A window that spans a \n\n separator round-trips exactly through slice.
  const sep = rawText.indexOf("\n\n");
  expect(sep).toBeGreaterThan(0);
  const window = "amet" + rawText.slice(sep, sep + 2) + "Para"; // contains the separator
  const at = rawText.indexOf(window);
  expect(at).toBeGreaterThanOrEqual(0);
  expect(rawText.slice(at, at + window.length)).toBe(window);
  expect(window).toContain("\n\n");
});
