# DataWise MCP Server, Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `datawise-mcp` Worker with personal API tokens, twelve read-only tools, a dollar-denominated DataForSEO budget gate, a call log, and a Settings card, testable from Claude Code with a pasted token.

**Architecture:** A second Cloudflare Worker built from `datawise-seo-insight-main/workers/src/mcp/` and deployed with `workers/wrangler.mcp.toml`. It binds the same D1 database and the same KV namespace as `datawise-api`, imports the existing route handlers and DataForSEO client, and exposes them as MCP tools through Cloudflare's stateless `createMcpHandler`. Every tool call passes a gate: kill switch, membership, per-minute rate, dollar budget, then records the actual DataForSEO cost reported by the API.

**Tech Stack:** TypeScript, Cloudflare Workers (wrangler 4), `agents` 0.22 (`agents/mcp/server`), `@modelcontextprotocol/server` 2.0.0, zod 4, D1, KV, vitest with the `better-sqlite3` D1 shim, React 18 + shadcn/ui for the Settings card.

**Spec:** `docs/superpowers/specs/2026-09-07-datawise-mcp-server-design.md` (read sections 3 to 8 before starting; section 12 holds Nico's decisions).

## Global Constraints

- Branch off `origin/production`; PR into `production`. Never `git add .` or `git add -A`. Never amend or force-push.
- No em dashes anywhere (code comments, UI copy, docs). Use colons, commas, or separate sentences.
- Worker source stays under `datawise-seo-insight-main/workers/src/` so `pr-checks.yml` typechecks and tests it. All commands below run from `datawise-seo-insight-main/workers/` unless stated otherwise.
- The MCP worker is named `datawise-mcp`, deployed only with `npm run deploy:mcp` (defined in Task 13). Never touch `npm run deploy:production`.
- Public URL: `https://mcp.datawiseseo.com`. MCP endpoint: `https://mcp.datawiseseo.com/mcp`.
- Token prefix `dwmcp_`. Max 5 active tokens per user.
- Access: `is_admin`, or `is_community_member`, or `subscription_tier IN ('pro','community')`. Free accounts get no tool access.
- Budget: default per-user cap 400 cents per UTC day, no rollover; default global cap 10,000 cents per day; 30 calls per user per minute. KV overrides `mcp-user-cap-cents`, `mcp-global-cap-cents`. Kill switch KV `mcp-paused`. Early-access allowlist KV `mcp-allowlist`.
- The MCP never reads or writes `users.credits_used`.
- Every tool: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`. Tool names prefixed `datawise_`.
- Tool output never contains user ids, raw DFS `cost`, request ids, or HTML.
- Schema changes go into `workers/src/db/schema.sql` as `CREATE TABLE IF NOT EXISTS` and are applied to production by hand (Task 16) before the worker is deployed.

## File map

Worker (`datawise-seo-insight-main/workers/`):

| File | Responsibility |
|---|---|
| `package.json` | add `agents`, `@modelcontextprotocol/server`, `@modelcontextprotocol/sdk`; bump `zod`, `wrangler`; add `dev:mcp`, `deploy:mcp` scripts |
| `wrangler.mcp.toml` | config for the `datawise-mcp` worker |
| `src/db/schema.sql` | `api_tokens`, `mcp_usage_daily`, `mcp_calls` |
| `src/dataforseo/client.ts` | optional `dfsMeter` on `DataForSeoEnv` that records live cost and cache hits |
| `src/mcp/env.ts` | `McpEnv`, `McpIdentity`, `asWorkerEnv` |
| `src/mcp/test-support.ts` | `makeMcpTestEnv`, `seedUser` for vitest |
| `src/mcp/tokens.ts` | create, validate, list, revoke personal API tokens |
| `src/mcp/access.ts` | identity loading, membership gate, kill switch, allowlist |
| `src/mcp/budget.ts` | cost estimates, caps, rate limit, ledger writes |
| `src/mcp/shape.ts` | `compact`, `stripHtml`, `toolResult`, `toolError` |
| `src/mcp/call-handler.ts` | run an existing route handler with a synthetic Request and parse its JSON |
| `src/mcp/tools/types.ts` | `ToolDef`, `ToolContext`, shared zod inputs, `resolveLocale` |
| `src/mcp/tools/keywords.ts` | `datawise_keyword_research`, `datawise_keyword_metrics` |
| `src/mcp/tools/domains.ts` | `datawise_domain_overview`, `datawise_ranked_keywords`, `datawise_competitors`, `datawise_keyword_gap` |
| `src/mcp/tools/backlinks.ts` | `datawise_backlinks` |
| `src/mcp/tools/ai-mentions.ts` | `datawise_ai_mentions` |
| `src/mcp/tools/stored.ts` | `datawise_rank_tracking`, `datawise_ai_visibility`, `datawise_local_reviews`, `datawise_search_console` |
| `src/mcp/tools/registry.ts` | `ALL_TOOLS` |
| `src/mcp/gate.ts` | `runGated`: the per-call gate sequence |
| `src/mcp/server.ts` | builds the `McpServer` and the request handler |
| `src/mcp/account.ts` | `/account/tokens`, `/account/usage` for the SPA |
| `src/mcp/index.ts` | worker entry: routing, 401 challenge, scheduled purge |

SPA (`datawise-seo-insight-main/`):

| File | Responsibility |
|---|---|
| `src/lib/mcp.ts` | `mcpApi` helper, token and usage calls, React Query hooks |
| `src/components/settings/McpAccessCard.tsx` | Settings card |
| `src/pages/SettingsPage.tsx` | mount the card |
| `.env`, `.github/workflows/*.yml`, `scripts/deploy-pages-production.mjs` | `VITE_MCP_URL` plus guard markers |

Docs: `DEPLOY.md`, root `CLAUDE.md`.

---

### Task 1: Toolchain, dependencies, and a compiling worker

**Files:**
- Modify: `datawise-seo-insight-main/workers/package.json`
- Modify (only if tsc complains): `datawise-seo-insight-main/workers/src/blueprint/domain/brief.ts:49`

**Interfaces:**
- Produces: installed packages `agents@^0.22.0`, `@modelcontextprotocol/server@2.0.0`, `@modelcontextprotocol/sdk@1.30.0`, `zod@^4.4.0`, `wrangler@^4.129.0`.

Why: `@modelcontextprotocol/server` 2.0 requires `zod ^4.2` as a peer and `agents` 0.22 requires `zod ^4`. The worker pins `zod ^3.25`, used in exactly one file (`src/blueprint/domain/brief.ts`). `agents` also expects wrangler 4 and a 2026 `compatibility_date`, which wrangler 3.99 cannot run locally.

- [ ] **Step 1: Record the baseline**

Run: `npx tsc --noEmit && npx vitest run`
Expected: both pass. If they do not, stop and report; this plan assumes a green baseline.

- [ ] **Step 2: Update dependencies**

Edit `package.json`:

```json
"scripts": {
  "dev": "wrangler dev",
  "dev:mcp": "wrangler dev -c wrangler.mcp.toml --port 8788",
  "deploy": "wrangler deploy",
  "deploy:mcp": "wrangler deploy -c wrangler.mcp.toml",
  "deploy:staging": "wrangler deploy --env staging",
  "deploy:production": "wrangler deploy --env production",
  "db:migrate": "wrangler d1 execute datawise-db --file=src/db/schema.sql",
  "db:migrate:staging": "wrangler d1 execute datawise-db-staging --file=src/db/schema.sql",
  "db:migrate:production": "wrangler d1 execute datawise-db-prod --file=src/db/schema.sql",
  "test": "vitest run",
  "llm-models:snapshot": "node scripts/refresh-llm-models-snapshot.mjs"
},
"devDependencies": {
  "@cloudflare/workers-types": "^4.20241205.0",
  "@types/better-sqlite3": "^7.6.13",
  "better-sqlite3": "^12.11.1",
  "typescript": "^5.8.3",
  "vitest": "^3.2.6",
  "wrangler": "^4.129.0"
},
"dependencies": {
  "@modelcontextprotocol/sdk": "1.30.0",
  "@modelcontextprotocol/server": "2.0.0",
  "agents": "^0.22.0",
  "zod": "^4.4.0"
}
```

Run: `npm install`
Expected: no `ERESOLVE` errors. `agents` declares its other peers (`react`, `vite`, `ai`, ...) optional, so nothing else is pulled in.

- [ ] **Step 3: Typecheck and fix zod 4 fallout**

Run: `npx tsc --noEmit`

If the only error is in `src/blueprint/domain/brief.ts` at `code: z.ZodIssueCode.custom`, replace that expression with the string literal `'custom'` (zod 4 removed the enum). If `z.string().url()` warns as deprecated, leave it. Any other error: fix it minimally and note it in the commit message.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: PASS, same count as Step 1.

- [ ] **Step 5: Prove `datawise-api` still builds under wrangler 4**

Run: `npx wrangler deploy --dry-run --outdir /tmp/datawise-api-dryrun`
Expected: ends with `--dry-run: exiting now.` and no config errors. This guards the existing worker against the wrangler major bump.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git add src/blueprint/domain/brief.ts   # only if changed
git commit -m "chore(workers): add MCP server deps, move to zod 4 and wrangler 4"
```

---

### Task 2: Schema for tokens, usage, and call log

**Files:**
- Modify: `datawise-seo-insight-main/workers/src/db/schema.sql` (append at end)
- Test: `datawise-seo-insight-main/workers/src/mcp/schema.test.ts`

**Interfaces:**
- Produces tables `api_tokens`, `mcp_usage_daily`, `mcp_calls` with the exact columns below. Later tasks' SQL depends on these names.

- [ ] **Step 1: Write the failing test**

Create `src/mcp/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';

describe('mcp schema', () => {
  it('creates the three MCP tables', () => {
    const { raw } = createTestDb();
    const names = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('api_tokens','mcp_usage_daily','mcp_calls') ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(names).toEqual(['api_tokens', 'mcp_calls', 'mcp_usage_daily']);
  });

  it('api_tokens has the columns tokens.ts relies on', () => {
    const { raw } = createTestDb();
    const cols = raw.prepare('PRAGMA table_info(api_tokens)').all().map((r: any) => r.name);
    for (const c of ['id', 'user_id', 'name', 'token_hash', 'token_suffix', 'scopes', 'created_at', 'last_used_at', 'expires_at', 'revoked_at']) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/mcp/schema.test.ts`
Expected: FAIL, `expect(names).toEqual([...])` receives `[]`.

- [ ] **Step 3: Append the tables to schema.sql**

Append to the end of `src/db/schema.sql`:

```sql
-- ---------------------------------------------------------------------------
-- MCP server (workers/src/mcp). Personal API tokens for the datawise-mcp
-- worker, the per-day DataForSEO dollar ledger, and a per-call log.
-- Spec: docs/superpowers/specs/2026-09-07-datawise-mcp-server-design.md
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  token_suffix  TEXT NOT NULL,
  scopes        TEXT NOT NULL DEFAULT 'read',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  expires_at    TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

-- One row per user per UTC day. A new day means a new row, so there is no
-- rollover. user_id '_global' is the whole-server row.
CREATE TABLE IF NOT EXISTS mcp_usage_daily (
  user_id   TEXT NOT NULL,
  day       TEXT NOT NULL,
  cost_usd  REAL NOT NULL DEFAULT 0,
  calls     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS mcp_calls (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL,
  tool        TEXT NOT NULL,
  cost_usd    REAL NOT NULL DEFAULT 0,
  cached      INTEGER NOT NULL DEFAULT 0,
  ok          INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  auth_kind   TEXT NOT NULL,
  client_name TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_user_day ON mcp_calls(user_id, created_at);
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/mcp/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/mcp/schema.test.ts
git commit -m "feat(mcp): schema for api_tokens, mcp_usage_daily, mcp_calls"
```

---

### Task 3: DataForSEO cost meter

**Files:**
- Modify: `datawise-seo-insight-main/workers/src/dataforseo/client.ts`
- Test: `datawise-seo-insight-main/workers/src/dataforseo/client.test.ts` (append)

**Interfaces:**
- Produces:
  ```ts
  export interface DfsMeter { costUsd: number; liveCalls: number; cacheHits: number; }
  export interface DataForSeoEnv { KV: KVNamespace; DATAFORSEO_EMAIL: string; DATAFORSEO_PASSWORD: string; dfsMeter?: DfsMeter; }
  ```
  When `env.dfsMeter` is present, every live response adds its top-level `cost` (a number in USD) to `costUsd` and increments `liveCalls`; every KV cache hit increments `cacheHits`. Existing callers pass no meter and see no change.

- [ ] **Step 1: Write the failing test**

Append to `src/dataforseo/client.test.ts`:

```ts
import { vi } from 'vitest';
import { dataforseoRequestCached, type DfsMeter } from './client';

function fakeKv(store = new Map<string, string>()) {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
}

describe('dfsMeter', () => {
  it('adds live cost and counts cache hits', async () => {
    const meter: DfsMeter = { costUsd: 0, liveCalls: 0, cacheHits: 0 };
    const env = { KV: fakeKv(), DATAFORSEO_EMAIL: 'e', DATAFORSEO_PASSWORD: 'p', dfsMeter: meter };
    const live = { ...okResponse, cost: 0.0123 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(live), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await dataforseoRequestCached(env, '/x/live', [{ a: 1 }], { ttlSeconds: 60 });
    await dataforseoRequestCached(env, '/x/live', [{ a: 1 }], { ttlSeconds: 60 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meter.liveCalls).toBe(1);
    expect(meter.cacheHits).toBe(1);
    expect(meter.costUsd).toBeCloseTo(0.0123, 6);
    vi.unstubAllGlobals();
  });

  it('is a no-op without a meter', async () => {
    const env = { KV: fakeKv(), DATAFORSEO_EMAIL: 'e', DATAFORSEO_PASSWORD: 'p' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...okResponse, cost: 1 }), { status: 200 })));
    const data = await dataforseoRequestCached(env, '/y/live', [{}], { ttlSeconds: 0 });
    expect(data.cost).toBe(1);
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/dataforseo/client.test.ts`
Expected: FAIL on `meter.liveCalls` (0 instead of 1) or a type error on `DfsMeter`.

- [ ] **Step 3: Implement the meter**

In `src/dataforseo/client.ts`:

Replace the `DataForSeoEnv` interface with:

```ts
// Optional per-request meter. The MCP worker attaches one to the env it hands
// to route handlers so it can bill the member for the exact DataForSEO cost
// the API reported (0 on a KV cache hit). Nothing else sets it.
export interface DfsMeter {
  costUsd: number;
  liveCalls: number;
  cacheHits: number;
}

export interface DataForSeoEnv {
  KV: KVNamespace;
  DATAFORSEO_EMAIL: string;
  DATAFORSEO_PASSWORD: string;
  dfsMeter?: DfsMeter;
}

function meterLive(env: DataForSeoEnv, data: any): void {
  if (!env.dfsMeter) return;
  const cost = typeof data?.cost === 'number' ? data.cost : 0;
  env.dfsMeter.costUsd += cost;
  env.dfsMeter.liveCalls += 1;
}

function meterHit(env: DataForSeoEnv): void {
  if (env.dfsMeter) env.dfsMeter.cacheHits += 1;
}
```

In `fetchDataForSeo`, right before `return data;` (the success path), add `meterLive(env, data);`.

In `dataforseoRequestCached` and `dataforseoGetCached`, change the cache-hit line from `if (cached) return JSON.parse(cached);` to:

```ts
  if (cached) {
    meterHit(env);
    return JSON.parse(cached);
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/dataforseo/client.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/dataforseo/client.ts src/dataforseo/client.test.ts
git commit -m "feat(dataforseo): optional per-request cost meter on the client env"
```

---

### Task 4: MCP env types and vitest support

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/env.ts`
- Create: `datawise-seo-insight-main/workers/src/mcp/test-support.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface McpEnv { DB: D1Database; KV: KVNamespace; DATAFORSEO_EMAIL: string; DATAFORSEO_PASSWORD: string; ENCRYPTION_KEY: string; FRONTEND_URL: string; MARKETING_URL?: string; ADMIN_EMAILS?: string; MCP_PUBLIC_URL: string; dfsMeter?: DfsMeter; }
  export interface McpIdentity { userId: string; email: string; tier: string; isAdmin: boolean; isCommunityMember: boolean; defaultLocationCode: number; defaultLanguageCode: string; tokenId: string; tokenName: string; authKind: 'api_token' | 'oauth'; }
  export function asWorkerEnv(env: McpEnv): Env
  // test-support
  export function makeMcpTestEnv(): { env: McpEnv; kvStore: Map<string, string>; raw: Database }
  export function seedUser(env: McpEnv, overrides?: Partial<SeedUser>): Promise<string>  // returns user id
  ```

No test of its own; Task 5's tests exercise both files.

- [ ] **Step 1: Create `src/mcp/env.ts`**

```ts
import type { Env } from '../index';
import type { DfsMeter } from '../dataforseo/client';

// Bindings the datawise-mcp worker declares in wrangler.mcp.toml. It is a
// strict subset of the API worker's Env: the route handlers we import only
// touch DB, KV and the DataForSEO secrets, so the cast in asWorkerEnv is safe
// for every handler listed in src/mcp/tools/*.
export interface McpEnv {
  DB: D1Database;
  KV: KVNamespace;
  DATAFORSEO_EMAIL: string;
  DATAFORSEO_PASSWORD: string;
  ENCRYPTION_KEY: string;
  FRONTEND_URL: string;
  MARKETING_URL?: string;
  ADMIN_EMAILS?: string;
  // https://mcp.datawiseseo.com in production, http://localhost:8788 in dev.
  MCP_PUBLIC_URL: string;
  dfsMeter?: DfsMeter;
}

export interface McpIdentity {
  userId: string;
  email: string;
  tier: string;
  isAdmin: boolean;
  isCommunityMember: boolean;
  defaultLocationCode: number;
  defaultLanguageCode: string;
  tokenId: string;
  tokenName: string;
  authKind: 'api_token' | 'oauth';
}

// The ONLY place the MCP worker widens its env to the API worker's Env type.
export function asWorkerEnv(env: McpEnv): Env {
  return env as unknown as Env;
}
```

- [ ] **Step 2: Create `src/mcp/test-support.ts`**

```ts
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-support/d1';
import type { McpEnv } from './env';

// In-memory KV that honours get/put/delete and ignores TTLs. Tests that care
// about expiry set entries directly on kvStore.
export function fakeKv(store: Map<string, string>): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  } as unknown as KVNamespace;
}

export function makeMcpTestEnv(): { env: McpEnv; kvStore: Map<string, string>; raw: Database.Database } {
  const { d1, raw } = createTestDb();
  const kvStore = new Map<string, string>();
  const env: McpEnv = {
    DB: d1,
    KV: fakeKv(kvStore),
    DATAFORSEO_EMAIL: 'dfs@test',
    DATAFORSEO_PASSWORD: 'secret',
    ENCRYPTION_KEY: 'test-key',
    FRONTEND_URL: 'https://app.test',
    ADMIN_EMAILS: 'nico@airankingskool.com',
    MCP_PUBLIC_URL: 'http://localhost:8788',
  };
  return { env, kvStore, raw };
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/env.ts src/mcp/test-support.ts
git commit -m "feat(mcp): env types and vitest support"
```

---

### Task 5: Personal API tokens

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/tokens.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/tokens.test.ts`

**Interfaces:**
- Consumes: `McpEnv`, `makeMcpTestEnv`, `seedUser` (Task 4); tables from Task 2.
- Produces:
  ```ts
  export const TOKEN_PREFIX = 'dwmcp_';
  export const MAX_ACTIVE_TOKENS = 5;
  export class TokenLimitError extends Error {}
  export interface ApiTokenRow { id: string; name: string; token_suffix: string; created_at: string; last_used_at: string | null; }
  export interface TokenIdentity { userId: string; tokenId: string; tokenName: string; }
  export function generateToken(): string
  export async function hashToken(token: string): Promise<string>
  export async function createApiToken(env: McpEnv, userId: string, name: string): Promise<ApiTokenRow & { token: string }>
  export async function validateApiToken(env: McpEnv, bearer: string): Promise<TokenIdentity | null>
  export async function listApiTokens(env: McpEnv, userId: string): Promise<ApiTokenRow[]>
  export async function revokeApiToken(env: McpEnv, userId: string, tokenId: string): Promise<boolean>
  ```
  KV key `mcptoken:<sha256 hex>` caches `TokenIdentity` JSON for 3600 s.

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import {
  TOKEN_PREFIX, MAX_ACTIVE_TOKENS, TokenLimitError,
  generateToken, hashToken, createApiToken, validateApiToken, listApiTokens, revokeApiToken,
} from './tokens';

describe('tokens', () => {
  it('generates prefixed, 46-char, base62 tokens', () => {
    const t = generateToken();
    expect(t.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(t).toHaveLength(TOKEN_PREFIX.length + 40);
    expect(/^[A-Za-z0-9]+$/.test(t.slice(TOKEN_PREFIX.length))).toBe(true);
    expect(generateToken()).not.toBe(t);
  });

  it('stores only the hash and returns the secret once', async () => {
    const { env, raw } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const created = await createApiToken(env, userId, 'Claude Code');
    expect(created.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(created.token_suffix).toBe(created.token.slice(-4));
    const row = raw.prepare('SELECT token_hash FROM api_tokens WHERE id = ?').get(created.id) as any;
    expect(row.token_hash).toBe(await hashToken(created.token));
    expect(row.token_hash).not.toContain(created.token);
  });

  it('validates a live token, caches it in KV, and rejects garbage', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const created = await createApiToken(env, userId, 'laptop');
    const id = await validateApiToken(env, created.token);
    expect(id).toEqual({ userId, tokenId: created.id, tokenName: 'laptop' });
    expect(kvStore.has('mcptoken:' + (await hashToken(created.token)))).toBe(true);
    expect(await validateApiToken(env, 'dwmcp_nope')).toBeNull();
    expect(await validateApiToken(env, '')).toBeNull();
  });

  it('revocation removes the KV entry and invalidates the token', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const created = await createApiToken(env, userId, 'x');
    await validateApiToken(env, created.token);
    expect(await revokeApiToken(env, userId, created.id)).toBe(true);
    expect(kvStore.size).toBe(0);
    expect(await validateApiToken(env, created.token)).toBeNull();
    expect(await revokeApiToken(env, 'someone-else', created.id)).toBe(false);
  });

  it('caps active tokens per user and lists only active ones', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env);
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i++) await createApiToken(env, userId, `t${i}`);
    await expect(createApiToken(env, userId, 'one too many')).rejects.toBeInstanceOf(TokenLimitError);
    const list = await listApiTokens(env, userId);
    expect(list).toHaveLength(MAX_ACTIVE_TOKENS);
    await revokeApiToken(env, userId, list[0].id);
    expect(await listApiTokens(env, userId)).toHaveLength(MAX_ACTIVE_TOKENS - 1);
    await expect(createApiToken(env, userId, 'fits now')).resolves.toBeTruthy();
  });

  it('rejects expired tokens', async () => {
    const { env, raw } = makeMcpTestEnv();
    const userId = await seedUser(env);
    const created = await createApiToken(env, userId, 'old');
    raw.prepare("UPDATE api_tokens SET expires_at = datetime('now', '-1 day') WHERE id = ?").run(created.id);
    expect(await validateApiToken(env, created.token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/tokens.test.ts`
Expected: FAIL, cannot resolve `./tokens`.

- [ ] **Step 3: Implement `src/mcp/tokens.ts`**

```ts
import type { McpEnv } from './env';

export const TOKEN_PREFIX = 'dwmcp_';
export const MAX_ACTIVE_TOKENS = 5;
const KV_TTL_SECONDS = 3600;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export class TokenLimitError extends Error {
  constructor() {
    super(`You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
    this.name = 'TokenLimitError';
  }
}

export interface ApiTokenRow {
  id: string;
  name: string;
  token_suffix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface TokenIdentity {
  userId: string;
  tokenId: string;
  tokenName: string;
}

export function generateToken(): string {
  const bytes = new Uint8Array(40);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return TOKEN_PREFIX + out;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const kvKey = (hash: string) => `mcptoken:${hash}`;

export async function createApiToken(env: McpEnv, userId: string, name: string): Promise<ApiTokenRow & { token: string }> {
  const active = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL'
  ).bind(userId).first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_TOKENS) throw new TokenLimitError();

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const id = crypto.randomUUID().replace(/-/g, '');
  const suffix = token.slice(-4);
  const cleanName = name.trim().slice(0, 60) || 'Untitled token';

  await env.DB.prepare(
    'INSERT INTO api_tokens (id, user_id, name, token_hash, token_suffix) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, cleanName, tokenHash, suffix).run();

  const row = await env.DB.prepare(
    'SELECT id, name, token_suffix, created_at, last_used_at FROM api_tokens WHERE id = ?'
  ).bind(id).first<ApiTokenRow>();

  return { ...(row as ApiTokenRow), token };
}

export async function validateApiToken(env: McpEnv, bearer: string): Promise<TokenIdentity | null> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX) || bearer.length !== TOKEN_PREFIX.length + 40) return null;
  const tokenHash = await hashToken(bearer);

  const cached = await env.KV.get(kvKey(tokenHash));
  if (cached) return JSON.parse(cached) as TokenIdentity;

  const row = await env.DB.prepare(
    `SELECT id, user_id, name, expires_at, revoked_at FROM api_tokens WHERE token_hash = ?`
  ).bind(tokenHash).first<{ id: string; user_id: string; name: string; expires_at: string | null; revoked_at: string | null }>();
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  const identity: TokenIdentity = { userId: row.user_id, tokenId: row.id, tokenName: row.name };
  await env.KV.put(kvKey(tokenHash), JSON.stringify(identity), { expirationTtl: KV_TTL_SECONDS });

  // Throttled: at most one write per token per hour.
  await env.DB.prepare(
    `UPDATE api_tokens SET last_used_at = datetime('now')
     WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-1 hour'))`
  ).bind(row.id).run();

  return identity;
}

export async function listApiTokens(env: McpEnv, userId: string): Promise<ApiTokenRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, token_suffix, created_at, last_used_at FROM api_tokens
     WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`
  ).bind(userId).all<ApiTokenRow>();
  return results;
}

export async function revokeApiToken(env: McpEnv, userId: string, tokenId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT token_hash FROM api_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
  ).bind(tokenId, userId).first<{ token_hash: string }>();
  if (!row) return false;
  await env.DB.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?").bind(tokenId).run();
  await env.KV.delete(kvKey(row.token_hash));
  return true;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/mcp/tokens.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tokens.ts src/mcp/tokens.test.ts
git commit -m "feat(mcp): personal API tokens (create, validate, list, revoke)"
```

---

### Task 6: Identity loading and the access gate

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/access.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/access.test.ts`

**Interfaces:**
- Consumes: `McpEnv`, `McpIdentity` (Task 4); `TokenIdentity` (Task 5); `isAdmin` from `../routes/admin`.
- Produces:
  ```ts
  export type AccessDenial = 'paused' | 'not_member' | 'early_access';
  export async function loadIdentity(env: McpEnv, token: TokenIdentity, authKind?: 'api_token' | 'oauth'): Promise<McpIdentity | null>
  export function hasMemberAccess(identity: McpIdentity): boolean
  export async function checkAccess(env: McpEnv, identity: McpIdentity): Promise<AccessDenial | null>
  export function denialMessage(denial: AccessDenial): string
  ```
  KV: `mcp-paused` (any value = paused), `mcp-allowlist` (comma-separated emails; when the key exists and is non-empty, only listed emails and admins pass).

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/access.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import { loadIdentity, hasMemberAccess, checkAccess, denialMessage } from './access';

const tok = (userId: string) => ({ userId, tokenId: 't1', tokenName: 'laptop' });

describe('access', () => {
  it('loads identity from the users row', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'a@test.dev', subscription_tier: 'pro', is_community_member: 0 });
    const id = await loadIdentity(env, tok(userId));
    expect(id).toMatchObject({ userId, email: 'a@test.dev', tier: 'pro', isAdmin: false, isCommunityMember: false, tokenName: 'laptop', authKind: 'api_token' });
    expect(id!.defaultLocationCode).toBe(2840);
    expect(id!.defaultLanguageCode).toBe('en');
  });

  it('returns null for banned or missing users', async () => {
    const { env } = makeMcpTestEnv();
    const banned = await seedUser(env, { banned: 1 });
    expect(await loadIdentity(env, tok(banned))).toBeNull();
    expect(await loadIdentity(env, tok('ghost'))).toBeNull();
  });

  it('member access: admin, community member, pro, community tier pass; free fails', async () => {
    const { env } = makeMcpTestEnv();
    const cases: Array<[Parameters<typeof seedUser>[1], boolean]> = [
      [{ subscription_tier: 'free', is_community_member: 0 }, false],
      [{ subscription_tier: 'pro', is_community_member: 0 }, true],
      [{ subscription_tier: 'community', is_community_member: 0 }, true],
      [{ subscription_tier: 'free', is_community_member: 1 }, true],
      [{ subscription_tier: 'free', is_community_member: 0, is_admin: 1 }, true],
      [{ subscription_tier: 'free', is_community_member: 0, email: 'nico@airankingskool.com' }, true],
    ];
    for (const [overrides, expected] of cases) {
      const id = await loadIdentity(env, tok(await seedUser(env, overrides)));
      expect(hasMemberAccess(id!)).toBe(expected);
    }
  });

  it('checkAccess order: paused, then membership, then allowlist', async () => {
    const { env, kvStore } = makeMcpTestEnv();
    const member = (await loadIdentity(env, tok(await seedUser(env, { email: 'm@test.dev' }))))!;
    const free = (await loadIdentity(env, tok(await seedUser(env, { subscription_tier: 'free', is_community_member: 0 }))))!;
    const admin = (await loadIdentity(env, tok(await seedUser(env, { is_admin: 1 }))))!;

    expect(await checkAccess(env, member)).toBeNull();
    expect(await checkAccess(env, free)).toBe('not_member');

    kvStore.set('mcp-allowlist', 'someone@else.dev, other@x.dev');
    expect(await checkAccess(env, member)).toBe('early_access');
    expect(await checkAccess(env, admin)).toBeNull();
    kvStore.set('mcp-allowlist', 'M@test.dev');
    expect(await checkAccess(env, member)).toBeNull();

    kvStore.set('mcp-paused', '1');
    expect(await checkAccess(env, admin)).toBe('paused');
  });

  it('denial messages never mention join-for-free', () => {
    for (const d of ['paused', 'not_member', 'early_access'] as const) {
      expect(denialMessage(d).toLowerCase()).not.toContain('free');
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/access.test.ts`
Expected: FAIL, cannot resolve `./access`.

- [ ] **Step 3: Implement `src/mcp/access.ts`**

```ts
import type { McpEnv, McpIdentity } from './env';
import type { TokenIdentity } from './tokens';
import { isAdmin } from '../routes/admin';
import type { AuthUser } from '../auth/google';

export type AccessDenial = 'paused' | 'not_member' | 'early_access';

interface UserRow {
  id: string;
  email: string;
  subscription_tier: string | null;
  is_community_member: number | null;
  is_admin: number | null;
  banned: number | null;
  default_location_code: number | null;
  default_language_code: string | null;
}

export async function loadIdentity(
  env: McpEnv,
  token: TokenIdentity,
  authKind: 'api_token' | 'oauth' = 'api_token',
): Promise<McpIdentity | null> {
  const row = await env.DB.prepare(
    `SELECT id, email, subscription_tier, is_community_member, is_admin, banned,
            default_location_code, default_language_code
     FROM users WHERE id = ?`
  ).bind(token.userId).first<UserRow>();
  if (!row || row.banned) return null;

  const authUser = { id: row.id, email: row.email, is_admin: row.is_admin === 1 } as unknown as AuthUser;
  return {
    userId: row.id,
    email: row.email,
    tier: row.subscription_tier ?? 'free',
    isAdmin: isAdmin(authUser, env),
    isCommunityMember: row.is_community_member === 1,
    defaultLocationCode: row.default_location_code ?? 2840,
    defaultLanguageCode: row.default_language_code ?? 'en',
    tokenId: token.tokenId,
    tokenName: token.tokenName,
    authKind,
  };
}

// Spec 6.1. The lifetime credit counter is deliberately not consulted.
export function hasMemberAccess(identity: McpIdentity): boolean {
  return identity.isAdmin || identity.isCommunityMember || identity.tier === 'pro' || identity.tier === 'community';
}

export async function checkAccess(env: McpEnv, identity: McpIdentity): Promise<AccessDenial | null> {
  if (await env.KV.get('mcp-paused')) return 'paused';
  if (!hasMemberAccess(identity)) return 'not_member';

  const allowlist = (await env.KV.get('mcp-allowlist')) ?? '';
  const emails = allowlist.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length && !identity.isAdmin && !emails.includes(identity.email.toLowerCase())) return 'early_access';

  return null;
}

export function denialMessage(denial: AccessDenial): string {
  switch (denial) {
    case 'paused':
      return 'The DataWise MCP server is temporarily paused for maintenance. Try again later.';
    case 'not_member':
      return 'MCP access is included with AI Ranking Skool membership and DataWise Pro. Upgrade at https://datawiseseo.com/settings to use these tools.';
    case 'early_access':
      return 'The DataWise MCP server is in early access. Your account is not on the early-access list yet.';
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/mcp/access.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/access.ts src/mcp/access.test.ts
git commit -m "feat(mcp): identity loading and membership/allowlist/kill-switch gate"
```

---

### Task 7: Budget, rate limit, and ledger

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/budget.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/budget.test.ts`

**Interfaces:**
- Consumes: `McpEnv`, `McpIdentity` (Task 4); tables from Task 2.
- Produces:
  ```ts
  export const DEFAULT_USER_CAP_CENTS = 400;
  export const DEFAULT_GLOBAL_CAP_CENTS = 10000;
  export const RATE_LIMIT_PER_MINUTE = 30;
  export const GLOBAL_USER_ID = '_global';
  export function utcDay(now?: Date): string                       // 'YYYY-MM-DD'
  export function estimateCostUsd(tool: string, args: Record<string, unknown>): number
  export async function readCaps(env: McpEnv): Promise<{ userCapUsd: number; globalCapUsd: number }>
  export async function readSpent(env: McpEnv, userId: string, day?: string): Promise<{ costUsd: number; calls: number }>
  export type BudgetDecision = { ok: true; spentUsd: number; capUsd: number } | { ok: false; reason: 'user_cap' | 'global_cap'; spentUsd: number; capUsd: number }
  export async function checkBudget(env: McpEnv, identity: McpIdentity, estimateUsd: number): Promise<BudgetDecision>
  export async function checkRateLimit(env: McpEnv, userId: string, now?: Date): Promise<boolean>   // true = allowed
  export interface UsageEntry { userId: string; tool: string; costUsd: number; cached: boolean; ok: boolean; durationMs: number; authKind: string; clientName: string; }
  export async function recordUsage(env: McpEnv, entry: UsageEntry): Promise<void>
  export function budgetMessage(d: Extract<BudgetDecision, { ok: false }>): string
  ```

Cost estimates (spec section 5, DataForSEO live prices as of 2026-09-07):

| tool | formula |
|---|---|
| `datawise_keyword_research` | mode `related`: `2 * (0.012 + 0.00012 * limit)`; else `0.012 + 0.00012 * limit` |
| `datawise_keyword_metrics` | `2 * (0.012 + 0.00012 * keywords.length)` |
| `datawise_domain_overview` | `0.16` |
| `datawise_ranked_keywords` | `0.012 + 0.00012 * limit` |
| `datawise_competitors` | `0.012 + 0.00012 * limit` |
| `datawise_keyword_gap` | `2 * (0.012 + 0.00012 * 300)` |
| `datawise_backlinks` | view `summary`: `0.024 + 0.000036 * 10`; else `0.024 + 0.000036 * limit` |
| `datawise_ai_mentions` | `0.10 + 0.001 * 10 * domains.length` |
| `datawise_local_reviews` | `0.0054 + 0.0015 * (limit / 10)` |
| stored-data tools | `0` |

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/budget.test.ts`:

```ts
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
    expect((await checkBudget(env, admin, 999)).ok).toBe(true);
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

  it('utcDay formats YYYY-MM-DD', () => {
    expect(utcDay(new Date('2026-09-07T23:59:59Z'))).toBe('2026-09-07');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/budget.test.ts`
Expected: FAIL, cannot resolve `./budget`.

- [ ] **Step 3: Implement `src/mcp/budget.ts`**

```ts
import type { McpEnv, McpIdentity } from './env';

export const DEFAULT_USER_CAP_CENTS = 400;
export const DEFAULT_GLOBAL_CAP_CENTS = 10000;
export const RATE_LIMIT_PER_MINUTE = 30;
export const GLOBAL_USER_ID = '_global';

// DataForSEO live prices, 2026-09-07 (spec section 5).
const LABS_TASK = 0.012;
const LABS_ITEM = 0.00012;
const TRAFFIC_TASK = 0.12;
const BACKLINKS_REQUEST = 0.024;
const BACKLINKS_ROW = 0.000036;
const LLM_REQUEST = 0.1;
const LLM_ROW = 0.001;
const GBP_INFO = 0.0054;
const REVIEWS_PER_10 = 0.0015;
const UNKNOWN_TOOL_ESTIMATE = 0.05;

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function estimateCostUsd(tool: string, args: Record<string, unknown>): number {
  const limit = num(args.limit, 25);
  switch (tool) {
    case 'datawise_keyword_research': {
      const one = LABS_TASK + LABS_ITEM * limit;
      return (args.mode ?? 'related') === 'related' ? 2 * one : one;
    }
    case 'datawise_keyword_metrics': {
      const n = Array.isArray(args.keywords) ? args.keywords.length : 1;
      return 2 * (LABS_TASK + LABS_ITEM * n);
    }
    case 'datawise_domain_overview':
      return LABS_TASK + TRAFFIC_TASK + 0.0012 + BACKLINKS_REQUEST + BACKLINKS_ROW * 10; // 0.1576, reported as 0.16 in the spec
    case 'datawise_ranked_keywords':
    case 'datawise_competitors':
      return LABS_TASK + LABS_ITEM * limit;
    case 'datawise_keyword_gap':
      return 2 * (LABS_TASK + LABS_ITEM * 300);
    case 'datawise_backlinks':
      return (args.view ?? 'summary') === 'summary'
        ? BACKLINKS_REQUEST + BACKLINKS_ROW * 10
        : BACKLINKS_REQUEST + BACKLINKS_ROW * limit;
    case 'datawise_ai_mentions': {
      const n = Array.isArray(args.domains) ? Math.max(1, args.domains.length) : 1;
      return LLM_REQUEST + LLM_ROW * 10 * n;
    }
    case 'datawise_local_reviews':
      return GBP_INFO + REVIEWS_PER_10 * (num(args.limit, 20) / 10);
    case 'datawise_rank_tracking':
    case 'datawise_ai_visibility':
    case 'datawise_search_console':
      return 0;
    default:
      return UNKNOWN_TOOL_ESTIMATE;
  }
}

async function readCents(env: McpEnv, key: string, fallback: number): Promise<number> {
  const raw = await env.KV.get(key);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function readCaps(env: McpEnv): Promise<{ userCapUsd: number; globalCapUsd: number }> {
  const [user, global] = await Promise.all([
    readCents(env, 'mcp-user-cap-cents', DEFAULT_USER_CAP_CENTS),
    readCents(env, 'mcp-global-cap-cents', DEFAULT_GLOBAL_CAP_CENTS),
  ]);
  return { userCapUsd: user / 100, globalCapUsd: global / 100 };
}

export async function readSpent(env: McpEnv, userId: string, day: string = utcDay()): Promise<{ costUsd: number; calls: number }> {
  const row = await env.DB.prepare(
    'SELECT cost_usd, calls FROM mcp_usage_daily WHERE user_id = ? AND day = ?'
  ).bind(userId, day).first<{ cost_usd: number; calls: number }>();
  return { costUsd: row?.cost_usd ?? 0, calls: row?.calls ?? 0 };
}

export type BudgetDecision =
  | { ok: true; spentUsd: number; capUsd: number }
  | { ok: false; reason: 'user_cap' | 'global_cap'; spentUsd: number; capUsd: number };

export async function checkBudget(env: McpEnv, identity: McpIdentity, estimateUsd: number): Promise<BudgetDecision> {
  const day = utcDay();
  const [caps, user, global] = await Promise.all([
    readCaps(env),
    readSpent(env, identity.userId, day),
    readSpent(env, GLOBAL_USER_ID, day),
  ]);

  if (global.costUsd + estimateUsd > caps.globalCapUsd) {
    return { ok: false, reason: 'global_cap', spentUsd: global.costUsd, capUsd: caps.globalCapUsd };
  }
  if (!identity.isAdmin && user.costUsd + estimateUsd > caps.userCapUsd) {
    return { ok: false, reason: 'user_cap', spentUsd: user.costUsd, capUsd: caps.userCapUsd };
  }
  return { ok: true, spentUsd: user.costUsd, capUsd: caps.userCapUsd };
}

// Non-atomic KV counter: two concurrent calls may both see 29 and both pass.
// Acceptable; the dollar budget is the real guard.
export async function checkRateLimit(env: McpEnv, userId: string, now: Date = new Date()): Promise<boolean> {
  const minute = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const key = `mcprate:${userId}:${minute}`;
  const current = Number((await env.KV.get(key)) ?? '0');
  if (current >= RATE_LIMIT_PER_MINUTE) return false;
  await env.KV.put(key, String(current + 1), { expirationTtl: 120 });
  return true;
}

export interface UsageEntry {
  userId: string;
  tool: string;
  costUsd: number;
  cached: boolean;
  ok: boolean;
  durationMs: number;
  authKind: string;
  clientName: string;
}

const UPSERT = `INSERT INTO mcp_usage_daily (user_id, day, cost_usd, calls) VALUES (?, ?, ?, 1)
  ON CONFLICT(user_id, day) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd, calls = calls + 1`;

export async function recordUsage(env: McpEnv, entry: UsageEntry): Promise<void> {
  const day = utcDay();
  await env.DB.batch([
    env.DB.prepare(UPSERT).bind(entry.userId, day, entry.costUsd),
    env.DB.prepare(UPSERT).bind(GLOBAL_USER_ID, day, entry.costUsd),
    env.DB.prepare(
      `INSERT INTO mcp_calls (user_id, tool, cost_usd, cached, ok, duration_ms, auth_kind, client_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(entry.userId, entry.tool, entry.costUsd, entry.cached ? 1 : 0, entry.ok ? 1 : 0, entry.durationMs, entry.authKind, entry.clientName),
  ]);
}

export function budgetMessage(d: Extract<BudgetDecision, { ok: false }>): string {
  const cap = `$${d.capUsd.toFixed(2)}`;
  if (d.reason === 'global_cap') {
    return `The DataWise MCP server reached its daily DataForSEO budget for all members. It resets at 00:00 UTC. Tools that read stored data (rank tracking, AI visibility, Search Console) still work.`;
  }
  return `Daily MCP budget reached (${cap}). Resets at 00:00 UTC, no rollover. Rank tracking, AI visibility, and Search Console tools still work because they use stored data.`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/mcp/budget.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/budget.ts src/mcp/budget.test.ts
git commit -m "feat(mcp): dollar budget, rate limit, and usage ledger"
```

---

### Task 8: Output shaping and the route-handler bridge

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/shape.ts`
- Create: `datawise-seo-insight-main/workers/src/mcp/call-handler.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/shape.test.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/call-handler.test.ts`

**Interfaces:**
- Consumes: `McpEnv`, `asWorkerEnv` (Task 4).
- Produces:
  ```ts
  // shape.ts
  export interface ToolResult { content: Array<{ type: 'text'; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean; }
  export function stripHtml(input: string): string
  export function compact(value: unknown, opts: { maxArray: number; maxString: number; maxDepth?: number }): unknown
  export function toolResult(structured: Record<string, unknown>, summary: string): ToolResult
  export function toolError(message: string): ToolResult
  export const CONCISE = { maxArray: 25, maxString: 300 }; export const DETAILED = { maxArray: 100, maxString: 2000 };
  // call-handler.ts
  export class HandlerError extends Error { status: number; }
  export type JsonHandler = (request: Request, env: Env, userId: string) => Promise<Response>;
  export async function callJson<T = any>(env: McpEnv, userId: string, handler: JsonHandler, body: unknown, url?: string): Promise<T>
  export async function readJson<T = any>(response: Response): Promise<T>
  ```
  `compact` truncates arrays to `maxArray` (the caller reports counts), strips HTML and trims strings to `maxString`, drops keys named `cost`, `request_id`, `user_id`, and recurses to `maxDepth` (default 6).

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/shape.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stripHtml, compact, toolResult, toolError, CONCISE } from './shape';

describe('stripHtml', () => {
  it('removes tags, entities and control chars', () => {
    expect(stripHtml('<b>Hi</b> &amp; bye')).toBe('Hi & bye');
    expect(stripHtml('a\n\nb')).toBe('a b');
  });
});

describe('compact', () => {
  it('truncates arrays and strings, strips html, drops billing/identity keys', () => {
    const input = {
      cost: 0.02,
      user_id: 'u1',
      request_id: 'r',
      title: '<i>Long</i> ' + 'x'.repeat(500),
      items: Array.from({ length: 50 }, (_, i) => ({ n: i, html: '<p>t</p>' })),
      nested: { deep: { deeper: { cost: 1, ok: true } } },
    };
    const out = compact(input, CONCISE) as any;
    expect(out.cost).toBeUndefined();
    expect(out.user_id).toBeUndefined();
    expect(out.request_id).toBeUndefined();
    expect(out.title.startsWith('Long x')).toBe(true);
    expect(out.title.length).toBeLessThanOrEqual(300);
    expect(out.items).toHaveLength(25);
    expect(out.items[0]).toEqual({ n: 0, html: 't' });
    expect(out.nested.deep.deeper).toEqual({ ok: true });
  });

  it('leaves numbers, booleans and null alone and stops at maxDepth', () => {
    expect(compact({ a: 1, b: false, c: null }, CONCISE)).toEqual({ a: 1, b: false, c: null });
    const deep = { l1: { l2: { l3: { l4: { l5: { l6: { l7: 'x' } } } } } } };
    expect(JSON.stringify(compact(deep, { ...CONCISE, maxDepth: 3 }))).not.toContain('l7');
  });
});

describe('tool results', () => {
  it('toolResult carries text and structuredContent', () => {
    const r = toolResult({ rows: [1] }, 'One row.');
    expect(r.isError).toBeUndefined();
    expect(r.content[0]).toEqual({ type: 'text', text: 'One row.\n\n{"rows":[1]}' });
    expect(r.structuredContent).toEqual({ rows: [1] });
  });
  it('toolError sets isError', () => {
    expect(toolError('nope')).toEqual({ isError: true, content: [{ type: 'text', text: 'nope' }] });
  });
});
```

Create `src/mcp/call-handler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv } from './test-support';
import { callJson, readJson, HandlerError } from './call-handler';

describe('callJson', () => {
  it('posts the body as JSON and returns the parsed response', async () => {
    const { env } = makeMcpTestEnv();
    const handler = async (request: Request) => {
      const body = await request.json();
      return new Response(JSON.stringify({ echoed: body, method: request.method }), { headers: { 'Content-Type': 'application/json' } });
    };
    const out = await callJson(env, 'u1', handler, { keyword: 'x' });
    expect(out).toEqual({ echoed: { keyword: 'x' }, method: 'POST' });
  });

  it('throws HandlerError with the handler status and error text', async () => {
    const { env } = makeMcpTestEnv();
    const handler = async () => new Response(JSON.stringify({ error: 'Target domain is required' }), { status: 400 });
    await expect(callJson(env, 'u1', handler, {})).rejects.toMatchObject({ status: 400, message: 'Target domain is required' });
    const h502 = async () => new Response(JSON.stringify({ error: 'DataForSEO request failed', detail: 'boom' }), { status: 502 });
    await expect(callJson(env, 'u1', h502, {})).rejects.toMatchObject({ status: 502, message: 'DataForSEO request failed: boom' });
    await expect(callJson(env, 'u1', h502, {})).rejects.toBeInstanceOf(HandlerError);
  });

  it('readJson works for GET-style handlers', async () => {
    const res = new Response(JSON.stringify([{ id: 1 }]));
    expect(await readJson(res)).toEqual([{ id: 1 }]);
    await expect(readJson(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 }))).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/shape.test.ts src/mcp/call-handler.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/mcp/shape.ts`**

```ts
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface CompactOptions {
  maxArray: number;
  maxString: number;
  maxDepth?: number;
}

export const CONCISE: CompactOptions = { maxArray: 25, maxString: 300 };
export const DETAILED: CompactOptions = { maxArray: 100, maxString: 2000 };

// Keys that must never reach a model: billing detail and identity (spec 5).
const DROP_KEYS = new Set(['cost', 'request_id', 'user_id']);

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function compact(value: unknown, opts: CompactOptions, depth = 0): unknown {
  const maxDepth = opts.maxDepth ?? 6;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const clean = stripHtml(value);
    return clean.length > opts.maxString ? clean.slice(0, opts.maxString - 3) + '...' : clean;
  }
  if (depth >= maxDepth) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, opts.maxArray).map((v) => compact(v, opts, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(k)) continue;
      const c = compact(v, opts, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

export function toolResult(structured: Record<string, unknown>, summary: string): ToolResult {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(structured)}` }],
    structuredContent: structured,
  };
}

export function toolError(message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
```

- [ ] **Step 4: Implement `src/mcp/call-handler.ts`**

```ts
import type { Env } from '../index';
import type { McpEnv } from './env';
import { asWorkerEnv } from './env';

export class HandlerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HandlerError';
    this.status = status;
  }
}

// Every POST-shaped route handler in workers/src/routes has this shape (some
// ignore the third argument). TypeScript accepts two-arg handlers here.
export type JsonHandler = (request: Request, env: Env, userId: string) => Promise<Response>;

export async function readJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) {
    const base = parsed?.error ?? `Handler returned ${response.status}`;
    const detail = parsed?.detail ? `: ${parsed.detail}` : '';
    throw new HandlerError(response.status, `${base}${detail}`);
  }
  return parsed as T;
}

// Runs an existing route handler exactly as the API worker would, minus the
// router, CORS and credit wrapper. The synthetic URL only matters for GET
// handlers that read searchParams; pass one when needed.
export async function callJson<T = any>(
  env: McpEnv,
  userId: string,
  handler: JsonHandler,
  body: unknown,
  url = 'https://mcp.internal/',
): Promise<T> {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const response = await handler(request, asWorkerEnv(env), userId);
  return readJson<T>(response);
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/mcp/shape.test.ts src/mcp/call-handler.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/shape.ts src/mcp/shape.test.ts src/mcp/call-handler.ts src/mcp/call-handler.test.ts
git commit -m "feat(mcp): output shaping and route-handler bridge"
```

---

### Task 9: Tool types and the keyword tools

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/tools/types.ts`
- Create: `datawise-seo-insight-main/workers/src/mcp/tools/keywords.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/tools/keywords.test.ts`

**Interfaces:**
- Consumes: `callJson` (Task 8), `toolResult`, `compact`, `CONCISE`, `DETAILED` (Task 8), `McpEnv`, `McpIdentity` (Task 4), handlers `handleRelatedKeywords`, `handleKeywordSuggestions`, `handleKeywordIdeas`, `handleKeywordDifficulty`, `handleKeywordOverview` from `../../routes/keywords`.
- Produces:
  ```ts
  // types.ts
  export interface ToolContext { env: McpEnv; identity: McpIdentity; }
  export interface ToolDef<S extends z.ZodObject<any> = z.ZodObject<any>> { name: string; description: string; inputSchema: S; run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>; }
  export function defineTool<S extends z.ZodObject<any>>(def: ToolDef<S>): ToolDef<S>
  export const localeInputs: { location_code, language_code, response_format }   // zod fields to spread into every tool schema
  export const domainInput: z.ZodString
  export function resolveLocale(args: { location_code?: number; language_code?: string }, identity: McpIdentity): { location_code: number; language_code: string }
  export function shapeFor(format: 'concise' | 'detailed' | undefined): CompactOptions
  // keywords.ts
  export const keywordResearch: ToolDef; export const keywordMetrics: ToolDef;
  ```

Tests mock the route module with `vi.mock('../../routes/keywords', ...)` so no DataForSEO call happens.

- [ ] **Step 1: Write the failing test**

Create `src/mcp/tools/keywords.test.ts`:

```ts
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
      const body = await req.json() as any;
      return json({ tasks: [{ result: [{ items: Array.from({ length: Math.min(body.limit, 3) }, (_, i) => ({
        keyword_data: { keyword: `${body.keyword} ${i}`, keyword_info: { search_volume: 100 - i, cpc: 0.5, competition: 0.1, competition_level: 'LOW' } },
      })) }] }] });
    }),
    handleKeywordSuggestions: vi.fn(async (req: Request) => {
      const body = await req.json() as any;
      return json({ tasks: [{ result: [{ items: [labsItem(`${body.keyword} suggestion`, 50)] }] }] });
    }),
    handleKeywordIdeas: vi.fn(async () => json({ tasks: [{ result: [{ items: [labsItem('idea', 20)] }] }] })),
    handleKeywordOverview: vi.fn(async (req: Request) => {
      const body = await req.json() as any;
      return json({ tasks: [{ result: [{ items: [labsItem(body.keywords[0], 900)] }] }] });
    }),
    handleKeywordDifficulty: vi.fn(async (req: Request) => {
      const body = await req.json() as any;
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
```

Note: `handleKeywordOverview` in `routes/keywords.ts` reads `keyword` (singular) from the body and wraps it as `keywords: [keyword]` for DataForSEO. The mock above reads `body.keywords[0]` because Task 9 calls the DataForSEO overview endpoint through the handler one keyword at a time; adjust the mock to `body.keyword` if you implement it that way. Both are correct; keep the mock and the implementation consistent.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/tools/keywords.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Create `src/mcp/tools/types.ts`**

```ts
import { z } from 'zod';
import type { McpEnv, McpIdentity } from '../env';
import type { ToolResult, CompactOptions } from '../shape';
import { CONCISE, DETAILED } from '../shape';

export interface ToolContext {
  env: McpEnv;
  identity: McpIdentity;
}

export interface ToolDef<S extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string;
  description: string;
  inputSchema: S;
  run(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;
}

export function defineTool<S extends z.ZodObject<any>>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export const localeInputs = {
  location_code: z.number().int().positive().optional()
    .describe('DataForSEO location code. Defaults to the account default (2840 = United States). 2826 = United Kingdom, 2124 = Canada, 2036 = Australia, 2724 = Spain, 2484 = Mexico.'),
  language_code: z.string().min(2).max(8).optional()
    .describe('Two-letter language code such as en or es. Defaults to the account default.'),
  response_format: z.enum(['concise', 'detailed']).default('concise')
    .describe('concise returns the fields a person would put in a spreadsheet; detailed returns more fields and longer lists.'),
};

// Bare-domain input. sanitizeDomainTarget (routes/competitors.ts) still runs
// inside every handler; this only gives the model a clearer schema.
export const domainInput = z.string().min(3).max(253)
  .describe('Bare domain such as example.com. Protocol, www and paths are stripped automatically.');

export function resolveLocale(
  args: { location_code?: number; language_code?: string },
  identity: McpIdentity,
): { location_code: number; language_code: string } {
  return {
    location_code: args.location_code ?? identity.defaultLocationCode,
    language_code: args.language_code ?? identity.defaultLanguageCode,
  };
}

export function shapeFor(format: 'concise' | 'detailed' | undefined): CompactOptions {
  return format === 'detailed' ? DETAILED : CONCISE;
}
```

- [ ] **Step 4: Create `src/mcp/tools/keywords.ts`**

```ts
import { z } from 'zod';
import { defineTool, localeInputs, resolveLocale } from './types';
import { callJson } from '../call-handler';
import { toolResult } from '../shape';
import {
  handleRelatedKeywords, handleKeywordSuggestions, handleKeywordIdeas,
  handleKeywordOverview, handleKeywordDifficulty,
} from '../../routes/keywords';

interface KeywordRow {
  keyword: string;
  search_volume: number;
  cpc: number;
  competition_level: string;
  difficulty?: number;
  intent?: string;
}

const items = (envelope: any): any[] => envelope?.tasks?.[0]?.result?.[0]?.items ?? [];

// /api/keywords/related re-wraps rows under keyword_data; suggestions, ideas
// and overview return DataForSEO's flat Labs item shape.
function fromRelated(item: any): KeywordRow {
  const kd = item.keyword_data ?? {};
  const ki = kd.keyword_info ?? {};
  return { keyword: kd.keyword, search_volume: ki.search_volume ?? 0, cpc: ki.cpc ?? 0, competition_level: ki.competition_level ?? 'UNKNOWN' };
}

function fromLabs(item: any): KeywordRow {
  const ki = item.keyword_info ?? {};
  const row: KeywordRow = {
    keyword: item.keyword,
    search_volume: ki.search_volume ?? 0,
    cpc: ki.cpc ?? 0,
    competition_level: ki.competition_level ?? 'UNKNOWN',
  };
  const kd = item.keyword_properties?.keyword_difficulty;
  if (typeof kd === 'number') row.difficulty = kd;
  const intent = item.search_intent_info?.main_intent;
  if (typeof intent === 'string') row.intent = intent;
  return row;
}

export const keywordResearch = defineTool({
  name: 'datawise_keyword_research',
  description:
    'Use this to discover keywords around a seed term with monthly search volume, CPC and competition. ' +
    'mode=related (default) blends related keywords and keyword ideas sorted by volume; mode=suggestions returns long-tail phrases containing the seed with difficulty and intent; mode=ideas returns broader topic ideas. ' +
    'Do not use for metrics on keywords you already have (use datawise_keyword_metrics) or for what a domain ranks for (use datawise_ranked_keywords).',
  inputSchema: z.object({
    keyword: z.string().min(1).max(200).describe('Seed keyword, e.g. "local seo services".'),
    mode: z.enum(['related', 'suggestions', 'ideas']).default('related'),
    limit: z.number().int().min(1).max(100).default(25).describe('Rows to return, max 100.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const uid = ctx.identity.userId;
    const body = { keyword: args.keyword, limit: args.limit, ...locale };
    let rows: KeywordRow[];
    if (args.mode === 'related') {
      rows = items(await callJson(ctx.env, uid, handleRelatedKeywords, body)).map(fromRelated);
    } else if (args.mode === 'suggestions') {
      rows = items(await callJson(ctx.env, uid, handleKeywordSuggestions, body)).map(fromLabs);
    } else {
      rows = items(await callJson(ctx.env, uid, handleKeywordIdeas, body)).map(fromLabs);
    }
    rows = rows.filter((r) => r.keyword).slice(0, args.limit);
    return toolResult(
      { seed: args.keyword, mode: args.mode, ...locale, keywords: rows },
      `${rows.length} keywords for "${args.keyword}" (${args.mode}, location ${locale.location_code}).`,
    );
  },
});

export const keywordMetrics = defineTool({
  name: 'datawise_keyword_metrics',
  description:
    'Use this to get search volume, CPC, competition, keyword difficulty and search intent for keywords you already have (up to 50 per call). ' +
    'Do not use to discover new keywords; use datawise_keyword_research for that.',
  inputSchema: z.object({
    keywords: z.array(z.string().min(1).max(200)).min(1).max(50),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const uid = ctx.identity.userId;
    // handleKeywordOverview takes one keyword per call; run them in parallel.
    const [overviews, difficulty] = await Promise.all([
      Promise.all(args.keywords.map((keyword) => callJson(ctx.env, uid, handleKeywordOverview, { keyword, ...locale }))),
      callJson(ctx.env, uid, handleKeywordDifficulty, { keywords: args.keywords, ...locale }),
    ]);
    const kdByKeyword = new Map<string, number>();
    for (const it of items(difficulty)) kdByKeyword.set(String(it.keyword).toLowerCase(), it.keyword_difficulty);

    const rows: KeywordRow[] = args.keywords.map((keyword, i) => {
      const first = items(overviews[i])[0];
      const row: KeywordRow = first ? fromLabs(first) : { keyword, search_volume: 0, cpc: 0, competition_level: 'UNKNOWN' };
      const kd = kdByKeyword.get(keyword.toLowerCase());
      return { ...row, keyword, difficulty: kd ?? row.difficulty };
    });
    return toolResult(
      { ...locale, keywords: rows },
      `Metrics for ${rows.length} keywords (location ${locale.location_code}).`,
    );
  },
});
```

Because `handleKeywordOverview` reads `body.keyword` (singular), change the test mock for `handleKeywordOverview` to use `body.keyword` instead of `body.keywords[0]`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/mcp/tools/keywords.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/types.ts src/mcp/tools/keywords.ts src/mcp/tools/keywords.test.ts
git commit -m "feat(mcp): tool types and keyword research/metrics tools"
```

---

### Task 10: Domain tools

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/tools/domains.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/tools/domains.test.ts`

**Interfaces:**
- Consumes: `defineTool`, `localeInputs`, `domainInput`, `resolveLocale`, `shapeFor` (Task 9); `callJson` (Task 8); `toolResult`, `compact` (Task 8); handlers `handleRankedKeywords`, `handleDomainRankOverview`, `handleCompetitorsDomain`, `handleBulkTrafficEstimation` from `../../routes/competitors`; `handleBacklinksSummary` from `../../routes/backlinks`.
- Produces: `domainOverview`, `rankedKeywords`, `competitors`, `keywordGap` (all `ToolDef`).

DataForSEO item shapes relied on (Labs, verified against the SPA code that renders them):
- `ranked_keywords` item: `keyword_data.keyword`, `keyword_data.keyword_info.{search_volume,cpc,competition_level}`, `keyword_data.keyword_properties.keyword_difficulty`, `ranked_serp_element.serp_item.{rank_absolute,rank_group,url,etv}`.
- `domain_rank_overview` item: `metrics.organic.{pos_1,pos_2_3,pos_4_10,pos_11_20,pos_21_30,...,pos_91_100,etv,count,estimated_paid_traffic_cost}`.
- `competitors_domain` item: `domain`, `avg_position`, `intersections`, `full_domain_metrics.organic.{etv,count}`.
- `bulk_traffic_estimation` item: `metrics.organic.{etv,count}`, `metrics.paid.{etv,count}`.
- Backlinks summary handler returns `{ data: { backlinks, referring_domains, referring_main_domains, rank, broken_backlinks, referring_ips }, cost }`.

- [ ] **Step 1: Write the failing test**

Create `src/mcp/tools/domains.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const labs = (items: unknown[]) => ({ tasks: [{ result: [{ items }] }] });
const ranked = (keyword: string, vol: number, pos: number) => ({
  keyword_data: { keyword, keyword_info: { search_volume: vol, cpc: 1, competition_level: 'LOW' }, keyword_properties: { keyword_difficulty: 20 } },
  ranked_serp_element: { serp_item: { rank_absolute: pos, rank_group: pos, url: `https://x/${keyword}`, etv: vol / 10 } },
});

vi.mock('../../routes/competitors', () => ({
  handleRankedKeywords: vi.fn(async (req: Request) => {
    const b = await req.json() as any;
    if (b.target === 'me.com') return json(labs([ranked('shared kw', 500, 3), ranked('mine only', 100, 8)]));
    if (b.target === 'rival.com') return json(labs([ranked('shared kw', 500, 1), ranked('gap kw', 900, 5), ranked('gap kw 2', 50, 30)]));
    return json(labs(Array.from({ length: Math.min(b.limit, 4) }, (_, i) => ranked(`k${i}`, 1000 - i * 100, i + 1))));
  }),
  handleDomainRankOverview: vi.fn(async () => json(labs([{ metrics: { organic: { pos_1: 2, pos_2_3: 3, pos_4_10: 5, pos_11_20: 4, pos_21_30: 1, etv: 1234.5, count: 15, estimated_paid_traffic_cost: 99 } } }]))),
  handleCompetitorsDomain: vi.fn(async () => json(labs([
    { domain: 'a.com', avg_position: 12.3, intersections: 40, full_domain_metrics: { organic: { etv: 5000, count: 800 } } },
    { domain: 'b.com', avg_position: 20, intersections: 10, full_domain_metrics: { organic: { etv: 100, count: 50 } } },
  ]))),
  handleBulkTrafficEstimation: vi.fn(async () => json(labs([{ metrics: { organic: { etv: 2222, count: 15 }, paid: { etv: 10, count: 1 } } }]))),
}));
vi.mock('../../routes/backlinks', () => ({
  handleBacklinksSummary: vi.fn(async () => json({ data: { backlinks: 120, referring_domains: 30, referring_main_domains: 28, rank: 210, broken_backlinks: 2, referring_ips: 25 }, cost: 0.02 })),
}));

import { domainOverview, rankedKeywords, competitors, keywordGap } from './domains';
import * as comp from '../../routes/competitors';

const identity: McpIdentity = {
  userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false,
  defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token',
};

describe('datawise_domain_overview', () => {
  it('condenses rank overview, traffic and backlinks into one object', async () => {
    const { env } = makeMcpTestEnv();
    const out = await domainOverview.run(domainOverview.inputSchema.parse({ domain: 'https://www.Example.com/path' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.domain).toBe('example.com');
    expect(s.organic).toEqual({ keywords_total: 15, top_3: 5, top_10: 10, top_100: 15, estimated_monthly_traffic: 1234.5, traffic_value_usd: 99 });
    expect(s.traffic_estimate).toEqual({ organic_monthly_visits: 2222, paid_monthly_visits: 10 });
    expect(s.backlinks).toEqual({ total: 120, referring_domains: 30, referring_main_domains: 28, domain_rank: 210, broken: 2 });
    expect(s.errors).toEqual([]);
  });

  it('reports a failed sub-call instead of failing the whole tool', async () => {
    const { env } = makeMcpTestEnv();
    (comp.handleBulkTrafficEstimation as any).mockImplementationOnce(async () => json({ error: 'DataForSEO request failed', detail: 'x' }, 502));
    const out = await domainOverview.run(domainOverview.inputSchema.parse({ domain: 'example.com' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.traffic_estimate).toBeNull();
    expect(s.errors[0]).toContain('traffic');
    expect(out.isError).toBeUndefined();
  });
});

describe('datawise_ranked_keywords', () => {
  it('flattens rows and applies min_volume / max_position filters', async () => {
    const { env } = makeMcpTestEnv();
    const out = await rankedKeywords.run(rankedKeywords.inputSchema.parse({ domain: 'z.com', limit: 4, min_volume: 750, max_position: 3 }), { env, identity });
    const rows = (out.structuredContent as any).keywords;
    expect(rows).toEqual([
      { keyword: 'k0', position: 1, search_volume: 1000, cpc: 1, difficulty: 20, url: 'https://x/k0', estimated_traffic: 100 },
      { keyword: 'k1', position: 2, search_volume: 900, cpc: 1, difficulty: 20, url: 'https://x/k1', estimated_traffic: 90 },
      { keyword: 'k2', position: 3, search_volume: 800, cpc: 1, difficulty: 20, url: 'https://x/k2', estimated_traffic: 80 },
    ]);
  });
});

describe('datawise_competitors', () => {
  it('returns competitor rows sorted as DataForSEO returns them, capped at limit', async () => {
    const { env } = makeMcpTestEnv();
    const out = await competitors.run(competitors.inputSchema.parse({ domain: 'z.com', limit: 1 }), { env, identity });
    expect((out.structuredContent as any).competitors).toEqual([
      { domain: 'a.com', avg_position: 12.3, shared_keywords: 40, estimated_monthly_traffic: 5000, keywords_total: 800 },
    ]);
  });
});

describe('datawise_keyword_gap', () => {
  it('lists keywords the competitor ranks for that you do not, by volume', async () => {
    const { env } = makeMcpTestEnv();
    const out = await keywordGap.run(keywordGap.inputSchema.parse({ my_domain: 'me.com', competitor_domain: 'rival.com' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.gaps.map((g: any) => g.keyword)).toEqual(['gap kw', 'gap kw 2']);
    expect(s.gaps[0]).toEqual({ keyword: 'gap kw', search_volume: 900, competitor_position: 5 });
    expect(s.shared).toEqual([{ keyword: 'shared kw', search_volume: 500, my_position: 3, competitor_position: 1 }]);
    expect(s.summary).toEqual({ gaps: 2, shared: 1, my_advantages: 1 });
    const sent = await (comp.handleRankedKeywords as any).mock.calls.at(-1)[0].json();
    expect(sent.limit).toBe(300);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/tools/domains.test.ts`
Expected: FAIL, cannot resolve `./domains`.

- [ ] **Step 3: Create `src/mcp/tools/domains.ts`**

```ts
import { z } from 'zod';
import { defineTool, localeInputs, domainInput, resolveLocale } from './types';
import { callJson } from '../call-handler';
import { toolResult } from '../shape';
import {
  handleRankedKeywords, handleDomainRankOverview, handleCompetitorsDomain, handleBulkTrafficEstimation,
} from '../../routes/competitors';
import { handleBacklinksSummary } from '../../routes/backlinks';

const GAP_ROWS_PER_SIDE = 300;

const items = (envelope: any): any[] => envelope?.tasks?.[0]?.result?.[0]?.items ?? [];

// Same rules as sanitizeDomainTarget in routes/competitors.ts. Duplicated
// (five lines) rather than imported so this module keeps a single dependency
// direction: tools call handlers, never handler helpers.
function bareDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
}

interface RankedRow {
  keyword: string;
  position: number;
  search_volume: number;
  cpc: number;
  difficulty: number | null;
  url: string | null;
  estimated_traffic: number;
}

function fromRanked(item: any): RankedRow {
  const kd = item.keyword_data ?? {};
  const serp = item.ranked_serp_element?.serp_item ?? {};
  return {
    keyword: kd.keyword,
    position: serp.rank_absolute ?? serp.rank_group ?? 0,
    search_volume: kd.keyword_info?.search_volume ?? 0,
    cpc: kd.keyword_info?.cpc ?? 0,
    difficulty: kd.keyword_properties?.keyword_difficulty ?? null,
    url: serp.url ?? null,
    estimated_traffic: serp.etv ?? 0,
  };
}

async function fetchRanked(ctx: { env: any; identity: any }, target: string, limit: number, locale: object): Promise<RankedRow[]> {
  const data = await callJson(ctx.env, ctx.identity.userId, handleRankedKeywords, { target, limit, ...locale });
  return items(data).map(fromRanked).filter((r) => r.keyword);
}

export const domainOverview = defineTool({
  name: 'datawise_domain_overview',
  description:
    'Use this for a one-call snapshot of a domain: organic keyword counts by position bucket, estimated monthly organic traffic and its value, a traffic estimate, and a backlink summary (total backlinks, referring domains, domain rank). ' +
    'This is the most expensive tool (three DataForSEO calls). Do not call it repeatedly for the same domain; do not use it to list keywords (use datawise_ranked_keywords).',
  inputSchema: z.object({ domain: domainInput, ...localeInputs }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domain = bareDomain(args.domain);
    const uid = ctx.identity.userId;
    const [rank, traffic, links] = await Promise.allSettled([
      callJson(ctx.env, uid, handleDomainRankOverview, { target: domain, ...locale }),
      callJson(ctx.env, uid, handleBulkTrafficEstimation, { targets: [domain], ...locale }),
      callJson(ctx.env, uid, handleBacklinksSummary, { target: domain }),
    ]);
    const errors: string[] = [];
    const reason = (r: PromiseSettledResult<any>) => (r.status === 'rejected' ? (r.reason?.message ?? String(r.reason)) : '');

    let organic: Record<string, number> | null = null;
    if (rank.status === 'fulfilled') {
      const m = items(rank.value)[0]?.metrics?.organic ?? {};
      const top3 = (m.pos_1 ?? 0) + (m.pos_2_3 ?? 0);
      const top10 = top3 + (m.pos_4_10 ?? 0);
      organic = {
        keywords_total: m.count ?? 0,
        top_3: top3,
        top_10: top10,
        top_100: m.count ?? 0,
        estimated_monthly_traffic: m.etv ?? 0,
        traffic_value_usd: m.estimated_paid_traffic_cost ?? 0,
      };
    } else errors.push(`rank overview unavailable: ${reason(rank)}`);

    let traffic_estimate: Record<string, number> | null = null;
    if (traffic.status === 'fulfilled') {
      const m = items(traffic.value)[0]?.metrics ?? {};
      traffic_estimate = { organic_monthly_visits: m.organic?.etv ?? 0, paid_monthly_visits: m.paid?.etv ?? 0 };
    } else errors.push(`traffic estimate unavailable: ${reason(traffic)}`);

    let backlinks: Record<string, number> | null = null;
    if (links.status === 'fulfilled') {
      const d = links.value?.data ?? {};
      backlinks = {
        total: d.backlinks ?? 0,
        referring_domains: d.referring_domains ?? 0,
        referring_main_domains: d.referring_main_domains ?? 0,
        domain_rank: d.rank ?? 0,
        broken: d.broken_backlinks ?? 0,
      };
    } else errors.push(`backlinks summary unavailable: ${reason(links)}`);

    return toolResult(
      { domain, ...locale, organic, traffic_estimate, backlinks, errors },
      `Overview for ${domain}: ${organic?.keywords_total ?? '?'} organic keywords, ~${Math.round(organic?.estimated_monthly_traffic ?? 0)} monthly visits, ${backlinks?.referring_domains ?? '?'} referring domains.${errors.length ? ` ${errors.length} sub-call(s) failed.` : ''}`,
    );
  },
});

export const rankedKeywords = defineTool({
  name: 'datawise_ranked_keywords',
  description:
    'Use this to list the keywords a domain ranks for in Google organic results, with position, volume, CPC, difficulty, ranking URL and estimated traffic. ' +
    'Filters apply after fetching, so raise limit when combining min_volume and max_position. Do not use for a domain summary (datawise_domain_overview) or to compare two domains (datawise_keyword_gap).',
  inputSchema: z.object({
    domain: domainInput,
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0).describe('Skip this many rows (pagination).'),
    min_volume: z.number().int().min(0).optional().describe('Keep only keywords with at least this monthly volume.'),
    max_position: z.number().int().min(1).max(100).optional().describe('Keep only keywords ranking at or above this position.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domain = bareDomain(args.domain);
    const data = await callJson(ctx.env, ctx.identity.userId, handleRankedKeywords, { target: domain, limit: args.limit + args.offset, ...locale });
    let rows = items(data).map(fromRanked).filter((r) => r.keyword);
    if (args.min_volume != null) rows = rows.filter((r) => r.search_volume >= args.min_volume!);
    if (args.max_position != null) rows = rows.filter((r) => r.position > 0 && r.position <= args.max_position!);
    rows = rows.slice(args.offset, args.offset + args.limit);
    return toolResult(
      { domain, ...locale, offset: args.offset, keywords: rows },
      `${rows.length} ranked keywords for ${domain} (location ${locale.location_code}).`,
    );
  },
});

export const competitors = defineTool({
  name: 'datawise_competitors',
  description:
    'Use this to find the organic competitors of a domain: sites that rank for the same keywords, with shared keyword count, average position and estimated traffic. ' +
    'Do not use for backlink competitors or for keyword-level comparison (datawise_keyword_gap).',
  inputSchema: z.object({
    domain: domainInput,
    limit: z.number().int().min(1).max(20).default(10),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domain = bareDomain(args.domain);
    const data = await callJson(ctx.env, ctx.identity.userId, handleCompetitorsDomain, { target: domain, ...locale });
    const rows = items(data).slice(0, args.limit).map((it: any) => ({
      domain: it.domain,
      avg_position: it.avg_position ?? null,
      shared_keywords: it.intersections ?? 0,
      estimated_monthly_traffic: it.full_domain_metrics?.organic?.etv ?? 0,
      keywords_total: it.full_domain_metrics?.organic?.count ?? 0,
    }));
    return toolResult({ domain, ...locale, competitors: rows }, `${rows.length} organic competitors for ${domain}.`);
  },
});

export const keywordGap = defineTool({
  name: 'datawise_keyword_gap',
  description:
    'Use this to compare two domains: keywords the competitor ranks for that you do not (gaps), keywords you both rank for (shared), and a count of your advantages. ' +
    'Fetches the top 300 keywords of each domain. Do not use for a single domain.',
  inputSchema: z.object({
    my_domain: domainInput,
    competitor_domain: domainInput,
    limit: z.number().int().min(1).max(100).default(25).describe('Gap rows to return.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const mine = bareDomain(args.my_domain);
    const theirs = bareDomain(args.competitor_domain);
    const [myRows, theirRows] = await Promise.all([
      fetchRanked(ctx, mine, GAP_ROWS_PER_SIDE, locale),
      fetchRanked(ctx, theirs, GAP_ROWS_PER_SIDE, locale),
    ]);
    const norm = (k: string) => k.trim().replace(/\s+/g, ' ').toLowerCase();
    const myByKw = new Map(myRows.map((r) => [norm(r.keyword), r]));
    const theirByKw = new Map(theirRows.map((r) => [norm(r.keyword), r]));

    const gaps = theirRows
      .filter((r) => !myByKw.has(norm(r.keyword)))
      .sort((a, b) => b.search_volume - a.search_volume)
      .map((r) => ({ keyword: r.keyword, search_volume: r.search_volume, competitor_position: r.position }));
    const shared = myRows
      .filter((r) => theirByKw.has(norm(r.keyword)))
      .sort((a, b) => b.search_volume - a.search_volume)
      .map((r) => ({ keyword: r.keyword, search_volume: r.search_volume, my_position: r.position, competitor_position: theirByKw.get(norm(r.keyword))!.position }));
    const myAdvantages = myRows.filter((r) => !theirByKw.has(norm(r.keyword))).length;

    return toolResult(
      {
        my_domain: mine, competitor_domain: theirs, ...locale,
        summary: { gaps: gaps.length, shared: shared.length, my_advantages: myAdvantages },
        gaps: gaps.slice(0, args.limit),
        shared: shared.slice(0, args.limit),
      },
      `${theirs} ranks for ${gaps.length} keywords that ${mine} does not (top ${Math.min(args.limit, gaps.length)} shown); ${shared.length} shared.`,
    );
  },
});
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/mcp/tools/domains.test.ts && npx tsc --noEmit`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/domains.ts src/mcp/tools/domains.test.ts
git commit -m "feat(mcp): domain overview, ranked keywords, competitors, keyword gap tools"
```

---

### Task 11: Backlinks and AI mentions tools

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/tools/backlinks.ts`
- Create: `datawise-seo-insight-main/workers/src/mcp/tools/ai-mentions.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/tools/backlinks.test.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/tools/ai-mentions.test.ts`

**Interfaces:**
- Consumes: Task 8 and Task 9 exports; handlers `handleBacklinksSummary`, `handleBacklinksList`, `handleReferringDomains`, `handleAnchors` from `../../routes/backlinks`; `handleAggregate`, `handleCrossAggregate` from `../../routes/llm-mentions`. All of these return `{ data, cost }`.
- Produces: `backlinks`, `aiMentions` (`ToolDef`).

- [ ] **Step 1: Write the failing tests**

Create `src/mcp/tools/backlinks.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
vi.mock('../../routes/backlinks', () => ({
  handleBacklinksSummary: vi.fn(async () => json({ data: { backlinks: 10, referring_domains: 4, referring_main_domains: 4, rank: 50, broken_backlinks: 0, referring_ips: 3 }, cost: 0.02 })),
  handleBacklinksList: vi.fn(async (req: Request) => {
    const b = await req.json() as any;
    return json({ data: { items: Array.from({ length: Math.min(b.limit, 3) }, (_, i) => ({
      url_from: `https://from${i}.com/<b>p</b>`, url_to: 'https://t.com/', domain_from: `from${i}.com`, anchor: 'click', dofollow: i !== 1,
      domain_from_rank: 100 + i, first_seen: '2026-01-0' + (i + 1), last_seen: '2026-09-01', extra: 'x',
    })) }, cost: 0.03 });
  }),
  handleReferringDomains: vi.fn(async () => json({ data: { items: [{ domain: 'ref.com', rank: 70, backlinks: 5, referring_pages: 3, first_seen: '2026-02-01' }] }, cost: 0.02 })),
  handleAnchors: vi.fn(async () => json({ data: { items: [{ anchor: 'brand', backlinks: 9, referring_domains: 4, rank: 60 }] }, cost: 0.02 })),
}));

import { backlinks } from './backlinks';
import * as bl from '../../routes/backlinks';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

describe('datawise_backlinks', () => {
  it('summary is the default view', async () => {
    const { env } = makeMcpTestEnv();
    const out = await backlinks.run(backlinks.inputSchema.parse({ domain: 'T.com' }), { env, identity });
    expect((out.structuredContent as any).summary).toEqual({ total: 10, referring_domains: 4, referring_main_domains: 4, domain_rank: 50, broken: 0 });
    expect(JSON.stringify(out.structuredContent)).not.toContain('cost');
  });

  it('list view flattens rows, strips html, and passes one_per_domain', async () => {
    const { env } = makeMcpTestEnv();
    const out = await backlinks.run(backlinks.inputSchema.parse({ domain: 't.com', view: 'list', limit: 2 }), { env, identity });
    const rows = (out.structuredContent as any).backlinks;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ url_from: 'https://from0.com/p', url_to: 'https://t.com/', domain_from: 'from0.com', anchor: 'click', dofollow: true, domain_rank: 100, first_seen: '2026-01-01', last_seen: '2026-09-01' });
    const sent = await (bl.handleBacklinksList as any).mock.calls[0][0].json();
    expect(sent).toMatchObject({ target: 't.com', limit: 2, mode: 'one_per_domain' });
  });

  it('referring_domains and anchors views', async () => {
    const { env } = makeMcpTestEnv();
    const rd = await backlinks.run(backlinks.inputSchema.parse({ domain: 't.com', view: 'referring_domains' }), { env, identity });
    expect((rd.structuredContent as any).referring_domains[0]).toEqual({ domain: 'ref.com', domain_rank: 70, backlinks: 5, referring_pages: 3, first_seen: '2026-02-01' });
    const an = await backlinks.run(backlinks.inputSchema.parse({ domain: 't.com', view: 'anchors' }), { env, identity });
    expect((an.structuredContent as any).anchors[0]).toEqual({ anchor: 'brand', backlinks: 9, referring_domains: 4 });
  });
});
```

Create `src/mcp/tools/ai-mentions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
vi.mock('../../routes/llm-mentions', () => ({
  handleAggregate: vi.fn(async (req: Request) => {
    const b = await req.json() as any;
    return json({ data: { target: b.target, platform: b.platform, items: [{ metric: 'mentions', value: 12, note: '<i>x</i>' }] }, cost: 0.1 });
  }),
  handleCrossAggregate: vi.fn(async (req: Request) => {
    const b = await req.json() as any;
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
    const sent = await (llm.handleAggregate as any).mock.calls[0][0].json();
    expect(sent).toMatchObject({ target: ['a.com'], platform: 'google', location_code: 2840, language_code: 'en' });
  });

  it('several domains use cross-aggregate', async () => {
    const { env } = makeMcpTestEnv();
    const out = await aiMentions.run(aiMentions.inputSchema.parse({ domains: ['a.com', 'b.com'], platform: 'chatgpt' }), { env, identity });
    expect((out.structuredContent as any).metrics.items).toHaveLength(2);
    const sent = await (llm.handleCrossAggregate as any).mock.calls[0][0].json();
    expect(sent).toMatchObject({ targets: ['a.com', 'b.com'], platform: 'chatgpt' });
  });

  it('rejects more than 5 domains', () => {
    expect(() => aiMentions.inputSchema.parse({ domains: ['1', '2', '3', '4', '5', '6'].map((n) => `${n}.com`) })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/tools/backlinks.test.ts src/mcp/tools/ai-mentions.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Create `src/mcp/tools/backlinks.ts`**

```ts
import { z } from 'zod';
import { defineTool, localeInputs, domainInput } from './types';
import { callJson } from '../call-handler';
import { toolResult, stripHtml } from '../shape';
import { handleBacklinksSummary, handleBacklinksList, handleReferringDomains, handleAnchors } from '../../routes/backlinks';

const bare = (raw: string) => raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
const rows = (res: any): any[] => res?.data?.items ?? [];

export const backlinks = defineTool({
  name: 'datawise_backlinks',
  description:
    'Use this for backlink data on a domain. view=summary (default): totals, referring domains, domain rank, broken links. view=list: individual backlinks, one per referring domain, newest first. view=referring_domains: referring domains with their rank. view=anchors: anchor text distribution. ' +
    'Do not use for organic keywords or traffic (datawise_domain_overview).',
  inputSchema: z.object({
    domain: domainInput,
    view: z.enum(['summary', 'list', 'referring_domains', 'anchors']).default('summary'),
    limit: z.number().int().min(1).max(100).default(25).describe('Rows for list, referring_domains and anchors views.'),
    offset: z.number().int().min(0).default(0),
    response_format: localeInputs.response_format,
  }),
  async run(args, ctx) {
    const domain = bare(args.domain);
    const uid = ctx.identity.userId;
    if (args.view === 'summary') {
      const res = await callJson(ctx.env, uid, handleBacklinksSummary, { target: domain });
      const d = res?.data ?? {};
      const summary = { total: d.backlinks ?? 0, referring_domains: d.referring_domains ?? 0, referring_main_domains: d.referring_main_domains ?? 0, domain_rank: d.rank ?? 0, broken: d.broken_backlinks ?? 0 };
      return toolResult({ domain, view: 'summary', summary }, `${domain}: ${summary.total} backlinks from ${summary.referring_domains} referring domains, domain rank ${summary.domain_rank}.`);
    }
    if (args.view === 'list') {
      const res = await callJson(ctx.env, uid, handleBacklinksList, { target: domain, limit: args.limit, offset: args.offset, mode: 'one_per_domain', order_by: ['first_seen,desc'] });
      const list = rows(res).map((it: any) => ({
        url_from: stripHtml(String(it.url_from ?? '')),
        url_to: stripHtml(String(it.url_to ?? '')),
        domain_from: it.domain_from ?? null,
        anchor: stripHtml(String(it.anchor ?? '')),
        dofollow: Boolean(it.dofollow),
        domain_rank: it.domain_from_rank ?? it.rank ?? null,
        first_seen: it.first_seen ?? null,
        last_seen: it.last_seen ?? null,
      }));
      return toolResult({ domain, view: 'list', offset: args.offset, backlinks: list }, `${list.length} backlinks for ${domain} (one per referring domain).`);
    }
    if (args.view === 'referring_domains') {
      const res = await callJson(ctx.env, uid, handleReferringDomains, { target: domain, limit: args.limit, offset: args.offset });
      const list = rows(res).slice(0, args.limit).map((it: any) => ({
        domain: it.domain, domain_rank: it.rank ?? null, backlinks: it.backlinks ?? 0, referring_pages: it.referring_pages ?? 0, first_seen: it.first_seen ?? null,
      }));
      return toolResult({ domain, view: 'referring_domains', offset: args.offset, referring_domains: list }, `${list.length} referring domains for ${domain}.`);
    }
    const res = await callJson(ctx.env, uid, handleAnchors, { target: domain, limit: args.limit });
    const list = rows(res).slice(0, args.limit).map((it: any) => ({
      anchor: stripHtml(String(it.anchor ?? '')), backlinks: it.backlinks ?? 0, referring_domains: it.referring_domains ?? 0,
    }));
    return toolResult({ domain, view: 'anchors', anchors: list }, `${list.length} anchor texts for ${domain}.`);
  },
});
```

- [ ] **Step 4: Create `src/mcp/tools/ai-mentions.ts`**

```ts
import { z } from 'zod';
import { defineTool, localeInputs, domainInput, resolveLocale, shapeFor } from './types';
import { callJson } from '../call-handler';
import { toolResult, compact } from '../shape';
import { handleAggregate, handleCrossAggregate } from '../../routes/llm-mentions';

const bare = (raw: string) => raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');

export const aiMentions = defineTool({
  name: 'datawise_ai_mentions',
  description:
    'Use this to see how often a domain is mentioned or cited in AI answers (DataForSEO LLM Mentions), aggregated over the last period. One domain returns its metrics; two to five domains return a side-by-side comparison. ' +
    'Costs about $0.10 per call. Do not use for Google organic rankings or backlinks.',
  inputSchema: z.object({
    domains: z.array(domainInput).min(1).max(5),
    platform: z.string().min(2).max(30).default('google').describe('AI platform: google (AI Mode / AI Overviews), chatgpt, gemini, perplexity.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domains = args.domains.map(bare);
    const uid = ctx.identity.userId;
    const res = domains.length === 1
      ? await callJson(ctx.env, uid, handleAggregate, { target: domains, platform: args.platform, ...locale })
      : await callJson(ctx.env, uid, handleCrossAggregate, { targets: domains, platform: args.platform, ...locale });
    const metrics = compact(res?.data ?? {}, shapeFor(args.response_format)) as Record<string, unknown>;
    return toolResult(
      { domains, platform: args.platform, ...locale, metrics },
      `AI mention metrics for ${domains.join(', ')} on ${args.platform}.`,
    );
  },
});
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/mcp/tools/backlinks.test.ts src/mcp/tools/ai-mentions.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/backlinks.ts src/mcp/tools/backlinks.test.ts src/mcp/tools/ai-mentions.ts src/mcp/tools/ai-mentions.test.ts
git commit -m "feat(mcp): backlinks and AI mentions tools"
```

---

### Task 12: Stored-data tools (rank tracking, AI visibility, local reviews, Search Console)

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/tools/stored.ts`
- Create: `datawise-seo-insight-main/workers/src/mcp/tools/registry.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/tools/stored.test.ts`

**Interfaces:**
- Consumes: Task 8 and 9 exports; `readJson`, `callJson` (Task 8); `asWorkerEnv` (Task 4); handlers:
  - `handleListProjects(env, userId)`, `handleListKeywords(env, userId, projectId)`, `handleKeywordHistory(env, userId, keywordId)` from `../../routes/rank-tracking`
  - `handleGetAITracking(env, userId, projectId)`, `handleAIReport(request, env, userId, projectId)` from `../../routes/ai-tracking`
  - `handleReviews(request, env, userId)`, `handleGBPProfile(request, env)` from `../../routes/local-seo`
  - `handleGSCProperties(env, userId)` from `../../gsc/oauth`; `handleGSCData(request, env, userId)`, `handleGSCQueries(request, env, userId)` from `../../gsc/sync`
- Produces: `rankTracking`, `aiVisibility`, `localReviews`, `searchConsole` (`ToolDef`) and `ALL_TOOLS: ToolDef[]` (twelve entries, in the order of the spec table).

These handlers already enforce ownership (404 `Project not found` and similar) and DB-only handlers cost nothing, so the tools mostly pass results through `compact`.

- [ ] **Step 1: Write the failing test**

Create `src/mcp/tools/stored.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

vi.mock('../../routes/rank-tracking', () => ({
  handleListProjects: vi.fn(async (_env: unknown, userId: string) => json([
    { id: 'p1', user_id: userId, name: 'Main site', domain: 'me.com', project_type: 'organic', location_code: 2840, keyword_count: 12, ranking_keywords: 9, avg_position: 8.4, last_checked_at: '2026-09-05', secret_col: 'hidden in concise' },
  ])),
  handleListKeywords: vi.fn(async (_env: unknown, _userId: string, projectId: string) =>
    projectId === 'p1'
      ? json([{ id: 'k1', keyword: 'seo tools', position: 4, prev_position: 6, rank_group: 4, estimated_traffic: 30, checked_at: '2026-09-05', target_url: 'https://me.com/' }])
      : json({ error: 'Project not found' }, 404)),
  handleKeywordHistory: vi.fn(async () => json({ keyword: { id: 'k1', keyword: 'seo tools' }, history: [{ position: 4, checked_at: '2026-09-05' }, { position: 6, checked_at: '2026-09-03' }] })),
}));
vi.mock('../../routes/ai-tracking', () => ({
  handleGetAITracking: vi.fn(async () => json({ queries: [{ id: 'q1', query_text: 'best seo tool', engines: { chatgpt: { status: 'cited' } } }] })),
  handleAIReport: vi.fn(async (req: Request) => json({ period: Number(new URL(req.url).searchParams.get('period')), trend: [{ date: '2026-09-01', engine: 'chatgpt', total: 10, cited: 3, score: 30 }], share_of_voice: [{ domain: 'me.com', is_you: true, count: 3 }] })),
}));
vi.mock('../../routes/local-seo', () => ({
  handleReviews: vi.fn(async (req: Request) => {
    const b = await req.json() as any;
    return json({ items: [{ rating: 5, review_text: '<b>Great</b>', timestamp: '2026-08-01' }], depth: b.depth, project_id: b.project_id ?? null });
  }),
  handleGBPProfile: vi.fn(async () => json({ title: 'Acme Plumbing', rating: { value: 4.7, votes_count: 88 }, category: 'Plumber' })),
}));
vi.mock('../../gsc/oauth', () => ({
  handleGSCProperties: vi.fn(async () => json({ connected: true, properties: [{ id: 'gp1', site_url: 'sc-domain:me.com', kind: 'google', last_synced_at: '2026-09-06' }] })),
}));
vi.mock('../../gsc/sync', () => ({
  handleGSCData: vi.fn(async (req: Request) => json({ property_id: new URL(req.url).searchParams.get('property_id'), totals: { clicks: 100, impressions: 5000 } })),
  handleGSCQueries: vi.fn(async (req: Request) => {
    const u = new URL(req.url);
    return json({ queries: [{ query: u.searchParams.get('search') ?? 'any', clicks: 5 }], limit: Number(u.searchParams.get('limit')) });
  }),
}));

import { rankTracking, aiVisibility, localReviews, searchConsole } from './stored';
import { ALL_TOOLS } from './registry';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

describe('datawise_rank_tracking', () => {
  it('list_projects returns the spreadsheet fields in concise mode and everything in detailed', async () => {
    const { env } = makeMcpTestEnv();
    const c = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'list_projects' }), { env, identity });
    expect((c.structuredContent as any).projects[0]).toEqual({ id: 'p1', name: 'Main site', domain: 'me.com', project_type: 'organic', location_code: 2840, keyword_count: 12, ranking_keywords: 9, avg_position: 8.4, last_checked_at: '2026-09-05' });
    const d = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'list_projects', response_format: 'detailed' }), { env, identity });
    expect((d.structuredContent as any).projects[0].secret_col).toBe('hidden in concise');
    expect((d.structuredContent as any).projects[0].user_id).toBeUndefined();
  });

  it('project_keywords requires project_id and surfaces not-found as a tool error', async () => {
    const { env } = makeMcpTestEnv();
    expect(() => rankTracking.inputSchema.parse({ action: 'project_keywords' })).toThrow();
    const ok = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'project_keywords', project_id: 'p1' }), { env, identity });
    expect((ok.structuredContent as any).keywords[0]).toEqual({ id: 'k1', keyword: 'seo tools', position: 4, prev_position: 6, estimated_traffic: 30, checked_at: '2026-09-05', target_url: 'https://me.com/' });
    const missing = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'project_keywords', project_id: 'nope' }), { env, identity });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('Project not found');
  });

  it('keyword_history', async () => {
    const { env } = makeMcpTestEnv();
    const out = await rankTracking.run(rankTracking.inputSchema.parse({ action: 'keyword_history', keyword_id: 'k1' }), { env, identity });
    expect((out.structuredContent as any).history).toHaveLength(2);
  });
});

describe('datawise_ai_visibility', () => {
  it('returns the report and, on request, the tracked queries', async () => {
    const { env } = makeMcpTestEnv();
    const r = await aiVisibility.run(aiVisibility.inputSchema.parse({ project_id: 'p1', period: 30 }), { env, identity });
    const s = r.structuredContent as any;
    expect(s.period).toBe(30);
    expect(s.trend[0].score).toBe(30);
    expect(s.queries).toBeUndefined();
    const q = await aiVisibility.run(aiVisibility.inputSchema.parse({ project_id: 'p1', include_queries: true }), { env, identity });
    expect((q.structuredContent as any).queries[0].query_text).toBe('best seo tool');
  });
});

describe('datawise_local_reviews', () => {
  it('needs place_id or business_name, returns profile plus sanitized reviews', async () => {
    const { env } = makeMcpTestEnv();
    expect(() => localReviews.inputSchema.parse({})).toThrow();
    const out = await localReviews.run(localReviews.inputSchema.parse({ place_id: 'ChIJ123', limit: 40, project_id: 'p9' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.profile).toEqual({ title: 'Acme Plumbing', rating: { value: 4.7, votes_count: 88 }, category: 'Plumber' });
    expect(s.reviews.items[0].review_text).toBe('Great');
    expect(s.reviews.depth).toBe(40);
    expect(s.reviews.project_id).toBe('p9');
  });
});

describe('datawise_search_console', () => {
  it('list_properties, overview and queries', async () => {
    const { env } = makeMcpTestEnv();
    const props = await searchConsole.run(searchConsole.inputSchema.parse({ action: 'list_properties' }), { env, identity });
    expect((props.structuredContent as any).properties[0].site_url).toBe('sc-domain:me.com');
    expect(() => searchConsole.inputSchema.parse({ action: 'overview' })).toThrow();
    const ov = await searchConsole.run(searchConsole.inputSchema.parse({ action: 'overview', property_id: 'gp1' }), { env, identity });
    expect((ov.structuredContent as any).overview.totals.clicks).toBe(100);
    const qs = await searchConsole.run(searchConsole.inputSchema.parse({ action: 'queries', property_id: 'gp1', search: 'plumber', limit: 50 }), { env, identity });
    expect((qs.structuredContent as any).queries.queries[0].query).toBe('plumber');
    expect((qs.structuredContent as any).queries.limit).toBe(50);
  });
});

describe('registry', () => {
  it('exposes twelve uniquely named datawise_ tools', () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
    for (const n of names) expect(n.startsWith('datawise_')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/tools/stored.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Create `src/mcp/tools/stored.ts`**

```ts
import { z } from 'zod';
import { defineTool, localeInputs, shapeFor } from './types';
import { callJson, readJson, HandlerError } from '../call-handler';
import { asWorkerEnv } from '../env';
import { toolResult, toolError, compact } from '../shape';
import { handleListProjects, handleListKeywords, handleKeywordHistory } from '../../routes/rank-tracking';
import { handleGetAITracking, handleAIReport } from '../../routes/ai-tracking';
import { handleReviews, handleGBPProfile } from '../../routes/local-seo';
import { handleGSCProperties } from '../../gsc/oauth';
import { handleGSCData, handleGSCQueries } from '../../gsc/sync';

const responseFormat = localeInputs.response_format;

function pick<T extends Record<string, unknown>>(row: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  return out;
}

// Turns a handler's 404 / 400 into an isError result the model can act on
// instead of an exception the gate reports as an internal error.
async function guarded(run: () => Promise<ReturnType<typeof toolResult>>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof HandlerError && err.status < 500) return toolError(err.message);
    throw err;
  }
}

function getRequest(path: string, params: Record<string, string | number | undefined>): Request {
  const url = new URL(`https://mcp.internal${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  return new Request(url.toString(), { method: 'GET' });
}

const PROJECT_FIELDS = ['id', 'name', 'domain', 'project_type', 'location_code', 'language_code', 'keyword_count', 'ranking_keywords', 'avg_position', 'last_checked_at'];
const KEYWORD_FIELDS = ['id', 'keyword', 'position', 'prev_position', 'estimated_traffic', 'checked_at', 'target_url', 'location_code'];

export const rankTracking = defineTool({
  name: 'datawise_rank_tracking',
  description:
    'Use this to read the member\'s own DataWise rank tracking data (no DataForSEO cost). action=list_projects lists tracked projects with keyword counts and average position; action=project_keywords lists a project\'s keywords with current and previous position; action=keyword_history returns the last 30 checks for one keyword. ' +
    'Use response_format=detailed on list_projects to see every project column, including any place id for local projects. Do not use to research new keywords.',
  inputSchema: z.object({
    action: z.enum(['list_projects', 'project_keywords', 'keyword_history']),
    project_id: z.string().min(1).optional().describe('Required for project_keywords. From list_projects.'),
    keyword_id: z.string().min(1).optional().describe('Required for keyword_history. From project_keywords.'),
    response_format: responseFormat,
  }).refine((a) => a.action !== 'project_keywords' || a.project_id, { message: 'project_id is required for project_keywords' })
    .refine((a) => a.action !== 'keyword_history' || a.keyword_id, { message: 'keyword_id is required for keyword_history' }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);
    return guarded(async () => {
      if (args.action === 'list_projects') {
        const rows = await readJson<any[]>(await handleListProjects(env, uid));
        const projects = rows.map((r) => (args.response_format === 'detailed' ? compact(r, shape) : pick(r, PROJECT_FIELDS)));
        return toolResult({ projects }, `${projects.length} rank tracking projects.`);
      }
      if (args.action === 'project_keywords') {
        const rows = await readJson<any[]>(await handleListKeywords(env, uid, args.project_id!));
        const keywords = rows.map((r) => (args.response_format === 'detailed' ? compact(r, shape) : pick(r, KEYWORD_FIELDS)));
        return toolResult({ project_id: args.project_id, keywords }, `${keywords.length} tracked keywords in project ${args.project_id}.`);
      }
      const data = await readJson<any>(await handleKeywordHistory(env, uid, args.keyword_id!));
      const history = compact(data.history ?? [], shape);
      return toolResult({ keyword: data.keyword, history: history as Record<string, unknown>[] }, `${(history as unknown[]).length} checks for "${data.keyword?.keyword}".`);
    });
  },
});

export const aiVisibility = defineTool({
  name: 'datawise_ai_visibility',
  description:
    'Use this to read the member\'s AI Visibility tracker for a rank tracking project (no DataForSEO cost): a per-engine trend of how many tracked queries cited or mentioned the site, share of voice by domain, and optionally the tracked queries with their latest result per engine. ' +
    'Do not use for live AI mention counts on arbitrary domains (datawise_ai_mentions).',
  inputSchema: z.object({
    project_id: z.string().min(1).describe('From datawise_rank_tracking list_projects.'),
    period: z.number().int().min(7).max(365).default(90).describe('Days of history for the trend.'),
    include_queries: z.boolean().default(false),
    response_format: responseFormat,
  }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);
    return guarded(async () => {
      const report = await readJson<any>(await handleAIReport(getRequest('/report', { period: args.period }), env, uid, args.project_id));
      const out: Record<string, unknown> = {
        project_id: args.project_id,
        period: report.period ?? args.period,
        trend: compact(report.trend ?? [], shape),
        share_of_voice: compact(report.share_of_voice ?? [], shape),
      };
      if (args.include_queries) {
        const tracking = await readJson<any>(await handleGetAITracking(env, uid, args.project_id));
        out.queries = compact(tracking.queries ?? tracking, shape);
      }
      return toolResult(out, `AI visibility for project ${args.project_id} over ${out.period} days.`);
    });
  },
});

export const localReviews = defineTool({
  name: 'datawise_local_reviews',
  description:
    'Use this for a Google Business Profile: the profile summary (name, rating, category) and its most recent reviews with text. Identify the business by place_id (preferred) or business_name. Pass project_id for a DataWise local project to also get 30/60-day rating trends. ' +
    'Reviews are cached for an hour. Do not use for organic keywords.',
  inputSchema: z.object({
    place_id: z.string().min(1).optional().describe('Google place id, e.g. ChIJ...'),
    business_name: z.string().min(1).max(200).optional().describe('Business name plus city if no place_id, e.g. "Acme Plumbing Austin".'),
    project_id: z.string().min(1).optional().describe('DataWise local project id, for trend tiles.'),
    limit: z.number().int().min(1).max(100).default(20).describe('Reviews to fetch (newest first).'),
    ...localeInputs,
  }).refine((a) => a.place_id || a.business_name, { message: 'place_id or business_name is required' }),
  async run(args, ctx) {
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);
    const ident = args.place_id ? { place_id: args.place_id } : { business_name: args.business_name };
    const locale = { location_code: args.location_code ?? ctx.identity.defaultLocationCode, language_code: args.language_code ?? ctx.identity.defaultLanguageCode };
    return guarded(async () => {
      const [profile, reviews] = await Promise.all([
        callJson(ctx.env, uid, handleGBPProfile, { ...ident, ...locale }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) })),
        callJson(ctx.env, uid, handleReviews, { ...ident, ...locale, project_id: args.project_id, depth: args.limit, sort_by: 'newest' }),
      ]);
      return toolResult(
        { ...ident, profile: compact(profile, shape) as Record<string, unknown>, reviews: compact(reviews, shape) as Record<string, unknown> },
        `Profile and up to ${args.limit} reviews for ${args.place_id ?? args.business_name}.`,
      );
    });
  },
});

export const searchConsole = defineTool({
  name: 'datawise_search_console',
  description:
    'Use this to read the member\'s connected Google Search Console data stored in DataWise (no DataForSEO cost). action=list_properties shows connected properties and their ids; action=overview returns the dashboard totals and trends for a property; action=queries lists queries with clicks, impressions, CTR and position, optionally filtered by a search string. ' +
    'Do not use for competitors or third-party domains.',
  inputSchema: z.object({
    action: z.enum(['list_properties', 'overview', 'queries']),
    property_id: z.string().min(1).optional().describe('Required for overview and queries. From list_properties.'),
    range: z.string().max(10).optional().describe('Date range token accepted by the DataWise dashboard, e.g. 28d or 3m. Omit for the default.'),
    search: z.string().max(200).optional().describe('queries only: keep queries containing this text.'),
    sort: z.enum(['clicks', 'impressions', 'ctr', 'position']).default('clicks'),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
    response_format: responseFormat,
  }).refine((a) => a.action === 'list_properties' || a.property_id, { message: 'property_id is required for overview and queries' }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);
    return guarded(async () => {
      if (args.action === 'list_properties') {
        const data = await readJson<any>(await handleGSCProperties(env, uid));
        const properties = (data.properties ?? []).map((p: any) => pick(p, ['id', 'site_url', 'kind', 'last_synced_at', 'is_enabled', 'data_missing']));
        return toolResult({ connected: Boolean(data.connected), needs_reconnect: Boolean(data.needs_reconnect), properties }, `${properties.length} Search Console properties.`);
      }
      if (args.action === 'overview') {
        const data = await readJson<any>(await handleGSCData(getRequest('/gsc/data', { property_id: args.property_id, range: args.range }), env, uid));
        return toolResult({ property_id: args.property_id, range: args.range ?? 'default', overview: compact(data, shape) as Record<string, unknown> }, `Search Console overview for property ${args.property_id}.`);
      }
      const data = await readJson<any>(await handleGSCQueries(
        getRequest('/gsc/queries', { property_id: args.property_id, search: args.search, sort: args.sort, order: 'desc', limit: args.limit, offset: args.offset }), env, uid));
      return toolResult({ property_id: args.property_id, queries: compact(data, { ...shape, maxArray: args.limit }) as Record<string, unknown> }, `Search Console queries for property ${args.property_id}.`);
    });
  },
});
```

- [ ] **Step 4: Create `src/mcp/tools/registry.ts`**

```ts
import type { ToolDef } from './types';
import { keywordResearch, keywordMetrics } from './keywords';
import { domainOverview, rankedKeywords, competitors, keywordGap } from './domains';
import { backlinks } from './backlinks';
import { aiMentions } from './ai-mentions';
import { rankTracking, aiVisibility, localReviews, searchConsole } from './stored';

// Order is deliberate and stable: clients cache tools/list by position and
// prompt caches key on it (spec section 5).
export const ALL_TOOLS: ToolDef[] = [
  keywordResearch,
  keywordMetrics,
  domainOverview,
  rankedKeywords,
  competitors,
  keywordGap,
  backlinks,
  aiMentions,
  rankTracking,
  aiVisibility,
  localReviews,
  searchConsole,
];
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/mcp/tools/stored.test.ts && npx tsc --noEmit`
Expected: PASS (8 tests). If `tsc` complains that a `.refine()`d schema is not a `ZodObject`, widen `ToolDef`'s constraint in `types.ts` from `z.ZodObject<any>` to `z.ZodType<any>` and keep `inputSchema` as declared; Task 13 handles both cases.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/stored.ts src/mcp/tools/stored.test.ts src/mcp/tools/registry.ts
git commit -m "feat(mcp): rank tracking, AI visibility, local reviews, Search Console tools and registry"
```

---

### Task 13: Gate, MCP server, worker entry, and local smoke test

**Files:**
- Create: `datawise-seo-insight-main/workers/src/mcp/gate.ts`
- Create: `datawise-seo-insight-main/workers/src/mcp/server.ts`
- Create: `datawise-seo-insight-main/workers/src/mcp/index.ts`
- Create: `datawise-seo-insight-main/workers/wrangler.mcp.toml`
- Test: `datawise-seo-insight-main/workers/src/mcp/gate.test.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/index.test.ts`

**Interfaces:**
- Consumes: `checkAccess`, `denialMessage`, `loadIdentity` (Task 6); `checkRateLimit`, `estimateCostUsd`, `checkBudget`, `budgetMessage`, `recordUsage` (Task 7); `toolError`, `ToolResult` (Task 8); `HandlerError` (Task 8); `DataForSeoQuotaError`, `DfsMeter` (Task 3); `ALL_TOOLS` (Task 12); `validateApiToken`, `TOKEN_PREFIX` (Task 5); `handleAccountRequest` (Task 14, stubbed here and replaced there).
- Produces:
  ```ts
  // gate.ts
  export async function runGated(tool: ToolDef, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult>
  // server.ts
  export const SERVER_INFO = { name: 'datawise', version: '1.0.0' };
  export function createDataWiseServer(ctx: ToolContext): McpServer
  export function allowedHostnames(env: McpEnv): string[]
  export function handleMcpRequest(request: Request, env: McpEnv, execCtx: ExecutionContext, identity: McpIdentity): Promise<Response>
  // index.ts
  export default { fetch, scheduled }
  ```

- [ ] **Step 1: Write the failing gate test**

Create `src/mcp/gate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/gate.test.ts`
Expected: FAIL, cannot resolve `./gate`.

- [ ] **Step 3: Create `src/mcp/gate.ts`**

```ts
import type { ToolDef, ToolContext } from './tools/types';
import { checkAccess, denialMessage } from './access';
import { checkRateLimit, estimateCostUsd, checkBudget, budgetMessage, recordUsage } from './budget';
import { toolError, type ToolResult } from './shape';
import { DataForSeoQuotaError, type DfsMeter } from '../dataforseo/client';
import { HandlerError } from './call-handler';

const RATE_MESSAGE = 'Rate limit: 30 tool calls per minute per account. Wait a moment and retry.';
const QUOTA_MESSAGE = 'DataForSEO daily quota is exhausted for today, so live data tools are unavailable until 00:00 UTC. Rank tracking, AI visibility and Search Console tools still work.';

// Spec 6.2 gate order: kill switch, membership, allowlist (all in checkAccess),
// per-minute rate, input validation, budget pre-check, run, ledger.
export async function runGated(tool: ToolDef, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { env, identity } = ctx;

  const denial = await checkAccess(env, identity);
  if (denial) return toolError(denialMessage(denial));
  if (!(await checkRateLimit(env, identity.userId))) return toolError(RATE_MESSAGE);

  const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return toolError(`Invalid input for ${tool.name}: ${issues}`);
  }
  const args = parsed.data as Record<string, unknown>;

  const budget = await checkBudget(env, identity, estimateCostUsd(tool.name, args));
  if (!budget.ok) return toolError(budgetMessage(budget));

  const meter: DfsMeter = { costUsd: 0, liveCalls: 0, cacheHits: 0 };
  const meteredEnv = { ...env, dfsMeter: meter };
  const started = Date.now();
  let result: ToolResult;
  let ok = true;
  try {
    result = await tool.run(args, { env: meteredEnv, identity });
    ok = !result.isError;
  } catch (err) {
    ok = false;
    if (err instanceof DataForSeoQuotaError) {
      result = toolError(QUOTA_MESSAGE);
    } else if (err instanceof HandlerError) {
      result = toolError(err.message);
    } else {
      console.error(`[mcp] ${tool.name} failed for user ${identity.userId}:`, err);
      result = toolError(`${tool.name} failed unexpectedly. Try again in a minute; if it keeps failing, report it from DataWise Settings.`);
    }
  }

  try {
    await recordUsage(env, {
      userId: identity.userId,
      tool: tool.name,
      costUsd: meter.costUsd,
      cached: meter.liveCalls === 0 && meter.cacheHits > 0,
      ok,
      durationMs: Date.now() - started,
      authKind: identity.authKind,
      clientName: identity.tokenName,
    });
  } catch (err) {
    console.error('[mcp] recordUsage failed:', err);
  }
  return result;
}
```

- [ ] **Step 4: Run the gate test**

Run: `npx vitest run src/mcp/gate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create `src/mcp/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import type { McpEnv, McpIdentity } from './env';
import type { ToolContext } from './tools/types';
import { ALL_TOOLS } from './tools/registry';
import { runGated } from './gate';

export const SERVER_INFO = { name: 'datawise', version: '1.0.0' };

// Every stage 1 tool is a read (spec section 5). ChatGPT and Claude skip the
// per-call confirmation prompt only when readOnlyHint is true.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function createDataWiseServer(ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO);
  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: READ_ONLY },
      async (args: unknown) => runGated(tool, args, ctx),
    );
  }
  return server;
}

export function allowedHostnames(env: McpEnv): string[] {
  const publicHost = new URL(env.MCP_PUBLIC_URL).hostname;
  return [publicHost, 'datawise-mcp.nico-510.workers.dev', 'localhost', '127.0.0.1'];
}

export function handleMcpRequest(request: Request, env: McpEnv, execCtx: ExecutionContext, identity: McpIdentity): Promise<Response> {
  // A fresh stateless server per request; identity is closed over, so tools
  // never need to read the bearer token or the auth context.
  const handler = createMcpHandler(() => createDataWiseServer({ env, identity }), {
    route: '/mcp',
    legacy: 'stateless',
    allowedHostnames: allowedHostnames(env),
    onerror: (error: Error) => console.error('[mcp] protocol error:', error.message),
  });
  return handler(request, env as unknown as Record<string, unknown>, execCtx);
}
```

If `tsc` rejects `inputSchema: tool.inputSchema` because `registerTool` wants a raw zod shape, pass `tool.inputSchema.shape` instead (zod 4 keeps `.shape` on refined objects). If it rejects the `createMcpHandler` return call signature, read `node_modules/agents/dist/mcp/server.d.ts` and match the exported type; the doc example is `createMcpHandler(createServer)(request, env, ctx)`.

- [ ] **Step 6: Write the failing worker-entry test**

Create `src/mcp/index.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv, seedUser } from './test-support';
import { createApiToken } from './tokens';

vi.mock('./server', () => ({
  handleMcpRequest: vi.fn(async (_req: Request, _env: unknown, _ctx: unknown, identity: any) => new Response(JSON.stringify({ mcp: true, email: identity.email }))),
}));
vi.mock('./account', () => ({
  handleAccountRequest: vi.fn(async () => new Response('account')),
}));

import worker from './index';
import { handleMcpRequest } from './server';

const ctx = {} as ExecutionContext;

describe('datawise-mcp worker', () => {
  it('health', async () => {
    const { env } = makeMcpTestEnv();
    const res = await worker.fetch(new Request('https://mcp.test/health'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'datawise-mcp' });
  });

  it('401 with WWW-Authenticate when the bearer is missing, malformed, or unknown', async () => {
    const { env } = makeMcpTestEnv();
    for (const headers of [{}, { Authorization: 'Bearer nope' }, { Authorization: 'Bearer dwmcp_' + 'a'.repeat(40) }]) {
      const res = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers }), env, ctx);
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    }
    expect(handleMcpRequest).not.toHaveBeenCalled();
  });

  it('routes a valid token to the MCP handler with the loaded identity', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { email: 'm@test.dev' });
    const { token } = await createApiToken(env, userId, 'cli');
    const res = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    expect(await res.json()).toEqual({ mcp: true, email: 'm@test.dev' });
  });

  it('rejects a valid token whose user is banned', async () => {
    const { env } = makeMcpTestEnv();
    const userId = await seedUser(env, { banned: 1 });
    const { token } = await createApiToken(env, userId, 'cli');
    const res = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }), env, ctx);
    expect(res.status).toBe(401);
  });

  it('delegates /account/* and 404s everything else', async () => {
    const { env } = makeMcpTestEnv();
    expect(await (await worker.fetch(new Request('https://mcp.test/account/tokens'), env, ctx)).text()).toBe('account');
    expect((await worker.fetch(new Request('https://mcp.test/nope'), env, ctx)).status).toBe(404);
  });

  it('scheduled purge deletes mcp_calls older than 30 days', async () => {
    const { env, raw } = makeMcpTestEnv();
    raw.prepare("INSERT INTO mcp_calls (user_id, tool, auth_kind, created_at) VALUES ('u','t','api_token', datetime('now','-31 days')), ('u','t','api_token', datetime('now'))").run();
    await worker.scheduled({} as ScheduledEvent, env, ctx);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM mcp_calls').get() as any).n).toBe(1);
  });
});
```

- [ ] **Step 7: Create `src/mcp/index.ts`**

```ts
import type { McpEnv } from './env';
import { validateApiToken, TOKEN_PREFIX } from './tokens';
import { loadIdentity } from './access';
import { handleMcpRequest } from './server';
import { handleAccountRequest } from './account';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// Stage 1 challenge: no resource_metadata yet because there is no
// authorization server to point at. Stage 2 adds it (spec 4.3).
function unauthorized(message: string): Response {
  const safe = message.replace(/"/g, "'");
  return json({ error: 'unauthorized', message }, 401, {
    'WWW-Authenticate': `Bearer realm="DataWise MCP", error="invalid_token", error_description="${safe}"`,
  });
}

export default {
  async fetch(request: Request, env: McpEnv, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === '/health') return json({ ok: true, service: 'datawise-mcp' });
    if (path.startsWith('/account/')) return handleAccountRequest(request, env);

    if (path === '/mcp' || path === '/mcp/') {
      const bearer = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      if (!bearer) return unauthorized('Missing bearer token. Create one in DataWise Settings under MCP & AI assistants.');
      if (!bearer.startsWith(TOKEN_PREFIX)) return unauthorized('Unrecognised token format.');
      const token = await validateApiToken(env, bearer);
      if (!token) return unauthorized('Token is invalid, revoked, or expired.');
      const identity = await loadIdentity(env, token, 'api_token');
      if (!identity) return unauthorized('Account not found or disabled.');
      return handleMcpRequest(request, env, ctx, identity);
    }

    return json({ error: 'not_found' }, 404);
  },

  // Daily at 03:00 UTC (wrangler.mcp.toml). Keeps mcp_calls bounded; D1 is
  // the constrained resource (memory project_d1_full_incident_2026-06-25).
  async scheduled(_event: ScheduledEvent, env: McpEnv, _ctx: ExecutionContext): Promise<void> {
    const { meta } = await env.DB.prepare("DELETE FROM mcp_calls WHERE created_at < datetime('now', '-30 days')").run();
    console.log(`[mcp] purged ${meta.changes} mcp_calls rows older than 30 days`);
  },
};
```

Create a temporary `src/mcp/account.ts` so the entry compiles until Task 14 replaces it:

```ts
import type { McpEnv } from './env';
export async function handleAccountRequest(_request: Request, _env: McpEnv): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not_implemented' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}
```

- [ ] **Step 8: Run the entry test and typecheck**

Run: `npx vitest run src/mcp/index.test.ts && npx tsc --noEmit`
Expected: PASS (6 tests), no type errors. Fix `server.ts` per the notes in Step 5 if `tsc` objects there.

- [ ] **Step 9: Create `wrangler.mcp.toml`**

```toml
# datawise-mcp: the MCP server for ChatGPT / Claude. Separate worker from
# datawise-api on purpose (spec 3.1). Deploy ONLY with `npm run deploy:mcp`.
name = "datawise-mcp"
main = "src/mcp/index.ts"
compatibility_date = "2026-07-02"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

# Daily purge of mcp_calls older than 30 days (src/mcp/index.ts scheduled()).
[triggers]
crons = ["0 3 * * *"]

[vars]
FRONTEND_URL = "https://datawiseseo.com"
ADMIN_EMAILS = "nico@airankingskool.com"
MCP_PUBLIC_URL = "https://mcp.datawiseseo.com"
# Secrets (set in the Cloudflare dashboard, see memory feedback_cloudflare_secrets_dashboard):
# DATAFORSEO_EMAIL, DATAFORSEO_PASSWORD, ENCRYPTION_KEY

# Same database and KV namespace as datawise-api: sessions and users live
# there, and the dataforseo:* cache must be shared so MCP calls hit it.
[[d1_databases]]
binding = "DB"
database_name = "datawise-db"
database_id = "b9355723-e02c-4877-8dce-c57cc1965068"

[[kv_namespaces]]
binding = "KV"
id = "2302e0b0369842e799b5f4a144d6dce4"
preview_id = "30288cb442c84e038406b0e174f90398"

# Custom domain on the datawiseseo.com zone. Wrangler creates the DNS record
# on first deploy. The workers.dev URL keeps working but is never advertised.
[[routes]]
pattern = "mcp.datawiseseo.com"
custom_domain = true
```

- [ ] **Step 10: Local smoke test with MCP Inspector**

Apply the schema to the local D1 and seed a member with a token:

```bash
npx wrangler d1 execute datawise-db --local -c wrangler.mcp.toml --file=src/db/schema.sql
TOKEN="dwmcp_$(openssl rand -base64 60 | tr -dc 'A-Za-z0-9' | head -c 40)"
HASH=$(printf '%s' "$TOKEN" | shasum -a 256 | cut -d' ' -f1)
npx wrangler d1 execute datawise-db --local -c wrangler.mcp.toml --command \
  "INSERT OR IGNORE INTO users (id, email, subscription_tier, is_community_member) VALUES ('dev1', 'dev@test.dev', 'community', 1);
   INSERT INTO api_tokens (id, user_id, name, token_hash, token_suffix) VALUES ('tok1', 'dev1', 'inspector', '$HASH', '${TOKEN: -4}');"
echo "$TOKEN"
```

Optional: create `.dev.vars` with `DATAFORSEO_EMAIL=...` and `DATAFORSEO_PASSWORD=...` (confirm `git check-ignore .dev.vars` prints the path before creating it) to exercise live tools locally. Without it, only the stored-data tools succeed locally, which is enough for this step.

Run the worker: `npm run dev:mcp` (port 8788). In another terminal: `npx @modelcontextprotocol/inspector@latest`, open `http://localhost:5173`, choose transport Streamable HTTP, URL `http://localhost:8788/mcp`, add header `Authorization: Bearer <TOKEN>`, Connect.

Verify:
- `tools/list` shows exactly 12 tools, each with `readOnlyHint: true`.
- `datawise_rank_tracking` with `{"action":"list_projects"}` returns `{"projects":[]}` (no error).
- `datawise_keyword_research` with `{"keyword":"seo"}` returns rows if `.dev.vars` is set, otherwise an `isError` result mentioning DataForSEO, never a 500.
- Remove the header and Connect again: the Inspector reports 401.
- `curl -s http://localhost:8788/health` returns `{"ok":true,"service":"datawise-mcp"}`.

Record the observed `tools/list` count in the commit message.

- [ ] **Step 11: Commit**

```bash
git add src/mcp/gate.ts src/mcp/gate.test.ts src/mcp/server.ts src/mcp/index.ts src/mcp/index.test.ts src/mcp/account.ts wrangler.mcp.toml
git commit -m "feat(mcp): gated MCP server, worker entry, wrangler config (12 tools listed in Inspector)"
```

---

### Task 14: Account routes for the Settings card

**Files:**
- Replace: `datawise-seo-insight-main/workers/src/mcp/account.ts`
- Test: `datawise-seo-insight-main/workers/src/mcp/account.test.ts`

**Interfaces:**
- Consumes: `authMiddleware` from `../middleware/auth` (returns `AuthUser | null`); `isAllowedFrontendOrigin` from `../auth/origins`; `createApiToken`, `listApiTokens`, `revokeApiToken`, `TokenLimitError` (Task 5); `loadIdentity`, `checkAccess` (Task 6); `readSpent`, `readCaps`, `utcDay` (Task 7); `asWorkerEnv` (Task 4).
- Produces `handleAccountRequest(request, env): Promise<Response>` serving, all with the DataWise session Bearer:
  - `OPTIONS /account/*` : CORS preflight
  - `GET /account/tokens` : `{ tokens: ApiTokenRow[] }`
  - `POST /account/tokens` `{ name }` : `201 { id, name, token, token_suffix, created_at }` (the only time `token` is returned); `409 { error: 'token_limit', message }`
  - `DELETE /account/tokens/:id` : `{ ok: true }` or `404`
  - `GET /account/usage` : `{ access: boolean, denial: 'paused' | 'not_member' | 'early_access' | null, day, spent_usd, cap_usd, calls, resets_at, mcp_url, max_tokens }`

- [ ] **Step 1: Write the failing test**

Create `src/mcp/account.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mcp/account.test.ts`
Expected: FAIL (the stub returns 501 everywhere).

- [ ] **Step 3: Replace `src/mcp/account.ts`**

```ts
import type { McpEnv } from './env';
import { asWorkerEnv } from './env';
import { authMiddleware } from '../middleware/auth';
import { isAllowedFrontendOrigin } from '../auth/origins';
import { createApiToken, listApiTokens, revokeApiToken, TokenLimitError, MAX_ACTIVE_TOKENS } from './tokens';
import { loadIdentity, checkAccess } from './access';
import { readSpent, readCaps, utcDay } from './budget';

function corsHeaders(request: Request, env: McpEnv): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  if (!isAllowedFrontendOrigin(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function nextUtcMidnight(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

export async function handleAccountRequest(request: Request, env: McpEnv): Promise<Response> {
  const cors = corsHeaders(request, env);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const user = await authMiddleware(request, asWorkerEnv(env));
  if (!user) return json({ error: 'unauthorized' }, 401);

  const path = new URL(request.url).pathname;
  const tokenMatch = path.match(/^\/account\/tokens\/([A-Za-z0-9_-]+)$/);

  if (path === '/account/tokens' && request.method === 'GET') {
    return json({ tokens: await listApiTokens(env, user.id) });
  }

  if (path === '/account/tokens' && request.method === 'POST') {
    let body: { name?: unknown } = {};
    try { body = await request.json() as { name?: unknown }; } catch { body = {}; }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return json({ error: 'invalid_name', message: 'Give the token a name, e.g. "Claude Code laptop".' }, 400);
    try {
      const created = await createApiToken(env, user.id, name);
      return json(created, 201);
    } catch (err) {
      if (err instanceof TokenLimitError) return json({ error: 'token_limit', message: err.message }, 409);
      throw err;
    }
  }

  if (tokenMatch && request.method === 'DELETE') {
    const revoked = await revokeApiToken(env, user.id, tokenMatch[1]);
    return revoked ? json({ ok: true }) : json({ error: 'not_found' }, 404);
  }

  if (path === '/account/usage' && request.method === 'GET') {
    const identity = await loadIdentity(env, { userId: user.id, tokenId: '', tokenName: 'settings' });
    if (!identity) return json({ error: 'unauthorized' }, 401);
    const day = utcDay();
    const [denial, spent, caps] = await Promise.all([checkAccess(env, identity), readSpent(env, user.id, day), readCaps(env)]);
    return json({
      access: denial === null,
      denial,
      day,
      spent_usd: spent.costUsd,
      cap_usd: identity.isAdmin ? null : caps.userCapUsd,
      calls: spent.calls,
      resets_at: nextUtcMidnight(),
      mcp_url: `${env.MCP_PUBLIC_URL}/mcp`,
      max_tokens: MAX_ACTIVE_TOKENS,
    });
  }

  return json({ error: 'not_found' }, 404);
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/mcp && npx tsc --noEmit`
Expected: every `src/mcp` test file passes.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/account.ts src/mcp/account.test.ts
git commit -m "feat(mcp): account routes for tokens and usage"
```

---

### Task 15: Settings card in the SPA

All commands in this task run from `datawise-seo-insight-main/` (the SPA root), not `workers/`.

**Files:**
- Create: `datawise-seo-insight-main/src/lib/mcp.ts`
- Create: `datawise-seo-insight-main/src/components/settings/McpAccessCard.tsx`
- Modify: `datawise-seo-insight-main/src/pages/SettingsPage.tsx` (import at top; mount before the `{/* Promo Code */}` comment near line 1068)
- Modify: `datawise-seo-insight-main/.env` (add `VITE_MCP_URL=http://localhost:8788`)
- Modify: `.github/workflows/deploy-pages-production.yml`, `.github/workflows/deploy-pages-staging.yml`, `.github/workflows/pr-checks.yml` (add `VITE_MCP_URL: https://mcp.datawiseseo.com` under each `env:` block that already has `VITE_API_URL`)
- Modify: `datawise-seo-insight-main/scripts/deploy-pages-production.mjs` (markers plus env assertion)
- Test: `datawise-seo-insight-main/src/lib/__tests__/mcp.test.ts`

