import { NextResponse } from "next/server";
import { route } from "@/lib/query/router";

// The ask gateway: POST {question} → route(question) → { tier, answer, provenance }.
// A non-JSON body or a missing/empty question → 400 (never a 500).

export async function POST(req: Request) {
  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const question = body?.question;
  if (typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "missing question" }, { status: 400 });
  }

  const result = await route(question);
  return NextResponse.json(result);
}
