# Strata Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin every Strata screen to match `Strata Flow.html` (Geist fonts, CSS-variable token system, light/dark/accent theming, the 7 frame designs) while keeping all flows and all 10 CQs working end-to-end, then deploy to Vercel.

**Architecture:** Drop a CSS-custom-property token system + Geist fonts into `globals.css`/`tailwind.config.ts`/`layout.tsx`; build a global app shell (60px icon rail + 53px top bar) that wraps every route; reskin each page+component to its catalog frame using tokens. No `/api`/CQ/schema changes — only presentation + internal loader enrichment to surface already-computed data.

**Tech Stack:** Next.js 15.5 App Router, React 19, Tailwind 3.4, `geist` font package, TypeScript, Vitest.

## Global Constraints

- **Source of truth:** `.superpowers/design-source/catalog/00..07-*.md` are authoritative for every px value, weight, color token, copy string, and SVG path. Each task names its catalog file — read it first; use its exact values verbatim.
- **Scope (binding):** Do NOT change `/api/*` request/response contracts (`ask`, `query` GET+POST, `ingest`, `process`, `status`), the 10 CQ definitions in `lib/query/templates.ts`, routing in `lib/query/router.ts`, `lib/db/schema.ts`, `lib/pipeline/*`, or `fixtures/labels.json`. MAY change `app/**`, `components/**`, `globals.css`, `tailwind.config.ts`, `package.json` (add `geist`), and enrich internal loaders in `lib/query/graph.ts` (+ a new doc-citations loader) only to surface data the design displays, reusing existing query logic.
- **Theming:** every screen must render correctly in **light (default), dark, and ≥1 alt accent**. Use tokens (`bg-surface`, `text-text-2`, `border-border`, `text-accent`, `text-e-service`, …) — never hardcode hex; `color-mix(...)` tints and entity-keyed colors use inline `style`.
- **Fonts:** Geist sans = body; Geist Mono = identifiers/IDs/badges/counts/table-headers/citation-links/code-meta (per catalogs).
- **Default accent** = base indigo (`#5b54e6` light / `#7d76ff` dark). **Default theme** = light.
- **Radius ramp:** 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 13 px and pill (9999) — use the exact value the catalog gives each element.
- **Quality gates per task:** `pnpm build` succeeds, `pnpm test` (73 unit) stays green, `npx tsc --noEmit` clean. Add focused unit tests for any new **pure logic** (layout math, span slicing, count derivation). Visual fidelity is verified by the reviewer against the catalog.
- **Surgical diffs, frequent commits.** Match existing code style.

---

### Task 1: Design-system foundation (tokens, fonts, Tailwind, layout providers)

**Files:**
- Modify: `app/globals.css` (replace 3-line file)
- Modify: `tailwind.config.ts`
- Modify: `app/layout.tsx`
- Modify: `package.json` (add `geist` dep)

**Catalog:** `00-design-system.md` (§2 fonts, §3 token table, §4 keyframes, §7 theming, §9 reskin mapping).

**Interfaces — Produces (later tasks rely on these):**
- Tailwind color utilities backed by vars: `canvas app surface surface-2 sidebar border border-2 text text-2 text-3 accent accent-soft accent-line gap warn ok cyan e-system e-feature e-req e-service e-datastore e-test e-load e-person e-decision` (e.g. `bg-surface`, `text-text-2`, `border-border-2`, `text-e-service`).
- `font-sans` (Geist) and `font-mono` (Geist Mono); `shadow` / `shadow-sm` box-shadows.
- `dark` variant triggers on `[data-theme="dark"]`; accents via `[data-accent="violet|blue|emerald"]` on `<html>`.
- CSS animations available: `animate-[gapPulse_2.6s_ease-in-out_infinite]`, keyframe `flow` for SVG `stroke-dashoffset`.

- [ ] **Step 1: Add the `geist` font package**

Run: `pnpm add geist`
Expected: `geist` appears in `package.json` dependencies; `pnpm install` succeeds.

