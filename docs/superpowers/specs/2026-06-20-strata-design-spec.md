# Strata — Auto-Structuring Document Knowledge Graph (Design Spec)

> Design spec · Status: **Approved for planning** · Date: 2026-06-20 · Timebox: ~5 days
> Interview project round — *"turn messy documents into structured, queryable data."*
> Deliverables: deployed URL · README · GitHub repo. Graded on framing, product thinking, UX, code quality, meaningful tests, docs, setup, velocity, and one "above and beyond" depth bet.
>
> Local mirror of the approved Notion spec: https://app.notion.com/p/38585936d1ef817d8a4ddb5a10ba5106

## 1. Problem framing & the bet

The brief is deliberately vague; *how* it is interpreted and scoped is itself the evaluation. Our interpretation: most "document → structured data" tools flatten each document into a row of fields. The real value in technical/enterprise documents is **the relationships between them** — a PRD's requirement, the service that implements it, the test that verifies it, and the load test that validates its target are *one connected story* spread across separate files.

**Strata turns a pile of documents into a queryable knowledge graph**, organized into pluggable, domain-specific **graph packages**, where every node and edge cites the exact source span it came from.

**The depth bet ("above and beyond"):** cross-document **traceability & impact** — answering questions that are *impossible* over isolated documents ("which requirements have no test?", "what breaks if Service X changes?"), with **end-to-end provenance** on every extracted value, every edge, and every answer.

**The product story:** *"I dropped in a project's PRD, design docs, ADRs, and load tests — and now I can ask which requirements aren't tested and what depends on the auth service, and every answer shows me exactly where it came from."*

## 2. Research grounding

An independent research pass (107-agent fan-out, 25 sources, 25 claims adversarially verified) tested the core architectural bets. Verdicts:

| Claim | Verdict | Confidence |
|---|---|---|
| Competency questions (CQs) **drive** the schema | **Sound** — textbook ontology engineering (Grüninger–Fox/NeOn); 90.5% of practitioners use CQs for requirements | High |
| "Each *resolved* CQ becomes a graph node" | **Category error** — conflates question (spec), query (SPARQL/SQL), and answer (entities). CQs derive schema; they are not nodes | High |
| Native graph DB vs Postgres + edges table + pgvector | **Scope-dependent** — native graph DB only earns its keep when cross-doc aggregation dominates; else Postgres is enough and far simpler | High |
| Auto schema/type induction from documents | **Feasible but error-prone (~70% F1)** → human-curated schema for known domains | Medium |
| Cross-doc linking = requirements traceability | **Sound, rich prior art** — typed-edge graph (22 artifact types, 23 relations); LLM link recovery ~79–80% F1 but needs guardrails | High |
| Pre-computing structure beats raw RAG for analytical/aggregation queries | **Directionally true** (RAG fails on COUNT/aggregate-across-pages); headline magnitudes refuted → hybrid is the call | Medium |

**Net:** keep the graph + CQ instinct; CQs derive schema, entities are nodes, answers are typed edges; use Postgres (not Neo4j) for a 5-day build; curate the schema; make linking precision-gated; serve structured queries deterministically with a RAG fallback.

## 3. Locked decisions

| Decision | Choice |
|---|---|
| Document universe | **Hybrid** — a Software-Development bundle drives the graph (depth); a few off-domain docs (e.g., resume) exercise classification (breadth) |
| Headline capability | **Traceability & impact** queries over a cross-document graph |
| Architecture unit | **Graph package** = a pluggable, per-domain ontology module over a shared citation substrate (logical grouping, not a physical table) |
| Node storage | **Typed table per entity type** |
| Edge storage | **One** directed `edges` table; direction = (source, target); inverse rendered from a registry — never stored twice |
| Linking trust model | **Automatic, confidence-thresholded** (no manual gate) + evidence-grounding safeguard; threshold tuned on the eval harness |
| Pipeline | **Lightweight orchestrated workflow** (Postgres jobs/state machine, isolated stage handlers, reactive linker, live dashboard) — event-driven semantics, no broker |
| Query grounding | Hybrid entity-linking (pgvector + pg_trgm + RRF) → 3-tier router (templates → agentic ToG → RAG) |
| Stack | Next.js (App Router, TS) + Postgres/pgvector (Neon) + Drizzle + Claude + Voyage embeddings; deploy on Vercel; no auth (single workspace) for v1 |
| Out of scope (v1) | OCR/scanned docs; native graph DB; broker-based async; auth; auto-induced ontology for new domains |

