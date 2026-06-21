import { expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";

test("can insert and read a document", async () => {
  const [row] = await db
    .insert(documents)
    .values({ filename: "x.txt", mimeType: "text/plain", rawText: "hello" })
    .returning();
  expect(row.id).toBeGreaterThan(0);
  expect(row.status).toBe("ingested");
});