- [ ] **Step 2: Replace `app/globals.css`** with the token system + base + keyframes (values verbatim from catalog 00 §3/§4):

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --canvas:#e9ebee; --app:#ffffff; --surface:#ffffff; --surface-2:#f6f7f9; --sidebar:#fafbfc;
  --border:#e7e9ec; --border-2:#d8dbe0;
  --text:#13151a; --text-2:#565d68; --text-3:#8b929d;
  --accent:#5b54e6; --gap:#e5484d; --warn:#e08a1e; --ok:#26a269; --cyan:#0e9bb4;
  --e-system:#647084; --e-feature:#6366f1; --e-req:#0ea5e9; --e-service:#10a576;
  --e-datastore:#e09a1e; --e-test:#0fb3a6; --e-load:#0ca5c4; --e-person:#8b5cf6; --e-decision:#ef5777;
  --shadow:0 1px 2px rgba(20,22,26,.05), 0 10px 30px -12px rgba(20,22,26,.14);
  --shadow-sm:0 1px 2px rgba(20,22,26,.05);
  --accent-soft:color-mix(in srgb, var(--accent) 12%, var(--surface));
  --accent-line:color-mix(in srgb, var(--accent) 30%, var(--surface));
}
[data-theme="dark"] {
  --canvas:#070809; --app:#0c0d11; --surface:#14161b; --surface-2:#191c22; --sidebar:#0f1014;
  --border:#23262d; --border-2:#30343c;
  --text:#edeef2; --text-2:#9aa1ad; --text-3:#646b78;
  --accent:#7d76ff; --gap:#ff6369; --warn:#f0a830; --ok:#3dd68c; --cyan:#2ac6e0;
  --e-system:#8a96aa; --e-feature:#818cf8; --e-req:#38bdf8; --e-service:#34d399;
  --e-datastore:#f0b340; --e-test:#2dd4c4; --e-load:#34cee8; --e-person:#a78bfa; --e-decision:#ff7d97;
  --shadow:0 1px 2px rgba(0,0,0,.35), 0 16px 40px -14px rgba(0,0,0,.6);
  --shadow-sm:0 1px 2px rgba(0,0,0,.4);
  --accent-soft:color-mix(in srgb, var(--accent) 16%, var(--surface));
  --accent-line:color-mix(in srgb, var(--accent) 40%, var(--surface));
}
[data-accent="violet"]{--accent:#7c5cff} [data-theme="dark"][data-accent="violet"]{--accent:#9d86ff}
[data-accent="blue"]{--accent:#2f74e8}  [data-theme="dark"][data-accent="blue"]{--accent:#5b9bff}
[data-accent="emerald"]{--accent:#0fa674} [data-theme="dark"][data-accent="emerald"]{--accent:#34d399}

::selection { background: color-mix(in srgb, var(--accent) 30%, transparent); }

@keyframes gapPulse {
  0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--gap) 38%, transparent); }
  50%     { box-shadow: 0 0 0 5px color-mix(in srgb, var(--gap) 0%, transparent); }
}
@keyframes flow { to { stroke-dashoffset: -12; } }
```

- [ ] **Step 3: Rewrite `tailwind.config.ts`** to map tokens + fonts + shadows + dark selector:

```ts
import type { Config } from "tailwindcss";

const v = (n: string) => `var(--${n})`;
const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"), app: v("app"), surface: v("surface"), "surface-2": v("surface-2"),
        sidebar: v("sidebar"), border: v("border"), "border-2": v("border-2"),
        text: v("text"), "text-2": v("text-2"), "text-3": v("text-3"),
        accent: v("accent"), "accent-soft": v("accent-soft"), "accent-line": v("accent-line"),
        gap: v("gap"), warn: v("warn"), ok: v("ok"), cyan: v("cyan"),
        "e-system": v("e-system"), "e-feature": v("e-feature"), "e-req": v("e-req"),
        "e-service": v("e-service"), "e-datastore": v("e-datastore"), "e-test": v("e-test"),
        "e-load": v("e-load"), "e-person": v("e-person"), "e-decision": v("e-decision"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Geist", "-apple-system", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "Geist Mono", "monospace"],
      },
      boxShadow: { DEFAULT: v("shadow"), sm: v("shadow-sm") },
    },
  },
  plugins: [],
};
export default config;
```

> Note: Tailwind `border-border` works because we mapped a `border` color; existing `border-gray-*` classes in not-yet-reskinned files keep working until their task replaces them.

- [ ] **Step 4: Rewrite `app/layout.tsx`** — fonts, theme attributes, no-flash script:

```tsx
import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Strata",
  description: "Documents → queryable knowledge graph, every answer cited to source",
};

const noFlash = `(function(){try{var t=localStorage.getItem('strata-theme');var a=localStorage.getItem('strata-accent');var e=document.documentElement;if(t==='dark')e.setAttribute('data-theme','dark');if(a)e.setAttribute('data-accent',a);}catch(_){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: noFlash }} /></head>
      <body className="bg-canvas text-text font-sans antialiased">{children}</body>
    </html>
  );
}
```

> The global shell (rail + main) is added in Task 2; for now `body` just renders children so existing pages keep working.

- [ ] **Step 5: Verify build + tests + types green**

Run: `pnpm build && pnpm test && npx tsc --noEmit`
Expected: build succeeds (Geist fonts resolve, no CSS errors), 73 unit tests pass, tsc clean. Existing pages render unstyled-but-working (they still use gray-* classes).

