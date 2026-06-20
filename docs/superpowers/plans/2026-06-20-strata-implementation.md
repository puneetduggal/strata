# Strata — Document → Knowledge-Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Strata — a system that turns a pile of messy technical documents into a queryable knowledge graph (per-domain "graph packages" over a shared citation substrate), with cross-document traceability/impact queries and end-to-end provenance, deployed on Vercel + Neon.

**Architecture:** A Next.js (App Router, TS) app. A domain-agnostic substrate (`documents` + `chunks`+embeddings) is the universal citation source-of-truth. A code-defined "graph package" (Software Dev v1) declares semantic doc types, typed entity tables, a relation registry, and competency questions. A Postgres-backed orchestrated pipeline (ingest → classify → index → extract → resolve → link) processes each doc as isolated, idempotent stages driven by a `jobs` state machine, with a reactive linker. Queries route NL → entity-linking (pgvector + pg_trgm + RRF) → 10 CQ SQL templates (recursive CTEs for traversal) with a RAG fallback. Everything carries provenance.

**Tech Stack:** Next.js 15 (App Router) · TypeScript · React 19 · Tailwind + shadcn/ui · Drizzle ORM + drizzle-kit · Neon Postgres (`pgvector` + `pg_trgm`) · `@anthropic-ai/sdk` (model `claude-opus-4-8`) + Zod structured outputs · Voyage embeddings (`voyage-3`, 1024-dim) · Vitest · pnpm · file parsing via `unpdf` (PDF) / `mammoth` (DOCX) / native (TXT).

## Global Constraints

- **Node** ≥ 20. **Package manager:** pnpm. **Test runner:** Vitest.
- **Claude model:** `claude-opus-4-8` for every LLM call (classify, extract, link, narrate). Do NOT set `temperature`/`top_p`/`top_k` (400 on this model). Do NOT use `thinking: {budget_tokens}` (400); omit `thinking` for structured extraction. Use structured outputs via `client.messages.parse({ output_config: { format: zodOutputFormat(Schema) } })` → `response.parsed_output`. Confirm model IDs with the `claude-api` skill at build time.
- **Embeddings:** Voyage `voyage-3`, **1024 dimensions**. Single `VOYAGE_API_KEY`.
- **Env vars (required):** `DATABASE_URL` (Neon, with `?sslmode=require`), `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`. **Optional tunable:** `LINK_THRESHOLD` (linker active-edge gate, default `0.7`, set to the eval-swept value in Task 24). Provide `.env.example`.
- **Provenance invariant (system-wide):** no `attribute_provenance` row and no `active` edge may exist unless its cited span resolves to the exact text in `documents.raw_text`. Enforced in code + a test.
- **Scope:** v1 builds the **Software Dev** package only. Off-domain docs classify to `domain != "software_dev"` → `status="unrouted"` (substrate-only). OCR, auth, native graph DB, broker async are out of scope.
- **Determinism guardrail:** coverage/transitive/aggregate answers come from SQL over structured columns (the rowset IS the answer); the LLM only phrases them and never decides set membership. Chunks→LLM is for the "how/explain/free-text" path only.

---

## File Structure

```
strata/
  package.json  tsconfig.json  next.config.ts  tailwind.config.ts  vitest.config.ts
  drizzle.config.ts  .env.example  README.md
  app/
    layout.tsx                      # root layout (Tailwind)
    page.tsx                        # dashboard (doc list + pipeline status)
    upload/page.tsx                 # upload UI
    graph/[systemId]/page.tsx       # traceability/graph view (the star)
    doc/[id]/page.tsx               # doc viewer w/ span highlight
    table/page.tsx                  # faceted entity table (thin)
    ask/page.tsx                    # NL ask box
    api/
      ingest/route.ts               # POST file → create document row + enqueue
      process/route.ts              # POST {documentId} → advance pipeline one step
      status/route.ts               # GET pipeline status (dashboard polling)
      query/route.ts                # POST {cq, params} → run a CQ template
      ask/route.ts                  # POST {question} → router (templates|RAG)
  lib/
    db/
      schema.ts                     # Drizzle: substrate + knowledge tables
      client.ts                     # Drizzle client (Neon)
    packages/
      types.ts                      # GraphPackage type
      software.ts                   # Software Dev package: entities, relations, CQs, doc types
    ingest/
      extract-text.ts               # PDF/DOCX/TXT → { rawText, pageBreaks }
    provenance/
      locate.ts                     # find char span of a snippet in raw_text
    embed/
      voyage.ts                     # Voyage embeddings client
    llm/
      claude.ts                     # Anthropic client + structured-output wrapper
    pipeline/
      jobs.ts                       # job/state-machine helpers
      classify.ts                   # stage 1
      index.ts                      # stage 2 (chunk + embed)
      extract.ts                    # stage 3 (typed entities + field provenance)
      resolve.ts                    # stage 4 (entity resolution + MENTIONS + entity_index)
      link.ts                       # stage 5 (reactive linker + threshold + active)
      run.ts                        # orchestrator: advance(documentId)
    search/
      entity-index.ts               # hybrid pgvector + pg_trgm + RRF entity-linking
    query/
      templates.ts                  # 10 CQ SQL templates (recursive CTEs)
      router.ts                     # NL intent → template | RAG
  components/                       # upload-dropzone, processing-dashboard, graph-view, doc-viewer, entity-table, ask-box
  drizzle/                          # generated migrations + 0000_extensions.sql (raw)
  fixtures/
    software-bundle/                # PRD.txt, HLD.txt, LLD-auth.txt, ADR-001.txt, impl-plan.txt, loadtest.txt, resume.txt
    labels.json                     # ground-truth: entities, fields, links, classification, CQ answers
  test/
    *.test.ts                       # unit + integration
    eval/harness.ts  eval/scorecard.ts
```

---

# PHASE 1 — Scaffold + Substrate + Ingest/Classify/Index + Dashboard (Day 1)

*Deliverable: upload the bundle; each doc is classified, chunked, embedded; statuses advance; off-domain doc shows `unrouted`. Deployable.*

## Task 1: Project scaffold + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `vitest.config.ts`, `.env.example`, `app/layout.tsx`, `app/page.tsx`
- Test: `test/smoke.test.ts`

**Interfaces:**
- Produces: a runnable Next.js app + green Vitest.

- [ ] **Step 1: Initialize project and dependencies**

