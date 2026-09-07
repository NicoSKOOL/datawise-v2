import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

vi.mock('../../routes/keywords', () => {
  const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
  const labsItem = (keyword: string, vol: number) => ({
    keyword,
    keyword_info: { search_volume: vol, cpc: 1.5, competition: 0.3, competition_level: 'LOW' },
    keyword_properties: { keyword_difficulty: 42 },
    search_intent_info: { main_intent: 'informational' },
  });
  return {
    handleRelatedKeywords: vi.fn(async (req: Request) => {
      const body = await req.clone().json() as any;
      return json({ tasks: [{ result: [{ items: Array.from({ length: Math.min(body.limit, 3) }, (_, i) => ({
        keyword_data: { keyword: `${body.keyword} ${i}`, keyword_info: { search_volume: 100 - i, cpc: 0.5, competition: 0.1, competition_level: 'LOW' } },
      })) }] }] });
    }),
    handleKeywordSuggestions: vi.fn(async (req: Request) => {
      const body = await req.clone().json() as any;
      return json({ tasks: [{ result: [{ items: [labsItem(`${body.keyword} suggestion`, 50)] }] }] });
    }),
    handleKeywordIdeas: vi.fn(async () => json({ tasks: [{ result: [{ items: [labsItem('idea', 20)] }] }] })),
    handleKeywordOverview: vi.fn(async (req: Request) => {
      const body = await req.clone().json() as any;
      return json({ tasks: [{ result: [{ items: [labsItem(body.keyword, 900)] }] }] });
    }),
    handleKeywordDifficulty: vi.fn(async (req: Request) => {
      const body = await req.clone().json() as any;
      return json({ tasks: [{ result: [{ items: body.keywords.map((k: string) => ({ keyword: k, keyword_difficulty: 33 })) }] }] });
    }),
  };
});

import { keywordResearch, keywordMetrics } from './keywords';
import * as routes from '../../routes/keywords';

const identity: McpIdentity = {
  userId: 'u1', email: 'a@b.c', tier: 'community', isAdmin: false, isCommunityMember: true,
  defaultLocationCode: 2826, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token',
};

describe('datawise_keyword_research', () => {
  it('defaults to related mode with the user locale and returns flat rows', async () => {
    const { env } = makeMcpTestEnv();
    const args = keywordResearch.inputSchema.parse({ keyword: 'seo tools' });
    const out = await keywordResearch.run(args, { env, identity });
    expect(out.isError).toBeUndefined();
    const sent = await (routes.handleRelatedKeywords as any).mock.calls[0][0].json();
    expect(sent).toMatchObject({ keyword: 'seo tools', location_code: 2826, language_code: 'en', limit: 25 });
    const rows = (out.structuredContent as any).keywords;
    expect(rows[0]).toEqual({ keyword: 'seo tools 0', search_volume: 100, cpc: 0.5, competition_level: 'LOW' });
    expect((out.structuredContent as any).mode).toBe('related');
    expect(out.content[0].text).toContain('3 keywords');
  });

  it('suggestions mode includes difficulty and intent, honours explicit locale', async () => {
    const { env } = makeMcpTestEnv();
    const args = keywordResearch.inputSchema.parse({ keyword: 'x', mode: 'suggestions', location_code: 2840, limit: 10 });
    const out = await keywordResearch.run(args, { env, identity });
    const rows = (out.structuredContent as any).keywords;
    expect(rows[0]).toEqual({ keyword: 'x suggestion', search_volume: 50, cpc: 1.5, competition_level: 'LOW', difficulty: 42, intent: 'informational' });
    const sent = await (routes.handleKeywordSuggestions as any).mock.calls[0][0].json();
    expect(sent.location_code).toBe(2840);
  });

  it('rejects limit above 100 at the schema', () => {
    expect(() => keywordResearch.inputSchema.parse({ keyword: 'x', limit: 101 })).toThrow();
  });

  it('detailed response_format adds a raw payload; concise omits it', async () => {
    const { env } = makeMcpTestEnv();
    const detailedArgs = keywordResearch.inputSchema.parse({ keyword: 'seo tools', response_format: 'detailed' });
    const detailedOut = await keywordResearch.run(detailedArgs, { env, identity });
    const detailed = detailedOut.structuredContent as any;
    expect(detailed.raw).toHaveLength(detailed.keywords.length);
    expect(detailed.raw[0]).toHaveProperty('keyword_info');

    const conciseArgs = keywordResearch.inputSchema.parse({ keyword: 'seo tools' });
    const conciseOut = await keywordResearch.run(conciseArgs, { env, identity });
    expect((conciseOut.structuredContent as any).raw).toBeUndefined();
  });
});

describe('datawise_keyword_metrics', () => {
  it('merges overview and difficulty per keyword', async () => {
    const { env } = makeMcpTestEnv();
    const args = keywordMetrics.inputSchema.parse({ keywords: ['seo audit'] });
    const out = await keywordMetrics.run(args, { env, identity });
    const rows = (out.structuredContent as any).keywords;
    expect(rows).toEqual([{ keyword: 'seo audit', search_volume: 900, cpc: 1.5, competition_level: 'LOW', difficulty: 33, intent: 'informational' }]);
  });

  it('caps at 50 keywords', () => {
    expect(() => keywordMetrics.inputSchema.parse({ keywords: new Array(51).fill('k') })).toThrow();
  });
});
