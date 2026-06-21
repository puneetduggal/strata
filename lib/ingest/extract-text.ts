import { extractText as extractPdf } from "unpdf";
import mammoth from "mammoth";

export async function extractText(buf: Buffer, mime: string): Promise<{ rawText: string; pageBreaks: number[] }> {
  if (mime === "text/plain") return { rawText: buf.toString("utf8"), pageBreaks: [] };
  if (mime === "application/pdf") {
    const { text } = await extractPdf(new Uint8Array(buf), { mergePages: false });
    const pages = text as string[];
    let raw = ""; const breaks: number[] = [];
    pages.forEach((p, i) => { if (i > 0) breaks.push(raw.length); raw += p; });
    return { rawText: raw, pageBreaks: breaks };
  }
  if (mime.includes("word") || mime.includes("officedocument")) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { rawText: value, pageBreaks: [] };
  }
  throw new Error(`Unsupported mime: ${mime}`);
}
