import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv, seedUser, seedSession } from './test-support';
import { handleAuthorize } from './authorize';
import { handleAccountRequest } from './account';

const BASE = 'http://localhost:8788';
const ORIGIN = 'https://app.test';

async function startFlow(env: any, redirect = 'https://claude.ai/api/mcp/auth_callback') {
  const client = await env.OAUTH_PROVIDER.createClient({ clientName: 'Claude', clientUri: 'https://claude.ai', redirectUris: [redirect], tokenEndpointAuthMethod: 'none' });
  const url = `${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(client.clientId)}&redirect_uri=${encodeURIComponent(redirect)}&scope=read&state=st&code_challenge=${'c'.repeat(43)}&code_challenge_method=S256&resource=${encodeURIComponent(`${BASE}/mcp`)}`;
  const res = await handleAuthorize(new Request(url), env);
  const req = new URL(res.headers.get('Location')!).searchParams.get('req')!;
  return { client, req };
}

function call(path: string, bearer: string, init: RequestInit = {}) {
  return new Request(`${BASE}${path}`, { ...init, headers: { Origin: ORIGIN, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
}

describe('consent endpoints', () => {
  it('describes the pending request for the signed-in member', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'm@test.dev' });
    const bearer = await seedSession(env, userId);
    const { req } = await startFlow(env);
    const res = await handleAccountRequest(call(`/account/authorize-request?req=${req}`, bearer), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const body = await res.json() as any;
    expect(body).toMatchObject({ client_name: 'Claude', client_uri: 'https://claude.ai', redirect_host: 'claude.ai', loopback: false, scope: ['read'], email: 'm@test.dev', access: true, denial: null });
  });

  it('flags loopback redirects and reports the denial for non-members', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { subscription_tier: 'free', is_community_member: 0 });
    const bearer = await seedSession(env, userId);
    const { req } = await startFlow(env, 'http://localhost:53421/callback');
    const body = await (await handleAccountRequest(call(`/account/authorize-request?req=${req}`, bearer), env)).json() as any;
    expect(body.loopback).toBe(true);
    expect(body.redirect_host).toBe('localhost:53421');
    expect(body.access).toBe(false);
    expect(body.denial).toBe('not_member');
    expect(body.denial_message).toContain('DataWise Pro');
  });

  it('410 for an unknown or expired request', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const bearer = await seedSession(env, userId);
    expect((await handleAccountRequest(call('/account/authorize-request?req=' + 'x'.repeat(32), bearer), env)).status).toBe(410);
    expect((await handleAccountRequest(call('/account/authorize-request/approve', bearer, { method: 'POST', body: JSON.stringify({ req: 'x'.repeat(32) }) }), env)).status).toBe(410);
  });

  it('approve completes the grant, deletes the stash, and the grant appears in /account/grants', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'm@test.dev' });
    const bearer = await seedSession(env, userId);
    const { req } = await startFlow(env);
    const res = await handleAccountRequest(call('/account/authorize-request/approve', bearer, { method: 'POST', body: JSON.stringify({ req }) }), env);
    expect(res.status).toBe(200);
    const { redirect_to } = await res.json() as any;
    const loc = new URL(redirect_to);
    expect(loc.origin + loc.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(loc.searchParams.get('code')).toBeTruthy();
    expect(loc.searchParams.get('state')).toBe('st');
    expect([...kvStore.keys()].some((k) => k.startsWith('mcp_authreq:'))).toBe(false);

    const grants = await (await handleAccountRequest(call('/account/grants', bearer), env)).json() as any;
    expect(grants.grants).toHaveLength(1);
    expect(grants.grants[0]).toMatchObject({ client_name: 'Claude', scope: ['read'] });
    expect(new Date(grants.grants[0].created_at).getFullYear()).toBeGreaterThanOrEqual(2026);

    const del = await handleAccountRequest(call(`/account/grants/${grants.grants[0].id}`, bearer, { method: 'DELETE' }), env);
    expect(await del.json()).toEqual({ ok: true });
    const after = await (await handleAccountRequest(call('/account/grants', bearer), env)).json() as any;
    expect(after.grants).toHaveLength(0);
  });

  it('approve is refused by the access gate (free user, kill switch) and the stash survives for deny', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const userId = await seedUser(env, { subscription_tier: 'free', is_community_member: 0 });
    const bearer = await seedSession(env, userId);
    const { req } = await startFlow(env);
    const res = await handleAccountRequest(call('/account/authorize-request/approve', bearer, { method: 'POST', body: JSON.stringify({ req }) }), env);
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error).toBe('not_member');
    expect(kvStore.has(`mcp_authreq:${req}`)).toBe(true);

    kvStore.set('mcp-paused', '1');
    const member = await seedUser(env);
    const memberBearer = await seedSession(env, member);
    const { req: req2 } = await startFlow(env);
    const paused = await handleAccountRequest(call('/account/authorize-request/approve', memberBearer, { method: 'POST', body: JSON.stringify({ req: req2 }) }), env);
    expect(paused.status).toBe(403);
    expect(((await paused.json()) as any).error).toBe('paused');
  });

  it('deny returns the access_denied redirect with state and removes the stash', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const bearer = await seedSession(env, userId);
    const { req } = await startFlow(env);
    const res = await handleAccountRequest(call('/account/authorize-request/deny', bearer, { method: 'POST', body: JSON.stringify({ req }) }), env);
    const loc = new URL(((await res.json()) as any).redirect_to);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('st');
    expect(kvStore.has(`mcp_authreq:${req}`)).toBe(false);
  });

  it('a grant made by another user cannot be revoked and does not appear', async () => {
    const { env } = makeMcpTestEnv();
    const owner = await seedUser(env);
    const ownerBearer = await seedSession(env, owner);
    const { req } = await startFlow(env);
    await handleAccountRequest(call('/account/authorize-request/approve', ownerBearer, { method: 'POST', body: JSON.stringify({ req }) }), env);
    const grants = await (await handleAccountRequest(call('/account/grants', ownerBearer), env)).json() as any;
    const other = await seedUser(env);
    const otherBearer = await seedSession(env, other);
    expect((await (await handleAccountRequest(call('/account/grants', otherBearer), env)).json() as any).grants).toHaveLength(0);
    await handleAccountRequest(call(`/account/grants/${grants.grants[0].id}`, otherBearer, { method: 'DELETE' }), env);
    const still = await (await handleAccountRequest(call('/account/grants', ownerBearer), env)).json() as any;
    expect(still.grants).toHaveLength(1);
  });
});
