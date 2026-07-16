# Blueprint Canvas UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read-only viewer for published blueprints: 4 worker GET endpoints (latest, graph, page detail, export html/csv) + SPA canvas at `/blueprint/:projectId` (React Flow map, table, detail sheet, export menu).

**Architecture:** Shared SQL loaders in `db/blueprint-reads.ts` feed both the JSON endpoints and a pure HTML report renderer, so export can never drift from the UI. SPA follows the copied-contracts convention (local type mirrors), React Query for data, one new dependency (`@xyflow/react`).

**Tech Stack:** Cloudflare Worker (D1, regex router, envelope helpers), React 18 + Vite + TS + Tailwind + shadcn, @tanstack/react-query, @xyflow/react.

Spec: `docs/superpowers/specs/2026-07-16-blueprint-canvas-ui-design.md`. Reference mock: `blueprint-v1-developer-handoff/assets/blueprint-canvas-reference.png`.

## Global Constraints

- Branch `feat/blueprint-canvas-ui` in worktree `/private/tmp/claude-501/-Users-nicolasgorrono-Desktop-DataWise-V2/db07101a-6e9c-405e-bb75-1e05bff9f48f/scratchpad/wt-phase4`. Worker root: `datawise-seo-insight-main/workers`. SPA root: `datawise-seo-insight-main`.
- READ-ONLY wave: no D1 writes, no schema changes, no provider calls, no mutations. Revision 1 only.
- Never use em dashes in any copy, title, or comment.
- Stage only named files (`git add <paths>`), never `git add .`/`-A`. No amend, no force-push.
- Blueprint boundary: all worker code stays under `src/blueprint/`; run `node scripts/check-blueprint-boundary.mjs` from `datawise-seo-insight-main` in every task gate.
- Worker gate per task: `npx vitest run` (all green), `npx tsc --noEmit` (clean), boundary script.
- SPA gate (tasks 7-12): `npx tsc --noEmit` clean, SPA `npx vitest run` green, and in task 12 `npm run deploy:pages:check`.
- Every SELECT feeding output has a total ORDER BY. All HTML output fields are escaped.
- 404 convention: missing, cross-tenant, and unpublished resources all throw `NotFoundError` (plain `{"error":"Not Found"}` body), never a 500, never a distinguishable error.
- Brand: forest green `#005232` accents; existing Tailwind/shadcn tokens; copy in plain English.

---

### Task 1: Read loaders: latest version + graph rows (`db/blueprint-reads.ts`)

**Files:**
- Create: `workers/src/blueprint/db/blueprint-reads.ts`
- Test: `workers/src/blueprint/db/blueprint-reads.test.ts`

**Interfaces:**
- Consumes: `createTestDb()` from `../test-support/d1` (returns `{ d1, raw }`), `NotFoundError` from `../domain/api-errors`, schema tables `blueprint_versions`, `blueprint_revisions`, `blueprint_pages`, `keyword_clusters`, `cluster_keywords`, `keywords`, `projects`.
- Produces (later tasks rely on these exact exports):
  ```ts
  export interface BlueprintLatestView {
    versionId: string; versionNumber: number; status: string;
    schemaVersion: string; rulesetVersion: string; completeness: string;
    partialReasons: string[]; summary: Record<string, unknown>;
    publishedAt: string | null;
    revision: { id: string; revisionNumber: number; revisionHash: string };
  }
  export interface BlueprintGraphNode {
    logicalPageId: string; parentLogicalPageId: string | null;
    pageType: string; title: string; slug: string;
    primaryKeyword: string | null; primaryVolume: number | null; primaryIntent: string | null;
    recommendation: string; approval: string;
    priority: string | null; confidenceLabel: string | null;
    supportingKeywordCount: number;
  }
  export async function loadLatestBlueprint(d1: D1Database, actor: Actor, projectId: string): Promise<BlueprintLatestView>; // throws NotFoundError
  export async function loadRevisionOwned(d1: D1Database, actor: Actor, revisionId: string): Promise<{ revisionId: string; versionId: string; projectId: string; runId: string }>; // throws NotFoundError
  export async function loadGraph(d1: D1Database, revisionId: string, runId: string): Promise<BlueprintGraphNode[]>;
  ```