- [ ] **Step 6: Manual theme check** — temporarily set `data-theme="dark"` on `<html>` in devtools on `/`; confirm `--canvas`/`--text` flip (page bg darkens). Revert.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css tailwind.config.ts app/layout.tsx package.json pnpm-lock.yaml
git commit -m "feat(ui): design-token system, Geist fonts, light/dark/accent theming foundation"
```

---

### Task 2: App shell — brand mark, icon rail, top bar, theme controls

**Files:**
- Create: `components/shell/brand-mark.tsx`
- Create: `components/shell/icon-rail.tsx` (client)
- Create: `components/shell/top-bar.tsx`
- Create: `components/shell/theme-controls.tsx` (client)
- Modify: `app/layout.tsx` (wrap children in the shell)

**Catalog:** `00-design-system.md` §6 (brand mark, theme toggle/dot), `01-upload.md` §3 (rail recipe + all 6 SVG icon paths) and §4a (top bar/breadcrumb). The 6 rail icon SVG paths are identical across frames — copy verbatim from catalog 01 §3b/§8.

**Interfaces — Produces:**
- `BrandMark({ size }: { size?: "rail" | "header" })` — the 3-skewed-bar logo (rail tile = 32px accent tile w/ white bars; header = 34px accent-ramp bars).
- `IconRail()` — full 60px rail (brand + 6 nav tiles + theme controls), determines active tile from `usePathname()`.
- `TopBar({ leaf, root, right }: { leaf: string; root?: string; right?: React.ReactNode })` — 53px breadcrumb bar; `root` defaults to `"Helios workspace"`. Each page renders this as the first child of `<main>`.
- `ThemeControls()` — light/dark toggle button + 3 accent dots; persists to `localStorage` (`strata-theme`, `strata-accent`) and sets `<html>` `data-theme`/`data-accent`.
- Nav model: `[{ key:"upload", href:"/upload" }, { key:"pipeline", href:"/" }, { key:"graph", href:"/graph/1" }, { key:"ask", href:"/ask" }, { key:"table", href:"/table" }, { key:"doc", href:null }]`. Active match: pipeline↔`/`, others by pathname prefix; doc active on `/doc`.

- [ ] **Step 1: `brand-mark.tsx`** — render the relative box with 3 absolutely-positioned `skewX(-18deg)` bars. Rail variant: 32×32 `bg-accent rounded-lg`, inner 18×16, bars `bg-white` at opacity .55/.78/1 (tops 1/6/11px). Header variant per catalog 00 §6b (34×34, bars `color-mix(accent 35/62/100%, canvas)`, tops 4/13/22px, width 30 height 9 radius 3). Use inline `style` for skew + color-mix.

- [ ] **Step 2: `theme-controls.tsx`** (client) — read current theme/accent from `document.documentElement` on mount; a toggle button (recipe: catalog 00 §6c — `h-[38px] px-[14px] rounded-[9px] border border-border-2 bg-surface text-[13px]` + leading 9px accent dot with `box-shadow:0 0 0 3px var(--accent-soft)`) flips `data-theme` and writes `localStorage`; three accent dots (`violet/blue/emerald` + a default) set `data-accent`. Lay out compactly for the rail bottom.

- [ ] **Step 3: `icon-rail.tsx`** (client, `"use client"`) — container `w-[60px] flex-none bg-sidebar border-r border-border flex flex-col items-center py-[14px] gap-[5px]`. Top: `<BrandMark size="rail"/>` (`mb-[10px]`). Then 6 nav tiles: each `Link` (or `div` for doc) `w-10 h-10 rounded-[10px] flex items-center justify-center`; active → `bg-accent-soft text-accent`, idle → `text-text-3`; inner 20×20 SVG (`viewBox 0 0 24 24 fill-none stroke-current stroke-[1.7]`) with the catalog path for that key. Active from `usePathname()`. Push `<ThemeControls/>` to the bottom with `mt-auto`.

- [ ] **Step 4: `top-bar.tsx`** — `h-[53px] flex-none border-b border-border flex items-center justify-between px-5`. Left: breadcrumb `flex items-center gap-2 text-[13.5px]` → `<span class="text-text-3">{root}</span><span class="text-text-3">/</span><span class="font-semibold">{leaf}</span>`. Right: `{right}`.

- [ ] **Step 5: Wrap shell in `layout.tsx`** — change `<body>` content to:

```tsx
<body className="bg-canvas text-text font-sans antialiased">
  <div className="flex h-screen overflow-hidden">
    <IconRail />
    <main className="flex flex-1 flex-col min-w-0">{children}</main>
  </div>
