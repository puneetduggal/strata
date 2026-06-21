import { expect, test } from "vitest";
import { GET } from "@/app/api/status/route";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";

// Live-DB test: insert a document, call the real GET handler, and assert the
// response JSON shape the dashboard depends on: { docs: [{ id, filename, docType, domain, status }, ...] }.
test("GET /api/status returns docs with {id, filename, docType, domain, status}", async () => {
  const [inserted] = await db
    .insert(documents)
    .values({
      filename: "status-route-fixture.txt",
      mimeType: "text/plain",
      rawText: "hello",
      docType: "PRD",
      domain: "software_dev",
      status: "ready",
    })
    .returning();

  const res = await GET();
  const body = (await res.json()) as {
    docs: Array<{
      id: number;
      filename: string;
      docType: string | null;
      domain: string | null;
      status: string;
    }>;
  };

  expect(Array.isArray(body.docs)).toBe(true);

  const row = body.docs.find((d) => d.id === inserted.id);
  expect(row).toBeDefined();
  // Exactly the fields the dashboard renders — no more, no fewer.
  expect(Object.keys(row!).sort()).toEqual(
    ["docType", "domain", "filename", "id", "status"].sort(),
  );
  expect(row).toMatchObject({
    id: inserted.id,
    filename: "status-route-fixture.txt",
    docType: "PRD",
    domain: "software_dev",
    status: "ready",
  });
});