**Implementation notes (read before coding):**
- Ownership: join up to `projects.organization_id` and compare with `actor.organizationId`; also require `projects.deleted_at IS NULL`. Any miss throws `NotFoundError` (same behavior as `assertRunAccess` in `db/access.ts`; read that function first and mirror it).
- `loadLatestBlueprint`: latest published version = `SELECT ... FROM blueprint_versions bv JOIN projects p ON p.id = bv.project_id WHERE bv.project_id = ? AND p.organization_id = ? AND p.deleted_at IS NULL AND bv.status = 'published' ORDER BY bv.version_number DESC LIMIT 1`; latest revision = `SELECT ... FROM blueprint_revisions WHERE blueprint_version_id = ? ORDER BY revision_number DESC LIMIT 1`. If either row is missing throw `NotFoundError`. Parse `partial_reasons_json` and `summary_json` with a try/catch that falls back to `[]`/`{}`.
- `loadGraph`: primary keyword metrics come through the page's cluster. `blueprint_pages.page_json` holds `clusterIds: string[]`; the primary cluster is `clusterIds[0]`. Do it in two queries (no JSON join in SQL): (1) `SELECT row_id, logical_page_id, parent_logical_page_id, page_type, title, slug, primary_keyword_normalized, recommendation, approval, priority, confidence_label, page_json FROM blueprint_pages WHERE blueprint_revision_id = ? ORDER BY logical_page_id ASC`; (2) for the union of first-cluster ids, `SELECT kc.id AS cluster_id, k.display_keyword, k.search_volume, k.main_intent, (SELECT COUNT(*) FROM cluster_keywords ck2 WHERE ck2.cluster_id = kc.id) AS member_count FROM keyword_clusters kc LEFT JOIN keywords k ON k.id = kc.primary_keyword_id WHERE kc.run_id = ? AND kc.id IN (<placeholders>) ORDER BY kc.id ASC` (chunk the IN list at 90 ids to respect the 100-bound-param ceiling; reuse `chunk` from `db/batch.ts`). Pages with no cluster (skeleton pages like contact) get null keyword fields and `supportingKeywordCount` 0.
- `primaryKeyword` in the view is `display_keyword ?? primary_keyword_normalized`.

- [ ] **Step 1: Write failing tests.** In `blueprint-reads.test.ts`, seed via `createTestDb()`: one project (org `org_a`), a second project in `org_b`; a published `blueprint_versions` row + revision 1 + 3 `blueprint_pages` rows (home with null parent and no clusters in page_json; one service page whose `page_json` is `{"clusterIds":["kcl_1"]}`; one child of the service page); a `keyword_clusters` row `kcl_1` with `primary_keyword_id='kw_1'` and 3 `cluster_keywords` rows; a `keywords` row `kw_1` (`display_keyword 'drain cleaning'`, `search_volume 90500`, `main_intent 'commercial'`). Insert the `research_runs`+`projects` parents first (copy the seeding helper pattern from `orchestration/clustering-handlers.test.ts` `seedRun`). Tests:
  ```ts
  it('loadLatestBlueprint returns version + latest revision', async () => { /* assert versionId, revision.revisionNumber === 1, partialReasons parsed */ });
  it('loadLatestBlueprint throws NotFoundError for a project with no published version', ...);
  it('loadLatestBlueprint throws NotFoundError cross-org', ...); // actor org_b, project org_a
  it('loadRevisionOwned resolves revision -> project ownership and 404s cross-org', ...);
  it('loadGraph returns nodes ordered by logical_page_id with primary keyword metrics from the first cluster', async () => { /* service node: primaryKeyword 'drain cleaning', primaryVolume 90500, supportingKeywordCount 3; home node: nulls + 0 */ });
  ```
- [ ] **Step 2: Run to verify failure.** `cd datawise-seo-insight-main/workers && npx vitest run src/blueprint/db/blueprint-reads.test.ts` -> FAIL (module not found).
- [ ] **Step 3: Implement `blueprint-reads.ts`** per the notes above. Pure reads, no IO beyond d1.
- [ ] **Step 4: Run tests.** Same command -> PASS. Then `npx tsc --noEmit` and full `npx vitest run`.
- [ ] **Step 5: Commit.** `git add workers/src/blueprint/db/blueprint-reads.ts workers/src/blueprint/db/blueprint-reads.test.ts` (paths relative to `datawise-seo-insight-main/`), message `feat(blueprint): read loaders for latest version and graph`.