</body>
```
Import `IconRail`. (Pages will add their own `<TopBar>` + scrollable content in their tasks; until then existing pages render to the right of the rail.)

- [ ] **Step 6: Verify** — `pnpm build && npx tsc --noEmit`; `pnpm dev`, visit `/`, `/ask`, `/table`, `/upload`, `/graph/1`: rail shows on every route, the correct tile is active per route, theme toggle flips light/dark and persists across reload, accent dots change `--accent`. `pnpm test` green.

- [ ] **Step 7: Commit**

```bash
git add components/shell app/layout.tsx
git commit -m "feat(ui): global app shell — brand mark, icon rail, top bar, theme controls"
```

---

### Task 3: Pipeline / Home dashboard (`/`) + off-domain explainer

**Files:**
- Modify: `app/page.tsx`
- Modify: `components/processing-dashboard.tsx`
- Create: `components/extensibility-panel.tsx` (Frame 07 explainer)

**Catalog:** `02-pipeline.md` (summary tiles, stage legend, all 4 doc-row variants, badge recipes) + `07-offdomain.md` (the two-panel explainer).

**Interfaces — Consumes:** `TopBar`, tokens, fonts. Keeps the existing `/api/status` poll (1.5s) and `progressOf(status)` logic in `processing-dashboard.tsx`.

- [ ] **Step 1:** In `processing-dashboard.tsx`, keep the data/poll logic; rebuild the render. Add a **summary tiles** row (4 tiles, counts derived from the polled `docs`: ready / in-flight[non-terminal, non-ready] / off-domain[`unrouted`] / failed) per catalog §3 (24px/700 counts colored `--text`/`--accent`/`--warn`/`--gap`). Add the **7-stop stage legend** (`ingest classify index extract resolve link` flex-1 + `ready` 64px right marker), mono 10px `text-text-3` (catalog §4).
- [ ] **Step 2:** Rebuild doc rows with the 4 variants (catalog §5a–d): ready (border `--border`, full `--ok` bar), in-flight (`--accent-line` border, `mix(accent 5%)` bg, partial accent bar `width:progressOf%`, leading-dot `extracting`-style badge showing current status), unrouted (dashed `--border-2`, `--surface-2`, `--warn` subtitle, explainer line, neutral outlined badge), failed (red-tinted, retry button, `--gap` badge). Badge recipe: mono 10.5px/600 `rounded-[20px] px-[9px] py-[3px]` with the per-state fg/bg-mix from catalog §6. Keep `StatusBadge`/`ProgressBar` helper structure but retoken.
- [ ] **Step 3:** Create `extensibility-panel.tsx` — static two-panel explainer (neutral substrate card with green-✓/grey-× capability rows → accent transition arrow `register package` → accent "lights up" card with entity chips `Candidate Role Skill Company` + dashed relation chips `HAS_SKILL → WORKED_AT →` + `// lib/packages/hiring.ts — future work`), copy verbatim from catalog 07 §3–§5.
- [ ] **Step 4:** Rebuild `app/page.tsx`: `<TopBar leaf="Pipeline" right={<polling-status/>}/>` (green `--ok` dot + mono `polling /api/status · 1.5s`) over a scrollable content area (`flex-1 overflow-auto p-[24px_28px]`) containing `<ProcessingDashboard/>` then `<ExtensibilityPanel/>`. Remove the old centered `max-w-2xl` header/nav links (nav now lives in the rail).
- [ ] **Step 5: Verify** — `pnpm build && pnpm test && npx tsc --noEmit`; `pnpm dev` `/`: tiles + legend + 4 row variants render against live `/api/status` (seeded Helios docs), explainer panel shows; light+dark+one accent all correct.
- [ ] **Step 6: Commit** `feat(ui): reskin pipeline dashboard + off-domain extensibility panel`

---

### Task 4: Upload (`/upload`)

**Files:**
- Modify: `app/upload/page.tsx`
- Modify: `components/upload-dropzone.tsx`

**Catalog:** `01-upload.md` (two-column grid, dropzone, callout, staged file-row template incl. off-domain variant, ingest button).

**Interfaces — Consumes:** `TopBar`, tokens. Keep the existing ingest (`POST /api/ingest`) → process-loop (`POST /api/process`) behavior; the design adds an explicit **Ingest N documents** button that triggers the loop (move auto-on-drop behind the button).

