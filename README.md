# Strata — Documents → Queryable Knowledge Graph

[![CI](https://github.com/puneetduggal/strata/actions/workflows/ci.yml/badge.svg)](https://github.com/puneetduggal/strata/actions/workflows/ci.yml)

Strata turns a pile of messy technical documents (PRDs, design docs, ADRs, implementation
plans, load-test reports) into a **queryable knowledge graph** where every node, edge, and
answer cites the exact source span it came from.

> 📄 **Product doc / design spec:** [Strata — Auto-Structuring Document Knowledge Graph](https://app.notion.com/p/Strata-Auto-Structuring-Document-Knowledge-Graph-Design-Spec-38585936d1ef817d8a4ddb5a10ba5106)

Most "document → structured data" tools flatten each file into a row of fields. The real value
in technical documents is the **relationships *between* them**: a PRD's requirement, the service
that implements it, the test that verifies it, and the load test that validates its target are
*one connected story* spread across separate files. Strata recovers that story and lets you query
it — including questions that are impossible to answer over isolated documents:

- *Which requirements have no verifying test?*
- *What breaks if the auth service changes?* (transitive blast radius)
- *Did the load test actually meet the PRD's target?*

...and every answer shows you exactly where in the source it came from.

## What / why / scope

### The graph-package bet

Strata is built on a **shared citation substrate** plus pluggable, per-domain **graph packages**.

- **Substrate (domain-agnostic):** every uploaded document is parsed (with char offsets
  preserved), classified, chunked, and embedded. This is the universal, RAG-able
  source-of-truth that every citation grounds back into.
- **Graph package (per-domain ontology):** a code-defined module declaring the entity types,
  the relation registry, the document types, and the competency questions for one domain. v1
  ships **one** package — Software Development (`lib/packages/software.ts`): **9 entity types,
  10 relations, 10 competency questions**.

Off-domain documents (e.g. a résumé) are still classified, chunked, and embedded into the
substrate — they remain RAG-queryable — but they are **not** forced into the graph. They simply
have no graph until a package for their domain exists. Adding a domain is registering a package,
not rewriting the pipeline.

### The two bets that make answers trustworthy

1. **Determinism.** Competency-question answers are computed by **SQL over structured columns**
   (anti-joins and cycle-safe recursive CTEs). The rowset *is* the answer — the LLM never decides
   set membership; it only *phrases* the result via `narrate`. This is the guardrail against the
   recall / non-determinism failure mode of "let the LLM read the chunks and decide."
2. **Provenance.** Every active edge and every extracted attribute value carries a provenance
   span that **re-grounds in the source** `documents.raw_text`. If a span doesn't locate, the
   value/edge is dropped — this kills hallucinated-but-uncited data by construction.

### Scope (v1)

In scope: digital PDF / DOCX / TXT ingest; the Software Development graph package; cross-document
traceability and impact queries; a 2-tier query router (deterministic templates + RAG fallback);
end-to-end provenance with a doc viewer that highlights cited spans. Out of scope: OCR / scanned
docs, a second graph package, a native graph DB, broker-based async, and auth — see
[Future work](#future-work).

## Architecture

```
  Upload (PDF / DOCX / TXT, digital only)
        │
        ▼
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  PIPELINE  (Postgres `jobs` state machine; isolated, idempotent stages)    │
  │                                                                            │
  │  ingested → classify → classified → index → indexed                       │
  │                                            ├── unrouted (off-domain) ──┐   │
  │                                            └── extract → extracted     │   │
  │                                                  → resolve → resolved  │   │
  │                                                  → link → ready        │   │
  │     (link is REACTIVE + order-independent: relinkAll() re-sweeps so a   │   │
  │      later-arriving source still finds its destination)                │   │
  └───────────────────┬────────────────────────────────────────────────┬──┘  │
                      │                                                  │
                      ▼                                                  ▼
   ┌──────────────────────────────────┐        ┌─────────────────────────────────┐
   │  SHARED SUBSTRATE                 │        │  GRAPH PACKAGE (Software Dev v1) │
   │  documents (raw_text, offsets,    │ ◀cite─ │  9 typed entity tables           │
   │    doc_type, domain, metadata)    │        │  1 polymorphic `edges` table     │
   │  chunks + embeddings (pgvector)   │        │  attribute_provenance (field     │
   │    + pg_trgm                      │        │    -level citations)             │
   └──────────────┬───────────────────┘        │  entity_index (derived: vector   │
                 │                              │    + trigram, for entity linking)│
                 │                              └───────────────┬─────────────────┘
                 │                                              │
                 ▼                                              ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  QUERY SURFACE                                                              │
   │  NL question → entity-linking (pgvector + pg_trgm fused by RRF)             │
   │      → 2-tier router:                                                       │
   │          • template — 10 CQ SQL templates (recursive CTEs); rowset IS the   │
   │                       answer; LLM only narrates                            │
   │          • rag      — nearest chunks → narrate with inline citations        │
   └──────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
   UI (Next.js App Router): upload · processing dashboard · graph/traceability view
   with coverage gaps · doc viewer with highlighted spans · ask box (corpus-driven CQ
   starter chips via `GET /api/suggestions`) · faceted entity table
```

### Where the code lives

| Area | Path | What it does |
|---|---|---|
| Database | `lib/db/{schema,client}.ts` | 15 tables incl. `vector(1024)` (pgvector) + pg_trgm; one polymorphic `edges` table |
| Graph package | `lib/packages/{types,software}.ts` | entity types, relations (with inverses + `DEPENDS_ON` kinds), competency questions, doc-type sources |
| Pipeline | `lib/pipeline/{jobs,classify,index,extract,resolve,link,run}.ts` | the stage state machine; `run.ts` has `advance()` + `relinkAll()` (order-independent re-link sweep) |
| Embeddings | `lib/embed/voyage.ts` | Voyage `voyage-3`, 1024-dim (raw `fetch` + retry) |
| LLM | `lib/llm/claude.ts` | `claude-opus-4-8` structured outputs + `narrate` |
| Entity linking | `lib/search/entity-index.ts` | hybrid: trigram (`word_similarity`) + pgvector cosine, fused by Reciprocal Rank Fusion |
| Query | `lib/query/{templates,router,graph,suggestions}.ts` | 10 CQ SQL templates (cycle-safe recursive CTEs), intent router, graph/table data layers, corpus-driven Ask starter questions |
| Provenance | `lib/provenance/locate.ts`, `lib/doc/highlight.ts` | span grounding + doc-viewer highlighting |
| Graph integrity | `lib/graph/integrity.ts` | polymorphic-edge integrity invariant |
| UI / API | `app/` | Next.js 15 App Router UI + `app/api/{ingest,process,status,query,ask,suggestions}` routes |

### Stack

Next.js 15 (App Router, TS) · React 19 · Tailwind v3 · Drizzle ORM + drizzle-kit ·
Postgres + pgvector + pg_trgm · Anthropic SDK (`claude-opus-4-8`) · Voyage embeddings
(`voyage-3`, 1024-dim) · `postgres.js` · `mammoth` (DOCX) + `unpdf` (PDF) for ingest ·
Zod · Vitest · pnpm.

## Quick start

### Prerequisites

Node ≥ 20, **pnpm**, Docker (for local Postgres), and API keys for Anthropic and Voyage.

### 1. Install

```bash
pnpm install
```

### 2. Start Postgres with pgvector

Local development uses a `pgvector` image on host port **5433**, database **strata**:

```bash
docker run -d --name strata-pg \
  -e POSTGRES_PASSWORD=strata \
  -e POSTGRES_DB=strata \
  -p 5433:5432 \
  pgvector/pgvector:pg16
```

For deployment, any Postgres with the `vector` and `pg_trgm` extensions works (we used Neon —
append `?sslmode=require` to `DATABASE_URL`).

### 3. Configure environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

```ini
DATABASE_URL=postgres://postgres:strata@localhost:5433/strata
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
# Optional linker active-edge confidence gate (default 0.7). The eval-swept pick is 0.50.
LINK_THRESHOLD=0.50
```

### 4. Create extensions + apply the schema

The `vector` and `pg_trgm` extensions must exist **before** the migration, and the HNSW / trigram
indexes are applied **after** (they live in their own out-of-band file):

```bash
# a. extensions (run before migrating)
psql "$DATABASE_URL" -f drizzle/0000_extensions.sql

# b. tables (Drizzle migration)
pnpm exec drizzle-kit migrate

# c. indexes (HNSW + GIN trigram; applied after the tables exist)
psql "$DATABASE_URL" -f drizzle/0001_indexes.sql
```

### 5. Run the app

```bash
pnpm dev
```

Open http://localhost:3000, upload the documents in `fixtures/software-bundle/`, watch them move
through the pipeline on the dashboard, then explore the graph and ask questions.

## Tests

Both test suites run **fully offline** — the three non-deterministic seams (Claude extract,
Claude narrate, Voyage embed) replay from committed JSON cassettes under
`test/fixtures/cassettes/`, so neither needs network access or API keys.

```bash
pnpm test               # unit suite (deterministic, no LLM)
pnpm test:integration   # full-pipeline + provenance-integrity (offline via record/replay)
```

The integration suite is configured to run alone and serially because it truncates the shared
knowledge tables and asserts global CQ answers.

## Live evaluation

The eval harness is the live ground-truth scorer (CI stays offline via the cassettes above). It
runs the **real** pipeline against live Claude + Voyage over `fixtures/software-bundle/`, then
scores the resulting graph and CQ answers against `fixtures/labels.json` (ground truth):

```bash
EVAL=live pnpm tsx test/eval/harness.ts
```

Without `EVAL=live` it prints a notice and exits 0. Voyage's free tier is rate-limited
(~3 RPM), so a full live run takes roughly 15 minutes.

### Published scorecard

Strata live eval vs `fixtures/labels.json` (7-document "Helios" bundle):

| Metric | Result |
|---|---|
| Classification accuracy | 100% (7/7) |
| Extraction F1 — entity (type+label) | 1.000 (tp=16, fp=0, fn=0) |
| Extraction F1 — field (key+value) | 0.667 (tp=22, fp=11, fn=11) |
| Entity-resolution F1 | 1.000 (16/16, one node per real-world thing) |
| Entity-linking accuracy (mention→entity, top-1) | 100% (6/6) |
| Link F1 @ chosen threshold | 1.000 (P=1.000, R=1.000; 18/18 golden edges) |
| Competency-question correctness | 10/10 |
| **Chosen `LINK_THRESHOLD`** | **0.50** |

**Honest note on the one sub-perfect metric.** Field-level extraction F1 is **0.667**. Entity
*identity* is perfect (entity F1 = 1.000, resolution F1 = 1.000) and **all 10 competency questions
are correct**. The gap is in descriptive *attribute* values — some free-text fields (e.g. System /
Feature descriptions) are phrased differently from the gold labels. This does **not** affect CQ
correctness, and it is reported here plainly rather than hidden or inflated.

**On the threshold.** The link sweep was **flat**: precision = recall = F1 = 1.000 at every
threshold from 0.50 to 0.90 (18/18 golden edges, 0 false positives at each). The result is
therefore robust to the threshold choice; `LINK_THRESHOLD=0.50` is the eval-swept pick (lowest
threshold that holds the precision target).

## The provenance invariant (first-class guarantee)

> No `attribute_provenance` row and no `active` edge exists unless its cited span resolves to the
> exact text in `documents.raw_text`.

This is the core trust guarantee, not a feature bolted on afterward:

- **Field values** carry a span → click any value in the UI to open the source doc highlighted at
  that exact range.
- **Edges** carry an evidence span + confidence; an edge is `active` only when
  `confidence ≥ LINK_THRESHOLD` **and** its span locates. Inactive edges are never traversed and
  never shown by default.
- **Answers** (both router tiers) cite the spans / edges they used.
- The invariant is enforced both at the app layer and as a dedicated test
  (`test/provenance-integrity.test.ts`) that sweeps the whole database post-ingestion — a
  regression is caught immediately.

## Future work

- **OCR / scanned-document ingestion** — v1 handles digital PDF / DOCX / TXT only.
- **A second graph package** (e.g. Hiring) over the shared substrate — the architecture supports
  it as config; building one would make the multi-package design a live extensibility proof
  (those résumés would "light up" with no pipeline change).
- **Native graph DB backend** — traversal is currently Postgres recursive CTEs; a native graph DB
  earns its keep only when cross-document aggregation dominates.
- **Finer-grained dependency modeling** — dependencies stay at service granularity in v1; richer
  `DEPENDS_ON` kinds / typed call graphs are future work.
- **Higher field-level extraction fidelity** — close the 0.667 field-F1 gap on descriptive
  attribute values (entity identity and all CQs are already perfect).
- **Pluggable embedding provider** — an OpenAI-embeddings fallback is a single-file swap in
  `lib/embed`, gated only on the 1024-dim schema constraint (`text-embedding-3-*` with
  `dimensions: 1024`); it would also speed up the eval vs Voyage's free-tier rate limit.