---

### Task 2: Page detail loader (`loadPageDetail`)

**Files:**
- Modify: `workers/src/blueprint/db/blueprint-reads.ts`
- Test: `workers/src/blueprint/db/blueprint-reads.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 exports; tables `serp_snapshots` (`organic_json`, `keyword_id`), `faq_evidence`, `competitors`.
- Produces:
  ```ts
  export interface BlueprintPageDetail {
    node: BlueprintGraphNode;
    page: { h1: string | null; metaDescription: string | null; decisionReason: string | null;
            firedSignals: string[]; evidenceRefIds: string[]; clusterIds: string[] };
    cluster: { members: { keyword: string; volume: number | null; intent: string | null }[];
               totalMembers: number; semanticCohesion: number | null; serpOverlapCohesion: number | null } | null;
    competitorEvidence: { domain: string; position: number; url: string }[];
    evidenceAvailable: boolean;
    faqs: { question: string; source: string | null }[];
    fanOut: { status: 'pending_phase_5' };
  }
  export async function loadPageDetail(d1: D1Database, revisionId: string, runId: string, logicalPageId: string): Promise<BlueprintPageDetail>; // throws NotFoundError when page absent
  ```

**Implementation notes:**
- `page_json` fields: `h1`, `metaDescription`, `clusterIds`, `scoreBreakdown.components[]` (each `{key, rawValue, contribution}`; a fired signal is a component with `contribution > 0`, reported as its `key`), `scores.evidenceRefs` may be absent: default `[]`. Decision reason lives on `keyword_clusters.decision_reason` for the primary cluster; fall back to null.
- Cluster members: `SELECT k.display_keyword, k.search_volume, k.main_intent FROM cluster_keywords ck JOIN keywords k ON k.id = ck.keyword_id WHERE ck.cluster_id = ? ORDER BY k.search_volume DESC NULLS LAST` is not valid SQLite; use `ORDER BY (k.search_volume IS NULL) ASC, k.search_volume DESC, k.normalized_keyword ASC LIMIT 30`, plus a separate COUNT for `totalMembers`.
- Competitor evidence: find the snapshot for the primary keyword: `SELECT organic_json FROM serp_snapshots WHERE run_id = ? AND keyword_id = ? ORDER BY id ASC LIMIT 1`. Parse `organic_json` (array of `{domain, url, position | rank_absolute}`; read the actual shape in `orchestration/research-handlers.ts` before coding and match it). Filter to `SELECT domain FROM competitors WHERE run_id = ? AND selected = 1`. If no snapshot: `competitorEvidence: []`, `evidenceAvailable: false`.
- FAQs: `SELECT question, source FROM faq_evidence WHERE run_id = ? AND ... ORDER BY id ASC LIMIT 10` scoped to the cluster's queries; read `faq_evidence`'s actual columns in `db/schema.sql` first and scope by whatever keyword/query linkage exists (if linkage is only by keyword_id, use the cluster's member keyword ids, chunked at 90).

- [ ] **Step 1: Extend the seed** with a `serp_snapshots` row for `kw_1` whose `organic_json` includes 2 selected-competitor domains and 1 non-competitor, a `competitors` row per domain (`selected=1` for two), and 2 `faq_evidence` rows. Write failing tests: detail returns fired signals from scoreBreakdown, top-30 members ordered volume desc, competitor evidence filtered+ordered by position, `evidenceAvailable false` + empty arrays when the snapshot is missing, NotFoundError for unknown logicalPageId, `fanOut.status === 'pending_phase_5'`.
- [ ] **Step 2: Verify failure.** `npx vitest run src/blueprint/db/blueprint-reads.test.ts` -> FAIL (loadPageDetail not exported).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full gate.** `npx vitest run && npx tsc --noEmit` green.
- [ ] **Step 5: Commit** `feat(blueprint): page detail loader with evidence composition`.

---

### Task 3: CSV export builder (`exports/report-csv.ts`)

**Files:**
- Create: `workers/src/blueprint/exports/report-csv.ts`
- Test: `workers/src/blueprint/exports/report-csv.test.ts`

**Interfaces:**
- Consumes: `BlueprintGraphNode` from Task 1 (plus per-node `decisionReason: string | null` passed alongside; signature below takes an enriched row type).
- Produces:
  ```ts
  export interface CsvPageRow extends BlueprintGraphNode { parentSlug: string | null; decisionReason: string | null }
  export function buildBlueprintCsv(rows: CsvPageRow[]): string;
  ```
- Header exactly: `slug,title,page_type,primary_keyword,volume,intent,parent_slug,recommendation,priority,supporting_keywords,decision_reason`. RFC4180 quoting: wrap any field containing `"`, `,`, or newline in double quotes, doubling inner quotes. Null -> empty field. Rows in input order (caller passes logical_page_id order). CRLF line endings.

