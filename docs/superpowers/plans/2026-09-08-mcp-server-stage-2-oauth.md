# DataWise MCP Server, Stage 2 (OAuth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member add `https://mcp.datawiseseo.com/mcp` as a custom connector in claude.ai, Claude Desktop, ChatGPT, or Claude Code, sign in with their DataWise account, click Allow, and use the twelve existing tools with no tokens to copy.

**Architecture:** The `datawise-mcp` worker becomes its own OAuth 2.1 authorization server using `@cloudflare/workers-oauth-provider` 0.10.3. The provider wraps the whole worker: `/mcp` is the protected route, everything else (`/health`, `/account/*`, `/authorize`) is the default handler. Personal `dwmcp_` tokens keep working through the provider's `resolveExternalToken` hook, so both auth kinds land in the same handler with `ctx.props`. Consent happens in the SPA at `/connect`, which talks to the worker with the normal DataWise session. Stage 1 tools, gates, budget and ledger are untouched.

**Tech Stack:** TypeScript, Cloudflare Workers (wrangler ~4.107), `@cloudflare/workers-oauth-provider` 0.10.3, a second KV namespace `OAUTH_KV`, vitest with the `better-sqlite3` D1 shim, React 18 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-07-datawise-mcp-server-design.md`, sections 4.2, 4.3, 7, 8, 11. Section 12 holds Nico's decisions. Stage 1 plan: `docs/superpowers/plans/2026-09-07-mcp-server-stage-1.md` (already built on branch `feat/mcp-server`, PR #141).

## Global Constraints

- Branch `feat/mcp-oauth`, forked from `feat/mcp-server`; PR into `feat/mcp-server` (GitHub retargets to `production` when #141 merges). Never `git add .` or `git add -A`. Never amend or force-push.
- No em dashes anywhere (code comments, UI copy, docs). Use colons, commas, or separate sentences.
- All worker commands run from `datawise-seo-insight-main/workers/`; all SPA commands from `datawise-seo-insight-main/`, unless stated otherwise.
- Deploy only with `npm run deploy:mcp`. Never `npm run deploy:production`.
- Public URL `https://mcp.datawiseseo.com`. Canonical resource `https://mcp.datawiseseo.com/mcp`. Authorization server issuer `https://mcp.datawiseseo.com`.
- OAuth endpoints: `/authorize` (ours), `/oauth/token` and `/oauth/register` (library), `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` (library).
- Single grant scope `read`. Authorization server metadata also advertises `offline_access` (Claude asks for a refresh token only when it is listed); resource metadata lists `read` only. Access token TTL 3600 s. Refresh token TTL library default (30 days). CIMD and DCR both enabled. PKCE S256 only (library default).
- The provider's KV binding is `OAUTH_KV` (a dedicated namespace, never the main `KV`). The consent stash lives in the main `KV` under `mcp_authreq:<nonce>`, TTL 600 s.
- OAuth `props` stored per grant: `{ userId, email, clientName }`. Tools never read the raw token. The MCP bearer is never forwarded anywhere.
- Every `/mcp` request, either auth kind, still runs the stage 1 gate (`runGated`): kill switch, membership, allowlist, rate, budget, ledger. `authKind` in the ledger is `'oauth'` for provider tokens and `'api_token'` for `dwmcp_` tokens; `client_name` is the OAuth client's name (for example "Claude" or "ChatGPT") or the personal token's name.
- The MCP never reads or writes `users.credits_used`.
- Community is paid; the app is the perk. Never write "join the community for free".
- Commits end with the two trailer lines below, each on its own line:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01JMJ17JXiAhGs4fDKPuECdT`

## Library contract (verified 2026-09-08 from the installed 0.10.3 types)

Read this before touching the worker. It is what the code below is written against.

- `new OAuthProvider<Env>(options)` with `fetch(request, env, ctx)`. Options used: `apiRoute: '/mcp'`, `apiHandler: { fetch }` (a plain object with a `fetch(request, env, ctx)` method is accepted), `defaultHandler: { fetch }`, `authorizeEndpoint`, `tokenEndpoint`, `clientRegistrationEndpoint`, `scopesSupported`, `accessTokenTTL`, `clientIdMetadataDocumentEnabled`, `resourceMetadata: { resource, authorization_servers, scopes_supported, resource_name }`, `resolveExternalToken`, `onError`.
- The provider injects `env.OAUTH_PROVIDER: OAuthHelpers` into the env it passes to both handlers. `apiHandler` receives the verified props on `ctx.props`.
- `OAuthHelpers` methods used: `parseAuthRequest(request): Promise<AuthRequest>`, `lookupClient(clientId): Promise<ClientInfo | null>`, `completeAuthorization({ request, userId, metadata, scope, props }): Promise<{ redirectTo }>`, `listUserGrants(userId, { limit }): Promise<{ items: GrantSummary[]; cursor? }>`, `revokeGrant(grantId, userId): Promise<void>`, `createClient(partial)` (tests only). `getOAuthApi(options, env)` returns the same helpers outside a fetch (tests).
- `AuthRequest` = `{ responseType, clientId, redirectUri, scope: string[], state, codeChallenge?, codeChallengeMethod?, resource?, issuer? }`. It is plain JSON and survives a KV round trip.
- `ClientInfo` fields used: `clientId, clientName?, clientUri?, logoUri?, redirectUris`.
- `GrantSummary` = `{ id, clientId, userId, scope, metadata, createdAt (unix seconds), expiresAt?, redirectUri? }`.
- `parseAuthRequest` throws `AuthorizationError` (`code, description, redirectUri?, state?, issuer?`) for bad requests; redirect to `redirectUri` only when it is present. `lookupClient` throws `CimdFetchError` when a CIMD document cannot be fetched.
- `resolveExternalToken({ token, request, env })` runs when the bearer is not one of the provider's own tokens. Return `{ props, audience }` where `audience` MUST equal `resourceMetadata.resource` exactly, or `null` for a generic 401. Throw `new ExternalTokenError('invalid_token', { description, statusCode: 401 })` for a specific message.
- Audience check on `/mcp` compares the token audience with `${protocol}//${host}${pathname}` of the incoming request. So `MCP_PUBLIC_URL` must equal the host the request arrives on. Production: `https://mcp.datawiseseo.com`. Local: `http://localhost:8788` via `.dev.vars` (never committed).
- Unauthenticated `/mcp` gets `401` with `WWW-Authenticate: Bearer realm="OAuth", resource_metadata="<issuer>/.well-known/oauth-protected-resource/mcp"`.
- CIMD requires `compatibility_flags` to include `global_fetch_strictly_public` (SSRF protection; the flag is why the security checklist item about private IP ranges is satisfied) and `compatibility_date >= 2024-11-11`.
- KV methods the library calls on `OAUTH_KV`: `get(key, { type: 'json' })`, `put(key, value, { expirationTtl })`, `delete(key)`, `list({ prefix, limit, cursor })` returning `{ keys: [{ name }], list_complete, cursor? }`. Timestamps are unix seconds.
- `completeAuthorization` revokes earlier grants for the same user + client by default (scoped to the same redirect URI for CIMD clients). Keep the default.
- `provider.purgeExpiredData(env, { batchSize })` sweeps orphaned grants and tokens; call it from `scheduled`.

## File map

Worker (`datawise-seo-insight-main/workers/`):

| File | Responsibility |
|---|---|
| `package.json` | add `@cloudflare/workers-oauth-provider` 0.10.3 |
| `wrangler.mcp.toml` | `global_fetch_strictly_public` flag, `OAUTH_KV` binding |
| `src/mcp/env.ts` | `OAUTH_KV`, `OAUTH_PROVIDER` on `McpEnv`; `McpProps` type |
| `src/mcp/test-support.ts` | `fakeKv` gains `list` and JSON reads; `makeMcpTestEnv` wires `OAUTH_KV` and `OAUTH_PROVIDER` via `getOAuthApi`; `seedSession` helper |
| `src/mcp/oauth.ts` (new) | `oauthOptions(publicUrl)`, `getProvider(env)`, `resolveExternalToken`, `mcpApiHandler` (props to identity) |
| `src/mcp/authorize.ts` (new) | `GET /authorize`: parse, look up client, stash, redirect to SPA `/connect` |
| `src/mcp/consent.ts` (new) | session-authenticated `/account/authorize-request` GET, `/approve`, `/deny`, plus `/account/grants` GET and DELETE |
| `src/mcp/account.ts` | route the four consent and grant paths into `consent.ts` |
| `src/mcp/index.ts` | `fetch` delegates to the provider; `scheduled` also purges OAuth KV |
| `src/mcp/index.test.ts` | rewritten to go through the provider |
| `src/mcp/oauth.test.ts` (new) | discovery documents, both auth kinds on `/mcp`, full code flow end to end |
| `src/mcp/authorize.test.ts` (new) | `/authorize` parse, stash, redirect, error paths |
| `src/mcp/consent.test.ts` (new) | consent info, approve (gate applied), deny, grants list and revoke |

