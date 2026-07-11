import type { StageContext } from '../../orchestration/handlers';
import type { KeywordCandidate, KeywordUniverse, MergedKeyword } from '../../contracts/types';
import { normalizeKeyword } from '../../domain/keyword';
import { BlueprintApiError } from '../../domain/api-errors';
import { blueprintDfsCall } from './call';
import type { DfsCallResult } from './call';
import { safeErrorMessage } from './envelope';
import { normalizeKeywordItem } from './normalize';
import type { ResolvedMarket } from './catalogs';
import type { DfsCostEstimates } from './costs';

// Keyword Labs cache TTLs (catalog Sec 3/4/6/11): positive 14 days, empty
// (genuinely no results) 6 hours.
const LABS_TTL_SECONDS = 1_209_600;
const LABS_EMPTY_TTL_SECONDS = 21_600;

// Catalog Sec 3: max 200 seeds per Keyword Ideas task. buildSeedQueries
// already caps the pipeline's total seed count at this limit (V1_LIMITS),
// but this adapter enforces it defensively at the actual call boundary too.
const MAX_KEYWORD_IDEAS_SEEDS = 200;

// Catalog Sec 11: enrichment task caps. Phase 3 only ever sends the FIRST
// chunk of each -- there is no follow-up call for whatever doesn't fit.
const OVERVIEW_CHUNK_MAX = 700;
const BULK_KD_CHUNK_MAX = 1000;

// Paid Labs calls always yield an evidenceRefId (blueprintDfsCall only
// returns null for estimateUsdMicro===0 catalog GETs, which none of the
// calls in this file are). A null here would mean that invariant broke
// upstream, not a mistake by this caller.
function requireEvidenceRefId(result: DfsCallResult): string {
  if (!result.evidenceRefId) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }
  return result.evidenceRefId;
}

function normalizeItems(items: any[], source: string, evidenceRefId: string): KeywordCandidate[] {
  return items
    .map((item) => normalizeKeywordItem(item, source, evidenceRefId))
    .filter((c): c is KeywordCandidate => c !== null);
}

export async function fetchKeywordIdeas(
  ctx: StageContext,
  market: ResolvedMarket,
  seedKeywords: string[],
  costs: DfsCostEstimates
): Promise<KeywordCandidate[]> {
  const keywords = seedKeywords.slice(0, MAX_KEYWORD_IDEAS_SEEDS);
  const result = await blueprintDfsCall(ctx, {
    method: 'POST',
    endpoint: '/dataforseo_labs/google/keyword_ideas/live',
    body: {
      keywords,
      location_code: market.labsLocationCode,
      language_code: market.languageCode,
      closely_variants: false,
      ignore_synonyms: false,
      include_serp_info: true,
      limit: 500,
    },
    ttlSeconds: LABS_TTL_SECONDS,
    emptyTtlSeconds: LABS_EMPTY_TTL_SECONDS,
    kind: 'keyword_metric',
    operation: 'keyword_ideas',
    scopeId: 'seeds',
    estimateUsdMicro: costs.labsTaskUsdMicro,
  });
  const evidenceRefId = requireEvidenceRefId(result);
  return normalizeItems(result.items, 'keyword_ideas', evidenceRefId);
}

export async function fetchKeywordSuggestions(
  ctx: StageContext,
  market: ResolvedMarket,
  seed: { query: string; serviceId: string | null },
  costs: DfsCostEstimates
): Promise<KeywordCandidate[]> {
  const result = await blueprintDfsCall(ctx, {
    method: 'POST',
    endpoint: '/dataforseo_labs/google/keyword_suggestions/live',
    body: {
      keyword: seed.query,
      location_code: market.labsLocationCode,
      language_code: market.languageCode,
      include_seed_keyword: true,
      include_serp_info: true,
      ignore_synonyms: false,
      limit: 100,
    },
    ttlSeconds: LABS_TTL_SECONDS,
    emptyTtlSeconds: LABS_EMPTY_TTL_SECONDS,
    kind: 'keyword_metric',
    operation: 'keyword_suggestions',
    scopeId: seed.serviceId ?? 'no-service',
    estimateUsdMicro: costs.labsTaskUsdMicro,
  });
  const evidenceRefId = requireEvidenceRefId(result);
  return normalizeItems(result.items, 'keyword_suggestions', evidenceRefId);
}

export async function fetchKeywordsForSite(
  ctx: StageContext,
  market: ResolvedMarket,
  domain: string,
  costs: DfsCostEstimates
): Promise<KeywordCandidate[]> {
  const result = await blueprintDfsCall(ctx, {
    method: 'POST',
    endpoint: '/dataforseo_labs/google/keywords_for_site/live',
    body: {
      target: domain,
      location_code: market.labsLocationCode,
      language_code: market.languageCode,
      include_subdomains: true,
      include_serp_info: true,
      limit: 200,
    },
    ttlSeconds: LABS_TTL_SECONDS,
    emptyTtlSeconds: LABS_EMPTY_TTL_SECONDS,
    kind: 'keyword_metric',
    operation: 'keywords_for_site',
    scopeId: 'site',
    estimateUsdMicro: costs.labsTaskUsdMicro,
  });
  const evidenceRefId = requireEvidenceRefId(result);
  return normalizeItems(result.items, 'keywords_for_site', evidenceRefId);
}