**Interfaces:**
- Consumes: `getSessionToken` from `@/lib/api`; `useAuth` from `@/contexts/AuthContext`; shadcn `Button`, `Input`, `Label`, `Badge`, `Tabs`, `Dialog`; `useToast`; Task 14 endpoints.
- Produces:
  ```ts
  export const MCP_BASE: string; export const MCP_SERVER_URL: string;
  export interface McpToken { id: string; name: string; token_suffix: string; created_at: string; last_used_at: string | null; }
  export interface McpUsage { access: boolean; denial: 'paused' | 'not_member' | 'early_access' | null; day: string; spent_usd: number; cap_usd: number | null; calls: number; resets_at: string; mcp_url: string; max_tokens: number; }
  export async function mcpApi<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>
  export function claudeCodeCommand(token: string): string
  export const MCP_TOKENS_KEY = ['mcp', 'tokens']; export const MCP_USAGE_KEY = ['mcp', 'usage'];
  export function useMcpTokens(); export function useMcpUsage();
  export function createMcpToken(name: string): Promise<McpToken & { token: string }>
  export function revokeMcpToken(id: string): Promise<void>
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/mcp.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api', () => ({ getSessionToken: () => 'sess-123' }));

import { mcpApi, claudeCodeCommand, MCP_SERVER_URL } from '@/lib/mcp';

describe('mcpApi', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('sends the session bearer, JSON body, and omits credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await mcpApi('/account/tokens', { method: 'POST', body: { name: 'x' } });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe(`${MCP_SERVER_URL.replace(/\/mcp$/, '')}/account/tokens`);
    expect(init.headers.Authorization).toBe('Bearer sess-123');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body)).toEqual({ name: 'x' });
  });

  it('throws the server message on error responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'token_limit', message: 'Revoke one first.' }), { status: 409 })));
    await expect(mcpApi('/account/tokens', { method: 'POST', body: {} })).rejects.toThrow('Revoke one first.');
  });
});

describe('claudeCodeCommand', () => {
  it('produces the documented claude mcp add command', () => {
    expect(claudeCodeCommand('dwmcp_abc')).toBe(
      `claude mcp add --transport http datawise ${MCP_SERVER_URL} --header "Authorization: Bearer dwmcp_abc"`,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/mcp.test.ts`
