import type { StageContext } from '../../orchestration/handlers';
import { blueprintDfsCall } from './call';
import type { ResolvedMarket } from './catalogs';
import type { DfsCostEstimates } from './costs';
import { PAGE_PLAN_RULESET_V1 } from '../../domain/page-plan/ruleset';

// Stage 16 overlay_existing_site's LABS FALLBACK inventory source.
//
// When a project's own site exposes no crawlable sitemap (robots.txt blocked or
// absent, no /sitemap.xml), the overlay handler has no free way to inventory the
// existing pages. This adapter is the paid last resort: a single DataForSEO Labs
// ranked_keywords call against the project's OWN domain, from which we recover the
// distinct page URLs the site already ranks for. It is the same endpoint family
// as competitors.ts's fetchRankedKeywords (which runs it against a COMPETITOR
// domain), so it reuses that adapter's response-shape knowledge and the identical
// labs cache-TTL and cost conventions; it differs only in operation tag
// ('site_ranked_urls', so the own-domain call is cached/budgeted/billed
// independently of the per-competitor ranked_keywords calls) and in what it
// projects out of the response (page URLs, not keyword candidates).

// Ranked Keywords Labs cache TTLs (catalog Sec 9): positive 7 days, empty 6
// hours -- same convention every other labs adapter uses.
const SITE_RANKED_TTL_SECONDS = 604_800;
const SITE_RANKED_EMPTY_TTL_SECONDS = 21_600;

// Catalog Sec 9 filters array, verbatim (same as competitors.ts): only keywords
// with real search volume AND a rank_group inside the top 30 contribute a ranked
// URL. A URL a domain ranks #90 for is not a page worth surfacing in the overlay.
const RANKED_KEYWORDS_FILTERS: unknown[] = [
  ['keyword_data.keyword_info.search_volume', '>', 0],
  'and',
  ['ranked_serp_element.serp_item.rank_group', '<=', 30],
];

// Endpoint request ceiling: the same 500-row cap competitors.ts uses. The
// distinct-URL result is then capped again below at the overlay's own
// maxSitemapUrls so the labs source can never yield more inventory rows than the
// sitemap source would have.
const RANKED_KEYWORDS_LIMIT = 500;

// The distinct-URL ceiling: the SAME constant the sitemap path caps page URLs at
// (ruleset.overlay.maxSitemapUrls, 500), so both inventory sources are bounded
// identically. Imported from the ruleset rather than re-declared so a ruleset
// change moves both caps together.
const MAX_OWN_URLS = PAGE_PLAN_RULESET_V1.overlay.maxSitemapUrls;

export interface OwnRankedUrl {
  url: string;
  // Best (lowest) rank_group across every keyword this URL ranks for; null when
  // no item carried a numeric rank_group.
  bestRank: number | null;
  // How many ranked-keyword items pointed at this URL (a cheap popularity proxy;
  // used only to prioritize which URLs survive the MAX_OWN_URLS cap).
  keywordCount: number;
}

// Extracts the ranking URL and its rank_group from one ranked_keywords item.
// Field path mirrors competitors.ts's normalizeRankedKeywordItem exactly
// (ranked_serp_element.serp_item.url / .rank_group); same documented-assumption
// caveat -- spot-check against a real response in the staging smoke run.
function readRankedItem(item: any): { url: string; rankGroup: number | null } | null {
  const serpItem = item?.ranked_serp_element?.serp_item;
  const url = serpItem?.url;
  if (typeof url !== 'string' || url.length === 0) return null;
  const rankGroup = typeof serpItem.rank_group === 'number' ? serpItem.rank_group : null;
  return { url, rankGroup };
}

// Fold ranked-keyword items into distinct page URLs. A site ranks for many
// keywords with the same page as the ranking URL, so the item list collapses to
// far fewer URLs; each surviving URL carries its best rank and a keyword count.
// Deterministic: aggregation is order-independent, and the final order (keyword
// count desc, then best rank asc with nulls last, then url asc) is a total order
// so the MAX_OWN_URLS slice is stable.
export function aggregateOwnRankedUrls(items: any[], maxUrls: number): OwnRankedUrl[] {
  const byUrl = new Map<string, { bestRank: number | null; keywordCount: number }>();
  for (const item of items) {
    const parsed = readRankedItem(item);
    if (!parsed) continue;
    const existing = byUrl.get(parsed.url);
    if (!existing) {
      byUrl.set(parsed.url, { bestRank: parsed.rankGroup, keywordCount: 1 });
      continue;
    }
    existing.keywordCount += 1;
    if (parsed.rankGroup !== null && (existing.bestRank === null || parsed.rankGroup < existing.bestRank)) {
      existing.bestRank = parsed.rankGroup;
    }
  }
  const all: OwnRankedUrl[] = Array.from(byUrl.entries()).map(([url, agg]) => ({
    url,
    bestRank: agg.bestRank,
    keywordCount: agg.keywordCount,
  }));
  all.sort((a, b) => {
    if (b.keywordCount !== a.keywordCount) return b.keywordCount - a.keywordCount;
    const ra = a.bestRank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.bestRank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.url < b.url ? -1 : a.url > b.url ? 1 : 0;
  });
  return all.slice(0, maxUrls);
}

// Labs ranked_keywords against the project's OWN domain, projected to the
// distinct page URLs it ranks for (bounded at MAX_OWN_URLS). One paid call;
// blueprintDfsCall handles budget reservation, KV caching, evidence, and cost.
// A provider throw is the caller's to handle (the overlay handler catches it into
// an inventory_limited warning, since this is an optional-stage fallback path).
export async function fetchOwnRankedUrls(
  ctx: StageContext,
  market: ResolvedMarket,
  domain: string,
  costs: DfsCostEstimates,
): Promise<OwnRankedUrl[]> {
  const result = await blueprintDfsCall(ctx, {
    method: 'POST',
    endpoint: '/dataforseo_labs/google/ranked_keywords/live',
    body: {
      target: domain,
      location_code: market.labsLocationCode,
      language_code: market.languageCode,
      ignore_synonyms: true,
      item_types: ['organic', 'featured_snippet', 'local_pack'],
      filters: RANKED_KEYWORDS_FILTERS,
      limit: RANKED_KEYWORDS_LIMIT,
    },
    ttlSeconds: SITE_RANKED_TTL_SECONDS,
    emptyTtlSeconds: SITE_RANKED_EMPTY_TTL_SECONDS,
    kind: 'ranking',
    operation: 'site_ranked_urls',
    scopeId: 'own',
    estimateUsdMicro: costs.labsTaskUsdMicro,
  });
  return aggregateOwnRankedUrls(result.items, MAX_OWN_URLS);
}
