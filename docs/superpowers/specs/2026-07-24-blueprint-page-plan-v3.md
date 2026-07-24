# Blueprint page-plan v3: correct site map structure, correct keywords per page

**Date:** 2026-07-24
**Status:** Approved direction from Nico ("spec it out first then fix it"); this document is the spec.
**Rulesets:** cluster-v2 -> cluster-v3, pp-v2 -> pp-v3. Schema v4 -> v5.

## 1. Problem

The Aqua Plumbing sample export (blueprint.csv, run post-pp-v2) proposed 30 pages where a correct plan is roughly 10. Observed defects, each traced to code:

| # | Defect (CSV evidence) | Root cause (file) |
|---|----------------------|-------------------|
| D1 | Same query intent split into 3-6 pages: four "24 hour emergency plumbing" variants, five "drain cleaning" variants, `/resources/drain-cleaning-2/` slug | Clusters never merged: live SERP overlap was unavailable (see D5), semantic-only merge floor 0.85 keeps variants apart, and the page engine's cannibalization guard compares raw primary keywords for exact equality only (`engine.ts` claimedPrimaryKeyword). Identical CLEANED names get a `-2` suffix instead of folding. |
| D2 | Head term "drain cleaning" (90,500) landed on `/resources/drain-cleaning/` while `/services/drain-cleaning/` carries "austin drain" (90, informational) | `mapDedicatedPageType` falls through to `resource` for any commercial cluster; skeleton service pages claim their primary keyword from whichever cluster folds in first (highest addressable volume wins the race, `foldInto`), not from best fit. |
| D3 | Out-of-area city pages: Dallas, Milwaukee, Omaha, Plano, Round Rock, Arvada for an Austin-only business | Stage 8 links keywords to brief service areas by token match but has no concept of "this keyword names a DIFFERENT city". No geo lexicon, no exclusion path. Known stage-8 relevance follow-up, now proven in output. |
| D4 | Junk skeleton keywords: home = "plumber" (550,000), Austin location page = "shower installation austin" (10) | Same foldInto race as D2: first folded cluster claims the page keyword with no fit requirement. |
| D5 | `validate_serps_and_questions` skipped, `refine_clusters` partial on the sample run | The stage polls DFS SERP tasks with maxAttempts 12 x 30s backoff (~6 min budget); real SERP tasks routinely take longer, the stage exhausts retries and, being optional, is marked skipped. refine then has liveSnapshotCoverage 0 -> partial, and every merge case lands as `insufficient_evidence`. |
| D6 | `supporting_keywords` column is a bare count (member_count of the first cluster), not keywords | No code anywhere produces a per-page secondary keyword list (`exports/report-csv.ts`, `db/blueprint-reads.ts:342`). |

Product intent (Nico, 2026-07-24): the tool must produce the correct site map structure AND the correct main keyword plus secondary keywords for every page. AI reasoning is welcome where deterministic rules cannot decide, but only inside hard rules.

## 2. Goals / non-goals

Goals:
1. One page per query intent. Variants ("near me", "services", "24/7" spellings) consolidate into one page as supporting keywords.
2. Head terms live on service pages. `/resources/` is reserved for informational, question-led, and comparison content.
3. No pages for cities outside the brief's service areas.
4. Every page gets a best-fit primary keyword and a ranked secondary keyword list.
5. SERP validation actually completes on real runs.
6. Ambiguity (distinct offering vs variant, out-of-area vs in-area, merge-or-not) resolved by a bounded LLM adjudicator whose verdicts are constrained and validated by deterministic rules.

Non-goals:
- No change to research stages 1-7 (evidence collection).
- No change to the doorway/service-location guardrails (they worked: only the two earned Austin pages minted).
- `synthesize_page_briefs` and `collect_us_fanout` stay Phase 5 stubs.
- No UI redesign; canvas just displays the improved data (supporting keywords in the detail panel and export).

## 3. Design

### 3.1 Deterministic cluster dedupe by cleaned name (cluster-v3, fixes D1 at the source)

In `refine_clusters`, BEFORE the SERP-evidence pass: any two clusters linked to the same service (or both unlinked) whose `cleanKeywordForNaming(primaryKeyword)` values are equal after normalization are auto-merged, subject to the existing hard constraints (branded/generic, cross-service, national-informational). Rationale: "drain cleaning" vs "drain cleaning near me" cleaning to the same name IS the duplicate-intent signal; no SERP data needed. The cleaner moves (or is re-exported) so clustering code can import it without a page-plan dependency: extract to `domain/keyword-naming.ts`, re-export from `page-plan/titles.ts` (public API unchanged).

Additionally, near-name merges (cleaned names differ only by a plural/"service"/"services"/"company" suffix token) are auto-merged under the same constraints. Token list lives in the cluster ruleset.

### 3.2 Page engine: cleaned-name collision folds, never suffixes (pp-v3, backstop for D1)