Expected: FAIL, cannot resolve `@/lib/mcp`.

- [ ] **Step 3: Create `src/lib/mcp.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { getSessionToken } from '@/lib/api';

// The MCP worker is a separate deployment (spec 3.1). Same rule as
// VITE_API_URL: never put a localhost override in .env.local.
export const MCP_BASE = import.meta.env.VITE_MCP_URL || 'http://localhost:8788';
export const MCP_SERVER_URL = `${MCP_BASE}/mcp`;

export interface McpToken {
  id: string;
  name: string;
  token_suffix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface McpUsage {
  access: boolean;
  denial: 'paused' | 'not_member' | 'early_access' | null;
  day: string;
  spent_usd: number;
  cap_usd: number | null;
  calls: number;
  resets_at: string;
  mcp_url: string;
  max_tokens: number;
}

interface McpApiOptions {
  method?: string;
  body?: unknown;
}

export async function mcpApi<T = unknown>(path: string, options: McpApiOptions = {}): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${MCP_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'omit',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function claudeCodeCommand(token: string): string {
  return `claude mcp add --transport http datawise ${MCP_SERVER_URL} --header "Authorization: Bearer ${token}"`;
}

export const MCP_TOKENS_KEY = ['mcp', 'tokens'] as const;
export const MCP_USAGE_KEY = ['mcp', 'usage'] as const;

export function useMcpTokens() {
  return useQuery({ queryKey: MCP_TOKENS_KEY, queryFn: () => mcpApi<{ tokens: McpToken[] }>('/account/tokens').then((r) => r.tokens) });
}

export function useMcpUsage() {
  return useQuery({ queryKey: MCP_USAGE_KEY, queryFn: () => mcpApi<McpUsage>('/account/usage'), staleTime: 30_000 });
}

export function createMcpToken(name: string): Promise<McpToken & { token: string }> {
  return mcpApi<McpToken & { token: string }>('/account/tokens', { method: 'POST', body: { name } });
}

export async function revokeMcpToken(id: string): Promise<void> {
  await mcpApi(`/account/tokens/${id}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/__tests__/mcp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `src/components/settings/McpAccessCard.tsx`**

