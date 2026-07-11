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
} from '../providers/dataforseo/competitors';
import type { CompetitorCandidate } from '../providers/dataforseo/competitors';

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

async function persistKeywordUniverse(
  ctx: StageContext,
  universe: KeywordUniverse,
  seeds: SeedQuery[],
  locale: string
): Promise<number> {
  const { d1, runId } = ctx;
  const seedProvenance = groupSeedsByNormalizedQuery(seeds, locale);
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
  const persistedCount = await persistKeywordUniverse(ctx, enriched, seeds, locale);

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
