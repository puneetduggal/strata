import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents, chunks } from "@/lib/db/schema";
import { embed } from "@/lib/embed/voyage";
import { markDoc } from "./jobs";

const TARGET_CHARS = 1000;

type Span = { charStart: number; charEnd: number };

// Split rawText into ≈TARGET_CHARS windows on paragraph (\n\n) boundaries while
// tracking exact offsets into rawText, so rawText.slice(charStart, charEnd) === text.
export function chunkText(rawText: string): Span[] {
  const paras = rawText.split("\n\n");
  const spans: Span[] = [];

  let cursor = 0;            // position in rawText of the start of the current paragraph
  let winStart: number | null = null; // start offset of the open window
  let winEnd = 0;            // end offset (exclusive) of the open window

  for (const para of paras) {
    // Locate this paragraph exactly in rawText starting at cursor (split is lossy on separators).
    const start = rawText.indexOf(para, cursor);
    const end = start + para.length;
    cursor = end;

    if (para.length === 0) continue; // skip empty paragraphs from repeated separators

    if (winStart === null) {
      winStart = start;
      winEnd = end;
    } else {
      winEnd = end;
    }

    if (winEnd - winStart >= TARGET_CHARS) {
      spans.push({ charStart: winStart, charEnd: winEnd });
      winStart = null;
    }
  }

  if (winStart !== null) spans.push({ charStart: winStart, charEnd: winEnd });
  return spans;
}

export async function indexDoc(documentId: number): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new Error(`index: document ${documentId} not found`);

  const spans = chunkText(doc.rawText);
  const texts = spans.map((s) => doc.rawText.slice(s.charStart, s.charEnd));

  if (texts.length > 0) {
    const embeddings = await embed(texts);
    await db.insert(chunks).values(
      spans.map((s, i) => ({
        documentId,
        page: 1,
        charStart: s.charStart,
        charEnd: s.charEnd,
        text: texts[i],
        embedding: embeddings[i],
      })),
    );
  }

  await markDoc(documentId, "indexed");
}
