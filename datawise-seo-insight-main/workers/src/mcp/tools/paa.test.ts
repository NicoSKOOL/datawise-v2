import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

vi.mock('../../routes/ai', () => ({
  handlePeopleAlsoAsk: vi.fn(async (req: Request) => {
    const b = await req.clone().json() as any;
    if (b.keyword === '__boom__') return json({ error: 'Keyword is required' }, 400);
    return json({
      data: [
        { position: 1, source_type: 'people_also_ask', question: 'How much does a plumber cost?', answer: '<b>About $150</b> per hour.', source_url: 'https://a.com/x', source_domain: 'a.com', search_iteration: 1, depth_level: 1, parent_keyword: b.keyword },
        { position: 2, source_type: 'related_search', question: 'plumber near me', answer: '', source_url: '', source_domain: '', search_iteration: 1, depth_level: 1, parent_keyword: b.keyword },
      ],
      source_stats: { people_also_ask: 1, related_search: 1 },
      extraction_method: 'iterative_serp',
      clicks_simulated: b.depth,
      estimated_cost: 0.003,
      api_calls_made: 1,
      keywords_searched: [b.keyword],
      iteration_stats: { depth_1: 2 },
      content_map: { root: b.keyword, clusters: [{ topic: 'cost', questions: ['How much does a plumber cost?'] }] },
      echo: { location: b.location, language: b.language, depth: b.depth },
    });
  }),
}));

import { peopleAlsoAsk } from './paa';
import * as ai from '../../routes/ai';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2036, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

describe('datawise_people_also_ask', () => {
  it('sends keyword, depth and the account locale in the shape the handler expects', async () => {
    const { env } = makeMcpTestEnv();
    const out = await peopleAlsoAsk.run(peopleAlsoAsk.inputSchema.parse({ keyword: 'plumber melbourne' }), { env, identity });
    const sent = await (ai.handlePeopleAlsoAsk as any).mock.calls[0][0].json();
    // The handler reads `location` as a string and `language`; depth defaults to 2.
    expect(sent).toEqual({ keyword: 'plumber melbourne', location: '2036', language: 'en', depth: 2 });
    const s = out.structuredContent as any;
    expect(s.keyword).toBe('plumber melbourne');
    expect(s.location_code).toBe(2036);
    expect(s.depth).toBe(2);
    expect(s.api_calls_made).toBe(1);
  });

  it('returns questions with html stripped, plus stats and the content map', async () => {
    const { env } = makeMcpTestEnv();
    const out = await peopleAlsoAsk.run(peopleAlsoAsk.inputSchema.parse({ keyword: 'plumber', depth: 1, location_code: 2840 }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.questions).toHaveLength(2);
    expect(s.questions[0]).toEqual({
      question: 'How much does a plumber cost?',
      answer: 'About $150 per hour.',
      source_url: 'https://a.com/x',
      source_domain: 'a.com',
      source_type: 'people_also_ask',
      depth: 1,
      parent: 'plumber',
    });
    expect(s.source_stats).toEqual({ people_also_ask: 1, related_search: 1 });
    expect(s.content_map.clusters[0].topic).toBe('cost');
    const sent = await (ai.handlePeopleAlsoAsk as any).mock.calls.at(-1)[0].json();
    expect(sent.location).toBe('2840');
    expect(sent.depth).toBe(1);
  });

  it('turns a handler 4xx into a tool error instead of throwing', async () => {
    const { env } = makeMcpTestEnv();
    const out = await peopleAlsoAsk.run(peopleAlsoAsk.inputSchema.parse({ keyword: '__boom__' }), { env, identity });
    expect(out.isError).toBe(true);
    expect((out.content[0] as any).text).toMatch(/Keyword is required/);
  });

  it('rejects depth outside 1 to 3 and empty keywords', () => {
    expect(() => peopleAlsoAsk.inputSchema.parse({ keyword: 'x', depth: 4 })).toThrow();
    expect(() => peopleAlsoAsk.inputSchema.parse({ keyword: 'x', depth: 0 })).toThrow();
    expect(() => peopleAlsoAsk.inputSchema.parse({ keyword: '' })).toThrow();
  });
});