```tsx
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plug, Loader2, Trash2, Copy, Check, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  useMcpTokens, useMcpUsage, createMcpToken, revokeMcpToken, claudeCodeCommand,
  MCP_SERVER_URL, MCP_TOKENS_KEY, MCP_USAGE_KEY, type McpUsage,
} from '@/lib/mcp';

const DENIAL_COPY: Record<NonNullable<McpUsage['denial']>, string> = {
  not_member: 'MCP access is included with AI Ranking Skool membership and DataWise Pro.',
  early_access: 'The MCP server is in early access. Your account is not on the list yet.',
  paused: 'The MCP server is paused for maintenance. Check back shortly.',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
    </Button>
  );
}

export function McpAccessCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: tokens = [], isLoading: tokensLoading } = useMcpTokens();
  const { data: usage } = useMcpUsage();

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ name: string; token: string } | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: MCP_TOKENS_KEY });
    queryClient.invalidateQueries({ queryKey: MCP_USAGE_KEY });
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const created = await createMcpToken(name.trim());
      setReveal({ name: created.name, token: created.token });
      setName('');
      refresh();
    } catch (err) {
      toast({ title: 'Could not create token', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    try {
      await revokeMcpToken(id);
      refresh();
      toast({ title: 'Token revoked' });
    } catch (err) {
      toast({ title: 'Could not revoke token', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setRevokingId(null);
    }
  };

  const atLimit = usage ? tokens.length >= usage.max_tokens : false;
  const capLabel = usage?.cap_usd == null ? 'unlimited' : `$${usage.cap_usd.toFixed(2)}`;

  return (
    <div id="mcp" className="scroll-mt-20 rounded-xl border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5" />
        <h2 className="text-lg font-semibold">MCP & AI assistants</h2>
        {usage && (usage.access
          ? <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-0">Enabled</Badge>
          : <Badge variant="secondary">Not available</Badge>)}
      </div>
      <p className="text-sm text-muted-foreground">
        Use DataWise data (keyword research, competitors, backlinks, rank tracking, AI visibility, Search Console) from Claude Code and other MCP clients. Create a personal token, paste it into your client, and the assistant can call DataWise on your behalf.
      </p>

      {usage && !usage.access && usage.denial && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{DENIAL_COPY[usage.denial]}</div>
      )}

      {usage && usage.access && (
        <p className="text-sm">
          Today: <span className="font-medium">${usage.spent_usd.toFixed(2)}</span> of {capLabel} daily data budget, {usage.calls} calls. Resets at 00:00 UTC, no rollover.
        </p>
      )}

      <div className="space-y-2">
        <Label className="flex items-center gap-1"><KeyRound className="h-4 w-4" /> Personal tokens</Label>
        {tokensLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <span className="font-medium">{t.name}</span>
                  <span className="ml-2 text-muted-foreground">dwmcp_…{t.token_suffix}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    created {new Date(t.created_at).toLocaleDateString()}{t.last_used_at ? `, last used ${new Date(t.last_used_at).toLocaleDateString()}` : ', never used'}
                  </span>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={revokingId === t.id} onClick={() => handleRevoke(t.id)} aria-label={`Revoke ${t.name}`}>
                  {revokingId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            placeholder='Token name, e.g. "Claude Code laptop"'
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); } }}
            disabled={creating || atLimit || !usage?.access}
            maxLength={60}
          />
          <Button type="button" onClick={handleCreate} disabled={creating || atLimit || !name.trim() || !usage?.access}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create token'}
          </Button>
        </div>
        {atLimit && <p className="text-xs text-muted-foreground">You have the maximum of {usage?.max_tokens} tokens. Revoke one to create another.</p>}
      </div>

      <Tabs defaultValue="claude-code">
        <TabsList>
          <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
          <TabsTrigger value="other">Other MCP clients</TabsTrigger>
        </TabsList>
        <TabsContent value="claude-code" className="space-y-2 text-sm">
          <p>Run this once in your terminal, replacing the placeholder with a token from above:</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{claudeCodeCommand('<your-token>')}</pre>
          <p className="text-muted-foreground">Then type <code>/mcp</code> in Claude Code to confirm the connection, and ask for something like "use datawise to find keyword ideas for local seo services".</p>
        </TabsContent>
        <TabsContent value="other" className="space-y-2 text-sm">
          <p>Server URL: <code>{MCP_SERVER_URL}</code> (Streamable HTTP).</p>
          <p>Send the header <code>Authorization: Bearer &lt;your-token&gt;</code>. Sign-in with your DataWise account for ChatGPT and claude.ai is coming next.</p>
        </TabsContent>
      </Tabs>

      <Dialog open={reveal !== null} onOpenChange={(open) => { if (!open) setReveal(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your new token</DialogTitle>
            <DialogDescription>This is the only time DataWise will show it. Store it somewhere safe.</DialogDescription>
          </DialogHeader>
          {reveal && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md bg-muted p-2 text-xs">{reveal.token}</code>
                <CopyButton text={reveal.token} />
              </div>
              <div>
                <Label className="text-xs">Claude Code command</Label>
                <div className="mt-1 flex items-start gap-2">
                  <pre className="flex-1 overflow-x-auto rounded-md bg-muted p-2 text-xs">{claudeCodeCommand(reveal.token)}</pre>
                  <CopyButton text={claudeCodeCommand(reveal.token)} />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

The `…` in the token suffix line is the single Unicode ellipsis character, not an em dash.

- [ ] **Step 6: Mount the card in `SettingsPage.tsx`**

Add to the imports near `import { BrandingCard } from '@/components/settings/BrandingCard';`:

```ts
import { McpAccessCard } from '@/components/settings/McpAccessCard';
```

Directly above the line `{/* Promo Code */}` (around line 1068), insert:

```tsx
      <McpAccessCard />

