import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/query/route";
import { db } from "@/lib/db/client";
import { requirements } from "@/lib/db/schema";

// Task 14 — the /api/query route. POST {cq, params} → runCQ → { rows, provenance }.
//
// Shared-DB safe: we seed ONE requirement with a unique label and NO verifying VERIFIES
// edge, then assert Q1 (requirements_without_test) returns it (scoped by the id we created).
// Vitest runs files in parallel against one Postgres, so we never count/truncate shared
// tables and we clean up what we insert in afterAll.

const token = `qr-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
let reqId: number;

// Build a Request the route handler can consume.
const post = (body: unknown, json = true) =>
  POST(
    new Request("http://localhost/api/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json ? JSON.stringify(body) : (body as string),
    }),
  );

beforeAll(async () => {
  const [r] = await db
    .insert(requirements)
    .values({ label: `req-no-test-${token}`, text: "uncovered requirement", kind: "functional" })
    .returning();
  reqId = r.id;
});

afterAll(async () => {
  await db.delete(requirements).where(eq(requirements.id, reqId));
});

test("POST /api/query requirements_without_test → rows include the uncovered requirement", async () => {
  const res = await post({ cq: "requirements_without_test" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: Array<{ id: number }>; provenance: unknown[] };
  expect(Array.isArray(body.rows)).toBe(true);
  expect(Array.isArray(body.provenance)).toBe(true);
  // Scoped assertion: the requirement we created (which has no VERIFIES edge) is present.
  expect(body.rows.some((r) => r.id === reqId)).toBe(true);
});

test("POST /api/query with an unknown cq → 400", async () => {
  const res = await post({ cq: "not_a_real_template" });
  expect(res.status).toBe(400);
});

test("POST /api/query with a non-JSON body → 400 (not 500)", async () => {
  const res = await post("this is not json", false);
  expect(res.status).toBe(400);
});

test("POST /api/query with a missing cq → 400", async () => {
  const res = await post({ params: {} });
  expect(res.status).toBe(400);
});