```bash
mkdir -p strata && cd strata
pnpm init
pnpm add next@15 react@19 react-dom@19 drizzle-orm @anthropic-ai/sdk zod unpdf mammoth postgres
pnpm add -D typescript @types/node @types/react @types/react-dom drizzle-kit vitest tsx tailwindcss postcss autoprefixer
pnpm dlx tailwindcss init -p
```

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"], testTimeout: 30_000 },
});
```

- [ ] **Step 3: Write `tsconfig.json`** (Next.js + path alias `@/`)

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "ES2022"], "module": "esnext",
    "moduleResolution": "bundler", "jsx": "preserve", "strict": true, "noEmit": true,
    "esModuleInterop": true, "resolveJsonModule": true, "skipLibCheck": true,
    "paths": { "@/*": ["./*"] }, "plugins": [{ "name": "next" }]
  },
  "include": ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write the failing smoke test**

```ts
// test/smoke.test.ts
import { expect, test } from "vitest";
import { SOFTWARE_PACKAGE } from "@/lib/packages/software"; // exists after Task 6; stub now
test("software package id", () => {
  expect(SOFTWARE_PACKAGE.id).toBe("software_dev");
});
```

- [ ] **Step 5: Run, see it fail** — `pnpm vitest run test/smoke.test.ts` → FAIL (module not found). Temporarily skip with `test.skip` until Task 6, OR create a minimal `lib/packages/software.ts` stub exporting `{ id: "software_dev" }`. Create the stub.

- [ ] **Step 6: `.env.example`** + `app/layout.tsx` (imports `./globals.css` with Tailwind directives) + `app/page.tsx` (placeholder `<main>Strata</main>`).

```
# .env.example
DATABASE_URL=postgres://USER:PASS@HOST/db?sslmode=require
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
# Optional: linker active-edge confidence gate (default 0.7); set to eval-swept value (Task 24)
LINK_THRESHOLD=0.7
```

- [ ] **Step 7: Run tests green + dev boot** — `pnpm vitest run` PASS; `pnpm next dev` boots without error.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js + Drizzle + Vitest project"
```

## Task 2: Database schema — substrate + knowledge layer

**Files:**
- Create: `lib/db/schema.ts`, `lib/db/client.ts`, `drizzle.config.ts`, `drizzle/0000_extensions.sql`
- Test: `test/schema.test.ts`

**Interfaces:**
- Produces: Drizzle tables `documents`, `chunks`, typed entity tables (`systems`, `features`, `requirements`, `services`, `datastores`, `tests`, `loadTestResults`, `decisions`, `persons`), `edges`, `attributeProvenance`, `entityIndex`, `jobs`. A `vector(1024)` custom type. A `db` client.

- [ ] **Step 1: Custom vector type + client**

```ts
// lib/db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { max: 5 });
export const db = drizzle(sql);
export const rawSql = sql;
```

- [ ] **Step 2: Write `lib/db/schema.ts`** (complete — substrate + knowledge)

```ts
import { pgTable, serial, text, integer, boolean, jsonb, timestamp, customType, real, index } from "drizzle-orm/pg-core";

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() { return "vector(1024)"; },
  toDriver(v) { return `[${v.join(",")}]`; },
  fromDriver(v) { return (v as string).slice(1, -1).split(",").map(Number); },
});

// ---- Substrate ----
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  rawText: text("raw_text").notNull().default(""),
  pageCount: integer("page_count").notNull().default(0),
  docType: text("doc_type"),          // "PRD","HLD","LLD","ADR","impl_plan","load_test_report","resume",...
  domain: text("domain"),             // "software_dev" | "hiring" | null
  title: text("title"),
  authors: jsonb("authors").$type<string[]>().default([]),
  docDate: text("doc_date"),
  summary: text("summary"),
  status: text("status").notNull().default("ingested"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

export const chunks = pgTable("chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  page: integer("page").notNull().default(1),
  charStart: integer("char_start").notNull(),
  charEnd: integer("char_end").notNull(),
  text: text("text").notNull(),
  embedding: vector("embedding"),
});

// ---- Typed entity tables (Software Dev package) ----
const entityBase = { id: serial("id").primaryKey(), packageId: text("package_id").notNull().default("software_dev"), label: text("label").notNull() };
export const systems = pgTable("systems", { ...entityBase, description: text("description") });
export const features = pgTable("features", { ...entityBase, description: text("description"), systemId: integer("system_id") });
export const requirements = pgTable("requirements", { ...entityBase, text: text("text"), kind: text("kind"), metric: text("metric"), targetValue: text("target_value"), priority: text("priority") });
export const services = pgTable("services", { ...entityBase, language: text("language"), description: text("description"), owner: text("owner") });
export const datastores = pgTable("datastores", { ...entityBase, engine: text("engine"), purpose: text("purpose") });
export const tests = pgTable("tests", { ...entityBase, kind: text("kind"), description: text("description") });
export const loadTestResults = pgTable("load_test_results", { ...entityBase, scenario: text("scenario"), metric: text("metric"), observedValue: text("observed_value"), targetValue: text("target_value"), passed: boolean("passed") });
export const decisions = pgTable("decisions", { ...entityBase, status: text("status"), rationale: text("rationale") });
export const persons = pgTable("persons", { ...entityBase, role: text("role") });

// ---- Edges (one directed table for all relations) ----
export const edges = pgTable("edges", {
  id: serial("id").primaryKey(),
  packageId: text("package_id").notNull().default("software_dev"),
  relationType: text("relation_type").notNull(),  // PART_OF, SPECIFIES, IMPLEMENTS, DEPENDS_ON, USES, VERIFIES, VALIDATES, AFFECTS, OWNS, MENTIONS
  kind: text("kind"),                              // dependency "how": CALLS|CONSUMES_EVENT|READS_FROM|USES_LIBRARY|SHARES_DATA|CONFIG
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: integer("target_id").notNull(),
  confidence: real("confidence").notNull().default(1),
  active: boolean("active").notNull().default(false),
  evidenceDocumentId: integer("evidence_document_id"),
  chunkId: integer("chunk_id"),
  charStart: integer("char_start"),
  charEnd: integer("char_end"),
  snippet: text("snippet"),
  attributes: jsonb("attributes").$type<Record<string, unknown>>().default({}),
}, (t) => ({ srcIdx: index("edges_src_idx").on(t.sourceType, t.sourceId), tgtIdx: index("edges_tgt_idx").on(t.targetType, t.targetId) }));

// ---- Provenance + search + orchestration ----
export const attributeProvenance = pgTable("attribute_provenance", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), entityId: integer("entity_id").notNull(),
  field: text("field").notNull(), value: text("value"),
  documentId: integer("document_id").notNull(), charStart: integer("char_start").notNull(), charEnd: integer("char_end").notNull(),
  snippet: text("snippet").notNull(), confidence: real("confidence").notNull().default(1),
});

export const entityIndex = pgTable("entity_index", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), entityId: integer("entity_id").notNull(),
  label: text("label").notNull(), aliases: jsonb("aliases").$type<string[]>().default([]),
  searchText: text("search_text").notNull(), embedding: vector("embedding"),
});

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull(),
  stage: text("stage").notNull(),        // ingest|classify|index|extract|resolve|link|done
  status: text("status").notNull(),      // pending|running|completed|failed
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

- [ ] **Step 3: `drizzle.config.ts` + raw extensions/index migration**

```ts
// drizzle.config.ts
import type { Config } from "drizzle-kit";
export default { schema: "./lib/db/schema.ts", out: "./drizzle", dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL! } } satisfies Config;
```

```sql
-- drizzle/0000_extensions.sql  (run before drizzle migrations)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

