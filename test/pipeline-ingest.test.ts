import { expect, test, vi } from "vitest";
vi.mock("@/lib/llm/claude", () => ({ extractStructured: vi.fn(async () => ({ domain: "software_dev", docType: "PRD", title: "Auth PRD", authors: ["A"], docDate: "2026-01-01", summary: "..." })), MODEL: "claude-opus-4-8" }));
vi.mock("@/lib/embed/voyage", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => Array(1024).fill(0.01))) }));
import { db } from "@/lib/db/client";
import { documents, chunks } from "@/lib/db/schema";
import { advance } from "@/lib/pipeline/run";
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
