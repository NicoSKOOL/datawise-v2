import { describe, it, expect } from 'vitest';
import { CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { makeMcpTestEnv } from './test-support';
import { handleAuthorize, readStash, isLoopbackRedirect, AUTHREQ_PREFIX } from './authorize';

const BASE = 'http://localhost:8788';

async function registeredClient(env: any, redirect = 'https://claude.ai/api/mcp/auth_callback') {
  return env.OAUTH_PROVIDER.createClient({ clientName: 'Claude', clientUri: 'https://claude.ai', redirectUris: [redirect], tokenEndpointAuthMethod: 'none' });
}

// Forces the SECOND lookupClient call in handleAuthorize (the one that
// fetches display metadata after parseAuthRequest already validated the
// client) down a chosen path, without disturbing parseAuthRequest's own
// internal lookupClient call. A plain object spread of env.OAUTH_PROVIDER
// would lose every method: they live on the class prototype, not as own
// properties, so `{ ...env.OAUTH_PROVIDER, lookupClient: ... }` silently
// drops parseAuthRequest too. Binding parseAuthRequest to the real instance
// keeps its internal `this.lookupClient` pointed at the real, working
// implementation, while the explicit second call in handleAuthorize hits
// our override.
function envWithSecondLookup(env: any, lookupClient: (clientId: string) => Promise<unknown>) {
  const provider = env.OAUTH_PROVIDER;
  return { ...env, OAUTH_PROVIDER: { parseAuthRequest: provider.parseAuthRequest.bind(provider), lookupClient } };
}

function authorizeUrl(clientId: string, redirect: string, responseType = 'code') {
  const params = new URLSearchParams({
    response_type: responseType,
    client_id: clientId,
    redirect_uri: redirect,
    scope: 'read',
    state: 'st',
    code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256',
  });
  return `${BASE}/authorize?${params.toString()}`;
}

describe('/authorize', () => {
  it('stashes the parsed request and redirects to the SPA consent page', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const client = await registeredClient(env);
    const res = await handleAuthorize(new Request(authorizeUrl(client.clientId, client.redirectUris[0])), env);
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('Location')!);
    expect(location.origin + location.pathname).toBe('https://app.test/connect');
    const nonce = location.searchParams.get('req')!;
    expect(nonce.length).toBeGreaterThanOrEqual(32);
    const stash = await readStash(env, nonce);
    expect(stash?.client.clientName).toBe('Claude');
    expect(stash?.authRequest.clientId).toBe(client.clientId);
    expect(stash?.authRequest.state).toBe('st');
    expect(stash?.redirectUri).toBe(client.redirectUris[0]);
    expect(kvStore.has(`${AUTHREQ_PREFIX}${nonce}`)).toBe(true);
  });

  it('renders a local 400 for an unknown client (never redirects)', async () => {
    const { env } = makeMcpTestEnv();
    const res = await handleAuthorize(new Request(authorizeUrl('nope', 'https://claude.ai/api/mcp/auth_callback')), env);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(await res.text()).toContain('DataWise');
  });

  it('renders a local 400 when the post-parse client lookup returns null (CIMD race)', async () => {
    const { env } = makeMcpTestEnv();
    const client = await registeredClient(env);
    const raced = envWithSecondLookup(env, async () => null);
    const res = await handleAuthorize(new Request(authorizeUrl(client.clientId, client.redirectUris[0])), raced);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(await res.text()).toContain('DataWise');
  });

  it('renders a local 400 when the post-parse client lookup throws CimdFetchError (CIMD race)', async () => {
    const { env } = makeMcpTestEnv();
    const client = await registeredClient(env);
    const raced = envWithSecondLookup(env, async () => {
      throw new CimdFetchError('https://example.com/client-metadata.json', new Error('metadata document stopped resolving'));
    });
    const res = await handleAuthorize(new Request(authorizeUrl(client.clientId, client.redirectUris[0])), raced);
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
    expect(await res.text()).toContain('DataWise');
  });

  it('redirects OAuth errors to a validated redirect_uri with state', async () => {
    const { env } = makeMcpTestEnv();
    const client = await registeredClient(env);
    const res = await handleAuthorize(new Request(authorizeUrl(client.clientId, client.redirectUris[0], 'token')), env);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('Location')!);
    expect(loc.origin + loc.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(loc.searchParams.get('error')).toBeTruthy();
    expect(loc.searchParams.get('state')).toBe('st');
  });

  it('rejects non-GET', async () => {
    const { env } = makeMcpTestEnv();
    expect((await handleAuthorize(new Request(`${BASE}/authorize`, { method: 'POST' }), env)).status).toBe(405);
  });

  it('isLoopbackRedirect recognises Claude Code style redirects', () => {
    expect(isLoopbackRedirect('http://localhost:53421/callback')).toBe(true);
    expect(isLoopbackRedirect('http://127.0.0.1:8080/cb')).toBe(true);
    expect(isLoopbackRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(false);
  });
});