- [ ] **Step 4: Write the failing test**

```ts
// test/schema.test.ts
import { expect, test } from "vitest";
import { db } from "@/lib/db/client";
import { documents } from "@/lib/db/schema";
test("can insert and read a document", async () => {
  const [row] = await db.insert(documents).values({ filename: "x.txt", mimeType: "text/plain", rawText: "hello" }).returning();
  expect(row.id).toBeGreaterThan(0);
  expect(row.status).toBe("ingested");
});
```

- [ ] **Step 5: Generate + apply migrations against a test DB**

```bash
psql "$DATABASE_URL" -f drizzle/0000_extensions.sql
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

- [ ] **Step 6: Run test green** — `pnpm vitest run test/schema.test.ts` → PASS.

- [ ] **Step 7: Add HNSW + trigram indexes (raw SQL migration `drizzle/0001_indexes.sql`), apply**

```sql
CREATE INDEX IF NOT EXISTS chunks_embed_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS entity_index_embed_hnsw ON entity_index USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS entity_index_trgm ON entity_index USING gin (search_text gin_trgm_ops);
```

- [ ] **Step 8: Commit** — `git commit -am "feat: db schema (substrate + knowledge layer) + pgvector/pg_trgm indexes"`

## Task 3: Text extraction with offsets

**Files:**
- Create: `lib/ingest/extract-text.ts`
- Test: `test/extract-text.test.ts`, fixtures `fixtures/software-bundle/PRD.txt`

**Interfaces:**
- Produces: `extractText(buf: Buffer, mime: string): Promise<{ rawText: string; pageBreaks: number[] }>` — `pageBreaks[i]` = char offset where page `i+2` begins (TXT: single page).

- [ ] **Step 1: Failing test**

```ts
// test/extract-text.test.ts
import { expect, test } from "vitest";
import { extractText } from "@/lib/ingest/extract-text";
test("txt extraction preserves exact text + offsets", async () => {
  const buf = Buffer.from("REQ-1: system must handle 10k req/s.\nService auth-service implements REQ-1.");
  const { rawText, pageBreaks } = await extractText(buf, "text/plain");
  expect(rawText).toContain("REQ-1");
  expect(rawText.slice(0, 5)).toBe("REQ-1");   // offset 0 is exact
  expect(pageBreaks).toEqual([]);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
// lib/ingest/extract-text.ts
import { extractText as extractPdf } from "unpdf";
import mammoth from "mammoth";

export async function extractText(buf: Buffer, mime: string): Promise<{ rawText: string; pageBreaks: number[] }> {
  if (mime === "text/plain") return { rawText: buf.toString("utf8"), pageBreaks: [] };
  if (mime === "application/pdf") {
    const { text } = await extractPdf(new Uint8Array(buf), { mergePages: false });
    const pages = text as string[];
    let raw = ""; const breaks: number[] = [];
    pages.forEach((p, i) => { if (i > 0) breaks.push(raw.length); raw += p; });
    return { rawText: raw, pageBreaks: breaks };
  }
  if (mime.includes("word") || mime.includes("officedocument")) {
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { rawText: value, pageBreaks: [] };
  }
  throw new Error(`Unsupported mime: ${mime}`);
}
```

- [ ] **Step 4: Run green. Step 5: Commit** — `git commit -am "feat: text extraction with char offsets (pdf/docx/txt)"`

## Task 4: Provenance span locator

**Files:** Create `lib/provenance/locate.ts`; Test `test/locate.test.ts`

**Interfaces:** Produces `locateSpan(rawText: string, snippet: string): { charStart: number; charEnd: number } | null` — exact match first, then whitespace-normalized fallback; returns `null` if not found (→ caller drops the value/edge).

- [ ] **Step 1: Failing test**

```ts
// test/locate.test.ts
import { expect, test } from "vitest";
import { locateSpan } from "@/lib/provenance/locate";
test("locates exact snippet", () => {
  const raw = "The auth-service calls payment-service /charge.";
  const s = locateSpan(raw, "payment-service /charge");
  expect(raw.slice(s!.charStart, s!.charEnd)).toBe("payment-service /charge");
});
test("returns null for hallucinated snippet", () => {
  expect(locateSpan("abc def", "not present")).toBeNull();
});
```

- [ ] **Step 2: FAIL. Step 3: Implement**

```ts
// lib/provenance/locate.ts
export function locateSpan(rawText: string, snippet: string) {
  const s = snippet.trim();
  if (!s) return null;
  let i = rawText.indexOf(s);
  if (i >= 0) return { charStart: i, charEnd: i + s.length };
  // whitespace-normalized fallback: collapse runs of whitespace
  const norm = (x: string) => x.replace(/\s+/g, " ");
  const ni = norm(rawText).indexOf(norm(s));
  if (ni < 0) return null;
  // map normalized index back: re-scan rawText counting normalized chars
  let raw = 0, normCount = 0, start = -1;
  const target = norm(s).length;
  const normRaw = norm(rawText);
  void normRaw;
  for (; raw < rawText.length; raw++) {
    const isWs = /\s/.test(rawText[raw]);
    const prevWs = raw > 0 && /\s/.test(rawText[raw - 1]);
    if (isWs && prevWs) continue;
    if (normCount === ni) start = raw;
    normCount++;
    if (start >= 0 && normCount - ni >= target) return { charStart: start, charEnd: raw + 1 };
  }
  return null;
}
```

- [ ] **Step 4: Run green. Step 5: Commit** — `git commit -am "feat: provenance span locator (exact + ws-normalized)"`

## Task 5: Voyage embeddings + Claude structured-output wrapper

**Files:** Create `lib/embed/voyage.ts`, `lib/llm/claude.ts`; Test `test/llm.test.ts` (mocked)

**Interfaces:**
- `embed(texts: string[]): Promise<number[][]>` (voyage-3, 1024-dim).
- `extractStructured<T>(opts: { system?: string; user: string; schema: ZodType<T>; maxTokens?: number }): Promise<T>`.

- [ ] **Step 1: Implement `lib/embed/voyage.ts`**

```ts
// lib/embed/voyage.ts
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ input: texts, model: "voyage-3" }),
  });
  if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}
```

- [ ] **Step 2: Implement `lib/llm/claude.ts`** (verified pattern: `messages.parse` + `zodOutputFormat`)

```ts
// lib/llm/claude.ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";

export const MODEL = "claude-opus-4-8";
const client = new Anthropic();

export async function extractStructured<T>(opts: { system?: string; user: string; schema: ZodType<T>; maxTokens?: number }): Promise<T> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: zodOutputFormat(opts.schema) },
  });
  if (!res.parsed_output) throw new Error("structured output parse failed");
  return res.parsed_output;
}

