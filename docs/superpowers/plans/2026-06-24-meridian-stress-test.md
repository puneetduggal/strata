# Meridian Stress-Test Corpus & Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an adversarial 18-document corpus for one fictional company ("Meridian") plus an in-process, oracle-asserted stress harness that ingests it through Strata's real pipeline and proves all 20 stress scenarios pass.

**Architecture:** Reuse the repo's existing in-process eval machinery (`test/eval/harness.ts`, `test/eval/scorecard.ts`). Refactor its scorers into a shared `test/eval/scorers.ts`, then add a Meridian entry that truncates → ingests `fixtures/meridian/pdf/*.pdf` via `advance()` → `relinkAll()` → scores against `fixtures/meridian/labels.json` → adds provenance/edge-integrity checks → writes a 20-row stress matrix to `stress-report.md`. PDFs are generated from hand-authored Markdown via Playwright. The run is **live** (real Claude + Voyage), gated by `MERIDIAN=live`, and targets whatever `DATABASE_URL` points at (local `localhost:5433`; promotion sets it to the prod DB).

**Tech Stack:** TypeScript, `tsx` (already installed), Drizzle/postgres-js, Playwright (new devDep) + `marked` (new devDep) for PDF generation, Vitest for unit tests. Reuses `lib/pipeline/run.ts` (`advance`, `relinkAll`), `lib/ingest/extract-text.ts` (`extractText`), `lib/query/templates.ts` (`runCQ`), `lib/graph/integrity.ts` (`checkEdgeIntegrity`), `lib/provenance/locate.ts` (`locateSpan`), `lib/search/entity-index.ts` (`linkMention`), `lib/db/client.ts` (`db`, `rawSql`).

## Global Constraints

