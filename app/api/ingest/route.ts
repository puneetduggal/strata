import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
import { extractText } from "@/lib/ingest/extract-text";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "application/octet-stream";
  const { rawText, pageBreaks } = await extractText(buf, mime);

  const [doc] = await db
    .insert(documents)
    .values({
      filename: file.name,
      mimeType: mime,
      rawText,
      pageCount: pageBreaks.length + 1,
    })
    .returning();

  return NextResponse.json({ id: doc.id });
}
