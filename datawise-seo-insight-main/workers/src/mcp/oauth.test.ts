import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import { createApiToken } from './tokens';

vi.mock('./server', () => ({
  handleMcpRequest: vi.fn(async (_req: Request, _env: unknown, _ctx: unknown, identity: any) =>
    new Response(JSON.stringify({ mcp: true, email: identity.email, authKind: identity.authKind, tokenName: identity.tokenName }))),
}));

import worker from './index';
import { handleMcpRequest } from './server';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const BASE = 'http://localhost:8788';

async function pkce() {
  const verifier = 'v'.repeat(43);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

describe('OAuth provider wiring', () => {
  it('serves protected resource and authorization server metadata', async () => {
    const { env } = makeMcpTestEnv();
    const prm = await (await worker.fetch(new Request(`${BASE}/.well-known/oauth-protected-resource`), env, ctx)).json() as any;
    expect(prm.resource).toBe(`${BASE}/mcp`);
    expect(prm.authorization_servers).toEqual([BASE]);
    expect(prm.scopes_supported).toEqual(['read']);
    const asm = await (await worker.fetch(new Request(`${BASE}/.well-known/oauth-authorization-server`), env, ctx)).json() as any;
    expect(asm.issuer).toBe(BASE);
    expect(asm.authorization_endpoint).toBe(`${BASE}/authorize`);
    expect(asm.token_endpoint).toBe(`${BASE}/oauth/token`);
    expect(asm.registration_endpoint).toBe(`${BASE}/oauth/register`);
    expect(asm.code_challenge_methods_supported).toEqual(['S256']);
    expect(asm.token_endpoint_auth_methods_supported).toContain('none');
  });

  it('401 on /mcp without a bearer carries resource_metadata', async () => {
    const { env } = makeMcpTestEnv();
    const res = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST' }), env, ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp"`);
    expect(handleMcpRequest).not.toHaveBeenCalled();
  });

  it('personal dwmcp_ tokens still reach the handler through resolveExternalToken', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'pat@test.dev' });
    const { token } = await createApiToken(env, userId, 'laptop');
    const res = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mcp: true, email: 'pat@test.dev', authKind: 'api_token', tokenName: 'laptop' });
  });

  it('invalid or banned dwmcp_ tokens get a 401 with a specific message', async () => {
    const { env } = makeMcpTestEnv();
    const bad = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer dwmcp_' + 'x'.repeat(40) } }), env, ctx);
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain('invalid, revoked, or expired');
    const userId = await seedUser(env, { banned: 1 });
    const { token } = await createApiToken(env, userId, 'cli');
    const banned = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    expect(banned.status).toBe(401);
    expect(await banned.text()).toContain('Account not found or disabled');
  });

  it('a grant issued by completeAuthorization yields a token that reaches the handler as oauth', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'oauth@test.dev' });
    const client = await env.OAUTH_PROVIDER.createClient({ clientName: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'], tokenEndpointAuthMethod: 'none' });
    const { verifier, challenge } = await pkce();
    const authUrl = `${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(client.clientId)}&redirect_uri=${encodeURIComponent(client.redirectUris[0])}&scope=read&state=s1&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(`${BASE}/mcp`)}`;
    const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(authUrl));
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: authRequest, userId, metadata: { clientName: 'Claude' }, scope: ['read'],
      props: { userId, email: 'oauth@test.dev', clientName: 'Claude', authKind: 'oauth', tokenId: `oauth:${client.clientId}` },
    });
    const code = new URL(redirectTo).searchParams.get('code')!;
    expect(new URL(redirectTo).searchParams.get('state')).toBe('s1');
    const tokenRes = await worker.fetch(new Request(`${BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.clientId, redirect_uri: client.redirectUris[0], code_verifier: verifier, resource: `${BASE}/mcp` }),
    }), env, ctx);
    expect(tokenRes.status).toBe(200);
    const { access_token } = await tokenRes.json() as any;
    const res = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${access_token}` } }), env, ctx);
    expect(await res.json()).toEqual({ mcp: true, email: 'oauth@test.dev', authKind: 'oauth', tokenName: 'Claude' });
  });

  it('health and /account/* still route through the default handler; unknown paths 404', async () => {
    const { env } = makeMcpTestEnv();
    expect(await (await worker.fetch(new Request(`${BASE}/health`), env, ctx)).json()).toEqual({ ok: true, service: 'datawise-mcp' });
    expect((await worker.fetch(new Request(`${BASE}/account/tokens`), env, ctx)).status).toBe(401);
    expect((await worker.fetch(new Request(`${BASE}/nope`), env, ctx)).status).toBe(404);
  });

  it('serves the brand icon as PNG at /icon.png and /favicon.ico', async () => {
    const { env } = makeMcpTestEnv();
    for (const path of ['/icon.png', '/favicon.ico']) {
      const res = await worker.fetch(new Request(`${BASE}${path}`), env, ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      const bytes = new Uint8Array(await res.arrayBuffer());
      // PNG signature: 89 50 4E 47
      expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(bytes.length).toBeGreaterThan(1000);
    }
  });

  it("a revoked grant's unexpired access token gets 401 on /mcp", async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'revoke@test.dev' });
    const client = await env.OAUTH_PROVIDER.createClient({ clientName: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'], tokenEndpointAuthMethod: 'none' });
    const { verifier, challenge } = await pkce();
    const authUrl = `${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(client.clientId)}&redirect_uri=${encodeURIComponent(client.redirectUris[0])}&scope=read&state=s1&code_challenge=${challenge}&code_challenge_method=S256&resource=${encodeURIComponent(`${BASE}/mcp`)}`;
    const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(authUrl));
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: authRequest, userId, metadata: { clientName: 'Claude' }, scope: ['read'],
      props: { userId, email: 'revoke@test.dev', clientName: 'Claude', authKind: 'oauth', tokenId: `oauth:${client.clientId}` },
    });
    const code = new URL(redirectTo).searchParams.get('code')!;
    const tokenRes = await worker.fetch(new Request(`${BASE}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.clientId, redirect_uri: client.redirectUris[0], code_verifier: verifier, resource: `${BASE}/mcp` }),
    }), env, ctx);
    const { access_token } = await tokenRes.json() as any;
    const before = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${access_token}` } }), env, ctx);
    expect(before.status).toBe(200);

    const { items } = await env.OAUTH_PROVIDER.listUserGrants(userId, { limit: 10 });
    await env.OAUTH_PROVIDER.revokeGrant(items[0].id, userId);

    const after = await worker.fetch(new Request(`${BASE}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${access_token}` } }), env, ctx);
    expect(after.status).toBe(401);
  });

  it('a token is rejected when presented on a different host (audience mismatch)', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'aud@test.dev' });
    const { token } = await createApiToken(env, userId, 'laptop');
    const res = await worker.fetch(new Request('http://127.0.0.1:8788/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('invalid_token');
  });

  it('dynamic client registration round trip', async () => {
    const { env } = makeMcpTestEnv();
    const res = await worker.fetch(new Request(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT',
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    }), env, ctx);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.client_id).toBeTruthy();
    const client = await env.OAUTH_PROVIDER.lookupClient(body.client_id);
    expect(client?.clientName).toBe('ChatGPT');
  });
});
