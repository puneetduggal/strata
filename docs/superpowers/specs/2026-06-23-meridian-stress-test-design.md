# Meridian Stress-Test Corpus & Harness — Design Spec

**Date:** 2026-06-23
**Status:** Draft for review
**Author:** Strata team

## 1. Purpose & Goals

Strata is built and deployed (`https://strata-eight-green.vercel.app`), but its only corpus is the
7-doc "Helios" bundle (auth/token/payment) — too small to exercise the knowledge graph's headline
features or its failure modes. This project builds a richer, deliberately adversarial corpus for one
coherent fictional company ("Meridian") and an automated harness that **generates realistic PDFs →
resets the DB → drives every doc through the real pipeline → asserts the resulting graph + all 10
competency-question answers against a hand-authored oracle → emits a pass/fail stress report.**

**Goals**
- Exercise every relation kind, every competency question, and the known failure modes (cycles,
  coverage gaps, entity-resolution ambiguity, off-domain routing, PDF extraction) — not just the
  happy path.
- Verify correctness against a ground-truth oracle, not just "nothing crashed."
- Run entirely against a **local** instance first; promote the validated corpus to the live demo
  only once the report is all-green.
- Leave the deployed demo reading as one coherent, richly-connected company.

**Non-goals**
- Changing Strata's pipeline, schema, query, or UI code. This project only adds fixtures + scripts
  under `fixtures/meridian/` and `scripts/stress/`. If the harness surfaces a genuine product bug, we
  report it; fixing it is a separate decision.
- Load/performance testing of the *infrastructure* (latency SLAs, concurrency). "Stress" here means
  semantic coverage of the knowledge-graph's scenario space.

## 2. Locked Decisions

- **[CROSS-CUTTING] Target = local-first, then promote.** All iteration runs against a local instance
  (`BASE_URL=http://localhost:3000`, DB `localhost:5433`). Promotion to the live Vercel deployment is a
  separate, manual, guarded step that re-points the same harness at the prod URL + prod `DATABASE_URL`.
- **[CROSS-CUTTING] Replace, don't append.** The harness truncates all tables before a run; Meridian
  becomes the sole corpus. (The existing `fixtures/software-bundle/` + `fixtures/labels.json` stay on
  disk untouched as the unit/eval fixtures; only the *database* is replaced.)
- **[CODING] Full oracle + auto-assertions.** Every generated doc has hand-authored ground truth in
  `fixtures/meridian/labels.json`, mirroring the existing `fixtures/labels.json` shape exactly
  (`classification`, `entities`, `links`, `cqAnswers`). The verifier diffs the live graph against it.
- **[CODING] PDFs via Playwright (HTML→PDF).** Real tables, headers/footers, and multi-page layout —
  which also stresses `unpdf` extraction (currently untested: all seed docs are `.txt`). Source content
  is hand-authored Markdown/HTML so every entity label and relation phrase appears verbatim and the
  oracle is exact.
- **[CODING] 6 services.** 5 core (`api-gateway`, `identity-service`, `order-service`,
  `payment-service`, `notification-service`) + 1 lightweight utility (`platform-config`) added solely to
  give `CONFIG` and `USES_LIBRARY` honest edges. Plus 1 non-merging distractor
  (`payments-gateway-service`).

## 3. Corpus Design — "Meridian"

Meridian is a generic e-commerce/marketplace platform (System entity: **`Meridian`**).

### 3.1 Service topology (DEPENDS_ON, with `kind`)

```
                 api-gateway ──CALLS──▶ identity-service ◀────────┐
                  │  │   │                  ▲      ▲              CALLS
              CALLS  │  CONFIG              │      │               │
                  ▼  │   └──▶ platform-config   CALLS         payment-service
            order-service ◀──USES_LIBRARY──┘      │              ▲
              │   ▲   │                            │            CALLS
   CONSUMES_EVENT  │  └──────────CALLS─────────────┴──────────────┘
              ▼   │ CONSUMES_EVENT (back-edge ⇒ CYCLE)
       notification-service
              └──READS_FROM──▶ orders-db ◀──USES── order-service   (⇒ SHARES_DATA order↔notification)
```

**DEPENDS_ON edges (Service→Service) and their kinds — all six kinds exercised:**

| source | target | kind | rationale |
|---|---|---|---|
| api-gateway | identity-service | CALLS | auth check on every request |
| api-gateway | order-service | CALLS | routes order traffic |
| api-gateway | platform-config | CONFIG | pulls routing/feature config |
| order-service | identity-service | CALLS | verify caller |
| order-service | payment-service | CALLS | charge on checkout |
| order-service | notification-service | CONSUMES_EVENT | emits `order.placed` |
| order-service | platform-config | USES_LIBRARY | shared config client SDK |
| order-service | notification-service | SHARES_DATA | both back onto `orders-db` |
| payment-service | identity-service | CALLS | owner/fraud check |
| notification-service | order-service | CONSUMES_EVENT | **back-edge → cycle** |
| notification-service | order-service | READS_FROM | reads order rows from `orders-db` |

