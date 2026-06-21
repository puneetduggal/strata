// test/llm.test.ts
import { expect, test, vi } from "vitest";
test("zod schema compiles for extraction", async () => {
  const { z } = await import("zod");
  const Schema = z.object({ entities: z.array(z.object({ type: z.string(), label: z.string() })) });
  expect(Schema.parse({ entities: [{ type: "Service", label: "auth" }] }).entities.length).toBe(1);
  vi.stubEnv("VOYAGE_API_KEY", "test"); // embed() is integration-tested under EVAL=live
});
