// lib/embed/voyage.ts
const MAX_RETRIES = 6;

// Optional proactive throttle: minimum spacing between embedding calls, in ms. Free-tier Voyage
// is 3 RPM, so the eval harness sets VOYAGE_MIN_INTERVAL_MS=21000 to stay under the limit instead
// of hammering-then-backing-off. Unset (0) in normal app/test runs → no added latency.
const MIN_INTERVAL_MS = Number(process.env.VOYAGE_MIN_INTERVAL_MS ?? 0);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Serialize + space out calls when MIN_INTERVAL_MS > 0 (a single shared gate across the process).
let gate: Promise<void> = Promise.resolve();
async function throttle(): Promise<void> {
  if (MIN_INTERVAL_MS <= 0) return;
  const prev = gate;
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  await prev;
  setTimeout(release, MIN_INTERVAL_MS);
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  await throttle();

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
        body: JSON.stringify({ input: texts, model: "voyage-3" }),
      });
    } catch (err) {
      // NETWORK-level failure: fetch() itself rejected ("fetch failed", ECONNRESET, DNS, timeout, …)
      // before any HTTP response. Under the free-tier throttle these transient drops are common; treat
      // them like a 429/5xx and retry with the same exponential backoff. On exhaustion, re-throw the
      // real error so a persistent failure is NOT masked.
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(20_000 * 2 ** attempt, 90_000));
        continue;
      }
      throw err;
    }

    if (res.ok) {
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    }

    // 429 (rate limit) / 5xx are transient — wait and retry. Honor Retry-After when present,
    // else exponential backoff. Free-tier Voyage is 3 RPM, so a retry waits ~20s+.
    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(20_000 * 2 ** attempt, 90_000);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  }
}