```

- [ ] **Step 7: Environment and CI wiring**

Append to `datawise-seo-insight-main/.env`:

```
VITE_MCP_URL=http://localhost:8788
```

In each of the three workflow files, directly under the existing `VITE_API_URL: https://datawise-api.nico-510.workers.dev` line, add:

```yaml
      VITE_MCP_URL: https://mcp.datawiseseo.com
```

In `scripts/deploy-pages-production.mjs`:

After `const EXPECTED_API_URL = ...` add:

```js
const EXPECTED_MCP_URL = 'https://mcp.datawiseseo.com';
```

Add to `FORBIDDEN_BUNDLE_MARKERS`:

```js
  ['Local MCP worker URL', 'http://localhost:8788'],
```

Add to `REQUIRED_BUNDLE_MARKERS`:

```js
  ['MCP settings card', 'MCP & AI assistants'],
  ['Production MCP worker URL', EXPECTED_MCP_URL],
```

Directly after the existing block at line 278 that throws when `process.env.VITE_API_URL !== EXPECTED_API_URL`, add the same check for the MCP URL:

```js
  if (process.env.VITE_MCP_URL !== EXPECTED_MCP_URL) {
    throw new Error(`VITE_MCP_URL must be ${EXPECTED_MCP_URL}; received ${process.env.VITE_MCP_URL || 'unset'}.`);
  }
```

