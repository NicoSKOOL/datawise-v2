import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

vi.mock('../../routes/rank-tracking', () => ({
  handleListProjects: vi.fn(async (_env: unknown, userId: string) => json([
    { id: 'p1', user_id: userId, name: 'Main site', domain: 'me.com', project_type: 'organic', location_code: 2840, keyword_count: 12, ranking_keywords: 9, avg_position: 8.4, last_checked_at: '2026-09-05', secret_col: 'hidden in concise' },
  ])),
  handleListKeywords: vi.fn(async (_env: unknown, _userId: string, projectId: string) =>
    projectId === 'p1'
      ? json([{ id: 'k1', keyword: 'seo tools', position: 4, prev_position: 6, rank_group: 4, estimated_traffic: 30, checked_at: '2026-09-05', target_url: 'https://me.com/' }])
      : json({ error: 'Project not found' }, 404)),
  handleKeywordHistory: vi.fn(async () => json({ keyword: { id: 'k1', keyword: 'seo tools' }, history: [{ position: 4, checked_at: '2026-09-05' }, { position: 6, checked_at: '2026-09-03' }] })),
}));
vi.mock('../../routes/ai-tracking', () => ({
  handleGetAITracking: vi.fn(async () => json({ queries: [{ id: 'q1', query_text: 'best seo tool', engines: { chatgpt: { status: 'cited' } } }] })),
  handleAIReport: vi.fn(async (req: Request) => json({ period: Number(new URL(req.url).searchParams.get('period')), trend: [{ date: '2026-09-01', engine: 'chatgpt', total: 10, cited: 3, score: 30 }], share_of_voice: [{ domain: 'me.com', is_you: true, count: 3 }] })),
}));
vi.mock('../../routes/local-seo', () => ({
  handleReviews: vi.fn(async (req: Request) => {
    const b = await req.clone().json() as any;
    return json({ items: [{ rating: 5, review_text: '<b>Great</b>', timestamp: '2026-08-01' }], depth: b.depth, project_id: b.project_id ?? null });
  }),
  handleGBPProfile: vi.fn(async (req: Request) => {
    const b = await req.clone().json() as any;
    if (b.business_name === '__boom__') return json({ error: 'Internal error' }, 500);
    return json({ title: 'Acme Plumbing', rating: { value: 4.7, votes_count: 88 }, category: 'Plumber' });
  }),
}));
vi.mock('../../gsc/oauth', () => ({
  handleGSCProperties: vi.fn(async () => json({ connected: true, properties: [{ id: 'gp1', site_url: 'sc-domain:me.com', kind: 'google', last_synced_at: '2026-09-06', notes: 'extra column' }] })),
}));
vi.mock('../../gsc/sync', () => ({
  handleGSCData: vi.fn(async (req: Request) => {
    const u = new URL(req.url);
    return json({ property_id: u.searchParams.get('property_id'), range: u.searchParams.get('range'), totals: { clicks: 100, impressions: 5000 } });
  }),
  handleGSCQueries: vi.fn(async (req: Request) => {
    const u = new URL(req.url);
    return json({ queries: [{ query: u.searchParams.get('search') ?? 'any', clicks: 5 }], limit: Number(u.searchParams.get('limit')), sort: u.searchParams.get('sort') });
  }),
}));

import { rankTracking, aiVisibility, localReviews, searchConsole } from './stored';
import { ALL_TOOLS } from './registry';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

describe('datawise_rank_tracking', () => {
  it('list_projects returns the spreadsheet fields in concise mode and everything in detailed', async () => {
    const { env } = makeMcpTestEnv();
    const c = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'list_projects' }), { env, identity });
    expect((c.structuredContent as any).projects[0]).toEqual({ id: 'p1', name: 'Main site', domain: 'me.com', project_type: 'organic', location_code: 2840, keyword_count: 12, ranking_keywords: 9, avg_position: 8.4, last_checked_at: '2026-09-05' });
    const d = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'list_projects', response_format: 'detailed' }), { env, identity });
    expect((d.structuredContent as any).projects[0].secret_col).toBe('hidden in concise');
    expect((d.structuredContent as any).projects[0].user_id).toBeUndefined();
  });

  it('project_keywords requires project_id and surfaces not-found as a tool error', async () => {
    const { env } = makeMcpTestEnv();
    expect(() => rankTracking.inputSchema.parse({ action: 'project_keywords' })).toThrow();
    const ok = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'project_keywords', project_id: 'p1' }), { env, identity });
    expect((ok.structuredContent as any).keywords[0]).toEqual({ id: 'k1', keyword: 'seo tools', position: 4, prev_position: 6, estimated_traffic: 30, checked_at: '2026-09-05', target_url: 'https://me.com/' });
    const missing = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'project_keywords', project_id: 'nope' }), { env, identity });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('Project not found');
  });

  it('keyword_history', async () => {
    const { env } = makeMcpTestEnv();
    const out = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'keyword_history', keyword_id: 'k1' }), { env, identity });
    expect((out.structuredContent as any).history).toHaveLength(2);
  });
});