## 4. Architecture overview

Two layers: a **domain-agnostic substrate** (documents + chunks = the universal citation source-of-truth) and **graph packages** (per-domain ontology modules whose nodes/edges all cite back into the substrate). Adding a domain = registering a package, not rewriting the pipeline.

```
        SHARED SUBSTRATE (domain-agnostic)
        documents: raw_text, offsets, doc_type, domain, metadata  ◀ universal citation source-of-truth
        chunks + embeddings (pgvector)
              ▲ cite              ▲ cite                ▲ cite
   Graph Package: Software Dev   Graph Package: Hiring   Graph Package: future...
   (entities + edges + CQs) v1   (future)
```

A non-Software doc in v1 still gets classified + stored in the substrate (RAG-queryable, visible in the doc table); it has no graph until its package exists — the extensibility proof: *register the Hiring package → those resumes light up, no code change.*

## 5. Data model

### 5a. Substrate (shared by every package)

```
documents
  id, filename, mime_type, raw_text, page_count
  doc_type        -- semantic type, classified ("PRD","LLD","load_test_report","resume")
  domain          -- routed package id ("software_dev","hiring", or null = unrouted)
  title, authors[], doc_date, summary   -- universal extracted metadata
  status          -- ingested|classified|indexed|extracted|resolved|linked|ready|failed|unrouted
  uploaded_at
        -- this IS the "common doc structured table" + citation source-of-truth

chunks
  id, document_id, page, char_start, char_end, text, embedding vector   -- pgvector, for RAG
```

### 5b. Knowledge layer (per-package; typed node tables + one edges table)

```
packages (logical, code-config)  -- ontology spec: doc_types, entity_types, edge_types, competency_questions

TYPED ENTITY TABLES            -- one per entity type, real columns + constraints
  services       (id, package_id, name, language, description, owner)
  requirements   (id, package_id, text, kind, metric, target_value, priority)
  tests          (id, package_id, name, kind, description)
  load_test_results (id, package_id, scenario, metric, observed_value, target_value, passed)
  datastores, features, systems, decisions, persons ...

edges                          -- ONE directed table for all relations
  id, relation_type            -- "VERIFIES","IMPLEMENTS","DEPENDS_ON","USES","MENTIONS"
  kind                         -- typed "how" within a family (DEPENDS_ON: CALLS | CONSUMES_EVENT | READS_FROM | USES_LIBRARY | SHARES_DATA | CONFIG)
  source_id, source_type       -- e.g. (T3, "Test")
  target_id, target_type       -- e.g. (R1, "Requirement")
  confidence
  active                       -- derived: confidence >= threshold AND span locates
  evidence_document_id, chunk_id, char_start, char_end, snippet   -- pointer into the chunk (the "how" detail lives there, not in a summary)
  attributes JSONB

relation_types                 -- makes direction = intent
  type "VERIFIES", inverse_label "VERIFIED_BY", source_type "Test", target_type "Requirement"

attribute_provenance           -- field-level citations (typed columns stay clean)
  id, entity_type, entity_id, field, value, document_id, char_start, char_end, snippet, confidence

entity_index                   -- DERIVED search index (rebuilt from entity tables)
  entity_type, entity_id, label, aliases[], search_text,
  embedding vector,            -- HNSW index (semantic)
  -- GIN trigram index on label + search_text (fuzzy/lexical)

jobs / stage_events            -- orchestration: per-doc state machine + event log
  id, document_id, stage, status, attempts, error, created_at
```

### 5c. Invariants

