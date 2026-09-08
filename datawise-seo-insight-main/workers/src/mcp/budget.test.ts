import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import { loadIdentity } from './access';
import {
  DEFAULT_USER_CAP_CENTS, GLOBAL_USER_ID, RATE_LIMIT_PER_MINUTE,
  utcDay, estimateCostUsd, readCaps, readSpent, checkBudget, checkRateLimit, recordUsage, budgetMessage,
} from './budget';

async function identityFor(env: any, overrides = {}) {
  const userId = await seedUser(env, overrides);
  return (await loadIdentity(env, { userId, tokenId: 't', tokenName: 'n' }))!;
}

describe('estimateCostUsd', () => {
  it('matches the spec table at default and max limits', () => {
    expect(estimateCostUsd('datawise_keyword_research', { mode: 'related', limit: 100 })).toBeCloseTo(0.048, 6);
    expect(estimateCostUsd('datawise_keyword_research', { mode: 'ideas', limit: 25 })).toBeCloseTo(0.015, 6);
    expect(estimateCostUsd('datawise_keyword_metrics', { keywords: new Array(50).fill('k') })).toBeCloseTo(0.036, 6);
    expect(estimateCostUsd('datawise_domain_overview', {})).toBeCloseTo(0.16, 6);
    expect(estimateCostUsd('datawise_ranked_keywords', { limit: 100, offset: 900 })).toBeCloseTo(0.012 + 0.00012 * 1000, 6);
    expect(estimateCostUsd('datawise_keyword_gap', {})).toBeCloseTo(0.096, 6);
    expect(estimateCostUsd('datawise_backlinks', { view: 'summary' })).toBeCloseTo(0.02436, 6);
    expect(estimateCostUsd('datawise_backlinks', { view: 'list', limit: 100 })).toBeCloseTo(0.0276, 6);
    expect(estimateCostUsd('datawise_ai_mentions', { domains: ['a', 'b'] })).toBeCloseTo(0.12, 6);
    expect(estimateCostUsd('datawise_local_reviews', { limit: 100 })).toBeCloseTo(0.0204, 6);
    expect(estimateCostUsd('datawise_rank_tracking', {})).toBe(0);
    expect(estimateCostUsd('datawise_search_console', {})).toBe(0);
    expect(estimateCostUsd('unknown_tool', {})).toBeCloseTo(0.05, 6);
  });
});

describe('caps and ledger', () => {
  it('reads defaults and KV overrides in cents', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    expect(await readCaps(env)).toEqual({ userCapUsd: DEFAULT_USER_CAP_CENTS / 100, globalCapUsd: 100 });
    kvStore.set('mcp-user-cap-cents', '20');
    kvStore.set('mcp-global-cap-cents', '5000');
    expect(await readCaps(env)).toEqual({ userCapUsd: 0.2, globalCapUsd: 50 });
    kvStore.set('mcp-user-cap-cents', 'garbage');
    expect((await readCaps(env)).userCapUsd).toBe(DEFAULT_USER_CAP_CENTS / 100);
  });

  it('records usage into the user row, the global row, and mcp_calls', async () => {
    const { env, raw } = makeMcpTestEnv();
    const id = await identityFor(env);
    const entry = { userId: id.userId, tool: 'datawise_keyword_research', costUsd: 0.03, cached: false, ok: true, durationMs: 120, authKind: 'api_token', clientName: 'laptop' };
    await recordUsage(env, entry);
    await recordUsage(env, { ...entry, costUsd: 0, cached: true });
    expect(await readSpent(env, id.userId)).toEqual({ costUsd: 0.03, calls: 2 });
    expect(await readSpent(env, GLOBAL_USER_ID)).toEqual({ costUsd: 0.03, calls: 2 });
    const calls = raw.prepare('SELECT tool, cost_usd, cached, ok FROM mcp_calls ORDER BY rowid').all();
    expect(calls).toEqual([
      { tool: 'datawise_keyword_research', cost_usd: 0.03, cached: 0, ok: 1 },
      { tool: 'datawise_keyword_research', cost_usd: 0, cached: 1, ok: 1 },
    ]);
  });

  it('refuses a call that would cross the user cap, admins are unlimited', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    kvStore.set('mcp-user-cap-cents', '20');
    const member = await identityFor(env);
    const admin = await identityFor(env, { is_admin: 1 });
    await recordUsage(env, { userId: member.userId, tool: 'x', costUsd: 0.15, cached: false, ok: true, durationMs: 1, authKind: 'api_token', clientName: 'c' });

    expect(await checkBudget(env, member, 0.04)).toEqual({ ok: true, spentUsd: 0.15, capUsd: 0.2 });
    const denied = await checkBudget(env, member, 0.06);
    expect(denied).toEqual({ ok: false, reason: 'user_cap', spentUsd: 0.15, capUsd: 0.2 });
    expect(budgetMessage(denied as any)).toContain('$0.20');
    expect(budgetMessage(denied as any)).toContain('00:00 UTC');
    expect((await checkBudget(env, admin, 50)).ok).toBe(true); // above the $0.20 user cap, below the $100 global cap
  });

  it('refuses when the global cap is hit, even for admins', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    kvStore.set('mcp-global-cap-cents', '10');
    const admin = await identityFor(env, { is_admin: 1 });
    await recordUsage(env, { userId: 'other', tool: 'x', costUsd: 0.1, cached: false, ok: true, durationMs: 1, authKind: 'api_token', clientName: 'c' });
    expect(await checkBudget(env, admin, 0.01)).toMatchObject({ ok: false, reason: 'global_cap' });
  });

  it('rate limit allows 30 per minute per user', async () => {
    const { env } = makeMcpTestEnv();
    const now = new Date('2026-09-07T10:00:30Z');
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) expect(await checkRateLimit(env, 'u1', now)).toBe(true);
    expect(await checkRateLimit(env, 'u1', now)).toBe(false);
    expect(await checkRateLimit(env, 'u2', now)).toBe(true);
    expect(await checkRateLimit(env, 'u1', new Date('2026-09-07T10:01:00Z'))).toBe(true);
  });

  it('rate limit fails open when KV put rejects (parallel-write contention)', async () => {
    const { env } = makeMcpTestEnv();
    const brokenEnv = {
      ...env,
      KV: {
        get: async () => '0',
        put: async () => { throw new Error('KV put rejected: one write per second per key'); },
        delete: async () => {},
      } as unknown as typeof env.KV,
    };
    expect(await checkRateLimit(brokenEnv, 'u1', new Date('2026-09-07T10:00:30Z'))).toBe(true);
  });

  it('utcDay formats YYYY-MM-DD', () => {
    expect(utcDay(new Date('2026-09-07T23:59:59Z'))).toBe('2026-09-07');
  });
});
