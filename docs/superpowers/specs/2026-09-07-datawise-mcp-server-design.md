# DataWise MCP Server: Design

**Date:** 2026-09-07
**Status:** Reviewed by Nico 2026-09-07; decisions recorded in section 12. Next step: implementation plan.
**Branch:** `feat/mcp-server`

## 1. Goal

Let DataWise members use the data DataWise already provides (keyword research, domain and competitor analysis, backlinks, rank tracking, AI visibility, Local Pack, Search Console) from inside ChatGPT, claude.ai, Claude Desktop, and Claude Code, through a remote MCP server whose login is the member's DataWise account.

Non-goals for this spec: write tools (creating projects, adding keywords, running checks), listing in the ChatGPT app directory, billing for API access, and a public REST API. Each is a later spec.

## 2. Research summary (what constrains the design)

### 2.1 Client requirements, verified 2026-09-07

| Client | Transport | Auth accepted | Who can add it |
|---|---|---|---|
| Claude Code | Streamable HTTP | OAuth (via `/mcp` or `claude mcp login`), or a pasted `--header "Authorization: Bearer ..."` | Any plan |
| claude.ai and Claude Desktop | Streamable HTTP | OAuth (CIMD, DCR, or own client id). Static headers exist but are a gated beta. | Free (one connector), Pro, Max, Team, Enterprise |
| ChatGPT (Developer mode) | Streamable HTTP | OAuth or no auth. No API-key header option. | Plus, Pro, Business, Enterprise, Edu. Free is very likely excluded (third-party sourced). |

OAuth is therefore the only path that reaches every client. A pasted API key reaches Claude Code on day one with far less work, which is why stage 1 builds tokens first (section 9).

### 2.2 Protocol and platform facts

- MCP spec 2026-07-28 is stateless: no sessions, no `initialize`, no GET stream. HTTP+SSE is deprecated. Clients in the wild still speak the 2025 revisions, so the server must serve both.
- Authorization: the MCP server is an OAuth 2.1 resource server. It must publish RFC 9728 Protected Resource Metadata, answer 401 with `WWW-Authenticate: Bearer resource_metadata=...`, require PKCE S256, validate token audience, and never forward its own bearer tokens upstream.
- Client registration: Client ID Metadata Documents (CIMD) is preferred and Dynamic Client Registration (DCR) is deprecated, but ChatGPT and Claude both still fall back to DCR. The server must support both.
- Cloudflare `agents` 0.22 ships `createMcpHandler` from `agents/mcp`: a stateless per-request server, no Durable Objects. `McpAgent` is deprecated and feature-frozen. `legacy: "stateless"` keeps 2025-era clients working on the same route.
- Cloudflare `@cloudflare/workers-oauth-provider` 0.10.3 is a complete OAuth 2.1 authorization server for Workers: hashed tokens in KV, encrypted per-grant `props`, PKCE enforced, CIMD opt-in, DCR endpoint opt-in, custom `/authorize` page against your own users, and an `apiHandler` that receives verified `props` on the protected route.
- Both OpenAI and Anthropic treat tools without `readOnlyHint: true` as writes and prompt the user for confirmation on every call.

### 2.3 Codebase facts (from `origin/production`)

- Route handlers are all named exports with plain signatures, for example `handleListKeywords(env, userId, projectId)` and `handleBacklinksSummary(request, env, userId)`. Nothing is inlined in the router except `json`, `addCors`, and `withCredit`. They are importable.
- The DataForSEO client takes a narrow `DataForSeoEnv` (`KV`, `DATAFORSEO_EMAIL`, `DATAFORSEO_PASSWORD`). Every route builds its own DFS task body inline; there is no per-endpoint wrapper layer.
- The DFS cache and the `dfs-quota-blocked:<date>` short-circuit live under `dataforseo:*` in the main KV namespace (`2302e0b0369842e799b5f4a144d6dce4`). `DFS_CACHE` in `Env` is declared but never bound.
- Sessions are 32-byte random tokens stored as SHA-256 hashes with a KV fast path (`session:<hash>`), 30-day expiry. No API-key or personal-access-token concept exists.
- Credits are lifetime, not periodic: `FREE_CREDITS_LIMIT = 5`; admins, community members, pro, and promo holders are unlimited. No tier cap, per-user DFS budget, or cost ledger exists yet.
- The only spend guard in production is on anonymous public tools: per-IP and global daily counters in KV.
- Settings page (`src/pages/SettingsPage.tsx`) is a single scrolling page of `<h2>` sections; the OpenRouter BYOK card is the precedent for a secret the user copies elsewhere.
- Login: SPA holds a Bearer token in `localStorage`, no cookies. Google OAuth uses a `state` key in KV plus an origin allowlist, then redirects to `/auth/callback?token=`.
- CI: `pr-checks.yml` typechecks and tests `datawise-seo-insight-main/workers` on every PR into `production`. No workflow deploys any worker; worker deploys are manual `npm run deploy`.