1. **Everything cites the substrate** — no `attribute_provenance` row or active `edge` exists without a `document_id` + span.
2. **Edges are precision-gated + grounded** — persisted with confidence; `active` only if `confidence ≥ threshold` AND the evidence span locates in source text.
3. **Generic-tables-tagged-by-type** for edges + the package registry → a new domain is a config row, never a schema migration.
4. **Polymorphic edge integrity** — `source_id/target_id` resolve to a live row in the table named by `*_type` (enforced at app layer + a test invariant).

## 6. The Software Development graph package (v1)

Derived the validated way: **competency questions first → they dictate the entities and edges.** Nothing speculative.

### 6a. Competency questions (the spec)

| # | Competency question | Type | Requires |
|---|---|---|---|
| Q1 | Which requirements have **no verifying test**? | coverage gap | Requirement, Test, `VERIFIES` |
| Q2 | Which services have **no design doc / no load test**? | coverage gap | Service, LoadTestResult, mentions |
| Q3 | **What depends on Service X / what breaks if it changes?** | impact | Service, `DEPENDS_ON` (recursive) |
| Q4 | Show the full **PRD → HLD/LLD → impl → load-test chain** for Feature F | trace | Feature, Requirement, Service, Test, LoadTestResult + edges |
| Q5 | What **datastore** does Service X use? | lookup | Service, Datastore, `USES` |
| Q6 | Did the **load test meet the PRD's target**? | cross-doc reconcile | Requirement(NFR), LoadTestResult, `VALIDATES` |
| Q7 | What **decisions (ADRs)** affected Service X, and why? | rationale | Decision, Service, `AFFECTS` |
| Q8 | Who **owns** Service X? | lookup | Service, Person, `OWNS` |
| Q9 | If **Feature F changes, what is the full blast radius**? | impact (transitive) | Feature → Requirement → Service, recursive `DEPENDS_ON` (incoming), Test, LoadTestResult |
| Q10 | **How does Service X (transitively) depend on Service Z?** | impact path | Service, recursive `DEPENDS_ON` (returns the path) |

**Transitive impact (Q3, Q9, Q10) needs no new edges** — only recursive traversal templates over the existing `DEPENDS_ON` + structural chain. Two correctness rules baked into those templates:
- **Direction = intent:** "what breaks if it changes?" follows **incoming** `DEPENDS_ON` recursively (who depends on it); outgoing answers the opposite.
- **Cycle-safe:** the recursive CTE carries a visited-set (service dependency graphs can contain cycles).

A service-to-service dependency is born when one service's doc references another: extract → entity-resolve the referenced service → reactive linker creates the `DEPENDS_ON` edge. Dependency stays at **service granularity** in v1 (API/feature-level is future work).

### 6b. Entity types (typed tables)

| Entity | Key columns | v1 |
|---|---|---|
| System | name, description | core |
| Feature | name, description, system_id | core |
| Requirement | text, kind (functional/NFR), metric, target_value, priority | core |
| Service | name, language, description, owner | core |
| Datastore | name, engine, purpose | core |
| Test | name, kind, description | core |
| LoadTestResult | scenario, metric, observed_value, target_value, passed | core |
| Decision (ADR) | title, status, rationale | core |
| Person | name, role | core |
| Concept | name, definition | stretch |

### 6c. Relation registry (one directed edge each; inverse rendered, not stored)

```
Feature        PART_OF        System            (inv HAS_FEATURE)
Requirement    SPECIFIES      Feature           (inv SPECIFIED_BY)
Service        IMPLEMENTS     Requirement       (inv IMPLEMENTED_BY)
Service        DEPENDS_ON     Service           (inv DEPENDED_ON_BY)   recursive (Q3, Q9, Q10); kind = CALLS | CONSUMES_EVENT | READS_FROM | USES_LIBRARY | SHARES_DATA | CONFIG
Service        USES           Datastore         (inv USED_BY)
Test           VERIFIES       Requirement       (inv VERIFIED_BY)      gap query (Q1)
LoadTestResult VALIDATES      Requirement(NFR)  (inv VALIDATED_BY)     reconcile (Q6)
Decision       AFFECTS        Service           (inv AFFECTED_BY)
Person         OWNS           Service           (inv OWNED_BY)
chunk          MENTIONS       any-entity        (provenance backbone)
```

