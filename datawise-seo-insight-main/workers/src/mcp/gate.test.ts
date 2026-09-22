import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { makeMcpTestEnv, seedUser } from './test-support';
import { loadIdentity } from './access';
import { readSpent } from './budget';
import { runGated } from './gate';
import { defineTool } from './tools/types';
import { toolResult } from './shape';
import { DataForSeoQuotaError } from '../dataforseo/client';
import { HandlerError } from './call-handler';

const echo = defineTool({
  name: 'datawise_keyword_research',
  description: 'test',
  inputSchema: z.object({ keyword: z.string(), limit: z.number().default(25) }),
  async run(args, ctx) {
    // Pretend a DFS call happened and cost 3 cents.
    ctx.env.dfsMeter!.costUsd += 0.03;
    ctx.env.dfsMeter!.liveCalls += 1;
    return toolResult({ echoed: args.keyword }, 'ok');
  },
});

async function member(env: any, overrides = {}) {
  return (await loadIdentity(env, { userId: await seedUser(env, overrides), tokenId: 't', tokenName: 'laptop' }))!;
}

describe('runGated', () => {
  it('runs the tool, meters actual cost, and logs the call', async () => {
    const { env, raw } = makeMcpTestEnv();
    const identity = await member(env);
    const out = await runGated(echo, { keyword: 'x' }, { env, identity });
    expect(out.structuredContent).toEqual({ echoed: 'x' });
    expect(await readSpent(env, identity.userId)).toEqual({ costUsd: 0.03, calls: 1 });
    const row = raw.prepare('SELECT tool, cost_usd, cached, ok, auth_kind, client_name FROM mcp_calls').get() as any;
    expect(row).toEqual({ tool: 'datawise_keyword_research', cost_usd: 0.03, cached: 0, ok: 1, auth_kind: 'api_token', client_name: 'laptop' });
    expect(env.dfsMeter).toBeUndefined();
  });

  it('denies free accounts before running anything', async () => {
    const { env } = makeMcpTestEnv();
    const identity = await member(env, { subscription_tier: 'free', is_community_member: 0 });
    const out = await runGated(echo, { keyword: 'x' }, { env, identity });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('AI Ranking Skool');
    expect(await readSpent(env, identity.userId)).toEqual({ costUsd: 0, calls: 0 });
  });

  it('rejects invalid input with a readable message', async () => {
    const { env } = makeMcpTestEnv();
    const identity = await member(env);
    const out = await runGated(echo, { limit: 'lots' }, { env, identity });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('keyword');
  });

  it('refuses when the estimate would cross the cap', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    kvStore.set('mcp-user-cap-cents', '1');
    const identity = await member(env);
    const out = await runGated(echo, { keyword: 'x', limit: 100 }, { env, identity });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('Daily MCP budget');
  });

  it('maps DataForSEO quota and handler errors to tool errors and still logs', async () => {
    const { env, raw } = makeMcpTestEnv();
    const identity = await member(env);
    const quota = defineTool({ ...echo, name: 'datawise_competitors', async run() { throw new DataForSeoQuotaError(); } });
    const q = await runGated(quota, { keyword: 'x' }, { env, identity });
    expect(q.content[0].text).toContain('DataForSEO daily quota');
    const bad = defineTool({ ...echo, name: 'datawise_competitors', async run() { throw new HandlerError(400, 'Target domain is required'); } });
    const b = await runGated(bad, { keyword: 'x' }, { env, identity });
    expect(b.content[0].text).toBe('Target domain is required');
    const boom = defineTool({ ...echo, name: 'datawise_competitors', async run() { throw new Error('secret internals'); } });
    const c = await runGated(boom, { keyword: 'x' }, { env, identity });
    expect(c.content[0].text).not.toContain('secret internals');
    expect((raw.prepare('SELECT COUNT(*) AS n FROM mcp_calls WHERE ok = 0').get() as any).n).toBe(3);
  });
});
