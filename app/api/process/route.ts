import { NextResponse } from "next/server";
import { advance } from "@/lib/pipeline/run";

export async function POST(req: Request) {
  const { documentId } = (await req.json()) as { documentId?: number };
  if (typeof documentId !== "number") {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }
  const result = await advance(documentId);
  return NextResponse.json(result);
}