describe('datawise_ai_visibility', () => {
  it('returns the report and, on request, the tracked queries', async () => {
    const { env } = makeMcpTestEnv();
    const r = await aiVisibility.run(aiVisibility.inputSchema.parse({ project_id: 'p1', period: 30 }), { env, identity });
    const s = r.structuredContent as any;
    expect(s.period).toBe(30);
    expect(s.trend[0].score).toBe(30);
    expect(s.queries).toBeUndefined();
    const q = await aiVisibility.run(aiVisibility.inputSchema.parse({ project_id: 'p1', include_queries: true }), { env, identity });
    expect((q.structuredContent as any).queries[0].query_text).toBe('best seo tool');
  });
});

describe('datawise_local_reviews', () => {
  it('needs place_id or business_name, returns profile plus sanitized reviews', async () => {
    const { env } = makeMcpTestEnv();
    expect(() => localReviews.inputSchema.parse({})).toThrow();
    const out = await localReviews.run(localReviews.inputSchema.parse({ place_id: 'ChIJ123', limit: 40, project_id: 'p9' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.profile).toEqual({ title: 'Acme Plumbing', rating: { value: 4.7, votes_count: 88 }, category: 'Plumber' });
    expect(s.reviews.items[0].review_text).toBe('Great');
    expect(s.reviews.depth).toBe(40);
    expect(s.reviews.project_id).toBe('p9');
  });

  it('rethrows a 5xx from the profile lookup instead of swallowing it into an {error} field', async () => {
    // guarded() only converts HandlerError with status < 500 into an isError
    // tool result (see stored.ts); a 500 is deliberately left to propagate so
    // the caller of run() (the gate) reports it as an internal error, rather
    // than this tool silently returning a 200-shaped {error} field for it.
    const { env } = makeMcpTestEnv();
    await expect(
      localReviews.run(localReviews.inputSchema.parse({ business_name: '__boom__' }), { env, identity })
    ).rejects.toThrow('Internal error');
  });
});

describe('datawise_search_console', () => {
  it('list_properties honours response_format: concise picks fields, detailed keeps everything', async () => {
    const { env } = makeMcpTestEnv();
    const props = await searchConsole.run(searchConsole.inputSchema.parse({ action: 'list_properties' }), { env, identity });
    const concise = (props.structuredContent as any).properties[0];
    expect(concise.site_url).toBe('sc-domain:me.com');
    expect(Object.keys(concise).sort()).toEqual(['id', 'kind', 'last_synced_at', 'site_url']);
    const detailedProps = await searchConsole.run(searchConsole.inputSchema.parse({ action: 'list_properties', response_format: 'detailed' }), { env, identity });
    const detailed = (detailedProps.structuredContent as any).properties[0];
    expect(detailed.site_url).toBe('sc-domain:me.com');
    expect(detailed.notes).toBe('extra column');
  });

  it('overview sends range_days as the handler-accepted range value', async () => {
    const { env } = makeMcpTestEnv();
    expect(() => searchConsole.inputSchema.parse({ action: 'overview' })).toThrow();
    const ov = await searchConsole.run(searchConsole.inputSchema.parse({ action: 'overview', property_id: 'gp1', range_days: 30 }), { env, identity });
    const s = (ov.structuredContent as any);
    expect(s.overview.totals.clicks).toBe(100);
    expect(s.overview.range).toBe('30');
    expect(s.range_days).toBe(30);
  });

  it('queries sends the handler-accepted sort value', async () => {
    const { env } = makeMcpTestEnv();
    const qs = await searchConsole.run(searchConsole.inputSchema.parse({ action: 'queries', property_id: 'gp1', search: 'plumber', sort: 'avg_ctr', limit: 50 }), { env, identity });
    const s = (qs.structuredContent as any);
    expect(s.queries.queries[0].query).toBe('plumber');
    expect(s.queries.limit).toBe(50);
    expect(s.queries.sort).toBe('avg_ctr');
  });
});

describe('registry', () => {
  it('exposes twelve uniquely named datawise_ tools', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    for (const n of names) expect(n.startsWith('datawise_')).toBe(true);
  });
});
