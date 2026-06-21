import { expect, test, vi } from "vitest";
// Mock the LLM + embedder: this test exercises the full orchestrator through the graph stages
// (extract/resolve/link) without any live service. extractStructured is shared by classify,
// extract and link, so we branch on the requested schema/shape per call.
vi.mock("@/lib/llm/claude", () => ({ extractStructured: vi.fn(), MODEL: "claude-opus-4-8" }));
vi.mock("@/lib/embed/voyage", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => Array(1024).fill(0.03))) }));
import { extractStructured } from "@/lib/llm/claude";
import { db } from "@/lib/db/client";
import { documents, systems, features, edges, attributeProvenance, entityIndex } from "@/lib/db/schema";
import { advance } from "@/lib/pipeline/run";
import { checkEdgeIntegrity } from "@/lib/graph/integrity";
import { and, eq, inArray } from "drizzle-orm";

// Drive advance() until the status stops changing; return the final status.
async function runToTerminal(documentId: number): Promise<string> {
  let prev: string | null = null;
  let cur = "";
  // Guard against an accidental infinite loop in the orchestrator.
  for (let i = 0; i < 12 && cur !== prev; i++) {
    prev = cur;
    cur = (await advance(documentId)).status;
  }
  return cur;
}

test("a software doc runs the full pipeline (classify→index→extract→resolve→link) to status 'ready'", async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const sysLabel = `Checkout-${suffix}`;
  const featLabel = `OneClick-${suffix}`;
  const partOfSnippet = `${featLabel} is part of the ${sysLabel} system.`;
  const rawText = `Product spec.\n\nThe ${sysLabel} system ships checkout.\n\n${partOfSnippet}`;
  expect(rawText.indexOf(partOfSnippet)).toBeGreaterThan(0);

  // Per-call mock for the shared extractStructured:
  //  - classify call → returns a software_dev PRD classification.
  //  - extract call (has a "Document type:" user prompt) → one System + one Feature, each grounded.
  //  - link calls → propose a PART_OF candidate (Feature --PART_OF--> System).
  vi.mocked(extractStructured).mockImplementation(async (args: { user: string }) => {
    const u = args.user;
    if (u.includes("Document type:")) {
      // extract stage
      return {
        entities: [
          { type: "System", label: sysLabel, fields: { description: { value: "ships checkout", snippet: "ships checkout" } } },
          { type: "Feature", label: featLabel, fields: { description: { value: "is part of", snippet: "is part of" } } },
        ],
      } as never;
    }
    if (u.includes("Allowed relations")) {
      // link stage — propose PART_OF from the Feature toward the System.
      return {
        candidates: [
          { relationType: "PART_OF", otherEntityLabel: sysLabel, direction: "out", confidence: 0.9, snippet: partOfSnippet },
        ],
      } as never;
    }
    // classify stage
    return { domain: "software_dev", docType: "PRD", title: "spec", authors: [], docDate: "", summary: "" } as never;
  });

  const [doc] = await db
    .insert(documents)
    .values({ filename: `graph-${suffix}.txt`, mimeType: "text/plain", rawText, status: "ingested" })
    .returning();

  const finalStatus = await runToTerminal(doc.id);
  expect(finalStatus).toBe("ready");

  const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
  expect(after.status).toBe("ready");

  // A further advance() on a ready doc is a no-op terminal {stage:"done", status:"ready"}.
  expect(await advance(doc.id)).toEqual({ stage: "done", status: "ready" });

  // Extract created the typed entities (scoped to this doc via attribute_provenance).
  const prov = await db
    .selectDistinct({ entityType: attributeProvenance.entityType, entityId: attributeProvenance.entityId })
    .from(attributeProvenance)
    .where(eq(attributeProvenance.documentId, doc.id));
  const sysProv = prov.find((p) => p.entityType === "System")!;
  const featProv = prov.find((p) => p.entityType === "Feature")!;
  expect(sysProv).toBeTruthy();
  expect(featProv).toBeTruthy();

  // Resolve wrote entity_index rows for both (canonical) entities.
  const [sysIdx] = await db.select().from(entityIndex).where(and(eq(entityIndex.entityType, "System"), eq(entityIndex.entityId, sysProv.entityId)));
  expect(sysIdx?.label).toBe(sysLabel);

  // Link landed an ACTIVE PART_OF edge Feature --PART_OF--> System between exactly these ids.
  const partOf = await db
    .select()
    .from(edges)
    .where(and(
      eq(edges.relationType, "PART_OF"),
      eq(edges.sourceType, "Feature"), eq(edges.sourceId, featProv.entityId),
      eq(edges.targetType, "System"), eq(edges.targetId, sysProv.entityId),
    ));
  expect(partOf).toHaveLength(1);
  expect(partOf[0].active).toBe(true);

  // Resolve also wrote a deterministic chunk --MENTIONS--> System edge for this doc.
  const mentions = await db
    .select()
    .from(edges)
    .where(and(eq(edges.relationType, "MENTIONS"), eq(edges.targetType, "System"), eq(edges.targetId, sysProv.entityId)));
  expect(mentions.length).toBeGreaterThanOrEqual(1);

  // Polymorphic-edge integrity holds for every edge this doc produced (semantic + MENTIONS).
  const myEdges = await db
    .select()
    .from(edges)
    .where(inArray(edges.id, [...partOf.map((e) => e.id), ...mentions.map((e) => e.id)]));
  const violations = await checkEdgeIntegrity(
    myEdges.map((e) => ({ id: e.id, sourceType: e.sourceType, sourceId: e.sourceId, targetType: e.targetType, targetId: e.targetId })),
  );
  expect(violations).toEqual([]);
});
