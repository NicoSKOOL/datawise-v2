import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
vi.mock('../../routes/llm-mentions', () => ({
  handleAggregate: vi.fn(async (req: Request) => {
    const b = await req.clone().json() as any;
    return json({ data: { target: b.target, platform: b.platform, items: [{ metric: 'mentions', value: 12, note: '<i>x</i>' }] }, cost: 0.1 });
  }),
  handleCrossAggregate: vi.fn(async (req: Request) => {
    const b = await req.clone().json() as any;
    return json({ data: { targets: b.targets, items: [{ target: 'a.com', mentions: 3 }, { target: 'b.com', mentions: 9 }] }, cost: 0.1 });
  }),
}));

import { aiMentions } from './ai-mentions';
import * as llm from '../../routes/llm-mentions';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

describe('datawise_ai_mentions', () => {
  it('one domain uses the aggregate endpoint and strips html', async () => {
    const { env } = makeMcpTestEnv();
    const out = await aiMentions.run(aiMentions.inputSchema.parse({ domains: ['https://A.com'] }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.domains).toEqual(['a.com']);
    expect(s.platform).toBe('google');
    expect(s.metrics.items[0]).toEqual({ metric: 'mentions', value: 12, note: 'x' });
    // DataForSEO requires target objects, the same shape Brand Tracker sends.
    const sent = await (llm.handleAggregate as any).mock.calls[0][0].json();
    expect(sent).toMatchObject({
      target: [{ domain: 'a.com', include_subdomains: true }],
      platform: 'google',
      location_code: 2840,
      language_code: 'en',
    });
  });

  it('several domains use cross-aggregate', async () => {
    const { env } = makeMcpTestEnv();
    const out = await aiMentions.run(aiMentions.inputSchema.parse({ domains: ['a.com', 'b.com'], platform: 'chatgpt' }), { env, identity });
    expect((out.structuredContent as any).metrics.items).toHaveLength(2);
    // Cross-aggregate takes one keyed group per domain; chatgpt maps to the
    // DataForSEO platform name chat_gpt.
    const sent = await (llm.handleCrossAggregate as any).mock.calls[0][0].json();
    expect(sent).toMatchObject({
      targets: [
        { aggregation_key: 'a.com', target: [{ domain: 'a.com', include_subdomains: true }] },
        { aggregation_key: 'b.com', target: [{ domain: 'b.com', include_subdomains: true }] },
      ],
      platform: 'chat_gpt',
    });
    expect((out.structuredContent as any).platform).toBe('chat_gpt');
  });

  it('accepts the DataForSEO spelling chat_gpt and rejects platforms LLM Mentions does not cover', () => {
    expect(aiMentions.inputSchema.parse({ domains: ['a.com'], platform: 'chat_gpt' }).platform).toBe('chat_gpt');
    expect(() => aiMentions.inputSchema.parse({ domains: ['a.com'], platform: 'gemini' })).toThrow();
    expect(() => aiMentions.inputSchema.parse({ domains: ['a.com'], platform: 'perplexity' })).toThrow();
  });

  it('rejects more than 5 domains', () => {
    expect(() => aiMentions.inputSchema.parse({ domains: ['1', '2', '3', '4', '5', '6'].map((n) => `${n}.com`) })).toThrow();
  });
});
