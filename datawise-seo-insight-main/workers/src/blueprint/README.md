# Blueprint module

Turns a business brief into an evidence-backed website architecture plan.
Spec: docs/superpowers/specs/2026-07-10-blueprint-v1-integration-design.md
Handoff: blueprint-v1-developer-handoff/ (repo root of the main checkout)

Boundary rules:
- This module MAY import shared infra: middleware/auth, auth/google (AuthUser), routes/admin (isAdmin),
  dataforseo/, llm/, and the Env type from ../index.
- Nothing outside this folder may import from it, except the single route mount
  in workers/src/index.ts. Enforced by scripts/check-blueprint-boundary.mjs.
- All state lives in BLUEPRINT_DB (blueprint-db), never in the main DB.

Layout: contracts/ (DTOs, enums, zod), domain/ (pure engine), routes/ (handlers),
stages/ (pipeline, Phase 2+), providers/ (adapters, Phase 3+), exports/ (Phase 8).

## Stages

The pipeline runs the 19 stages in `contracts/enums.ts` `BLUEPRINT_STAGES` order.
A REQUIRED stage failing fails the whole run; an optional stage failing only
degrades the run to `partial` (see `orchestration/stages.ts` `REQUIRED_STAGES`
and `run-status.ts`). Ruleset is `domain/ruleset.ts` `rulesetVersionForStage`:
clustering stages resolve to `cluster-v1`, page-planning stages to `pp-v1`,
everything else to the `phase2-stub` legacy tag. As of Phase 4 every stage below
runs a real handler except the two Phase 5 stubs.

| # | Stage | Required | Ruleset | Handler | Purpose |
|---|-------|----------|---------|---------|---------|
| 1 | validate_intake | yes | phase2-stub | real (P2) | Validate the normalized brief inputs. |
| 2 | resolve_market | yes | phase2-stub | real (P2) | Resolve location/language codes from DFS catalogs. |
| 3 | normalize_brief | yes | phase2-stub | real (P2) | Persist the canonical brief every later stage reads. |
| 4 | plan_research | yes | phase2-stub | real (P2) | Decide which evidence stages run and their budgets. |
| 5 | collect_keyword_evidence | yes | phase2-stub | real (P3) | Keyword ideas/suggestions/overview + metric enrichment. |
| 6 | discover_competitors | no | phase2-stub | real (P3) | SERP/domain competitor discovery and selection. |
| 7 | collect_competitor_evidence | no | phase2-stub | real (P3) | Competitor ranked keywords + relevant pages. |
| 8 | normalize_keyword_universe | no | cluster-v1 | real (P4) | Backfill rich keyword fields, score, link services/areas, cap retention. |
| 9 | embed_keyword_features | no | cluster-v1 | real (P4) | Workers AI `@cf/baai/bge-m3` embeddings to R2. |
| 10 | build_provisional_clusters | yes | cluster-v1 | real (P4) | Similarity graph + connected-component clusters with score breakdowns. |
| 11 | validate_serps_and_questions | no | phase2-stub | real (P3, P4 per-cluster queries) | Live SERP + PAA per cluster representative query. |
| 12 | refine_clusters | no | cluster-v1 | real (P4) | Deterministic re-cluster over live SERP; persists adjudications. |
| 13 | parse_competitor_pages | no | pp-v1 | real (P4) | DFS content parsing of top competitor pages per cluster. |
| 14 | collect_us_fanout | no | phase2-stub | stub (P5) | Skipped; US query fan-out deferred to Phase 5. |
| 15 | build_page_plan | yes | pp-v1 | real (P4) | Deterministic skeleton + cluster placement into a page plan. |
| 16 | overlay_existing_site | no | pp-v1 | real (P4) | Match the plan against the live site's sitemap/inventory. |
| 17 | synthesize_page_briefs | no | phase2-stub | stub (P5) | Skipped; per-page brief synthesis deferred to Phase 5. |
| 18 | validate_blueprint | yes | pp-v1 | real (P4) | Compose + validate; blocking issues fail the run before publish. |
| 19 | publish_blueprint | yes | pp-v1 | real (P4) | Materialize `blueprint_pages` + versioned summary for revision 1. |

Composite published stamp: `blueprint_versions.ruleset_version = cluster-v1+pp-v1`,
`schema_version = p4` (`domain/ruleset.ts`).
