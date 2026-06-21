// test/voyage-retry.test.ts — embed() must retry on a NETWORK-level fetch() rejection (not just
// HTTP 429/5xx). Deterministic: global.fetch is mocked to throw once then succeed, and fake timers
// fast-forward the exponential backoff so no real wall-clock wait happens.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { embed } from "@/lib/embed/voyage";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("embed retries when fetch() throws a network error, then succeeds", async () => {
  const okResponse = {
    ok: true,
    json: async () => ({ data: [{ embedding: Array(1024).fill(0.01) }] }),
  } as unknown as Response;

  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError("fetch failed")) // network drop on first attempt
    .mockResolvedValueOnce(okResponse); // succeeds on retry
  vi.stubGlobal("fetch", fetchMock);

  const p = embed(["hello"]);
  await vi.runAllTimersAsync(); // fast-forward the backoff sleep
  const result = await p;

  expect(fetchMock).toHaveBeenCalledTimes(2); // retried exactly once
  expect(result).toHaveLength(1);
  expect(result[0]).toHaveLength(1024);
});