- [ ] **Step 1:** `app/upload/page.tsx`: `<TopBar leaf="Upload" right={<mono "single workspace · no auth (v1)"/>}/>` over a `flex-1 overflow-auto p-[26px_30px]` body holding a `grid grid-cols-2 gap-6 h-full`.
- [ ] **Step 2:** `upload-dropzone.tsx` left column: dropzone (`flex-1 rounded-[14px] border-2 border-dashed border-border-2 bg-surface-2` + 58px `bg-accent-soft text-accent rounded-[15px]` upload disc + 16px/600 "Drop documents to ingest" + 13px subtext with accent "browse files" + three mono `.pdf/.docx/.txt` chips), drag-over → accent border + `mix(accent 7%)` bg. Below it the "One connected story." accent callout (catalog §5b). Right column: list header (`Staged — N files` + mono `~size · Helios bundle`), the staged file rows (each = entity-colored type badge + mono filename + `--text-3` description + mono size; off-domain row = dashed + `--surface-2` + neutral "?" badge + `--warn` description), and the full-width accent **Ingest N documents →** button that runs the existing process loop.
- [ ] **Step 3:** Map a doc's badge label/color: derive from filename/type where available, else neutral "?" off-domain variant (catalog §6b table). Keep per-file status updates during processing (reuse existing `FileState`), shown on the rows.
- [ ] **Step 4: Verify** — build/test/tsc green; `pnpm dev` `/upload`: drag a `.txt`, see it staged with badge + size, click Ingest, rows advance through statuses; off-domain styling for a non-domain file; light+dark+accent correct.
- [ ] **Step 5: Commit** `feat(ui): reskin upload — dropzone, staged list, ingest button`

---

### Task 5: Entity table (`/table`)

**Files:**
- Modify: `app/table/page.tsx`
- Modify: `components/entity-table.tsx`

**Catalog:** `06-table.md` (facet rail, coverage checkboxes, grid table, coverage chips, source column, footer note).

**Interfaces — Consumes:** `TopBar`, tokens. Existing `GET /api/query?type=` for rows + provenance; for facet **counts** call `GET /api/query?type=` per type once on mount; for the Service **coverage** column call `POST /api/query {cq:"services_coverage_gaps"}` (existing contract → `{rows:[{id,noDesignDoc,noLoadTest}]}`).

- [ ] **Step 1:** `app/table/page.tsx`: `<TopBar leaf="Entities" right={<filter-pill "Filter entities…"/>}/>` over a `flex-1 flex min-h-0` body = 200px facet rail + flex-1 table panel. The filter pill is the global substring filter input (lift filter state into the page or keep in the client component).
- [ ] **Step 2:** `entity-table.tsx` facet rail (replace the `<select>`): vertical list of all 9 `ENTITY_TYPES` each with a `--e-*` dot (Person = circle), label, and mono count; selected type = `bg-accent-soft border border-accent-line text-accent`. Build an entity→`--e-*` token map. Fetch counts for all 9 types on mount (9 parallel `GET /api/query?type=`), show in the facet rows. Add the "Coverage flag" section with `No design doc` / `No load test` checkboxes.
- [ ] **Step 3:** Table = CSS grid card (`border border-border rounded-[11px] overflow-hidden bg-surface`), header row `bg-surface-2` mono 10px uppercase `text-text-3`; data rows `grid` with the type's columns. Name cell mono/600 in the type `--e-*` color; empty cells em-dash `text-text-3`; a dedicated mono `text-accent` **source** column listing ` · `-joined source doc short-names + `→`, linking to `/doc/{documentId}?start&end` via the existing field provenance. Keep client substring filtering (driven by the top-bar pill).
- [ ] **Step 4:** For `type === "Service"`: fetch `POST /api/query {cq:"services_coverage_gaps"}`, render a **coverage** column — `fully covered` (`--ok` dot) when no flags, else `no design doc` / `no load test` warn chips (`color-mix(warn 14%,surface)` bg). Wire the two checkboxes to filter services by those flags. Add the footer explainer note (catalog §8).
- [ ] **Step 5: Verify** — build/test/tsc green; `pnpm dev` `/table`: 9 facets with real counts, default `Service` selected; switching type reloads rows; Service shows coverage chips matching Q2 (`payment-service` → both gaps); source cells deep-link to the doc viewer; checkboxes filter; light+dark+accent correct.
- [ ] **Step 6: Commit** `feat(ui): reskin entity table — facet rail, coverage chips, source column`

---

### Task 6: Ask (`/ask`)

**Files:**
- Modify: `app/ask/page.tsx`
- Modify: `components/ask-box.tsx`

**Catalog:** `04-ask.md` (input, grouped CQ chips, answer card incl. tier badge / entity prose / inline path / contributing-edge cards, right panel router ladder + entity-linking box).

**Interfaces — Consumes:** `TopBar`, tokens, the 10 CQs from `SOFTWARE_PACKAGE.competencyQuestions`, the existing `POST /api/ask` → `{tier:"template"|"rag", answer, provenance: EdgeRef[]|ChunkRef[]}`. No API change.

