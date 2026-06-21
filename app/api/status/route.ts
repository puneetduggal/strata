import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";

export async function GET() {
  const docs = await db
    .select({
      id: documents.id,
      filename: documents.filename,
      docType: documents.docType,
      domain: documents.domain,
      status: documents.status,
    })
    .from(documents)
    .orderBy(desc(documents.id));

  return NextResponse.json({ docs });
}
