import { expect, test } from "vitest";
import { extractText } from "@/lib/ingest/extract-text";
test("txt extraction preserves exact text + offsets", async () => {
  const buf = Buffer.from("REQ-1: system must handle 10k req/s.\nService auth-service implements REQ-1.");
  const { rawText, pageBreaks } = await extractText(buf, "text/plain");
  expect(rawText).toContain("REQ-1");
  expect(rawText.slice(0, 5)).toBe("REQ-1");   // offset 0 is exact
  expect(pageBreaks).toEqual([]);
});
