import { afterAll, beforeAll, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { GET } from "@/app/api/query/route";
import { listEntities } from "@/lib/query/graph";
import { db } from "@/lib/db/client";
import { services, attributeProvenance, documents } from "@/lib/db/schema";

// Task 18 — the table-listing capability: listEntities(type) + GET /api/query?type=.
//
// Shared-DB safe: we seed ONE document + ONE service (unique label) + ONE attribute_provenance
// row for that service's `description` field, then assert the service comes back with that field
// carrying its provenance span. Vitest runs files in parallel against one Postgres, so we scope
// every assertion by the ids we created and clean up in afterAll (no counts / truncation).

const token = `tbl-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
let docId: number;
let svcId: number;
const SPAN = { charStart: 42, charEnd: 96 };

beforeAll(async () => {
  const [doc] = await db
    .insert(documents)
    .values({ filename: `hld-${token}.md`, mimeType: "text/plain", rawText: "x".repeat(200), docType: "HLD" })
    .returning();
  docId = doc.id;

  const [svc] = await db
    .insert(services)
    .values({ label: `auth-service-${token}`, description: "Handles authentication", language: "Go" })
    .returning();
  svcId = svc.id;

  await db.insert(attributeProvenance).values({
    entityType: "Service",
    entityId: svcId,
    field: "description",
    value: "Handles authentication",
    documentId: docId,
    charStart: SPAN.charStart,
    charEnd: SPAN.charEnd,
    snippet: "Handles authentication",
  });
});

afterAll(async () => {
  await db.delete(attributeProvenance).where(eq(attributeProvenance.entityId, svcId));
  await db.delete(services).where(eq(services.id, svcId));
  await db.delete(documents).where(eq(documents.id, docId));
});

test("listEntities('Service') returns the seeded service with its field + provenance span", async () => {
  const rows = await listEntities("Service");
  const seeded = rows.find((r) => r.id === svcId);
  expect(seeded).toBeDefined();
  expect(seeded!.label).toBe(`auth-service-${token}`);

  // The `description` field carries its provenance span (clicks through to /doc/{documentId}?start&end).
  const desc = seeded!.fields.description;
  expect(desc).toBeDefined();
  expect(desc.value).toBe("Handles authentication");
  expect(desc.documentId).toBe(docId);
  expect(desc.charStart).toBe(SPAN.charStart);
  expect(desc.charEnd).toBe(SPAN.charEnd);

  // A field WITHOUT a provenance row (language) is still surfaced, but carries no span.
  const lang = seeded!.fields.language;
  expect(lang).toBeDefined();
  expect(lang.value).toBe("Go");
  expect(lang.documentId).toBeUndefined();
});

test("GET /api/query?type=Service returns the seeded entity with its provenance span", async () => {
  const res = await GET(new Request(`http://localhost/api/query?type=Service`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    entities: Array<{ id: number; label: string; fields: Record<string, { value: string; documentId?: number; charStart?: number; charEnd?: number }> }>;
  };
  const seeded = body.entities.find((e) => e.id === svcId);
  expect(seeded).toBeDefined();
  expect(seeded!.fields.description.documentId).toBe(docId);
  expect(seeded!.fields.description.charStart).toBe(SPAN.charStart);
  expect(seeded!.fields.description.charEnd).toBe(SPAN.charEnd);
});

test("GET /api/query?type=NotAType → 400", async () => {
  const res = await GET(new Request(`http://localhost/api/query?type=NotAType`));
  expect(res.status).toBe(400);
});

test("GET /api/query with no type → 400", async () => {
  const res = await GET(new Request(`http://localhost/api/query`));
  expect(res.status).toBe(400);
});