- [ ] **Step 8: Typecheck, test, build with the guard**

Run:

```bash
npx tsc --noEmit
npm test
VITE_API_URL=https://datawise-api.nico-510.workers.dev VITE_MCP_URL=https://mcp.datawiseseo.com npm run deploy:pages:check
```

Expected: no type errors; tests pass; the guard prints the marker report with `MCP settings card` and `Production MCP worker URL` present and no forbidden markers.

- [ ] **Step 9: Exercise it in the browser**

With the MCP worker running locally (`npm run dev:mcp` in `workers/`, Task 13 Step 10) and `npm run dev` in the SPA, log in at `http://localhost:8080/settings` with the local dev account, scroll to "MCP & AI assistants", create a token named "test", confirm the reveal dialog shows a `dwmcp_` token and a copy button, close it, confirm the list shows the suffix, revoke it, confirm the list empties. Take a screenshot for the PR. If the local user is free-tier, the card shows the membership notice and the create button is disabled; that is also correct behaviour, note it.

- [ ] **Step 10: Commit**

```bash
git add src/lib/mcp.ts src/lib/__tests__/mcp.test.ts src/components/settings/McpAccessCard.tsx src/pages/SettingsPage.tsx .env scripts/deploy-pages-production.mjs ../.github/workflows/deploy-pages-production.yml ../.github/workflows/deploy-pages-staging.yml ../.github/workflows/pr-checks.yml
git commit -m "feat(settings): MCP & AI assistants card with personal tokens; VITE_MCP_URL wiring and deploy-guard markers"
```