export async function narrate(opts: { system?: string; user: string; maxTokens?: number }): Promise<string> {
  const res = await client.messages.create({
    model: MODEL, max_tokens: opts.maxTokens ?? 1024,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: opts.user }],
  });
  return res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
}
```

- [ ] **Step 3: Test (no network — assert wrapper shape via a Zod round-trip mock)**

```ts
// test/llm.test.ts
import { expect, test, vi } from "vitest";
test("zod schema compiles for extraction", async () => {
  const { z } = await import("zod");
  const Schema = z.object({ entities: z.array(z.object({ type: z.string(), label: z.string() })) });
  expect(Schema.parse({ entities: [{ type: "Service", label: "auth" }] }).entities.length).toBe(1);
  vi.stubEnv("VOYAGE_API_KEY", "test"); // embed() is integration-tested under EVAL=live
});
```

- [ ] **Step 4: Run green. Step 5: Commit** — `git commit -am "feat: voyage embeddings + claude structured-output wrapper"`

## Task 6: The Software Dev graph package definition

**Files:** Create `lib/packages/types.ts`, `lib/packages/software.ts` (replaces the Task 1 stub); Test `test/package.test.ts`

**Interfaces:** Produces `SOFTWARE_PACKAGE: GraphPackage` with `id`, `docTypes`, `entityTypes` (table name + searchable fields), `relations` (registry incl. inverse label + dependency kinds), `competencyQuestions` (Q1–Q10 metadata used by the router).

- [ ] **Step 1: `lib/packages/types.ts`**

```ts
export type RelationDef = { type: string; inverse: string; sourceType: string; targetType: string; kinds?: string[] };
export type EntityTypeDef = { type: string; table: string; searchFields: string[] };
export type CQ = { id: string; question: string; kind: "lookup" | "coverage_gap" | "impact" | "trace" | "reconcile" | "rationale"; template: string };
export type GraphPackage = {
  id: string; docTypes: string[]; docTypeSources: Record<string, string[]>; entityTypes: EntityTypeDef[]; relations: RelationDef[]; competencyQuestions: CQ[];
};
```

- [ ] **Step 2: `lib/packages/software.ts`** — full registry

```ts
import type { GraphPackage } from "./types";
export const SOFTWARE_PACKAGE: GraphPackage = {
  id: "software_dev",
  docTypes: ["PRD", "HLD", "LLD", "ARD", "ADR", "impl_plan", "load_test_report"],
  // §6d: doc-type → entity types that doc is the primary source for (drives Task 9 extraction)
  docTypeSources: {
    PRD: ["System", "Feature", "Requirement"],
    HLD: ["System", "Service", "Datastore", "Decision", "Person"],
    ARD: ["System", "Service", "Datastore", "Decision", "Person"],
    LLD: ["Service", "Datastore", "Person"],
    ADR: ["Decision"],
    impl_plan: ["Service", "Requirement"],
    load_test_report: ["LoadTestResult"],
  },
  entityTypes: [
    { type: "System", table: "systems", searchFields: ["label", "description"] },
    { type: "Feature", table: "features", searchFields: ["label", "description"] },
    { type: "Requirement", table: "requirements", searchFields: ["label", "text"] },
    { type: "Service", table: "services", searchFields: ["label", "description"] },
    { type: "Datastore", table: "datastores", searchFields: ["label", "purpose"] },
    { type: "Test", table: "tests", searchFields: ["label", "description"] },
    { type: "LoadTestResult", table: "load_test_results", searchFields: ["label", "scenario"] },
    { type: "Decision", table: "decisions", searchFields: ["label", "rationale"] },
    { type: "Person", table: "persons", searchFields: ["label", "role"] },
  ],
  relations: [
    { type: "PART_OF", inverse: "HAS_FEATURE", sourceType: "Feature", targetType: "System" },
    { type: "SPECIFIES", inverse: "SPECIFIED_BY", sourceType: "Requirement", targetType: "Feature" },
    { type: "IMPLEMENTS", inverse: "IMPLEMENTED_BY", sourceType: "Service", targetType: "Requirement" },
    { type: "DEPENDS_ON", inverse: "DEPENDED_ON_BY", sourceType: "Service", targetType: "Service", kinds: ["CALLS", "CONSUMES_EVENT", "READS_FROM", "USES_LIBRARY", "SHARES_DATA", "CONFIG"] },
    { type: "USES", inverse: "USED_BY", sourceType: "Service", targetType: "Datastore" },
    { type: "VERIFIES", inverse: "VERIFIED_BY", sourceType: "Test", targetType: "Requirement" },
    { type: "VALIDATES", inverse: "VALIDATED_BY", sourceType: "LoadTestResult", targetType: "Requirement" },
    { type: "AFFECTS", inverse: "AFFECTED_BY", sourceType: "Decision", targetType: "Service" },
    { type: "OWNS", inverse: "OWNED_BY", sourceType: "Person", targetType: "Service" },
    { type: "MENTIONS", inverse: "MENTIONED_IN", sourceType: "chunk", targetType: "*" },
  ],
  competencyQuestions: [
    { id: "Q1", question: "Which requirements have no verifying test?", kind: "coverage_gap", template: "requirements_without_test" },
    { id: "Q2", question: "Which services have no design doc / no load test?", kind: "coverage_gap", template: "services_coverage_gaps" },
    { id: "Q3", question: "What depends on Service X / what breaks if it changes?", kind: "impact", template: "service_blast_radius" },
    { id: "Q4", question: "Show the PRD→LLD→impl→load-test chain for Feature F", kind: "trace", template: "feature_chain" },
    { id: "Q5", question: "What datastore does Service X use?", kind: "lookup", template: "service_datastore" },
    { id: "Q6", question: "Did the load test meet the PRD target?", kind: "reconcile", template: "loadtest_vs_target" },
    { id: "Q7", question: "What decisions affected Service X, and why?", kind: "rationale", template: "service_decisions" },
    { id: "Q8", question: "Who owns Service X?", kind: "lookup", template: "service_owner" },
    { id: "Q9", question: "If Feature F changes, what is the full blast radius?", kind: "impact", template: "feature_blast_radius" },
    { id: "Q10", question: "How does Service X transitively depend on Service Z?", kind: "impact", template: "dependency_path" },
  ],
};
```

- [ ] **Step 3: Test** — assert 9 entity types, 10 relations, 10 CQs; DEPENDS_ON has the 6 kinds; every CQ `template` is unique; every `docTypeSources` key is in `docTypes` and every sourced type name is a declared `entityTypes[].type`. Run green. **Step 4: Commit** — `git commit -am "feat: Software Dev graph package definition (entities, relations, CQs)"`. (Remove `test.skip` from Task 1's smoke test.)

## Task 7: Jobs/state-machine + ingest API + classify stage + index stage + orchestrator

**Files:** Create `lib/pipeline/jobs.ts`, `lib/pipeline/classify.ts`, `lib/pipeline/index.ts`, `lib/pipeline/run.ts`, `app/api/ingest/route.ts`, `app/api/process/route.ts`, `app/api/status/route.ts`; Test `test/pipeline-ingest.test.ts`

**Interfaces:**
- `advance(documentId): Promise<{ stage: string; status: string }>` — runs the next pending stage, updates `documents.status` + `jobs`, returns new state. Idempotent per stage.
- `classifyDoc(documentId)` (stage 1): one `extractStructured` call → sets `domain`, `docType`, `title`, `authors`, `docDate`, `summary`. If `domain !== "software_dev"` → status `unrouted`, skip later stages.
- `indexDoc(documentId)` (stage 2): chunk `rawText` (≈1000-char windows on paragraph boundaries, with offsets) → `embed` → insert `chunks`. Runs for ALL docs.

- [ ] **Step 1: `lib/pipeline/jobs.ts`** — `STAGES = ["ingest","classify","index","extract","resolve","link","done"]`; `nextStage(current)`, `setStatus(documentId, stage, status, error?)`, `markDoc(documentId, status)`.

- [ ] **Step 2: Failing test (mock LLM + embed)**

```ts
// test/pipeline-ingest.test.ts
import { expect, test, vi } from "vitest";
vi.mock("@/lib/llm/claude", () => ({ extractStructured: vi.fn(async () => ({ domain: "software_dev", docType: "PRD", title: "Auth PRD", authors: ["A"], docDate: "2026-01-01", summary: "..." })), MODEL: "claude-opus-4-8" }));
vi.mock("@/lib/embed/voyage", () => ({ embed: vi.fn(async (t: string[]) => t.map(() => Array(1024).fill(0.01))) }));
import { db } from "@/lib/db/client";
import { documents, chunks } from "@/lib/db/schema";
import { advance } from "@/lib/pipeline/run";
import { eq } from "drizzle-orm";

