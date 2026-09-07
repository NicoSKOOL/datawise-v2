import { z } from 'zod';
import { defineTool, localeInputs, domainInput, resolveLocale } from './types';
import { callJson } from '../call-handler';
import { toolResult, compact, DETAILED } from '../shape';
import {
  handleRankedKeywords, handleDomainRankOverview, handleCompetitorsDomain, handleBulkTrafficEstimation,
} from '../../routes/competitors';
import { handleBacklinksSummary } from '../../routes/backlinks';

const GAP_ROWS_PER_SIDE = 300;

const items = (envelope: any): any[] => envelope?.tasks?.[0]?.result?.[0]?.items ?? [];

// Same rules as sanitizeDomainTarget in routes/competitors.ts. Duplicated
// (five lines) rather than imported so this module keeps a single dependency
// direction: tools call handlers, never handler helpers.
function bareDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
}

interface RankedRow {
  keyword: string;
  position: number;
  search_volume: number;
  cpc: number;
  difficulty: number | null;
  url: string | null;
  estimated_traffic: number;
}

function fromRanked(item: any): RankedRow {
  const kd = item.keyword_data ?? {};
  const serp = item.ranked_serp_element?.serp_item ?? {};
  return {
    keyword: kd.keyword,
    position: serp.rank_absolute ?? serp.rank_group ?? 0,
    search_volume: kd.keyword_info?.search_volume ?? 0,
    cpc: kd.keyword_info?.cpc ?? 0,
    difficulty: kd.keyword_properties?.keyword_difficulty ?? null,
    url: serp.url ?? null,
    estimated_traffic: serp.etv ?? 0,
  };
}

interface RankedPair {
  row: RankedRow;
  raw: any;
}

// Returns index-aligned {row, raw} pairs (the flattened row and the raw
// DataForSEO item it came from), so callers that need response_format
// detailed's raw payload can carry the raw item alongside its row through
// any later filter/sort/slice and stay aligned with what's actually returned.
async function fetchRanked(
  ctx: { env: any; identity: any },
  target: string,
  limit: number,
  locale: object,
): Promise<RankedPair[]> {
  const data = await callJson(ctx.env, ctx.identity.userId, handleRankedKeywords, { target, limit, ...locale });
  return items(data)
    .map((it) => ({ row: fromRanked(it), raw: it }))
    .filter((x) => x.row.keyword);
}

