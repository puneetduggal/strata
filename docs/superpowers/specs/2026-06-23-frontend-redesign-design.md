# Strata Frontend Redesign — Design Spec

**Date:** 2026-06-23
**Branch:** `feat/frontend-redesign`
**Source of truth (visual):** `Strata Flow.html` (decoded → `.superpowers/design-source/template.html`), cataloged frame-by-frame in `.superpowers/design-source/catalog/00..07-*.md`. Those catalogs are **authoritative** for every pixel value (tokens, px sizes, weights, copy, SVG paths). This spec is the architecture + scope contract; it references the catalogs rather than duplicating recipes.

---

## 1. Goal

Reskin the existing Strata app so the running Vercel deployment **looks like `Strata Flow.html`** across all screens, while **every existing flow and all 10 competency questions (Q1–Q10) keep working end-to-end**. This is a **visual reskin** — no API contract changes, no CQ logic changes, no schema/pipeline changes.

Success = (a) each screen visually matches its frame in the design (layout, the Geist/Geist-Mono type, the CSS-variable token palette, light+dark+accent theming, component recipes); (b) `pnpm build` + `pnpm test` (73 unit) + `pnpm test:integration` (15) stay green; (c) all flows verified end-to-end (upload→pipeline, table browse→doc, ask→answer→citation→doc, graph→inspector→doc) and all 10 CQs answerable via both `/api/query` POST and `/api/ask`; (d) deployed to Vercel.

## 2. Scope guardrails (binding)

**MUST NOT change:**
- `/api/*` route request/response **contracts** (`ask`, `query` GET+POST, `ingest`, `process`, `status`).
- The 10 CQ definitions/logic in `lib/query/templates.ts` and routing behavior in `lib/query/router.ts`.
- DB schema (`lib/db/schema.ts`), pipeline (`lib/pipeline/*`), embeddings, `fixtures/labels.json` (ground truth — never edit).

**MAY change (presentation + internal plumbing only):**
- `app/**` pages & `app/layout.tsx`, `components/**`, `app/globals.css`, `tailwind.config.ts`, `package.json` (add `geist`).
- **Internal loaders** (`lib/query/graph.ts`) — *only* to surface data the design displays, reusing existing query logic, **without** changing any `/api` contract or CQ. Specifically allowed enrichments:
  - `getSystemGraph` → add per-node `fields` (for the inspector) — `SELECT *` the typed tables it already queries.
  - A new doc-citations loader (read `attribute_provenance` + active `edges` where the doc is the evidence/source) for the doc citation rail + passive highlights.
- Every changed line must trace to design fidelity or to surfacing already-computed data. No speculative features, no refactors beyond what the reskin needs.

## 3. Design system foundation (catalog `00-design-system.md` is authoritative)

1. **Fonts** — add `geist` npm package; load `GeistSans`/`GeistMono` via `next/font` in `layout.tsx`, bind to `--font-geist-sans` / `--font-geist-mono`. Geist sans is the body font; Geist Mono is used for identifiers, IDs, badges, code-like meta, counts, table headers, citation links (per catalogs).
2. **Tokens** — paste the full token system into `globals.css`: `:root` (light, default) + `[data-theme="dark"]` + the three `[data-accent="violet|blue|emerald"]` (and their dark variants) overrides, **verbatim** from catalog §3 (`--canvas/app/surface/surface-2/sidebar/border/border-2/text/text-2/text-3/accent/gap/warn/ok/cyan`, the nine `--e-*` entity colors, `--shadow/-sm`, and the `color-mix`-derived `--accent-soft`/`--accent-line`). Plus the `::selection` rule and `@keyframes gapPulse` + `flow`.
3. **Tailwind** — `darkMode: ['selector', '[data-theme="dark"]']`; map every token into `theme.extend.colors` (e.g. `surface`, `'surface-2'`, `text`, `'text-2'`, `accent`, `gap`, `warn`, `ok`, `'e-service'`…) as `var(--…)`; `fontFamily.sans`/`.mono` → the Geist CSS vars + fallbacks; `boxShadow.DEFAULT`/`.sm` → the shadow vars. Components use these utilities; `color-mix(...)` tints and entity-keyed values that Tailwind can't express use inline `style`/arbitrary values.
4. **Theming mechanism** — `data-theme` (default unset = light) and `data-accent` live on `<html>`. A tiny **no-flash inline script** in `layout.tsx` reads `localStorage` and sets the attributes before paint (`suppressHydrationWarning` on `<html>`). A small client `ThemeProvider`/controls component toggles theme + accent and persists to `localStorage`. Default theme = **light**, default accent = base indigo (`#5b54e6` / dark `#7d76ff`).

## 4. App shell (new shared chrome — used by every route)

The mockup frames each screen as a fixed `1280×760` device card in a gallery. The **real app is full-bleed**: drop the outer card framing; reproduce the *interior* exactly. `app/layout.tsx` renders a global shell:

```
<html data-theme data-accent> <body class="bg-canvas text-text font-sans">
  <div class="flex h-screen">
    <IconRail/>                       ← 60px, global, pathname-driven active state + theme/accent controls pinned bottom
    <main class="flex-1 flex flex-col min-w-0">{children}</main>
  </div>
</body></html>
```

