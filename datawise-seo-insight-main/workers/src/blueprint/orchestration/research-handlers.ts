import type { StageContext, StageHandler } from './handlers';
import type { KeywordCandidate, KeywordUniverse, MergedKeyword } from '../contracts/types';
import { BlueprintApiError } from '../domain/api-errors';
import { safeErrorMessage } from '../providers/dataforseo/envelope';
import { loadStageOutput } from './stage-io';
import type { ResolvedMarket } from '../providers/dataforseo/catalogs';
import { loadDfsCostEstimates } from '../providers/dataforseo/costs';
import {
  fetchKeywordIdeas,
  fetchKeywordSuggestions,
  fetchKeywordsForSite,
  enrichMissingMetrics,
} from '../providers/dataforseo/keywords';
import { buildSeedQueries } from '../domain/seeds';
import type { SeedQuery } from '../domain/seeds';
import { V1_LIMITS } from '../contracts/limits';
import { mergeKeywordCandidates } from '../domain/merge';
import { normalizeKeyword } from '../domain/keyword';
import { normalizeDomain } from '../domain/url';
import { newId, usdToMicro } from '../db/util';
import {
  discoverCompetitorsForDomain,
  discoverSerpCompetitors,
  filterCompetitorCandidates,
  isExcludedCompetitorDomain,
  fetchRankedKeywords,
  fetchRelevantPages,
} from '../providers/dataforseo/competitors';
import type { CompetitorCandidate, RelevantPageRecord } from '../providers/dataforseo/competitors';
import { postSerpTasks, collectSerpTasks, SerpTasksPendingError } from '../providers/dataforseo/serp';
import type { SerpQuery } from '../providers/dataforseo/serp';

// Catalog Sec 3: max 8 keyword_suggestions seeds per run (one per
// service-in-primary-area seed). This module is the home for every real
// research (evidence-collection) stage handler from Task 10 onward, keeping
// handlers.ts itself limited to registration + the lighter Phase 2 stages
// it already owns.
const MAX_SUGGESTIONS_SEEDS = 8;

export interface CollectKeywordEvidenceOutput {
  candidateCount: number;
  mergedCount: number;
  persistedCount: number;
  enrichmentTruncated: boolean;
  sources: Record<string, number>;
  stageCostUsdMicro: number;
}

// Groups every seed query by its OWN normalizeKeyword(locale) text (not the
// coarser lowercasing buildSeedQueries applies to its own dedup), because a
// merged keyword's normalizedKeyword is always produced by that same
// function. Multiple distinct seeds (different service/area) can collapse
// onto one normalized key; every one of them contributes its service/area
// provenance to that keyword's join rows.
function groupSeedsByNormalizedQuery(seeds: SeedQuery[], locale: string): Map<string, SeedQuery[]> {
  const byNormalized = new Map<string, SeedQuery[]>();
  for (const seed of seeds) {
    const normalized = normalizeKeyword(seed.query, locale);
    if (!normalized) continue;
    const existing = byNormalized.get(normalized);
    if (existing) existing.push(seed);
    else byNormalized.set(normalized, [seed]);
  }
  return byNormalized;
}

// Catalog Sec 3 retention rule: every user-declared seed (category, service,
// service-in-primary-area) must survive into the keyword universe even when
// no provider returned it, so a business's own core terms are never silently
// dropped just because Keyword Ideas/Suggestions had nothing to say about
// them. Appended with all-null metrics (never 0 -- a real miss, not a
// confirmed zero) and no evidence (there is none), per handoff Sec 3.
function appendMissingUserSeeds(universe: KeywordUniverse, seeds: SeedQuery[], locale: string): KeywordUniverse {
  const present = new Set(universe.keywords.map((k) => k.normalizedKeyword));
  const appended: MergedKeyword[] = [];
  const seenNormalized = new Set<string>();
  for (const seed of seeds) {
    const normalized = normalizeKeyword(seed.query, locale);
    if (!normalized || present.has(normalized) || seenNormalized.has(normalized)) continue;
    seenNormalized.add(normalized);
    appended.push({
      normalizedKeyword: normalized,
      variants: [seed.query],
      sources: ['user_seed'],
      metrics: { searchVolume: null, cpcUsd: null, difficulty: null },
      evidenceRefs: [],
    });
  }
  return { keywords: [...universe.keywords, ...appended] };
}