- [ ] **Step 1: Failing tests**: header row exact; a row with a comma and a quote in the title quoted correctly; nulls become empty fields; deterministic output for same input.
- [ ] **Step 2: Verify failure.** `npx vitest run src/blueprint/exports/report-csv.test.ts` -> FAIL.
- [ ] **Step 3: Implement** (pure function, ~40 lines).
- [ ] **Step 4: Gate** green.
- [ ] **Step 5: Commit** `feat(blueprint): csv export builder`.

---

### Task 4: HTML report renderer (`exports/report-html.ts`)

**Files:**
- Create: `workers/src/blueprint/exports/report-html.ts`
- Test: `workers/src/blueprint/exports/report-html.test.ts`

**Interfaces:**
- Consumes: Task 1/2 types.
- Produces:
  ```ts
  export interface BlueprintReportFacts {
    projectName: string; generatedAt: string; // caller passes ISO string (renderer stays pure, no Date.now)
    latest: BlueprintLatestView;
    nodes: BlueprintGraphNode[];
    detailByPageId: Map<string, BlueprintPageDetail>; // every node present
  }
  export function renderBlueprintReportHtml(facts: BlueprintReportFacts): string;
  ```
- Pure function, no IO. Single self-contained document: `<!doctype html>`, all CSS inline in one `<style>`, zero external requests, no `<script>`. Brand: white background, ink `#1a1a1a`, accent `#005232`, system font stack, print-friendly (`@media print` page breaks between sections).
- Sections in order: (1) cover: project name, date, stat cards (pages, create/update/keep/consolidate counts computed from nodes, keywords analyzed from `latest.summary` when present, completeness); (2) site tree as nested `<ul>` from parent ids (orphan parents render under a "Detached" list, never dropped); (3) page table (same columns as CSV) with a "why this page exists" cell from decisionReason; (4) evidence appendix per page: primary keyword metrics, top member keywords, competitor ranks, FAQs; (5) methodology + limitations: ruleset version, partial reasons spelled out ("US fan-out evidence lands in a later phase"), evidence gaps (`evidenceAvailable false` pages listed); (6) footer "Built with DataWise" linking `https://datawiseseo.com`.
- Escape EVERY interpolated value through one `esc()` helper (`&`, `<`, `>`, `"`).

- [ ] **Step 1: Failing tests**: output contains doctype + no `http://` or `https://` occurrences except the single footer link (assert with a count); a title containing `<script>alert(1)</script>` appears escaped and the raw string does not appear; tree nests a child inside its parent `<ul>`; a partial run's report contains the fan-out limitation sentence; pages with `evidenceAvailable false` are listed in limitations; byte-identical output for identical facts (call twice, compare).
- [ ] **Step 2: Verify failure** -> FAIL (module not found).
- [ ] **Step 3: Implement** (~250 lines; keep every section its own small function returning a string).
- [ ] **Step 4: Gate** green.
- [ ] **Step 5: Commit** `feat(blueprint): self-contained html report renderer`.

---

### Task 5: Read endpoints + router registration (`routes/blueprints.ts`)

**Files:**
- Create: `workers/src/blueprint/routes/blueprints.ts`
- Modify: `workers/src/blueprint/routes/router.ts` (import + 4 ROUTES entries)
- Test: `workers/src/blueprint/routes/blueprints.test.ts`