SPA (`datawise-seo-insight-main/`):

| File | Responsibility |
|---|---|
| `src/lib/return-to.ts` (new) | `setReturnTo`, `consumeReturnTo` (sessionStorage) so login returns to `/connect` |
| `src/lib/__tests__/return-to.test.ts` (new) | unit tests |
| `src/pages/Auth.tsx`, `src/pages/AuthCallback.tsx` | honour the return path after login |
| `src/lib/mcp.ts` | `McpApiError` with status, grant types and hooks, consent calls |
| `src/lib/__tests__/mcp.test.ts` | new cases |
| `src/pages/ConnectPage.tsx` (new) | consent page at `/connect` |
| `src/App.tsx` | `/connect` route (own auth handling, no sidebar) |
| `src/components/settings/McpAccessCard.tsx` | "Connected apps" list, setup tabs for claude.ai, ChatGPT, Claude Code, other |
| `scripts/deploy-pages-production.mjs` | marker `Connected apps` |

Docs: `DEPLOY.md` (MCP worker section), root `claude.md`.

---

### Task 1: Dependency, wrangler config, env types, test support

**Files:**
- Modify: `workers/package.json`
- Modify: `workers/wrangler.mcp.toml`
- Modify: `workers/src/mcp/env.ts`
- Modify: `workers/src/mcp/test-support.ts`
- Test: `workers/src/mcp/test-support.test.ts` (new)

**Interfaces:**
- Produces: `McpEnv.OAUTH_KV: KVNamespace`, `McpEnv.OAUTH_PROVIDER: OAuthHelpers`, `McpProps`, `fakeKv` with `list`, `seedSession(env, userId): Promise<string>` returning a session bearer, `makeMcpTestEnv()` now returning `{ env, kvStore, oauthStore, raw }`.

- [ ] **Step 1: Install the library**

Run from `workers/`:
```sh
npm install @cloudflare/workers-oauth-provider@0.10.3 --save-exact --no-audit --no-fund
```
Expected: `package.json` `dependencies` gains `"@cloudflare/workers-oauth-provider": "0.10.3"`.

- [ ] **Step 2: Update `wrangler.mcp.toml`**

Replace the `compatibility_flags` line and add the OAuth KV binding after the existing `[[kv_namespaces]]` block. The namespace already exists on the account (created 2026-09-08 with `wrangler kv namespace create OAUTH_KV`, title `OAUTH_KV`); use this exact id.

```toml
compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]
```

```toml
# OAuth 2.1 state for @cloudflare/workers-oauth-provider (hashed tokens,
# grants, registered clients). Dedicated namespace: never the main KV.
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "991a27d75c304529910720aef008ffe7"
```

Also extend the secrets comment: `# Secrets ... : DATAFORSEO_EMAIL, DATAFORSEO_PASSWORD, ENCRYPTION_KEY (no new secrets in stage 2)`.

- [ ] **Step 3: Extend `env.ts`**

```ts
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
```
Add to `McpEnv`:
```ts
  // Stage 2: dedicated KV for @cloudflare/workers-oauth-provider state, and
  // the helpers the provider injects into env on every request it handles.
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
```
Add after `McpIdentity`:
```ts
// What the OAuth provider hands the protected handler on ctx.props. Both auth
// kinds produce this shape (spec 4.3): grants store it encrypted per grant,
// personal tokens build it in resolveExternalToken.
export interface McpProps {
  userId: string;
  email: string;
  clientName: string;
  authKind: 'api_token' | 'oauth';
  tokenId: string;
}
```

- [ ] **Step 4: Write the failing test for the richer fake KV and session seeding**

`workers/src/mcp/test-support.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { fakeKv, makeMcpTestEnv, seedUser, seedSession } from './test-support';
import { authMiddleware } from '../middleware/auth';
import { asWorkerEnv } from './env';

describe('test support', () => {
  it('fakeKv lists by prefix and reads json', async () => {
    const store = new Map<string, string>();
    const kv = fakeKv(store);
    await kv.put('grant:u1:a', JSON.stringify({ id: 'a' }));
    await kv.put('grant:u1:b', JSON.stringify({ id: 'b' }));
    await kv.put('grant:u2:c', JSON.stringify({ id: 'c' }));
    const listed = await kv.list({ prefix: 'grant:u1:' });
    expect(listed.keys.map((k) => k.name).sort()).toEqual(['grant:u1:a', 'grant:u1:b']);
    expect(listed.list_complete).toBe(true);
    expect(await kv.get('grant:u1:a', { type: 'json' })).toEqual({ id: 'a' });
    expect(await kv.get('grant:u1:a', 'json')).toEqual({ id: 'a' });
  });

  it('makeMcpTestEnv exposes OAUTH_KV, OAUTH_PROVIDER and a working session seed', async () => {
    const { env } = makeMcpTestEnv();
    expect(env.OAUTH_KV).toBeDefined();
    expect(typeof env.OAUTH_PROVIDER.parseAuthRequest).toBe('function');
    const userId = await seedUser(env, { email: 's@test.dev' });
    const bearer = await seedSession(env, userId);
    const user = await authMiddleware(new Request('https://mcp.test/x', { headers: { Authorization: `Bearer ${bearer}` } }), asWorkerEnv(env));
    expect(user?.id).toBe(userId);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run src/mcp/test-support.test.ts`
Expected: FAIL (`seedSession` not exported, `list` missing, `OAUTH_KV` undefined).

- [ ] **Step 6: Implement test support**

Replace `workers/src/mcp/test-support.ts` with:
```ts
import type Database from 'better-sqlite3';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { createTestDb } from '../test-support/d1';
import type { McpEnv } from './env';
import { oauthOptions } from './oauth';

// In-memory KV that honours get (text or json), put, delete and list-by-prefix
// and ignores TTLs. Tests that care about expiry set entries directly on the
// store. The OAuth provider needs list(); everything else only needs get/put.
export function fakeKv(store: Map<string, string>): KVNamespace {
  const readType = (arg: unknown): string | undefined =>
    typeof arg === 'string' ? arg : (arg as { type?: string } | undefined)?.type;
  return {
    get: async (key: string, arg?: unknown) => {
      const v = store.get(key);
      if (v == null) return null;
      return readType(arg) === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
    list: async (opts: { prefix?: string; limit?: number; cursor?: string } = {}) => {
      const names = [...store.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort();
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const limit = opts.limit ?? 1000;
      const page = names.slice(start, start + limit);
      const done = start + limit >= names.length;
      return { keys: page.map((name) => ({ name })), list_complete: done, cursor: done ? undefined : String(start + limit) };
    },
  } as unknown as KVNamespace;
}

export function makeMcpTestEnv(): { env: McpEnv; kvStore: Map<string, string>; oauthStore: Map<string, string>; raw: Database.Database } {
  const { d1, raw } = createTestDb();
  const kvStore = new Map<string, string>();
  const oauthStore = new Map<string, string>();
  const publicUrl = 'http://localhost:8788';
  const env = {
    DB: d1,
    KV: fakeKv(kvStore),
    OAUTH_KV: fakeKv(oauthStore),
    DATAFORSEO_EMAIL: 'dfs@test',
    DATAFORSEO_PASSWORD: 'secret',
    ENCRYPTION_KEY: 'test-key',
    FRONTEND_URL: 'https://app.test',
    ADMIN_EMAILS: 'nico@airankingskool.com',
    MCP_PUBLIC_URL: publicUrl,
  } as McpEnv;
  env.OAUTH_PROVIDER = getOAuthApi(oauthOptions(publicUrl), env);
  return { env, kvStore, oauthStore, raw };
}

export interface SeedUser {
  id: string;
  email: string;
  subscription_tier: 'free' | 'pro' | 'community';
  is_community_member: 0 | 1;
  is_admin: 0 | 1;
  banned: 0 | 1;
}

export async function seedUser(env: McpEnv, overrides: Partial<SeedUser> = {}): Promise<string> {
  const u: SeedUser = {
    id: 'u_' + Math.random().toString(36).slice(2, 10),
    email: `${Math.random().toString(36).slice(2, 8)}@test.dev`,
    subscription_tier: 'community',
    is_community_member: 1,
    is_admin: 0,
    banned: 0,
    ...overrides,
  };
  await env.DB.prepare(
    'INSERT INTO users (id, email, subscription_tier, is_community_member, is_admin, banned) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(u.id, u.email, u.subscription_tier, u.is_community_member, u.is_admin, u.banned).run();
  return u.id;
}

// A DataWise session the real authMiddleware accepts (KV fast path).
export async function seedSession(env: McpEnv, userId: string): Promise<string> {
  const bearer = 'sess_' + Math.random().toString(36).slice(2, 14);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer));
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  await env.KV.put(`session:${hex}`, userId);
  return bearer;
}
```