// Shared by BOTH collect_keyword_evidence (Task 10, seed-query provenance:
// which service/service-area seed produced this keyword) and
// collect_competitor_evidence (Task 12, no seed provenance at all -- a
// keyword discovered via a competitor's ranked keywords has no
// service/service-area of its own to join). `seedProvenance` defaults to an
// empty map so a caller with nothing to report (Task 12) simply skips the
// keyword_services/keyword_service_areas inserts, while Task 10 passes its
// real seed-grouped map and behaves exactly as before this extraction.
// Idempotent and merge-safe by construction (ON CONFLICT DO NOTHING + a
// re-read of the existing row's id): calling this twice for the same run
// with overlapping keywords -- whether from two collect_keyword_evidence
// retries, or from Task 10 and Task 12 both touching the same normalized
// keyword -- never violates UNIQUE(run_id, normalized_keyword); the second
// caller's evidence just gets attached (INSERT OR IGNORE) to the row the
// first caller already created.
async function persistKeywordCandidates(
  d1: D1Database,
  runId: string,
  universe: KeywordUniverse,
  seedProvenance: Map<string, SeedQuery[]> = new Map()
): Promise<number> {
  let persistedCount = 0;

  for (const kw of universe.keywords) {
    const displayKeyword = kw.variants[0] ?? kw.normalizedKeyword;
    const searchVolume = kw.metrics.searchVolume;
    const cpcUsdMicro = kw.metrics.cpcUsd != null ? usdToMicro(String(kw.metrics.cpcUsd)) : null;
    const difficulty = kw.metrics.difficulty;
    const metricsMissing = searchVolume === null || kw.metrics.cpcUsd === null || difficulty === null ? 1 : 0;

    await d1
      .prepare(
        `INSERT INTO keywords
          (id, run_id, display_keyword, normalized_keyword, search_volume, cpc_usd_micro, keyword_difficulty, metrics_missing)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, normalized_keyword) DO NOTHING`
      )
      .bind(newId('kw'), runId, displayKeyword, kw.normalizedKeyword, searchVolume, cpcUsdMicro, difficulty, metricsMissing)
      .run();

    // Re-read the id: either the row this INSERT just created, or (on a
    // retry landing after a partial prior write for this same stage
    // attempt hash) the row an earlier attempt already committed.
    const row = await d1
      .prepare(`SELECT id FROM keywords WHERE run_id = ? AND normalized_keyword = ?`)
      .bind(runId, kw.normalizedKeyword)
      .first<{ id: string }>();
    if (!row) continue;
    const keywordId = row.id;
    persistedCount += 1;

    const provenances = seedProvenance.get(kw.normalizedKeyword) ?? [];
    const serviceIds = new Set(provenances.map((p) => p.serviceId).filter((id): id is string => id != null));
    const serviceAreaIds = new Set(
      provenances.map((p) => p.serviceAreaId).filter((id): id is string => id != null)
    );
    for (const serviceId of serviceIds) {
      await d1
        .prepare(`INSERT OR IGNORE INTO keyword_services (keyword_id, service_id) VALUES (?, ?)`)
        .bind(keywordId, serviceId)
        .run();
    }
    for (const serviceAreaId of serviceAreaIds) {
      await d1
        .prepare(`INSERT OR IGNORE INTO keyword_service_areas (keyword_id, service_area_id) VALUES (?, ?)`)
        .bind(keywordId, serviceAreaId)
        .run();
    }
    for (const evidenceRefId of new Set(kw.evidenceRefs)) {
      await d1
        .prepare(`INSERT OR IGNORE INTO keyword_evidence_refs (keyword_id, evidence_ref_id) VALUES (?, ?)`)
        .bind(keywordId, evidenceRefId)
        .run();
    }
  }

  return persistedCount;
}

