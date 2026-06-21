// lib/llm/claude.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";

export const MODEL = "claude-opus-4-8";
const client = new Anthropic();

export async function extractStructured<T>(opts: { system?: string; user: string; schema: ZodType<T>; maxTokens?: number }): Promise<T> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: zodOutputFormat(opts.schema) },
  });
  if (!res.parsed_output) throw new Error("structured output parse failed");
  return res.parsed_output;
}

export async function narrate(opts: { system?: string; user: string; maxTokens?: number }): Promise<string> {
  const res = await client.messages.create({
    model: MODEL, max_tokens: opts.maxTokens ?? 1024,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: opts.user }],
  });
  return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
}
