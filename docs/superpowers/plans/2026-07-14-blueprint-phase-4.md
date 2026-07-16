# Blueprint Phase 4: Clustering + Page-Planning Engine

## Context

Blueprint V1 turns a business brief into an evidence-backed website architecture. Phases 0-3 are in production (tag `prod-2026-07-14-1901`): real DataForSEO research collects keywords, competitors, and SERP evidence, but the stages that turn that evidence into an actual site structure are still stubs. A run today publishes an empty blueprint (zero `blueprint_pages` rows). Phase 4 builds the deterministic engines that produce the deliverable: keyword clusters and the page plan, per the handoff spec (`blueprint-v1-developer-handoff/`), with the guardrails the spec demands (no auto service-x-location pages, unique slugs and primary keywords, doorway/cannibalization checks).

Decisions already made with the user:
- **Embeddings: Cloudflare Workers AI** (`@cf/baai/bge-m3`, new `[ai]` binding), not OpenAI.
- **Ops rides folded in**: competitor etv fix, stage-cost attribution, operation-to-stage mapping. Deferred to a pre-launch ops wave: budget reaper, DLQ alerting, idempotency purge.
- Out of scope (Phase 5): OpenRouter AI adjudication, `synthesize_page_briefs`, `collect_us_fanout` (stays skipped).

All code in `datawise-seo-insight-main/workers/src/blueprint/`. Build in a worktree off `origin/production`, subagent-driven development with per-task reviews (Phase 3 pattern), staging-first, one PR.

## What exists and gets reused

- `domain/keyword.ts` `normalizeKeyword`, `domain/merge.ts` `mergeKeywordCandidates`, `domain/score.ts` (null-safe scoring), `domain/doorway.ts` `evaluateServiceLocationPage` + `detectDoorwayRisk`, `domain/slug.ts` `normalizeSlug`, `domain/graph.ts` `validateBlueprintGraph`, `domain/url.ts` `assertPublicWebTarget`, `domain/hash.ts` `canonicalize`/`hashNormalizedInput`.
- `providers/dataforseo/call.ts` `blueprintDfsCall` (reserve-before-call, KV cache, R2 artifacts, provider_usage) for all new paid calls.
- `orchestration/handlers.ts` `publishBlueprintHandler` (version/revision idempotency under lease races) is extended, not replaced.
- Evidence already in D1/R2 from Phase 3: `keywords` (rich fields NULL, backfilled by stage 8 from R2 artifacts), `competitors`, `serp_snapshots.organic_json`, `faq_evidence`, `evidence_refs`+artifacts, `collect_competitor_evidence` stage output `perCompetitor[].topPages`.

## Stage-by-stage design (summary)

**Stage 8 `normalize_keyword_universe`**: backfill rich keyword fields (core_keyword, intent, monthly searches, serp features, referring domains) by re-parsing R2 evidence artifacts (`providers/dataforseo/evidence-readback.ts`); relevance/opportunity scores via existing `domain/score.ts`; deterministic script-class language-mismatch flag; token-match service/area linking into `keyword_services`/`keyword_service_areas`; retention cap 1500 by relevance+evidence (new `keywords.excluded_reason` column, rows never deleted; user seeds exempt).

**Stage 9 `embed_keyword_features`**: Workers AI `@cf/baai/bge-m3` via new `[ai]` binding in wrangler.toml + `BlueprintProviderEnv.AI`; batches of 100, hard ceiling `maxBatchesPerRun: 40` (overflow => partial); vectors to R2 (`runs/{runId}/embeddings/...`) + `artifacts` rows with model/dimensions/content hashes; `assertEmbeddingSetCompatible` rejects mixed models/dims; `provider_usage` rows `provider='workers_ai'`, cost 0; exempt from budget reservations (matches the existing free-call carve-out; the CHECK constraint on reservations only allows dataforseo/openrouter). No new metadata table.

**Stage 10 `build_provisional_clusters`** (REQUIRED): edge score `0.55*cosine + 0.35*serpUrlJaccard + 0.10*intentCompatibility` (manual verbatim), missing terms renormalize weights; SERP URLs from ranked_keywords R2 artifacts; hard constraints (branded-navigational never merges generic; different services never merge on shared city; service-location never merges national informational; incompatible intents => pending adjudication, no exceptions in Phase 4); deterministic blocking to bound O(n^2); connected components over thresholded edges (order-invariant), oversized components re-cut by raising local threshold; persists `keyword_clusters` + `cluster_keywords` with `score_breakdown_json` + evidence refs; leaves `page_candidate` NULL (stage 15 owns it); emits `representativeQueries` so `validate_serps_and_questions` upgrades to one live SERP per cluster (small research-handlers change).

**Stage 12 `refine_clusters`**: deterministic-only; rebuild graph with live organic URLs + PAA + related searches; auto-apply only unambiguous constraint-clean merges/splits; low-confidence boundaries persisted to new `cluster_adjudications` table as `pending` or `insufficient_evidence` (valid terminal decision, no AI call); cohesion recalculated.