## 3. Architecture

```
ChatGPT / claude.ai / Claude Code
        |  Streamable HTTP + Bearer token
        v
+------------------------------------------------------------+
|  Worker: datawise-mcp   (https://mcp.datawiseseo.com)      |
|                                                            |
|  fetch()                                                   |
|   |- /mcp ..................... MCP handler (agents 0.22)  |
|   |     token check: API key (D1+KV) or OAuth (OAUTH_KV)   |
|   |     -> authContext { userId, email, tier, tokenId }    |
|   |     -> access gate -> quota gate -> tool -> log        |
|   |- /.well-known/* ........... OAuth metadata (stage 2)   |
|   |- /authorize, /oauth/* ..... OAuth AS (stage 2)         |
|   |- /account/* ............... token + grant management   |
|   |     (SPA calls with DataWise session Bearer)           |
|   '- /health                                               |
|                                                            |
|  imports from workers/src: dataforseo/client, routes/*     |
|  handlers, middleware/auth, lib/*                          |
+------------------------------------------------------------+
        |                     |                    |
   D1 datawise-db        KV (shared)          KV OAUTH_KV (new)
   users, sessions,      session:*,           OAuth clients,
   api_tokens (new),     dataforseo:* cache,  grants, tokens
   mcp_usage_daily,      dfs-quota-blocked,
   mcp_calls (new)       mcp-paused flag
```

### 3.1 Placement: a second worker from the same source tree

The MCP server lives at `datawise-seo-insight-main/workers/src/mcp/` and deploys as a separate worker named `datawise-mcp` via `workers/wrangler.mcp.toml` (`wrangler deploy -c wrangler.mcp.toml`, wrapped as `npm run deploy:mcp`).

Why this and not the alternatives:

- Same tree means the existing PR-check job typechecks and tests it for free, and handlers import by normal relative path.
- Separate worker means an MCP bug, a bad deploy, or an agent traffic spike cannot take down `datawise-api` or the SPA. It also gets its own logs and its own kill switch.
- Calling the public REST API over HTTP from the MCP worker was rejected: it doubles request cost, re-runs auth, and gives the tools no control over response size.

The MCP worker binds `DB` (same `datawise-db`), `KV` (same namespace id, so DFS cache hits and the quota short-circuit are shared), a new `OAUTH_KV` namespace (stage 2), and secrets `DATAFORSEO_EMAIL`, `DATAFORSEO_PASSWORD`, `ENCRYPTION_KEY`, `FRONTEND_URL`, `ADMIN_EMAILS`. Secrets are set in the Cloudflare dashboard per `feedback_cloudflare_secrets_dashboard`.

### 3.2 URL: custom domain from day one

The protected resource identifier is the exact URL users type. Changing it later invalidates every OAuth grant and every saved connector. The server is published at `https://mcp.datawiseseo.com/mcp` (custom domain on the existing zone) before the first member connects. The `workers.dev` URL is never advertised.

### 3.3 Env typing

Route modules import `Env` from `../index` as a type only. The MCP worker declares its own `McpEnv` (DB, KV, OAUTH_KV, secrets) and passes `env as unknown as Env` only into the handlers it imports, all of which touch only `DB`, `KV`, and DFS secrets. This is a documented cast in one place (`src/mcp/env.ts`), not scattered.

## 4. Authentication

Two token kinds are accepted on `/mcp`. Both resolve to the same `authContext` shape and both bind every tool call to a verified `userId`.

### 4.1 Personal API tokens (stage 1)

- Created in Settings. Format `dwmcp_<40 random base62 chars>`. Shown once, stored as SHA-256 hash, same pattern as sessions.
- New D1 table:

