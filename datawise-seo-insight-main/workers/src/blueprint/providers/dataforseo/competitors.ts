import type { StageContext } from '../../orchestration/handlers';
import { BlueprintApiError } from '../../domain/api-errors';
import { blueprintDfsCall } from './call';
import type { DfsCallResult } from './call';
import { safeErrorMessage } from './envelope';
import type { ResolvedMarket } from './catalogs';
import type { DfsCostEstimates } from './costs';
import { normalizeDomain } from '../../domain/url';

// Competitor discovery Labs cache TTLs (catalog Sec 7/8): positive 7 days,
// empty (genuinely no competitors found) 6 hours -- same convention as the
// keyword adapters' LABS_TTL_SECONDS/LABS_EMPTY_TTL_SECONDS (Task 9).
const DISCOVERY_TTL_SECONDS = 604_800;
const DISCOVERY_EMPTY_TTL_SECONDS = 21_600;

// Catalog Sec 8: "Max 200 representative keywords" for serp_competitors.
const MAX_SERP_COMPETITOR_KEYWORDS = 200;

export interface CompetitorCandidate {
  domain: string;
  visibilityMetric: number | null;
  source: 'competitors_domain' | 'serp_competitors';
  evidenceRefId: string;
}

// Directories, social platforms, review aggregators, marketplaces, and
// general-reference sites that competitors_domain/serp_competitors routinely
// surface purely because they outrank everyone for commercial/local terms,
// never because they are a real business competitor (catalog Sec 7/8:
// "Exclude directories/social/publishers/marketplaces/aggregators before
// selecting 3-5").
export const EXCLUDED_COMPETITOR_DOMAINS: readonly string[] = [
  'yelp.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'angi.com',
  'thumbtack.com',
  'houzz.com',
  'bbb.org',
  'yellowpages.com',
  'wikipedia.org',
  'reddit.com',
  'amazon.com',
  'homeadvisor.com',
  'nextdoor.com',
  'mapquest.com',
  'tripadvisor.com',
];

// Paid Labs calls always yield an evidenceRefId (blueprintDfsCall only
// returns null for estimateUsdMicro===0 catalog GETs, which neither call in
// this file is). Mirrors keywords.ts's requireEvidenceRefId.
function requireEvidenceRefId(result: DfsCallResult): string {
  if (!result.evidenceRefId) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }
  return result.evidenceRefId;
}

// Runs provider-returned domain strings through the SAME canonicalization
// normalizeProjectBrief already applies to knownCompetitorDomains (lowercase,
// strip a leading www. when a registrable name remains) so a discovered
// candidate and a user-supplied known competitor for the same real domain
// always compare equal (e.g. DFS returning "www.rivalplumbing.com" must
// still match a user-entered "rivalplumbing.com"). A malformed domain string
// from the provider is skipped (returns null) rather than aborting the
// whole batch over one bad item -- normalizeDomain throws on malformed
// input, which is appropriate for user input but too strict for a batch of
// provider items where one questionable entry should never sink the rest.
function safeNormalizeProviderDomain(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  try {
    return normalizeDomain(raw);
  } catch {
    return null;
  }
}

// competitors_domain items (DataForSEO Labs "Domain Competitors"): `domain`
// is the candidate's own hostname; `intersections` is the count of keywords
// this domain shares a ranking with the target for -- the literal
// "intersecting keyword count" this task's brief names as the defensible
// visibilityMetric for this endpoint (a naturally desc-sortable "more
// overlap with the target = more of a real competitor" signal). Missing or
// non-numeric stays null, never coerced to 0.
function normalizeCompetitorsDomainItem(item: any, evidenceRefId: string): CompetitorCandidate | null {
  if (!item || typeof item !== 'object') return null;
  const domain = safeNormalizeProviderDomain(item.domain);
  if (!domain) return null;
  return {
    domain,
    visibilityMetric: typeof item.intersections === 'number' ? item.intersections : null,
    source: 'competitors_domain',
    evidenceRefId,
  };
}