`oauthOptions` does not exist yet; create a minimal `workers/src/mcp/oauth.ts` now so this compiles, and Task 2 fills it in:
```ts
import type { OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import type { McpEnv } from './env';

// Filled in by Task 2. Kept here so test-support can import it from Task 1.
export function oauthOptions(publicUrl: string): OAuthProviderOptions<McpEnv> {
  return {
    apiRoute: '/mcp',
    apiHandler: { fetch: async () => new Response('not wired', { status: 501 }) },
    defaultHandler: { fetch: async () => new Response('not wired', { status: 501 }) },
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: ['read'],
    accessTokenTTL: 3600,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: `${publicUrl}/mcp`,
      authorization_servers: [publicUrl],
      scopes_supported: ['read'],
      resource_name: 'DataWise',
    },
  };
}
```

- [ ] **Step 7: Run the test and the whole suite**

Run: `npx vitest run src/mcp/test-support.test.ts` then `npx tsc --noEmit -p . && npx vitest run`
Expected: new test PASS; the full suite still passes (existing tests only use `env.KV`, `env.DB`).

- [ ] **Step 8: Commit**

```sh
git add package.json package-lock.json wrangler.mcp.toml src/mcp/env.ts src/mcp/test-support.ts src/mcp/test-support.test.ts src/mcp/oauth.ts
git commit -m "feat(mcp): add workers-oauth-provider, OAUTH_KV binding, env types and test support for stage 2"
```

---

### Task 2: Provider wiring: `oauth.ts` and `index.ts`

**Files:**
- Modify: `workers/src/mcp/oauth.ts`
- Modify: `workers/src/mcp/index.ts`
- Modify: `workers/src/mcp/index.test.ts`
- Test: `workers/src/mcp/oauth.test.ts` (new)

**Interfaces:**
- Consumes: `validateApiToken`, `TOKEN_PREFIX` (tokens.ts), `loadIdentity` (access.ts), `handleMcpRequest` (server.ts), `handleAccountRequest` (account.ts), `McpProps`.
- Produces: `oauthOptions(publicUrl)`, `getProvider(env)`, `mcpApiHandler`, `defaultHandler`, `handleAuthorize` placeholder import from `./authorize` (Task 3 creates it; in this task create a stub returning 501 so the import resolves).

- [ ] **Step 1: Write the failing tests**

`workers/src/mcp/oauth.test.ts`:
```ts
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
});
```

Rewrite `workers/src/mcp/index.test.ts` to keep only the scheduled purge test (the routing cases moved above):
```ts
import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv } from './test-support';
import worker from './index';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('datawise-mcp scheduled', () => {
  it('purges mcp_calls older than 30 days and sweeps OAuth KV without throwing', async () => {
    const { env, raw } = makeMcpTestEnv();
    raw.prepare("INSERT INTO mcp_calls (user_id, tool, auth_kind, created_at) VALUES ('u','t','api_token', datetime('now','-31 days')), ('u','t','api_token', datetime('now'))").run();
    await worker.scheduled({} as ScheduledEvent, env, ctx);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM mcp_calls').get() as any).n).toBe(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/mcp/oauth.test.ts src/mcp/index.test.ts`
Expected: FAIL (501 responses from the stub handlers; `/health` not routed).

- [ ] **Step 3: Implement `oauth.ts`**

Replace `workers/src/mcp/oauth.ts` with:
```ts
import { OAuthProvider, ExternalTokenError, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import type { McpEnv, McpProps } from './env';
import { validateApiToken, TOKEN_PREFIX } from './tokens';
import { loadIdentity } from './access';
import { handleMcpRequest } from './server';
import { handleAccountRequest } from './account';
import { handleAuthorize } from './authorize';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// Personal dwmcp_ tokens (stage 1) enter through the provider's external
// token hook so both auth kinds land in mcpApiHandler with ctx.props.
// audience must equal resourceMetadata.resource exactly (library contract).
async function resolveExternalToken({ token, env }: { token: string; request: Request; env: McpEnv }) {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const validated = await validateApiToken(env, token);
  if (!validated) {
    throw new ExternalTokenError('invalid_token', { description: 'Token is invalid, revoked, or expired. Create one in DataWise Settings under MCP & AI assistants.', statusCode: 401 });
  }
  const identity = await loadIdentity(env, validated, 'api_token');
  if (!identity) throw new ExternalTokenError('invalid_token', { description: 'Account not found or disabled.', statusCode: 401 });
  const props: McpProps = { userId: identity.userId, email: identity.email, clientName: identity.tokenName, authKind: 'api_token', tokenId: identity.tokenId };
  return { props, audience: `${env.MCP_PUBLIC_URL}/mcp` };
}

// Protected route. ctx.props was verified by the provider (either kind).
// Membership, bans and tier are re-read from D1 on every call via
// loadIdentity, so revoking a member cuts off OAuth grants immediately.
export const mcpApiHandler = {
  async fetch(request: Request, env: McpEnv, ctx: ExecutionContext & { props: McpProps }): Promise<Response> {
    const props = ctx.props;
    const identity = await loadIdentity(env, { userId: props.userId, tokenId: props.tokenId, tokenName: props.clientName }, props.authKind);
    if (!identity) return json({ error: 'unauthorized', message: 'Account not found or disabled.' }, 401);
    return handleMcpRequest(request, env, ctx, identity);
  },
};

export const defaultHandler = {
  async fetch(request: Request, env: McpEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/health') return json({ ok: true, service: 'datawise-mcp' });
    if (path.startsWith('/account/')) return handleAccountRequest(request, env);
    if (path === '/authorize') return handleAuthorize(request, env);
    return json({ error: 'not_found' }, 404);
  },
};

export function oauthOptions(publicUrl: string): OAuthProviderOptions<McpEnv> {
  return {
    apiRoute: '/mcp',
    apiHandler: mcpApiHandler as unknown as OAuthProviderOptions<McpEnv>['apiHandler'],
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    // DCR stays on: ChatGPT and older Claude builds fall back to it (spec 2.2).
    clientRegistrationEndpoint: '/oauth/register',
    // offline_access is advertised only in the authorization server metadata
    // so Claude asks for a refresh token (claude.com/docs/connectors/building/
    // authentication). The resource metadata below stays 'read' only, and
    // grants are always scope ['read'].
    scopesSupported: ['read', 'offline_access'],
    accessTokenTTL: 3600,
    // CIMD is the preferred registration for claude.ai. Needs the
    // global_fetch_strictly_public compatibility flag (wrangler.mcp.toml).
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: `${publicUrl}/mcp`,
      // authorization_servers is deliberately omitted: the library only
      // accepts https values there and falls back to the request origin,
      // which is the issuer in both production and local dev.
      scopes_supported: ['read'],
      resource_name: 'DataWise',
    },
    resolveExternalToken,
    onError: ({ code, description, status, internal }) => {
      if (status >= 500 || internal) console.error('[mcp-oauth]', status, code, description, internal ?? '');
    },
  };
}

// One provider per public URL (production and local differ). Options are
// static apart from that URL, so memoising is safe across requests.
const providers = new Map<string, OAuthProvider<McpEnv>>();
export function getProvider(env: McpEnv): OAuthProvider<McpEnv> {
  let p = providers.get(env.MCP_PUBLIC_URL);
  if (!p) {
    p = new OAuthProvider<McpEnv>(oauthOptions(env.MCP_PUBLIC_URL));
    providers.set(env.MCP_PUBLIC_URL, p);
  }
  return p;
}
```

