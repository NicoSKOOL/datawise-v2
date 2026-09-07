import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const labs = (items: unknown[]) => ({ tasks: [{ result: [{ items }] }] });
const ranked = (keyword: string, vol: number, pos: number) => ({
  keyword_data: { keyword, keyword_info: { search_volume: vol, cpc: 1, competition_level: 'LOW' }, keyword_properties: { keyword_difficulty: 20 } },
  ranked_serp_element: { serp_item: { rank_absolute: pos, rank_group: pos, url: `https://x/${keyword}`, etv: vol / 10 } },
});

vi.mock('../../routes/competitors', () => ({
  handleRankedKeywords: vi.fn(async (req: Request) => {
    const b = await req.clone().json() as any;
    if (b.target === 'me.com') return json(labs([ranked('shared kw', 500, 3), ranked('mine only', 100, 8)]));
    if (b.target === 'rival.com') return json(labs([ranked('shared kw', 500, 1), ranked('gap kw', 900, 5), ranked('gap kw 2', 50, 30)]));
    return json(labs(Array.from({ length: Math.min(b.limit, 4) }, (_, i) => ranked(`k${i}`, 1000 - i * 100, i + 1))));
  }),
  handleDomainRankOverview: vi.fn(async () => json(labs([{ metrics: { organic: { pos_1: 2, pos_2_3: 3, pos_4_10: 5, pos_11_20: 4, pos_21_30: 1, etv: 1234.5, count: 15, estimated_paid_traffic_cost: 99 } } }]))),
  handleCompetitorsDomain: vi.fn(async () => json(labs([
    { domain: 'a.com', avg_position: 12.3, intersections: 40, full_domain_metrics: { organic: { etv: 5000, count: 800 } } },
    { domain: 'b.com', avg_position: 20, intersections: 10, full_domain_metrics: { organic: { etv: 100, count: 50 } } },
  ]))),
  handleBulkTrafficEstimation: vi.fn(async () => json(labs([{ metrics: { organic: { etv: 2222, count: 15 }, paid: { etv: 10, count: 1 } } }]))),
}));
vi.mock('../../routes/backlinks', () => ({
  handleBacklinksSummary: vi.fn(async () => json({ data: { backlinks: 120, referring_domains: 30, referring_main_domains: 28, rank: 210, broken_backlinks: 2, referring_ips: 25 }, cost: 0.02 })),
}));

import { domainOverview, rankedKeywords, competitors, keywordGap } from './domains';
import * as comp from '../../routes/competitors';

const identity: McpIdentity = {
  userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false,
  defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token',
};