```sql
CREATE TABLE IF NOT EXISTS api_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,          -- user label, e.g. "Claude Code laptop"
  token_hash    TEXT NOT NULL UNIQUE,
  token_suffix  TEXT NOT NULL,          -- last 4 chars for display
  scopes        TEXT NOT NULL DEFAULT 'read',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  expires_at    TEXT,                   -- NULL = no expiry
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
```

- Validation: hash the bearer, check KV `mcptoken:<hash>` (value `userId`, TTL 1 hour), fall back to D1, re-cache. Revocation deletes the KV key and sets `revoked_at`. `last_used_at` is updated at most once per hour per token to avoid write churn.
- Limit 5 active tokens per user.
- Who can use them: Claude Code (`--header`), Claude Desktop and claude.ai once the static-headers beta reaches the member's plan, any scripted MCP client.

### 4.2 OAuth 2.1 (stage 2)

DataWise becomes its own authorization server using `@cloudflare/workers-oauth-provider`. There is no upstream identity provider proxied, so the confused-deputy class of bugs does not apply; DataWise's own login is the identity source.

Provider configuration:

- `apiRoute: '/mcp'`, `authorizeEndpoint: '/authorize'`, `tokenEndpoint: '/oauth/token'`, `clientRegistrationEndpoint: '/oauth/register'` (DCR on, because ChatGPT and Claude still fall back to it), `clientIdMetadataDocumentEnabled: true` (CIMD on), `disallowPublicClientRegistration: false`.
- `scopesSupported: ['read']` for now. `resourceMetadata: { resource: 'https://mcp.datawiseseo.com/mcp', authorization_servers: ['https://mcp.datawiseseo.com'], scopes_supported: ['read'], resource_name: 'DataWise' }`.
- `token_endpoint_auth_methods_supported` must include `none` so Claude selects CIMD.
- `accessTokenTTL: 3600`, `refreshTokenTTL` default (30 days), `revokeExistingGrants: true`.
- `props` stored per grant: `{ userId, email, tier }`. Tools never read the raw token.

Consent flow, reusing the existing SPA login:

1. Client hits `GET https://mcp.datawiseseo.com/authorize?client_id=...&redirect_uri=...&code_challenge=...&state=...&resource=...`.
2. The worker validates the request with `parseAuthRequest`, looks up the client, stores the parsed request in KV under `mcp_authreq:<nonce>` (10-minute TTL), and 302s to `${FRONTEND_URL}/connect?req=<nonce>`.
3. `/connect` is a protected SPA route. If the user is logged out, `ProtectedRoute` sends them through the normal Google or email login and back. The page then calls `GET /account/authorize-request?req=<nonce>` with the DataWise session Bearer and renders a consent card: client name, redirect host (with an explicit warning when it is a loopback address, which is what Claude Code uses), scope, and the account email.
4. On Approve the SPA POSTs `/account/authorize-request/approve` with `{ req }` and the session Bearer. The worker re-validates the session with the imported `authMiddleware`, applies the access gate (section 6), calls `completeAuthorization({ request, userId, metadata: { client_name }, scope: ['read'], props })`, deletes the nonce, and returns `{ redirect_to }`. The SPA navigates there. Deny returns the OAuth `access_denied` redirect.
5. The client exchanges the code at `/oauth/token` with PKCE. Refresh tokens rotate.

Grants appear in Settings as "Connected apps" (via `listUserGrants`) with a Disconnect button (`revokeGrant`).

### 4.3 Token handling on `/mcp`

```
bearer = Authorization header
if bearer starts with "dwmcp_":  validate as API token (4.1)
else:                            hand the request to OAuthProvider, which
                                 validates its own token and supplies props
no/invalid bearer:               401 + WWW-Authenticate: Bearer
                                 resource_metadata="https://mcp.datawiseseo.com/.well-known/oauth-protected-resource"
```

During stage 1 the OAuth branch does not exist and the 401 is returned without `resource_metadata` (there is no authorization server to point at yet).

The MCP bearer is never forwarded anywhere. DFS calls use the worker's own credentials.

## 5. Tools

Design rules, taken from the Anthropic and OpenAI guidance: few workflow-shaped tools rather than one per endpoint, `datawise_` prefix, descriptions that say when to use and when not to, small default limits, `structuredContent` plus a short text summary, and every tool marked `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`.