**Interfaces:**
- Consumes: Task 1/2 loaders, `ok`/`failFrom` conventions from `routes/envelope.ts`, `Actor`, router `RouteHandler` signature `(request, env, actor, params) => Promise<Response>`.
- Produces route handlers:
  ```ts
  export async function getLatestBlueprint(request, env, actor, params): Promise<Response>; // params.id = projectId
  export async function getBlueprintGraph(request, env, actor, params): Promise<Response>;  // params.id = revisionId
  export async function getBlueprintPage(request, env, actor, params): Promise<Response>;   // params.id, params.pageId
  ```
- ROUTES entries (patterns follow the existing style):
  ```ts
  { method: 'GET', pattern: /^\/api\/blueprint\/v1\/projects\/(?<id>[^/]+)\/blueprints\/latest$/, handler: getLatestBlueprint },
  { method: 'GET', pattern: /^\/api\/blueprint\/v1\/blueprint-revisions\/(?<id>[^/]+)\/graph$/, handler: getBlueprintGraph },
  { method: 'GET', pattern: /^\/api\/blueprint\/v1\/blueprint-revisions\/(?<id>[^/]+)\/pages\/(?<pageId>[^/]+)$/, handler: getBlueprintPage },
  ```
- Handler bodies are thin: resolve ownership via `loadRevisionOwned` (graph/page) or inside `loadLatestBlueprint` (latest), call loader, `return ok(view)`. Graph response shape: `{ revisionId, nodes: BlueprintGraphNode[] }`. Page response: `BlueprintPageDetail`.

- [ ] **Step 1: Failing route tests** (mirror `routes/runs.test.ts` setup: real router entry via exported handler + seeded test DB): 200 happy path for each endpoint asserting envelope `{requestId, data}` and a spot field; 404 for cross-org actor on each; 404 for unpublished project on latest; 404 for unknown pageId.
- [ ] **Step 2: Verify failure** -> FAIL.
- [ ] **Step 3: Implement handlers + register in router.ts.**
- [ ] **Step 4: Gate**: `npx vitest run && npx tsc --noEmit` and `cd .. && node scripts/check-blueprint-boundary.mjs`.
- [ ] **Step 5: Commit** `feat(blueprint): read endpoints for latest, graph, page detail`.

---

### Task 6: Export endpoint (html + csv)

**Files:**
- Modify: `workers/src/blueprint/routes/blueprints.ts`, `workers/src/blueprint/routes/router.ts`
- Test: `workers/src/blueprint/routes/blueprints.test.ts` (extend)

**Interfaces:**
- Produces: `export async function exportBlueprint(request, env, actor, params): Promise<Response>` registered as
  ```ts
  { method: 'GET', pattern: /^\/api\/blueprint\/v1\/blueprint-revisions\/(?<id>[^/]+)\/export$/, handler: exportBlueprint },
  ```
- `?format=csv`: assemble `CsvPageRow[]` (graph + parentSlug map + decisionReason from detail-lite query: one extra SELECT of `keyword_clusters.decision_reason` per revision, chunked), return `new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="blueprint-<projectId>.csv"' } })`.
- `?format=html` (default): build `BlueprintReportFacts` by calling `loadGraph` once and `loadPageDetail` for every node sequentially (30-150 pages, all local D1 reads), `generatedAt: new Date().toISOString()` computed in the HANDLER (renderer stays pure), return with `Content-Type: text/html; charset=utf-8` (inline display, not attachment).
- Unknown format value -> `BlueprintApiError('invalid_input', ...)` 400 envelope.

- [ ] **Step 1: Failing tests**: csv response has text/csv content type, attachment disposition, exact header row; html response contains doctype + project name + escaped fields; format=weird -> 400 envelope; cross-org -> 404.
- [ ] **Step 2: Verify failure.** **Step 3: Implement.** **Step 4: Full worker gate + boundary.** 
- [ ] **Step 5: Commit** `feat(blueprint): export endpoint (html report + csv)`.

---

### Task 7: SPA API types + hooks + tree layout util

**Files:**
- Create: `src/pages/blueprint/canvas/types.ts` (local mirrors: `BlueprintLatestView`, `BlueprintGraphNode`, `BlueprintPageDetail`, response envelopes; copy shapes from Tasks 1/2 verbatim, camelCase as the API returns them)
- Create: `src/pages/blueprint/canvas/hooks.ts`
- Create: `src/pages/blueprint/canvas/layout.ts`
- Test: `src/pages/blueprint/canvas/layout.test.ts`

