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