// Real collect_keyword_evidence, not a stub: fans out to Keyword Ideas
// (all seeds), Keyword Suggestions (one call per service-in-primary-area
// seed, catalog-capped at 8), and Keywords For Site (existing_site mode
// only), merges everything into one deduped KeywordUniverse, guarantees
// every user seed survives even with zero provider data, fills missing
// metrics via enrichMissingMetrics, and persists the result into keywords +
// its three join tables. Required stage (stages.ts): resolve_market must
// have already succeeded -- that can only be missing on a broken run, never
// a normal one, hence the provider_invalid_response throw rather than a
// silent skip.
export const collectKeywordEvidenceHandler: StageHandler = async (ctx: StageContext) => {
  const market = await loadStageOutput<ResolvedMarket>(ctx.d1, ctx.runId, 'resolve_market');
  if (!market) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }

  const costs = await loadDfsCostEstimates(ctx.env.KV);
  const { seeds } = buildSeedQueries(ctx.normalizedBrief, {
    maxTotalSeeds: V1_LIMITS.maxSeedQueries,
    includePrimaryAreaSeeds: true,
  });

  let stageCostUsdMicro = 0;
  const sources: KeywordCandidate[][] = [];
  const sourceCounts: Record<string, number> = {};
  const recordSource = (source: string, candidates: KeywordCandidate[]) => {
    sources.push(candidates);
    sourceCounts[source] = (sourceCounts[source] ?? 0) + candidates.length;
  };

  if (seeds.length > 0) {
    const ideaQueries = [...new Set(seeds.map((s) => s.query))];
    const ideas = await fetchKeywordIdeas(ctx, market, ideaQueries, costs);
    stageCostUsdMicro += ideas.costUsdMicro;
    recordSource('keyword_ideas', ideas.candidates);
  }

  const primaryAreaSeeds = seeds.filter((s) => s.source === 'service_primary_area').slice(0, MAX_SUGGESTIONS_SEEDS);
  for (const seed of primaryAreaSeeds) {
    const suggestions = await fetchKeywordSuggestions(ctx, market, { query: seed.query, serviceId: seed.serviceId }, costs);
    stageCostUsdMicro += suggestions.costUsdMicro;
    recordSource('keyword_suggestions', suggestions.candidates);
  }

  if (ctx.normalizedBrief.mode === 'existing_site' && ctx.normalizedBrief.websiteDomain) {
    const domain = normalizeDomain(ctx.normalizedBrief.websiteDomain);
    const site = await fetchKeywordsForSite(ctx, market, domain, costs);
    stageCostUsdMicro += site.costUsdMicro;
    recordSource('keywords_for_site', site.candidates);
  }

  const candidateCount = sources.reduce((sum, batch) => sum + batch.length, 0);

  const locale = `${ctx.normalizedBrief.languageCode}-${ctx.normalizedBrief.countryIso}`;
  const mergedRaw = mergeKeywordCandidates(sources, locale);
  const withUserSeeds = appendMissingUserSeeds(mergedRaw, seeds, locale);

  const { universe: enriched, enrichmentTruncated, costUsdMicro: enrichmentCostUsdMicro } = await enrichMissingMetrics(
    ctx,
    market,
    withUserSeeds,
    costs
  );
  stageCostUsdMicro += enrichmentCostUsdMicro;

  const mergedCount = enriched.keywords.length;
  const seedProvenance = groupSeedsByNormalizedQuery(seeds, locale);
  const persistedCount = await persistKeywordCandidates(ctx.d1, ctx.runId, enriched, seedProvenance);

  const output: CollectKeywordEvidenceOutput = {
    candidateCount,
    mergedCount,
    persistedCount,
    enrichmentTruncated,
    sources: sourceCounts,
    stageCostUsdMicro,
  };

  // A truncated enrichment pass means some keywords in this universe never
  // got a chance at their missing metrics -- a real, declared gap that must
  // surface as a stage-level 'partial' (not a silent 'succeeded'), per the
  // enrichmentTruncated flag's own doc comment in providers/dataforseo/
  // keywords.ts.
  return { output, status: enrichmentTruncated ? 'partial' : 'succeeded' };
};