export const domainOverview = defineTool({
  name: 'datawise_domain_overview',
  description:
    'Use this for a one-call snapshot of a domain: organic keyword counts by position bucket, estimated monthly organic traffic and its value, a traffic estimate, and a backlink summary (total backlinks, referring domains, domain rank). ' +
    'This is the most expensive tool (three DataForSEO calls). Do not call it repeatedly for the same domain; do not use it to list keywords (use datawise_ranked_keywords).',
  inputSchema: z.object({ domain: domainInput, ...localeInputs }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domain = bareDomain(args.domain);
    const uid = ctx.identity.userId;
    const [rank, traffic, links] = await Promise.allSettled([
      callJson(ctx.env, uid, handleDomainRankOverview, { target: domain, ...locale }),
      callJson(ctx.env, uid, handleBulkTrafficEstimation, { targets: [domain], ...locale }),
      callJson(ctx.env, uid, handleBacklinksSummary, { target: domain }),
    ]);
    const errors: string[] = [];
    const reason = (r: PromiseSettledResult<any>) => (r.status === 'rejected' ? (r.reason?.message ?? String(r.reason)) : '');

    let organic: Record<string, number> | null = null;
    let rankItem: any = null;
    if (rank.status === 'fulfilled') {
      rankItem = items(rank.value)[0] ?? null;
      const m = rankItem?.metrics?.organic ?? {};
      const top3 = (m.pos_1 ?? 0) + (m.pos_2_3 ?? 0);
      const top10 = top3 + (m.pos_4_10 ?? 0);
      organic = {
        keywords_total: m.count ?? 0,
        top_3: top3,
        top_10: top10,
        top_100: m.count ?? 0,
        estimated_monthly_traffic: m.etv ?? 0,
        traffic_value_usd: m.estimated_paid_traffic_cost ?? 0,
      };
    } else errors.push(`rank overview unavailable: ${reason(rank)}`);

    let traffic_estimate: Record<string, number> | null = null;
    let trafficItem: any = null;
    if (traffic.status === 'fulfilled') {
      trafficItem = items(traffic.value)[0] ?? null;
      const m = trafficItem?.metrics ?? {};
      traffic_estimate = { organic_monthly_visits: m.organic?.etv ?? 0, paid_monthly_visits: m.paid?.etv ?? 0 };
    } else errors.push(`traffic estimate unavailable: ${reason(traffic)}`);

    let backlinks: Record<string, number> | null = null;
    let backlinksData: any = null;
    if (links.status === 'fulfilled') {
      backlinksData = links.value?.data ?? null;
      const d = backlinksData ?? {};
      backlinks = {
        total: d.backlinks ?? 0,
        referring_domains: d.referring_domains ?? 0,
        referring_main_domains: d.referring_main_domains ?? 0,
        domain_rank: d.rank ?? 0,
        broken: d.broken_backlinks ?? 0,
      };
    } else errors.push(`backlinks summary unavailable: ${reason(links)}`);

    const structured: Record<string, unknown> = { domain, ...locale, organic, traffic_estimate, backlinks, errors };
    if (args.response_format === 'detailed') {
      structured.raw = {
        rank: rankItem ? compact(rankItem, DETAILED) : null,
        traffic: trafficItem ? compact(trafficItem, DETAILED) : null,
        backlinks: backlinksData ? compact(backlinksData, DETAILED) : null,
      };
    }

    return toolResult(
      structured,
      `Overview for ${domain}: ${organic?.keywords_total ?? '?'} organic keywords, ~${Math.round(organic?.estimated_monthly_traffic ?? 0)} monthly visits, ${backlinks?.referring_domains ?? '?'} referring domains.${errors.length ? ` ${errors.length} sub-call(s) failed.` : ''}`,
    );
  },
});

