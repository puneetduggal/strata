import { NextResponse } from "next/server";
import { advance } from "@/lib/pipeline/run";

export async function POST(req: Request) {
  let body: { documentId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { documentId } = body;
  if (typeof documentId !== "number") {
    return NextResponse.json({ error: "documentId required" }, { status: 400 });
  }
  const result = await advance(documentId);
  return NextResponse.json(result);
}