- **Fan-in / blast radius:** `identity-service` has 3 inbound CALLS (gateway, order, payment) → large Q3 set.
- **Multi-hop transitive path (no direct edge):** `api-gateway → order-service → payment-service` — gateway
  has no direct edge to payment, so Q10 must return the ordered path through order-service.
- **Cycle:** `order-service ⇄ notification-service` → proves Q3/Q10 cycle-safe CTEs terminate.
- **Grounding of notification edges:** the four edges touching `notification-service` (order→notification
  CONSUMES_EVENT, notification→order CONSUMES_EVENT, notification→order READS_FROM, order→notification
  SHARES_DATA) are described in **ADR-M002 / ADR-M004 / impl-plan-notifications — never in the HLD or any
  LLD.** This is deliberate: it keeps `notification-service` out of every design doc so its `noDesignDoc`
  gap (matrix #7) holds while it still participates fully in the graph.

### 3.2 Entities (exact labels & key fields)

**System:** `Meridian`.

**Feature** (PART_OF Meridian): `User Login`, `Checkout`, `Order Notifications`, `Edge Routing`.

**Requirement** (SPECIFIES a Feature; `kind` ∈ functional|nfr):

| label | text (abridged) | kind | feature | coverage |
|---|---|---|---|---|
| REQ-M1 | Users authenticate with email + password | functional | User Login | VERIFIES T-login |
| REQ-M2 | Sessions use stateless JWT | functional | User Login | ADR-M001 |
| REQ-M3 | Checkout completes order + payment atomically | functional | Checkout | VERIFIES T-checkout |
| REQ-M4 | Checkout sustains 10k req/s @ p99<250ms | nfr | Checkout | VALIDATES loadtest-order-checkout (**FAIL**) |
| REQ-M5 | Login sustains 15k req/s @ p99<150ms | nfr | User Login | VALIDATES loadtest-identity-login (**PASS**) |
| REQ-M6 | Order events delivered at-least-once | functional | Order Notifications | **none → Q1 gap** |
| REQ-M7 | Payments are idempotent | functional | Checkout | VERIFIES T-payment-idempotency |
| REQ-M8 | Gateway enforces per-tenant rate limiting | nfr | Edge Routing | VERIFIES T-gateway-ratelimit |

**Service:**

| label | language | owner | USES datastore | IMPLEMENTS | design doc? | load test? |
|---|---|---|---|---|---|---|
| api-gateway | Go | Lena Ortiz | — | REQ-M8 | HLD+LLD | no |
| identity-service | Go | Priya Nair | users-db | REQ-M1, REQ-M2, REQ-M5 | HLD+LLD | yes (PASS) |
| order-service | Java | Marcus Webb | orders-db | REQ-M3, REQ-M4 | HLD+LLD | yes (FAIL, via REQ-M4) |
| payment-service | Go | **none** | payments-ledger-db | REQ-M7 | HLD+LLD | no |
| notification-service | Node | Marcus Webb | (reads orders-db) | REQ-M6 | **none → Q2 noDesignDoc** | no |
| platform-config | Go | Lena Ortiz | — | — | HLD (topology only) | no |

**Distractor:** `payments-gateway-service` — a distinct edge proxy named only in passing in the ARD/HLD;
must **not** merge with `payment-service` (over-merge guard). Minimal fields, no edges required.

**Datastore:** `users-db` (PostgreSQL), `orders-db` (PostgreSQL), `payments-ledger-db` (PostgreSQL).
USES: identity→users-db, order→orders-db, payment→payments-ledger-db. notification READS_FROM orders-db.

**Person:** `Priya Nair` (OWNS identity-service), `Marcus Webb` (OWNS order-service + notification-service),
`Lena Ortiz` (OWNS api-gateway + platform-config). payment-service deliberately unowned → Q8 "no owner".

**Decision (ADR):**

| label | title | status | AFFECTS |
|---|---|---|---|
| ADR-M001 | Adopt JWT for stateless sessions | Accepted | identity-service |
| ADR-M002 | Event-driven order notifications | Accepted | order-service, notification-service |
| ADR-M003 | Idempotency keys for payment processing | Accepted | payment-service |
| ADR-M004 | Consolidate on a shared orders datastore | Accepted | order-service, notification-service |

**Test** (in impl-plans): `T-login` VERIFIES REQ-M1; `T-checkout` VERIFIES REQ-M3;
`T-payment-idempotency` VERIFIES REQ-M7; `T-gateway-ratelimit` VERIFIES REQ-M8. (REQ-M6 has none.)

**LoadTestResult:** `identity-login` (observed 16k req/s, p99 120ms; target 15k/150ms; **passed=true**) VALIDATES REQ-M5;
`order-checkout` (observed 6k req/s, p99 400ms; target 10k/250ms; **passed=false**) VALIDATES REQ-M4.

### 3.3 Document set (18 docs → all 7 types + 1 off-domain)

| # | file | docType | primary entities embedded |
|---|---|---|---|
| 1 | PRD-meridian | PRD | System, 4 Features, REQ-M1..M8 |
| 2 | ARD-meridian | ARD | services topology, datastores, payments-gateway-service distractor (decision-heavy → ARD-vs-ADR trap) |
| 3 | HLD-meridian | HLD | the 5 services **except notification-service** + platform-config + owners + datastores + their DEPENDS_ON/USES edges; names payments-gateway-service distractor |
| 4 | LLD-identity | LLD | identity-service internals, users-db |
| 5 | LLD-order | LLD | order-service, orders-db, deps |
| 6 | LLD-payment | LLD | payment-service, payments-ledger-db |
| 7 | LLD-gateway | LLD | api-gateway, deps |
| 8 | ADR-M001 | ADR | Decision (JWT) → identity |
| 9 | ADR-M002 | ADR | Decision (events) → order, notification |
| 10 | ADR-M003 | ADR | Decision (idempotency) → payment |
| 11 | ADR-M004 | ADR | Decision (shared datastore) → order, notification |
| 12 | impl-plan-checkout | impl_plan | order, payment; REQ-M3, REQ-M7; T-checkout, T-payment-idempotency |
| 13 | impl-plan-identity | impl_plan | identity; REQ-M1, REQ-M2, REQ-M5; T-login |
| 14 | impl-plan-notifications | impl_plan | notification; REQ-M6 (no test) |
| 15 | impl-plan-gateway | impl_plan | api-gateway; REQ-M8; T-gateway-ratelimit |
| 16 | loadtest-identity-login | load_test_report | LoadTestResult identity-login (PASS) |
| 17 | loadtest-order-checkout | load_test_report | LoadTestResult order-checkout (FAIL) |
| 18 | marketing-brief | *(off-domain)* | go-to-market prose → domain≠software_dev → `unrouted` |

**Entity-resolution variants (Q row 13):** the in-domain docs refer to `identity-service` with benign
surface variation — `identity-service` (HLD/LLD), `Identity Service` (PRD prose), `identity service`
(ADR-M001) — that should normalize to **one** canonical entity. (The aggressive abbreviation `IdentitySvc`
is intentionally *omitted* from the hard oracle; if we include it, its merge is reported as a
resolution-limitation observation, not a hard failure.)

## 4. Stress Matrix (acceptance scenarios)

| # | scenario | baked in | verified by | pass condition |
|---|---|---|---|---|
| 1 | multi-hop transitive dep (no direct edge) | gateway→order→payment | Q10 | ordered path returned |
| 2 | dependency cycle | order⇄notification | Q3, Q10 | returns finite set, no timeout/loop |
| 3 | high fan-in blast radius | →identity | Q3 | ≥3 dependents |
| 4 | cross-service feature blast radius | Feature→Req→services+deps | Q9 | matches oracle set |
| 5 | all 6 DEPENDS_ON kinds | §3.1 table | entity/edge listing | each kind present ≥1 |
| 6 | requirement with no test | REQ-M6 | Q1 | REQ-M6 ∈ answer |
| 7 | service with no design doc | notification-service | Q2 | noDesignDoc=true for notification-service only |
| 8 | service with no load test | payment, notification, gateway, platform-config, distractor | Q2 | noLoadTest=true for those; false for identity & order |
| 9 | load test PASS vs FAIL vs target | identity PASS, order FAIL | Q6 | both verdicts correct |
| 10 | shared datastore | orders-db ← order & notification | Q5 + SHARES_DATA edge | both resolve |
| 11 | decisions affecting services | 4 ADRs | Q7 | AFFECTS sets match |
| 12 | ownership + missing owner | payment unowned | Q8 | owners match; payment → "no owner" |
| 13 | entity resolution (variants merge) | identity-service variants | entity table | 1 canonical identity-service |
| 14 | over-merge guard | payment-service vs payments-gateway-service | entity table | 2 distinct services |
| 15 | off-domain routing | marketing-brief | /api/status | status=`unrouted`, 0 graph entities, chunks>0 |
| 16 | ARD vs ADR classification | ARD-meridian | classification | docType=`ARD` |
| 17 | PDF extraction robustness | tables/headers/multi-page PDFs | provenance integrity | 0 unlocated spans |
| 18 | multi-doc entity merge | service across HLD+LLD+impl_plan | entity provenance | 1 canonical, ≥2 source docs |
| 19 | scale (~18 docs, ~75 LLM calls) | full corpus | /api/status | all in-domain reach `ready` |
| 20 | provenance integrity invariant | every field span | `lib/graph/integrity.ts` | invariant holds |

## 5. Harness Architecture

All new files; no edits to product code.

```
fixtures/meridian/
  src/                 # hand-authored Markdown/HTML doc sources (18 files)
  pdf/                 # generated PDFs (git-ignored; regenerated by script)
  labels.json          # ground-truth oracle (mirrors fixtures/labels.json shape)
scripts/stress/
  generate-pdfs.ts     # md/HTML -> PDF via Playwright -> fixtures/meridian/pdf/*.pdf
  reset-db.ts          # TRUNCATE all tables via DATABASE_URL (replace semantics)
  run.ts               # for each PDF: POST /api/ingest, poll /api/process to terminal; record status+timing
  verify.ts            # query the live graph, diff vs labels.json, write stress-report.md
  lib.ts               # shared: BASE_URL/api helpers, terminal-status poll, report types
stress-report.md       # generated output (git-ignored)
```

**Interfaces / contracts**
- `run.ts` and `verify.ts` read `BASE_URL` (default `http://localhost:3000`). The same scripts promote
  to live by setting `BASE_URL=https://strata-eight-green.vercel.app`.
- `reset-db.ts` reads `DATABASE_URL` (local `localhost:5433`; prod URL supplied at promote time). It
  truncates `documents, chunks, jobs, edges, attribute_provenance, entity_index` and every typed entity
  table, `RESTART IDENTITY CASCADE`. Guarded by a `--yes` flag and a printed target-host confirmation.
- The pipeline is driven exactly as the UI drives it: POST file to `/api/ingest`, then loop
  `POST /api/process` until the doc's status ∈ {`ready`, `unrouted`, `failed`} (poll `/api/status`).
- `verify.ts` hits: `GET /api/status` (classification + terminal status), `GET /api/query?type=<T>` for
  each entity type (counts + resolution + ownership), `POST /api/query {cq, params}` for Q1–Q10
  (deterministic answers), `POST /api/ask {question}` for ~3 NL probes (router smoke), and runs the
  provenance-integrity check from `lib/graph/integrity.ts`.
- Output `stress-report.md`: one row per matrix scenario (#1–#20) — PASS/FAIL + expected vs actual on
  mismatch — plus per-doc ingest status/timing and aggregate counts.

**Oracle format** — `fixtures/meridian/labels.json` mirrors `fixtures/labels.json` exactly:
`{ _about, system, classification{file→{docType,domain}}, entities{Type→[{label,…fields, sourceDocs}]},
links[{relationType, source, target, sourceType, targetType, kind?, groundedIn}],
cqAnswers{Q1..Q10→{template, question, params, answer, derivation}} }`. Entity/link key fields use the DB
column names from `lib/db/schema.ts`; CQ golden answers are derived by reasoning each
`lib/query/templates.ts` template against §3.

## 6. Workflow

1. **Setup (local):** ensure Docker pgvector is up on 5433 with schema migrated; `.env` has the 3 keys;
   start `next dev` (or `build && start`).
2. **Author** the 18 doc sources + `labels.json`.
3. **Generate** PDFs.
4. **Reset** local DB → **run** (ingest+process all 18) → **verify** → read `stress-report.md`.
5. **Iterate** on doc content/oracle until the report is all-green locally.
6. **Promote:** with prod `DATABASE_URL` + `BASE_URL=<vercel>`, run `reset-db --yes` then `run`; spot-check
   the live demo. (Promotion is manual and explicitly confirmed; it is the only step that touches prod.)

## 7. Success Criteria

- All 17 in-domain docs reach `ready`; `marketing-brief` reaches `unrouted`.
- Every matrix scenario #1–#20 passes against the oracle.
- Provenance integrity: 0 unlocated spans.
- `stress-report.md` is all-green **locally** before any promotion.

## 8. Risks & Mitigations

- **LLM nondeterminism** in classify/extract/link can make a run flap. Mitigation: oracle asserts on
  structure (entity existence, edge presence, CQ set membership), not on exact prose; a flapping row is
  re-run before being treated as a finding.
- **Cost:** ~75 Opus calls + Voyage embeds per full run. Mitigation: local-only iteration; cost flagged
  before each run; reset+run is one command so partial/aborted runs are cheap to redo.
- **Entity-resolution variants may not merge** (trigram 0.6). Mitigation: hard oracle uses benign
  variants only; aggressive abbreviation reported as observation.
- **PDF extraction may mangle tables.** That is itself a tested scenario (#17); if spans fail to locate,
  the report surfaces it as a real finding rather than hiding it.
- **Prod promotion is destructive.** Mitigation: `--yes` flag + target-host print; separate manual step;
  only after local green.
