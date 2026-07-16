# Blueprint Canvas UI (read-only viewer + export)

Date: 2026-07-16. Approved by Nicolas via visual mockup (brainstorm session, canvas-layout.html rendered with real run_7325f00e data).

## Goal

Replace "run finished, go query D1" with a product screen: the published blueprint rendered as an interactive site map with per-page evidence, plus export. Read-only this wave: no page mutations, no revisions beyond revision 1. Reference design: `blueprint-v1-developer-handoff/assets/blueprint-canvas-reference.png`.

## Scope decisions (user-confirmed)

- Read-only viewer + export. Editing (recommendation changes, approve/reject, re-parenting) is a later wave.
- Export: self-contained branded HTML report AND CSV of the page table. No PDF, no JSON this wave.
- Map rendering: React Flow (`@xyflow/react`), custom page-card nodes, deterministic layout.
- Placement: `/blueprint` stays the project list (harness). New route `/blueprint/:projectId` is the canvas. Both admin-gated via existing `ProtectedPage requireAdmin`.
- Stale harness copy ("Clustering and fan-out land in later phases") rewritten to reflect Phase 4.

## Part 1: Worker read endpoints

Four new GET routes in `workers/src/blueprint/routes/` (new module `blueprints.ts`, registered in `router.ts`), same envelope/auth/admin gating as existing routes. Reads only: no provider calls, no schema changes, no writes.

1. `GET /api/blueprint/v1/projects/:projectId/blueprints/latest`
   Latest published `blueprint_versions` row for the project + its latest revision id. Payload: version id, version_number, status, schema_version, ruleset_version, completeness, partial_reasons, summary_json (parsed), published_at, revision {id, revision_number, revision_hash}. 404 envelope code `blueprint_not_found` when none published.