- **`<IconRail>`** (catalog 01 §3, identical across frames): `--sidebar` bg, `border-right --border`, 32px accent **brand logo tile** (3 skewed bars), then 6 nav icon tiles (Upload `/upload`, Pipeline `/`, Graph `/graph/1`, Ask `/ask`, Table `/table`, Doc) — active tile = `--accent-soft` bg + `--accent` stroke, derived from `usePathname()`. Exact SVG paths per catalog. Theme toggle + 3-dot accent picker pinned to the rail bottom (`margin-top:auto`), using the toggle-button + indicator-dot recipe (catalog 00 §6c). The Doc tile is active only on `/doc/*` (no default target; non-navigating indicator).
- **`<TopBar>`** (catalog: every frame's 53px bar): `height:53px`, `border-bottom --border`, `padding:0 20px`, left = breadcrumb `Helios workspace / <Leaf>` (mono-ish 13.5px, leaf weight 600), right = a per-page slot. Each **page** renders its own `<TopBar leaf=… right={…}>` as the first child of `main` (the right content differs per screen: polling status, scope chip, router meta, doc-pill+char-span, filter pill). The breadcrumb root is `Helios workspace` except the doc viewer (`Docs`).
- **`<BrandMark>`** — the 3-skewed-bar logo, sized prop (rail 32 tile / inner 18×16; header 34 variant available).

## 5. Per-screen plan (each maps 1 frame → existing page+component)

Exact recipes live in the matching catalog file; deltas summarized here. **All screens: replace hardcoded Tailwind grays/blues with tokens; adopt Geist/Geist-Mono; honor the radius ramp (3/4/5/6/7/8/9/10/11/13px) and `--shadow`.**

1. **Pipeline / Home `/`** (catalog 02) — `processing-dashboard.tsx` + `page.tsx`. Add: 4 summary count tiles (Ready `--text`, In-flight `--accent`, Off-domain `--warn`, Failed `--gap`) sourced from polled docs; 7-stop mono stage-rail legend; doc-row variants (ready=full `--ok` bar; in-flight=`--accent-line` border + `mix(accent 5%)` + partial accent bar + leading-dot badge; unrouted=dashed + `--surface-2` + `--warn` subtitle + explainer line + neutral outlined badge; failed=red-tinted + retry button + `--gap` badge). Keep the existing 1.5s `/api/status` poll + `progressOf`. **Fold in Frame 07** (catalog 07) as a static two-panel "Off-domain & extensibility" explainer section below the rows (neutral substrate card → accent "lights up" card, register-package arrow).
2. **Upload `/upload`** (catalog 01) — `upload-dropzone.tsx` + `page.tsx`. Two-column grid: left dropzone (58px accent-soft disc, "Drop documents to ingest", browse-files accent link, `.pdf/.docx/.txt` mono chips) + "One connected story" accent callout; right staged-list (rows = entity-colored type badge + mono filename + description + size; off-domain dashed variant) + list header + full-width accent **Ingest N documents →** button. Re-theme drag-over to accent. Keep the existing ingest→process loop behind the button.
3. **Table `/table`** (catalog 06) — `entity-table.tsx` + `page.tsx`. Replace the `<select>` with a 200px **facet rail**: all 9 entity types with `--e-*` dots (Person = circle) + per-type **counts** (fetch via `GET /api/query?type=` per type on mount) + "Coverage flag" checkboxes. CSS-grid table card (mono uppercase `--surface-2` header; name cell mono/600 in the type's `--e-*` color; em-dash empties; dedicated mono `--accent` `source` column with ` · `-joined doc names + `→`). For **Service**, fetch coverage via `POST /api/query {cq:"services_coverage_gaps"}` → render `fully covered` (ok dot) / `no load test` / `no design doc` warn chips; wire the two checkboxes to filter on those flags. Top-bar `Filter entities…` pill drives the global substring filter (collapse the per-column inputs). Footer explainer note.
4. **Ask `/ask`** (catalog 04) — `ask-box.tsx` + `page.tsx`. Input row (46px rounded field + leading magnifier + 46px accent send button) + **grouped CQ chips**: render all 10 CQs under category labels — `gaps` (Q1,Q2), `impact` (Q3,Q9,Q10), `lookup` (Q5,Q8) / `trace` (Q4) / `reconcile` (Q6) / `rationale` (Q7); clicking a chip fills + submits the NL question via `/api/ask`. Answer card: tier badge pill (`template`→`--ok` "GRAPH · template"; `rag`→"RAG"), prose with entity-colored mono spans, **inline path** (mono node chips joined by accent `RELTYPE →`, focal node accent-highlighted) when provenance forms a chain, **contributing-edge cards** (mono edge-type tag + endpoints + `doc.txt →` citation link + italic snippet) from `EdgeRef` provenance, or chunk citations from `ChunkRef`. Right 300px panel: **router ladder** "How this was answered" (Template / Think-on-Graph[dimmed future] / RAG — highlight `result.tier`); **Entity-linking** explainer box (static copy; show matched mention). All rendered from the existing `AskResult {tier, answer, provenance}` — no API change.
5. **Doc `/doc/[id]`** (catalog 05) — `doc-viewer.tsx` + `page.tsx`. Two-pane: left **mono doc panel** (`Geist Mono 12.5px / line-height 1.95`, `--text-2` body, sans-overridden 15px/600 title; `overflow:auto` for full docs, keep scroll-into-view) with **dual highlights** — active span (`?start&end`) = accent 22% + 2px accent underline + 3px accent-soft glow; **passive** entity-typed spans (other citations in this doc) = `--e-*` tint + 1.5px underline, no glow. Right 330px **citation rail**: "This span grounds" active-citation card (edge badge + endpoints + confidence + `located ✓`) + "Other citations in this doc" entity-dot chips + bottom-pinned `← Back to graph`. Top bar: `Docs / <file>` crumb + `char S–E` caption + entity-tinted doc-type pill. **Loader enrichment:** fetch all `attribute_provenance` + active `edges` grounding in this doc to feed passive highlights + the rail (internal; no `/api` change). Graceful when no citations.
6. **Graph `/graph/[systemId]`** (catalog 03 — **centerpiece, highest effort**) — `graph-view.tsx` + `page.tsx`. Page = chrome + scope chip `System: <name> ▾`; data via `getSystemGraph` (enriched with node `fields`). Convert rendering to a **client** component for node selection. Canvas: dot-grid bg + an SVG edge layer (`viewBox 0 0 900 540`, `preserveAspectRatio:none`, 3 arrowhead markers) + absolutely-positioned node chips via a **deterministic radial/ring layout** (System → Features → Requirements → Services → Leaves columns by `left%`, plus Decision/Person satellites; positions computed from the typed node sets so it generalizes beyond Helios). Per-relation edge styling (grey base; **animated `flow` DEPENDS_ON**; cyan VALIDATES; dotted satellite AFFECTS/OWNS). Node chips: `surface` bg, `color-mix(--e-type 45%, --border)` border, type dot, mono labels; gap requirements = red wash + `1.5px --gap` + `gapPulse` + `NO TEST` badge; service warn badges (`NO LOAD TEST`/`NO DESIGN DOC`); selected = `2px --accent` + 4px accent-soft ring. Right 336px **inspector**: Coverage block (counts from flags), **honesty counter** chips (`N active links` = edges.length [ok], `0 below threshold` [active edges are all above threshold], `100% spans located` = edges-with-evidence %), and **selected-node detail** (type, label, field pairs from enriched `fields`, relations derived from edges, `Open evidence in <doc> →`). All inspector data derived client-side from the (enriched) graph payload.

## 6. Testing & verification

- **Offline gates after every task:** `pnpm build`, `pnpm test` (73 unit), `tsc` clean. Reskinned `doc-viewer.tsx` keeps its unit-testable `sliceForHighlight`/`resolveSpan` exports green; if multi-highlight needs new pure helpers, add focused unit tests.
- **Component sanity:** dev-server smoke per screen in light + dark + one alt accent.
- **End-to-end (final task):** verify all flows render live data; exercise **all 10 CQs** two ways — deterministic `POST /api/query {cq, params}` (Q1/Q2 no params; Q3/Q5/Q7/Q8 serviceId; Q4/Q9 featureId; Q6 requirementId; Q10 source+targetId) and the NL `/api/ask` path — each returning rows + provenance; confirm citations deep-link to `/doc/[id]?start&end` and highlight. `pnpm test:integration` (15, offline cassettes) stays green.
- Run the existing offline integration suite against the DB to confirm no data-contract regressions.

## 7. Deploy

After SDD completes and gates pass: merge `feat/frontend-redesign`, push; the GitHub-connected Vercel project (`pd-1795/strata`) auto-builds, or deploy via `vercel --prod`. Verify the live URL renders the new design on all routes with the seeded Helios graph. No new env vars (theming is client-side; data unchanged).

## 8. Task breakdown (for the implementation plan / SDD)

1. Foundation — tokens + keyframes in `globals.css`, Tailwind theme/darkMode, `geist` fonts + `layout.tsx` providers/no-flash. (verify: build + tests green)
2. App shell — `BrandMark`, `IconRail` (nav + theme/accent controls), `TopBar`; wire `layout.tsx`; pages adopt `<TopBar>`. (verify: every route renders shell; active states correct)
3. Pipeline `/` + Frame 07 explainer.
4. Upload `/upload`.
5. Table `/table` (+ facet counts + Q2 coverage via existing POST).
6. Ask `/ask` (CQ chips + answer card + router ladder).
7. Doc `/doc/[id]` (dual highlights + citation rail + loader enrichment).
8. Graph `/graph/[systemId]` (radial canvas + edges + nodes) — may split 8a canvas/edges/nodes, 8b inspector.
9. End-to-end verification (all flows + 10 CQs both paths) → build → deploy to Vercel.

Global constraints for every task: scope guardrails (§2); exact tokens/fonts/recipes from the catalogs; light+dark+accent must all work; no `/api`/CQ/schema changes; surgical diffs.