### 6d. Doc types → what each is the primary source for

| Doc type | Contributes |
|---|---|
| PRD | Features, Requirements (incl. NFR targets) |
| HLD / ARD | Services, dependencies, Datastores, high-level Decisions |
| LLD | Service internals, `USES` datastore, finer dependencies |
| ADR | Decisions + `AFFECTS` |
| Implementation Plan | `IMPLEMENTS` links (Service → Requirement) |
| Load Test Report | LoadTestResults + `VALIDATES` |

## 7. Pipeline

Each document flows through six stages as **isolated handlers** driven by a Postgres jobs/state machine. Per-doc isolation: one doc failing never blocks the pile.

```
Upload (PDF/DOCX/TXT — digital only)
 → 0. Ingest: parse text + char offsets/pages
 → 1. Classify & route (domain, doc_type) + metadata     [unknown domain → status=unrouted (substrate only)]
 → 2. Index: chunk + embed (Voyage)                       [runs for ALL docs]
 → 3. Extract: typed entities + field provenance
 → 4. Resolve: entity resolution + MENTIONS edges
 → 5. Link (reactive): propose typed edges + threshold
 → 6. Ready: graph queryable
```

### 7a. Stage detail

- **0 Ingest** — `unpdf`/`pdf-parse` (PDF), `mammoth` (DOCX), native (TXT); offsets preserved so every later citation resolves. Writes `documents`.
- **1 Classify & route** — one LLM call → `domain`, `doc_type`, metadata, confidence. Unknown domain → `unrouted` (still indexed + RAG-able).
- **2 Index** — chunk with offsets/page, embed, store. Runs for **every** doc.
- **3 Extract** — per `doc_type`, extract only the entity types it sources; each field cites a span → `attribute_provenance`.
- **4 Resolve (knowledge fusion)** — hybrid-match new entity vs existing → merge or create; provenance via `MENTIONS` edges; refresh `entity_index`. This makes one real-world thing = one node across docs.
- **5 Link (reactive)** — triggered by `entity.resolved`; scans for in/out candidate edges of that entity against the existing graph (guided by `relation_types`), proposing edges with confidence + evidence. **Order-independent** (a later-arriving source re-triggers and finds its destination), **idempotent**, single-owner (not bolted onto an endpoint).

### 7b. The link gate (auto + threshold, made tunable)

All candidate edges are stored with their confidence; `active = confidence ≥ threshold AND span locates`. Only `active` edges power queries and the graph view. The eval harness sweeps the threshold and measures precision/recall to *pick* it — without re-running extraction. The UI shows an honesty counter ("12 links shown · 4 below threshold"); inactive edges are never traversed or shown by default.

### 7c. Error handling & invariants (these become tests)

1. **Provenance integrity** — every span must locate the cited text in `raw_text`, or the value/edge is dropped (kills hallucinated-but-uncited data).
2. **Per-doc resilience** — parse/extract failure → `status=failed` + reason, visible; rest of the pile proceeds.
3. **Idempotent re-runs** — reprocessing upserts, never duplicates.
4. **Confidence everywhere** — classification, each field, each edge.

### 7d. Models

Claude for classify / extract / relation-propose (structured output / tool-use); the harder cross-doc relation inference is where a stronger tier earns its cost. Voyage for embeddings (chunks + entity_index). Confirm exact model IDs via the `claude-api` reference at build time.

## 8. Query surface

A grounding layer feeds a three-tier router; every answer carries provenance.

### 8a. Grounding (front door for Tiers 1 & 2)

```
NL question -> extract mention(s) [LLM] -> entity-link via hybrid search
               (pgvector + pg_trgm + RRF over entity_index) -> concrete entity IDs
               -> ambiguous? "did you mean auth-service or auth-gateway?" (disambiguation UX)
```

Standard KG-QA entity-linking; all Postgres-native (no separate vector DB). Embed only **identity fields** (label, aliases, short search_text), not every column.

### 8b. The router