**Stage 13 `parse_competitor_pages`**: DFS `on_page/content_parsing/live` through `blueprintDfsCall` (`operation='content_parsing'`, 7d TTL, overestimated $0.01/call in the planner); top 10 clusters ranked by intent/confidence/volume (NOT by page_candidate, which is unset at this point in stage order), top 2 competitor URLs each (SERP snapshot organic domains matching selected competitors, fallback topPages); JS disabled first, exactly one JS retry if empty/blocked (blueprint-local `detectBotChallenge` copy); bounded extracts persisted to new `parsed_competitor_pages` table; content treated as untrusted data, never instructions.

**Stage 15 `build_page_plan`** (add to REQUIRED_STAGES): pure engine `domain/page-plan/engine.ts` over a facts loader; skeleton (home, service pages, hubs when >=3/>=2 children, location pages, contact/about) + cluster placement: separate page iff >=2 strong signals (distinct intent, SERP overlap <0.30 vs parent, >=40% competitors have dedicated page, unique conversion, demand, unique local proof), else section/FAQ; service-location pages only for clusters already carrying both service+area links AND passing `evaluateServiceLocationPage` + `detectDoorwayRisk` (never a cartesian product); primary-keyword uniqueness by construction (later claimant folds into earlier page with cannibalization warning); addressable demand counts each primary keyword once, null when metrics missing; page cap demotes lowest scores to sections; deterministic logical IDs and slugs; writes final placement back to `keyword_clusters.page_candidate`/`decision_reason` (single writer). All thresholds in versioned `PAGE_PLAN_RULESET_V1`.

**Stage 16 `overlay_existing_site`**: skipped for greenfield briefs; SSRF-safe robots/sitemap fetch (`assertPublicWebTarget`, 2MB/10s caps, 500 URLs, 20 title fetches) + DFS `ranked_keywords` against own domain (`operation='site_ranked_urls'`); deterministic matching to planned pages => Create/Update/Keep/Consolidate (consolidate target exists, never self); blockage => `inventory_limited` warning + Labs fallback, never "site has no pages"; inventory persisted to new `existing_pages` table.

**Stage 18 `validate_blueprint`** (REQUIRED): compose plan into `BlueprintPageNode[]`, run existing `validateBlueprintGraph` + manual rules (parents exist, consolidate targets valid, page count <= cap, field limits, doorway re-check, evidence presence, partial stages disclosed). Blocking errors throw `BlueprintValidationError` (run fails; invalid output never publishes); the rest persist as warnings.

**Stage 19 `publish_blueprint` extension**: materialize `blueprint_pages` rows for revision 1 (chunked `INSERT OR IGNORE`, lease-race safe), real `ruleset_version`, `schema_version 'p4'`, populated `summary_json` (counts, byRecommendation, addressable demand), `revision_hash` now includes canonicalized pages.

## Cross-cutting