All tools accept optional `location_code` (default: the user's `default_location_code`, else 2840) and `language_code` (default: user's default, else `en`), plus `response_format: "concise" | "detailed"` (default concise). Concise responses drop nested DFS structures and keep the fields a person would put in a spreadsheet.

| Tool | Inputs | Source | Est. cost, worst case |
|---|---|---|---|
| `datawise_keyword_research` | `keyword`, `mode: related \| suggestions \| ideas` (default related), `limit` ≤100 (default 25) | DFS Labs related/suggestions/ideas, same task bodies as `routes/keywords.ts` | $0.05 |
| `datawise_keyword_metrics` | `keywords[]` ≤50 | DFS Labs keyword_overview + bulk_keyword_difficulty, merged per keyword | $0.04 |
| `datawise_domain_overview` | `domain` | DFS Labs domain_rank_overview + bulk_traffic_estimation + backlinks summary, condensed to one object | $0.16 |
| `datawise_ranked_keywords` | `domain`, `limit` ≤100 (default 25), `offset`, `min_volume`, `max_position` | DFS Labs ranked_keywords | $0.03 |
| `datawise_competitors` | `domain`, `limit` ≤20 (default 10) | DFS Labs competitors_domain | $0.02 |
| `datawise_keyword_gap` | `my_domain`, `competitor_domain`, `limit` ≤100 (default 25) | two ranked_keywords calls diffed, same logic as `handleGapAnalysis`, 300 rows per side | $0.10 |
| `datawise_backlinks` | `domain`, `view: summary \| list \| referring_domains \| anchors` (default summary), `limit` ≤100, `offset` | DFS Backlinks | $0.03 |
| `datawise_ai_mentions` | `domains[]` 1 to 5, `platform: google \| chatgpt \| ...` | DFS LLM mentions aggregate (or cross-aggregate when >1 domain) | $0.12 |
| `datawise_rank_tracking` | `action: list_projects \| project_keywords \| keyword_history`, `project_id`, `keyword_id`, `limit` | D1 via `handleListProjects`, `handleListKeywords`, `handleKeywordHistory` | $0 |
| `datawise_ai_visibility` | `project_id`, `period` days (default 90), `include_queries` | D1 via `handleGetAITracking`, `handleAIReport` | $0 |
| `datawise_local_reviews` | `project_id` or `place_id` or `business_name`, `limit` ≤100 | `handleReviews` and `handleGBPProfile` (KV-cached DFS) | $0.02 |
| `datawise_search_console` | `action: list_properties \| queries \| pages`, `property_id`, `range`, `search`, `sort`, `limit` ≤200 | D1/KV via `handleGSCData`, `handleGSCQueries` | $0 |

Twelve tools. Worst-case costs use DataForSEO's live rates as of 2026-09-07 (Labs: $0.012 per task plus $0.00012 per item; bulk traffic estimation: $0.12 per task; Backlinks: $0.024 per request plus $0.000036 per row; LLM Mentions: $0.10 per request plus $0.001 per row; GBP info live: $0.0054; reviews: $0.0015 per 10) at each tool's maximum `limit`. Traffic estimation is the single most expensive call, which is why `datawise_domain_overview` costs eight times a keyword lookup. DFS-backed tools call `dataforseoRequestCached` directly with task bodies copied from the route handlers (they are 5 to 10 lines each) so the tool controls `limit` and output shape. Database-backed tools import the route handlers as-is, since ownership checks already live there. If two copies of a DFS task body drift, that is the signal to extract a shared builder into `src/dataforseo/`; not before.

Every domain input goes through `sanitizeDomainTarget`. Every handle (`project_id`, `keyword_id`, `property_id`) is resolved against the verified `userId`; an id the user does not own returns an `isError` result saying so, never a 500.

Output hygiene: strip HTML tags and control characters from any DFS text field (titles, snippets, review text); cap review text at 500 characters; never include internal user ids, raw DFS `cost` values, or request ids in tool output.

Errors are returned as `isError: true` with a message that tells the model what to do next: `"Daily MCP budget reached ($4.00). Resets at 00:00 UTC, no rollover. Rank tracking, AI visibility, and Search Console tools still work because they use stored data."`

## 6. Access, quotas, and cost control