// Clones every merged keyword (metrics object included) so the caller's
// KeywordUniverse is never mutated in place, per the enrichment contract:
// only the returned universe reflects newly-filled metrics.
function cloneMergedKeyword(k: MergedKeyword): MergedKeyword {
  return { ...k, variants: [...k.variants], sources: [...k.sources], metrics: { ...k.metrics }, evidenceRefs: [...k.evidenceRefs] };
}

function representativeKeywordText(k: MergedKeyword): string {
  return k.variants[0] ?? k.normalizedKeyword;
}

function applyEvidenceRef(k: MergedKeyword, evidenceRefId: string): void {
  if (!k.evidenceRefs.includes(evidenceRefId)) k.evidenceRefs.push(evidenceRefId);
}

// enrichMissingMetrics deviates from the plan text in one way: KeywordUniverse
// has no field for "we truncated the enrichment chunk," so this returns
// { universe, enrichmentTruncated } instead of a bare KeywordUniverse. Task 10's
// collect_keyword_evidence handler needs that flag to record a partial-stage
// warning; the universe itself stays exactly KeywordUniverse-shaped.
export async function enrichMissingMetrics(
  ctx: StageContext,
  market: ResolvedMarket,
  merged: KeywordUniverse,
  costs: DfsCostEstimates
): Promise<{ universe: KeywordUniverse; enrichmentTruncated: boolean }> {
  const byNormalized = new Map<string, MergedKeyword>(
    merged.keywords.map((k) => [k.normalizedKeyword, cloneMergedKeyword(k)])
  );

  const missingVolume = merged.keywords.filter((k) => k.metrics.searchVolume === null);
  const missingDifficulty = merged.keywords.filter((k) => k.metrics.difficulty === null);
  const volumeChunk = missingVolume.slice(0, OVERVIEW_CHUNK_MAX);
  const difficultyChunk = missingDifficulty.slice(0, BULK_KD_CHUNK_MAX);
  const enrichmentTruncated =
    missingVolume.length > OVERVIEW_CHUNK_MAX || missingDifficulty.length > BULK_KD_CHUNK_MAX;

  if (volumeChunk.length > 0) {
    const result = await blueprintDfsCall(ctx, {
      method: 'POST',
      endpoint: '/dataforseo_labs/google/keyword_overview/live',
      body: {
        keywords: volumeChunk.map(representativeKeywordText),
        location_code: market.labsLocationCode,
        language_code: market.languageCode,
      },
      ttlSeconds: LABS_TTL_SECONDS,
      emptyTtlSeconds: LABS_EMPTY_TTL_SECONDS,
      kind: 'keyword_metric',
      operation: 'metric_enrichment',
      scopeId: 'overview',
      estimateUsdMicro: costs.labsTaskUsdMicro,
    });
    const evidenceRefId = requireEvidenceRefId(result);
    for (const item of result.items) {
      const candidate = normalizeKeywordItem(item, 'keyword_overview', evidenceRefId);
      if (!candidate) continue;
      const normalized = normalizeKeyword(candidate.keyword, market.languageCode);
      const existing = byNormalized.get(normalized);
      if (!existing) continue;
      existing.metrics.searchVolume ??= candidate.metrics.searchVolume;
      existing.metrics.cpcUsd ??= candidate.metrics.cpcUsd;
      existing.metrics.difficulty ??= candidate.metrics.difficulty;
      applyEvidenceRef(existing, evidenceRefId);
    }
  }

  if (difficultyChunk.length > 0) {
    const result = await blueprintDfsCall(ctx, {
      method: 'POST',
      endpoint: '/dataforseo_labs/google/bulk_keyword_difficulty/live',
      body: {
        keywords: difficultyChunk.map(representativeKeywordText),
        location_code: market.labsLocationCode,
        language_code: market.languageCode,
      },
      ttlSeconds: LABS_TTL_SECONDS,
      emptyTtlSeconds: LABS_EMPTY_TTL_SECONDS,
      kind: 'keyword_metric',
      operation: 'metric_enrichment',
      scopeId: 'bulk_kd',
      estimateUsdMicro: costs.labsTaskUsdMicro,
    });
    const evidenceRefId = requireEvidenceRefId(result);
    // bulk_keyword_difficulty items carry `keyword` + `keyword_difficulty`
    // directly -- not the keyword_data/keyword_properties nesting
    // normalizeKeywordItem expects -- so this is normalized inline.
    for (const item of result.items) {
      const keyword = item?.keyword;
      const difficulty = typeof item?.keyword_difficulty === 'number' ? item.keyword_difficulty : null;
      if (typeof keyword !== 'string' || keyword.length === 0 || difficulty === null) continue;
      const normalized = normalizeKeyword(keyword, market.languageCode);
      const existing = byNormalized.get(normalized);
      if (!existing) continue;
      existing.metrics.difficulty ??= difficulty;
      applyEvidenceRef(existing, evidenceRefId);
    }
  }

  return { universe: { keywords: [...byNormalized.values()] }, enrichmentTruncated };
}