export const rankedKeywords = defineTool({
  name: 'datawise_ranked_keywords',
  description:
    'Use this to list the keywords a domain ranks for in Google organic results, with position, volume, CPC, difficulty, ranking URL and estimated traffic. ' +
    'Filters apply after fetching, so raise limit when combining min_volume and max_position. Do not use for a domain summary (datawise_domain_overview) or to compare two domains (datawise_keyword_gap).',
  inputSchema: z.object({
    domain: domainInput,
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0).describe('Skip this many rows (pagination).'),
    min_volume: z.number().int().min(0).optional().describe('Keep only keywords with at least this monthly volume.'),
    max_position: z.number().int().min(1).max(100).optional().describe('Keep only keywords ranking at or above this position.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domain = bareDomain(args.domain);
    const data = await callJson(ctx.env, ctx.identity.userId, handleRankedKeywords, { target: domain, limit: args.limit + args.offset, ...locale });
    const rawItems = items(data);
    let kept = rawItems.map((it) => ({ row: fromRanked(it), raw: it })).filter((x) => x.row.keyword);
    if (args.min_volume != null) kept = kept.filter((x) => x.row.search_volume >= args.min_volume!);
    if (args.max_position != null) kept = kept.filter((x) => x.row.position > 0 && x.row.position <= args.max_position!);
    kept = kept.slice(args.offset, args.offset + args.limit);
    const rows = kept.map((x) => x.row);

    const structured: Record<string, unknown> = { domain, ...locale, offset: args.offset, keywords: rows };
    if (args.response_format === 'detailed') {
      structured.raw = compact(kept.map((x) => x.raw), DETAILED);
    }

    return toolResult(
      structured,
      `${rows.length} ranked keywords for ${domain} (location ${locale.location_code}).`,
    );
  },
});

export const competitors = defineTool({
  name: 'datawise_competitors',
  description:
    'Use this to find the organic competitors of a domain: sites that rank for the same keywords, with shared keyword count, average position and estimated traffic. ' +
    'Do not use for backlink competitors or for keyword-level comparison (datawise_keyword_gap).',
  inputSchema: z.object({
    domain: domainInput,
    limit: z.number().int().min(1).max(20).default(10),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domain = bareDomain(args.domain);
    const data = await callJson(ctx.env, ctx.identity.userId, handleCompetitorsDomain, { target: domain, ...locale });
    const rawItems = items(data).slice(0, args.limit);
    const rows = rawItems.map((it: any) => ({
      domain: it.domain,
      avg_position: it.avg_position ?? null,
      shared_keywords: it.intersections ?? 0,
      estimated_monthly_traffic: it.full_domain_metrics?.organic?.etv ?? 0,
      keywords_total: it.full_domain_metrics?.organic?.count ?? 0,
    }));

    const structured: Record<string, unknown> = { domain, ...locale, competitors: rows };
    if (args.response_format === 'detailed') {
      structured.raw = compact(rawItems, DETAILED);
    }

    return toolResult(structured, `${rows.length} organic competitors for ${domain}.`);
  },
});

export const keywordGap = defineTool({
  name: 'datawise_keyword_gap',
  description:
    'Use this to compare two domains: keywords the competitor ranks for that you do not (gaps), keywords you both rank for (shared), and a count of your advantages. ' +
    'Fetches the top 300 keywords of each domain. Do not use for a single domain.',
  inputSchema: z.object({
    my_domain: domainInput,
    competitor_domain: domainInput,
    limit: z.number().int().min(1).max(100).default(25).describe('Gap rows to return.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const mine = bareDomain(args.my_domain);
    const theirs = bareDomain(args.competitor_domain);
    const [myPairs, theirPairs] = await Promise.all([
      fetchRanked(ctx, mine, GAP_ROWS_PER_SIDE, locale),
      fetchRanked(ctx, theirs, GAP_ROWS_PER_SIDE, locale),
    ]);
    const norm = (k: string) => k.trim().replace(/\s+/g, ' ').toLowerCase();
    const myByKw = new Map(myPairs.map((p) => [norm(p.row.keyword), p]));
    const theirByKw = new Map(theirPairs.map((p) => [norm(p.row.keyword), p]));

    // Keep the raw item paired with its row through the same filter+sort
    // used for the returned gaps/shared arrays, so a later slice to
    // args.limit keeps raw index-aligned with what's actually returned.
    const gapPairs = theirPairs
      .filter((p) => !myByKw.has(norm(p.row.keyword)))
      .sort((a, b) => b.row.search_volume - a.row.search_volume);
    const sharedPairs = myPairs
      .filter((p) => theirByKw.has(norm(p.row.keyword)))
      .sort((a, b) => b.row.search_volume - a.row.search_volume);
    const myAdvantages = myPairs.filter((p) => !theirByKw.has(norm(p.row.keyword))).length;

    const slicedGapPairs = gapPairs.slice(0, args.limit);
    const slicedSharedPairs = sharedPairs.slice(0, args.limit);
    const gaps = slicedGapPairs.map((p) => ({ keyword: p.row.keyword, search_volume: p.row.search_volume, competitor_position: p.row.position }));
    const shared = slicedSharedPairs.map((p) => ({
      keyword: p.row.keyword,
      search_volume: p.row.search_volume,
      my_position: p.row.position,
      competitor_position: theirByKw.get(norm(p.row.keyword))!.row.position,
    }));

    const structured: Record<string, unknown> = {
      my_domain: mine, competitor_domain: theirs, ...locale,
      summary: { gaps: gapPairs.length, shared: sharedPairs.length, my_advantages: myAdvantages },
      gaps,
      shared,
    };
    if (args.response_format === 'detailed') {
      structured.raw = {
        gaps: compact(slicedGapPairs.map((p) => p.raw), DETAILED),
        shared: compact(slicedSharedPairs.map((p) => p.raw), DETAILED),
      };
    }

    return toolResult(
      structured,
      `${theirs} ranks for ${gapPairs.length} keywords that ${mine} does not (top ${gaps.length} shown); ${sharedPairs.length} shared.`,
    );
  },
});