This is the part that protects the DataForSEO bill. An agent in a loop can issue calls at a rate no human clicking the UI ever would, and the tier caps from the DataForSEO cost plan are not built yet. The MCP gets its own self-contained controls, designed so a future cost ledger can absorb them.

### 6.1 Access gate

MCP access requires `is_admin`, or `is_community_member`, or `subscription_tier IN ('pro', 'community')`. Free accounts can create a token but every tool call and every consent screen returns: "MCP access is included with AI Ranking Skool membership and DataWise Pro." The existing lifetime credit counter (`credits_used`) is never touched by the MCP, so UI credits and MCP usage cannot interfere.

Rationale: the free tier's 5 lifetime credits are a taste of the UI, not a programmatic budget, and an unauthenticated-adjacent surface with free access is the fastest way to a runaway bill. Decision 2026-09-07: free accounts get no MCP access.

### 6.2 Budgets

Nico's constraint: a member must not be able to spend more than $3 to $5 of DataForSEO per day through the MCP. The cap is therefore expressed in dollars, not abstract units, and it is checked against real DataForSEO cost.

| Control | Value | Storage |
|---|---|---|
| Per-user daily DFS budget | community/pro: $4.00, no rollover; admin: unlimited | D1 `mcp_usage_daily` |
| Per-user calls per minute | 30 | KV `mcprate:<userId>:<minute>` |
| Global DFS budget per day, all users | $100.00 | D1 `mcp_usage_daily` where `user_id = '_global'` |
| Global kill switch | KV `mcp-paused` = `1` | KV, checked first on every call |
| Runtime overrides | KV `mcp-user-cap-cents`, `mcp-global-cap-cents` | KV, read per call, no deploy needed to tune |
| DFS quota exhausted | reuse existing `dfs-quota-blocked:<date>` | shared KV |

How cost is measured:

- **Before the call**, the gate checks `spent_today + estimated_cost(tool, inputs) <= cap`, where the estimate is the worst-case figure from the tool table scaled by the requested `limit`. This rejects a call that would cross the line instead of discovering it afterwards.
- **After the call**, the ledger records the **actual** cost. Every DataForSEO response carries a top-level `cost` field, and the backlinks and LLM-mentions handlers already surface it. `dataforseoRequestCached` gets a small extension: it returns `{ data, cost, cached }` so a KV cache hit records `cost = 0` and a live call records what DFS charged. Cache hits are therefore free to the member, which is correct because they are free to DataWise.
- Database-backed tools record `cost = 0` and only count toward the per-minute rate limit.

At $4.00 and the worst-case figures above, a member gets roughly 25 domain overviews, 40 keyword-gap runs, or 100 to 150 keyword lookups per day, and far more when the shared cache hits. A runaway agent loop calling `datawise_domain_overview` exhausts the budget in about a minute and then receives budget errors until 00:00 UTC. The global cap of $100 per day is a backstop equal to 25 members at their maximum; it is set well above expected use and exists only to bound a systemic failure. Both caps can be changed live through the KV overrides.

```sql
CREATE TABLE IF NOT EXISTS mcp_usage_daily (
  user_id   TEXT NOT NULL,
  day       TEXT NOT NULL,       -- UTC YYYY-MM-DD; a new row each day = no rollover
  cost_usd  REAL NOT NULL DEFAULT 0,
  calls     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
```

Gate order per call: kill switch, access gate, per-minute rate, per-user daily (read plus estimate), global daily (read plus estimate), run tool, then one atomic `INSERT ... ON CONFLICT DO UPDATE SET cost_usd = cost_usd + ?, calls = calls + 1` for the user row and one for the global row with the actual cost. A read-then-write race can overshoot the cap by one call's cost; that is acceptable.

### 6.3 Call log

```sql
CREATE TABLE IF NOT EXISTS mcp_calls (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  tool        TEXT NOT NULL,
  cost_usd    REAL NOT NULL,          -- actual DFS cost, 0 on cache hit or DB-only tool
  cached      INTEGER NOT NULL,       -- 1 if served from the shared DFS cache
  ok          INTEGER NOT NULL,       -- 1 success, 0 isError
  duration_ms INTEGER,
  auth_kind   TEXT NOT NULL,          -- 'api_token' | 'oauth'
  client_name TEXT,                   -- OAuth client_name or token name
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_calls_user_day ON mcp_calls(user_id, created_at);
```