test("ingest→classify→index advances status and creates chunks", async () => {
  const [doc] = await db.insert(documents).values({ filename: "prd.txt", mimeType: "text/plain", rawText: "REQ-1: handle 10k req/s.\n\nThe auth-service implements it.", status: "ingested" }).returning();
  await advance(doc.id); // classify
  await advance(doc.id); // index
  const [after] = await db.select().from(documents).where(eq(documents.id, doc.id));
  expect(after.domain).toBe("software_dev");
  const c = await db.select().from(chunks).where(eq(chunks.documentId, doc.id));
  expect(c.length).toBeGreaterThan(0);
  expect(after.rawText.slice(c[0].charStart, c[0].charEnd)).toBe(c[0].text); // offset invariant
});
```

- [ ] **Step 3: FAIL. Step 4: Implement `classify.ts`, `index.ts`, `run.ts`.** `classify` uses a Zod schema `{ domain, docType, title, authors[], docDate, summary }` with a system prompt enumerating the Software doc types from `SOFTWARE_PACKAGE.docTypes` (`PRD`, `HLD`, `LLD`, `ARD` = architecture/requirements design doc, `ADR` = architecture decision record, `impl_plan`, `load_test_report` — note `ARD` is a design doc and is distinct from `ADR`, a decision record) + "if not a software-engineering document, set domain to its best-guess domain (e.g. hiring) — not software_dev". `index` splits on `\n\n`, accumulates ≈1000-char windows tracking running offset so `rawText.slice(start,end) === chunk.text` exactly, embeds in one `embed()` batch, inserts. `run.advance` reads current stage, dispatches, handles `unrouted` short-circuit, writes `jobs` + `documents.status`, catches errors → `status="failed"` (rest of pile proceeds).

- [ ] **Step 5: Run green.** Add `app/api/ingest/route.ts` (multipart → `extractText` → insert `documents` → return id), `app/api/process/route.ts` (`{documentId}` → `advance`), `app/api/status/route.ts` (GET → docs + jobs for dashboard).

- [ ] **Step 6: Commit** — `git commit -am "feat: pipeline jobs + ingest/classify/index stages + orchestrator + API"`

## Task 8: Upload UI + processing dashboard

**Files:** Create `components/upload-dropzone.tsx`, `components/processing-dashboard.tsx`, `app/upload/page.tsx`, `app/page.tsx` (dashboard); Test `test/status-route.test.ts`

**Interfaces:** Dashboard polls `/api/status` every 1.5s; renders each doc's `filename`, `docType`, `domain`, `status` with a stage progress indicator; "unrouted" docs shown distinctly. Upload posts each file to `/api/ingest` then kicks `/api/process` repeatedly until status is `ready`/`failed`/`unrouted`.

- [ ] **Step 1: Failing test** for `/api/status` shape (returns `{ docs: [{id, filename, docType, domain, status}] }`). **Step 2: FAIL → implement route + components. Step 3: green.**
- [ ] **Step 4: Manual verify** — `pnpm next dev`, upload `fixtures/software-bundle/*`, watch statuses advance; resume.txt → `unrouted`.
- [ ] **Step 5: Commit** — `git commit -am "feat: upload UI + live processing dashboard"`

---

# PHASE 2 — Typed Entity Extraction + Resolution (Day 2)

*Deliverable: the bundle yields one node per real-world thing across docs; every field cites a span.*

## Task 9: Extract stage (typed entities + field provenance)

**Files:** Create `lib/pipeline/extract.ts`; Test `test/extract-stage.test.ts`

**Interfaces:** Produces `extractDoc(documentId)` (stage 3): for the doc's `docType`, prompt Claude (structured) for the entity types that doc sources (per `SOFTWARE_PACKAGE` doc-type→entity mapping). Output schema: `{ entities: [{ type, label, fields: {k: {value, snippet}} }] }`. For each field, `locateSpan(rawText, snippet)`; if found, insert into the typed table + `attributeProvenance`; if `null`, drop that field (provenance invariant). Returns created entity refs `[{type, id, label}]`.

- [ ] **Step 1: Failing test** — mock `extractStructured` to return a Requirement + a Service with snippets present in `rawText`; assert rows land in `requirements`/`services`, each with an `attribute_provenance` row whose span resolves; a field with a hallucinated snippet is dropped.
- [ ] **Step 2: FAIL. Step 3: Implement** — `extractDoc` reads `SOFTWARE_PACKAGE.docTypeSources[doc.docType] ?? []` to get the entity types to request (empty list → skip extraction; doc still advances); a per-doc-type prompt builder asks Claude only for those types; a generic `insertEntity(type, fields)` switch over the 9 typed tables; provenance loop using `locateSpan`.
- [ ] **Step 4: green. Step 5: Commit** — `git commit -am "feat: extract stage — typed entities + per-field provenance"`

## Task 10: Resolve stage (entity resolution + MENTIONS + entity_index)

**Files:** Create `lib/pipeline/resolve.ts`; Test `test/resolve-stage.test.ts`

**Interfaces:** Produces `resolveDoc(documentId)` (stage 4): for each freshly-extracted entity, find an existing same-type entity by (a) exact/normalized label match, then (b) trigram similarity ≥ 0.6 over `entity_index.search_text`; if matched, merge (keep canonical, repoint provenance) else keep. For every entity, upsert an `entity_index` row (`label`, `aliases`, `search_text = label + " " + key fields`, `embedding` via `embed`). Add `chunk —MENTIONS→ entity` edges for chunks whose text contains the entity label. **MENTIONS edges are deterministic provenance edges, not confidence-gated proposals**: insert each with `confidence = 1` and `active = true` directly (no threshold gate — the linker's `active` computation in Task 11 applies only to proposed semantic edges). Each MENTIONS edge sets `evidence_document_id = the chunk's document_id`, `chunk_id = the chunk's id`, and `char_start`/`char_end`/`snippet` from the label match within the chunk (offsets relative to `raw_text`), so Q2's `documents` join resolves and the provenance is clickable in the doc viewer.

- [ ] **Step 1: Failing test** — two docs each mention "auth-service"; after resolving both, exactly one `services` row exists and ≥2 MENTIONS edges point to it; each MENTIONS edge has `active = true`, `confidence = 1`, a non-null `evidence_document_id` matching its chunk's document, and a span where `raw_text.slice(charStart, charEnd)` equals the matched label; `entity_index` has an embedding.
- [ ] **Step 2: FAIL. Step 3: Implement.** **Step 4: green. Step 5: Commit** — `git commit -am "feat: resolve stage — entity resolution + MENTIONS edges + entity_index"`

---

# PHASE 3 ⭐ — Edges + Reactive Linker + CQ Templates + Traceability View (Day 3, the gradeable core)

*Deliverable (money-shot): graph for the system, requirements-with-no-test in red, click a value → source span. Deployable.*

## Task 11: Reactive linker (threshold + evidence-grounding + active flag)

**Files:** Create `lib/pipeline/link.ts`; Test `test/link-stage.test.ts`

**Interfaces:** Produces `linkEntity(entityRef)` — triggered per resolved entity (stage 5 calls it for each entity in the doc): given the entity + the existing graph, prompt Claude (structured) for candidate edges (both directions) whose source/target types are allowed by the relation registry, each with `{relationType, kind?, otherEntityLabel, direction, confidence, snippet}`. For each candidate: resolve `otherEntityLabel` to an existing entity (skip if none); `locateSpan` the snippet (drop if null — anti-phantom); insert into `edges` with `active = confidence >= THRESHOLD && spanLocated`, where `const THRESHOLD = Number(process.env.LINK_THRESHOLD ?? 0.7)`. **Order-independent** (re-running when the other endpoint later appears finds it) and **idempotent** (upsert on `(relationType, sourceType, sourceId, targetType, targetId)`). The gate reads `LINK_THRESHOLD` from env (default 0.7) — the same name written by Task 24's sweep and published in the README (Task 23).

- [ ] **Step 1: Failing test** — create Requirement R1 + Test T1; mock linker to propose `T1 —VERIFIES→ R1` conf 0.9 with a grounded snippet → an `active` edge appears; a conf-0.5 proposal → row exists but `active=false`; an ungrounded snippet → no row.
- [ ] **Step 2: FAIL. Step 3: Implement** (incl. upsert + the relation-registry guard). **Step 4: green. Step 5: Commit** — `git commit -am "feat: reactive linker — grounded, thresholded, idempotent typed edges"`

## Task 12: Wire link stage into orchestrator + polymorphic-edge integrity test

**Files:** Modify `lib/pipeline/run.ts`; Test `test/edge-integrity.test.ts`

- [ ] **Step 1:** `advance` at stage `link` iterates the doc's resolved entities → `linkEntity` → stage `done` → `documents.status="ready"`.
- [ ] **Step 2: Integrity test** — every `active` edge's `(sourceType,sourceId)` and `(targetType,targetId)` resolve to a live row in the named typed table (or `chunks`/`documents` for MENTIONS). Run green.
- [ ] **Step 3: Commit** — `git commit -am "feat: wire link stage + polymorphic-edge integrity invariant test"`

## Task 13: The 10 CQ SQL templates (recursive CTEs)

**Files:** Create `lib/query/templates.ts`; Test `test/cq-templates.test.ts` (against a hand-built golden graph)

**Interfaces:** Produces `runCQ(templateId: string, params: Record<string, unknown>): Promise<{ rows: any[]; provenance: EdgeRef[] }>`. All traversal queries filter `edges.active = true`; transitive ones use recursive CTEs over the `DEPENDS_ON` family with a visited-set (cycle-safe) following **incoming** edges for blast-radius.

- [ ] **Step 1: Failing test** — insert a golden graph (System S, Feature F; Feature F `SPECIFIES` Requirements R1/R2; Service A `IMPLEMENTS` R1; Services A/B/C with A→B→C DEPENDS_ON; Test T1 `VERIFIES` R1 only; LoadTestResult `VALIDATES` R1 (the requirement Service A implements); an HLD document with a chunk MENTIONS→A so A is "design-doc covered", and Service B/C have neither a design-doc MENTIONS nor a LoadTestResult; all these edges `active = true`). Assert: Q1 returns exactly `{R2}` (no test); Q2 (`services_coverage_gaps`) flags each service with `{noDesignDoc, noLoadTest}` booleans — A has both false, B and C have `noDesignDoc=true` and `noLoadTest=true`; Q3 blast radius of C returns `{B, A}`; Q9 feature-F blast radius includes the implementing services + their transitive dependents **and the verification artifacts attached to the impacted requirements/services** — assert T1 (VERIFIES R1) and the LoadTestResult (VALIDATES, via Service A) appear in the returned tests/loadTestResults; Q10 (`dependency_path`) for "how does A depend on C" returns the ordered outgoing path `A → B → C`, while querying the reverse (C depends on A) returns no path; cycle (A→B→A) does not loop.
- [ ] **Step 2: FAIL. Step 3: Implement each template.** Reference shapes:

```ts
// Q1 requirements_without_test
const q1 = `SELECT r.* FROM requirements r
  WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.active AND e.relation_type='VERIFIES' AND e.target_type='Requirement' AND e.target_id=r.id)`;

// Q2 services_coverage_gaps — flags BOTH "no design doc" and "no load test" per service.
//  - no load test: no active VALIDATES edge from any LoadTestResult to a requirement the service IMPLEMENTS,
//    OR (simpler, matching the spec's Service↔LoadTestResult mention) no LoadTestResult covering the service.
//  - no design doc: no chunk MENTIONS edge whose evidence document is an HLD/LLD/ARD.
//    (MENTIONS edges carry evidence_document_id = the chunk's document; doc_type lives on documents.)
const q2 = `SELECT s.*,
    NOT EXISTS (
      SELECT 1 FROM edges m
      JOIN documents d ON d.id = m.evidence_document_id
      WHERE m.active AND m.relation_type='MENTIONS'
        AND m.target_type='Service' AND m.target_id = s.id
        AND d.doc_type IN ('HLD','LLD','ARD')
    ) AS "noDesignDoc",
    NOT EXISTS (
      SELECT 1 FROM edges v
      WHERE v.active AND v.relation_type='VALIDATES'
        AND v.source_type='LoadTestResult'
        AND v.target_type='Requirement'
        AND v.target_id IN (
          SELECT i.target_id FROM edges i
          WHERE i.active AND i.relation_type='IMPLEMENTS'
            AND i.source_type='Service' AND i.source_id = s.id
        )
    ) AS "noLoadTest"
  FROM services s`;

// Q3 service_blast_radius (incoming DEPENDS_ON, recursive, cycle-safe)
const q3 = `WITH RECURSIVE impact(id, path) AS (
    SELECT $1::int, ARRAY[$1::int]
  UNION ALL
    SELECT e.source_id, impact.path || e.source_id
    FROM edges e JOIN impact ON e.target_type='Service' AND e.target_id = impact.id
    WHERE e.active AND e.relation_type='DEPENDS_ON' AND NOT e.source_id = ANY(impact.path)
  )
  SELECT DISTINCT s.* FROM impact JOIN services s ON s.id = impact.id WHERE impact.id <> $1`;

// Q10 dependency_path (OUTGOING DEPENDS_ON, recursive, cycle-safe)
//  "How does Service X ($1) transitively depend on Service Z ($2)?" → returns the ordered
//  path X → … → Z (the things X depends on). Follows source→target (outgoing), opposite of Q3.
const q10 = `WITH RECURSIVE dep(id, path) AS (
    SELECT $1::int, ARRAY[$1::int]
  UNION ALL
    SELECT e.target_id, dep.path || e.target_id
    FROM edges e JOIN dep ON e.source_type='Service' AND e.source_id = dep.id
    WHERE e.active AND e.relation_type='DEPENDS_ON' AND NOT e.target_id = ANY(dep.path)
  )
  SELECT path FROM dep WHERE id = $2::int ORDER BY array_length(path,1) LIMIT 1`;
```

(Q9 (`feature_blast_radius`) starts from Feature → `SPECIFIES`-incoming Requirements → `IMPLEMENTS`-incoming Services → feeds those services into the Q3 recursion to get the transitive-dependent services. It then pulls the **verification artifacts** attached to the impacted requirements/services: the `VERIFIES`-incoming Tests of the impacted requirements, and the `VALIDATES`-incoming LoadTestResults of those requirements (all `active`). Reference shape below — it returns `{ requirements, services, tests, loadTestResults }`:

```ts
// Q9 feature_blast_radius — impacted requirements + (recursive) services + their verification artifacts.
const q9 = `WITH reqs AS (                       -- requirements F specifies
    SELECT e.source_id AS id FROM edges e
    WHERE e.active AND e.relation_type='SPECIFIES'
      AND e.source_type='Requirement' AND e.target_type='Feature' AND e.target_id = $1::int
  ), impl AS (                                    -- services implementing those requirements
    SELECT e.source_id AS id FROM edges e JOIN reqs ON e.target_id = reqs.id
    WHERE e.active AND e.relation_type='IMPLEMENTS'
      AND e.source_type='Service' AND e.target_type='Requirement'
  ), svc(id) AS (                                 -- + transitive incoming DEPENDS_ON dependents (cycle-safe)
    SELECT id FROM impl
  UNION
    SELECT e.source_id FROM edges e JOIN svc ON e.target_type='Service' AND e.target_id = svc.id
    WHERE e.active AND e.relation_type='DEPENDS_ON'
  )
  SELECT
    (SELECT json_agg(r.*) FROM requirements r WHERE r.id IN (SELECT id FROM reqs))            AS requirements,
    (SELECT json_agg(s.*) FROM services s     WHERE s.id IN (SELECT id FROM svc))             AS services,
    (SELECT json_agg(t.*) FROM tests t WHERE t.id IN (
        SELECT e.source_id FROM edges e WHERE e.active AND e.relation_type='VERIFIES'
          AND e.source_type='Test' AND e.target_type='Requirement' AND e.target_id IN (SELECT id FROM reqs)
     ))                                                                                        AS tests,
    (SELECT json_agg(l.*) FROM load_test_results l WHERE l.id IN (
        SELECT e.source_id FROM edges e WHERE e.active AND e.relation_type='VALIDATES'
          AND e.source_type='LoadTestResult' AND e.target_type='Requirement' AND e.target_id IN (SELECT id FROM reqs)
     ))                                                                                        AS "loadTestResults"`;
```

Q10 (`dependency_path`) is the OUTGOING counterpart of Q3: it seeds at the source service and recurses on `e.source_id = dep.id` taking `e.target_id`, returning the ordered `path` to the target — so "how does A depend on C" yields `A → B → C` and the reverse query yields no path.)

- [ ] **Step 4: green. Step 5: Commit** — `git commit -am "feat: 10 CQ SQL templates with cycle-safe recursive traversal"`

## Task 14: Traceability/graph view + coverage-gap highlighting

**Files:** Create `components/graph-view.tsx`, `app/graph/[systemId]/page.tsx`, extend `app/api/query/route.ts`; Test `test/query-route.test.ts`

**Interfaces:** `/api/query` POST `{cq, params}` → `runCQ`. The page renders the subgraph for a System (nodes by type, typed edges) and runs Q1/Q2 to paint requirements-with-no-test in red and to flag service coverage gaps. Q2 (`services_coverage_gaps`) returns per-service `noDesignDoc` and `noLoadTest` booleans; render two distinct flags on each Service node (e.g. a "no design doc" badge and a "no load test" badge), each shown only when its flag is true. Each edge shows `relationType`/`kind` + a click-through to evidence.

- [ ] **Step 1:** route test (`runCQ("requirements_without_test")` returns rows). **Step 2: FAIL → implement route + a lightweight SVG/HTML graph (no heavy lib needed for demo scale). Step 3: green.**
- [ ] **Step 4: Manual verify** the money-shot. **Step 5: Commit** — `git commit -am "feat: traceability graph view with coverage-gap highlighting"`

## Task 15: Doc viewer with span highlight (click-to-source)

**Files:** Create `components/doc-viewer.tsx`, `app/doc/[id]/page.tsx`; Test `test/doc-route.test.ts`

**Interfaces:** `/doc/[id]?start=&end=` renders `raw_text` with the `[start,end)` span highlighted and scrolled into view. Entity/edge evidence links target this route.

- [ ] **Step 1:** test that the page resolves a span and the highlighted slice equals `raw_text.slice(start,end)`. **Step 2: FAIL → implement. Step 3: green. Step 4: Commit** — `git commit -am "feat: doc viewer with provenance span highlight"`

> **End of Phase 3 = the deployable, gradeable core.** Tasks 1–15 stand on their own.

---

# PHASE 4 — Query Surface: Grounding + Router + Ask + Table (Day 4)

*Condensed task specs (files + interfaces + key code + tests). Ask to expand any to full step granularity.*

## Task 16: Hybrid entity-linking (pgvector + pg_trgm + RRF)

**Files:** Create `lib/search/entity-index.ts`; Test `test/entity-link.test.ts`

**Interfaces:** `linkMention(mention: string, opts?: {type?: string}): Promise<{ entityType: string; entityId: number; label: string; score: number }[]>` — run a trigram query (`word_similarity`) and a vector query (cosine over `entity_index.embedding` of `embed([mention])`), fuse by **Reciprocal Rank Fusion** (`score = Σ 1/(60 + rank)`), return top-k.

- Test: seed `entity_index` with `auth-service` (+ alias "login"); `linkMention("login system")` ranks `auth-service` first (vector hit); `linkMention("AuthService")` ranks it first (trigram hit). TDD: failing test → implement RRF → green → commit.

## Task 17: Intent router (templates → RAG fallback)

**Files:** Create `lib/query/router.ts`, `app/api/ask/route.ts`; Test `test/router.test.ts`

**Interfaces:** `route(question): Promise<{ tier: "template"|"rag"; answer: string; provenance: EdgeRef[]|ChunkRef[] }>` — Claude (structured) classifies the question to one of the 10 CQ `template` ids + extracts the entity mention(s); `linkMention` fills slots; `runCQ`; `narrate` phrases the rowset (LLM never decides set membership). If no template fits → RAG: `embed(question)` → top chunks by cosine → `narrate` with inline citations. Every answer carries provenance.

- Test (mock LLM): "what depends on auth-service?" → tier `template`, CQ `service_blast_radius`, slot resolves via `linkMention`. "summarize the auth design" → tier `rag`. TDD → commit.

## Task 18: Ask box UI + faceted entity table

**Files:** Create `components/ask-box.tsx`, `app/ask/page.tsx`, `components/entity-table.tsx`, `app/table/page.tsx`, `app/api/query/route.ts` (extend for table listing); Tests for the table list route.

**Interfaces:** Ask box posts to `/api/ask`, renders the cited answer + (for graph answers) the contributing subgraph with evidence links. Table page lists entities by type with simple column filters; each cell links to its `attribute_provenance` span in the doc viewer. TDD the list route → commit.

---

# PHASE 5 — Tests, Eval Harness, README, Deploy (Day 5)

## Task 19: Labeled fixture bundle

**Files:** `fixtures/software-bundle/{PRD,HLD,LLD-auth,ADR-001,impl-plan,loadtest}.txt`, `fixtures/software-bundle/resume.txt`, `fixtures/labels.json`

**Interfaces:** A small, internally-consistent software project (one system, ~2 features, ~4 requirements incl. 1 NFR, ~3 services with a dependency chain, 1 datastore, ~2 tests leaving 1 requirement uncovered, 1 ADR, 1 load test that misses its target) + 1 resume (off-domain). Ensure the bundle exercises **both** Q2 coverage gaps: at least one service is mentioned in the HLD/LLD (design-doc covered) while at least one other service has no HLD/LLD mention (`noDesignDoc=true`), and at least one service lacks a load test (`noLoadTest=true`). `labels.json` records ground-truth entities, key fields, trace links, classification, and golden answers to all 10 CQs — for Q2 the golden answer is the per-service `{noDesignDoc, noLoadTest}` flag set (not just the no-load-test list). Commit.

## Task 20: Eval harness + scorecard

**Files:** `test/eval/harness.ts`, `test/eval/scorecard.ts`; runnable via `EVAL=live pnpm tsx test/eval/harness.ts`

**Interfaces:** Runs the full pipeline over `fixtures/` (live LLM/embeddings), compares to `labels.json`, prints a scorecard: extraction P/R per field, **link P/R @ threshold (swept 0.5→0.9)**, entity-resolution P/R, classification accuracy, entity-linking accuracy, CQ-answer correctness. The threshold sweep picks the value hitting a precision target and prints it (README publishes it). Commit.

## Task 21: Unit + integration test pass + CI record/replay

**Files:** `test/integration.test.ts`, `test/record-replay.ts`

**Interfaces:** Integration: one tiny bundle → `upload…ready` → run all 10 CQs → assert golden answers AND that every returned value/edge has a resolvable provenance span; inject a malformed doc → assert per-doc failure isolation (others reach `ready`). CI determinism: a record/replay shim caches Claude/Voyage responses keyed by request hash so CI runs offline and green; `EVAL=live` bypasses it. Commit.

## Task 22: Provenance-integrity global invariant test

**Files:** `test/provenance-integrity.test.ts`

**Interfaces:** After ingesting the fixture bundle, scan the whole DB: every `attribute_provenance` span and every `active` edge span resolves to its `documents.raw_text`. Expect 100%. Commit.

## Task 23: README + setup experience

**Files:** `README.md`

**Interfaces:** What/why/scope (the graph-package framing + the depth bet), architecture diagram, exact setup (`pnpm i`, env vars, `psql -f drizzle/0000_extensions.sql`, `drizzle-kit migrate`, `pnpm dev`), how to run the eval (`EVAL=live`), the **published scorecard numbers + chosen threshold**, and documented future work (OCR, Hiring package, native graph DB, finer-grained deps). Commit.

## Task 24: Threshold tuning + deploy to Vercel

**Files:** `.env` (Vercel), `vercel.json` if needed

**Interfaces:** Run the eval threshold sweep, set `LINK_THRESHOLD` to the precision-target value, record it in the README. Deploy: connect Neon (run extensions + migrations on the prod DB), set the three env vars in Vercel, deploy, and re-verify the core path (upload → graph + coverage gaps → ask → click-to-source) on the live URL. Commit + tag.

---

# PHASE 6 — Stretch (only if Phases 1–5 are solid)

## Task 25 (stretch): Think-on-Graph Tier-2 agent

**Files:** `lib/query/tog.ts`, extend `router.ts`

**Interfaces:** A bounded grounded tool-loop (`find_anchors`→`list_relations`→`expand`→`answer`, ≤4 hops, beam 2–3, visited-set) invoked when no CQ template matches; tools only walk existing `active` edges (cannot hallucinate relations); the answer renders the path it took with per-hop evidence. Manual agentic loop per the `claude-api` tool-use pattern.

## Task 26 (stretch): Second graph package (Hiring) — extensibility proof

**Files:** `lib/packages/hiring.ts`, package registry lookup by `domain`

**Interfaces:** A second `GraphPackage` (Candidate, Skill, Experience…) registered by config; classification routes resumes to it; their entities/edges light up with no pipeline change — the live demonstration that adding a domain is config, not a rewrite. (Q9/Q10 transitive templates already ride the same recursive pattern; no new edge machinery.)

---

## Notes for the implementer

- **Serverless boundaries:** each `advance(documentId)` call does one bounded stage (one LLM/embed batch) so it fits Vercel function limits; the client polls `/api/status` and re-calls `/api/process` per doc until `ready`/`failed`/`unrouted`. No long-running worker.
- **The package is logical:** the Software package lives in `lib/packages/software.ts` (code config), not a DB table — adding a domain is a new config file + classification routing, no migration.
- **Every LLM call** uses `claude-opus-4-8` with structured outputs for extraction/classification/linking and plain `narrate` for phrasing; confirm IDs via the `claude-api` skill at build time.