describe('datawise_domain_overview', () => {
  it('condenses rank overview, traffic and backlinks into one object', async () => {
    const { env } = makeMcpTestEnv();
    const out = await domainOverview.run(domainOverview.inputSchema.parse({ domain: 'https://www.Example.com/path' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.domain).toBe('example.com');
    expect(s.organic).toEqual({ keywords_total: 15, top_3: 5, top_10: 10, top_100: 15, estimated_monthly_traffic: 1234.5, traffic_value_usd: 99 });
    expect(s.traffic_estimate).toEqual({ organic_monthly_visits: 2222, paid_monthly_visits: 10 });
    expect(s.backlinks).toEqual({ total: 120, referring_domains: 30, referring_main_domains: 28, domain_rank: 210, broken: 2 });
    expect(s.errors).toEqual([]);
  });

  it('reports a failed sub-call instead of failing the whole tool', async () => {
    const { env } = makeMcpTestEnv();
    (comp.handleBulkTrafficEstimation as any).mockImplementationOnce(async () => json({ error: 'DataForSEO request failed', detail: 'x' }, 502));
    const out = await domainOverview.run(domainOverview.inputSchema.parse({ domain: 'example.com' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.traffic_estimate).toBeNull();
    expect(s.errors[0]).toContain('traffic');
    expect(out.isError).toBeUndefined();
  });

  it('includes raw sub-call payloads in detailed mode, omits raw in concise mode', async () => {
    const { env } = makeMcpTestEnv();
    const concise = await domainOverview.run(domainOverview.inputSchema.parse({ domain: 'example.com' }), { env, identity });
    expect((concise.structuredContent as any).raw).toBeUndefined();

    const detailed = await domainOverview.run(domainOverview.inputSchema.parse({ domain: 'example.com', response_format: 'detailed' }), { env, identity });
    const raw = (detailed.structuredContent as any).raw;
    expect(raw.rank).toEqual({ metrics: { organic: { pos_1: 2, pos_2_3: 3, pos_4_10: 5, pos_11_20: 4, pos_21_30: 1, etv: 1234.5, count: 15, estimated_paid_traffic_cost: 99 } } });
    expect(raw.traffic).toEqual({ metrics: { organic: { etv: 2222, count: 15 }, paid: { etv: 10, count: 1 } } });
    expect(raw.backlinks).toEqual({ backlinks: 120, referring_domains: 30, referring_main_domains: 28, rank: 210, broken_backlinks: 2, referring_ips: 25 });
  });
});

describe('datawise_ranked_keywords', () => {
  it('flattens rows and applies min_volume / max_position filters', async () => {
    const { env } = makeMcpTestEnv();
    const out = await rankedKeywords.run(rankedKeywords.inputSchema.parse({ domain: 'z.com', limit: 4, min_volume: 750, max_position: 3 }), { env, identity });
    const rows = (out.structuredContent as any).keywords;
    expect(rows).toEqual([
      { keyword: 'k0', position: 1, search_volume: 1000, cpc: 1, difficulty: 20, url: 'https://x/k0', estimated_traffic: 100 },
      { keyword: 'k1', position: 2, search_volume: 900, cpc: 1, difficulty: 20, url: 'https://x/k1', estimated_traffic: 90 },
      { keyword: 'k2', position: 3, search_volume: 800, cpc: 1, difficulty: 20, url: 'https://x/k2', estimated_traffic: 80 },
    ]);
  });

  it('includes the raw items behind returned rows in detailed mode, omits raw in concise mode', async () => {
    const { env } = makeMcpTestEnv();
    const concise = await rankedKeywords.run(rankedKeywords.inputSchema.parse({ domain: 'z.com', limit: 4, min_volume: 750, max_position: 3 }), { env, identity });
    expect((concise.structuredContent as any).raw).toBeUndefined();

    const detailed = await rankedKeywords.run(rankedKeywords.inputSchema.parse({ domain: 'z.com', limit: 4, min_volume: 750, max_position: 3, response_format: 'detailed' }), { env, identity });
    const s = detailed.structuredContent as any;
    expect(s.raw).toHaveLength(3);
    expect(s.raw.map((r: any) => r.keyword_data.keyword)).toEqual(['k0', 'k1', 'k2']);
  });
});

describe('datawise_competitors', () => {
  it('returns competitor rows sorted as DataForSEO returns them, capped at limit', async () => {
    const { env } = makeMcpTestEnv();
    const out = await competitors.run(competitors.inputSchema.parse({ domain: 'z.com', limit: 1 }), { env, identity });
    expect((out.structuredContent as any).competitors).toEqual([
      { domain: 'a.com', avg_position: 12.3, shared_keywords: 40, estimated_monthly_traffic: 5000, keywords_total: 800 },
    ]);
  });

  it('includes the raw competitor items in detailed mode, omits raw in concise mode', async () => {
    const { env } = makeMcpTestEnv();
    const concise = await competitors.run(competitors.inputSchema.parse({ domain: 'z.com', limit: 1 }), { env, identity });
    expect((concise.structuredContent as any).raw).toBeUndefined();

    const detailed = await competitors.run(competitors.inputSchema.parse({ domain: 'z.com', limit: 1, response_format: 'detailed' }), { env, identity });
    const s = detailed.structuredContent as any;
    expect(s.raw).toEqual([
      { domain: 'a.com', avg_position: 12.3, intersections: 40, full_domain_metrics: { organic: { etv: 5000, count: 800 } } },
    ]);
  });
});

describe('datawise_keyword_gap', () => {
  it('lists keywords the competitor ranks for that you do not, by volume', async () => {
    const { env } = makeMcpTestEnv();
    const out = await keywordGap.run(keywordGap.inputSchema.parse({ my_domain: 'me.com', competitor_domain: 'rival.com' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.gaps.map((g: any) => g.keyword)).toEqual(['gap kw', 'gap kw 2']);
    expect(s.gaps[0]).toEqual({ keyword: 'gap kw', search_volume: 900, competitor_position: 5 });
    expect(s.shared).toEqual([{ keyword: 'shared kw', search_volume: 500, my_position: 3, competitor_position: 1 }]);
    expect(s.summary).toEqual({ gaps: 2, shared: 1, my_advantages: 1 });
    const sent = await (comp.handleRankedKeywords as any).mock.calls.at(-1)[0].json();
    expect(sent.limit).toBe(300);
  });

  it('includes raw ranked-keyword items for each side in detailed mode, omits raw in concise mode', async () => {
    const { env } = makeMcpTestEnv();
    const concise = await keywordGap.run(keywordGap.inputSchema.parse({ my_domain: 'me.com', competitor_domain: 'rival.com' }), { env, identity });
    expect((concise.structuredContent as any).raw).toBeUndefined();

    const detailed = await keywordGap.run(keywordGap.inputSchema.parse({ my_domain: 'me.com', competitor_domain: 'rival.com', limit: 1, response_format: 'detailed' }), { env, identity });
    const s = detailed.structuredContent as any;
    expect(s.raw.my).toHaveLength(1);
    expect(s.raw.my[0].keyword_data.keyword).toBe('shared kw');
    expect(s.raw.competitor).toHaveLength(1);
    expect(s.raw.competitor[0].keyword_data.keyword).toBe('shared kw');
  });
});
