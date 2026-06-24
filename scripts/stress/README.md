# Meridian stress harness

In-process stress harness that ingests the **Meridian** PDF corpus through the real
pipeline (classify → index → extract → resolve → link), relinks, scores it against the
oracle in `fixtures/meridian/labels.json`, runs the graph-integrity checks, and writes a
20-row pass/fail matrix to `stress-report.md`.

It reuses the live eval scorers (`test/eval/scorers.ts`) and the pure report/matrix module
(`scripts/stress/meridian-report.ts`). Nothing in `lib/` or `app/` is mocked — the scorers
read the real graph.

---

## Prerequisites

1. **Postgres + pgvector** running locally on port **5433** with the schema migrated
   (the project's Docker pgvector container; bring it up and run migrations as usual).
2. **`.env`** at the repo root with:
   - `DATABASE_URL` — pointing at the local DB on 5433
   - `ANTHROPIC_API_KEY` — extraction/classification LLM calls
   - `VOYAGE_API_KEY` — embeddings
3. **Generate the Meridian PDFs first** (renders `fixtures/meridian/src/*.md` → `fixtures/meridian/pdf/*.pdf`):

   ```bash
   pnpm stress:pdfs
   ```

---

## Running the stress test (local)

```bash
MERIDIAN=live pnpm stress:run
```

This will:

1. `TRUNCATE` all knowledge/substrate tables in the target DB (restarting identities).
2. Ingest every `fixtures/meridian/pdf/*.pdf` through the pipeline.
3. `relinkAll()`, then score classification / extraction / resolution / linking / links / CQ.
4. Run integrity (provenance span localisation + polymorphic edge-endpoint integrity).
5. Build the 20-row matrix and write `stress-report.md` (also echoed to stdout).

**Exit code:** `0` if every matrix row passes, non-zero if any row fails.

### Guard (no env var)

Running `pnpm stress:run` **without** `MERIDIAN=live` prints a skip notice and exits `0`
**without touching the DB**. The live run is only entered when `MERIDIAN=live` is set.

---

## Reading `stress-report.md`

The report has three parts:

- **Headline** — one line: CQ `passed/total`, in-domain docs ready, matrix `passing/total`,
  and integrity counts (`spanViolations`, `endpointViolations`, `apCount`, `activeEdgeCount`).
- **Matrix table** — the 20 stress scenarios (`# | scenario | result | detail`). `PASS`/`FAIL`
  per row; the `detail` column shows the underlying numbers so a failure is self-explaining.
- **Scorecard** — the full eval scorecard (classification accuracy, extraction/field/resolution
  P/R/F1, entity-linking accuracy, link P/R sweep + chosen threshold, per-CQ pass/fail).

An all-green run shows the 17 in-domain docs `ready`, `marketing-brief.pdf` `unrouted`,
CQ `10/10`, `0` span/endpoint violations, and **all 20 matrix rows PASS**.

### When a row fails

Failures are **findings about the corpus/oracle**, not the product. Adjust the relevant
`fixtures/meridian/src/*.md` (then re-run `pnpm stress:pdfs`) or correct an oracle derivation
in `fixtures/meridian/labels.json`, and re-run. A row that flaps run-to-run is LLM
nondeterminism — re-run before treating it as a finding. **Do not** change `lib/` or `app/`
to make a row pass.

---

## Promote to production (manual, user-confirmed)

Promotion seeds the **production** database with the Meridian graph so the deployed app
serves it. This is a **manual, user-confirmed** step — it truncates the prod DB.

1. Point `DATABASE_URL` at the production DB (the Vercel/Neon connection string).
2. Run:

   ```bash
   STRESS_CONFIRM=yes MERIDIAN=live pnpm stress:run
   ```

`STRESS_CONFIRM=yes` is **required** when the target host looks like a managed/prod database
(matches `neon`/`vercel`/`amazonaws`/`supabase`); without it the harness refuses and exits
non-zero. With it set, the harness **truncates the prod DB**, re-ingests the Meridian corpus,
and the deployed app then serves the freshly-built Meridian graph.

Treat this as a deliberate, one-off operation — confirm the target host (the harness echoes a
password-masked `target DB:` line) before proceeding.