In `createDedicatedPage`: before minting, if another non-skeleton page already exists with the same parent and the same cleaned name, fold the cluster into that page as a section and emit a `cannibalization_risk` warning. The `-2` slug dedupe remains only as a final safety net for skeleton/hub collisions; a cluster page must never receive a numeric suffix.

### 3.3 Service-variant folding + head-term promotion (pp-v3, fixes D2/D4)

Two changes to placement:

a) **Service-variant fold rule.** A cluster with a `serviceId` link and commercial or transactional intent whose cleaned keyword tokens are a subset of {service name tokens} + {generic modifier tokens: service, services, company, companies, repair, repairs, local, professional, licensed, emergency-when-the-service-is-emergency-X} folds into its service page regardless of strong-signal count. It never mints a `/resources/` page. Genuinely distinct offerings ("commercial emergency plumbing", "sewer drain jet cleaning") do not match the subset test and still follow the normal separate-page rules; ambiguous cases go to the adjudicator (3.5).

b) **Best-fit skeleton keyword assignment (second pass).** `foldInto` no longer claims `page.primaryKeyword` first-come-first-served. After all placements, an assignment pass gives each page its primary keyword:
   - Service page: highest-volume keyword among its folded clusters whose tokens contain the service name tokens (so `/services/drain-cleaning/` gets "drain cleaning" at 90,500).
   - Location page: highest-volume cluster keyword containing the city token plus a service/category token ("plumber austin" style). If none, fall back to templated "{category} {city}" with null volume rather than claiming junk like "shower installation austin".
   - Home: the brief category keyword if a matching cluster exists; otherwise null primary keyword (home targets the brand). Never claim a bare head term like "plumber" (550,000) that the business cannot win and that belongs to no page.
   - Dedicated cluster pages keep their own cluster's keyword (unchanged).
   Claim-uniqueness (one page per keyword) is enforced across the assignment pass exactly as today.

### 3.4 Out-of-area exclusion (stage 8 + adjudicator, fixes D3)

Deterministic part (stage 8, cluster-v3): a keyword that token-contains a brief service-area city is linked (unchanged). A keyword that contains a US state abbreviation/name token or a token matching a small built-in list of high-frequency US city names, none of which match any brief service area, is flagged `geo_candidate`. Flagged keywords are NOT excluded deterministically (the lexicon cannot be complete and "plano" could be a brand word); they go to the adjudicator.

Adjudicator part: the LLM confirms or rejects `out_of_area` for flagged keywords. Hard rule: the LLM may only exclude a keyword that (i) was flagged `geo_candidate` and (ii) token-matches NO brief service area. It can never exclude an in-area or unflagged keyword. Accepted exclusions set `keywords.excluded_reason = 'out_of_area'` (new CHECK value, migration below) and drop the keyword from clustering; a cluster whose remaining volume hits zero is dropped with a visible warning.

### 3.5 LLM adjudication stage (new stage `adjudicate_clusters`)

New optional stage between `refine_clusters` and `parse_competitor_pages`. Deterministic in orchestration, bounded in cost, AI only inside hard rails.

- **Inputs:** `cluster_adjudications` rows with decision `pending` or `insufficient_evidence` (merge / split / intent_exception cases), plus `geo_candidate` flags from 3.4, plus service-variant borderline cases emitted by 3.3a (new case_type `variant_fold`).
- **Model + plumbing:** `getLLMProvider(env, { provider: 'openrouter', model: BLUEPRINT_ADJUDICATOR_MODEL })` with the env-key fallback (`env.OPENROUTER_API_KEY`), called through `chatCompleteEscalating` (mandatory per the token-starvation rule). Model constant starts as `deepseek/deepseek-v4-flash` (same as gap-analysis; cheap, strong enough for classification). Temperature 0. Strict JSON output, validated; malformed responses retried once then the batch falls back to `insufficient_evidence` (never blocks the run).
- **Batching + caps:** up to 40 cases per call, hard cap `maxAdjudicationCalls` per run (ruleset, start 10). Beyond the cap, remaining cases stay `pending` with an `adjudications_capped` warning. If `env.OPENROUTER_API_KEY` is absent the stage is a no-op skip with a visible reason.
- **Hard rails (deterministic validation of every verdict):** merges must satisfy every existing hard constraint (branded/generic, cross-service, national-informational); exclusions must satisfy 3.4's rule; verdicts referencing unknown ids are discarded. The LLM chooses among allowed actions; it never invents keywords, pages, or slugs.
- **Persistence:** verdicts update `cluster_adjudications.decision` to `accepted`/`rejected` with `resolved_at`; accepted merges are applied by the same deterministic merge code as refine; usage recorded to `provider_usage` with `provider='openrouter'`, cost reserved and reconciled through the existing `db/budget.ts` openrouter columns (schema already supports this).
- **Estimate:** `CallPlanLine` gains a `provider` field (`'dataforseo' | 'openrouter'`); the planner adds an adjudication line (estimated cases x per-call price, overestimated). `buildEstimateTotals` reports a DFS total and an OpenRouter total; run creation already accepts `acceptedOpenRouterCeilingUsd`.