- [ ] **Step 1:** `app/ask/page.tsx`: `<TopBar leaf="Ask" right={<mono "router: template · ToG · rag"/>}/>` over a `flex-1 flex min-h-0` body = flex-1 conversation column + 300px right panel.
- [ ] **Step 2:** `ask-box.tsx` input row: 46px field (`rounded-[11px] border border-border-2 bg-surface shadow-sm` + leading magnifier) + 46px accent send button (catalog §3a). Keep existing submit→`/api/ask` logic.
- [ ] **Step 3:** **Grouped CQ chips** (catalog §3b): render all 10 CQs (`SOFTWARE_PACKAGE.competencyQuestions`) under category labels — `gaps`(Q1,Q2) `--gap`, `impact`(Q3,Q9,Q10) `--accent`, `lookup`(Q5,Q8)/`trace`(Q4)/`reconcile`(Q6)/`rationale`(Q7) `--e-service`. Each chip = catalog default/selected recipe; clicking fills the input with that CQ's `question` and submits. (Use the 6 verbatim example strings from catalog §3b where they map; otherwise the CQ `question` text.)
- [ ] **Step 4:** **Answer card** (catalog §3c): tier badge pill (`result.tier==="template"` → `--ok` "GRAPH · template"; `"rag"` → cyan/accent "RAG"), with method meta + citation count. Prose renders `result.answer` (entity-name spans styled mono — best-effort highlight of service names found in provenance). When provenance is `EdgeRef[]`: render **contributing-edge cards** (mono edge-type tag `RELTYPE · KIND` + `source → target` + `doc.txt →` citation link to `/doc/{evidenceDocumentId}?start&end` + italic `snippet`); if the edges form a single chain, also render the **inline path** (mono node chips + accent `RELTYPE →`, focal node accent-highlighted). When provenance is `ChunkRef[]`: render chunk citation cards (doc # / page / snippet / link). Detect tier by provenance shape + `result.tier`.
- [ ] **Step 5:** **Right panel** (catalog §4): the 3-tier router ladder "How this was answered" — rows Template / Think-on-Graph / RAG; highlight the row matching `result.tier` (`template`→Template, `rag`→RAG), dim the others `opacity-60` (Think-on-Graph always dimmed = future). Below it the "Entity linking" explainer box (static copy from catalog §4b; if the question/result exposes a resolved mention, show it as the top candidate). Panels render only after a result exists.
- [ ] **Step 6: Verify** — build/test/tsc green; `pnpm dev` `/ask`: click each CQ chip → an answer renders with the right tier badge; an impact question (e.g. "What breaks if token-service changes?") shows contributing-edge cards + (when chained) inline path; citation links open `/doc/...` highlighted; router ladder highlights the active tier; light+dark+accent correct.
- [ ] **Step 7: Commit** `feat(ui): reskin ask — CQ chips, tiered answer card, router ladder`

---

### Task 7: Doc viewer (`/doc/[id]`) — dual highlights + citation rail

**Files:**
- Modify: `app/doc/[id]/page.tsx`
- Modify: `components/doc-viewer.tsx`
- Create: `lib/query/doc-citations.ts` (internal loader)
- Test: `test/doc-citations.test.ts` (pure-helper test) / extend `test/` for multi-highlight slicing

**Catalog:** `05-doc.md` (mono doc panel, active vs passive highlight recipes, citation rail).

**Interfaces — Produces:** `getDocCitations(documentId): Promise<DocCitation[]>` where `DocCitation = { kind:"attr"|"edge"; label:string; relationOrField:string; entityType:GraphNodeType|string; charStart:number; charEnd:number; snippet:string|null; endpoints?:string }` — built from `attribute_provenance` (field spans) + active `edges` (evidence spans) where the doc is the source/evidence. **Internal only — no `/api` change.**

- [ ] **Step 1:** Create `lib/query/doc-citations.ts`: query `attribute_provenance WHERE document_id = $id` and `edges WHERE active AND evidence_document_id = $id`, map to `DocCitation[]` (entityType drives the `--e-*` color; relation/field is the label; snippet+span for highlight). Reuse `rawSql`.
- [ ] **Step 2:** Add a pure helper `buildHighlights(rawText, spans, activeSpan)` in `lib/doc/highlight.ts` that returns ordered, non-overlapping segments `{text, tier:"active"|"passive"|"none", entityType?}` for rendering. **TDD:** write `test/doc-highlight.test.ts` first — assert overlapping/adjacent spans split correctly, the active span (matching `?start&end`) gets `tier:"active"`, others `tier:"passive"` with their entityType, plain text `tier:"none"`. Run → fail → implement → pass.
- [ ] **Step 3:** `app/doc/[id]/page.tsx`: keep doc fetch + `resolveSpan`; also call `getDocCitations(docId)`. Replace the centered layout with `<TopBar root="Docs" leaf={doc.filename} right={<char-span + doc-type pill>}/>` over a `flex-1 flex min-h-0` body = flex-1 mono doc panel + 330px citation rail. Pass `rawText`, the active span, and `citations` to `DocViewer`.
- [ ] **Step 4:** `doc-viewer.tsx`: render the doc panel with `font-mono text-[12.5px] leading-[1.95] text-text-2` (sans-override the title), using `buildHighlights` to emit active spans (accent 22% bg + 2px accent underline + 3px accent-soft glow) and passive entity-typed spans (`--e-*` tint + 1.5px underline, no glow). Keep scroll-into-view for the active span; panel `overflow-auto`. Build the citation rail: "This span grounds" active card (edge badge + endpoints + confidence + `located ✓`) + "Other citations in this doc" entity-dot chips (each links to `/doc/{id}?start&end`) + bottom `← Back to graph` (`/graph/1`). Graceful empty state when no citations.
- [ ] **Step 5: Verify** — build/test/tsc green (new highlight tests pass); `pnpm dev`: open a `/doc/{id}?start&end` link from the table/ask — active span glows accent, other citations underline in entity colors, rail lists them and each re-navigates the highlight; light+dark+accent correct.
- [ ] **Step 6: Commit** `feat(ui): reskin doc viewer — dual highlights, citation rail, doc-citations loader`

---

### Task 8: Graph (`/graph/[systemId]`) — radial canvas + inspector

**Files:**
- Modify: `lib/query/graph.ts` (enrich `getSystemGraph` nodes with `fields`)
- Modify: `app/graph/[systemId]/page.tsx`
- Modify: `components/graph-view.tsx` (→ client; canvas + edges + nodes)
- Create: `components/graph-inspector.tsx`
- Create: `lib/graph/layout.ts` (deterministic radial positions)
- Test: `test/graph-layout.test.ts`

**Catalog:** `03-graph.md` (the whole frame — canvas coords, every edge style, node recipes per type, gap/selected states, inspector).

**Interfaces — Produces/Consumes:**
- `getSystemGraph` gains per-node `fields?: Record<string,string>` (from `SELECT *` on the typed tables it already queries; map snake→camel). `GraphNode` type extended.
- `layoutGraph(nodes): Map<nodeKey, {x:number,y:number}>` (nodeKey = `${type}#${id}`) — System ring (left) → Feature → Requirement → Service → Leaf columns by `left%`, Decision/Person satellites; deterministic vertical distribution within each ring. Pure → testable.

- [ ] **Step 1:** Enrich `getSystemGraph`: change the per-layer `SELECT id,label` to `SELECT *`, attach remaining columns as `fields` (camelCase, skip `id/package_id`) on each `GraphNode`. Extend the `GraphNode` type with `fields?`. Verify `pnpm test:integration`-covered behavior unaffected (the page consumes more, the shape is additive).
- [ ] **Step 2:** Create `lib/graph/layout.ts` with `layoutGraph`. **TDD:** `test/graph-layout.test.ts` first — assert System gets the leftmost column, each entity ring gets its column `left%` (per catalog §4.2: System 8.9, Feature 24.4, Req 41.7, Service 61.1, Leaf 84.4), multiple nodes in a ring spread vertically without overlap, Decision/Person placed as satellites, output is deterministic for a given input. Run → fail → implement → pass.
- [ ] **Step 3:** `app/graph/[systemId]/page.tsx`: keep the `getSystemGraph` fetch + invalid-id handling; render `<TopBar leaf="Graph" right={<scope-chip "System: {name} ▾">}/>` over a `flex-1 flex min-h-0` body = flex-1 canvas + 336px inspector. Pass the (enriched) graph to a **client** `GraphView`.
- [ ] **Step 4:** `graph-view.tsx` (`"use client"`): dot-grid canvas (`radial-gradient` per catalog §4) holding an absolutely-positioned SVG (`viewBox 0 0 900 540 preserveAspectRatio:none`) with the 3 arrowhead markers + per-relation `<line>` groups (grey base for PART_OF/SPECIFIES/IMPLEMENTS/USES/VERIFIES; `stroke-accent` dashed **animated `flow`** DEPENDS_ON; cyan VALIDATES; dotted satellites), endpoints from `layoutGraph` positions (convert % to viewBox units). Node chips absolutely positioned via `layoutGraph` (%): `bg-surface`, border `color-mix(--e-type 45%, --border)`, type dot, mono labels; gap requirements (`flags.noTest`) → red wash + `1.5px --gap` + `gapPulse` + `NO TEST` badge; service `flags.noLoadTest`/`noDesignDoc` → warn badges; click selects a node (local state) → `2px --accent` + 4px accent-soft ring, lifts selection to the inspector.
- [ ] **Step 5:** `graph-inspector.tsx`: Coverage block (counts from node flags: reqs noTest / services noLoadTest / services noDesignDoc), **honesty counter** chips (`{edges.length} active links` ok; `0 below threshold`; `{round(edgesWithEvidence/edges*100)}% spans located`), and selected-node detail (type, label, field pairs from `node.fields`, relations derived from `edges` touching the node with direction arrows, `Open evidence in {doc} →` linking to `/doc/{evidenceDocumentId}?start&end`). Default (no selection) shows the system summary.
- [ ] **Step 6: Verify** — build/test/tsc green (layout tests pass); `pnpm dev` `/graph/1`: the Helios star renders — System→Features→Requirements→Services→leaves with satellites; gap requirements pulse red with NO TEST; payment/token services show warn badges; DEPENDS_ON edges march; clicking `auth-service` selects it (accent ring) and the inspector shows Language/Owner + relations + evidence link; coverage + honesty counts match the seeded data; light+dark+accent correct.
- [ ] **Step 7: Commit** `feat(ui): reskin graph — radial canvas, typed edges, inspector + honesty counter`

---

### Task 9: End-to-end verification + Vercel deploy

**Files:** none (verification + deploy); fixes land in the relevant component file if a flow breaks.

- [ ] **Step 1: Full offline gates** — `pnpm build`, `pnpm test` (73), `npx tsc --noEmit`, and `pnpm test:integration` (15, offline cassettes against the local DB). All green.
- [ ] **Step 2: All-flows smoke (`pnpm dev`, light + dark + one accent):** dashboard tiles/legend/rows; upload→ingest→status; table facets→coverage→source→doc highlight; ask each CQ chip→answer→citation→doc; graph→select node→inspector→evidence→doc; theme/accent persistence across reloads on every route; active rail tile per route.
- [ ] **Step 3: All 10 CQs, both paths.** Deterministic — `POST /api/query` for each: `requirements_without_test`{} , `services_coverage_gaps`{} , `service_blast_radius`{serviceId} , `feature_chain`{featureId} , `service_datastore`{serviceId} , `loadtest_vs_target`{requirementId} , `service_decisions`{serviceId} , `service_owner`{serviceId} , `feature_blast_radius`{featureId} , `dependency_path`{sourceId,targetId} → each returns `{rows,provenance}`. NL — `POST /api/ask` with a representative question per CQ routes and answers. Record results.
- [ ] **Step 4: Finish the branch** — use `superpowers:finishing-a-development-branch` (tests verified) → merge `feat/frontend-redesign` to `main`, push.
- [ ] **Step 5: Deploy** — the GitHub-connected Vercel project (`pd-1795/strata`) auto-builds on push, or run `vercel --prod`. No new env vars.
- [ ] **Step 6: Verify live** — load the production URL; confirm every route renders the new design with the seeded Helios graph; spot-check `/graph/1`, an `/api/ask` answer, a `/doc` highlight live. Append a deploy note to `.superpowers/sdd/progress.md`.

---

## Self-Review

**Spec coverage:** §3 foundation→Task 1; §4 shell→Task 2; §5.1 pipeline+§5(frame07)→Task 3; §5.2 upload→Task 4; §5.3 table (+counts/coverage via existing POST)→Task 5; §5.4 ask→Task 6; §5.5 doc (+loader enrichment)→Task 7; §5.6 graph (+node fields)→Task 8; §6 verification + §7 deploy→Task 9. All scope guardrails (§2) restated in Global Constraints. No gaps.

**Placeholder scan:** Foundation code (tokens, Tailwind, layout) is complete and literal; screen tasks reference their authoritative catalog file for exhaustive px/copy recipes (a named file, not a "TBD") plus concrete structure/interfaces — consistent with the SDD task-brief handoff. Pure-logic tasks (graph layout, doc highlights) are TDD with explicit assertions.

**Type consistency:** `GraphNode.fields?` defined in Task 8 Step 1 and consumed in Step 5; `layoutGraph` signature consistent Steps 2/4; `getDocCitations`/`DocCitation` defined and consumed in Task 7; `TopBar({root?,leaf,right})` defined Task 2, used Tasks 3–8; nav `href:"/graph/1"` consistent with the Graph route. CQ template ids match `SOFTWARE_PACKAGE` exactly.
