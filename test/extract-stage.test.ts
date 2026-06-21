import { expect, test, vi } from "vitest";
vi.mock("@/lib/llm/claude", () => ({ extractStructured: vi.fn(), MODEL: "claude-opus-4-8" }));
import { extractStructured } from "@/lib/llm/claude";
import { db } from "@/lib/db/client";
import { documents, requirements, services, loadTestResults, attributeProvenance } from "@/lib/db/schema";
import { extractDoc } from "@/lib/pipeline/extract";
import { eq, and } from "drizzle-orm";

test("extractDoc inserts typed entities + provenance, drops hallucinated fields", async () => {
  const rawText =
    "REQ-1: The system must handle 10,000 requests per second at peak load.\n\n" +
    "The auth-service is written in Go and owned by the platform team.";
  const [doc] = await db
    .insert(documents)
    .values({ filename: "prd.txt", mimeType: "text/plain", rawText, docType: "PRD", domain: "software_dev", status: "indexed" })
    .returning();

  // One Requirement (text snippet present), one Service (description present, owner HALLUCINATED).
  vi.mocked(extractStructured).mockResolvedValueOnce({
    entities: [
      {
        type: "Requirement",
        label: "REQ-1",
        fields: [{ key: "text", value: "handle 10,000 requests per second", snippet: "handle 10,000 requests per second" }],
      },
      {
        type: "Service",
        label: "auth-service",
        fields: [
          { key: "description", value: "written in Go", snippet: "written in Go" },
          { key: "owner", value: "platform team", snippet: "the database administration group" }, // NOT in rawText → hallucinated
        ],
      },
    ],
  });

  const refs = await extractDoc(doc.id);

  // Returned refs cover both entities.
  expect(refs).toHaveLength(2);
  const reqRef = refs.find((r) => r.type === "Requirement")!;
  const svcRef = refs.find((r) => r.type === "Service")!;
  expect(reqRef.label).toBe("REQ-1");
  expect(svcRef.label).toBe("auth-service");

  // Requirements row created with the located column kept.
  const [reqRow] = await db.select().from(requirements).where(eq(requirements.id, reqRef.id));
  expect(reqRow.label).toBe("REQ-1");
  expect(reqRow.text).toBe("handle 10,000 requests per second");

  // Services row created: located description kept, hallucinated owner dropped (null).
  const [svcRow] = await db.select().from(services).where(eq(services.id, svcRef.id));
  expect(svcRow.label).toBe("auth-service");
  expect(svcRow.description).toBe("written in Go");
  expect(svcRow.owner).toBeNull();

  // Provenance: requirement.text span round-trips against rawText.
  const reqProv = await db
    .select()
    .from(attributeProvenance)
    .where(and(eq(attributeProvenance.entityType, "Requirement"), eq(attributeProvenance.entityId, reqRef.id)));
  expect(reqProv).toHaveLength(1);
  const p = reqProv[0];
  expect(p.field).toBe("text");
  const slice = rawText.slice(p.charStart, p.charEnd);
  expect(slice === p.snippet || slice.replace(/\s+/g, " ") === p.snippet.replace(/\s+/g, " ")).toBe(true);

  // Provenance: service has exactly ONE row (description); the hallucinated owner has none.
  const svcProv = await db
    .select()
    .from(attributeProvenance)
    .where(and(eq(attributeProvenance.entityType, "Service"), eq(attributeProvenance.entityId, svcRef.id)));
  expect(svcProv).toHaveLength(1);
  expect(svcProv[0].field).toBe("description");
  const svcSlice = rawText.slice(svcProv[0].charStart, svcProv[0].charEnd);
  expect(svcSlice === svcProv[0].snippet || svcSlice.replace(/\s+/g, " ") === svcProv[0].snippet.replace(/\s+/g, " ")).toBe(true);
});

test("extractDoc coerces the boolean `passed` field and drops an unparseable boolean", async () => {
  const rawText =
    "Load test run: login load test.\n\n" +
    "Result: FAILED. Observed throughput 8,000 requests/second against the 10,000 target.\n\n" +
    "A second run reported throughput numbers only.";
  const [doc] = await db
    .insert(documents)
    .values({ filename: "loadtest.txt", mimeType: "text/plain", rawText, docType: "load_test_report", domain: "software_dev", status: "indexed" })
    .returning();

  vi.mocked(extractStructured).mockResolvedValueOnce({
    entities: [
      {
        type: "LoadTestResult",
        label: "login load test",
        fields: [
          { key: "observedValue", value: "8,000 requests/second", snippet: "8,000 requests/second" },
          { key: "passed", value: "FAILED", snippet: "Result: FAILED" }, // verdict → boolean false
        ],
      },
      {
        type: "LoadTestResult",
        label: "second run",
        fields: [
          { key: "passed", value: "throughput numbers only", snippet: "throughput numbers only" }, // not a boolean → dropped
        ],
      },
    ],
  });

  const refs = await extractDoc(doc.id);
  const failed = refs.find((r) => r.label === "login load test")!;
  const second = refs.find((r) => r.label === "second run")!;

  const [failedRow] = await db.select().from(loadTestResults).where(eq(loadTestResults.id, failed.id));
  expect(failedRow.observedValue).toBe("8,000 requests/second");
  expect(failedRow.passed).toBe(false); // "FAILED" coerced to boolean false

  const [secondRow] = await db.select().from(loadTestResults).where(eq(loadTestResults.id, second.id));
  expect(secondRow.passed).toBeNull(); // unparseable boolean dropped → column stays null

  // Provenance stores the raw model string for the kept boolean field, span round-trips.
  const prov = await db
    .select()
    .from(attributeProvenance)
    .where(and(eq(attributeProvenance.entityType, "LoadTestResult"), eq(attributeProvenance.entityId, failed.id), eq(attributeProvenance.field, "passed")));
  expect(prov).toHaveLength(1);
  expect(prov[0].value).toBe("FAILED");
  expect(rawText.slice(prov[0].charStart, prov[0].charEnd)).toBe("Result: FAILED");
});

test("extractDoc returns [] for a doc type with no entity sources and never calls the LLM", async () => {
  vi.mocked(extractStructured).mockClear();
  const [doc] = await db
    .insert(documents)
    .values({ filename: "x.txt", mimeType: "text/plain", rawText: "Some unrelated text.", docType: "resume", domain: "hiring", status: "indexed" })
    .returning();

  const refs = await extractDoc(doc.id);
  expect(refs).toEqual([]);
  expect(vi.mocked(extractStructured)).not.toHaveBeenCalled();
});

test("extractDoc returns [] when rawText is empty without calling the LLM", async () => {
  vi.mocked(extractStructured).mockClear();
  const [doc] = await db
    .insert(documents)
    .values({ filename: "empty.txt", mimeType: "text/plain", rawText: "", docType: "PRD", domain: "software_dev", status: "indexed" })
    .returning();

  const refs = await extractDoc(doc.id);
  expect(refs).toEqual([]);
  expect(vi.mocked(extractStructured)).not.toHaveBeenCalled();
});
