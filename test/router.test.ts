import { afterAll, beforeAll, expect, test, vi } from "vitest";

// Task 17 — the intent router. route(question) classifies a NL question to one of the 10 CQ
// templates (deterministic tier) or falls back to RAG. We MOCK the three LLM/embedding
// boundaries so no live API is called and so classification is deterministic:
//   - extractStructured: returns the {template, mentions} we dictate per case.
//   - narrate: echoes its `user` prompt back so we can assert the SQL rowset (ground truth) was
//     handed to it — i.e. the LLM phrases, it never decides set membership.
//   - embed: maps the question to a unit vector identical in direction to our seeded chunk
//     embedding so the cosine RAG path surfaces exactly that chunk.

const NEAR = Array(1024).fill(0) as number[];
NEAR[0] = 1; // unit vector along axis 0 — identical direction to the seeded chunk embedding ⇒ cosine ≈ 1

vi.mock("@/lib/llm/claude", () => ({
  extractStructured: vi.fn(),
  narrate: vi.fn(async (opts: { user: string }) => `NARRATED::${opts.user}`),
  MODEL: "claude-opus-4-8",
}));
vi.mock("@/lib/embed/voyage", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => NEAR)),
}));

import { extractStructured, narrate } from "@/lib/llm/claude";
import { db } from "@/lib/db/client";
import { services, entityIndex, edges, documents, chunks } from "@/lib/db/schema";
import { route } from "@/lib/query/router";
import { eq, inArray } from "drizzle-orm";

// Shared-DB isolation: unique per-run token; every assertion is scoped to ids we created. We never
// truncate or count shared tables. The unique entityType keeps linkMention from matching sibling rows.
const TOKEN = `rt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let authServiceId: number;
let dependentServiceId: number;
let blastEdgeId: number;
let indexIds: number[] = [];
let docId: number;
let chunkId: number;

beforeAll(async () => {
  // --- Template-tier fixture: auth-service (target) + a dependent service that DEPENDS_ON it. ---
  const [auth] = await db
    .insert(services)
    .values({ label: `auth-service-${TOKEN}`, description: "authentication and login" })
    .returning();
  authServiceId = auth.id;

  const [dependent] = await db
    .insert(services)
    .values({ label: `web-app-${TOKEN}`, description: "front-end web app" })
    .returning();
  dependentServiceId = dependent.id;

  // dependent --DEPENDS_ON--> auth ; serviceBlastRadius follows INCOMING DEPENDS_ON, so the
  // dependent is in auth's blast radius and this active edge is its provenance.
  const [edge] = await db
    .insert(edges)
    .values({
      relationType: "DEPENDS_ON",
      kind: "CALLS",
      sourceType: "Service",
      sourceId: dependentServiceId,
      targetType: "Service",
      targetId: authServiceId,
      active: true,
    })
    .returning();
  blastEdgeId = edge.id;

  // entity_index row so linkMention("auth-service") resolves the free-text mention to authServiceId.
  // Embedding axis matters little here: the trigram path on search_text will surface it.
  const idxEmbed = Array(1024).fill(0) as number[];
  idxEmbed[5] = 1;
  const idxRows = await db
    .insert(entityIndex)
    .values({
      entityType: "Service",
      entityId: authServiceId,
      label: `auth-service-${TOKEN}`,
      aliases: ["login"],
      searchText: `auth-service-${TOKEN} authentication login service`,
      embedding: idxEmbed,
    })
    .returning({ id: entityIndex.id });
  indexIds = idxRows.map((r) => r.id);

  // --- RAG-tier fixture: a document + a chunk whose embedding == NEAR (the mocked query vec). ---
  const [doc] = await db
    .insert(documents)
    .values({ filename: `hld-${TOKEN}.txt`, mimeType: "text/plain", rawText: "auth design", docType: "HLD", domain: "software_dev", status: "indexed" })
    .returning();
  docId = doc.id;

  const chunkEmbed = Array(1024).fill(0) as number[];
  chunkEmbed[0] = 1; // identical direction to NEAR ⇒ top cosine hit for the mocked question vector
  const [chunk] = await db
    .insert(chunks)
    .values({
      documentId: docId,
      page: 1,
      charStart: 0,
      charEnd: 42,
      text: `The auth design uses JWT and a session store ${TOKEN}`,
      embedding: chunkEmbed,
    })
    .returning();
  chunkId = chunk.id;
});

afterAll(async () => {
  if (chunkId) await db.delete(chunks).where(eq(chunks.id, chunkId));
  if (docId) await db.delete(documents).where(eq(documents.id, docId));
  if (blastEdgeId) await db.delete(edges).where(eq(edges.id, blastEdgeId));
  if (indexIds.length) await db.delete(entityIndex).where(inArray(entityIndex.id, indexIds));
  await db.delete(services).where(inArray(services.id, [authServiceId, dependentServiceId]));
});

test("template tier: 'what depends on auth-service?' → service_blast_radius, slot resolved via linkMention", async () => {
  vi.mocked(extractStructured).mockResolvedValueOnce({
    template: "service_blast_radius",
    mentions: [`auth-service-${TOKEN}`],
  } as never);

  const res = await route("what depends on auth-service?");

  expect(res.tier).toBe("template");
  // Provenance is the active DEPENDS_ON edge we seeded → proves the slot resolved to authServiceId
  // (the CQ ran with that id) and that membership came from SQL, not the LLM.
  const provIds = res.provenance.map((p: { id: number }) => p.id);
  expect(provIds).toContain(blastEdgeId);

  // narrate was handed the deterministic rowset as ground truth; our echo mock lets us assert the
  // dependent service the SQL returned is what the phrasing layer received.
  expect(vi.mocked(narrate)).toHaveBeenCalled();
  expect(res.answer).toContain(`web-app-${TOKEN}`);
});

test("RAG tier: 'summarize the auth design' → tier rag with chunk provenance", async () => {
  vi.mocked(extractStructured).mockResolvedValueOnce({
    template: "none",
    mentions: [],
  } as never);

  const res = await route("summarize the auth design");

  expect(res.tier).toBe("rag");
  // Chunk provenance carries documentId + char span for click-through.
  const refIds = res.provenance.map((p: { chunkId: number }) => p.chunkId);
  expect(refIds).toContain(chunkId);
  const ref = res.provenance.find((p: { chunkId: number }) => p.chunkId === chunkId) as {
    documentId: number;
    charStart: number;
    charEnd: number;
  };
  expect(ref.documentId).toBe(docId);
  expect(ref.charStart).toBe(0);
  expect(ref.charEnd).toBe(42);

  // narrate phrased the question + retrieved chunk text (ground truth), not invented content.
  expect(res.answer).toContain(TOKEN);
});

test("unresolved slot falls back to RAG (dependency_path needs two services, only one mention)", async () => {
  // dependency_path requires {from, to} (two Service ids). Classify supplies only one mention, so
  // the second slot can't be filled → the router must fall back to RAG rather than crash. This is
  // deterministic regardless of shared-DB contents (the second slot is structurally absent).
  vi.mocked(extractStructured).mockResolvedValueOnce({
    template: "dependency_path",
    mentions: [`auth-service-${TOKEN}`],
  } as never);

  const res = await route("how does auth-service depend on something?");
  expect(res.tier).toBe("rag");
});