| Tier | What | Mechanism | Scope |
|---|---|---|---|
| 1 | The 10 known CQs (Q1–Q10) | LLM classifies intent → parameterized SQL template (recursive CTE for traversal); slots filled with linked entity IDs; executed deterministically | **core** |
| 2 | Unanticipated multi-hop intents | **Think-on-Graph agent** — grounded tool loop (find_anchors → list_relations → expand → answer), bounded (≤4 hops, beam 2–3, visited-set), shows its path, selective disambiguation | **stretch** |
| 3 | Non-graph / free-text | RAG over chunks | core (thin) |

Because the backend is Postgres, Tier 1/2 are **Text-to-SQL over a graph-shaped schema** (traversal = recursive CTE) — more mature/reliable than Text-to-Cypher. The ToG agent can only walk edges that actually exist, so it cannot hallucinate relations.

**Two read-paths over the relation table (the determinism guardrail).** The typed relation table serves both, and keeping them distinct preserves deterministic coverage/impact:

| Query class | How it's answered | LLM role |
|---|---|---|
| **Coverage gaps / transitive impact** (which / count / path) | the **structured columns** (entity join-keys + relation_type/kind) — anti-join / recursive CTE; the **rowset is the answer** | only phrases the result; chunks attached as provenance |
| **Explanatory / "how" / free-text** | the rows identify the relevant **chunks → sent to the LLM** as context | generates the narrative |

**Guardrail:** never route a coverage/aggregate answer through "LLM reads chunks and decides" — that reintroduces the recall / non-determinism failure. Structured answers come from the columns; the chunks→LLM path is for "how / explain" questions. Consequently **entity tables are lean anchors** (identity + key filterable fields) — the rich semantics live in chunks + typed relation rows.

### 8c. UI surfaces (priority-ordered)

1. **Graph / traceability view** *(core, the star)* — subgraph for a Feature/System; **coverage gaps highlighted** (requirements with no `VERIFIES` in red; services with no load test flagged).
2. **Ask box** *(core)* — NL question → routed, cited answer; graph answers render the contributing subgraph + each edge's evidence.
3. **Doc viewer with span highlight** *(core)* — click any cited value/edge → opens the source doc at the exact span.
4. **Faceted table per entity type** *(core, thin)* — browse/filter typed entities; each cell links to source.
5. **Processing dashboard** *(core)* — docs moving through pipeline stages, with retries.

### 8d. Provenance contract

Every **field** → `attribute_provenance` span → click-to-source. Every **edge** → evidence span + confidence (+ suppressed count). Every **answer** (all 3 tiers) cites the spans/edges it used; **ToG additionally shows the full path** it walked.

## 9. Tests & eval harness

Targets the system's real failure modes, not coverage. Coverage tooling is a *diagnostic, not a goal* (no global % target; attention on high-risk `lib/` logic).

### 9a. Foundation — labeled fixture bundle

A realistic Software-project bundle (~6–8 docs: PRD, HLD, LLD, ADR, impl-plan, load-test for one system) + 1–2 off-domain docs, each with ground-truth labels: expected entities, key fields, trace links, classification, and golden answers to all 10 CQs.

### 9b. Layer 1 — Eval harness (the scorecard the README publishes)

| Metric | Catches |
|---|---|
| Extraction P/R per field | wrong/missing field values |
| **Link P/R @ threshold (swept)** | bad trace links; **picks the threshold** — turns the "~80% F1" finding into a measured number |
| Entity-resolution P/R | false merges / missed merges across docs |
| Classification accuracy | mis-routed docs |
| Entity-linking accuracy | "login system" not finding `auth-service` |
| CQ-answer correctness | template returns the wrong set |

### 9c. Layer 2 — Unit tests (deterministic, no LLM)

Provenance-offset locating · the 10 CQ SQL templates against a hand-built golden graph · hybrid search + RRF ranking · `active`/threshold logic · relation-registry inverse rendering · polymorphic-edge integrity · idempotent re-run.

### 9d. Layer 3 — Integration test

One tiny bundle → `upload ... ready` → run all 10 CQs → assert golden answers AND that every returned value/edge has a resolvable provenance span; inject a bad doc → assert per-doc failure isolation.

### 9e. LLM non-determinism