---

### Task 16: Docs, PR, production rollout

**Files:**
- Modify: `DEPLOY.md` (new section after "Worker (API) deploys")
- Modify: root `CLAUDE.md` (sections 4 and 5)
- Modify: `datawise-seo-insight-main/workers/package.json` (no change needed; verify `deploy:mcp` exists from Task 1)

- [ ] **Step 1: Add the MCP section to `DEPLOY.md`**

Insert after the "Worker (API) deploys" section:

```markdown
## MCP worker (`datawise-mcp`) deploys

The MCP server for ChatGPT / Claude is a second worker built from the same
`workers/` tree (`src/mcp/`, config `wrangler.mcp.toml`). Public URL
`https://mcp.datawiseseo.com`, endpoint `/mcp`. Spec:
`docs/superpowers/specs/2026-09-07-datawise-mcp-server-design.md`.

```sh
cd datawise-seo-insight-main/workers
npm run deploy:mcp     # → wrangler deploy -c wrangler.mcp.toml → datawise-mcp
```

Rules:
- If `src/db/schema.sql` changed, run the remote D1 migration first (see the
  D1 section below). The MCP worker shares `datawise-db` with `datawise-api`.
- Secrets live in the Cloudflare dashboard on the `datawise-mcp` worker:
  `DATAFORSEO_EMAIL`, `DATAFORSEO_PASSWORD`, `ENCRYPTION_KEY`. Set them there,
  not with `wrangler secret put` (empty-paste trap).
