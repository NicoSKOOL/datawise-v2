import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import { recordUsage } from './budget';

let currentUser: { id: string; email: string } | null = null;
vi.mock('../middleware/auth', () => ({
  authMiddleware: vi.fn(async () => currentUser),
}));

import { handleAccountRequest } from './account';

const ORIGIN = 'https://app.test';
const req = (path: string, init: RequestInit = {}) =>
  new Request(`https://mcp.test${path}`, { ...init, headers: { Origin: ORIGIN, Authorization: 'Bearer session', 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

describe('account routes', () => {
  it('preflight allows the frontend origin only', async () => {
    const { env } = makeMcpTestEnv();
    const ok = await handleAccountRequest(new Request('https://mcp.test/account/tokens', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(ok.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    const bad = await handleAccountRequest(new Request('https://mcp.test/account/tokens', { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }), env);
    expect(bad.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('401 without a session', async () => {
    const { env } = makeMcpTestEnv();
    currentUser = null;
    expect((await handleAccountRequest(req('/account/tokens'), env)).status).toBe(401);
  });

  it('token lifecycle: create (secret once), list (no secret), revoke', async () => {
    const { env } = makeMcpTestEnv();
    const id = await seedUser(env, { email: 'm@test.dev' });
    currentUser = { id, email: 'm@test.dev' };

    const created = await handleAccountRequest(req('/account/tokens', { method: 'POST', body: JSON.stringify({ name: 'Claude Code' }) }), env);
    expect(created.status).toBe(201);
    const body = await created.json() as any;
    expect(body.token.startsWith('dwmcp_')).toBe(true);
    expect(body.name).toBe('Claude Code');
    expect(created.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);

    const list = await (await handleAccountRequest(req('/account/tokens'), env)).json() as any;
    expect(list.tokens).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(body.token);

    expect((await handleAccountRequest(req(`/account/tokens/${body.id}`, { method: 'DELETE' }), env)).status).toBe(200);
    expect((await handleAccountRequest(req(`/account/tokens/${body.id}`, { method: 'DELETE' }), env)).status).toBe(404);
    expect(((await (await handleAccountRequest(req('/account/tokens'), env)).json()) as any).tokens).toHaveLength(0);
  });

  it('409 at the token limit, 400 on a missing name', async () => {
    const { env } = makeMcpTestEnv();
    const id = await seedUser(env);
    currentUser = { id, email: 'x@test.dev' };
    for (let i = 0; i < 5; i++) await handleAccountRequest(req('/account/tokens', { method: 'POST', body: JSON.stringify({ name: `t${i}` }) }), env);
    expect((await handleAccountRequest(req('/account/tokens', { method: 'POST', body: JSON.stringify({ name: 'six' }) }), env)).status).toBe(409);
    expect((await handleAccountRequest(req('/account/tokens', { method: 'POST', body: JSON.stringify({}) }), env)).status).toBe(400);
  });

  it('usage reflects access, spend and cap', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const member = await seedUser(env, { email: 'm2@test.dev' });
    await recordUsage(env, { userId: member, tool: 'x', costUsd: 0.5, cached: false, ok: true, durationMs: 1, authKind: 'api_token', clientName: 'c' });
    currentUser = { id: member, email: 'm2@test.dev' };
    const u = await (await handleAccountRequest(req('/account/usage'), env)).json() as any;
    expect(u).toMatchObject({ access: true, denial: null, spent_usd: 0.5, cap_usd: 4, calls: 1, mcp_url: 'http://localhost:8788/mcp', max_tokens: 5 });
    expect(u.resets_at.endsWith('T00:00:00.000Z')).toBe(true);

    const free = await seedUser(env, { subscription_tier: 'free', is_community_member: 0, email: 'f@test.dev' });
    currentUser = { id: free, email: 'f@test.dev' };
    expect(await (await handleAccountRequest(req('/account/usage'), env)).json()).toMatchObject({ access: false, denial: 'not_member' });

    kvStore.set('mcp-paused', '1');
    currentUser = { id: member, email: 'm2@test.dev' };
    expect(await (await handleAccountRequest(req('/account/usage'), env)).json()).toMatchObject({ access: false, denial: 'paused' });
  });
});