Create the stub `workers/src/mcp/authorize.ts` (Task 3 replaces it):
```ts
import type { McpEnv } from './env';

export async function handleAuthorize(_request: Request, _env: McpEnv): Promise<Response> {
  return new Response('not wired', { status: 501 });
}
```

- [ ] **Step 4: Rewrite `index.ts`**

```ts
import type { McpEnv } from './env';
import { getProvider } from './oauth';

export default {
  // Everything goes through the OAuth provider (spec 4.3): /mcp is the
  // protected route (grant tokens or dwmcp_ tokens via resolveExternalToken),
  // /oauth/token, /oauth/register and /.well-known/* are served by the
  // library, and the rest (/health, /account/*, /authorize) reaches
  // defaultHandler in oauth.ts.
  async fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    return getProvider(env).fetch(request, env, ctx);
  },

  // Daily at 03:00 UTC (wrangler.mcp.toml). Keeps mcp_calls bounded (D1 is
  // the constrained resource, memory project_d1_full_incident_2026-06-25) and
  // sweeps orphaned OAuth grants and tokens.
  async scheduled(_event: ScheduledEvent, env: McpEnv, _ctx: ExecutionContext): Promise<void> {
    const { meta } = await env.DB.prepare("DELETE FROM mcp_calls WHERE created_at < datetime('now', '-30 days')").run();
    console.log(`[mcp] purged ${meta.changes} mcp_calls rows older than 30 days`);
    try {
      const swept = await getProvider(env).purgeExpiredData(env, { batchSize: 100 });
      console.log(`[mcp] oauth sweep: grants ${swept.grantsPurged ?? 0}, tokens ${swept.tokensPurged ?? 0}`);
    } catch (err) {
      console.error('[mcp] oauth sweep failed:', err);
    }
  },
};
```
`PurgeResult` is `{ grantsChecked, grantsPurged, tokensChecked, tokensPurged, done }` (verified), so the `?? 0` fallbacks are only there to keep the log line safe.

- [ ] **Step 5: Run the tests**

Run: `npx tsc --noEmit -p . && npx vitest run src/mcp/oauth.test.ts src/mcp/index.test.ts`
Expected: PASS. If the provider rejects the plain-object `apiHandler` at runtime, wrap it as `{ fetch: (req, env, ctx) => mcpApiHandler.fetch(req, env, ctx) }` typed as `ExportedHandler<McpEnv>`; do not switch to a `WorkerEntrypoint` class (it would need `cloudflare:workers` in vitest).

- [ ] **Step 6: Run the whole worker suite**

Run: `npx vitest run`
Expected: all green. `account.test.ts` still mocks `authMiddleware`, unaffected.

- [ ] **Step 7: Commit**

```sh
git add src/mcp/oauth.ts src/mcp/authorize.ts src/mcp/index.ts src/mcp/index.test.ts src/mcp/oauth.test.ts
git commit -m "feat(mcp): wrap the worker in workers-oauth-provider; dwmcp_ tokens via resolveExternalToken"
```

---

### Task 3: `/authorize`: parse, stash, redirect to the consent page

**Files:**
- Modify: `workers/src/mcp/authorize.ts`
- Test: `workers/src/mcp/authorize.test.ts` (new)

**Interfaces:**
- Produces: `handleAuthorize(request, env)`, `AUTHREQ_PREFIX = 'mcp_authreq:'`, `AUTHREQ_TTL_SECONDS = 600`, `StashedAuthRequest` `{ authRequest: AuthRequest; client: { clientId, clientName, clientUri?, logoUri? }; redirectUri: string; createdAt: string }`, `readStash(env, nonce)`, `deleteStash(env, nonce)`, `isLoopbackRedirect(uri)`.

- [ ] **Step 1: Write the failing tests**

`workers/src/mcp/authorize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv } from './test-support';
import { handleAuthorize, readStash, isLoopbackRedirect, AUTHREQ_PREFIX } from './authorize';

const BASE = 'http://localhost:8788';

async function registeredClient(env: any, redirect = 'https://claude.ai/api/mcp/auth_callback') {
  return env.OAUTH_PROVIDER.createClient({ clientName: 'Claude', clientUri: 'https://claude.ai', redirectUris: [redirect], tokenEndpointAuthMethod: 'none' });
}

function authorizeUrl(clientId: string, redirect: string, extra = '') {
  return `${BASE}/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&scope=read&state=st&code_challenge=${'c'.repeat(43)}&code_challenge_method=S256${extra}`;
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

  it('redirects OAuth errors to a validated redirect_uri with state', async () => {
    const { env } = makeMcpTestEnv();
    const client = await registeredClient(env);
    const res = await handleAuthorize(new Request(authorizeUrl(client.clientId, client.redirectUris[0], '&scope=read&response_type=token')), env);
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/authorize.test.ts`
Expected: FAIL (501 stub, missing exports).

- [ ] **Step 3: Implement**

Replace `workers/src/mcp/authorize.ts`:
```ts
import { AuthorizationError, CimdFetchError, type AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { McpEnv } from './env';

export const AUTHREQ_PREFIX = 'mcp_authreq:';
export const AUTHREQ_TTL_SECONDS = 600;

export interface StashedAuthRequest {
  authRequest: AuthRequest;
  client: { clientId: string; clientName: string; clientUri?: string; logoUri?: string };
  redirectUri: string;
  createdAt: string;
}

export function isLoopbackRedirect(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function readStash(env: McpEnv, req: string): Promise<StashedAuthRequest | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(req)) return null;
  const raw = await env.KV.get(`${AUTHREQ_PREFIX}${req}`);
  return raw ? (JSON.parse(raw) as StashedAuthRequest) : null;
}

export async function deleteStash(env: McpEnv, req: string): Promise<void> {
  await env.KV.delete(`${AUTHREQ_PREFIX}${req}`);
}

// Minimal HTML for errors we must render locally (unknown client, bad
// redirect). The SPA never sees these; they only appear if a client is broken.
function localError(message: string): Response {
  const safe = message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const html = `<!doctype html><meta charset="utf-8"><title>DataWise: connection failed</title><body style="font-family:system-ui;padding:2rem;max-width:36rem"><h1>DataWise could not start this connection</h1><p>${safe}</p><p>Go back to your AI assistant and try adding the DataWise connector again. If it keeps failing, report it from DataWise Settings.</p></body>`;
  return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Spec 4.2 steps 1 and 2: validate the OAuth request, remember it for ten
// minutes, and send the user to the SPA consent page. The SPA handles login
// (Google or email) and calls back into /account/authorize-request/*.
export async function handleAuthorize(request: Request, env: McpEnv): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof CimdFetchError) return localError('The connecting app could not be verified (its client metadata document could not be fetched).');
    if (!(error instanceof AuthorizationError)) throw error;
    if (!error.redirectUri) return localError(error.description);
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set('error', error.code);
    redirect.searchParams.set('error_description', error.description);
    if (error.state) redirect.searchParams.set('state', error.state);
    if (error.issuer) redirect.searchParams.set('iss', error.issuer);
    return Response.redirect(redirect.toString(), 302);
  }

  let client;
  try {
    client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  } catch (error) {
    if (error instanceof CimdFetchError) return localError('The connecting app could not be verified (its client metadata document could not be fetched).');
    throw error;
  }
  if (!client) return localError('Unknown OAuth client.');

  const req = nonce();
  const stash: StashedAuthRequest = {
    authRequest,
    client: { clientId: client.clientId, clientName: client.clientName || new URL(authRequest.redirectUri).hostname, clientUri: client.clientUri, logoUri: client.logoUri },
    redirectUri: authRequest.redirectUri,
    createdAt: new Date().toISOString(),
  };
  await env.KV.put(`${AUTHREQ_PREFIX}${req}`, JSON.stringify(stash), { expirationTtl: AUTHREQ_TTL_SECONDS });

  const target = new URL('/connect', env.FRONTEND_URL);
  target.searchParams.set('req', req);
  return Response.redirect(target.toString(), 302);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx tsc --noEmit -p . && npx vitest run src/mcp/authorize.test.ts src/mcp/oauth.test.ts`