**Interfaces:**
- Consumes: `api<T>(path)` from `@/lib/api` (adds Bearer token, throws on failure), `useQuery` from `@tanstack/react-query`.
- Produces:
  ```ts
  // hooks.ts
  export function useLatestBlueprint(projectId: string): UseQueryResult<BlueprintLatestView>; // key ['blueprint','latest',projectId], api(`/api/blueprint/v1/projects/${projectId}/blueprints/latest`), retry: false
  export function useBlueprintGraph(revisionId: string | undefined): UseQueryResult<{ revisionId: string; nodes: BlueprintGraphNode[] }>; // enabled: !!revisionId
  export function useBlueprintPage(revisionId: string | undefined, pageId: string | null): UseQueryResult<BlueprintPageDetail>; // enabled when both set
  // layout.ts
  export interface LayoutNode { id: string; x: number; y: number }
  export function layoutBlueprintTree(nodes: BlueprintGraphNode[], opts?: { nodeWidth?: number; nodeHeight?: number; hGap?: number; vGap?: number }): Map<string, LayoutNode>;
  ```
- Layout algorithm (deterministic, ~80 lines): roots = nodes with null parent OR parent id not present in the set (orphan fallback: treat as root, never drop). Children of each node sorted by slug asc. Post-order pass computes each subtree's width (leaf = nodeWidth + hGap; internal = max(own width, sum of children widths)); pre-order pass assigns x = subtree center, y = depth * (nodeHeight + vGap). Defaults nodeWidth 200, nodeHeight 96, hGap 24, vGap 60.
- NOTE: the API returns `data` inside the `{requestId, data}` envelope; `api()` in this codebase returns the parsed body as-is, so hooks unwrap `.data` (verify against how BlueprintHome.tsx unwraps and match exactly).

- [ ] **Step 1: Failing layout tests** (SPA vitest, from `datawise-seo-insight-main`): same input twice -> deep-equal maps; children ordered by slug (left to right x ascending); orphan parent id -> node still present as a root; single root centered over its children (root.x equals midpoint of children xs).
- [ ] **Step 2: Verify failure.** `npx vitest run src/pages/blueprint/canvas/layout.test.ts` -> FAIL.
- [ ] **Step 3: Implement types.ts, hooks.ts, layout.ts.**
- [ ] **Step 4: Gate.** SPA `npx vitest run` + `npx tsc --noEmit` green.
- [ ] **Step 5: Commit** `feat(blueprint): canvas api hooks and deterministic tree layout`.

---

### Task 8: Map view (`PageMap.tsx`) + @xyflow/react

**Files:**
- Modify: `package.json` (SPA): add `@xyflow/react` (latest 12.x)
- Create: `src/pages/blueprint/canvas/PageMap.tsx`
- Create: `src/pages/blueprint/canvas/PageCardNode.tsx`

**Interfaces:**
- Consumes: `layoutBlueprintTree`, `BlueprintGraphNode`.
- Produces:
  ```ts
  export function PageMap(props: { nodes: BlueprintGraphNode[]; selectedId: string | null; onSelect: (id: string) => void }): JSX.Element;
  ```
- `PageCardNode`: custom React Flow node rendering type icon (map `page_type` -> lucide icon: home Home, service Wrench, location MapPin, service_location Navigation, resource BookOpen, company Building2, contact Mail, default FileText), title (font-semibold, truncate), slug (mono, muted, truncate), primary keyword + compact volume (`Intl.NumberFormat('en', {notation:'compact'})`), recommendation Badge (create green `bg-emerald-100 text-emerald-900`, update amber, keep blue, consolidate slate). Selected node gets `ring-2 ring-[#005232]`.
- `PageMap`: builds React Flow `nodes` from layout map + `edges` from parent ids (type `smoothstep`), `fitView`, `<Controls/>`, `<MiniMap/>`, `nodesDraggable={false}`, `nodesConnectable={false}`, `onNodeClick` -> `onSelect(node.id)`. Import `@xyflow/react/dist/style.css` once here.

