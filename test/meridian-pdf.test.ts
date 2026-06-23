import { describe, expect, test } from "vitest";
import { mdToPdf } from "../scripts/stress/generate-pdfs";
import { extractText } from "@/lib/ingest/extract-text";

describe("mdToPdf", () => {
  test("renders markdown (incl. a table) to a PDF whose text re-extracts via unpdf", async () => {
    const md = [
      "# identity-service LLD",
      "",
      "The identity-service authenticates users.",
      "",
      "| Service | Owner |",
      "| --- | --- |",
      "| identity-service | Priya Nair |",
    ].join("\n");
    const pdf = await mdToPdf(md);
    expect(pdf.length).toBeGreaterThan(1000); // a real PDF, not empty
    const { rawText } = await extractText(pdf, "application/pdf");
    expect(rawText).toContain("identity-service");
    expect(rawText).toContain("Priya Nair"); // table cell survived extraction
  }, 60_000);
});