// serp_competitors items (DataForSEO Labs "SERP Competitors"): this call is
// anchored to a keyword SET, not one target domain, so there is no
// per-domain intersections field here. `avg_position` (lower is better,
// rank 1 is best) is the field this task's brief lists for this endpoint;
// it is negated so a BETTER (lower) position produces a HIGHER
// visibilityMetric, keeping "desc, nulls last" selection consistent with
// competitors_domain's higher-is-better convention. Missing or non-numeric
// stays null.
function normalizeSerpCompetitorsItem(item: any, evidenceRefId: string): CompetitorCandidate | null {
  if (!item || typeof item !== 'object') return null;
  const domain = safeNormalizeProviderDomain(item.domain);
  if (!domain) return null;
  return {
    domain,
    visibilityMetric: typeof item.avg_position === 'number' ? -item.avg_position : null,
    source: 'serp_competitors',
    evidenceRefId,
  };
}

// Existing-site discovery: catalog Sec 7 verbatim body. Returns more
// candidates than the final 3-5 selection (limit 20) so the handler's
// filter + selection rules have real headroom to drop false competitors.
export async function discoverCompetitorsForDomain(
  ctx: StageContext,
  market: ResolvedMarket,
  domain: string,
  costs: DfsCostEstimates
): Promise<CompetitorCandidate[]> {
  const result = await blueprintDfsCall(ctx, {
    method: 'POST',
    endpoint: '/dataforseo_labs/google/competitors_domain/live',
    body: {
      target: domain,
      location_code: market.labsLocationCode,
      language_code: market.languageCode,
      exclude_top_domains: true,
      max_rank_group: 20,
      limit: 20,
    },
    ttlSeconds: DISCOVERY_TTL_SECONDS,
    emptyTtlSeconds: DISCOVERY_EMPTY_TTL_SECONDS,
    kind: 'ranking',
    operation: 'competitor_discovery',
    scopeId: 'domain',
    estimateUsdMicro: costs.labsTaskUsdMicro,
  });
  const evidenceRefId = requireEvidenceRefId(result);
  return result.items
    .map((item) => normalizeCompetitorsDomainItem(item, evidenceRefId))
    .filter((c): c is CompetitorCandidate => c !== null);
}

// Greenfield discovery: catalog Sec 8 verbatim body. Caller is responsible
// for choosing the representative keyword set; this only enforces the
// endpoint's own 200-keyword ceiling defensively at the call boundary.
export async function discoverSerpCompetitors(
  ctx: StageContext,
  market: ResolvedMarket,
  keywords: string[],
  costs: DfsCostEstimates
): Promise<CompetitorCandidate[]> {
  const cappedKeywords = keywords.slice(0, MAX_SERP_COMPETITOR_KEYWORDS);
  const result = await blueprintDfsCall(ctx, {
    method: 'POST',
    endpoint: '/dataforseo_labs/google/serp_competitors/live',
    body: {
      keywords: cappedKeywords,
      location_code: market.labsLocationCode,
      language_code: market.languageCode,
      include_subdomains: false,
      item_types: ['organic', 'local_pack'],
      limit: 20,
    },
    ttlSeconds: DISCOVERY_TTL_SECONDS,
    emptyTtlSeconds: DISCOVERY_EMPTY_TTL_SECONDS,
    kind: 'ranking',
    operation: 'competitor_discovery',
    scopeId: 'serp',
    estimateUsdMicro: costs.labsTaskUsdMicro,
  });
  const evidenceRefId = requireEvidenceRefId(result);
  return result.items
    .map((item) => normalizeSerpCompetitorsItem(item, evidenceRefId))
    .filter((c): c is CompetitorCandidate => c !== null);
}

// Subdomain-aware excluded-domain check (m.yelp.com matches yelp.com).
// Exported so the discover_competitors handler can apply the SAME match to
// user-supplied known competitors (controller-approved guard), not just to
// discovered candidates.
export function isExcludedCompetitorDomain(domain: string): boolean {
  return EXCLUDED_COMPETITOR_DOMAINS.some((excluded) => domain === excluded || domain.endsWith(`.${excluded}`));
}

// Drops excluded directory/social/aggregator domains (matching subdomains
// too, e.g. m.yelp.com under yelp.com), the project's own domain, and
// duplicate domains (first occurrence wins, preserving provider rank order).
export function filterCompetitorCandidates(
  candidates: CompetitorCandidate[],
  ownDomain: string | null
): CompetitorCandidate[] {
  const seen = new Set<string>();
  const out: CompetitorCandidate[] = [];
  for (const candidate of candidates) {
    const domain = candidate.domain;
    if (!domain) continue;
    if (ownDomain && domain === ownDomain) continue;
    if (isExcludedCompetitorDomain(domain)) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);
    out.push(candidate);
  }
  return out;
}