### 3.6 Reliable SERP validation (fixes D5)

`validate_serps_and_questions` gets stage-specific retry budget: maxAttempts 40 with 60s backoff (~40 min ceiling) instead of 12 x 30s. `SerpTasksPendingError` polls are cheap (no new DFS spend). refine's `no_live_serp_evidence` partial remains, but with 3.1's name-based dedupe the plan is correct even when SERPs are late; live SERP evidence then improves merges rather than being the only thing preventing duplicates.

### 3.7 Supporting keywords per page (fixes D6)

The page-plan engine records, per page, `supportingKeywords`: all member keywords of the page's clusters (dedicated cluster plus folded section clusters), minus the page's primary keyword, ranked by volume, capped at 20 (ruleset). Persisted in `blueprint_pages` as `supporting_keywords_json` (migration below). Export changes: the CSV `supporting_keywords` column becomes a pipe-separated list of the top 10 ("drain cleaning near me (74000)|clogged drain...`" format: keyword only, no volume, to stay spreadsheet-friendly); a new `supporting_keyword_count` column preserves the old number. Canvas detail panel lists them (read from the same field; minimal UI change).

## 4. Migration (schema v5)

`db/migrations/2026-07-24-phase4b.sql` + mirrored in `db/schema.sql` + schema test:
- `keywords.excluded_reason` CHECK gains `'out_of_area'` (SQLite: table rebuild or CHECK-free approach consistent with existing migration style).
- `blueprint_pages.supporting_keywords_json TEXT` (nullable).
- `cluster_adjudications.case_type` CHECK gains `'variant_fold'`; add `resolved_by TEXT` (`'rules' | 'llm'`) nullable.
- `schema_version -> 5` with the CAST guard.
Apply to production `blueprint-db` manually (per `feedback_prod_d1_migrations`) BEFORE worker deploy.

## 5. Ruleset changes

- **cluster-v3:** cleaned-name auto-merge on, near-name suffix token list, `geo_candidate` state lexicon (US states + top-cities list), drift hash re-pinned.
- **pp-v3:** cleaned-name collision folds, service-variant fold rule + generic modifier token list, best-fit skeleton assignment on, supporting keyword cap 20/export 10, adjudicator model constant + `maxAdjudicationCalls` 10 + per-call case cap 40. Drift hash re-pinned. Composite becomes `cluster-v3+pp-v3`.

## 6. Acceptance criteria (measured on a fresh Aqua Plumbing sample run)

1. Total pages <= 12 (was 30). No slug carries a numeric suffix.
2. `/services/drain-cleaning/` primary keyword = "drain cleaning" (90,500); `/services/emergency-plumbing/` primary = "emergency plumbing" (60,500); all "near me"/"services"/"24 hour" variants appear as those pages' supporting keywords.
3. Zero pages whose keyword names a city outside the brief service areas; those keywords show `excluded_reason='out_of_area'` or sit in a rejected adjudication with a reason.
4. `/resources/` contains only informational, question-led, or comparison pages.
5. Home primary keyword is null or the category term with a fit rationale; location page primary contains the city token.
6. Every non-skeleton page exports a non-empty supporting keyword list.
7. Adjudicator: provider_usage rows with provider='openrouter' exist, total cost <= the accepted ceiling, every accepted merge passes hard constraints (asserted in e2e with a fake provider).
8. Determinism: two runs over identical evidence produce byte-identical page plans (LLM calls mocked in tests; live runs cache adjudication verdicts in the run record so re-drains do not re-ask).

## 7. Verification plan

- TDD throughout; new unit suites for naming-merge, variant fold, best-fit assignment, adjudicator rails (fake LLM provider in test-support).
- Full worker vitest + tsc + blueprint boundary script.
- Migration applied to production blueprint-db before worker deploy.
- Staging smoke: fresh sample run (DFS mostly cached from prior runs; LLM cost expected < $0.10), verify acceptance criteria 1-6 against the export CSV, criterion 7 via D1 query.
- Ship via the 7-step staging->live workflow; merge only on explicit user yes.

## 8. Risks

- Over-merging returns (mega-cluster history): mitigated because name-based merges still respect every hard constraint and only apply within a service; drift tests pin the rules.
- LLM verdict quality: rails mean the worst case equals today's behavior (case stays pending); temperature 0 + strict JSON + one retry bounds flakiness.
- SERP polling ceiling still finite: acceptable; the plan no longer depends on SERPs for correctness (3.1).
- Estimate model change (provider field) touches the projects route contract: additive field, SPA tolerates unknown fields.