- Kill switch: `mcp-paused` key in KV namespace `2302e0b0369842e799b5f4a144d6dce4`
  (any value). Early access: `mcp-allowlist` = comma-separated emails.
  Budgets: `mcp-user-cap-cents` (default 400), `mcp-global-cap-cents` (default 10000).

```sh
# pause / unpause
npx wrangler kv key put --namespace-id 2302e0b0369842e799b5f4a144d6dce4 mcp-paused 1
npx wrangler kv key delete --namespace-id 2302e0b0369842e799b5f4a144d6dce4 mcp-paused
```

Rollback: `npx wrangler rollback -c wrangler.mcp.toml` (pick the previous
version), or redeploy the last good tag.

Health: `curl -s https://mcp.datawiseseo.com/health` → `{"ok":true,"service":"datawise-mcp"}`.
```

- [ ] **Step 2: Update root `CLAUDE.md`**

In section 4 (Backend), add a bullet:

```markdown
- MCP server: `src/mcp/` (separate worker `datawise-mcp`, config `workers/wrangler.mcp.toml`, public URL `https://mcp.datawiseseo.com`). Shares D1 + KV with `datawise-api`. See `DEPLOY.md` "MCP worker".
```

In section 5 (Worker commands), add under the existing block:

```sh
npm run dev:mcp                      # local MCP worker on :8788
npm run deploy:mcp                   # → wrangler deploy -c wrangler.mcp.toml → datawise-mcp
```

- [ ] **Step 3: Full verification before the PR**

From `datawise-seo-insight-main/workers/`:

```bash
npx tsc --noEmit && npx vitest run && npx wrangler deploy --dry-run --outdir /tmp/mcp-dryrun -c wrangler.mcp.toml
```

From `datawise-seo-insight-main/`:

```bash
npx tsc --noEmit && npm test && VITE_API_URL=https://datawise-api.nico-510.workers.dev VITE_MCP_URL=https://mcp.datawiseseo.com npm run deploy:pages:check
```

Expected: all green. Then commit the docs:

```bash
git add DEPLOY.md CLAUDE.md
git commit -m "docs: MCP worker deploy section and commands"
```

- [ ] **Step 4: Open the PR into `production`**

```bash
git push -u origin feat/mcp-server
gh pr create --base production --title "MCP server stage 1: datawise-mcp worker, personal tokens, 12 read tools, dollar budget, Settings card" --body-file - <<'EOF'
## Summary
- New worker `datawise-mcp` (`workers/src/mcp/`, `wrangler.mcp.toml`), public URL https://mcp.datawiseseo.com/mcp
- Personal API tokens (`dwmcp_`), hashed like sessions, max 5 per user, Settings card to create/revoke
- 12 read-only MCP tools wrapping existing route handlers
- Dollar-denominated DataForSEO budget: $4/user/day, $100 global, 30 calls/min, KV kill switch + allowlist
- `dfsMeter` on the DataForSEO client records actual per-call cost
- Schema: `api_tokens`, `mcp_usage_daily`, `mcp_calls`

Spec: docs/superpowers/specs/2026-09-07-datawise-mcp-server-design.md
Plan: docs/superpowers/plans/2026-09-07-mcp-server-stage-1.md

## Rollout (manual, in order, after merge)
1. Prod D1 migration (three CREATE TABLE IF NOT EXISTS + indexes)
2. `npm run deploy:mcp`
3. Secrets on `datawise-mcp` in the CF dashboard
4. KV `mcp-allowlist` = nico@airankingskool.com for the dogfood week

## Test plan
- [ ] `workers`: tsc, vitest (all `src/mcp` suites), wrangler dry-run for both configs
- [ ] SPA: tsc, vitest, `deploy:pages:check` with the new markers
- [ ] MCP Inspector against local worker: 12 tools, 401 without token
- [ ] After deploy: Claude Code `claude mcp add`, one stored-data tool, one DFS tool, `mcp_calls` row present

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Wait for `pr-checks.yml` to pass. Nico merges.

- [ ] **Step 5: Production rollout (Nico, or an agent with explicit "yes" at each step)**

All from a clean `production` checkout after the merge (`git checkout production && git pull`), in `datawise-seo-insight-main/workers/`:

1. Migration. Write the three `CREATE TABLE IF NOT EXISTS` blocks and their two `CREATE INDEX IF NOT EXISTS` lines from Task 2 into `/tmp/mcp-migration.sql`, then:

```bash
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler d1 execute datawise-db --remote --file=/tmp/mcp-migration.sql
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler d1 execute datawise-db --remote --json --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('api_tokens','mcp_usage_daily','mcp_calls')"
```

Expected: three rows.

2. Deploy the worker (this creates it and the `mcp.datawiseseo.com` custom domain):

```bash
npm run deploy:mcp
```

3. In the Cloudflare dashboard, Workers & Pages > `datawise-mcp` > Settings > Variables and Secrets, add `DATAFORSEO_EMAIL`, `DATAFORSEO_PASSWORD`, `ENCRYPTION_KEY` with the same values `datawise-api` uses. Saving creates a new version; no redeploy needed.

4. Early access allowlist:

```bash
npx wrangler kv key put --namespace-id 2302e0b0369842e799b5f4a144d6dce4 mcp-allowlist "nico@airankingskool.com"
```

5. Verify:

```bash
curl -s https://mcp.datawiseseo.com/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mcp.datawiseseo.com/mcp     # expect 401
```

The Pages deploy runs automatically from the merge (GitHub Actions). Open `https://datawiseseo.com/settings`, create a token, then in a terminal:

```bash
claude mcp add --transport http datawise https://mcp.datawiseseo.com/mcp --header "Authorization: Bearer <token>"
claude
```

In Claude Code: `/mcp` shows `datawise` connected with 12 tools. Ask: "Use datawise to list my rank tracking projects" (stored data, $0), then "Use datawise to get keyword metrics for 'local seo services'" (one DFS call). Confirm in prod D1:

```bash
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler d1 execute datawise-db --remote --json --command \
  "SELECT tool, cost_usd, cached, ok, duration_ms FROM mcp_calls ORDER BY created_at DESC LIMIT 5"
```

Expected: two rows, the metrics call with a non-zero `cost_usd` (or `cached = 1` and `0` on a repeat).

6. Tag:

```bash
git tag -a "prod-$(date -u +%Y-%m-%d-%H%M)" -m "deploy: datawise-mcp stage 1" && git push origin --tags
```

7. Update memory `project_mcp_server.md` with the deployed worker version id and the tag. Stage 2 (OAuth) is a separate plan.

---

## Self-review notes

- Spec coverage: 3.1 placement (Tasks 1, 13), 3.2 custom domain (13, 16), 3.3 env cast (4), 4.1 tokens (5, 14, 15), 4.3 challenge without `resource_metadata` (13), 5 tools and hygiene (8 to 12), 6.1 access (6), 6.2 budgets with actual cost (3, 7, 13), 6.3 call log and purge (2, 7, 13), 7 Settings card and guard marker (15), 8 endpoints for stage 1 (13, 14), 9 dogfood allowlist (16), 10 tests (every task), 11 security items that apply to stage 1 (5, 8, 13). Section 4.2 OAuth and the `/connect` page are stage 2 by design.
- Names used across tasks: `McpEnv`, `McpIdentity`, `asWorkerEnv`, `makeMcpTestEnv`, `seedUser`, `TOKEN_PREFIX`, `MAX_ACTIVE_TOKENS`, `TokenLimitError`, `createApiToken`, `validateApiToken`, `listApiTokens`, `revokeApiToken`, `loadIdentity`, `hasMemberAccess`, `checkAccess`, `denialMessage`, `estimateCostUsd`, `readCaps`, `readSpent`, `checkBudget`, `checkRateLimit`, `recordUsage`, `budgetMessage`, `utcDay`, `GLOBAL_USER_ID`, `compact`, `stripHtml`, `toolResult`, `toolError`, `CONCISE`, `DETAILED`, `callJson`, `readJson`, `HandlerError`, `defineTool`, `localeInputs`, `domainInput`, `resolveLocale`, `shapeFor`, `ALL_TOOLS`, `runGated`, `createDataWiseServer`, `handleMcpRequest`, `handleAccountRequest`, `mcpApi`, `claudeCodeCommand`, `useMcpTokens`, `useMcpUsage`, `createMcpToken`, `revokeMcpToken`.
- Known uncertainty, with a concrete fallback written into the task: whether `registerTool` in `@modelcontextprotocol/server` 2.0 takes a `ZodObject` or a raw shape (Task 13 Step 5), and the exact `createMcpHandler` return call signature (same step). Both are resolved by reading the installed `.d.ts`, which Task 1 installs.