2. `GET /api/blueprint/v1/blueprint-revisions/:revisionId/graph`
   All `blueprint_pages` rows for the revision as nodes, one response (page cap is 150, no pagination). Per node: logical_page_id, parent_logical_page_id, page_type, title, slug, primary_keyword (display + normalized), primary volume + intent (joined from keywords via the page's cluster), recommendation, approval, priority, confidence_label, counts {supportingKeywords, faqs}. Ownership check: revision -> version -> project -> organization must match the session user's org (same pattern as runs routes).

3. `GET /api/blueprint/v1/blueprint-revisions/:revisionId/pages/:logicalPageId`
   Detail panel payload, composed server-side:
   - page core: everything from the graph node + page_json (sections, h1, metaDescription, scores incl. fired signals + evidenceRefs, clusterIds, decision reason)
   - cluster: member keywords with volume/intent (top 30 by volume + total count), cluster cohesion scores
   - competitor evidence: for the page's primary keyword, ranked organic domains from `serp_snapshots.organic_json` filtered to selected competitors (domain, position, url); empty array + `evidenceAvailable: false` if no snapshot for that query
   - faqs: `faq_evidence` rows linked to the cluster's queries (question text, source), cap 10
   - fanOut: `{ status: 'pending_phase_5' }` literal so the UI renders the honest placeholder
4. `GET /api/blueprint/v1/blueprint-revisions/:revisionId/export?format=html|csv`
   - `csv`: page table (slug, title, page_type, primary_keyword, volume, intent, parent_slug, recommendation, priority, supporting_keyword_count, decision_reason). Content-Disposition attachment.
   - `html`: single self-contained branded HTML report (inline CSS, no external assets, no JS required): cover/summary stats, site tree (nested indented list, print-friendly), page-by-page table with "why this page exists", evidence appendix (clusters with member keywords + volumes), methodology + limitations (partial reasons, caps), DataWise footer. Reuses the same SQL loaders as endpoints 2/3 so the report can never drift from the UI. Generated per request (no R2 persistence this wave; runs are admin-only).

Implementation notes:
- New `db/blueprint-reads.ts` with the shared loaders (version lookup, graph rows, page detail composition) used by both the JSON endpoints and the report renderer. Total ORDER BY on every SELECT.
- Report renderer is a pure function `renderBlueprintReportHtml(facts) -> string` in `exports/report-html.ts` (unit-testable, no IO). HTML-escape all data fields.
- Router patterns follow the existing regex table. Envelope + safe error codes follow `routes/envelope.ts`.

## Part 2: SPA canvas page

New files under `src/pages/blueprint/`:
- `BlueprintCanvas.tsx` (route `/blueprint/:projectId`): loads latest blueprint (React Query), renders stats header, view toggle, export menu; child views below. "No blueprint yet" empty state links back to the harness to start a run.
- `canvas/PageMap.tsx`: React Flow canvas. Custom node component = page card (type icon, title, slug, primary keyword + volume, recommendation badge, priority chip). Deterministic layered tree layout computed from parent ids (own ~80-line layout util, no dagre dependency: BFS layers, children grouped under parent, stable ordering by slug). Pan/zoom/fit controls + minimap. Click selects node -> opens detail panel.
- `canvas/PageTable.tsx`: shadcn table, sortable (volume, type, recommendation, title), text filter over title/slug/keyword. Row click opens the same detail panel.
- `canvas/PageDetailPanel.tsx`: shadcn Sheet (right side). Sections in order: slug + badges, primary keyword (volume/intent), supporting keywords (chips, expandable), "Why this page exists" (decision reason + fired signals as plain-English bullets), competitor evidence (domain + rank rows), FAQs, fan-out placeholder ("Coming with Phase 5"). Loads detail endpoint lazily on open, cached by React Query.
- `canvas/ExportMenu.tsx`: dropdown -> opens `/export?format=html` in new tab (report) and triggers csv download. Both hit the worker with the session token via fetch + blob (Authorization header, no cookies).
- Local type mirrors of the new API payloads (same copied-contracts convention as BlueprintHome).

Harness changes (BlueprintHome.tsx): rewrite the stale intro copy; each project row with a published blueprint gains a "View blueprint" button -> `/blueprint/:projectId`.

Brand: forest green #005232 accents, existing Tailwind/shadcn tokens. New dependency: `@xyflow/react` only.

Deploy guard: add a marker string for the canvas chunk (e.g. component name `BlueprintCanvas`) to `scripts/deploy-pages-production.mjs` per existing convention.

## Data flow

React Query keys: `['blueprint','latest',projectId]`, `['blueprint','graph',revisionId]`, `['blueprint','page',revisionId,pageId]`. Graph loads once per revision (<=150 nodes, single response); detail fetched on first open per page. No polling: published blueprints are immutable. Errors surface as toasts + inline empty states (same patterns as the harness). All fetches `credentials: 'omit'` + Bearer token per app convention.

## Error handling

- No published blueprint: 404 `blueprint_not_found` -> friendly empty state with "start a run" pointer.
- Revision/page not found or cross-org: 404 (existing not-found envelope), never a 500.
- Detail endpoint: missing SERP snapshot or FAQ evidence degrades to empty sections with an "evidence not collected for this query" note, never an error.
- Export: renderer throws -> 500 envelope; CSV always available even if HTML rendering fails (independent code paths).

## Testing / verification

- Worker: vitest for the loaders (seeded test D1: version + revision + pages + clusters + snapshots), endpoint auth/404/ownership tests, report renderer unit tests (escaping, empty-evidence run, partial disclosure), CSV shape test. Full suite + tsc + boundary script (blueprints.ts stays inside blueprint/).
- SPA: vitest for the tree layout util (determinism, orphan parent fallback) and CSV/export URL building; tsc; `npm run deploy:pages:check`.
- Browser verification on staging frontend against the real Aqua Plumbing blueprint (run_7325f00e): map renders 30 nodes, panel shows real evidence, both exports download, empty-state path with a project that has no blueprint.

## Out of scope (explicit)

Mutations/revisions >1, approve/reject, evidence explorer page, exports to R2/PDF/JSON, fan-out data (Phase 5), non-admin access, mobile-optimized canvas (table view is the small-screen fallback).