- [ ] **Step 1: Install.** `cd datawise-seo-insight-main && npm install @xyflow/react` (record exact version in the commit).
- [ ] **Step 2: Implement both components** (no unit tests for JSX this wave; the layout math is already tested; render verification happens in Task 12 browser pass).
- [ ] **Step 3: Gate.** `npx tsc --noEmit` + `npx vitest run` + `npm run build` succeeds.
- [ ] **Step 4: Commit** `feat(blueprint): react flow map view with page card nodes` (include package.json + package-lock.json).

---

### Task 9: Table view (`PageTable.tsx`)

**Files:**
- Create: `src/pages/blueprint/canvas/PageTable.tsx`

**Interfaces:**
- Produces: `export function PageTable(props: { nodes: BlueprintGraphNode[]; selectedId: string | null; onSelect: (id: string) => void }): JSX.Element;`
- shadcn `Table` with columns: Title, Slug (mono), Type, Primary keyword, Volume (right-aligned, compact format, sortable), Recommendation (badge, same colors as map), Supporting keywords count. Header click toggles sort (state: `{key, dir}`; default volume desc, nulls last). Text input above filters case-insensitively over title+slug+primaryKeyword. Row click -> `onSelect`; selected row `bg-emerald-50`.

- [ ] **Step 1: Implement.** **Step 2: Gate** (tsc + vitest + build). **Step 3: Commit** `feat(blueprint): sortable filterable table view`.

---

### Task 10: Detail panel (`PageDetailPanel.tsx`)

**Files:**
- Create: `src/pages/blueprint/canvas/PageDetailPanel.tsx`