Rows are small; at a few thousand calls a day this is negligible next to the GSC tables. A daily cron on the MCP worker deletes rows older than 30 days, respecting the D1 storage pressure noted in `project_d1_full_incident_2026-06-25`. The admin panel gets a read-only "MCP usage" view later; for launch, a D1 query is enough.

## 7. Frontend changes (SPA)

Two additions, both in `datawise-seo-insight-main/src`:

1. **Settings section "MCP & AI assistants"** placed between OpenRouter AI Key and Promo Code in `SettingsPage.tsx`, extracted into `components/settings/McpAccessCard.tsx` following the `BrandingCard.tsx` precedent. Contents:
   - Access status (member / upgrade message).
   - Personal tokens: list (name, suffix, created, last used), Create (name field, one-time reveal with copy button), Revoke.
   - Connected apps (stage 2): client name, connected date, Disconnect.
   - Setup instructions in tabs: Claude Code (the exact `claude mcp add --transport http datawise https://mcp.datawiseseo.com/mcp --header "Authorization: Bearer <token>"` command), claude.ai / Claude Desktop, ChatGPT (Developer mode steps). Once stage 2 lands the instructions say "sign in with your DataWise account when prompted".
   - Today's usage: dollars spent / $4.00 daily budget, resets at 00:00 UTC.
2. **`/connect` consent page** (stage 2), route inside `ProtectedPage` in `App.tsx`, component `pages/ConnectPage.tsx`.

The SPA talks to the MCP worker directly at `VITE_MCP_URL` (new env var, `https://mcp.datawiseseo.com`) with the existing session Bearer through a small `mcpApi()` helper that mirrors `api()` in `lib/api.ts`. The MCP worker applies the same origin allowlist (`isAllowedFrontendOrigin`) for CORS. No changes to `datawise-api` routing are needed. The Pages deploy guard gains one marker for the new Settings section so a bundle missing it cannot ship.

## 8. Endpoints of the MCP worker

| Route | Auth | Purpose |
|---|---|---|
| `POST /mcp` | MCP bearer (API token or OAuth) | Streamable HTTP MCP endpoint, `legacy: "stateless"` |
| `GET /.well-known/oauth-protected-resource[/mcp]` | none | RFC 9728 (stage 2) |
| `GET /.well-known/oauth-authorization-server` | none | RFC 8414 (stage 2) |
| `GET /authorize` | none | parse, stash, redirect to SPA `/connect` (stage 2) |
| `POST /oauth/token`, `POST /oauth/register` | per OAuth | provided by the library (stage 2) |
| `GET /account/authorize-request`, `POST .../approve`, `POST .../deny` | DataWise session | consent (stage 2) |
| `GET /account/tokens`, `POST /account/tokens`, `DELETE /account/tokens/:id` | DataWise session | personal tokens |
| `GET /account/grants`, `DELETE /account/grants/:id` | DataWise session | connected apps (stage 2) |
| `GET /account/usage` | DataWise session | today's spend and cap |
| `GET /health` | none | uptime check |

## 9. Build stages and launch

Decision 2026-09-07: one launch covering ChatGPT and Claude together. The two stages below are build order, not release order; nothing is announced until both are done.

**Stage 1: tokens + tools.** Worker skeleton with `createMcpHandler`, API tokens, the 12 tools, access and budget gates, call log, Settings card, custom domain `mcp.datawiseseo.com`, `deploy:mcp` script, DEPLOY.md section. Testable immediately from Claude Code with a pasted token. Estimated 2 to 3 focused days.

**Stage 2: OAuth.** `OAuthProvider` wiring, `OAUTH_KV` namespace, `/connect` consent page, connected-apps UI. Estimated 2 to 3 days.

**Dogfood, then launch.** Both stages ship to the `datawise-mcp` worker behind a KV allowlist (`mcp-allowlist` of emails, admin always included). One week of use across Claude Code, claude.ai, Claude Desktop, and ChatGPT Developer mode, plus the cost check in section 10. Then the allowlist is removed and the Settings card becomes visible to all members with the announcement.

**Later, separate specs:** write tools with confirmation semantics; unified cost ledger with the DataForSEO cost-caps plan; ChatGPT directory submission (needs privacy and terms URLs, demo credentials, annotations on every tool); CIMD domain trust policy beyond Anthropic's and OpenAI's hosted documents.