- **Ruleset versioning** (resolves both agents' proposals): `contracts/ruleset.ts` exports `rulesetVersionForStage(stage)` -> `'cluster-v1'` for stages 8-12, `'pp-v1'` for 13-19, `'phase2-stub'` otherwise; `process-run.ts` uses it in `buildStageInputHash` and passes it to `completeStage` (new column write on `research_stage_runs.ruleset_version`); `blueprint_versions.ruleset_version` = composed `cluster-v1+pp-v1`. Ruleset-drift unit tests pin `hashNormalizedInput(RULESET)` to a constant so changing a threshold without bumping the version fails CI.
- **One migration** `db/migrations/2026-07-14-phase4.sql` (+ mirrored in `db/schema.sql`, `schema-v4.test.ts`): `keywords.excluded_reason`; `keyword_clusters.ruleset_version`, `.score_breakdown_json`; new tables `cluster_adjudications`, `parsed_competitor_pages`, `existing_pages`; indexes; `schema_version -> 4` with the CAST guard.
- **`db/batch.ts`**: extract `chunk`/`runBatchedStatements`/param-budget constants from research-handlers.ts (shared by all new persistence).
- **Ops rides**: (a) etv: extract `full_domain_metrics.organic.etv` (competitors_domain) / top-level `etv` (serp_competitors) into `competitors.estimated_traffic` (`upsertCompetitorRow` insert + COALESCE update), real-shaped fixtures; (b) stage cost: `process-run.ts` completion/failure paths set `research_stage_runs.cost_usd_micro` from `SUM(provider_usage.cost_usd_micro) WHERE run_id AND stage`; (c) `OPERATION_STAGE` centralized in `providers/dataforseo/costs.ts` (`CallPlanLine.stage`), `metric_enrichment -> collect_keyword_evidence` fixed, new ops mapped, local map in `routes/projects.ts` deleted.
- **Determinism**: engines are pure (no Date.now/random/newId inside decisions); every feeding SELECT has total ORDER BY; components keyed by lexicographically-smallest member; reproducibility asserted by hash-comparing double runs.

## Task breakdown (~1 commit each, SDD with per-task review)

Foundation:
1. `db/batch.ts` extraction + phase4 migration + schema.sql mirror + `schema-v4.test.ts`.
2. `contracts/ruleset.ts` + cluster/page rulesets + drift tests; `process-run.ts` per-stage ruleset in stage input hash; `completeStage` persists `ruleset_version`.
3. Ops (a) etv fix + fixtures. 4. Ops (b) stage-cost SUM. 5. Ops (c) OPERATION_STAGE centralization.

Clustering half:
6. `providers/dataforseo/evidence-readback.ts` + fixture tests.
7. Stage 8: `domain/clustering/language.ts` + `universe.ts` + handler (`orchestration/clustering-handlers.ts`) + registration + tests.
8. `[ai]` binding + `BlueprintProviderEnv.AI` + fake AI in `test-support/env.ts` + `domain/clustering/features.ts`/`embeddings.ts` + `providers/embeddings/workers-ai.ts` + stage 9 handler + tests.
9. Clustering engine pure modules (`similarity.ts`, `constraints.ts`, `graph.ts`, `clusters.ts`) + determinism suite.
10. Stage 10 handler (load vectors + URL maps, persist clusters, representativeQueries output) + tests.
11. `validate_serps_and_questions` prefers representativeQueries over seed queries (research-handlers.ts, isolated diff).
12. Stage 12: `domain/clustering/refine.ts` + handler + `cluster_adjudications` persistence + tests.

Page-planning half:
13. Stage 13 adapter: `content-parsing.ts` + cost estimate + plan line + tests.
14. Stage 13 handler: cluster/URL selection, JS retry, `parsed_competitor_pages`, registration + tests.
15. Page-plan domain core: `domain/page-plan/ruleset.ts`, `types.ts`, `signals.ts`, `titles.ts` + tests.
16. Page-plan engine + facts loader + handler + REQUIRED_STAGES addition + `page_candidate` write-back + determinism hash test.
17. Overlay domain: `domain/bot-challenge.ts` (local copy), `overlay/fetcher.ts`, `sitemap.ts`, `match.ts` + tests.
18. Overlay adapter (`site-pages.ts`) + handler + `existing_pages` + greenfield skip + inventory_limited fallback + tests.
19. Validate: `domain/validate/compose.ts`, `rules.ts`, handler + blocking-vs-warning matrix tests.
20. Publish extension: `db/blueprint-pages.ts` materialization + summary/ruleset/schema fields + lease-race replay test.
21. `phase4-acceptance.e2e.test.ts` (full route->run->drain, both halves real) + statement-budget regression + boundary script + README stage table.

## Verification

- Full gate per task: worker vitest suite, `tsc --noEmit`, boundary script.
- Acceptance e2e asserts the spec's Phase 4 list: reproducible membership, provisional->live-SERP->refine order, ruleset version recorded, score breakdown + evidence refs on every decision, no auto service-x-location, consolidate targets, no shared slugs/primary keywords, no double-counted addressable demand, `blueprint_pages` populated in revision 1.
- Apply migration to production `blueprint-db` (manual command per memory `feedback_prod_d1_migrations`) BEFORE worker deploy.
- 7-step staging->live workflow; staging smoke run (~$0.5-1.0 planned ceiling: content parsing 20 calls overestimated at $0.01, 1 site_ranked_urls, embeddings free) verifying: clusters populated with breakdowns, adjudications persisted, `blueprint_pages` rows > 0 with unique slugs, `estimated_traffic` now non-null for at least one competitor, stage `cost_usd_micro` non-zero for paid stages. Spot-check the unverified DFS field mappings (content_parsing extract paths, serp_competitors etv).
- Merge PR only on user "yes" after the smoke run, tag, DEPLOY.md entry, worker deploy from production HEAD (per the stub-rollback gotcha now documented in DEPLOY.md).

## Key risks

- Queue-consumer CPU on pairwise scoring: mitigated by 1500-keyword cap + deterministic blocking + `maxCandidatePairs`; measure in staging, lever is lowering `maxRetained` (ruleset bump).
- bge-m3 cosine distributions run high; `edgeThreshold` 0.62 may need raising after fixture benchmarking (it's a versioned constant with a drift test, so tuning is cheap).
- DFS response-shape assumptions (content_parsing extract paths, etv fields, search_intent_info coverage) are documented-assumption + staging spot-check, same convention as Phase 3.
- Refine will mostly emit `insufficient_evidence` until per-cluster SERPs (task 11) land; correct and visible, not a bug.
- ~40 content-parsing subrequests in one queue invocation; fallback is splitting batches across attempts using `parsed_competitor_pages` rows as progress markers.
