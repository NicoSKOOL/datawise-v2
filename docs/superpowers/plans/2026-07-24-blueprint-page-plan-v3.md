# Implementation plan: Blueprint page-plan v3

Spec: `docs/superpowers/specs/2026-07-24-blueprint-page-plan-v3.md`. Read it first; this plan is execution order only.

Branch: `fix/blueprint-page-plan-v3` off `fix/page-plan-keyword-naming` (which holds pp-v2, PR #119). Worker code in `datawise-seo-insight-main/workers/src/blueprint/`. TDD per task; full gate per task = blueprint vitest suite + `tsc --noEmit`; full worker suite + boundary script at phase ends.

## Phase A: foundation
1. Migration `db/migrations/2026-07-24-phase4b.sql` + `db/schema.sql` mirror + schema test update (schema_version 5): `keywords.excluded_reason` +'out_of_area'; `blueprint_pages.supporting_keywords_json TEXT`; `cluster_adjudications.case_type` +'variant_fold', +`resolved_by TEXT`.
2. Extract `cleanKeywordForNaming` (+ helpers) to `domain/keyword-naming.ts`; `page-plan/titles.ts` re-exports (public API unchanged). Naming rule constants move with it but stay referenced from BOTH rulesets per spec 3.1/3.5.
3. cluster-v3: `domain/clustering/ruleset.ts` gains `nameMerge` (on/off, near-name suffix tokens ['service','services','company','companies']) and `geo` lexicon (US state names+abbrevs, ~100 top US cities); version bump, drift hash re-pin, dependent test expectations cluster-v2 -> cluster-v3.

## Phase B: clustering half
4. `domain/clustering/refine.ts`: pre-SERP cleaned-name auto-merge + near-name merge, same-service (or both-unlinked) only, all hard constraints enforced; stats + tests (incl. "drain cleaning" vs "drain cleaning near me" merge WITHOUT live SERP evidence).
5. Stage 8 (`domain/clustering/universe.ts`): `geo_candidate` flag for keywords with non-brief state/city tokens; NOT excluded deterministically; exposed to adjudicator; tests.
6. `orchestration/stages.ts`: `validate_serps_and_questions` maxAttempts 40, backoff 60s; test.

## Phase C: page engine half
7. pp-v3 ruleset: naming fold, variant-fold generic modifier tokens ['service','services','company','companies','repair','repairs','local','professional','licensed'], supporting-keyword caps (store 20, export 10), adjudicator constants (model 'deepseek/deepseek-v4-flash', maxAdjudicationCalls 10, casesPerCall 40); version bump + drift re-pin + pp-v2 -> pp-v3 expectations.
8. `engine.ts` cleaned-name collision folds (spec 3.2): same parent + same cleaned name -> fold as section + cannibalization warning; numeric suffix never on cluster pages; tests (the `/resources/drain-cleaning-2/` case).
9. `engine.ts` service-variant fold (3.3a): serviceId + commercial/transactional + cleaned tokens subset of service tokens + generic modifiers -> fold into service page; borderline (subset fails only on 1 extra non-generic token) emits `variant_fold` adjudication case instead of minting; tests (all four "24 hour" variants fold; "commercial emergency plumbing service" borderline; "sewer drain jet cleaning service" stays separate-eligible).
10. `engine.ts` best-fit skeleton assignment second pass (3.3b): service pages take highest-volume service-token-matching folded keyword; location pages need city token + service/category token else templated fallback; home takes category term or null; claim map preserved; tests (head-term promotion; "shower installation austin" and bare "plumber" never claimed).
11. Supporting keywords (3.7): engine collects per-page member keywords minus primary, volume-ranked, cap 20; persist `supporting_keywords_json`; `exports/report-csv.ts` pipe-separated top 10 + new `supporting_keyword_count` column; `db/blueprint-reads.ts` surface; tests.

## Phase D: adjudicator
12. `orchestration/adjudicate-clusters.ts` new optional stage after refine: loads pending/insufficient_evidence adjudications + geo_candidates + variant_fold cases; batches (40/call, 10 calls max); `getLLMProvider(env, {provider:'openrouter', model})` + `chatCompleteEscalating`; temp 0, strict JSON, 1 retry then insufficient_evidence; hard rails validate every verdict (constraints for merges, spec 3.4 rule for exclusions, unknown ids discarded); apply accepted merges via existing merge code; set `excluded_reason='out_of_area'`; write decisions + resolved_by; provider_usage provider='openrouter' + budget reserve/reconcile via `db/budget.ts`; no OPENROUTER_API_KEY -> visible skip; fake LLM provider in test-support; tests (rails, caps, malformed JSON, key-absent skip, determinism via cached verdicts on re-drain).
13. Estimate: `CallPlanLine.provider` field, adjudication estimate line, `buildEstimateTotals` returns DFS + OpenRouter totals; route/SPA tolerant (additive); tests.

## Phase E: acceptance + UI
14. e2e acceptance updates: composite `cluster-v3+pp-v3`; new assertions mirroring spec section 6 (page count, no numeric suffixes, head-term promotion, no out-of-area pages, resources informational-only, supporting keywords non-empty, adjudicator usage rows, double-run determinism with fake LLM).
15. SPA canvas detail panel lists supporting keywords (read `supporting_keywords_json` via existing page payload); CSV export column already handled worker-side.

## Ship
- Full worker suite + tsc + boundary + SPA build.
- Commit per phase; PR into production (stacked on #119 or #119 merged first).
- Migration to production blueprint-db BEFORE worker deploy; worker deploy from canvas superset (merge this branch into `feat/blueprint-canvas-ui`), push canvas to `staging`.
- Staging smoke run per spec section 7; merge to production only on explicit user yes.