- **No product-code changes.** Touch only: `fixtures/meridian/**`, `scripts/stress/**`, `test/eval/scorers.ts` (new) + `test/eval/harness.ts` (refactor to import from it), `test/meridian-*.test.ts` (new), `package.json`, `.gitignore`. The pipeline, schema, queries, and UI under `app/` and `lib/` are NOT modified.
- **Connection target is `DATABASE_URL`** (read by `lib/db/client.ts`); there is NO HTTP/`BASE_URL` path. Local = `postgres://postgres:postgres@localhost:5433/strata?sslmode=disable`. The harness prints its target DB host on startup.
- **The Meridian harness is opt-in and live**: gated by `MERIDIAN=live` (mirrors the eval's `EVAL=live`). Without it, print a notice and `process.exit(0)`. It is NOT part of the offline `pnpm test` / CI pass. The Helios `fixtures/software-bundle/` + `fixtures/labels.json` and the offline tests stay untouched.
- **Truncate set (verbatim, in this order):** `documents, chunks, systems, features, requirements, services, datastores, tests, load_test_results, decisions, persons, edges, attribute_provenance, entity_index, jobs` with `RESTART IDENTITY`.
- **Oracle shape mirrors `fixtures/labels.json` exactly**: `{ _about, system, classification, entities, links, cqAnswers }`. Entity field keys use DB column names; `links[]` carry `kind?`; `cqAnswers` keyed `Q1`..`Q10` with `{template, question, params, answer, derivation}`.
- **Pipeline terminal statuses:** `ready` (in-domain), `unrouted` (off-domain), `failed`. The ingest loop calls `advance(docId)` up to 12× until status is terminal or stops moving (copy the loop from `test/integration-helpers.ts:ingestFile`).
- **Entity labels are fixed** (see the oracle in Task 3). Do not rename: services `api-gateway, identity-service, order-service, payment-service, notification-service, platform-config`, distractor `payments-gateway-service`; datastores `users-db, orders-db, payments-ledger-db`.
- **All 6 `DEPENDS_ON` kinds** must each appear on a DISTINCT directed service pair (so they can't collide on an upsert): `CALLS, CONFIG, USES_LIBRARY, SHARES_DATA, CONSUMES_EVENT, READS_FROM`.

---

### Task 1: Tooling — devDeps, gitignore, npm scripts

**Files:**
- Modify: `package.json` (add devDependencies + scripts)
- Modify: `.gitignore` (ignore generated PDFs + report)

**Interfaces:**
- Produces: npm scripts `stress:pdfs` (`tsx scripts/stress/generate-pdfs.ts`) and `stress:run` (`tsx scripts/stress/meridian-harness.ts`); Playwright + `marked` available as devDeps.

- [ ] **Step 1: Add devDependencies and scripts to `package.json`**

Add to `devDependencies`: `"playwright": "^1.49.0"` and `"marked": "^15.0.0"`. Add to `scripts`:
```json
"stress:pdfs": "tsx scripts/stress/generate-pdfs.ts",
"stress:run": "tsx scripts/stress/meridian-harness.ts"
```

- [ ] **Step 2: Install and fetch the Chromium browser**

Run: `corepack pnpm install && corepack pnpm exec playwright install chromium`
Expected: install succeeds; Chromium downloaded.

- [ ] **Step 3: Ignore generated artifacts**

Append to `.gitignore`:
```
fixtures/meridian/pdf/
stress-report.md
```

- [ ] **Step 4: Verify tooling**

Run: `corepack pnpm exec playwright --version && corepack pnpm exec tsx --version`
Expected: both print versions (no error).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore
git commit -m "chore(stress): add playwright + marked devdeps and stress scripts"
```

---

### Task 2: PDF generator

**Files:**
- Create: `scripts/stress/generate-pdfs.ts`
- Test: `test/meridian-pdf.test.ts`

**Interfaces:**
- Produces: `export async function mdToPdf(markdown: string): Promise<Buffer>` — renders Markdown to a styled, multi-page-capable PDF buffer; and a `main()` that reads every `fixtures/meridian/src/*.md` and writes `fixtures/meridian/pdf/<name>.pdf`. Consumed by Task 7 (the harness ingests the PDFs) and proves matrix #17 (real PDFs re-extract).

- [ ] **Step 1: Write the failing test**

`test/meridian-pdf.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { mdToPdf } from "../scripts/stress/generate-pdfs";
import { extractText } from "@/lib/ingest/extract-text";

describe("mdToPdf", () => {
  test("renders markdown (incl. a table) to a PDF whose text re-extracts via unpdf", async () => {
    const md = [
      "# identity-service LLD",
      "",
      "The identity-service authenticates users.",
      "",
      "| Service | Owner |",
      "| --- | --- |",
      "| identity-service | Priya Nair |",
    ].join("\n");
    const pdf = await mdToPdf(md);
    expect(pdf.length).toBeGreaterThan(1000); // a real PDF, not empty
    const { rawText } = await extractText(pdf, "application/pdf");
    expect(rawText).toContain("identity-service");
    expect(rawText).toContain("Priya Nair"); // table cell survived extraction
  }, 60_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm exec vitest run test/meridian-pdf.test.ts`
Expected: FAIL — `mdToPdf` not found / module missing.

- [ ] **Step 3: Implement `scripts/stress/generate-pdfs.ts`**

```ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { chromium } from "playwright";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const SRC_DIR = path.join(ROOT, "fixtures", "meridian", "src");
const OUT_DIR = path.join(ROOT, "fixtures", "meridian", "pdf");

// A production-looking document shell: serif body, ruled tables, a running header/footer.
// The tables + multi-page flow are deliberate — they exercise unpdf extraction (matrix #17).
function htmlShell(bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 22mm 18mm; }
    body { font: 11pt/1.5 Georgia, "Times New Roman", serif; color: #111; }
    h1 { font-size: 20pt; border-bottom: 2px solid #333; padding-bottom: 6px; }
    h2 { font-size: 14pt; margin-top: 20px; }
    h3 { font-size: 12pt; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #888; padding: 6px 9px; text-align: left; font-size: 10pt; }
    th { background: #f0f0f0; }
    code { background: #f4f4f4; padding: 1px 4px; }
  </style></head><body>${bodyHtml}</body></html>`;
}

export async function mdToPdf(markdown: string): Promise<Buffer> {
  const html = htmlShell(await marked.parse(markdown));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:8px;width:100%;text-align:right;padding-right:18mm;color:#999;">MERIDIAN — CONFIDENTIAL</div>`,
      footerTemplate: `<div style="font-size:8px;width:100%;text-align:center;color:#999;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith(".md")).sort();
  for (const f of files) {
    const md = fs.readFileSync(path.join(SRC_DIR, f), "utf8");
    const pdf = await mdToPdf(md);
    const out = path.join(OUT_DIR, f.replace(/\.md$/, ".pdf"));
    fs.writeFileSync(out, pdf);
    process.stdout.write(`[pdf] ${f} -> ${path.basename(out)} (${pdf.length} bytes)\n`);
  }
}

// Run as a script (not when imported by the test).
if (process.argv[1] && process.argv[1].endsWith("generate-pdfs.ts")) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm exec vitest run test/meridian-pdf.test.ts`
Expected: PASS (PDF generated, `identity-service` + `Priya Nair` found in extracted text).

- [ ] **Step 5: Commit**

```bash
git add scripts/stress/generate-pdfs.ts test/meridian-pdf.test.ts
git commit -m "feat(stress): markdown->PDF generator (Playwright) with extraction round-trip test"
```

---

### Task 3: Ground-truth oracle (`labels.json`) + shape test

**Files:**
- Create: `fixtures/meridian/labels.json`
- Create: `test/meridian-corpus.test.ts` (shape assertions only; consistency added in Task 4)

**Interfaces:**
- Produces: the oracle the harness asserts against. Classification keys are the **`.pdf`** filenames (the ingested `documents.filename`). Entity field keys are DB columns. `cqAnswers` golden answers are derived below by reasoning each `lib/query/templates.ts` template against the corpus.

- [ ] **Step 1: Write `fixtures/meridian/labels.json` exactly as follows**

```json
{
  "_about": "Ground-truth for the Meridian stress corpus (fixtures/meridian/pdf/*). The harness ingests these through the real pipeline and scores the graph + 10 CQ answers against this file. Field keys use lib/db/schema.ts column names. CQ golden answers are derived by reasoning each lib/query/templates.ts template against the graph below.",
  "system": "Meridian",
  "classification": {
    "PRD-meridian.pdf":            { "docType": "PRD",              "domain": "software_dev" },
    "ARD-meridian.pdf":            { "docType": "ARD",              "domain": "software_dev" },
    "HLD-meridian.pdf":            { "docType": "HLD",              "domain": "software_dev" },
    "LLD-identity.pdf":            { "docType": "LLD",              "domain": "software_dev" },
    "LLD-order.pdf":               { "docType": "LLD",              "domain": "software_dev" },
    "LLD-payment.pdf":             { "docType": "LLD",              "domain": "software_dev" },
    "LLD-gateway.pdf":             { "docType": "LLD",              "domain": "software_dev" },
    "ADR-M001.pdf":                { "docType": "ADR",              "domain": "software_dev" },
    "ADR-M002.pdf":                { "docType": "ADR",              "domain": "software_dev" },
    "ADR-M003.pdf":                { "docType": "ADR",              "domain": "software_dev" },
    "ADR-M004.pdf":                { "docType": "ADR",              "domain": "software_dev" },
    "impl-plan-checkout.pdf":      { "docType": "impl_plan",        "domain": "software_dev" },
    "impl-plan-identity.pdf":      { "docType": "impl_plan",        "domain": "software_dev" },
    "impl-plan-notifications.pdf": { "docType": "impl_plan",        "domain": "software_dev" },
    "impl-plan-gateway.pdf":       { "docType": "impl_plan",        "domain": "software_dev" },
    "loadtest-identity-login.pdf": { "docType": "load_test_report", "domain": "software_dev" },
    "loadtest-order-checkout.pdf": { "docType": "load_test_report", "domain": "software_dev" },
    "marketing-brief.pdf":         { "docType": "marketing",        "domain": "marketing" }
  },
  "entities": {
    "System": [
      { "label": "Meridian", "description": "The company's e-commerce/marketplace platform.", "sourceDocs": ["PRD-meridian.pdf", "ARD-meridian.pdf", "HLD-meridian.pdf"] }
    ],
    "Feature": [
      { "label": "User Login",          "description": "How a customer authenticates before transacting.", "sourceDocs": ["PRD-meridian.pdf"] },
      { "label": "Checkout",            "description": "Placing and paying for an order.",                 "sourceDocs": ["PRD-meridian.pdf"] },
      { "label": "Order Notifications", "description": "Notifying customers about order lifecycle events.",  "sourceDocs": ["PRD-meridian.pdf"] },
      { "label": "Edge Routing",        "description": "Routing and rate-limiting inbound API traffic.",     "sourceDocs": ["PRD-meridian.pdf"] }
    ],
    "Requirement": [
      { "label": "REQ-M1", "text": "Users authenticate with email and password.",                          "kind": "functional", "priority": "must-have",   "metric": null, "targetValue": null, "sourceDocs": ["PRD-meridian.pdf", "impl-plan-identity.pdf"] },
      { "label": "REQ-M2", "text": "Sessions use stateless JWT tokens.",                                    "kind": "functional", "priority": "must-have",   "metric": null, "targetValue": null, "sourceDocs": ["PRD-meridian.pdf", "impl-plan-identity.pdf"] },
      { "label": "REQ-M3", "text": "Checkout completes the order and payment atomically.",                  "kind": "functional", "priority": "must-have",   "metric": null, "targetValue": null, "sourceDocs": ["PRD-meridian.pdf", "impl-plan-checkout.pdf"] },
      { "label": "REQ-M4", "text": "Checkout sustains 10,000 requests/second at p99 < 250 ms.",            "kind": "nfr",        "priority": "must-have",   "metric": "checkout throughput and p99 latency", "targetValue": "10,000 requests/second at p99 < 250 ms", "sourceDocs": ["PRD-meridian.pdf", "impl-plan-checkout.pdf", "loadtest-order-checkout.pdf"] },
      { "label": "REQ-M5", "text": "Login sustains 15,000 requests/second at p99 < 150 ms.",               "kind": "nfr",        "priority": "must-have",   "metric": "login throughput and p99 latency",    "targetValue": "15,000 requests/second at p99 < 150 ms", "sourceDocs": ["PRD-meridian.pdf", "impl-plan-identity.pdf", "loadtest-identity-login.pdf"] },
      { "label": "REQ-M6", "text": "Order events are delivered at least once.",                             "kind": "functional", "priority": "should-have", "metric": null, "targetValue": null, "sourceDocs": ["PRD-meridian.pdf", "impl-plan-notifications.pdf"] },
      { "label": "REQ-M7", "text": "Payment processing is idempotent.",                                     "kind": "functional", "priority": "must-have",   "metric": null, "targetValue": null, "sourceDocs": ["PRD-meridian.pdf", "impl-plan-checkout.pdf"] },
      { "label": "REQ-M8", "text": "The gateway enforces per-tenant rate limiting.",                        "kind": "nfr",        "priority": "should-have", "metric": null, "targetValue": null, "sourceDocs": ["PRD-meridian.pdf", "impl-plan-gateway.pdf"] }
    ],
    "Service": [
      { "label": "api-gateway",          "language": "Go",   "owner": "Lena Ortiz",   "description": "Edge service that routes and rate-limits inbound API traffic.", "sourceDocs": ["ARD-meridian.pdf", "HLD-meridian.pdf", "LLD-gateway.pdf", "impl-plan-gateway.pdf"] },
      { "label": "identity-service",     "language": "Go",   "owner": "Priya Nair",   "description": "Authenticates users and mints JWT sessions.",                  "sourceDocs": ["ARD-meridian.pdf", "HLD-meridian.pdf", "LLD-identity.pdf", "impl-plan-identity.pdf", "ADR-M001.pdf"] },
      { "label": "order-service",        "language": "Java", "owner": "Marcus Webb",  "description": "Owns the order lifecycle and orchestrates checkout.",          "sourceDocs": ["ARD-meridian.pdf", "HLD-meridian.pdf", "LLD-order.pdf", "impl-plan-checkout.pdf", "ADR-M002.pdf", "ADR-M004.pdf"] },
      { "label": "payment-service",      "language": "Go",   "owner": null,           "description": "Charges and refunds payments idempotently.",                  "sourceDocs": ["ARD-meridian.pdf", "HLD-meridian.pdf", "LLD-payment.pdf", "impl-plan-checkout.pdf", "ADR-M003.pdf"] },
      { "label": "notification-service", "language": "Node", "owner": "Marcus Webb",  "description": "Sends order lifecycle notifications.",                         "sourceDocs": ["ADR-M002.pdf", "ADR-M004.pdf", "impl-plan-notifications.pdf"] },
      { "label": "platform-config",      "language": "Go",   "owner": "Lena Ortiz",   "description": "Service discovery and runtime configuration.",                 "sourceDocs": ["HLD-meridian.pdf"] },
      { "label": "payments-gateway-service", "language": null, "owner": null,         "description": "Third-party payment-network edge proxy (distinct from payment-service).", "sourceDocs": ["ARD-meridian.pdf", "HLD-meridian.pdf"] }
    ],
    "Datastore": [
      { "label": "users-db",           "engine": "PostgreSQL", "purpose": "System of record for user accounts and credentials.", "sourceDocs": ["HLD-meridian.pdf", "LLD-identity.pdf"] },
      { "label": "orders-db",          "engine": "PostgreSQL", "purpose": "System of record for orders; shared by order and notification.", "sourceDocs": ["HLD-meridian.pdf", "LLD-order.pdf", "ADR-M004.pdf", "impl-plan-notifications.pdf"] },
      { "label": "payments-ledger-db", "engine": "PostgreSQL", "purpose": "Append-only ledger of payment transactions.", "sourceDocs": ["HLD-meridian.pdf", "LLD-payment.pdf"] }
    ],
    "Test": [
      { "label": "T-login",               "kind": "integration", "description": "Verifies email/password login.",      "sourceDocs": ["impl-plan-identity.pdf"] },
      { "label": "T-checkout",            "kind": "integration", "description": "Verifies atomic checkout.",            "sourceDocs": ["impl-plan-checkout.pdf"] },
      { "label": "T-payment-idempotency", "kind": "integration", "description": "Verifies idempotent payment retries.", "sourceDocs": ["impl-plan-checkout.pdf"] },
      { "label": "T-gateway-ratelimit",   "kind": "integration", "description": "Verifies per-tenant rate limiting.",   "sourceDocs": ["impl-plan-gateway.pdf"] }
    ],
    "LoadTestResult": [
      { "label": "identity-login", "scenario": "Login throughput", "metric": "requests/second and p99 latency", "observedValue": "16,000 requests/second at p99 120 ms", "targetValue": "15,000 requests/second at p99 < 150 ms", "passed": true,  "sourceDocs": ["loadtest-identity-login.pdf"] },
      { "label": "order-checkout", "scenario": "Checkout throughput", "metric": "requests/second and p99 latency", "observedValue": "6,000 requests/second at p99 400 ms", "targetValue": "10,000 requests/second at p99 < 250 ms", "passed": false, "sourceDocs": ["loadtest-order-checkout.pdf"] }
    ],
    "Decision": [
      { "label": "ADR-M001", "status": "Accepted", "rationale": "Adopt JWT for stateless sessions.",        "sourceDocs": ["ADR-M001.pdf"] },
      { "label": "ADR-M002", "status": "Accepted", "rationale": "Event-driven order notifications.",         "sourceDocs": ["ADR-M002.pdf"] },
      { "label": "ADR-M003", "status": "Accepted", "rationale": "Idempotency keys for payment processing.",  "sourceDocs": ["ADR-M003.pdf"] },
      { "label": "ADR-M004", "status": "Accepted", "rationale": "Consolidate on a shared orders datastore.", "sourceDocs": ["ADR-M004.pdf"] }
    ],
    "Person": [
      { "label": "Priya Nair",  "role": "Engineer",      "sourceDocs": ["HLD-meridian.pdf", "LLD-identity.pdf"] },
      { "label": "Marcus Webb", "role": "Engineer",      "sourceDocs": ["HLD-meridian.pdf", "LLD-order.pdf", "impl-plan-notifications.pdf"] },
      { "label": "Lena Ortiz",  "role": "Engineer",      "sourceDocs": ["HLD-meridian.pdf", "LLD-gateway.pdf"] }
    ]
  },
  "links": [
    { "relationType": "PART_OF", "source": "User Login",          "target": "Meridian", "sourceType": "Feature", "targetType": "System", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "PART_OF", "source": "Checkout",            "target": "Meridian", "sourceType": "Feature", "targetType": "System", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "PART_OF", "source": "Order Notifications", "target": "Meridian", "sourceType": "Feature", "targetType": "System", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "PART_OF", "source": "Edge Routing",        "target": "Meridian", "sourceType": "Feature", "targetType": "System", "groundedIn": "PRD-meridian.pdf" },

    { "relationType": "SPECIFIES", "source": "REQ-M1", "target": "User Login",          "sourceType": "Requirement", "targetType": "Feature", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "SPECIFIES", "source": "REQ-M2", "target": "User Login",          "sourceType": "Requirement", "targetType": "Feature", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "SPECIFIES", "source": "REQ-M5", "target": "User Login",          "sourceType": "Requirement", "targetType": "Feature", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "SPECIFIES", "source": "REQ-M3", "target": "Checkout",            "sourceType": "Requirement", "targetType": "Feature", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "SPECIFIES", "source": "REQ-M4", "target": "Checkout",            "sourceType": "Requirement", "targetType": "Feature", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "SPECIFIES", "source": "REQ-M7", "target": "Checkout",            "sourceType": "Requirement", "targetType": "Feature", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "SPECIFIES", "source": "REQ-M6", "target": "Order Notifications", "sourceType": "Requirement", "targetType": "Feature", "groundedIn": "PRD-meridian.pdf" },
    { "relationType": "SPECIFIES", "source": "REQ-M8", "target": "Edge Routing",        "sourceType": "Requirement", "targetType": "Feature", "groundedIn": "PRD-meridian.pdf" },

    { "relationType": "IMPLEMENTS", "source": "identity-service", "target": "REQ-M1", "sourceType": "Service", "targetType": "Requirement", "groundedIn": "impl-plan-identity.pdf" },
    { "relationType": "IMPLEMENTS", "source": "identity-service", "target": "REQ-M2", "sourceType": "Service", "targetType": "Requirement", "groundedIn": "impl-plan-identity.pdf" },
    { "relationType": "IMPLEMENTS", "source": "identity-service", "target": "REQ-M5", "sourceType": "Service", "targetType": "Requirement", "groundedIn": "impl-plan-identity.pdf" },
    { "relationType": "IMPLEMENTS", "source": "order-service",    "target": "REQ-M3", "sourceType": "Service", "targetType": "Requirement", "groundedIn": "impl-plan-checkout.pdf" },
    { "relationType": "IMPLEMENTS", "source": "order-service",    "target": "REQ-M4", "sourceType": "Service", "targetType": "Requirement", "groundedIn": "impl-plan-checkout.pdf" },
    { "relationType": "IMPLEMENTS", "source": "payment-service",  "target": "REQ-M7", "sourceType": "Service", "targetType": "Requirement", "groundedIn": "impl-plan-checkout.pdf" },
    { "relationType": "IMPLEMENTS", "source": "notification-service", "target": "REQ-M6", "sourceType": "Service", "targetType": "Requirement", "groundedIn": "impl-plan-notifications.pdf" },
    { "relationType": "IMPLEMENTS", "source": "api-gateway",      "target": "REQ-M8", "sourceType": "Service", "targetType": "Requirement", "groundedIn": "impl-plan-gateway.pdf" },

    { "relationType": "USES", "source": "identity-service",     "target": "users-db",           "sourceType": "Service", "targetType": "Datastore", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "USES", "source": "order-service",        "target": "orders-db",          "sourceType": "Service", "targetType": "Datastore", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "USES", "source": "payment-service",      "target": "payments-ledger-db", "sourceType": "Service", "targetType": "Datastore", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "USES", "source": "notification-service", "target": "orders-db",          "sourceType": "Service", "targetType": "Datastore", "groundedIn": "ADR-M004.pdf" },

    { "relationType": "DEPENDS_ON", "source": "api-gateway",          "target": "identity-service", "kind": "CALLS",          "sourceType": "Service", "targetType": "Service", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "DEPENDS_ON", "source": "api-gateway",          "target": "order-service",    "kind": "CALLS",          "sourceType": "Service", "targetType": "Service", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "DEPENDS_ON", "source": "api-gateway",          "target": "platform-config",  "kind": "CONFIG",         "sourceType": "Service", "targetType": "Service", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "DEPENDS_ON", "source": "order-service",        "target": "identity-service", "kind": "CALLS",          "sourceType": "Service", "targetType": "Service", "groundedIn": "LLD-order.pdf" },
    { "relationType": "DEPENDS_ON", "source": "order-service",        "target": "payment-service",  "kind": "CALLS",          "sourceType": "Service", "targetType": "Service", "groundedIn": "LLD-order.pdf" },
    { "relationType": "DEPENDS_ON", "source": "order-service",        "target": "platform-config",  "kind": "USES_LIBRARY",   "sourceType": "Service", "targetType": "Service", "groundedIn": "LLD-order.pdf" },
    { "relationType": "DEPENDS_ON", "source": "order-service",        "target": "notification-service", "kind": "SHARES_DATA", "sourceType": "Service", "targetType": "Service", "groundedIn": "ADR-M004.pdf" },
    { "relationType": "DEPENDS_ON", "source": "notification-service", "target": "order-service",    "kind": "CONSUMES_EVENT", "sourceType": "Service", "targetType": "Service", "groundedIn": "ADR-M002.pdf" },
    { "relationType": "DEPENDS_ON", "source": "notification-service", "target": "payment-service",  "kind": "READS_FROM",     "sourceType": "Service", "targetType": "Service", "groundedIn": "impl-plan-notifications.pdf" },
    { "relationType": "DEPENDS_ON", "source": "payment-service",      "target": "identity-service", "kind": "CALLS",          "sourceType": "Service", "targetType": "Service", "groundedIn": "LLD-payment.pdf" },

    { "relationType": "VERIFIES", "source": "T-login",               "target": "REQ-M1", "sourceType": "Test", "targetType": "Requirement", "groundedIn": "impl-plan-identity.pdf" },
    { "relationType": "VERIFIES", "source": "T-checkout",            "target": "REQ-M3", "sourceType": "Test", "targetType": "Requirement", "groundedIn": "impl-plan-checkout.pdf" },
    { "relationType": "VERIFIES", "source": "T-payment-idempotency", "target": "REQ-M7", "sourceType": "Test", "targetType": "Requirement", "groundedIn": "impl-plan-checkout.pdf" },
    { "relationType": "VERIFIES", "source": "T-gateway-ratelimit",   "target": "REQ-M8", "sourceType": "Test", "targetType": "Requirement", "groundedIn": "impl-plan-gateway.pdf" },

    { "relationType": "VALIDATES", "source": "identity-login", "target": "REQ-M5", "sourceType": "LoadTestResult", "targetType": "Requirement", "groundedIn": "loadtest-identity-login.pdf" },
    { "relationType": "VALIDATES", "source": "order-checkout", "target": "REQ-M4", "sourceType": "LoadTestResult", "targetType": "Requirement", "groundedIn": "loadtest-order-checkout.pdf" },

    { "relationType": "AFFECTS", "source": "ADR-M001", "target": "identity-service",     "sourceType": "Decision", "targetType": "Service", "groundedIn": "ADR-M001.pdf" },
    { "relationType": "AFFECTS", "source": "ADR-M002", "target": "order-service",        "sourceType": "Decision", "targetType": "Service", "groundedIn": "ADR-M002.pdf" },
    { "relationType": "AFFECTS", "source": "ADR-M002", "target": "notification-service", "sourceType": "Decision", "targetType": "Service", "groundedIn": "ADR-M002.pdf" },
    { "relationType": "AFFECTS", "source": "ADR-M003", "target": "payment-service",      "sourceType": "Decision", "targetType": "Service", "groundedIn": "ADR-M003.pdf" },
    { "relationType": "AFFECTS", "source": "ADR-M004", "target": "order-service",        "sourceType": "Decision", "targetType": "Service", "groundedIn": "ADR-M004.pdf" },
    { "relationType": "AFFECTS", "source": "ADR-M004", "target": "notification-service", "sourceType": "Decision", "targetType": "Service", "groundedIn": "ADR-M004.pdf" },

    { "relationType": "OWNS", "source": "Priya Nair",  "target": "identity-service",     "sourceType": "Person", "targetType": "Service", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "OWNS", "source": "Marcus Webb", "target": "order-service",        "sourceType": "Person", "targetType": "Service", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "OWNS", "source": "Marcus Webb", "target": "notification-service", "sourceType": "Person", "targetType": "Service", "groundedIn": "impl-plan-notifications.pdf" },
    { "relationType": "OWNS", "source": "Lena Ortiz",  "target": "api-gateway",          "sourceType": "Person", "targetType": "Service", "groundedIn": "HLD-meridian.pdf" },
    { "relationType": "OWNS", "source": "Lena Ortiz",  "target": "platform-config",      "sourceType": "Person", "targetType": "Service", "groundedIn": "HLD-meridian.pdf" }
  ],
  "cqAnswers": {
    "Q1": { "template": "requirements_without_test", "question": "Which requirements have no verifying test?", "params": {}, "answer": ["REQ-M2", "REQ-M4", "REQ-M5", "REQ-M6"], "derivation": "VERIFIES edges exist only for REQ-M1,M3,M7,M8. The remaining requirements have no incoming VERIFIES edge (M4/M5 are validated by load tests, which are VALIDATES not VERIFIES)." },
    "Q2": { "template": "services_coverage_gaps", "question": "Which services have no design doc / no load test?", "params": {}, "answer": {
      "api-gateway":             { "noDesignDoc": false, "noLoadTest": true },
      "identity-service":        { "noDesignDoc": false, "noLoadTest": false },
      "order-service":           { "noDesignDoc": false, "noLoadTest": false },
      "payment-service":         { "noDesignDoc": false, "noLoadTest": true },
      "notification-service":    { "noDesignDoc": true,  "noLoadTest": true },
      "platform-config":         { "noDesignDoc": false, "noLoadTest": true },
      "payments-gateway-service":{ "noDesignDoc": false, "noLoadTest": true }
    }, "derivation": "noDesignDoc=true iff no MENTIONS edge from an HLD/LLD/ARD chunk: only notification-service appears in none of those doc types. noLoadTest=true iff no VALIDATES load test on a requirement the service IMPLEMENTS: identity (M5) and order (M4) are validated; all others are not." },
    "Q3": { "template": "service_blast_radius", "question": "What depends on identity-service / what breaks if it changes?", "params": { "service": "identity-service" }, "answer": ["api-gateway", "order-service", "payment-service", "notification-service"], "derivation": "Incoming DEPENDS_ON transitive closure of identity-service: direct = api-gateway, order-service, payment-service; transitive via order-service = notification-service. Cycle order<->notification is visited-set guarded." },
    "Q4": { "template": "feature_chain", "question": "Show the PRD->impl->load-test chain for Checkout.", "params": { "feature": "Checkout" }, "answer": { "requirements": ["REQ-M3", "REQ-M4", "REQ-M7"], "services": ["order-service", "payment-service"], "tests": ["T-checkout", "T-payment-idempotency"], "loadTestResults": ["order-checkout"] }, "derivation": "reqs SPECIFIES Checkout = M3,M4,M7; services IMPLEMENTS those = order,payment; tests VERIFIES those = T-checkout(M3),T-payment-idempotency(M7); loadtests VALIDATES those = order-checkout(M4)." },
    "Q5": { "template": "service_datastore", "question": "What datastore does order-service use?", "params": { "service": "order-service" }, "answer": ["orders-db"], "derivation": "USES edge order-service -> orders-db." },
    "Q6": { "template": "loadtest_vs_target", "question": "Did the load test meet the PRD target for REQ-M4?", "params": { "requirement": "REQ-M4" }, "answer": { "passed": false, "observedValue": "6,000 requests/second at p99 400 ms" }, "derivation": "order-checkout VALIDATES REQ-M4 with observed 6,000 rps / p99 400 ms vs target 10,000 rps / p99 < 250 ms -> passed=false." },
    "Q7": { "template": "service_decisions", "question": "What decisions affected order-service, and why?", "params": { "service": "order-service" }, "answer": [{ "decision": "ADR-M002" }, { "decision": "ADR-M004" }], "derivation": "AFFECTS edges into order-service: ADR-M002 (event-driven notifications) and ADR-M004 (shared orders datastore)." },
    "Q8": { "template": "service_owner", "question": "Who owns payment-service?", "params": { "service": "payment-service" }, "answer": [], "derivation": "payment-service has no OWNS edge -> no owner." },
    "Q9": { "template": "feature_blast_radius", "question": "If User Login changes, what is the full blast radius?", "params": { "feature": "User Login" }, "answer": { "requirements": ["REQ-M1", "REQ-M2", "REQ-M5"], "services": ["api-gateway", "identity-service", "order-service", "payment-service", "notification-service"], "tests": ["T-login"], "loadTestResults": ["identity-login"] }, "derivation": "reqs SPECIFIES User Login = M1,M2,M5; impl services = identity; + transitive incoming DEPENDS_ON dependents of identity = api-gateway,order,payment,notification; tests VERIFIES reqs = T-login(M1); loadtests VALIDATES reqs = identity-login(M5)." },
    "Q10": { "template": "dependency_path", "question": "How does api-gateway transitively depend on payment-service?", "params": { "source": "api-gateway", "target": "payment-service" }, "answer": { "forward": ["api-gateway", "order-service", "payment-service"] }, "derivation": "Shortest outgoing DEPENDS_ON path: api-gateway -> order-service -> payment-service (no direct edge)." }
  }
}
```

- [ ] **Step 2: Write the failing shape test**

`test/meridian-corpus.test.ts`:
```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const LABELS = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/meridian/labels.json"), "utf8"));

const ENTITY_TYPES = ["System","Feature","Requirement","Service","Datastore","Test","LoadTestResult","Decision","Person"];
const CQ_TEMPLATES = new Set(["requirements_without_test","services_coverage_gaps","service_blast_radius","feature_chain","service_datastore","loadtest_vs_target","service_decisions","service_owner","feature_blast_radius","dependency_path"]);

describe("meridian oracle shape", () => {
  test("top-level keys present", () => {
    for (const k of ["_about","system","classification","entities","links","cqAnswers"]) {
      expect(LABELS, k).toHaveProperty(k);
    }
    expect(LABELS.system).toBe("Meridian");
  });
  test("18 docs classified; exactly one off-domain", () => {
    const cls = Object.values(LABELS.classification) as Array<{domain:string}>;
    expect(Object.keys(LABELS.classification)).toHaveLength(18);
    expect(cls.filter((c) => c.domain !== "software_dev")).toHaveLength(1);
  });
  test("entity types are a subset of the package types", () => {
    for (const t of Object.keys(LABELS.entities)) expect(ENTITY_TYPES).toContain(t);
  });
  test("every link names a known relationType and the 6 DEPENDS_ON kinds all appear", () => {
    const kinds = new Set(LABELS.links.filter((l:any) => l.relationType === "DEPENDS_ON").map((l:any) => l.kind));
    for (const k of ["CALLS","CONFIG","USES_LIBRARY","SHARES_DATA","CONSUMES_EVENT","READS_FROM"]) {
      expect([...kinds], `kind ${k}`).toContain(k);
    }
  });
  test("all 10 CQs present with known templates", () => {
    expect(Object.keys(LABELS.cqAnswers)).toHaveLength(10);
    for (const spec of Object.values(LABELS.cqAnswers) as Array<{template:string}>) {
      expect(CQ_TEMPLATES.has(spec.template)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it passes (labels.json already written)**

Run: `corepack pnpm exec vitest run test/meridian-corpus.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add fixtures/meridian/labels.json test/meridian-corpus.test.ts
git commit -m "feat(stress): Meridian ground-truth oracle + shape test"
```

---

### Task 4: Hand-authored document sources (18 Markdown files)

**Files:**
- Create: `fixtures/meridian/src/PRD-meridian.md`, `ARD-meridian.md`, `HLD-meridian.md`, `LLD-identity.md`, `LLD-order.md`, `LLD-payment.md`, `LLD-gateway.md`, `ADR-M001.md`, `ADR-M002.md`, `ADR-M003.md`, `ADR-M004.md`, `impl-plan-checkout.md`, `impl-plan-identity.md`, `impl-plan-notifications.md`, `impl-plan-gateway.md`, `loadtest-identity-login.md`, `loadtest-order-checkout.md`, `marketing-brief.md`
- Modify: `test/meridian-corpus.test.ts` (add the docs↔oracle consistency test)

**Interfaces:**
- Consumes: `fixtures/meridian/labels.json` (Task 3).
- Produces: the 18 source docs. **Authoring contract:** every entity's `label` must appear verbatim in each of its `sourceDocs`; for every link, both endpoint labels must appear verbatim in its `groundedIn` doc. Write production-realistic prose (each doc 1–2 pages: title, sections, and at least one table where natural — service/owner tables in HLD, requirement tables in PRD, a results table in load tests). Field values in the oracle (descriptions, rationales, observed/target values, requirement text) should appear close to verbatim so the extractor can ground them.

- [ ] **Step 1: Write the consistency test (failing — no src files yet)**

Append to `test/meridian-corpus.test.ts`:
```ts
const SRC_DIR = path.join(ROOT, "fixtures/meridian/src");
const srcFor = (pdfName: string) => fs.readFileSync(path.join(SRC_DIR, pdfName.replace(/\.pdf$/, ".md")), "utf8");

describe("meridian corpus consistency (docs match oracle)", () => {
  test("one .md src per classified .pdf", () => {
    for (const pdf of Object.keys(LABELS.classification)) {
      expect(fs.existsSync(path.join(SRC_DIR, pdf.replace(/\.pdf$/, ".md"))), pdf).toBe(true);
    }
  });
  test("every entity label appears verbatim in each of its sourceDocs", () => {
    for (const [type, list] of Object.entries(LABELS.entities) as [string, any[]][]) {
      for (const e of list) {
        for (const doc of e.sourceDocs) {
          expect(srcFor(doc).includes(e.label), `${type}:${e.label} in ${doc}`).toBe(true);
        }
      }
    }
  });
  test("every link's source+target labels appear verbatim in its groundedIn doc", () => {
    for (const l of LABELS.links as any[]) {
      const txt = srcFor(l.groundedIn);
      expect(txt.includes(l.source), `${l.relationType} source ${l.source} in ${l.groundedIn}`).toBe(true);
      expect(txt.includes(l.target), `${l.relationType} target ${l.target} in ${l.groundedIn}`).toBe(true);
    }
  });
  test("notification-service appears in NO HLD/LLD/ARD doc (noDesignDoc invariant)", () => {
    for (const pdf of ["HLD-meridian.pdf","LLD-identity.pdf","LLD-order.pdf","LLD-payment.pdf","LLD-gateway.pdf","ARD-meridian.pdf"]) {
      expect(srcFor(pdf).includes("notification-service"), `notification-service must NOT be in ${pdf}`).toBe(false);
    }
  });
  test("marketing-brief mentions no service label (stays off-domain)", () => {
    const txt = srcFor("marketing-brief.pdf");
    for (const s of (LABELS.entities.Service as any[])) {
      expect(txt.includes(s.label), `marketing brief must not name ${s.label}`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm exec vitest run test/meridian-corpus.test.ts`
Expected: FAIL — src files missing.

- [ ] **Step 3: Author the 18 docs**

Write each `fixtures/meridian/src/<name>.md` honoring the authoring contract. Use the per-doc content map below (the spec §3 is the full design reference). Example pattern for `HLD-meridian.md` (write the other 17 in the same realistic register):

````markdown
# Meridian Platform — High-Level Design (HLD)

**System:** Meridian — the company's e-commerce/marketplace platform.

## Services and Owners

| Service | Language | Owner | Datastore |
| --- | --- | --- | --- |
| api-gateway | Go | Lena Ortiz | — |
| identity-service | Go | Priya Nair | users-db |
| order-service | Java | Marcus Webb | orders-db |
| payment-service | Go | (unassigned) | payments-ledger-db |
| platform-config | Go | Lena Ortiz | — |

A separate third-party edge proxy, payments-gateway-service, fronts the external
card networks and is distinct from payment-service.

## Datastores

- users-db (PostgreSQL): system of record for user accounts and credentials.
- orders-db (PostgreSQL): system of record for orders.
- payments-ledger-db (PostgreSQL): append-only ledger of payment transactions.

## Service Dependencies

- api-gateway calls identity-service for auth on every request (CALLS).
- api-gateway routes order traffic to order-service (CALLS).
- api-gateway reads runtime configuration from platform-config (CONFIG).
- payment-service calls identity-service to verify the paying account (CALLS).

## Ownership

Priya Nair owns identity-service. Marcus Webb owns order-service. Lena Ortiz
owns api-gateway and platform-config.
````

**Per-doc content map** (what each doc must establish — labels verbatim, relations as prose the linker can ground):
- **PRD-meridian**: System Meridian; the 4 Features; REQ-M1..M8 with their text/kind/priority and (for M4/M5) the metric+target strings; state each feature is `PART_OF Meridian` and each requirement `SPECIFIES` its feature (a requirements table is natural).
- **ARD-meridian**: architecture review naming all services incl. `payments-gateway-service` (distinct from `payment-service`), the 3 datastores, and the key decisions in *review* prose (so it classifies `ARD`, not `ADR`). Do NOT name `notification-service`.
- **HLD-meridian**: as above. The `CALLS`/`CONFIG` deps, all 3 `USES`, and the 4 HLD-grounded `OWNS` edges. Do NOT name `notification-service`.
- **LLD-identity**: identity-service internals; `USES users-db`; Priya Nair.
- **LLD-order**: order-service; deps `order-service` → `identity-service` (CALLS), → `payment-service` (CALLS), → `platform-config` (USES_LIBRARY); Marcus Webb. Do NOT name notification-service.
- **LLD-payment**: payment-service; `payment-service` → `identity-service` (CALLS); payments-ledger-db.
- **LLD-gateway**: api-gateway internals; rate limiting; Lena Ortiz.
- **ADR-M001**: Decision ADR-M001 "Adopt JWT for stateless sessions" (status Accepted), AFFECTS identity-service.
- **ADR-M002**: ADR-M002 "Event-driven order notifications"; AFFECTS order-service and notification-service; establishes notification-service `CONSUMES_EVENT` from order-service.
- **ADR-M003**: ADR-M003 "Idempotency keys for payment processing"; AFFECTS payment-service.
- **ADR-M004**: ADR-M004 "Consolidate on a shared orders datastore"; AFFECTS order-service and notification-service; states notification-service `USES orders-db` and `SHARES_DATA` with order-service.
- **impl-plan-checkout**: order-service & payment-service; IMPLEMENTS REQ-M3/M4 (order), REQ-M7 (payment); Tests T-checkout (VERIFIES REQ-M3), T-payment-idempotency (VERIFIES REQ-M7).
- **impl-plan-identity**: identity-service IMPLEMENTS REQ-M1/M2/M5; Test T-login VERIFIES REQ-M1.
- **impl-plan-notifications**: notification-service IMPLEMENTS REQ-M6; OWNS Marcus Webb; `notification-service` → `payment-service` (READS_FROM); names orders-db.
- **impl-plan-gateway**: api-gateway IMPLEMENTS REQ-M8; Test T-gateway-ratelimit VERIFIES REQ-M8.
- **loadtest-identity-login**: LoadTestResult identity-login; observed "16,000 requests/second at p99 120 ms" vs target "15,000 requests/second at p99 < 150 ms"; PASSED; VALIDATES REQ-M5 (name REQ-M5). Include a results table.
- **loadtest-order-checkout**: LoadTestResult order-checkout; observed "6,000 requests/second at p99 400 ms" vs target "10,000 requests/second at p99 < 250 ms"; FAILED; VALIDATES REQ-M4 (name REQ-M4). Include a results table.
- **marketing-brief**: a go-to-market / positioning one-pager. Pure business prose — must NOT name any service label, requirement id, or datastore (so it routes `unrouted`).

- [ ] **Step 4: Run the consistency test to verify it passes**

Run: `corepack pnpm exec vitest run test/meridian-corpus.test.ts`
Expected: PASS (all consistency tests green).

- [ ] **Step 5: Generate the PDFs and sanity-check the count**

Run: `corepack pnpm stress:pdfs && ls fixtures/meridian/pdf | wc -l`
Expected: 18 PDFs written.

- [ ] **Step 6: Commit**

```bash
git add fixtures/meridian/src test/meridian-corpus.test.ts
git commit -m "feat(stress): 18 Meridian source docs + docs<->oracle consistency tests"
```

---

### Task 5: Refactor eval scorers into a shared, parameterized module

**Files:**
- Create: `test/eval/scorers.ts`
- Modify: `test/eval/harness.ts` (delete the moved code; import from `./scorers`; pass a Helios config)

**Interfaces:**
- Produces:
  - `export type Labels = { classification; entities; links; cqAnswers }` (the shape from `harness.ts`).
  - `export type LinkCase = { mention: string; type: TypeName; expectedLabel: string }`.
  - `export type EvalConfig = { bundleDir: string; labelsPath: string; accept: (f: string) => boolean; mime: string; linkCases: LinkCase[] }`.
  - `export async function truncateAll(): Promise<void>` (the verbatim truncate).
  - `export async function ingestBundle(cfg: EvalConfig): Promise<Map<string, { id: number; status: string }>>` (read dir, filter by `accept`, `extractText(buf, cfg.mime)`, insert, `advance()`-loop to terminal; returns file→{id,status}).
  - `export async function scoreAll(cfg: EvalConfig, labels: Labels): Promise<Scorecard>` (runs scoreClassification/Extraction/Resolution/Linking(cfg.linkCases)/Links/CQ — the existing functions, moved verbatim).
  - `export { resolveCQParams, compareCQ, scoreResolution, scoreClassification, liveEntities, idByLabel, labelsOf, TABLES_BY_TYPE, norm }` (so the Meridian harness can compute matrix rows directly).
- Consumes: nothing new — moves existing `harness.ts` internals.

- [ ] **Step 1: Create `test/eval/scorers.ts` by moving the reusable code from `harness.ts`**

Move verbatim (no behavior change) from `harness.ts` into `scorers.ts` and `export` them: `norm`, `TABLES_BY_TYPE`, `TypeName`, `FIELD_KEYS`, `COLUMN_OF`, `EXACT_FIELDS`, `Labels`, `liveEntities`, `aliasMap`, `matchNodes`, `idByLabel`, `labelsOf`, `fieldMatch`, `scoreClassification`, `scoreExtraction`, `scoreResolution`, `scoreLinking` (change its `LINK_CASES` constant into a `linkCases` parameter), `loadSemanticEdges`, `scoreLinks` (keep `PRECISION_TARGET`/`THRESHOLDS` here), `resolveCQParams`, `compareCQ`, `labelsOf`, `scoreCQ`, `truncateAll`. Add `LinkCase`, `EvalConfig`, `ingestBundle(cfg)` (generalize `ingestBundle` to read `cfg.bundleDir`, filter by `cfg.accept`, use `cfg.mime`), and `scoreAll(cfg, labels)` that calls the six scorers and returns the assembled `Scorecard`. Import `prf, prfFromSets, sameSet, sameOrdered, pickThreshold, type PR, type Scorecard, type ThresholdRow` from `./scorecard`.

- [ ] **Step 2: Thin `harness.ts` to a Helios entry that uses `scorers.ts`**

`harness.ts` keeps its `import "dotenv/config"`, the `EVAL=live` guard, the `vi`-free top-level `main()`, and `formatScorecard`. Replace its moved internals with:
```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rawSql } from "@/lib/db/client";
import { relinkAll } from "@/lib/pipeline/run";
import { formatScorecard, type Scorecard } from "./scorecard";
import { truncateAll, ingestBundle, scoreAll, type Labels, type LinkCase, type EvalConfig } from "./scorers";
import fs from "node:fs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const HELIOS_LINK_CASES: LinkCase[] = [
  { mention: "login system", type: "Service", expectedLabel: "auth-service" },
  { mention: "sign-in service", type: "Service", expectedLabel: "auth-service" },
  { mention: "session token minting service", type: "Service", expectedLabel: "token-service" },
  { mention: "user database", type: "Datastore", expectedLabel: "user-db" },
  { mention: "authentication feature", type: "Feature", expectedLabel: "User Authentication" },
  { mention: "JWT decision", type: "Decision", expectedLabel: "ADR-001" },
];
const cfg: EvalConfig = {
  bundleDir: path.join(ROOT, "fixtures", "software-bundle"),
  labelsPath: path.join(ROOT, "fixtures", "labels.json"),
  accept: (f) => f.endsWith(".txt"),
  mime: "text/plain",
  linkCases: HELIOS_LINK_CASES,
};
// ... main(): guard, truncateAll(), ingestBundle(cfg), relinkAll(), const sc = await scoreAll(cfg, labels), log(formatScorecard(sc)) ...
```
(Keep the exact log lines / `LINK_THRESHOLD=` print and the `main().then(...).catch(...)` exit wrapper.)

- [ ] **Step 3: Verify nothing in the offline suite broke**

Run: `corepack pnpm exec tsc --noEmit && corepack pnpm test`
Expected: typecheck clean; the full offline unit suite still passes (it imports `./eval/scorecard` only, never the moved internals, so this proves no import breakage).

- [ ] **Step 4: (Optional, live) Confirm the Helios eval still scores identically**

Run: `EVAL=live corepack pnpm tsx test/eval/harness.ts`
Expected: same scorecard headline as before the refactor (CQ 10/10). Skip if conserving API spend; Step 3 already proves the refactor is structurally sound.

- [ ] **Step 5: Commit**

```bash
git add test/eval/scorers.ts test/eval/harness.ts
git commit -m "refactor(eval): extract parameterized scorers into test/eval/scorers.ts"
```

---

### Task 6: Stress report module (pure)

**Files:**
- Create: `scripts/stress/meridian-report.ts`
- Test: `test/meridian-report.test.ts`

**Interfaces:**
- Produces:
  - `export type IntegrityResult = { spanViolations: number; endpointViolations: number; apCount: number; activeEdgeCount: number }`.
  - `export type MatrixInputs = { scorecard: Scorecard; integrity: IntegrityResult; statuses: Record<string, string>; distinctKinds: string[]; q3Count: number; q6Pass: { m4Passed: boolean | null; m5Passed: boolean | null }; q8PaymentOwners: string[]; sharedDatastore: boolean; resolutionByKey: Record<string, number>; identityProvenanceDocs: number; marketingEntityCount: number }`.
  - `export function buildMatrix(inp: MatrixInputs): Array<{ n: number; name: string; pass: boolean; detail: string }>` — pure mapping to the 20 rows.
  - `export function renderReport(scorecard: Scorecard, matrix, integrity: IntegrityResult): string` — markdown (headline counts, the 20-row matrix table, the scorecard text).
- Consumes: `Scorecard` from `../../test/eval/scorecard`.

- [ ] **Step 1: Write the failing test**

`test/meridian-report.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { buildMatrix, renderReport, type MatrixInputs } from "../scripts/stress/meridian-report";

function passingInputs(): MatrixInputs {
  return {
    scorecard: { cq: { perCQ: [
      { id: "Q1", template: "requirements_without_test", ok: true },
      { id: "Q3", template: "service_blast_radius", ok: true },
      { id: "Q4", template: "feature_chain", ok: true },
      { id: "Q5", template: "service_datastore", ok: true },
      { id: "Q7", template: "service_decisions", ok: true },
      { id: "Q9", template: "feature_blast_radius", ok: true },
      { id: "Q10", template: "dependency_path", ok: true },
      { id: "Q2", template: "services_coverage_gaps", ok: true },
      { id: "Q6", template: "loadtest_vs_target", ok: true },
      { id: "Q8", template: "service_owner", ok: true },
    ], passed: 10, total: 10 }, classification: { perDoc: [{ file: "ARD-meridian.pdf", predicted: "ARD/software_dev", labeled: "ARD/software_dev", ok: true }], accuracy: 1 } } as any,
    integrity: { spanViolations: 0, endpointViolations: 0, apCount: 80, activeEdgeCount: 60 },
    statuses: { "PRD-meridian.pdf": "ready", "marketing-brief.pdf": "unrouted" },
    distinctKinds: ["CALLS","CONFIG","USES_LIBRARY","SHARES_DATA","CONSUMES_EVENT","READS_FROM"],
    q3Count: 4, q6Pass: { m4Passed: false, m5Passed: true }, q8PaymentOwners: [],
    sharedDatastore: true, resolutionByKey: { "Service:identity-service": 1, "Service:payment-service": 1, "Service:payments-gateway-service": 1 },
    identityProvenanceDocs: 3, marketingEntityCount: 0,
  };
}

describe("buildMatrix / renderReport", () => {
  test("all-green inputs produce 20 passing rows", () => {
    const m = buildMatrix(passingInputs());
    expect(m).toHaveLength(20);
    expect(m.every((r) => r.pass)).toBe(true);
  });
  test("a span violation fails the integrity rows (#17, #20)", () => {
    const inp = passingInputs(); inp.integrity.spanViolations = 3;
    const m = buildMatrix(inp);
    expect(m.find((r) => r.n === 17)!.pass).toBe(false);
    expect(m.find((r) => r.n === 20)!.pass).toBe(false);
  });
  test("missing DEPENDS_ON kind fails #5", () => {
    const inp = passingInputs(); inp.distinctKinds = ["CALLS"];
    expect(buildMatrix(inp).find((r) => r.n === 5)!.pass).toBe(false);
  });
  test("renderReport emits a markdown matrix with PASS/FAIL", () => {
    const md = renderReport(passingInputs().scorecard, buildMatrix(passingInputs()), passingInputs().integrity);
    expect(md).toContain("# Meridian Stress Report");
    expect(md).toMatch(/PASS|FAIL/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `corepack pnpm exec vitest run test/meridian-report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/stress/meridian-report.ts`**

Implement `buildMatrix` mapping each of the 20 scenarios (spec §4) to a verdict from `MatrixInputs`:
1 Q10 ok; 2 Q3 ok && Q10 ok (cycle-safe: both returned); 3 `q3Count >= 3`; 4 Q9 ok; 5 all 6 kinds ⊆ `distinctKinds`; 6 Q1 ok; 7 Q2 ok; 8 Q2 ok; 9 `q6Pass.m4Passed === false && q6Pass.m5Passed === true`; 10 `sharedDatastore && Q5 ok`; 11 Q7 ok; 12 Q8 ok && `q8PaymentOwners.length === 0`; 13 `resolutionByKey["Service:identity-service"] === 1`; 14 `resolutionByKey["Service:payment-service"] === 1 && resolutionByKey["Service:payments-gateway-service"] === 1`; 15 `statuses["marketing-brief.pdf"] === "unrouted" && marketingEntityCount === 0`; 16 classification row for `ARD-meridian.pdf` ok; 17 `integrity.spanViolations === 0`; 18 `identityProvenanceDocs >= 2`; 19 every in-domain doc status === `ready`; 20 `integrity.spanViolations === 0 && integrity.endpointViolations === 0`. Look up a CQ by id via `scorecard.cq.perCQ.find(c => c.id === ...)?.ok ?? false`. `renderReport` prints a `# Meridian Stress Report` header, a headline (CQ x/10, in-domain ready count, integrity counts), the 20-row table (`| # | scenario | result | detail |`), then `formatScorecard(scorecard)` in a fenced block.

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm exec vitest run test/meridian-report.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/stress/meridian-report.ts test/meridian-report.test.ts
git commit -m "feat(stress): pure stress-matrix + markdown report module"
```

---

### Task 7: Meridian harness — live run + all-green report

**Files:**
- Create: `scripts/stress/meridian-harness.ts`
- Create: `scripts/stress/README.md` (runbook + promote steps)

**Interfaces:**
- Consumes: `scorers.ts` (Task 5), `meridian-report.ts` (Task 6), the oracle + PDFs (Tasks 3–4), `relinkAll`/`runCQ`/`checkEdgeIntegrity`/`locateSpan`/`db`/`rawSql`.
- Produces: `MERIDIAN=live pnpm stress:run` → truncates, ingests `fixtures/meridian/pdf/*.pdf`, relinks, scores, runs integrity, writes `stress-report.md`. Exit non-zero if any matrix row fails.

- [ ] **Step 1: Implement `scripts/stress/meridian-harness.ts`**

```ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, rawSql } from "@/lib/db/client";
import { relinkAll } from "@/lib/pipeline/run";
import { runCQ } from "@/lib/query/templates";
import { checkEdgeIntegrity, type EdgeEndpoints } from "@/lib/graph/integrity";
import { locateSpan } from "@/lib/provenance/locate";
import { formatScorecard } from "../../test/eval/scorecard";
import {
  truncateAll, ingestBundle, scoreAll, idByLabel, liveEntities,
  type Labels, type LinkCase, type EvalConfig,
} from "../../test/eval/scorers";
import { buildMatrix, renderReport, type IntegrityResult, type MatrixInputs } from "./meridian-report";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const FIX = path.join(ROOT, "fixtures", "meridian");
const REPORT = path.join(ROOT, "stress-report.md");
const log = (m: string) => process.stdout.write(m + "\n");

const MERIDIAN_LINK_CASES: LinkCase[] = [
  { mention: "the login / auth service", type: "Service", expectedLabel: "identity-service" },
  { mention: "order lifecycle service", type: "Service", expectedLabel: "order-service" },
  { mention: "the orders database", type: "Datastore", expectedLabel: "orders-db" },
  { mention: "JWT sessions decision", type: "Decision", expectedLabel: "ADR-M001" },
];

const cfg: EvalConfig = {
  bundleDir: path.join(FIX, "pdf"),
  labelsPath: path.join(FIX, "labels.json"),
  accept: (f) => f.endsWith(".pdf"),
  mime: "application/pdf",
  linkCases: MERIDIAN_LINK_CASES,
};

async function runIntegrity(): Promise<IntegrityResult> {
  const ap = (await rawSql`SELECT ap.snippet, d.raw_text FROM attribute_provenance ap JOIN documents d ON d.id = ap.document_id`) as Array<{ snippet: string | null; raw_text: string }>;
  const ed = (await rawSql`SELECT e.snippet, d.raw_text FROM edges e JOIN documents d ON d.id = e.evidence_document_id WHERE e.active`) as Array<{ snippet: string | null; raw_text: string }>;
  let spanViolations = 0;
  for (const r of [...ap, ...ed]) if (!r.snippet || locateSpan(r.raw_text, r.snippet) === null) spanViolations++;
  const all = (await rawSql`SELECT id, source_type, source_id, target_type, target_id FROM edges WHERE active`) as any[];
  const endpoints: EdgeEndpoints[] = all.map((e) => ({ id: e.id, sourceType: e.source_type, sourceId: e.source_id, targetType: e.target_type, targetId: e.target_id }));
  const endpointViolations = (await checkEdgeIntegrity(endpoints)).length;
  return { spanViolations, endpointViolations, apCount: ap.length, activeEdgeCount: ed.length };
}

async function main(): Promise<void> {
  if (process.env.MERIDIAN !== "live") {
    log("[meridian] MERIDIAN!=live — skipping the live stress harness. Set MERIDIAN=live to run. Exit 0.");
    process.exit(0);
  }
  const host = (process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@");
  log(`[meridian] target DB: ${host}`);
  if (/neon|vercel|amazonaws|supabase/i.test(host) && process.env.STRESS_CONFIRM !== "yes") {
    log("[meridian] target looks like a PROD database. Re-run with STRESS_CONFIRM=yes to proceed.");
    process.exit(1);
  }

  const labels = JSON.parse(fs.readFileSync(cfg.labelsPath, "utf8")) as Labels;
  await truncateAll();
  const statusMap = await ingestBundle(cfg);          // file -> {id, status}
  await relinkAll();
  const scorecard = await scoreAll(cfg, labels);
  const integrity = await runIntegrity();

  // Extra signals for the matrix.
  const statuses: Record<string, string> = {};
  for (const [f, r] of statusMap) statuses[f] = r.status;
  const kindsRows = (await rawSql`SELECT DISTINCT kind FROM edges WHERE relation_type = 'DEPENDS_ON' AND active AND kind IS NOT NULL`) as Array<{ kind: string }>;
  const idServiceId = await idByLabel("Service", "identity-service");
  const q3 = await runCQ("service_blast_radius", { serviceId: idServiceId! });
  const m4 = await idByLabel("Requirement", "REQ-M4");
  const m5 = await idByLabel("Requirement", "REQ-M5");
  const q6m4 = (await runCQ("loadtest_vs_target", { requirementId: m4! })).rows[0]?.passed ?? null;
  const q6m5 = (await runCQ("loadtest_vs_target", { requirementId: m5! })).rows[0]?.passed ?? null;
  const payId = await idByLabel("Service", "payment-service");
  const q8 = await runCQ("service_owner", { serviceId: payId! });
  const orderUses = (await runCQ("service_datastore", { serviceId: (await idByLabel("Service", "order-service"))! })).rows.map((r: any) => r.label);
  const notifUses = (await runCQ("service_datastore", { serviceId: (await idByLabel("Service", "notification-service"))! })).rows.map((r: any) => r.label);

  // Resolution counts by label (from the scorecard's resolution detail).
  const resolutionByKey: Record<string, number> = {};
  for (const d of scorecard.resolution.detail) resolutionByKey[d.key] = (resolutionByKey[d.key] ?? 0) + d.found;

  // identity-service provenance breadth (distinct source docs) — matrix #18.
  const idProv = (await rawSql`
    SELECT COUNT(DISTINCT ap.document_id)::int AS n FROM attribute_provenance ap
    WHERE ap.entity_type = 'Service' AND ap.entity_id = ${idServiceId!}
  `) as Array<{ n: number }>;

  // marketing-brief produced no graph entities (only chunks) — matrix #15.
  const marketingDoc = (await rawSql`SELECT id FROM documents WHERE filename = 'marketing-brief.pdf'`) as Array<{ id: number }>;
  const marketingProv = (await rawSql`SELECT COUNT(*)::int AS n FROM attribute_provenance WHERE document_id = ${marketingDoc[0]?.id ?? -1}`) as Array<{ n: number }>;

  const inputs: MatrixInputs = {
    scorecard, integrity, statuses,
    distinctKinds: kindsRows.map((k) => k.kind),
    q3Count: q3.rows.length,
    q6Pass: { m4Passed: q6m4 === null ? null : Boolean(q6m4), m5Passed: q6m5 === null ? null : Boolean(q6m5) },
    q8PaymentOwners: q8.rows.map((r: any) => r.label),
    sharedDatastore: orderUses.includes("orders-db") && notifUses.includes("orders-db"),
    resolutionByKey,
    identityProvenanceDocs: idProv[0]?.n ?? 0,
    marketingEntityCount: marketingProv[0]?.n ?? 0,
  };

  const matrix = buildMatrix(inputs);
  const report = renderReport(scorecard, matrix, integrity);
  fs.writeFileSync(REPORT, report);
  log(report);
  const failed = matrix.filter((r) => !r.pass);
  log(`[meridian] matrix: ${matrix.length - failed.length}/${matrix.length} passed. Report -> ${REPORT}`);
  await rawSql.end();
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch(async (e) => { log(`[meridian] FATAL: ${e instanceof Error ? e.stack : String(e)}`); try { await rawSql.end(); } catch {} process.exit(1); });
```

- [ ] **Step 2: Verify the guard (no env → exit 0, no DB needed)**

Run: `corepack pnpm stress:run`
Expected: prints the `MERIDIAN!=live` notice and exits 0.

- [ ] **Step 3: Run the live stress test against the local DB**

Pre-req: Docker pgvector up on 5433 with schema migrated; `.env` has `DATABASE_URL`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`; PDFs generated (Task 4 Step 5).
Run: `MERIDIAN=live corepack pnpm stress:run`
Expected: writes `stress-report.md`; headline shows all 17 in-domain docs `ready`, `marketing-brief.pdf` `unrouted`, CQ 10/10, 0 span/endpoint violations, and **all 20 matrix rows PASS**. Exit 0.

- [ ] **Step 4: If any row fails, iterate (doc content / oracle), not product code**

Failures are findings. Adjust the relevant `fixtures/meridian/src/*.md` (regenerate PDFs) or correct an oracle derivation, then re-run Step 3. A flapping row (LLM nondeterminism) is re-run before being treated as a finding. Do NOT change `lib/` or `app/`.

- [ ] **Step 5: Write `scripts/stress/README.md`**

Document: prerequisites; `pnpm stress:pdfs` then `MERIDIAN=live pnpm stress:run`; how to read `stress-report.md`; and the **promote** procedure — set `DATABASE_URL` to the prod (Vercel/Neon) DB and run `STRESS_CONFIRM=yes MERIDIAN=live pnpm stress:run`; note it truncates the prod DB and that the deployed app then serves the Meridian graph. Mark promote as a manual, user-confirmed step.

- [ ] **Step 6: Commit**

```bash
git add scripts/stress/meridian-harness.ts scripts/stress/README.md stress-report.md
git commit -m "feat(stress): Meridian in-process stress harness + runbook (all 20 scenarios green)"
```

(Note: `stress-report.md` is git-ignored per Task 1; the commit above will only add the harness + README. Leave the report uncommitted.)

---

## Self-Review

**Spec coverage:** §3 corpus → Tasks 3–4 (oracle + 18 docs). §4 matrix (20 rows) → Task 6 `buildMatrix` + Task 7 inputs, each row mapped. §5 harness → Tasks 5–7 (scorers reuse, harness, report). §6 workflow → Task 7 Steps 3/5 (local run + promote). §7 success criteria → Task 7 Step 3 expected output. PDF realism / matrix #17 → Task 2 round-trip test + real-PDF ingestion in Task 7.

**Type consistency:** `EvalConfig`/`Labels`/`LinkCase` defined in Task 5 and consumed verbatim in Task 7. `MatrixInputs`/`IntegrityResult` defined in Task 6 and populated in Task 7. CQ param key names (`serviceId`, `featureId`, `requirementId`, `sourceId`, `targetId`) match `lib/query/templates.ts`. `runCQ` returns `{rows, provenance}`; `service_owner`/`requirements_without_test` rows carry `.label`; `loadtest_vs_target` rows carry `.passed`; `dependency_path` rows carry `.path` — all matched to the derivations in Task 3.

**Placeholder scan:** none — the oracle is fully enumerated; code blocks are complete; the only prose-judgment step (authoring 18 docs) is gated by a runnable consistency test + a worked example.

**Known soft spots (live-run findings, not plan defects):** entity-resolution of `identity-service` surface variants (matrix #13) depends on the trigram/RRF resolver; the oracle uses benign variants, and a >1 result is reported as a resolution finding. LLM extraction may under/over-populate a field; the scorecard quantifies it and the matrix keys on structural presence, not prose.