## 10. Testing

- **Unit (vitest, in the existing worker job):** token generation and hashing, token validation with KV hit, KV miss, expired, revoked; access gate by tier; quota gate at boundaries and kill switch; each tool's input schema (zod) and output shaping against recorded DFS fixtures; output sanitizer; handle-ownership rejection.
- **Protocol:** MCP Inspector against `wrangler dev -c wrangler.mcp.toml` for `tools/list`, each tool, error shapes, and the 401 challenge. One run with a 2025-11-25 client to confirm `legacy: "stateless"`.
- **Real clients before removing the allowlist:** Claude Code with a pasted token; claude.ai custom connector; ChatGPT Developer mode (stage 2). Each exercises at least keyword research, rank tracking, and a quota-exceeded case (temporarily set the cap to 2 for the test account).
- **Cost check:** after the dogfood week, compare `mcp_usage_daily` totals against the DataForSEO dashboard spend for the same days before lifting the allowlist. The two should match within cache-hit noise; a gap means the ledger is missing a cost source.
- **Budget test:** with the test account's cap set to $0.20 through `mcp-user-cap-cents`, confirm the fourth keyword lookup is refused with the budget error and the stored-data tools still answer.

## 11. Security checklist

- PKCE S256 only; audience validated by the provider; `resource` in metadata matches the advertised URL exactly.
- MCP bearer never leaves the worker; DFS uses worker secrets.
- `Origin` header checked on `/mcp` (403 on a disallowed browser origin); CORS on `/account/*` limited to the frontend allowlist.
- Consent page names the client and the redirect host; loopback redirects carry a visible warning.
- Every handle bound to the verified user; no cross-user cache key without the user id in it (the GSC cache already keeps its ownership check live).
- Tool output sanitized; no secrets, internal ids, or debug payloads.
- Tokens shown once, stored hashed, revocable, 5 per user, `last_used_at` visible.
- Kill switch `mcp-paused` documented in DEPLOY.md next to the other KV flags.
- CIMD fetches: confirm the library blocks private IP ranges before enabling; if it does not, restrict CIMD to the Anthropic and OpenAI document hosts at launch.

## 12. Decisions (Nico, 2026-09-07)

1. **Free-tier access:** none. MCP is a member and Pro feature.
2. **Daily cap:** dollar-denominated, $4.00 per member per day, no rollover, must stay within $3 to $5 per user per day. Tunable live via KV.
3. **Domain:** `mcp.datawiseseo.com`, approved.
4. **Launch:** one release for ChatGPT and Claude together; no Claude-Code-only launch.

## 13. Sources

- MCP spec 2026-07-28: changelog, Streamable HTTP, authorization, client registration, tools, security best practices at modelcontextprotocol.io/specification/2026-07-28/
- Cloudflare: developers.cloudflare.com/agents/model-context-protocol/ (mcp-handler-api, guides/remote-mcp-server, protocol/authorization); github.com/cloudflare/workers-oauth-provider; blog.cloudflare.com/mcp-v2/
- OpenAI: developers.openai.com/api/docs/guides/developer-mode; developers.openai.com/apps-sdk/build/auth; developers.openai.com/apps-sdk/deploy/submission; developers.openai.com/apps-sdk/guides/optimize-metadata
- Anthropic: claude.com/docs/connectors/custom/remote-mcp; claude.com/docs/connectors/building/authentication; code.claude.com/docs/en/mcp; anthropic.com/engineering/writing-tools-for-agents
- DataForSEO pricing (fetched 2026-09-07): dataforseo.com/pricing/dataforseo-labs/dataforseo-google-api, dataforseo.com/pricing/backlinks/backlinks, dataforseo.com/pricing/ai-optimization/llm-mentions, dataforseo.com/pricing/business-data/business-data-api, dataforseo.com/pricing/business-data/google-reviews-api, dataforseo.com/update/pricing-update-in-dataforseo-apis (+20% across Labs and Backlinks from 2026-07-01)
- Codebase: `workers/src/index.ts`, `middleware/auth.ts`, `middleware/credits.ts`, `dataforseo/client.ts`, `routes/*.ts`, `gsc/sync.ts`, `src/pages/SettingsPage.tsx`, `src/lib/api.ts`, `.github/workflows/pr-checks.yml`, `DEPLOY.md`