Deterministic logic unit-tested without the LLM; LLM quality measured as metrics with passing thresholds (e.g., extraction F1 ≥ 0.8), not exact-match; CI determinism via **record/replay** of cached model responses, with a separate opt-in live eval (`EVAL=live`).

### 9f. Provenance-integrity as a global invariant

"Every extracted span locates in source text" runs over the whole DB post-ingestion — ~100% by construction; a regression is caught instantly.

## 10. 5-day plan

Principle: a thin end-to-end slice early, then deepen. A minimal fixture bundle is created Day 1 and labeled progressively (fully labeled Day 5).

| Day | Goal | Verify |
|---|---|---|
| 1 | Scaffold (Next.js/TS, Tailwind/shadcn, Drizzle, Neon+pgvector). Substrate (`documents`, `chunks`) + `jobs`/`stage_events` state machine. Ingest (+offsets), classify/route, chunk+embed. Basic processing dashboard. | Upload the bundle → docs classified, chunked, statuses advance; off-domain doc shows `unrouted`. |
| 2 | Typed entity tables (Software pkg) + relation registry. Extract stage (type-specific, field provenance). Resolve stage (hybrid match → entity_index, MENTIONS edges). | Bundle yields one node per real thing across docs; every field cites a span. |
| 3 ⭐ | `edges` table + reactive linker (confidence + evidence + threshold). 10 CQ SQL templates (recursive CTEs). Traceability view with coverage gaps + doc viewer span highlight. | **Money-shot:** graph for the system, requirements-with-no-test in red, click value → source span. **Deployable gradeable core.** |
| 4 | Ask box: entity-linking + intent→template router + cited answers rendering the subgraph; RAG fallback. Faceted table (thin). | "What verifies REQ-x / what depends on service Y?" → cited answer; free-text → RAG. |
| 5 | Eval harness + scorecard, unit + integration tests, record/replay for CI, finish fixture labels. README (what/why/scope/setup/scorecard). Deploy to Vercel; verify on live URL. | Scorecard prints; tests green; live URL runs the core path end-to-end. |

### 10a. Cut lines (priority order)

1. **Must-ship by Day 3 EOD:** ingest → classify → extract → resolve → link → traceability view + coverage gaps + doc viewer. Gradeable on its own.
2. **Day 4:** ask box + table → strong product.
3. **Day 5:** eval + tests + README + deploy → the heavily-weighted rubric points (do not let these slip).
4. **Stretch, only if 1–3 are solid:** Think-on-Graph Tier-2 agent; second package (Hiring) as a live extensibility proof. (Q9/Q10 transitive templates ride on the same recursive pattern as Q3.)

### 10b. Risks & mitigations

- **Extraction/link quality** → eval harness + tunable threshold + provenance integrity (measured, not hoped).
- **Scope** → the cut lines above; Day-3 core is the contract.
- **Serverless timeouts** → per-doc bounded jobs + client polling (no long-running worker).

## 11. Out of scope / future work

- **OCR / scanned documents** — digital PDF/DOCX/TXT only in v1.
- **Broker-based async** — production evolution of the orchestrated workflow.
- **Second+ graph packages** (Hiring, etc.) — architecture supports them as config; v1 builds Software only (Hiring is a stretch demo).
- **Auto-induced ontology** for brand-new domains — curated for known domains in v1.
- **Auth / multi-tenant** — single shared workspace in v1.
- **Cross-package links & multi-domain documents** — the shared substrate allows them later.
- **Finer-grained dependencies** (API/endpoint or feature-level cross-service) — v1 keeps dependency at service granularity.

## 12. Appendix — research sources

- Competency questions / ontology engineering: Survey 2023; Keet & Khan 2024; Wisniewski et al. 2018
- GraphRAG / graph-vs-vector: Edge et al., Microsoft (GraphRAG); RAG vs GraphRAG systematic eval
- Traceability / SE knowledge graphs: Traceability SoK; LLM TLR; SE-KG SLR
- Materialize-then-query vs RAG: ZenDB
- Entity-linking / Text-to-Cypher / hybrid search: Text-to-Cypher pipeline; Think-on-Graph (ICLR 2024); BYOKG-RAG