Expected: PASS. (Verified in the library source: response-type and PKCE validation runs after the client and redirect URI are validated, and those errors carry `redirectUri`, so `response_type=token` produces an `unsupported_response_type` redirect.)

- [ ] **Step 5: Commit**

```sh
git add src/mcp/authorize.ts src/mcp/authorize.test.ts
git commit -m "feat(mcp): /authorize parses the OAuth request, stashes it and redirects to the SPA consent page"
```

---

### Task 4: Consent and grants endpoints under `/account`

**Files:**
- Create: `workers/src/mcp/consent.ts`
- Modify: `workers/src/mcp/account.ts`
- Test: `workers/src/mcp/consent.test.ts` (new)

**Interfaces:**
- Consumes: `readStash`, `deleteStash`, `isLoopbackRedirect` (Task 3), `loadIdentity`, `checkAccess`, `denialMessage` (access.ts), `AuthUser` from `authMiddleware`.
- Produces: `handleConsentRequest(request, env, user, json): Promise<Response | null>` (returns `null` when the path is not one of its five routes) and these JSON shapes:
  - `GET /account/authorize-request?req=` → `{ client_name, client_uri, redirect_host, loopback, scope: ['read'], email, access: boolean, denial: AccessDenial | null, denial_message: string | null }`; 410 `{ error: 'expired', message }` when the stash is missing.
  - `POST /account/authorize-request/approve` body `{ req }` → `{ redirect_to }`; 403 `{ error: denial, message }` when the gate denies; 410 when expired.
  - `POST /account/authorize-request/deny` body `{ req }` → `{ redirect_to }` (the `access_denied` redirect); 410 when expired.
  - `GET /account/grants` → `{ grants: [{ id, client_id, client_name, created_at (ISO), scope }] }`.
  - `DELETE /account/grants/:id` → `{ ok: true }`.

- [ ] **Step 1: Write the failing tests**

`workers/src/mcp/consent.test.ts`:
```ts
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
```

Note: this test file does NOT mock `authMiddleware`; it uses `seedSession`. Keep it that way so the real session path is covered once.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/consent.test.ts`
Expected: FAIL with 404s (routes missing).

- [ ] **Step 3: Implement `consent.ts`**

```ts
import type { McpEnv } from './env';
import type { AuthUser } from '../auth/google';
import { readStash, deleteStash, isLoopbackRedirect } from './authorize';
import { loadIdentity, checkAccess, denialMessage } from './access';

type Json = (data: unknown, status?: number) => Response;

const EXPIRED = { error: 'expired', message: 'This connection request expired or was already used. Go back to your AI assistant and add the DataWise connector again.' };

async function readReq(request: Request): Promise<string> {
  const url = new URL(request.url);
  if (request.method === 'GET') return url.searchParams.get('req') ?? '';
  try {
    const body = (await request.json()) as { req?: unknown };
    return typeof body.req === 'string' ? body.req : '';
  } catch {
    return '';
  }
}

// Spec 4.2 steps 3 and 4 plus the connected-apps list (spec 7). Every route
// here is behind the DataWise session (authMiddleware in account.ts) and the
// frontend CORS allowlist. Returns null for paths it does not own.
export async function handleConsentRequest(request: Request, env: McpEnv, user: AuthUser, json: Json): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path === '/account/authorize-request' && request.method === 'GET') {
    const stash = await readStash(env, await readReq(request));
    if (!stash) return json(EXPIRED, 410);
    const identity = await loadIdentity(env, { userId: user.id, tokenId: '', tokenName: stash.client.clientName }, 'oauth');
    if (!identity) return json({ error: 'unauthorized' }, 401);
    const denial = await checkAccess(env, identity);
    return json({
      client_name: stash.client.clientName,
      client_uri: stash.client.clientUri ?? null,
      redirect_host: new URL(stash.redirectUri).host,
      loopback: isLoopbackRedirect(stash.redirectUri),
      scope: ['read'],
      email: identity.email,
      access: denial === null,
      denial,
      denial_message: denial ? denialMessage(denial) : null,
    });
  }

  if (path === '/account/authorize-request/approve' && request.method === 'POST') {
    const req = await readReq(request);
    const stash = await readStash(env, req);
    if (!stash) return json(EXPIRED, 410);
    const identity = await loadIdentity(env, { userId: user.id, tokenId: '', tokenName: stash.client.clientName }, 'oauth');
    if (!identity) return json({ error: 'unauthorized' }, 401);
    const denial = await checkAccess(env, identity);
    if (denial) return json({ error: denial, message: denialMessage(denial) }, 403);
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: stash.authRequest,
      userId: user.id,
      metadata: { clientName: stash.client.clientName, clientUri: stash.client.clientUri ?? null, redirectUri: stash.redirectUri, approvedAt: new Date().toISOString() },
      scope: ['read'],
      props: { userId: user.id, email: identity.email, clientName: stash.client.clientName, authKind: 'oauth', tokenId: `oauth:${stash.client.clientId}` },
    });
    await deleteStash(env, req);
    return json({ redirect_to: redirectTo });
  }

  if (path === '/account/authorize-request/deny' && request.method === 'POST') {
    const req = await readReq(request);
    const stash = await readStash(env, req);
    if (!stash) return json(EXPIRED, 410);
    const redirect = new URL(stash.redirectUri);
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'The DataWise member declined the connection.');
    if (stash.authRequest.state) redirect.searchParams.set('state', stash.authRequest.state);
    if (stash.authRequest.issuer) redirect.searchParams.set('iss', stash.authRequest.issuer);
    await deleteStash(env, req);
    return json({ redirect_to: redirect.toString() });
  }

  if (path === '/account/grants' && request.method === 'GET') {
    const { items } = await env.OAUTH_PROVIDER.listUserGrants(user.id, { limit: 100 });
    const grants = items
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((g) => ({
        id: g.id,
        client_id: g.clientId,
        client_name: (g.metadata && typeof g.metadata.clientName === 'string' && g.metadata.clientName) || g.clientId,
        created_at: new Date(g.createdAt * 1000).toISOString(),
        scope: g.scope,
      }));
    return json({ grants });
  }

  const grantMatch = path.match(/^\/account\/grants\/([A-Za-z0-9_-]+)$/);
  if (grantMatch && request.method === 'DELETE') {
    // revokeGrant is scoped to (grantId, userId): another user's id never matches.
    await env.OAUTH_PROVIDER.revokeGrant(grantMatch[1], user.id);
    return json({ ok: true });
  }

  return null;
}
```

- [ ] **Step 4: Wire it into `account.ts`**

Add the import `import { handleConsentRequest } from './consent';` and, right after the `authMiddleware` check (before `const path = ...`), insert:
```ts
  const consent = await handleConsentRequest(request, env, user, json);
  if (consent) return consent;
```
Note the existing `json` closure in `account.ts` already applies CORS headers, which is why it is passed in.

- [ ] **Step 5: Run the tests**

Run: `npx tsc --noEmit -p . && npx vitest run src/mcp/consent.test.ts src/mcp/account.test.ts`
Expected: PASS. If `listUserGrants` returns `createdAt` in milliseconds in this build (value above `1e12`), normalise: `const seconds = g.createdAt > 1e12 ? Math.floor(g.createdAt / 1000) : g.createdAt`.

- [ ] **Step 6: Commit**

```sh
git add src/mcp/consent.ts src/mcp/consent.test.ts src/mcp/account.ts
git commit -m "feat(mcp): consent endpoints (describe, approve, deny) and connected-apps grants under /account"
```

---

### Task 5: SPA return path after login

**Files:**
- Create: `src/lib/return-to.ts`
- Create: `src/lib/__tests__/return-to.test.ts`
- Modify: `src/pages/Auth.tsx:50-52`
- Modify: `src/pages/AuthCallback.tsx:15-18`

**Interfaces:**
- Produces: `setReturnTo(path: string): void`, `consumeReturnTo(): string | null`, `RETURN_TO_KEY = 'datawise_return_to'`.

- [ ] **Step 1: Write the failing tests**

`src/lib/__tests__/return-to.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setReturnTo, consumeReturnTo, RETURN_TO_KEY } from '@/lib/return-to';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

