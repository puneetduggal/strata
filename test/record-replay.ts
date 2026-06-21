// Task 21 — CI record/replay shim.
//
// Makes the integration test reproducible OFFLINE and DETERMINISTIC by caching the three
// non-deterministic seams (Claude extractStructured / narrate, Voyage embed) keyed by a hash of the
// request. The cassettes are committed JSON under test/fixtures/cassettes/, so the default
// `pnpm test:integration` run replays them with NO network.
//
// Modes (env):
//   EVAL=live          → bypass the cache entirely, call the real impl (no caching).
//   RECORD=1 / =true   → call the real impl AND persist the response to the cassette.
//   default (CI)       → REPLAY from committed cassettes; a MISS throws a clear, actionable error.
//
// Keying:
//   extract: hash("extract\0" + system + "\0" + user)
//   narrate: hash("narrate\0" + system + "\0" + user)
//   embed:   keyed PER TEXT string (each input text → its cached vector), so a different batching
//            of the same texts still reuses the cached vectors.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Mode = "live" | "record" | "replay";

export function mode(): Mode {
  if (process.env.EVAL === "live") return "live";
  if (process.env.RECORD === "1" || process.env.RECORD === "true") return "record";
  return "replay";
}

const CASSETTE_DIR = path.resolve(fileURLToPath(import.meta.url), "../fixtures/cassettes");

// One cassette file per kind-group. claude.json holds extract + narrate (distinct hashes never
// collide because the kind is part of the hashed payload); voyage.json holds per-text embeddings.
const FILE_FOR: Record<string, string> = {
  extract: "claude.json",
  narrate: "claude.json",
  embed: "voyage.json",
};

export function hashRequest(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

type Cassette = Record<string, unknown>;
const cache = new Map<string, Cassette>(); // filename → parsed cassette (lazy)
const dirty = new Set<string>(); // filenames touched in record mode

function load(file: string): Cassette {
  if (cache.has(file)) return cache.get(file)!;
  const p = path.join(CASSETTE_DIR, file);
  const data: Cassette = fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Cassette) : {};
  cache.set(file, data);
  return data;
}

function persist(file: string): void {
  fs.mkdirSync(CASSETTE_DIR, { recursive: true });
  const sorted: Cassette = {};
  for (const k of Object.keys(load(file)).sort()) sorted[k] = load(file)[k];
  fs.writeFileSync(path.join(CASSETTE_DIR, file), JSON.stringify(sorted, null, 2) + "\n");
}

// Persist every cassette touched in record mode. Call once after recording (the integration test
// flushes in an afterAll when RECORD is set).
export function flush(): void {
  for (const file of dirty) persist(file);
  dirty.clear();
}

// Cache one (kind,key) request→response. T must be JSON-serializable.
export async function recordReplay<T>(kind: string, key: string, live: () => Promise<T>): Promise<T> {
  const m = mode();
  if (m === "live") return live();

  const file = FILE_FOR[kind];
  if (!file) throw new Error(`record-replay: unknown kind "${kind}"`);
  const cassette = load(file);
  const full = `${kind}:${key}`;

  if (m === "replay") {
    if (!(full in cassette)) {
      throw new Error(`no cassette for ${full}; re-record with RECORD=1`);
    }
    return cassette[full] as T;
  }

  // record: only call the live API for a MISS (so re-recording is incremental — already-cached
  // requests are reused, which matters under Voyage's slow free-tier throttle). Persist new entries.
  if (full in cassette) return cassette[full] as T;
  const value = await live();
  cassette[full] = value as unknown;
  dirty.add(file);
  return value;
}