// Catalog Sec 8: "V1 normally 20-100 high-relevance commercial/local terms"
// and "Max 200 representative keywords" -- the handler itself caps the
// greenfield seed list at 100 (the adapter's own 200 ceiling is a defensive
// backstop, not the intended operating point).
const MAX_GREENFIELD_SERP_KEYWORDS = 100;

// Final selected-competitor ceiling (catalog Sec 7/8: "selecting 3-5").
const MAX_SELECTED_COMPETITORS = 5;

export interface DiscoverCompetitorsOutput {
  candidateCount: number;
  selectedDomains: string[];
  // Known competitors the guard dropped (own domain / excluded directory
  // domain). Never persisted; surfaced so the UI/final review can tell the
  // user their entry was not usable rather than silently ignoring it.
  droppedKnownCompetitors: string[];
  stageCostUsdMicro: number;
}

// Reuses an existing (run_id, domain) row rather than blindly inserting: the
// only UNIQUE index on this table is the partial one on selected=1
// (db/schema.sql), so a retried stage attempt re-running this same insert
// path would otherwise create a second, still-selected=0, duplicate row for
// a domain it already persisted last attempt. A single stage lease only
// ever runs one attempt at a time (db/leases.ts), so this
// select-then-insert is race-free in practice, not just in these tests.
async function upsertCompetitorRow(
  d1: D1Database,
  runId: string,
  domain: string,
  source: string,
  visibilityMetric: number | null
): Promise<string> {
  const existing = await d1
    .prepare(`SELECT id FROM competitors WHERE run_id = ? AND domain = ?`)
    .bind(runId, domain)
    .first<{ id: string }>();
  if (existing) return existing.id;

  const id = newId('comp');
  await d1
    .prepare(
      `INSERT INTO competitors (id, run_id, domain, source, selected, visibility_score)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .bind(id, runId, domain, source, visibilityMetric)
    .run();
  return id;
}

// Controller-approved deviation from the brief's literal "user-supplied
// competitors are ALWAYS kept": known competitors are still exempt from the
// visibility ranking and never compete against the 5-cap, but two hard
// drops apply -- (a) equal to the project's own domain, (b) matching
// EXCLUDED_COMPETITOR_DOMAINS (same subdomain-aware match as discovered
// candidates). Dropped entries are NOT persisted and are returned so the
// handler output can surface them to the UI/final review.
function partitionKnownCompetitors(
  knownCompetitorDomains: string[],
  ownDomain: string | null
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const domain of new Set(knownCompetitorDomains)) {
    if ((ownDomain && domain === ownDomain) || isExcludedCompetitorDomain(domain)) dropped.push(domain);
    else kept.push(domain);
  }
  return { kept, dropped };
}

// Persists every surviving discovered candidate (selected = 0) plus any
// guard-surviving user-supplied known competitor not already among them,
// then flips selected = 1 for: every kept known competitor (uncapped),
// plus as many of the remaining discovered candidates, ranked by
// visibilityMetric (desc, nulls last), as it takes to reach
// MAX_SELECTED_COMPETITORS.
//
// Retry safety against uq_selected_competitor_domain (run_id, domain)
// WHERE selected = 1 has two layers: (1) the whole run's previous selection
// is reset to 0 in one UPDATE before the new one is applied, so a prior
// attempt's stale winner that no longer makes the cut can never linger as
// selected; (2) the flip to selected = 1 is itself an UPDATE on the
// already-persisted row (never a second INSERT), so re-selecting a domain
// is a no-op rather than a constraint violation.
async function persistCompetitors(
  d1: D1Database,
  runId: string,
  filtered: CompetitorCandidate[],
  keptKnownDomains: string[]
): Promise<{ selectedDomains: string[] }> {
  for (const candidate of filtered) {
    const id = await upsertCompetitorRow(d1, runId, candidate.domain, candidate.source, candidate.visibilityMetric);
    await d1
      .prepare(`INSERT OR IGNORE INTO competitor_evidence_refs (competitor_id, evidence_ref_id) VALUES (?, ?)`)
      .bind(id, candidate.evidenceRefId)
      .run();
  }

  const knownSet = new Set(keptKnownDomains);
  for (const domain of knownSet) {
    // Already persisted above if the DFS candidate pool also surfaced this
    // domain; upsertCompetitorRow is idempotent either way.
    await upsertCompetitorRow(d1, runId, domain, 'user_seed', null);
  }

  // Stable sort (desc by visibilityMetric, nulls last) over ONLY the
  // discovered candidates not already guaranteed selected as a known
  // competitor, so a known competitor is never double-counted against the
  // MAX_SELECTED_COMPETITORS cap.
  const ranked = filtered
    .filter((c) => !knownSet.has(c.domain))
    .slice()
    .sort((a, b) => {
      if (a.visibilityMetric === b.visibilityMetric) return 0;
      if (a.visibilityMetric === null) return 1;
      if (b.visibilityMetric === null) return -1;
      return b.visibilityMetric - a.visibilityMetric;
    });

  const selectedDomains = new Set<string>(knownSet);
  for (const candidate of ranked) {
    if (selectedDomains.size >= MAX_SELECTED_COMPETITORS) break;
    selectedDomains.add(candidate.domain);
  }

  // Reset-then-apply: wipe the run's entire previous selection in one
  // statement so this attempt's selection fully REPLACES any prior
  // attempt's (a domain selected last attempt but absent from this
  // attempt's top 5 must not stay selected).
  await d1
    .prepare(`UPDATE competitors SET selected = 0 WHERE run_id = ? AND selected = 1`)
    .bind(runId)
    .run();

  for (const domain of selectedDomains) {
    await d1
      .prepare(`UPDATE competitors SET selected = 1 WHERE run_id = ? AND domain = ?`)
      .bind(runId, domain)
      .run();
  }

  return { selectedDomains: [...selectedDomains] };
}

// Real discover_competitors, not a stub. Optional stage (stages.ts): a throw
// here degrades the run to 'partial' via the processor's own optional-stage
// handling, it never fails the whole run -- so this only throws for a
// genuinely broken precondition (missing resolve_market output) or a hard
// provider failure, never for "zero competitors found" (a legitimate empty
// result). existing_site mode discovers via the target's own domain
// competitors; greenfield mode has no target domain to compare against, so
// it discovers via the service-in-primary-area seed queries (the same
// population Task 10's collect_keyword_evidence uses for keyword_suggestions),
// capped at MAX_GREENFIELD_SERP_KEYWORDS.
export const discoverCompetitorsHandler: StageHandler = async (ctx: StageContext) => {
  const market = await loadStageOutput<ResolvedMarket>(ctx.d1, ctx.runId, 'resolve_market');
  if (!market) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }

  const costs = await loadDfsCostEstimates(ctx.env.KV);
  const brief = ctx.normalizedBrief;
  const ownDomain = brief.websiteDomain;

  let candidates: CompetitorCandidate[];
  if (brief.mode === 'existing_site' && ownDomain) {
    candidates = await discoverCompetitorsForDomain(ctx, market, ownDomain, costs);
  } else {
    const { seeds } = buildSeedQueries(brief, {
      maxTotalSeeds: V1_LIMITS.maxSeedQueries,
      includePrimaryAreaSeeds: true,
    });
    const keywords = seeds
      .filter((s) => s.source === 'service_primary_area')
      .map((s) => s.query)
      .slice(0, MAX_GREENFIELD_SERP_KEYWORDS);
    candidates = keywords.length > 0 ? await discoverSerpCompetitors(ctx, market, keywords, costs) : [];
  }

  const filtered = filterCompetitorCandidates(candidates, ownDomain);
  const { kept: keptKnownDomains, dropped: droppedKnownCompetitors } = partitionKnownCompetitors(
    brief.knownCompetitorDomains,
    ownDomain
  );
  const { selectedDomains } = await persistCompetitors(ctx.d1, ctx.runId, filtered, keptKnownDomains);

  // Adapters here return bare CompetitorCandidate[] (no cost side-channel,
  // unlike keywords.ts's KeywordFetchResult), so this stage's real spend is
  // read back from provider_usage instead of accumulated inline: every real
  // (non-cache-hit) blueprintDfsCall this handler makes writes exactly one
  // provider_usage row tagged with ctx.stage (call.ts step 8).
  const costRow = await ctx.d1
    .prepare(`SELECT COALESCE(SUM(cost_usd_micro), 0) AS total FROM provider_usage WHERE run_id = ? AND stage = ?`)
    .bind(ctx.runId, ctx.stage)
    .first<{ total: number }>();

  const output: DiscoverCompetitorsOutput = {
    candidateCount: filtered.length,
    selectedDomains,
    droppedKnownCompetitors,
    stageCostUsdMicro: costRow?.total ?? 0,
  };

  return { output, status: 'succeeded' as const };
};

// Phase 4 reads `topPages` off of THIS stage's output directly (not off any
// table), per this task's brief -- relevant_pages results are not persisted
// into their own table this phase, only surfaced here.
export interface CollectCompetitorEvidenceOutput {
  perCompetitor: Array<{
    domain: string;
    rankedCount: number | null;
    pagesCount: number | null;
    topPages: RelevantPageRecord[];
  }>;
  stageCostUsdMicro: number;
}

// Catalog Sec 10: "V1 cap 100 per selected competitor" -- the adapter's own
// `limit: 100` request already caps the provider response at this ceiling,
// but topPages is capped again defensively here at the boundary Phase 4
// actually reads.
const MAX_TOP_PAGES = 100;

// Account-wide DataForSEO conditions that no per-competitor isolation can
// route around: whichever competitor's call hits one of these first, every
// OTHER competitor's remaining calls this attempt would burn are guaranteed
// to hit the exact same wall. Mirrors collectSerpTasks's own account-wide
// classification (providers/dataforseo/serp.ts) with 'budget_exceeded' added
// -- a per-run DataForSEO budget ceiling is exactly as account-wide as a
// provider quota/rate-limit wall, and reserveProviderBudget/
// assertRunWithinBudget throw it as a BlueprintApiError the same way. Any
// other error (including provider_timeout and a genuine per-task DFS
// failure) stays isolated to that one competitor/field, per this handler's
// existing per-competitor try/catch design below.
function isAccountWideProviderError(err: unknown): boolean {
  return (
    err instanceof BlueprintApiError &&
    (err.code === 'provider_quota_exhausted' ||
      err.code === 'provider_rate_limited' ||
      err.code === 'budget_exceeded')
  );
}

// Real collect_competitor_evidence, not a stub. Optional stage (stages.ts):
// even so, this handler does NOT rely on the processor's optional-stage
// throw-to-partial behavior for per-competitor failures -- with up to 5
// selected competitors, a single provider hiccup on one of them must not
// discard the ranked keywords/pages evidence this handler already collected
// for every OTHER competitor. So each competitor's two calls (ranked
// keywords, relevant pages) are individually try/caught; a failure records
// that one field as null on that competitor's row and flips the whole
// stage's returned status to 'partial', but the loop keeps going -- UNLESS
// the caught error is account-wide (isAccountWideProviderError above:
// provider_quota_exhausted, provider_rate_limited, budget_exceeded), in
// which case it is rethrown instead of swallowed: those conditions are not
// "one competitor's bad luck", they mean every remaining call this attempt
// would make is guaranteed to fail the same way, so the whole stage attempt
// should land in retry_wait/fail with that code rather than quietly report
// 'partial' with every remaining competitor's fields left null.
//
// Reads selected competitors directly from the `competitors` table (not
// from discover_competitors' stage output) because `selected = 1` is the
// live, retry-safe source of truth discoverCompetitorsHandler itself
// maintains (including its own reset-then-apply retry safety); re-deriving
// the same list from a possibly-stale stage output would risk drifting from
// it.
export const collectCompetitorEvidenceHandler: StageHandler = async (ctx: StageContext) => {
  const market = await loadStageOutput<ResolvedMarket>(ctx.d1, ctx.runId, 'resolve_market');
  if (!market) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }

  const costs = await loadDfsCostEstimates(ctx.env.KV);
  const selectedRows = await ctx.d1
    .prepare(`SELECT id, domain FROM competitors WHERE run_id = ? AND selected = 1`)
    .bind(ctx.runId)
    .all<{ id: string; domain: string }>();
  const competitors = selectedRows.results ?? [];

  let stageCostUsdMicro = 0;
  let anyFailure = false;
  const candidateBatches: KeywordCandidate[][] = [];
  const perCompetitor: CollectCompetitorEvidenceOutput['perCompetitor'] = [];

  for (const competitor of competitors) {
    let rankedCount: number | null = null;
    let pagesCount: number | null = null;
    let topPages: RelevantPageRecord[] = [];

    try {
      const ranked = await fetchRankedKeywords(ctx, market, competitor.domain, competitor.id, costs);
      stageCostUsdMicro += ranked.costUsdMicro;
      await ctx.d1
        .prepare(`INSERT OR IGNORE INTO competitor_evidence_refs (competitor_id, evidence_ref_id) VALUES (?, ?)`)
        .bind(competitor.id, ranked.evidenceRefId)
        .run();
      candidateBatches.push(ranked.records.map((r) => r.candidate));
      rankedCount = ranked.records.length;
    } catch (err) {
      if (isAccountWideProviderError(err)) throw err;
      // A single competitor's provider failure degrades that competitor's
      // reported count, never the whole handler -- per this task's brief.
      anyFailure = true;
    }

    try {
      const pages = await fetchRelevantPages(ctx, market, competitor.domain, competitor.id, costs);
      stageCostUsdMicro += pages.costUsdMicro;
      await ctx.d1
        .prepare(`INSERT OR IGNORE INTO competitor_evidence_refs (competitor_id, evidence_ref_id) VALUES (?, ?)`)
        .bind(competitor.id, pages.evidenceRefId)
        .run();
      pagesCount = pages.records.length;
      topPages = pages.records.slice(0, MAX_TOP_PAGES);
    } catch (err) {
      if (isAccountWideProviderError(err)) throw err;
      anyFailure = true;
    }

    perCompetitor.push({ domain: competitor.domain, rankedCount, pagesCount, topPages });
  }

  // Every competitor's surviving ranked-keyword candidates merge into ONE
  // universe before persistence, so a keyword two different competitors
  // both rank for collapses to a single keywords row (evidence from both
  // attached) instead of the second competitor's insert racing the first's
  // under UNIQUE(run_id, normalized_keyword) -- persistKeywordCandidates'
  // own ON CONFLICT DO NOTHING + re-read makes this safe either way, but
  // merging first means the SAME evidence-accumulation logic
  // mergeKeywordCandidates already provides for Task 10 applies here too.
  if (candidateBatches.length > 0) {
    const locale = `${ctx.normalizedBrief.languageCode}-${ctx.normalizedBrief.countryIso}`;
    const universe = mergeKeywordCandidates(candidateBatches, locale);
    await persistKeywordCandidates(ctx.d1, ctx.runId, universe);
  }

  const output: CollectCompetitorEvidenceOutput = { perCompetitor, stageCostUsdMicro };
  return { output, status: anyFailure ? ('partial' as const) : ('succeeded' as const) };
};

// Catalog Sec 15 V1 operating point: cap the SERP validation batch at 20
// queries (same ceiling costs.ts's buildCallPlan already plans against for
// the 'serp_task_post' line), well under task_post's own 100-per-POST
// ceiling (serp.ts's MAX_SERP_TASKS_PER_POST is a defensive backstop, not
// the intended cap).
const MAX_SERP_QUERIES = 20;

// Builds the query set validate_serps_and_questions posts: one query per
// service-in-primary-area seed (the same population collect_keyword_evidence
// uses for keyword_suggestions and discover_competitors uses for greenfield
// discovery), capped at MAX_SERP_QUERIES, each paired with the resolved
// GRANULAR SERP location code for its service area (falling back to the
// market's country-level code when that area could not be resolved --
// resolve_market's own documented degradation, see catalogs.ts). Exported
// standalone (rather than inlined into the handler) so its cap-at-20
// behavior is unit-testable without driving a full stage/DB setup.
export function buildSerpQueriesFromSeeds(seeds: SeedQuery[], market: ResolvedMarket): SerpQuery[] {
  const locationByServiceArea = new Map(market.serpLocations.map((l) => [l.serviceAreaId, l.locationCode]));
  return seeds
    .filter((s) => s.source === 'service_primary_area')
    .slice(0, MAX_SERP_QUERIES)
    .map((seed) => ({
      keyword: seed.query,
      serviceAreaId: seed.serviceAreaId,
      locationCode:
        (seed.serviceAreaId ? locationByServiceArea.get(seed.serviceAreaId) : undefined) ??
        market.fallbackSerpLocationCode,
    }));
}

export interface ValidateSerpsAndQuestionsOutput {
  snapshots: number;
  failed: number;
}

// Real validate_serps_and_questions, not a stub. Optional stage (stages.ts),
// and the ONE task-based (async) provider flow in Phase 3: DataForSEO's SERP
// task_post/task_get pair means a single stage attempt can never do
// "post and immediately read the result" the way every other stage handler
// in this phase does. The handler flow instead spans MULTIPLE attempts of
// this same stage:
//   - first attempt (no dfs_serp_tasks rows exist yet for this run): build
//     the query set, post the batch, persist one dfs_serp_tasks row per
//     successfully created provider task, then throw SerpTasksPendingError
//     so this attempt lands in retry_wait rather than reporting a false
//     success with zero collected data.
//   - every later attempt (rows already exist): poll every still-'posted'
//     row via collectSerpTasks. Any row still pending re-throws
//     SerpTasksPendingError (more polling needed); once nothing is pending,
//     the stage finishes as 'succeeded' (no per-task failures) or 'partial'
//     (at least one task_get came back as a genuine per-task failure).
// stages.ts's maxAttempts: 12 / retryBackoffMs: 30_000 override on this
// stage is what makes this polling loop viable: attempts exhausted still
// degrades cleanly to 'skipped' (this stage is optional) via the processor's
// existing generic retry-exhaustion handling, never a hard run failure.
export const validateSerpsAndQuestionsHandler: StageHandler = async (ctx: StageContext) => {
  const existingRow = await ctx.d1
    .prepare(`SELECT COUNT(*) AS count FROM dfs_serp_tasks WHERE run_id = ?`)
    .bind(ctx.runId)
    .first<{ count: number }>();
  const hasExistingTasks = (existingRow?.count ?? 0) > 0;

  if (!hasExistingTasks) {
    const market = await loadStageOutput<ResolvedMarket>(ctx.d1, ctx.runId, 'resolve_market');
    if (!market) {
      throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
    }

    const costs = await loadDfsCostEstimates(ctx.env.KV);
    const { seeds } = buildSeedQueries(ctx.normalizedBrief, {
      maxTotalSeeds: V1_LIMITS.maxSeedQueries,
      includePrimaryAreaSeeds: true,
    });
    const queries = buildSerpQueriesFromSeeds(seeds, market);

    if (queries.length === 0) {
      // No service-in-primary-area seeds to validate against (a brief with
      // no primary area, which normalize_brief/validate_intake should never
      // actually allow through) -- nothing to post, nothing pending.
      const output: ValidateSerpsAndQuestionsOutput = { snapshots: 0, failed: 0 };
      return { output, status: 'succeeded' as const };
    }

    await postSerpTasks(ctx, queries, costs);
    throw new SerpTasksPendingError('SERP tasks posted; awaiting task_get results');
  }

  const { completed, pending, failed } = await collectSerpTasks(ctx);
  if (pending > 0) {
    throw new SerpTasksPendingError('SERP tasks still processing');
  }

  const output: ValidateSerpsAndQuestionsOutput = { snapshots: completed, failed };
  return { output, status: failed > 0 ? ('partial' as const) : ('succeeded' as const) };
};