**Interfaces:**
- Consumes: `useBlueprintPage(revisionId, pageId)`.
- Produces: `export function PageDetailPanel(props: { revisionId: string; pageId: string | null; onClose: () => void }): JSX.Element;`
- shadcn `Sheet` (side="right", open when pageId non-null). Sections top to bottom: title + recommendation badge + slug (mono, copy button via `navigator.clipboard`); Primary keyword block (keyword bold, volume + intent line); Supporting keywords as chips (first 12, "+N more" expands); "Why this page exists" (decisionReason in a `bg-emerald-50` callout; below it fired signals as a plain-English bullet list using this exact mapping: `distinct_intent` -> "Searchers want something different here than on the parent page", `low_serp_overlap` -> "Google shows different results for this query", `competitor_dedicated_pages` -> "Competitors have a dedicated page for this", `unique_conversion` -> "Has its own conversion action", `sufficient_demand` -> "Enough monthly search demand", `unique_local_proof` -> "Real local presence in this area", unknown keys render as the raw key); Competitor evidence rows (domain left, #position right; when `evidenceAvailable` is false show muted "Live SERP evidence was not collected for this query"); FAQs list; Fan-out section always rendering muted "Coming with Phase 5". Loading state: skeleton lines. Error state: inline destructive text, no toast.

- [ ] **Step 1: Implement.** **Step 2: Gate.** **Step 3: Commit** `feat(blueprint): page detail evidence panel`.

---

### Task 11: Canvas page, route, export menu, harness updates

**Files:**
- Create: `src/pages/blueprint/BlueprintCanvas.tsx`
- Create: `src/pages/blueprint/canvas/ExportMenu.tsx`
- Modify: `src/App.tsx` (lazy import + route)
- Modify: `src/pages/blueprint/BlueprintHome.tsx` (copy rewrite + View blueprint button)

**Interfaces:**
- Consumes: everything from Tasks 7-10.
- `App.tsx` additions (mirror the existing BlueprintHome pattern exactly):
  ```tsx
  const BlueprintCanvas = lazy(() => import('./pages/blueprint/BlueprintCanvas'));
  <Route path="/blueprint/:projectId" element={<ProtectedPage requireAdmin><BlueprintCanvas /></ProtectedPage>} />
  ```
- `BlueprintCanvas.tsx`: `useParams().projectId`; `useLatestBlueprint`; while loading, centered spinner; on 404, empty state Card ("No blueprint published yet for this project. Run the research pipeline first.") with a Button linking back to `/blueprint`; on success: header row (project link back, title, completeness Badge showing "Partial: US fan-out pending" when `partialReasons` includes `collect_us_fanout`, else "Complete"), stats strip (Recommended pages = nodes.length; per-recommendation counts; Keywords analyzed + Clusters from `latest.summary` when the keys exist, hidden otherwise; Competitors reviewed likewise), view toggle (shadcn Tabs: Map | Table), `ExportMenu`, and the selected view + `PageDetailPanel` wired to shared `selectedId` state.
- `ExportMenu.tsx`: shadcn DropdownMenu with two items. Both fetch with auth then blob-download (the plain `<a href>` cannot carry the Bearer header):
  ```ts
  async function download(revisionId: string, format: 'html' | 'csv') {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/blueprint/v1/blueprint-revisions/${revisionId}/export?format=${format}`,
      { headers: { Authorization: `Bearer ${getSessionToken()}` }, credentials: 'omit' });
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (format === 'html') { window.open(url, '_blank'); }
    else { const a = document.createElement('a'); a.href = url; a.download = 'blueprint.csv'; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  ```
  Failures -> existing `toast` destructive.
- `BlueprintHome.tsx` changes: (a) replace the intro paragraph "Research stages are live: keyword, competitor, and SERP evidence via DataForSEO. Clustering and fan-out land in later phases; runs finish as partial." with "Research, clustering, and page planning are live. A finished run publishes a full site blueprint: open it with View blueprint. US fan-out evidence lands in a later phase, so runs finish as partial."; (b) on each project card whose latest run reached `publish_blueprint` succeeded (the stage list is already rendered from run data), add a primary Button "View blueprint" -> `navigate('/blueprint/' + project.id)`. Simplest reliable condition: show the button whenever `latestRunId` is non-null and the run view's stages include `publish_blueprint: succeeded`; if stage data is not loaded, show the button anyway and let the canvas page's 404 empty state handle it (never hide the only path to the canvas behind a loading race).

- [ ] **Step 1: Implement all four files.**
- [ ] **Step 2: Gate.** tsc + vitest + `npm run build`.
- [ ] **Step 3: Manual dev check.** `npm run dev` (port 8080), log in as admin, open `/blueprint/<aqua project id>`: map renders 30 nodes against the LIVE worker (VITE_API_URL points at prod worker; reads are free), click a node, panel loads, both exports download. Fix anything broken before committing.
- [ ] **Step 4: Commit** `feat(blueprint): canvas page, route, export menu, harness copy`.

---

### Task 12: Deploy guard markers + final gates + docs

**Files:**
- Modify: `scripts/deploy-pages-production.mjs` (SPA repo scripts dir): add to the bundle marker list an entry for the canvas (marker string `BlueprintCanvas` in the built JS assets, same mechanism as existing feature markers; read the file's marker arrays first and follow their exact format)
- Modify: `workers/src/blueprint/README.md`: add a "Read API + canvas" paragraph listing the 4 endpoints and the SPA route

**Steps:**
- [ ] **Step 1: Add the guard marker + README paragraph.**
- [ ] **Step 2: Full gates, everything.** Worker: `npx vitest run`, `npx tsc --noEmit`, boundary script. SPA: `npx vitest run`, `npx tsc --noEmit`, `npm run deploy:pages:check` (must pass with the new marker).
- [ ] **Step 3: Commit** `chore(blueprint): deploy guard marker for canvas + docs`.
- [ ] **Step 4: Push branch** `git push -u origin feat/blueprint-canvas-ui`. Do NOT open or merge a PR; staging verification and the merge decision are user gates.

---

## Verification after build (not a task, the wave gate)

1. Worker deploy from this branch is NOT needed for SPA dev testing (endpoints ship with the next worker deploy; deploying the worker from this branch is safe because it branches off production AFTER Phase 4, so Blueprint code is present). Deploy worker: `cd workers && npm run deploy`.
2. Push `feat/blueprint-canvas-ui` to `staging` (`git push origin feat/blueprint-canvas-ui:staging`) -> staging.datawise-118.pages.dev; browser-verify against the real Aqua Plumbing blueprint: 30-node map, pan/zoom/fit, table sort/filter, detail panel evidence, HTML report opens self-contained, CSV opens in Numbers, no-blueprint empty state on a fresh project.
3. Merge to production only on explicit user yes, then tag + DEPLOY.md entry per DEPLOY.md.
