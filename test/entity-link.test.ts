import { afterAll, beforeAll, expect, test, vi } from "vitest";

// MOCK embed: the real Voyage API is never called. We map specific query strings to specific
// 1024-dim vectors so we can drive the VECTOR path deterministically. "login system" maps to a
// vector NEAR the seeded auth-service embedding (high cosine) → vector path surfaces it. Any other
// string (e.g. "AuthService") maps to a vector FAR from it (orthogonal) → only the trigram path
// can surface it, proving lexical matching does the work there.
const NEAR = Array(1024).fill(0) as number[];
NEAR[0] = 1; // unit vector along axis 0 — identical direction to the seeded embedding ⇒ cosine ≈ 1
const FAR = Array(1024).fill(0) as number[];
FAR[1] = 1; // unit vector along axis 1 — orthogonal to the seeded embedding ⇒ cosine 0

vi.mock("@/lib/embed/voyage", () => ({
  embed: vi.fn(async (texts: string[]) =>
    texts.map((t) => (t === "login system" ? NEAR : FAR)),
  ),
}));

import { db } from "@/lib/db/client";
import { entityIndex } from "@/lib/db/schema";
import { linkMention } from "@/lib/search/entity-index";
import { eq, inArray } from "drizzle-orm";

// Shared-DB safe: unique per-run token so our rows can't collide with sibling tests' rows, and we
// scope every assertion to the labels we seeded rather than asserting a global position.
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const AUTH_TYPE = `Service-${SUFFIX}`; // unique entityType → opts.type filter isolates our set
const AUTH_LABEL = `auth-service-${SUFFIX}`;
const DISTRACT_A_LABEL = `billing-service-${SUFFIX}`;
const DISTRACT_B_LABEL = `notification-service-${SUFFIX}`;

// The seeded embedding for auth-service: unit vector along axis 0 (matches NEAR exactly).
const AUTH_EMBED = Array(1024).fill(0) as number[];
AUTH_EMBED[0] = 1;
// Distractor embeddings point along other axes (orthogonal to both NEAR and FAR query vectors).
const DISTRACT_A_EMBED = Array(1024).fill(0) as number[];
DISTRACT_A_EMBED[2] = 1;
const DISTRACT_B_EMBED = Array(1024).fill(0) as number[];
DISTRACT_B_EMBED[3] = 1;

let createdIds: number[] = [];

beforeAll(async () => {
  const rows = await db
    .insert(entityIndex)
    .values([
      {
        entityType: AUTH_TYPE,
        entityId: 1001,
        label: AUTH_LABEL,
        aliases: ["login"],
        searchText: `${AUTH_LABEL} authentication login service`,
        embedding: AUTH_EMBED,
      },
      {
        entityType: AUTH_TYPE,
        entityId: 1002,
        label: DISTRACT_A_LABEL,
        aliases: [],
        searchText: `${DISTRACT_A_LABEL} billing payments invoice`,
        embedding: DISTRACT_A_EMBED,
      },
      {
        entityType: AUTH_TYPE,
        entityId: 1003,
        label: DISTRACT_B_LABEL,
        aliases: [],
        searchText: `${DISTRACT_B_LABEL} notification email sms`,
        embedding: DISTRACT_B_EMBED,
      },
    ])
    .returning({ id: entityIndex.id });
  createdIds = rows.map((r) => r.id);
});

afterAll(async () => {
  if (createdIds.length) await db.delete(entityIndex).where(inArray(entityIndex.id, createdIds));
});

test("vector path: 'login system' (no strong trigram match) surfaces auth-service via cosine", async () => {
  // "login system" is NOT a strong trigram match for "auth-service ..." search_text, but its mocked
  // query embedding (NEAR) is identical in direction to auth-service's embedding ⇒ the vector path
  // ranks it first. Scope to our type so distractor/sibling rows don't perturb the assertion.
  const results = await linkMention("login system", { type: AUTH_TYPE });
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].label).toBe(AUTH_LABEL);
  expect(results[0].entityType).toBe(AUTH_TYPE);
  expect(results[0].entityId).toBe(1001);
  expect(results[0].score).toBeGreaterThan(0);
});

test("trigram path: 'AuthService' (query embedding far from V) surfaces auth-service lexically", async () => {
  // "AuthService" maps to FAR (orthogonal to auth-service's embedding) so the vector path does NOT
  // favour it; word_similarity("auth-service authentication login service", "AuthService") matches
  // lexically, so the trigram path is what ranks auth-service first.
  const results = await linkMention("AuthService", { type: AUTH_TYPE });
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].label).toBe(AUTH_LABEL);
  expect(results[0].entityId).toBe(1001);
});

test("no type filter: unfiltered query is valid SQL and finds our seeded row", async () => {
  // Exercises the no-opts.type branch (empty SQL fragment). Shared-DB safe: we don't assert a
  // global position — only that our auth-service row appears among the fused results when its
  // mocked query embedding (NEAR) makes it the closest vector by direction.
  const results = await linkMention("login system");
  expect(results.some((r) => r.label === AUTH_LABEL && r.entityId === 1001)).toBe(true);
});

test("empty / whitespace mention returns []", async () => {
  expect(await linkMention("")).toEqual([]);
  expect(await linkMention("   ")).toEqual([]);
});