describe('return-to', () => {
  beforeEach(() => { (globalThis as any).sessionStorage = memoryStorage(); });

  it('stores an app-relative path and hands it back once', () => {
    setReturnTo('/connect?req=abc');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/connect?req=abc');
    expect(consumeReturnTo()).toBe('/connect?req=abc');
    expect(consumeReturnTo()).toBeNull();
  });

  it('ignores absolute and protocol-relative targets', () => {
    setReturnTo('https://evil.test/x');
    expect(consumeReturnTo()).toBeNull();
    setReturnTo('//evil.test/x');
    expect(consumeReturnTo()).toBeNull();
  });

  it('survives a missing sessionStorage', () => {
    (globalThis as any).sessionStorage = undefined;
    expect(() => setReturnTo('/x')).not.toThrow();
    expect(consumeReturnTo()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `datawise-seo-insight-main/`): `npx vitest run src/lib/__tests__/return-to.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/lib/return-to.ts`:
```ts
// Where to send the user after login. Used by /connect (the MCP consent page)
// because ProtectedRoute and the Google callback always land on "/".
// sessionStorage: same tab only, survives the Google OAuth redirect chain.
export const RETURN_TO_KEY = 'datawise_return_to';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' || sessionStorage === null ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isAppPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

export function setReturnTo(path: string): void {
  if (!isAppPath(path)) return;
  storage()?.setItem(RETURN_TO_KEY, path);
}

export function consumeReturnTo(): string | null {
  const s = storage();
  if (!s) return null;
  const value = s.getItem(RETURN_TO_KEY);
  s.removeItem(RETURN_TO_KEY);
  return value && isAppPath(value) ? value : null;
}
```

- [ ] **Step 4: Use it in the two login landings**

`src/pages/Auth.tsx`: add `import { consumeReturnTo } from '@/lib/return-to';` and change the `if (user)` block to:
```tsx
  if (user) {
    return <Navigate to={consumeReturnTo() ?? '/'} replace />;
  }
```
`src/pages/AuthCallback.tsx`: add the same import and change `navigate('/', { replace: true });` to `navigate(consumeReturnTo() ?? '/', { replace: true });`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/lib/__tests__/return-to.test.ts && npx tsc --noEmit -p tsconfig.app.json`
(If `tsconfig.app.json` does not exist, use the typecheck command from `package.json`; stage 1 used `npx tsc --noEmit -p .`.)
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```sh
git add src/lib/return-to.ts src/lib/__tests__/return-to.test.ts src/pages/Auth.tsx src/pages/AuthCallback.tsx
git commit -m "feat(spa): remember a return path across login so /connect survives the sign-in redirect"
```

---

### Task 6: `lib/mcp.ts` consent and grant calls

**Files:**
- Modify: `src/lib/mcp.ts`
- Modify: `src/lib/__tests__/mcp.test.ts`

**Interfaces:**
- Produces: `class McpApiError extends Error { status: number; code: string | null }` (thrown by `mcpApi`), `McpGrant`, `AuthorizeRequestInfo`, `MCP_GRANTS_KEY`, `useMcpGrants()`, `revokeMcpGrant(id)`, `getAuthorizeRequest(req)`, `approveAuthorizeRequest(req)`, `denyAuthorizeRequest(req)`, `claudeCodeOauthCommand()`.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/__tests__/mcp.test.ts`)

```ts
import { McpApiError, getAuthorizeRequest, approveAuthorizeRequest, denyAuthorizeRequest, revokeMcpGrant, claudeCodeOauthCommand } from '@/lib/mcp';

describe('consent and grant calls', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('mcpApi throws McpApiError carrying status and code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'expired', message: 'Gone.' }), { status: 410 })));
    const err = await getAuthorizeRequest('abc').catch((e) => e);
    expect(err).toBeInstanceOf(McpApiError);
    expect(err.status).toBe(410);
    expect(err.code).toBe('expired');
    expect(err.message).toBe('Gone.');
  });

  it('calls the consent endpoints with the request nonce', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ redirect_to: 'https://claude.ai/cb?code=1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await getAuthorizeRequest('n1');
    await approveAuthorizeRequest('n1');
    await denyAuthorizeRequest('n1');
    await revokeMcpGrant('g1');
    const calls = fetchMock.mock.calls.map(([url, init]: any) => [String(url).replace(/^https?:\/\/[^/]+/, ''), init.method, init.body]);
    expect(calls).toEqual([
      ['/account/authorize-request?req=n1', 'GET', undefined],
      ['/account/authorize-request/approve', 'POST', JSON.stringify({ req: 'n1' })],
      ['/account/authorize-request/deny', 'POST', JSON.stringify({ req: 'n1' })],
      ['/account/grants/g1', 'DELETE', undefined],
    ]);
  });

  it('claudeCodeOauthCommand has no token in it', () => {
    expect(claudeCodeOauthCommand()).toBe(`claude mcp add --transport http datawise ${MCP_SERVER_URL}`);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/mcp.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement**

In `src/lib/mcp.ts`:

Add after the `McpUsage` interface:
```ts
export interface McpGrant {
  id: string;
  client_id: string;
  client_name: string;
  created_at: string;
  scope: string[];
}

export interface AuthorizeRequestInfo {
  client_name: string;
  client_uri: string | null;
  redirect_host: string;
  loopback: boolean;
  scope: string[];
  email: string;
  access: boolean;
  denial: McpUsage['denial'];
  denial_message: string | null;
}

export class McpApiError extends Error {
  status: number;
  code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'McpApiError';
    this.status = status;
    this.code = code;
  }
}
```

Replace the error branch inside `mcpApi` with:
```ts
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new McpApiError(data.message || data.error || `Request failed (${response.status})`, response.status, data.error ?? null);
  }
```

Append at the end of the file:
```ts
// Stage 2: OAuth sign-in from Claude Code. No token in the command; Claude
// Code opens the browser for consent when you run /mcp.
export function claudeCodeOauthCommand(): string {
  return `claude mcp add --transport http datawise ${MCP_SERVER_URL}`;
}

export const MCP_GRANTS_KEY = ['mcp', 'grants'] as const;

export function useMcpGrants() {
  return useQuery({ queryKey: MCP_GRANTS_KEY, queryFn: () => mcpApi<{ grants: McpGrant[] }>('/account/grants').then((r) => r.grants) });
}

export async function revokeMcpGrant(id: string): Promise<void> {
  await mcpApi(`/account/grants/${id}`, { method: 'DELETE' });
}

export function getAuthorizeRequest(req: string): Promise<AuthorizeRequestInfo> {
  return mcpApi<AuthorizeRequestInfo>(`/account/authorize-request?req=${encodeURIComponent(req)}`);
}

export function approveAuthorizeRequest(req: string): Promise<{ redirect_to: string }> {
  return mcpApi<{ redirect_to: string }>('/account/authorize-request/approve', { method: 'POST', body: { req } });
}

export function denyAuthorizeRequest(req: string): Promise<{ redirect_to: string }> {
  return mcpApi<{ redirect_to: string }>('/account/authorize-request/deny', { method: 'POST', body: { req } });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/__tests__/mcp.test.ts`
Expected: PASS (the existing "throws the server message" case still passes because `McpApiError` extends `Error`).

- [ ] **Step 5: Commit**

```sh
git add src/lib/mcp.ts src/lib/__tests__/mcp.test.ts
git commit -m "feat(spa): MCP consent and connected-apps calls, typed API errors"
```

---

### Task 7: `/connect` consent page

**Files:**
- Create: `src/pages/ConnectPage.tsx`
- Modify: `src/App.tsx` (lazy import next to the others, route inside `<Routes>` before the `*` route)

**Interfaces:**
- Consumes: `useAuth()` (`user`, `loading`, `signOut`), `getAuthorizeRequest`, `approveAuthorizeRequest`, `denyAuthorizeRequest`, `McpApiError`, `setReturnTo`.

- [ ] **Step 1: Add the route**

In `src/App.tsx` add `const ConnectPage = lazy(() => import('./pages/ConnectPage'));` after the `Roadmap` lazy import, and add this route directly after the `/reset-password` route (public routes block; the page handles its own auth so it can send the user to login and back):
```tsx
            <Route path="/connect" element={<Suspense fallback={<RouteLoadingFallback />}><ConnectPage /></Suspense>} />
```
`Suspense` and `RouteLoadingFallback` are already imported in `App.tsx`.

- [ ] **Step 2: Create the page**

`src/pages/ConnectPage.tsx`:
```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck, Laptop, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { setReturnTo } from '@/lib/return-to';
import { getAuthorizeRequest, approveAuthorizeRequest, denyAuthorizeRequest, McpApiError, type AuthorizeRequestInfo } from '@/lib/mcp';

const DATA_SCOPE = 'keyword research, competitor analysis, backlinks, rank tracking, AI visibility and Search Console data';

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">DW</div>
          <span className="font-semibold">DataWise</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ConnectPage() {
  const { user, loading, signOut } = useAuth();
  const [params] = useSearchParams();
  const req = params.get('req') ?? '';

  const [info, setInfo] = useState<AuthorizeRequestInfo | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);

  useEffect(() => {
    if (!user || !req) return;
    let cancelled = false;
    getAuthorizeRequest(req)
      .then((data) => { if (!cancelled) setInfo(data); })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof McpApiError ? { code: err.code, message: err.message } : { code: null, message: (err as Error).message });
      });
    return () => { cancelled = true; };
  }, [user, req]);

  if (loading) {
    return <Shell><div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div></Shell>;
  }

  if (!req) {
    return <Shell><p className="text-sm">This page is opened by your AI assistant when it connects to DataWise. There is nothing to do here on its own.</p></Shell>;
  }

  if (!user) {
    setReturnTo(`/connect?req=${encodeURIComponent(req)}`);
    return <Navigate to="/auth" replace />;
  }

  const finish = async (action: 'approve' | 'deny') => {
    setBusy(action);
    try {
      const { redirect_to } = action === 'approve' ? await approveAuthorizeRequest(req) : await denyAuthorizeRequest(req);
      window.location.assign(redirect_to);
    } catch (err) {
      setBusy(null);
      setError(err instanceof McpApiError ? { code: err.code, message: err.message } : { code: null, message: (err as Error).message });
    }
  };

  const switchAccount = async () => {
    setReturnTo(`/connect?req=${encodeURIComponent(req)}`);
    await signOut();
    window.location.assign('/auth');
  };

  if (error) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Connection could not be completed</h1>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        {error.code === 'expired' && <p className="text-sm">Go back to your AI assistant and add the DataWise connector again. Each request is valid for ten minutes.</p>}
      </Shell>
    );
  }

  if (!info) {
    return <Shell><div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div></Shell>;
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold">Connect {info.client_name} to DataWise</h1>
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{info.client_name}</span> is asking to read your DataWise {DATA_SCOPE}. Requests count against your daily data budget. It cannot change anything in your account.
      </p>

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm space-y-1">
        <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-green-700" /> Read-only access, revocable any time in Settings.</div>
        <div className="flex items-center gap-2">
          {info.loopback ? <Laptop className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4 text-green-700" />}
          <span>You will return to <code className="text-xs">{info.redirect_host}</code>{info.loopback ? ' (an app running on this computer, such as Claude Code)' : ''}.</span>
        </div>
        {info.loopback && (
          <div className="flex items-start gap-2 text-amber-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Only continue if you started this connection yourself from a tool on this computer.</div>
        )}
      </div>

      <p className="text-sm">Signed in as <span className="font-medium">{info.email}</span>. <button type="button" className="underline text-muted-foreground" onClick={switchAccount}>Not you?</button></p>

      {!info.access && info.denial_message && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{info.denial_message}</div>
      )}

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" disabled={busy !== null} onClick={() => finish('deny')}>
          {busy === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel'}
        </Button>
        {info.access && (
          <Button type="button" disabled={busy !== null} onClick={() => finish('approve')}>
            {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Allow'}
          </Button>
        )}
      </div>
    </Shell>
  );
}
```
Check that `signOut` exists on the auth context value (`grep -n "signOut" src/contexts/AuthContext.tsx`); it does in stage 1's tree. If the context exposes it under another name, use that name.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit -p . && npm run build`
Expected: clean. The build must list a `ConnectPage` chunk in the Vite output.

- [ ] **Step 4: Commit**

```sh
git add src/pages/ConnectPage.tsx src/App.tsx
git commit -m "feat(spa): /connect consent page for MCP OAuth sign-in"
```

---

### Task 8: Settings card: connected apps and per-client setup tabs

**Files:**
- Modify: `src/components/settings/McpAccessCard.tsx`
- Modify: `scripts/deploy-pages-production.mjs` (marker list near line 40)

**Interfaces:**
- Consumes: `useMcpGrants`, `revokeMcpGrant`, `MCP_GRANTS_KEY`, `claudeCodeOauthCommand`, `MCP_SERVER_URL` from `@/lib/mcp`.

- [ ] **Step 1: Update the card**

In `src/components/settings/McpAccessCard.tsx`:

1. Extend the import from `@/lib/mcp` with `useMcpGrants, revokeMcpGrant, MCP_GRANTS_KEY, claudeCodeOauthCommand`. Add `Link2` to the lucide import.
2. Inside the component, after `const { data: usage } = useMcpUsage();` add:
```tsx
  const { data: grants = [], isLoading: grantsLoading } = useMcpGrants();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const handleDisconnect = async (id: string, clientName: string) => {
    setDisconnectingId(id);
    try {
      await revokeMcpGrant(id);
      queryClient.invalidateQueries({ queryKey: MCP_GRANTS_KEY });
      toast({ title: `${clientName} disconnected` });
    } catch (err) {
      toast({ title: 'Could not disconnect', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDisconnectingId(null);
    }
  };
```
3. Replace the intro paragraph text with:
```
Use your DataWise data (keyword research, competitors, backlinks, rank tracking, AI visibility, Search Console) from ChatGPT, claude.ai, Claude Desktop, Claude Code and other MCP clients. Add the DataWise connector in the app, sign in with this account, click Allow. Personal tokens are for tools that cannot sign in.
```
4. Insert a "Connected apps" block between the usage line and the "Personal tokens" block:
```tsx
      <div className="space-y-2">
        <Label className="flex items-center gap-1"><Link2 className="h-4 w-4" /> Connected apps</Label>
        {grantsLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No apps connected yet. Follow the steps below for your assistant.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{g.client_name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">connected {new Date(g.created_at).toLocaleDateString()}, read-only</span>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={disconnectingId === g.id} onClick={() => handleDisconnect(g.id, g.client_name)} aria-label={`Disconnect ${g.client_name}`}>
                  {disconnectingId === g.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Disconnect'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
```
5. Replace the whole `<Tabs>` block with four tabs. Copy verbatim:
```tsx
      <Tabs defaultValue="claude">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="claude">claude.ai and Claude Desktop</TabsTrigger>
          <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="other">Other MCP clients</TabsTrigger>
        </TabsList>
        <TabsContent value="claude" className="space-y-2 text-sm">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open Settings, then Connectors, and choose Add custom connector.</li>
            <li>Name: <code>DataWise</code>. Remote MCP server URL: <code>{MCP_SERVER_URL}</code>. Click Continue.</li>
            <li>A DataWise tab opens. Sign in if asked, then click Allow.</li>
          </ol>
          <p className="text-muted-foreground">In a chat, enable DataWise under the tools menu and ask for something like "use DataWise to find keyword ideas for local seo services".</p>
        </TabsContent>
        <TabsContent value="chatgpt" className="space-y-2 text-sm">
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open Settings, then Connectors, then Advanced, and turn on Developer mode.</li>
            <li>Back in Connectors choose Create. Name: <code>DataWise</code>. MCP server URL: <code>{MCP_SERVER_URL}</code>. Authentication: OAuth. Click Create.</li>
            <li>A DataWise tab opens. Sign in if asked, then click Allow.</li>
          </ol>
          <p className="text-muted-foreground">In a chat, open the plus menu, choose Developer mode, and tick DataWise. Requires a paid ChatGPT plan.</p>
        </TabsContent>
        <TabsContent value="claude-code" className="space-y-2 text-sm">
          <p>Run this once in your terminal, then type <code>/mcp</code> in Claude Code and choose Authenticate. Your browser opens DataWise: sign in if asked and click Allow.</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{claudeCodeOauthCommand()}</pre>
          <p className="text-muted-foreground">Prefer a token (for servers or scripts)? Create one above and run:</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{claudeCodeCommand('<your-token>')}</pre>
        </TabsContent>
        <TabsContent value="other" className="space-y-2 text-sm">
          <p>Server URL: <code>{MCP_SERVER_URL}</code> (Streamable HTTP). Clients that support OAuth sign in with your DataWise account automatically.</p>
          <p>Clients that only accept a static header: create a personal token above and send <code>Authorization: Bearer &lt;your-token&gt;</code>.</p>
        </TabsContent>
      </Tabs>
```
6. Keep the personal tokens block and the reveal dialog as they are.

- [ ] **Step 2: Add the deploy guard marker**

In `scripts/deploy-pages-production.mjs`, in the marker list that contains `['MCP settings card', 'MCP & AI assistants']`, add directly after it:
```js
  ['MCP connected apps', 'Connected apps'],
```

- [ ] **Step 3: Typecheck, test, and run the guard**

Run: `npx tsc --noEmit -p . && npm test && VITE_MCP_URL=https://mcp.datawiseseo.com npm run deploy:pages:check`
Expected: clean; the guard reports every marker found, including "MCP connected apps".

- [ ] **Step 4: Commit**

```sh
git add src/components/settings/McpAccessCard.tsx scripts/deploy-pages-production.mjs
git commit -m "feat(spa): connected apps list and claude.ai, ChatGPT, Claude Code setup tabs in the MCP settings card"
```

---

### Task 9: Docs

**Files:**
- Modify: `DEPLOY.md` ("MCP worker (`datawise-mcp`) deploys" section)
- Modify: root `claude.md` (backend bullet and env lines)

- [ ] **Step 1: DEPLOY.md**

Inside the existing MCP worker section add a subsection:

```markdown
#### OAuth (stage 2)

The worker is also the OAuth 2.1 authorization server for `mcp.datawiseseo.com` (library `@cloudflare/workers-oauth-provider`).

- KV namespace `OAUTH_KV` (dedicated; id in `wrangler.mcp.toml`). Holds hashed grant tokens, grants and registered clients. Never point it at the main KV.
- Compatibility flag `global_fetch_strictly_public` is required for Client ID Metadata Documents (claude.ai). Do not remove it.
- No new secrets. `MCP_PUBLIC_URL` must equal the host requests arrive on (audience check); production is `https://mcp.datawiseseo.com`.
- Endpoints: `/authorize` (ours, redirects to the SPA `/connect`), `/oauth/token`, `/oauth/register`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` (library).
- Consent stash: main KV `mcp_authreq:<nonce>`, 10 minutes.
- Local: `workers/.dev.vars` (never committed) with `MCP_PUBLIC_URL=http://localhost:8788` and `FRONTEND_URL=http://localhost:8080`, then `npm run dev:mcp` and the SPA on :8080.
- Kill switch `mcp-paused` also blocks consent (Approve returns 403).
- Rollback: `npm run deploy:mcp` from the previous commit. Existing grants keep working across deploys because state is in KV.
```

- [ ] **Step 2: claude.md**

Update the backend bullet that mentions the MCP server to end with: `Stage 2 adds OAuth (spec 4.2): the worker is its own authorization server, consent page at SPA `/connect`, grants in `OAUTH_KV`.`

- [ ] **Step 3: Commit**

```sh
git add DEPLOY.md claude.md
git commit -m "docs: MCP worker OAuth (stage 2) deploy notes"
```

---

### Task 10: Local end-to-end verification (controller runs this, not a subagent)

**Files:** none committed. `workers/.dev.vars` is created locally and is git-ignored.

- [ ] **Step 1: Local vars**

Create `workers/.dev.vars`:
```
MCP_PUBLIC_URL=http://localhost:8788
FRONTEND_URL=http://localhost:8080
DATAFORSEO_EMAIL=
DATAFORSEO_PASSWORD=
ENCRYPTION_KEY=local-test-key
```
Confirm `git status --porcelain` does not list it.

- [ ] **Step 2: Start the servers**

From `workers/`: `npm run dev:mcp -- --inspector-port 9230` (background). From `datawise-seo-insight-main/`: `VITE_MCP_URL=http://localhost:8788 npm run dev` (background). The local D1 in this worktree needs the schema and a seeded member user with a session; reuse the stage 1 approach (apply `src/db/schema.sql` with `npx wrangler d1 execute datawise-db --local -c wrangler.mcp.toml --file=src/db/schema.sql`, insert a user, put `session:<sha256>` in local KV with `npx wrangler kv key put --local -c wrangler.mcp.toml --binding KV ...`).

- [ ] **Step 3: Discovery**

```sh
curl -s http://localhost:8788/.well-known/oauth-protected-resource | jq .
curl -s http://localhost:8788/.well-known/oauth-authorization-server | jq .
curl -si -X POST http://localhost:8788/mcp | head -5
```
Expected: resource `http://localhost:8788/mcp`; `client_id_metadata_document_supported: true`; 401 with `resource_metadata`.

- [ ] **Step 4: Full flow with MCP Inspector**

```sh
npx @modelcontextprotocol/inspector@latest
```
Add `http://localhost:8788/mcp` (Streamable HTTP), click Open Auth Settings, Quick OAuth Flow. The browser lands on `http://localhost:8080/connect?req=...`; log in as the seeded user; click Allow. Inspector shows tokens; List Tools returns 12 tools; call `datawise_list_rank_tracking_projects` (stored data, no DFS cost). Check `mcp_calls` in the local D1: `auth_kind = 'oauth'`, `client_name = 'MCP Inspector'`.

- [ ] **Step 5: Settings card**

Open `http://localhost:8080/settings`. "Connected apps" lists "MCP Inspector". Click Disconnect. Inspector's next call gets 401. Screenshot the card and the consent page into the scratchpad for the PR.

---

### Task 11: Finish the branch

- [ ] Run the full worker suite and SPA suite once more from a clean tree (`git status --porcelain` empty apart from nothing).
- [ ] Use `superpowers:finishing-a-development-branch`. PR base `feat/mcp-server`, title `feat(mcp): stage 2 OAuth sign-in for claude.ai, ChatGPT and Claude Code`. PR body lists: what changed, screenshots, and the rollout steps below.

**Rollout (after PR #141 and this PR merge; each step needs Nico's go-ahead):**

1. KV namespace `datawise-mcp-OAUTH_KV` already created (its id is in `wrangler.mcp.toml`).
2. Prod D1 migration from stage 1 (if not yet applied).
3. Frontend first: merging into production auto-deploys Pages (GitHub Actions). Confirm the live bundle before touching the worker: open https://datawiseseo.com/connect (expect the "This page is opened by your AI assistant" text) and check Settings shows "Connected apps". The consent page must exist before the worker starts redirecting to it.
4. Then cd datawise-seo-insight-main/workers && npm run deploy:mcp from clean production.
5. Secrets on `datawise-mcp` in the dashboard (stage 1 list; nothing new).
6. `mcp-allowlist` KV key with Nico's email.
7. Verify: the two discovery URLs on `https://mcp.datawiseseo.com`, then add the connector in claude.ai (Settings, Connectors, Add custom connector, `https://mcp.datawiseseo.com/mcp`), sign in, Allow, list rank tracking projects. Repeat in ChatGPT Developer mode and with `claude mcp add --transport http datawise https://mcp.datawiseseo.com/mcp` then `/mcp`.
8. Tag `prod-$(date -u +%Y-%m-%d-%H%M)`; update memory `project_mcp_server.md`.
