# Blueprint V1 — Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Blueprint module inside DataWise (bindings, admin gate, health route, SPA placeholder) and build the deterministic domain engine (contracts, validation, normalization, seeds, merge, scoring, graph and doorway guardrails) with fixture-only tests. No paid provider calls in either phase.

**Architecture:** Blueprint lives at `workers/src/blueprint/` in the existing `datawise-api` worker, with its own D1 (`blueprint-db`), KV, R2, and Queue bindings. All `/api/blueprint/*` routes are admin-gated (invisible to members). Phase 1 is pure TypeScript with vitest tests, no I/O. Spec: `docs/superpowers/specs/2026-07-10-blueprint-v1-integration-design.md`. Source handoff: `blueprint-v1-developer-handoff/`.

**Tech Stack:** Cloudflare Workers (wrangler 3.x), D1, KV, R2, Queues, TypeScript 5, vitest 3, zod 3, React 18 + Vite SPA.

## Global Constraints

- Repo root: `/Users/nicolasgorrono/Desktop/DataWise V2`. App folder: `datawise-seo-insight-main/`. All paths below are relative to the app folder inside the **worktree** created in Task 1 unless prefixed with `scripts/` context notes.
- The current checkout (`codex-content-writer-prompt-admin`) is severely stale. **Never build on it. Branch off `origin/production`.**
- Never `git add .` or `git add -A`. Stage specific files. Never amend or force-push.
- Worker deploys: `npm run deploy` from `workers/` (never `npm run deploy:production`, it creates an orphan worker).
- Pages production deploys are OUT OF SCOPE for this plan. Staging SPA testing uses `git push origin <branch>:staging`.
- Production D1 commands need `CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77`.
- Missing metrics stay `null`. Never convert null to 0 (spec acceptance).
- No em dashes in any UI copy or docs (user rule).
- Worker vitest only picks up `workers/src/**/*.test.ts`; run from `workers/` with `npm test`.
- Blueprint boundary rule: nothing outside `workers/src/blueprint/` may import from it, except the single mount in `workers/src/index.ts`.
- Blueprint touches no existing D1 tables. All Blueprint state goes to `blueprint-db`.

---

## Phase 0 — Scaffolding, bindings, admin gate

### Task 1: Worktree, branch, module skeleton, boundary check

**Files:**
- Create: worktree at `/Users/nicolasgorrono/Desktop/datawise-blueprint-wt`
- Create: `datawise-seo-insight-main/workers/src/blueprint/README.md`
- Create: `datawise-seo-insight-main/scripts/check-blueprint-boundary.mjs`
- Create (copy in): `docs/superpowers/specs/2026-07-10-blueprint-v1-integration-design.md`, `docs/superpowers/plans/2026-07-10-blueprint-phase-0-1.md`

**Interfaces:**
- Produces: branch `feat/blueprint-phase-0`, boundary check script runnable via `node scripts/check-blueprint-boundary.mjs` from `datawise-seo-insight-main/`.

- [ ] **Step 1: Create worktree from origin/production**

```bash
cd "/Users/nicolasgorrono/Desktop/DataWise V2"
git fetch origin
git worktree add "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt" -b feat/blueprint-phase-0 origin/production
```

Expected: worktree created, branch `feat/blueprint-phase-0` at origin/production HEAD.

- [ ] **Step 2: Install dependencies in the worktree**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt/datawise-seo-insight-main"
npm install --legacy-peer-deps
cd workers && npm install
```

- [ ] **Step 3: Copy spec and this plan into the worktree**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp "/Users/nicolasgorrono/Desktop/DataWise V2/docs/superpowers/specs/2026-07-10-blueprint-v1-integration-design.md" docs/superpowers/specs/
cp "/Users/nicolasgorrono/Desktop/DataWise V2/docs/superpowers/plans/2026-07-10-blueprint-phase-0-1.md" docs/superpowers/plans/
```

- [ ] **Step 4: Create module skeleton**

Create `datawise-seo-insight-main/workers/src/blueprint/README.md`:

```markdown
# Blueprint module

Turns a business brief into an evidence-backed website architecture plan.
Spec: docs/superpowers/specs/2026-07-10-blueprint-v1-integration-design.md
Handoff: blueprint-v1-developer-handoff/ (repo root of the main checkout)

Boundary rules:
- This module MAY import shared infra: middleware/auth, routes/admin (isAdmin),
  dataforseo/, llm/, and the Env type from ../index.
- Nothing outside this folder may import from it, except the single route mount
  in workers/src/index.ts. Enforced by scripts/check-blueprint-boundary.mjs.
- All state lives in BLUEPRINT_DB (blueprint-db), never in the main DB.

Layout: contracts/ (DTOs, enums, zod), domain/ (pure engine), routes/ (handlers),
stages/ (pipeline, Phase 2+), providers/ (adapters, Phase 3+), exports/ (Phase 8).
```

- [ ] **Step 5: Write the boundary check script**

Create `datawise-seo-insight-main/scripts/check-blueprint-boundary.mjs`:

```js
#!/usr/bin/env node
// Enforces: no file outside workers/src/blueprint imports from it,
// except the route mount in workers/src/index.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN_ROOT = join(ROOT, 'workers', 'src');
const ALLOWED = new Set(['workers/src/index.ts']);
const IMPORT_RE = /from\s+['"][^'"]*\bblueprint\//;
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).split('\\').join('/');
    if (statSync(full).isDirectory()) {
      if (rel === 'workers/src/blueprint' || entry === 'node_modules') continue;
      walk(full);
    } else if (/\.tsx?$/.test(entry) && !ALLOWED.has(rel)) {
      if (IMPORT_RE.test(readFileSync(full, 'utf8'))) violations.push(rel);
    }
  }
}
walk(SCAN_ROOT);
if (violations.length) {
  console.error('Blueprint boundary violations (files importing workers/src/blueprint):');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('Blueprint boundary check passed.');
```

- [ ] **Step 6: Run the boundary check (must pass on clean tree)**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt/datawise-seo-insight-main"
node scripts/check-blueprint-boundary.mjs
```

Expected: `Blueprint boundary check passed.`

- [ ] **Step 7: Baseline worker tests still pass**

```bash
cd workers && npm test
```

Expected: existing suite passes (record any pre-existing failures; do not fix them here).

- [ ] **Step 8: Commit**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git add docs/superpowers/specs/2026-07-10-blueprint-v1-integration-design.md docs/superpowers/plans/2026-07-10-blueprint-phase-0-1.md datawise-seo-insight-main/workers/src/blueprint/README.md datawise-seo-insight-main/scripts/check-blueprint-boundary.mjs
git commit -m "feat(blueprint): phase 0 skeleton, spec, boundary check"
```

---

### Task 2: Cloudflare resources + wrangler.toml + Env + queue consumer

**Files:**
- Modify: `datawise-seo-insight-main/workers/wrangler.toml` (append blocks at end)
- Modify: `datawise-seo-insight-main/workers/src/index.ts` (Env interface lines ~1-28; default export)

**Interfaces:**
- Produces: `env.BLUEPRINT_DB: D1Database`, `env.BLUEPRINT_KV: KVNamespace`, `env.BLUEPRINT_ARTIFACTS: R2Bucket`, `env.BLUEPRINT_QUEUE: Queue` available to all later tasks; a no-op `queue` handler on the worker.

- [ ] **Step 1: Create the Cloudflare resources (capture IDs from output)**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt/datawise-seo-insight-main/workers"
export CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77
npx wrangler d1 create blueprint-db
npx wrangler kv namespace create BLUEPRINT_KV
npx wrangler r2 bucket create blueprint-artifacts
npx wrangler queues create blueprint-research
```

Expected: each prints created-resource info. Copy the `database_id` and KV `id` for Step 2. If `queues create` fails with a plan error, STOP and tell Nicolas (Queues needs Workers Paid); do not silently skip.

- [ ] **Step 2: Append bindings to `workers/wrangler.toml`**

```toml
# --- Blueprint module bindings (admin-gated feature, see workers/src/blueprint/README.md) ---

[[d1_databases]]
binding = "BLUEPRINT_DB"
database_name = "blueprint-db"
database_id = "<paste database_id from Step 1>"

[[kv_namespaces]]
binding = "BLUEPRINT_KV"
id = "<paste id from Step 1>"

[[r2_buckets]]
binding = "BLUEPRINT_ARTIFACTS"
bucket_name = "blueprint-artifacts"

[[queues.producers]]
binding = "BLUEPRINT_QUEUE"
queue = "blueprint-research"

[[queues.consumers]]
queue = "blueprint-research"
max_batch_size = 1
max_batch_timeout = 5
max_retries = 3
```

Do NOT touch the existing `DB`, `KV`, `TASK_ATTACHMENTS`, `[triggers]`, or `[vars]` blocks.

- [ ] **Step 3: Extend the Env interface in `workers/src/index.ts`**

Inside the existing `export interface Env { ... }` (top of file), add:

```ts
  // Blueprint module (admin-gated)
  BLUEPRINT_DB: D1Database;
  BLUEPRINT_KV: KVNamespace;
  BLUEPRINT_ARTIFACTS: R2Bucket;
  BLUEPRINT_QUEUE: Queue;
```

- [ ] **Step 4: Add a no-op queue consumer to the default export**

In `workers/src/index.ts`, the default export currently has `scheduled` and `fetch`. Add a `queue` member alongside them:

```ts
  async queue(batch: MessageBatch<unknown>, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Blueprint research stages are wired in Phase 2. Ack so messages don't retry forever.
    for (const message of batch.messages) message.ack();
  },
```

- [ ] **Step 5: Validate config without deploying**

```bash
npx tsc --noEmit
npx wrangler deploy --dry-run --outdir /tmp/blueprint-dryrun
```

Expected: typecheck clean; dry-run prints the bindings table including BLUEPRINT_DB, BLUEPRINT_KV, BLUEPRINT_ARTIFACTS, BLUEPRINT_QUEUE. No upload happens.

- [ ] **Step 6: Commit**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git add datawise-seo-insight-main/workers/wrangler.toml datawise-seo-insight-main/workers/src/index.ts
git commit -m "feat(blueprint): D1/KV/R2/Queue bindings and no-op queue consumer"
```

---

### Task 3: blueprint-db bootstrap schema

**Files:**
- Create: `datawise-seo-insight-main/workers/src/blueprint/db/schema.sql`

**Interfaces:**
- Produces: `blueprint_meta` table in `blueprint-db` with row `key='schema_version', value='0'` (health route reads it in Task 4).

- [ ] **Step 1: Write the bootstrap schema**

Create `workers/src/blueprint/db/schema.sql`:

```sql
-- Blueprint bootstrap schema. Full domain tables land in Phase 2.
CREATE TABLE IF NOT EXISTS blueprint_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO blueprint_meta (key, value) VALUES ('schema_version', '0')
  ON CONFLICT(key) DO NOTHING;
```

- [ ] **Step 2: Apply to remote blueprint-db and verify**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt/datawise-seo-insight-main/workers"
export CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77
npx wrangler d1 execute blueprint-db --remote --file=src/blueprint/db/schema.sql
npx wrangler d1 execute blueprint-db --remote --json --command "SELECT value FROM blueprint_meta WHERE key='schema_version'"
```

Expected: second command returns `"value": "0"`.

- [ ] **Step 3: Commit**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git add datawise-seo-insight-main/workers/src/blueprint/db/schema.sql
git commit -m "feat(blueprint): bootstrap blueprint-db schema (blueprint_meta)"
```

---

### Task 4: Admin-gated router + health route + tests

**Files:**
- Create: `datawise-seo-insight-main/workers/src/blueprint/routes/router.ts`
- Test: `datawise-seo-insight-main/workers/src/blueprint/routes/router.test.ts`
- Modify: `datawise-seo-insight-main/workers/src/index.ts` (one mount branch after the auth gate)

**Interfaces:**
- Consumes: `isAdmin(user)` from `workers/src/routes/admin.ts`; `AuthUser` from `workers/src/auth/google.ts`; `Env` from `workers/src/index.ts`.
- Produces: `handleBlueprintRequest(request: Request, env: Env, user: AuthUser, path: string, method: string): Promise<Response>` and `isBlueprintAuthorized(user: AuthUser | null): boolean`. Route: `GET /api/blueprint/v1/health`.

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/routes/router.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { handleBlueprintRequest, isBlueprintAuthorized } from './router';

const adminUser = { id: 'u1', email: 'nico@airankingskool.com', is_admin: true } as any;
const memberUser = { id: 'u2', email: 'member@example.com', is_admin: false } as any;

function fakeEnv(): any {
  return {
    BLUEPRINT_DB: { prepare: () => ({ first: async () => ({ value: '0' }) }) },
    BLUEPRINT_KV: { put: async () => undefined },
  };
}
const req = (path: string) => new Request(`https://api.test${path}`);

describe('isBlueprintAuthorized', () => {
  it('allows admin flag or admin email, denies everyone else', () => {
    expect(isBlueprintAuthorized(adminUser)).toBe(true);
    expect(isBlueprintAuthorized(memberUser)).toBe(false);
    expect(isBlueprintAuthorized(null)).toBe(false);
  });
});

describe('handleBlueprintRequest', () => {
  it('returns 404 for non-admin (feature invisible)', async () => {
    const res = await handleBlueprintRequest(req('/api/blueprint/v1/health'), fakeEnv(), memberUser, '/api/blueprint/v1/health', 'GET');
    expect(res.status).toBe(404);
  });
  it('serves health checks to admin', async () => {
    const res = await handleBlueprintRequest(req('/api/blueprint/v1/health'), fakeEnv(), adminUser, '/api/blueprint/v1/health', 'GET');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.checks.d1).toContain('ok');
    expect(body.checks.kv).toBe('ok');
  });
  it('404s unknown blueprint paths even for admin', async () => {
    const res = await handleBlueprintRequest(req('/api/blueprint/v1/nope'), fakeEnv(), adminUser, '/api/blueprint/v1/nope', 'GET');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd workers && npx vitest run src/blueprint/routes/router.test.ts
```

Expected: FAIL, cannot resolve `./router`.

- [ ] **Step 3: Implement the router**

Create `workers/src/blueprint/routes/router.ts`:

```ts
import type { Env } from '../../index';
import type { AuthUser } from '../../auth/google';
import { isAdmin } from '../../routes/admin';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function isBlueprintAuthorized(user: AuthUser | null): boolean {
  return !!user && isAdmin(user);
}

export async function handleBlueprintRequest(
  _request: Request,
  env: Env,
  user: AuthUser,
  path: string,
  method: string
): Promise<Response> {
  // Non-allowlisted users get 404: the feature does not exist for them.
  if (!isBlueprintAuthorized(user)) return json({ error: 'Not found' }, 404);

  if (path === '/api/blueprint/v1/health' && method === 'GET') {
    return handleHealth(env);
  }
  return json({ error: 'Not found' }, 404);
}

async function handleHealth(env: Env): Promise<Response> {
  const checks: Record<string, string> = {};
  try {
    const row = await env.BLUEPRINT_DB
      .prepare("SELECT value FROM blueprint_meta WHERE key = 'schema_version'")
      .first<{ value: string }>();
    checks.d1 = row ? `ok (schema_version=${row.value})` : 'error: blueprint_meta row missing';
  } catch (e) {
    checks.d1 = `error: ${(e as Error).message}`;
  }
  try {
    await env.BLUEPRINT_KV.put('health:ping', String(Date.now()), { expirationTtl: 60 });
    checks.kv = 'ok';
  } catch (e) {
    checks.kv = `error: ${(e as Error).message}`;
  }
  const ok = Object.values(checks).every((v) => v.startsWith('ok'));
  return json({ ok, module: 'blueprint', version: 'v1-phase0', checks }, ok ? 200 : 503);
}
```

Note: if importing `../../routes/admin` drags heavy transitive imports into vitest and breaks the test run, replace the import with a local rule that matches `routes/admin.ts` exactly (`isTruthyFlag(user.is_admin) || user.email === 'nico@airankingskool.com'`) and leave a comment pointing at `routes/admin.ts:9`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/blueprint/routes/router.test.ts
```

Expected: 5 assertions pass.

- [ ] **Step 5: Mount in `workers/src/index.ts`**

Import at the top with the other route imports:

```ts
import { handleBlueprintRequest } from './blueprint/routes/router';
```

Add ONE branch immediately after the `if (!user) { return addCors(json({ error: 'Unauthorized' }, 401)); }` gate (around line 368):

```ts
    // Blueprint module: admin-gated, all sub-routing inside the module
    if (path.startsWith('/api/blueprint/')) {
      return addCors(await handleBlueprintRequest(request, env, user, path, method));
    }
```

- [ ] **Step 6: Full checks**

```bash
npx tsc --noEmit && npm test
node ../scripts/check-blueprint-boundary.mjs || (cd .. && node scripts/check-blueprint-boundary.mjs)
```

Expected: typecheck clean, all tests pass, boundary check passes (index.ts is the allowed exception).

- [ ] **Step 7: Commit**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git add datawise-seo-insight-main/workers/src/blueprint/routes/router.ts datawise-seo-insight-main/workers/src/blueprint/routes/router.test.ts datawise-seo-insight-main/workers/src/index.ts
git commit -m "feat(blueprint): admin-gated router with health route"
```

---

### Task 5: SPA placeholder page + route + admin sidebar link

**Files:**
- Create: `datawise-seo-insight-main/src/pages/blueprint/BlueprintHome.tsx`
- Modify: `datawise-seo-insight-main/src/App.tsx` (lazy import + route + `requireAdmin` support on `ProtectedPage`)
- Modify: `datawise-seo-insight-main/src/components/AppSidebar.tsx` (link inside the existing `{isAdmin && (...)}` block)

**Interfaces:**
- Consumes: `api<T>(path)` from `src/lib/api.ts`; `useAuth()` from `src/contexts/AuthContext.tsx`; existing `ProtectedRoute` prop `requireAdmin?: boolean`.
- Produces: route `/blueprint`, visible in the sidebar only for admins.

- [ ] **Step 1: Create the page**

Create `src/pages/blueprint/BlueprintHome.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface BlueprintHealth {
  ok: boolean;
  module: string;
  version: string;
  checks: Record<string, string>;
}

export default function BlueprintHome() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['blueprint-health'],
    queryFn: () => api<BlueprintHealth>('/api/blueprint/v1/health'),
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Blueprint</h1>
      <p className="text-muted-foreground">
        Website architecture planner (admin preview). Turns a business brief into an
        evidence-backed site structure.
      </p>
      {isLoading && <p className="text-sm">Checking Blueprint backend...</p>}
      {error && (
        <p className="text-sm text-destructive">
          Backend check failed: {(error as Error).message}
        </p>
      )}
      {data && (
        <div className="rounded-md border p-4 text-sm space-y-1">
          <p className="font-medium">Backend status: {data.ok ? 'healthy' : 'degraded'}</p>
          {Object.entries(data.checks).map(([name, status]) => (
            <p key={name}>
              {name}: {status}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the route in `src/App.tsx`**

Read the file first; then:

1. Add with the other lazy imports (~lines 32-51):

```tsx
const BlueprintHome = lazy(() => import('./pages/blueprint/BlueprintHome'));
```

2. Extend `ProtectedPage` (~line 55) to forward an admin requirement (adapt to the exact existing JSX; only add the prop, change nothing else):

```tsx
const ProtectedPage = ({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) => (
  <ProtectedRoute requireAdmin={requireAdmin}>
    {/* existing Layout / AppErrorBoundary / Suspense wrapper stays byte-identical */}
  </ProtectedRoute>
);
```

3. Add the route inside `<Routes>` next to the other protected routes:

```tsx
<Route path="/blueprint" element={<ProtectedPage requireAdmin><BlueprintHome /></ProtectedPage>} />
```

CAUTION: do not modify `DeployRefreshGuard` or any line the deploy guard pins (see `scripts/deploy-pages-production.mjs` REQUIRED_SOURCE_MARKERS).

- [ ] **Step 3: Add the sidebar link in `src/components/AppSidebar.tsx`**

Inside the existing `{isAdmin && ( ... )}` admin group (~line 421), add a menu item mirroring the exact markup of the sibling `/admin/members` NavLink item, with:

```tsx
<NavLink to="/blueprint">
  <Map className="h-4 w-4" />
  <span>Blueprint</span>
</NavLink>
```

Import `Map` from `lucide-react` alongside the existing icon imports (rename to `MapIcon` if `Map` collides).

- [ ] **Step 4: Verify build and dev render**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt/datawise-seo-insight-main"
npx tsc --noEmit
npm run build
```

Expected: both succeed. Optionally `npm run dev` and check `http://localhost:8080/blueprint` renders (backend check may fail locally; the page itself must render).

- [ ] **Step 5: Commit**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git add datawise-seo-insight-main/src/pages/blueprint/BlueprintHome.tsx datawise-seo-insight-main/src/App.tsx datawise-seo-insight-main/src/components/AppSidebar.tsx
git commit -m "feat(blueprint): admin-only /blueprint page and sidebar link"
```

---

### Task 6: Phase 0 ship: PR, worker deploy, staging verification

**Files:** none (operational task)

- [ ] **Step 1: Push branch and open PR into production**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git push -u origin feat/blueprint-phase-0
gh pr create --base production --title "Blueprint Phase 0: bindings, admin gate, health route" --body "Admin-gated Blueprint module skeleton. New bindings: BLUEPRINT_DB, BLUEPRINT_KV, BLUEPRINT_ARTIFACTS, BLUEPRINT_QUEUE. No member-visible changes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: CHECKPOINT — confirm with Nicolas before deploying the worker** (this ships the gated routes + queue consumer to the production worker `datawise-api`).

- [ ] **Step 3: Deploy the worker**

```bash
cd datawise-seo-insight-main/workers && npm run deploy
```

Expected: deploy succeeds, bindings table lists the four BLUEPRINT_* bindings. Record the version id.

- [ ] **Step 4: Push the branch to staging for the SPA**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git push origin feat/blueprint-phase-0:staging --force-with-lease
```

(Staging branch is a moving pointer; `--force-with-lease` here is the established staging flow, NOT a force-push to a shared feature branch.)

- [ ] **Step 5: Verify on staging as admin**

1. Open `https://staging.datawise-118.pages.dev`, log in as nico@airankingskool.com.
2. Sidebar shows "Blueprint" in the admin group; page shows "Backend status: healthy" with `d1: ok (schema_version=0)` and `kv: ok`.
3. Negative check via curl (no token → 401 from the global gate):

```bash
curl -s -o /dev/null -w "%{http_code}" https://datawise-api.nico-510.workers.dev/api/blueprint/v1/health
```

Expected: `401`.

- [ ] **Step 6: Merge PR, tag, close Phase 0**

After Nicolas approves the staging check: merge the PR (no squash-rebase surprises; normal merge), then:

```bash
git checkout production && git pull
git tag -a "prod-$(date -u +%Y-%m-%d-%H%M)" -m "blueprint phase 0" && git push origin --tags
```

Live site note: merging to production makes the SPA code deployable, but datawiseseo.com only updates on the next Pages production deploy, and even then the page is admin-gated. No member impact.

---

## Phase 1 — Contracts and deterministic domain engine (fixtures only)

All tasks below run in the same worktree on a new branch. No paid calls, no network, pure functions + vitest.

### Task 7: Phase 1 branch + contracts (enums, types, limits) + zod

**Files:**
- Create: `workers/src/blueprint/contracts/enums.ts`, `workers/src/blueprint/contracts/types.ts`, `workers/src/blueprint/contracts/limits.ts`
- Test: `workers/src/blueprint/contracts/enums.test.ts`
- Modify: `workers/package.json` (adds `zod`)

**Interfaces:**
- Produces (used by every later task): all enum types below; `ProjectBriefInput`, `NormalizedProjectBrief`, `KeywordMetrics`, `KeywordCandidate`, `MergedKeyword`, `KeywordUniverse`, `ScoreBreakdown`, `BlueprintWarning`, `BlueprintPageNode`, `PageCandidate`, `KeywordClusterSummary`, `ProductLimits`, `V1_LIMITS`.

- [ ] **Step 1: Branch for Phase 1**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git fetch origin
# If PR #phase-0 is already merged: branch off origin/production.
# If not merged yet: branch off feat/blueprint-phase-0.
git checkout -b feat/blueprint-phase-1
cd datawise-seo-insight-main/workers && npm install zod@^3
```

- [ ] **Step 2: Write enums verbatim from the handoff**

Create `workers/src/blueprint/contracts/enums.ts` (values copied exactly from `blueprint-v1-developer-handoff/API_AND_DATA_CONTRACTS.md` §2 and §6):

```ts
export type ProjectMode = 'greenfield' | 'existing_site';

export type RecommendationStatus = 'create' | 'update' | 'keep' | 'consolidate';

export type ApprovalStatus = 'proposed' | 'approved' | 'rejected' | 'locked';

export type Priority = 'p1' | 'p2' | 'p3';

export const PAGE_TYPES = [
  'home', 'hub', 'service', 'location', 'service_location',
  'resource', 'comparison', 'company', 'contact', 'faq',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export type SearchIntent =
  | 'transactional' | 'commercial' | 'informational' | 'navigational' | 'unknown';

export type EvidenceProvider = 'dataforseo' | 'openrouter' | 'existing_site' | 'user';

export const EVIDENCE_KINDS = [
  'keyword_metric', 'ranking', 'competitor_page', 'serp_snapshot', 'paa_question',
  'related_search', 'fanout_query', 'parsed_page', 'business_fact', 'ai_decision',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type EvidenceCompleteness = 'pending' | 'partial' | 'complete';
export type ConfidenceLabel = 'low' | 'medium' | 'high';

export type RunStatus =
  | 'draft' | 'estimating' | 'queued' | 'running' | 'partial'
  | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled';

export type StageStatus =
  | 'pending' | 'queued' | 'running' | 'succeeded' | 'skipped'
  | 'partial' | 'retry_wait' | 'failed' | 'cancelled';

export const BLUEPRINT_STAGES = [
  'validate_intake', 'resolve_market', 'normalize_brief', 'plan_research',
  'collect_keyword_evidence', 'discover_competitors', 'collect_competitor_evidence',
  'normalize_keyword_universe', 'embed_keyword_features', 'build_provisional_clusters',
  'validate_serps_and_questions', 'refine_clusters', 'parse_competitor_pages',
  'collect_us_fanout', 'build_page_plan', 'overlay_existing_site',
  'synthesize_page_briefs', 'validate_blueprint', 'publish_blueprint',
] as const;
export type BlueprintStage = (typeof BLUEPRINT_STAGES)[number];

export type BlueprintErrorCode =
  | 'invalid_input' | 'unsupported_market' | 'provider_auth_failed'
  | 'provider_quota_exhausted' | 'provider_rate_limited' | 'provider_unavailable'
  | 'provider_timeout' | 'provider_invalid_response' | 'budget_exceeded'
  | 'ai_schema_invalid' | 'ai_evidence_reference_invalid' | 'site_fetch_blocked'
  | 'site_fetch_unsafe' | 'stage_conflict' | 'run_cancelled' | 'internal_error';

export const WARNING_CODES = [
  'cannibalization_risk', 'doorway_risk', 'thin_content_risk', 'missing_metrics',
  'weak_serp_distinction', 'missing_local_proof', 'inventory_limited',
  'partial_evidence', 'slug_conflict',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
export type WarningSeverity = 'info' | 'warning' | 'blocking';
```

- [ ] **Step 3: Write shared types**

Create `workers/src/blueprint/contracts/types.ts`:

```ts
import type {
  ProjectMode, RecommendationStatus, ApprovalStatus, PageType,
  WarningCode, WarningSeverity,
} from './enums';

export interface ServiceInput {
  clientId: string;
  name: string;
  description?: string;
  priority?: 'primary' | 'secondary';
}

export interface ServiceAreaInput {
  clientId: string;
  city: string;
  region?: string;
  countryIso: string;
  radiusKm?: number;
  isPrimary: boolean;
  uniqueProof?: string[];
}

export interface ProjectBriefInput {
  businessName: string;
  category: string;
  websiteUrl?: string;
  countryIso: string;
  languageCode: string;
  services: ServiceInput[];
  serviceAreas: ServiceAreaInput[];
  targetCustomers?: string[];
  differentiators?: string[];
  knownCompetitorDomains?: string[];
  excludedDomains?: string[];
  excludedTopics?: string[];
  goals?: Array<'leads' | 'local_visibility' | 'authority'>;
  maxRecommendedPages?: number;
  enableUsFanout?: boolean;
}

export interface NormalizedProjectBrief {
  mode: ProjectMode;
  businessName: string;
  normalizedBusinessName: string;
  category: string;
  websiteDomain: string | null;
  websiteUrl: string | null;
  countryIso: string;
  languageCode: string;
  services: Array<{
    id: string;
    name: string;
    normalizedName: string;
    description: string | null;
    synonyms: string[];
    priority: 'primary' | 'secondary';
  }>;
  serviceAreas: Array<{
    id: string;
    city: string;
    region: string | null;
    countryIso: string;
    radiusKm: number | null;
    isPrimary: boolean;
    uniqueProof: string[];
  }>;
  targetCustomers: string[];
  differentiators: Array<{ id: string; text: string }>;
  knownCompetitorDomains: string[];
  excludedDomains: string[];
  excludedTopics: string[];
  goals: Array<'leads' | 'local_visibility' | 'authority'>;
  maxRecommendedPages: number;
  enableUsFanout: boolean;
  inputHash: string;
}

// Missing metrics are null, NEVER 0 (handoff acceptance rule).
export interface KeywordMetrics {
  searchVolume: number | null;
  cpcUsd: number | null;
  difficulty: number | null;
}

export interface KeywordCandidate {
  keyword: string;
  source: string; // e.g. 'keyword_ideas', 'suggestions', 'fixture'
  metrics: KeywordMetrics;
  evidenceRefs: string[];
}

export interface MergedKeyword {
  normalizedKeyword: string;
  variants: string[];
  sources: string[];
  metrics: KeywordMetrics;
  evidenceRefs: string[];
}

export interface KeywordUniverse {
  keywords: MergedKeyword[];
}

// Alias: scoring consumes merged evidence-backed keywords.
export type KeywordEvidence = MergedKeyword;

export interface ScoreComponent {
  key: string;
  weight: number;
  rawValue: number;
  contribution: number;
}

export interface ScoreBreakdown {
  total: number; // clamped 0..1
  components: ScoreComponent[];
}

export interface BlueprintWarning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  relatedPageIds: string[];
  evidenceRefIds: string[];
}

export interface BlueprintPageNode {
  id: string;
  parentId: string | null;
  type: PageType;
  title: string;
  slug: string;
  primaryKeywordNormalized: string | null;
  recommendation: RecommendationStatus;
  approval: ApprovalStatus;
}

export interface PageCandidate {
  clientId: string;
  type: PageType;
  title: string;
  proposedSlug: string;
  serviceId: string | null;
  serviceAreaId: string | null;
  primaryKeywordNormalized: string | null;
  uniqueProof: string[];
}

// Minimal cluster surface needed by Phase 1 guardrails; full model lands Phase 4.
export interface KeywordClusterSummary {
  id: string;
  label: string;
  keywordCount: number;
  totalSearchVolume: number | null;
  hasLocalizedEvidence: boolean;
}
```

- [ ] **Step 4: Write limits**

Create `workers/src/blueprint/contracts/limits.ts`:

```ts
export interface ProductLimits {
  maxServices: number;
  maxServiceAreas: number;
  defaultMaxRecommendedPages: number;
  maxRecommendedPages: number;
  maxSeedQueries: number;
}

// V1 boundary from the handoff README: up to 10 services and 5 service areas.
export const V1_LIMITS: ProductLimits = {
  maxServices: 10,
  maxServiceAreas: 5,
  defaultMaxRecommendedPages: 30,
  maxRecommendedPages: 150,
  maxSeedQueries: 200, // one Keyword Ideas task accepts up to 200 seeds
};
```

- [ ] **Step 5: Write the enum test and run**

Create `workers/src/blueprint/contracts/enums.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BLUEPRINT_STAGES, PAGE_TYPES, EVIDENCE_KINDS, WARNING_CODES } from './enums';

describe('contract enums match the handoff', () => {
  it('has 19 pipeline stages, publish last', () => {
    expect(BLUEPRINT_STAGES).toHaveLength(19);
    expect(BLUEPRINT_STAGES[0]).toBe('validate_intake');
    expect(BLUEPRINT_STAGES[18]).toBe('publish_blueprint');
  });
  it('has 10 page types, 10 evidence kinds, 9 warning codes', () => {
    expect(PAGE_TYPES).toHaveLength(10);
    expect(EVIDENCE_KINDS).toHaveLength(10);
    expect(WARNING_CODES).toHaveLength(9);
  });
});
```

```bash
cd workers && npx vitest run src/blueprint/contracts/enums.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git add datawise-seo-insight-main/workers/package.json datawise-seo-insight-main/workers/package-lock.json datawise-seo-insight-main/workers/src/blueprint/contracts
git commit -m "feat(blueprint): contracts (enums, types, limits) from handoff"
```

---

### Task 8: Hashing primitives (`hashNormalizedInput`, `buildStageInputHash`)

**Files:**
- Create: `workers/src/blueprint/domain/hash.ts`
- Test: `workers/src/blueprint/domain/hash.test.ts`

**Interfaces:**
- Produces: `canonicalize(value: unknown): string`; `hashNormalizedInput(value: unknown): Promise<string>` (64-char hex); `buildStageInputHash(input: { runId: string; stage: BlueprintStage; normalizedInputHash: string; evidenceHash?: string; promptVersion?: string; schemaVersion?: string; schemaHash?: string; rulesetVersion?: string; modelPolicyVersion?: string }): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/domain/hash.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalize, hashNormalizedInput, buildStageInputHash } from './hash';

describe('canonicalize', () => {
  it('is stable across object key order, recursively', () => {
    expect(canonicalize({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } }))
      .toBe(canonicalize({ a: { c: 3, d: [2, { y: 2, z: 1 }] }, b: 1 }));
  });
  it('preserves array order', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
});

describe('hashNormalizedInput', () => {
  it('returns 64-char hex, equal for equivalent objects, different for different values', async () => {
    const a = await hashNormalizedInput({ x: 1, y: 'a' });
    const b = await hashNormalizedInput({ y: 'a', x: 1 });
    const c = await hashNormalizedInput({ x: 2, y: 'a' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('buildStageInputHash', () => {
  it('changes when any component changes', async () => {
    const base = { runId: 'r1', stage: 'validate_intake' as const, normalizedInputHash: 'h1' };
    const h1 = await buildStageInputHash(base);
    const h2 = await buildStageInputHash({ ...base, normalizedInputHash: 'h2' });
    const h3 = await buildStageInputHash({ ...base, promptVersion: 'p1' });
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** (`npx vitest run src/blueprint/domain/hash.test.ts`)

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/hash.ts`:

```ts
import type { BlueprintStage } from '../contracts/enums';

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortValue(obj[key]);
    return out;
  }
  return v;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashNormalizedInput(value: unknown): Promise<string> {
  return sha256Hex(canonicalize(value));
}

export async function buildStageInputHash(input: {
  runId: string;
  stage: BlueprintStage;
  normalizedInputHash: string;
  evidenceHash?: string;
  promptVersion?: string;
  schemaVersion?: string;
  schemaHash?: string;
  rulesetVersion?: string;
  modelPolicyVersion?: string;
}): Promise<string> {
  return hashNormalizedInput(input);
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git add datawise-seo-insight-main/workers/src/blueprint/domain/hash.ts datawise-seo-insight-main/workers/src/blueprint/domain/hash.test.ts
git commit -m "feat(blueprint): canonical hashing primitives"
```

---

### Task 9: URL and domain normalization

**Files:**
- Create: `workers/src/blueprint/domain/errors.ts`, `workers/src/blueprint/domain/url.ts`
- Test: `workers/src/blueprint/domain/url.test.ts`

**Interfaces:**
- Produces: `BlueprintValidationError` (with `code` and `fieldErrors`); `normalizeDomain(input: string): string`; `normalizeAbsoluteUrl(input: string): URL`.

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/domain/url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeDomain, normalizeAbsoluteUrl } from './url';
import { BlueprintValidationError } from './errors';

describe('normalizeDomain', () => {
  it('strips scheme, path, port, credentials, and safe www', () => {
    expect(normalizeDomain('https://user:pw@WWW.Example.com:8080/path?q=1')).toBe('example.com');
    expect(normalizeDomain('example.co.uk')).toBe('example.co.uk');
    expect(normalizeDomain('www.example.com')).toBe('example.com');
  });
  it('keeps www when it IS the registrable name', () => {
    expect(normalizeDomain('www.com')).toBe('www.com');
  });
  it('rejects garbage', () => {
    expect(() => normalizeDomain('not a domain')).toThrow(BlueprintValidationError);
    expect(() => normalizeDomain('')).toThrow(BlueprintValidationError);
  });
});

describe('normalizeAbsoluteUrl', () => {
  it('accepts http/https only', () => {
    expect(normalizeAbsoluteUrl('https://example.com/a').href).toBe('https://example.com/a');
    expect(() => normalizeAbsoluteUrl('ftp://example.com')).toThrow(BlueprintValidationError);
    expect(() => normalizeAbsoluteUrl('javascript:alert(1)')).toThrow(BlueprintValidationError);
  });
  it('rejects credentials and fragments', () => {
    expect(() => normalizeAbsoluteUrl('https://u:p@example.com')).toThrow(BlueprintValidationError);
    expect(() => normalizeAbsoluteUrl('https://example.com/#frag')).toThrow(BlueprintValidationError);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/errors.ts`:

```ts
export interface FieldError {
  path: string;
  message: string;
}

export class BlueprintValidationError extends Error {
  constructor(
    public code: 'invalid_input' | 'invalid_domain' | 'invalid_url',
    public fieldErrors: FieldError[] = []
  ) {
    super(fieldErrors[0]?.message ?? code);
    this.name = 'BlueprintValidationError';
  }
}
```

Create `workers/src/blueprint/domain/url.ts`:

```ts
import { BlueprintValidationError } from './errors';

export function normalizeDomain(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw || /\s/.test(raw)) {
    throw new BlueprintValidationError('invalid_domain', [{ path: 'domain', message: `Invalid domain: ${input}` }]);
  }
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new BlueprintValidationError('invalid_domain', [{ path: 'domain', message: `Invalid domain: ${input}` }]);
  }
  let host = url.hostname;
  if (!host.includes('.')) {
    throw new BlueprintValidationError('invalid_domain', [{ path: 'domain', message: `Invalid domain: ${input}` }]);
  }
  // Strip leading www only when a registrable name remains (www.example.com -> example.com, but www.com stays).
  if (host.startsWith('www.') && host.split('.').length > 2) host = host.slice(4);
  return host;
}

export function normalizeAbsoluteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new BlueprintValidationError('invalid_url', [{ path: 'url', message: `Invalid URL: ${input}` }]);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlueprintValidationError('invalid_url', [{ path: 'url', message: 'Only http/https URLs are allowed' }]);
  }
  if (url.username || url.password) {
    throw new BlueprintValidationError('invalid_url', [{ path: 'url', message: 'URLs with credentials are not allowed' }]);
  }
  if (url.hash) {
    throw new BlueprintValidationError('invalid_url', [{ path: 'url', message: 'URL fragments are not allowed' }]);
  }
  return url;
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit** (`git add` the three files, message `feat(blueprint): domain and URL normalization`)

---

### Task 10: Keyword and slug normalization

**Files:**
- Create: `workers/src/blueprint/domain/keyword.ts`, `workers/src/blueprint/domain/slug.ts`
- Test: `workers/src/blueprint/domain/keyword.test.ts`, `workers/src/blueprint/domain/slug.test.ts`

**Interfaces:**
- Produces: `normalizeKeyword(input: string, locale: string): string`; `normalizeSlug(input: string): string` (root-relative, lowercase, trailing slash; home is `/`).

- [ ] **Step 1: Write the failing tests**

Create `workers/src/blueprint/domain/keyword.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeKeyword } from './keyword';

describe('normalizeKeyword', () => {
  it('lowercases, trims, collapses whitespace, strips noise punctuation', () => {
    expect(normalizeKeyword('  Plumber   Near Me!! ', 'en-US')).toBe('plumber near me');
    expect(normalizeKeyword('“best” plumber, austin?', 'en-US')).toBe('best plumber austin');
  });
  it('preserves meaningful tokens: hyphens, apostrophes, accents, locality', () => {
    expect(normalizeKeyword("women's co-working space", 'en-US')).toBe("women's co-working space");
    expect(normalizeKeyword('Fontanería MÁLAGA', 'es-ES')).toBe('fontanería málaga');
  });
  it('applies unicode NFKC (fullwidth to ascii)', () => {
    expect(normalizeKeyword('ｓｅｏ ａｕｄｉｔ', 'en-US')).toBe('seo audit');
  });
});
```

Create `workers/src/blueprint/domain/slug.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeSlug } from './slug';

describe('normalizeSlug', () => {
  it('produces root-relative lowercase paths with one trailing slash', () => {
    expect(normalizeSlug('Emergency Plumbing')).toBe('/emergency-plumbing/');
    expect(normalizeSlug('/services/Drain-Cleaning')).toBe('/services/drain-cleaning/');
    expect(normalizeSlug('https://example.com/Services/AC Repair/')).toBe('/services/ac-repair/');
  });
  it('transliterates accents and strips unsafe characters', () => {
    expect(normalizeSlug('fontanería málaga')).toBe('/fontaneria-malaga/');
    expect(normalizeSlug('a&b (c)')).toBe('/a-b-c/');
  });
  it('home path stays /', () => {
    expect(normalizeSlug('/')).toBe('/');
    expect(normalizeSlug('')).toBe('/');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/keyword.ts`:

```ts
// Unicode-normalizes, case-folds, and removes meaningless punctuation while
// preserving tokens that change meaning (hyphens, apostrophes, accents).
export function normalizeKeyword(input: string, locale: string): string {
  return input
    .normalize('NFKC')
    .toLocaleLowerCase(locale)
    .replace(/[‘’]/g, "'")
    .replace(/[“”"]/g, ' ')
    .replace(/[!?.,;:()\[\]{}<>|@#$%^*+=~`\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

Create `workers/src/blueprint/domain/slug.ts`:

```ts
// Root-relative, lowercase, ascii-safe path with a single trailing slash policy.
export function normalizeSlug(input: string): string {
  const withoutOrigin = input.trim().replace(/^https?:\/\/[^/]+/i, '');
  const segments = withoutOrigin
    .split('/')
    .map((segment) =>
      segment
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean);
  return segments.length ? `/${segments.join('/')}/` : '/';
}
```

- [ ] **Step 4: Run both test files to verify PASS**, then **Step 5: Commit** (`feat(blueprint): keyword and slug normalization`)

---

### Task 11: Brief parsing and normalization

**Files:**
- Create: `workers/src/blueprint/domain/brief.ts`
- Test: `workers/src/blueprint/domain/brief.test.ts`

**Interfaces:**
- Consumes: `normalizeDomain`, `normalizeKeyword`, `hashNormalizedInput`, `BlueprintValidationError`, contracts types, `V1_LIMITS`.
- Produces: `parseProjectBrief(input: unknown): ProjectBriefInput` (throws `BlueprintValidationError` with field errors); `normalizeProjectBrief(input: ProjectBriefInput, limits: ProductLimits): Promise<NormalizedProjectBrief>` (async because it computes `inputHash`; deviation from the catalog's sync signature is deliberate, noted in a comment).

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/domain/brief.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseProjectBrief, normalizeProjectBrief } from './brief';
import { BlueprintValidationError } from './errors';
import { V1_LIMITS } from '../contracts/limits';

const validInput = {
  businessName: '  Aqua Plumbing  ',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'EN',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning', priority: 'secondary' },
  ],
  serviceAreas: [
    { clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true, uniqueProof: ['Office on South Lamar'] },
    { clientId: 'a2', city: 'Round Rock', countryIso: 'us', isPrimary: false },
  ],
  excludedTopics: ['Jobs', 'jobs'],
  knownCompetitorDomains: ['https://www.rivalplumbing.com/'],
};

describe('parseProjectBrief', () => {
  it('accepts a valid brief', () => {
    expect(parseProjectBrief(validInput).businessName).toBe('Aqua Plumbing');
  });
  it('rejects more than 10 services with a field error', () => {
    const services = Array.from({ length: 11 }, (_, i) => ({ clientId: `s${i}`, name: `Service ${i}` }));
    try {
      parseProjectBrief({ ...validInput, services });
      expect.unreachable('should throw');
    } catch (e) {
      const err = e as BlueprintValidationError;
      expect(err.code).toBe('invalid_input');
      expect(err.fieldErrors.some((f) => f.path.startsWith('services'))).toBe(true);
    }
  });
  it('rejects more than 5 service areas, missing services, bad country code', () => {
    expect(() => parseProjectBrief({ ...validInput, serviceAreas: Array.from({ length: 6 }, (_, i) => ({ clientId: `a${i}`, city: `C${i}`, countryIso: 'us', isPrimary: i === 0 })) })).toThrow(BlueprintValidationError);
    expect(() => parseProjectBrief({ ...validInput, services: [] })).toThrow(BlueprintValidationError);
    expect(() => parseProjectBrief({ ...validInput, countryIso: 'usa' })).toThrow(BlueprintValidationError);
  });
  it('rejects zero or multiple primary areas when areas exist', () => {
    const noPrimary = validInput.serviceAreas.map((a) => ({ ...a, isPrimary: false }));
    const twoPrimary = validInput.serviceAreas.map((a) => ({ ...a, isPrimary: true }));
    expect(() => parseProjectBrief({ ...validInput, serviceAreas: noPrimary })).toThrow(BlueprintValidationError);
    expect(() => parseProjectBrief({ ...validInput, serviceAreas: twoPrimary })).toThrow(BlueprintValidationError);
  });
});

describe('normalizeProjectBrief', () => {
  it('normalizes mode, domains, casing, dedupes, defaults, and hashes', async () => {
    const brief = await normalizeProjectBrief(parseProjectBrief(validInput), V1_LIMITS);
    expect(brief.mode).toBe('existing_site');
    expect(brief.websiteDomain).toBe('aquaplumbing.com');
    expect(brief.countryIso).toBe('US');
    expect(brief.languageCode).toBe('en');
    expect(brief.services[0].normalizedName).toBe('emergency plumbing');
    expect(brief.services[0].priority).toBe('primary');
    expect(brief.knownCompetitorDomains).toEqual(['rivalplumbing.com']);
    expect(brief.excludedTopics).toEqual(['jobs']);
    expect(brief.maxRecommendedPages).toBe(V1_LIMITS.defaultMaxRecommendedPages);
    expect(brief.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('greenfield mode when no website', async () => {
    const { websiteUrl, ...rest } = validInput;
    const brief = await normalizeProjectBrief(parseProjectBrief(rest), V1_LIMITS);
    expect(brief.mode).toBe('greenfield');
    expect(brief.websiteDomain).toBeNull();
  });
  it('same input in different key order produces the same inputHash', async () => {
    const a = await normalizeProjectBrief(parseProjectBrief(validInput), V1_LIMITS);
    const reordered = JSON.parse(JSON.stringify(validInput));
    const b = await normalizeProjectBrief(parseProjectBrief(reordered), V1_LIMITS);
    expect(a.inputHash).toBe(b.inputHash);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/brief.ts`:

```ts
import { z } from 'zod';
import type { ProjectBriefInput, NormalizedProjectBrief } from '../contracts/types';
import type { ProductLimits } from '../contracts/limits';
import { BlueprintValidationError } from './errors';
import { normalizeDomain } from './url';
import { normalizeKeyword } from './keyword';
import { hashNormalizedInput } from './hash';

const serviceSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  priority: z.enum(['primary', 'secondary']).optional(),
});

const areaSchema = z.object({
  clientId: z.string().min(1),
  city: z.string().trim().min(1).max(80),
  region: z.string().trim().max(80).optional(),
  countryIso: z.string().length(2),
  radiusKm: z.number().positive().max(500).optional(),
  isPrimary: z.boolean(),
  uniqueProof: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
});

const briefSchema = z
  .object({
    businessName: z.string().trim().min(1).max(120),
    category: z.string().trim().min(1).max(80),
    websiteUrl: z.string().trim().url().optional(),
    countryIso: z.string().length(2),
    languageCode: z.string().trim().min(2).max(8),
    services: z.array(serviceSchema).min(1).max(10),
    serviceAreas: z.array(areaSchema).max(5),
    targetCustomers: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    differentiators: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
    knownCompetitorDomains: z.array(z.string().trim().min(3).max(255)).max(10).optional(),
    excludedDomains: z.array(z.string().trim().min(3).max(255)).max(20).optional(),
    excludedTopics: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    goals: z.array(z.enum(['leads', 'local_visibility', 'authority'])).max(3).optional(),
    maxRecommendedPages: z.number().int().min(5).max(150).optional(),
    enableUsFanout: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.serviceAreas.length > 0) {
      const primaries = val.serviceAreas.filter((a) => a.isPrimary).length;
      if (primaries !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceAreas'],
          message: 'Exactly one service area must be primary',
        });
      }
    }
  });

export function parseProjectBrief(input: unknown): ProjectBriefInput {
  const parsed = briefSchema.safeParse(input);
  if (!parsed.success) {
    throw new BlueprintValidationError(
      'invalid_input',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    );
  }
  return parsed.data as ProjectBriefInput;
}

// Async (catalog lists this sync): inputHash is computed here so a normalized
// brief can never exist without its hash.
export async function normalizeProjectBrief(
  input: ProjectBriefInput,
  limits: ProductLimits
): Promise<NormalizedProjectBrief> {
  const countryIso = input.countryIso.toUpperCase();
  const languageCode = input.languageCode.toLowerCase();
  const locale = `${languageCode}-${countryIso}`;
  const websiteDomain = input.websiteUrl ? normalizeDomain(input.websiteUrl) : null;
  const dedupe = (arr: string[] = []) => [...new Set(arr.map((x) => x.trim()).filter(Boolean))];

  const base = {
    mode: (websiteDomain ? 'existing_site' : 'greenfield') as NormalizedProjectBrief['mode'],
    businessName: input.businessName.trim(),
    normalizedBusinessName: normalizeKeyword(input.businessName, locale),
    category: input.category.trim(),
    websiteDomain,
    websiteUrl: input.websiteUrl ?? null,
    countryIso,
    languageCode,
    services: input.services.map((s) => ({
      id: s.clientId,
      name: s.name.trim(),
      normalizedName: normalizeKeyword(s.name, locale),
      description: s.description?.trim() || null,
      synonyms: [] as string[], // filled by AI normalization stage later; deterministic default is empty
      priority: s.priority ?? ('primary' as const),
    })),
    serviceAreas: input.serviceAreas.map((a) => ({
      id: a.clientId,
      city: a.city.trim(),
      region: a.region?.trim() || null,
      countryIso: a.countryIso.toUpperCase(),
      radiusKm: a.radiusKm ?? null,
      isPrimary: a.isPrimary,
      uniqueProof: a.uniqueProof ?? [],
    })),
    targetCustomers: dedupe(input.targetCustomers),
    differentiators: dedupe(input.differentiators).map((text, i) => ({ id: `diff_${i + 1}`, text })),
    knownCompetitorDomains: [...new Set(dedupe(input.knownCompetitorDomains).map(normalizeDomain))],
    excludedDomains: [...new Set(dedupe(input.excludedDomains).map(normalizeDomain))],
    excludedTopics: [...new Set(dedupe(input.excludedTopics).map((t) => t.toLowerCase()))],
    goals: input.goals && input.goals.length ? input.goals : (['leads'] as const).slice(),
    maxRecommendedPages: Math.min(input.maxRecommendedPages ?? limits.defaultMaxRecommendedPages, limits.maxRecommendedPages),
    enableUsFanout: input.enableUsFanout ?? false,
  };

  const inputHash = await hashNormalizedInput(base);
  return { ...base, inputHash };
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit** (`feat(blueprint): brief parsing and normalization`)

---

### Task 12: Seed planning (`buildSeedQueries`)

**Files:**
- Create: `workers/src/blueprint/domain/seeds.ts`
- Test: `workers/src/blueprint/domain/seeds.test.ts`

**Interfaces:**
- Consumes: `NormalizedProjectBrief`.
- Produces: `SeedPolicy { maxTotalSeeds: number; includePrimaryAreaSeeds: boolean }`, `SeedQuery { query: string; serviceId: string | null; serviceAreaId: string | null; source: 'category' | 'service' | 'service_primary_area' }`, `SeedQueryPlan { seeds: SeedQuery[]; truncated: boolean }`, `buildSeedQueries(brief, policy): SeedQueryPlan`.

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/domain/seeds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSeedQueries } from './seeds';
import { parseProjectBrief, normalizeProjectBrief } from './brief';
import { V1_LIMITS } from '../contracts/limits';

async function makeBrief(serviceCount: number, areaCount: number) {
  return normalizeProjectBrief(
    parseProjectBrief({
      businessName: 'Test Co',
      category: 'Plumber',
      countryIso: 'us',
      languageCode: 'en',
      services: Array.from({ length: serviceCount }, (_, i) => ({ clientId: `s${i}`, name: `Service ${i}` })),
      serviceAreas: Array.from({ length: areaCount }, (_, i) => ({ clientId: `a${i}`, city: `City ${i}`, countryIso: 'us', isPrimary: i === 0 })),
    }),
    V1_LIMITS
  );
}

describe('buildSeedQueries', () => {
  it('never generates the full service x area cross product', async () => {
    const brief = await makeBrief(10, 5);
    const plan = buildSeedQueries(brief, { maxTotalSeeds: 200, includePrimaryAreaSeeds: true });
    // category(1) + services(10) + service x PRIMARY area only(10) = 21, not 1 + 10 + 50
    expect(plan.seeds).toHaveLength(21);
    expect(plan.seeds.filter((s) => s.source === 'service_primary_area')).toHaveLength(10);
    expect(plan.truncated).toBe(false);
  });
  it('dedupes and respects the cap', async () => {
    const brief = await makeBrief(10, 5);
    const plan = buildSeedQueries(brief, { maxTotalSeeds: 5, includePrimaryAreaSeeds: true });
    expect(plan.seeds).toHaveLength(5);
    expect(plan.truncated).toBe(true);
    const keys = plan.seeds.map((s) => s.query);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('works with zero service areas', async () => {
    const brief = await makeBrief(2, 0);
    const plan = buildSeedQueries(brief, { maxTotalSeeds: 200, includePrimaryAreaSeeds: true });
    expect(plan.seeds).toHaveLength(3); // category + 2 services
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/seeds.ts`:

```ts
import type { NormalizedProjectBrief } from '../contracts/types';

export interface SeedPolicy {
  maxTotalSeeds: number;
  includePrimaryAreaSeeds: boolean;
}

export interface SeedQuery {
  query: string;
  serviceId: string | null;
  serviceAreaId: string | null;
  source: 'category' | 'service' | 'service_primary_area';
}

export interface SeedQueryPlan {
  seeds: SeedQuery[];
  truncated: boolean;
}

// Seeds category + each service + each service in the PRIMARY area only.
// Never expands the full service x area cross product (doorway guardrail
// starts at research planning, not just page planning).
export function buildSeedQueries(brief: NormalizedProjectBrief, policy: SeedPolicy): SeedQueryPlan {
  const seeds: SeedQuery[] = [];
  const seen = new Set<string>();
  const push = (query: string, serviceId: string | null, serviceAreaId: string | null, source: SeedQuery['source']) => {
    const key = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (key && !seen.has(key)) {
      seen.add(key);
      seeds.push({ query: key, serviceId, serviceAreaId, source });
    }
  };

  push(brief.category, null, null, 'category');
  for (const service of brief.services) push(service.normalizedName, service.id, null, 'service');

  const primaryArea = brief.serviceAreas.find((a) => a.isPrimary) ?? null;
  if (policy.includePrimaryAreaSeeds && primaryArea) {
    for (const service of brief.services) {
      push(`${service.normalizedName} ${primaryArea.city.toLowerCase()}`, service.id, primaryArea.id, 'service_primary_area');
    }
  }

  return { seeds: seeds.slice(0, policy.maxTotalSeeds), truncated: seeds.length > policy.maxTotalSeeds };
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit** (`feat(blueprint): seed query planning without area cross products`)

---

### Task 13: Keyword merge and dedup (`mergeKeywordCandidates`)

**Files:**
- Create: `workers/src/blueprint/domain/merge.ts`
- Test: `workers/src/blueprint/domain/merge.test.ts`

**Interfaces:**
- Consumes: `KeywordCandidate`, `MergedKeyword`, `KeywordUniverse` from contracts; `normalizeKeyword`.
- Produces: `mergeKeywordCandidates(sources: KeywordCandidate[][], locale: string): KeywordUniverse`.

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/domain/merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeKeywordCandidates } from './merge';
import type { KeywordCandidate } from '../contracts/types';

const cand = (keyword: string, source: string, metrics: Partial<KeywordCandidate['metrics']> = {}, refs: string[] = []): KeywordCandidate => ({
  keyword,
  source,
  metrics: { searchVolume: null, cpcUsd: null, difficulty: null, ...metrics },
  evidenceRefs: refs,
});

describe('mergeKeywordCandidates', () => {
  it('merges semantic variants into one keyword without losing evidence', () => {
    const universe = mergeKeywordCandidates(
      [
        [cand('Emergency Plumber!', 'ideas', { searchVolume: 900 }, ['ev1'])],
        [cand('emergency   plumber', 'suggestions', { cpcUsd: 4.2 }, ['ev2'])],
      ],
      'en-US'
    );
    expect(universe.keywords).toHaveLength(1);
    const kw = universe.keywords[0];
    expect(kw.normalizedKeyword).toBe('emergency plumber');
    expect(kw.variants).toEqual(['Emergency Plumber!', 'emergency   plumber']);
    expect(kw.sources).toEqual(['ideas', 'suggestions']);
    expect(kw.evidenceRefs).toEqual(['ev1', 'ev2']);
    expect(kw.metrics).toEqual({ searchVolume: 900, cpcUsd: 4.2, difficulty: null });
  });
  it('keeps first non-null metric, never converts null to 0', () => {
    const universe = mergeKeywordCandidates(
      [[cand('a', 's1', { searchVolume: 100 })], [cand('a', 's2', { searchVolume: 500 })]],
      'en-US'
    );
    expect(universe.keywords[0].metrics.searchVolume).toBe(100);
    const empty = mergeKeywordCandidates([[cand('b', 's1')]], 'en-US');
    expect(empty.keywords[0].metrics.searchVolume).toBeNull();
  });
  it('drops empty keywords and dedupes evidence refs', () => {
    const universe = mergeKeywordCandidates([[cand('  ', 's1'), cand('x', 's1', {}, ['e', 'e'])]], 'en-US');
    expect(universe.keywords).toHaveLength(1);
    expect(universe.keywords[0].evidenceRefs).toEqual(['e']);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/merge.ts`:

```ts
import type { KeywordCandidate, KeywordUniverse, MergedKeyword } from '../contracts/types';
import { normalizeKeyword } from './keyword';

export function mergeKeywordCandidates(sources: KeywordCandidate[][], locale: string): KeywordUniverse {
  const byNormalized = new Map<string, MergedKeyword>();

  for (const batch of sources) {
    for (const candidate of batch) {
      const normalized = normalizeKeyword(candidate.keyword, locale);
      if (!normalized) continue;
      const existing = byNormalized.get(normalized);
      if (!existing) {
        byNormalized.set(normalized, {
          normalizedKeyword: normalized,
          variants: [candidate.keyword],
          sources: [candidate.source],
          metrics: { ...candidate.metrics },
          evidenceRefs: [...new Set(candidate.evidenceRefs)],
        });
        continue;
      }
      if (!existing.variants.includes(candidate.keyword)) existing.variants.push(candidate.keyword);
      if (!existing.sources.includes(candidate.source)) existing.sources.push(candidate.source);
      // First non-null wins; null stays null until real evidence arrives.
      existing.metrics.searchVolume ??= candidate.metrics.searchVolume;
      existing.metrics.cpcUsd ??= candidate.metrics.cpcUsd;
      existing.metrics.difficulty ??= candidate.metrics.difficulty;
      for (const ref of candidate.evidenceRefs) {
        if (!existing.evidenceRefs.includes(ref)) existing.evidenceRefs.push(ref);
      }
    }
  }

  return { keywords: [...byNormalized.values()] };
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit** (`feat(blueprint): keyword candidate merge preserving evidence and null metrics`)

---

### Task 14: Scoring with missing-value semantics

**Files:**
- Create: `workers/src/blueprint/domain/score.ts`
- Test: `workers/src/blueprint/domain/score.test.ts`

**Interfaces:**
- Consumes: `KeywordEvidence`, `NormalizedProjectBrief`, `ScoreBreakdown`.
- Produces: `KeywordRelevanceRules { weights: { service: number; area: number; category: number }; excludedTopicPenalty: number }`; `OpportunityRules { volumeWeight: number; difficultyWeight: number; volumeCap: number }`; `scoreKeywordRelevance(keyword, brief, rules): ScoreBreakdown`; `scoreKeywordOpportunity(keyword, rules): ScoreBreakdown | null` (null when volume or difficulty missing).

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/domain/score.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreKeywordRelevance, scoreKeywordOpportunity } from './score';
import type { KeywordEvidence, NormalizedProjectBrief } from '../contracts/types';

const kw = (normalizedKeyword: string, metrics: Partial<KeywordEvidence['metrics']> = {}): KeywordEvidence => ({
  normalizedKeyword,
  variants: [normalizedKeyword],
  sources: ['fixture'],
  metrics: { searchVolume: null, cpcUsd: null, difficulty: null, ...metrics },
  evidenceRefs: ['ev1'],
});

const brief = {
  services: [{ id: 's1', name: 'Drain Cleaning', normalizedName: 'drain cleaning', description: null, synonyms: [], priority: 'primary' }],
  serviceAreas: [{ id: 'a1', city: 'Austin', region: null, countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: [] }],
  category: 'plumber',
  excludedTopics: ['jobs'],
} as unknown as NormalizedProjectBrief;

const relevanceRules = { weights: { service: 0.5, area: 0.3, category: 0.2 }, excludedTopicPenalty: 0.5 };

describe('scoreKeywordRelevance', () => {
  it('scores service+area matches above unrelated keywords, with a breakdown', () => {
    const strong = scoreKeywordRelevance(kw('drain cleaning austin'), brief, relevanceRules);
    const weak = scoreKeywordRelevance(kw('crypto exchange'), brief, relevanceRules);
    expect(strong.total).toBeGreaterThan(weak.total);
    expect(strong.components.map((c) => c.key)).toContain('service_match');
    expect(strong.total).toBeGreaterThan(0);
    expect(strong.total).toBeLessThanOrEqual(1);
  });
  it('penalizes excluded topics', () => {
    const excluded = scoreKeywordRelevance(kw('plumber jobs'), brief, relevanceRules);
    const clean = scoreKeywordRelevance(kw('plumber'), brief, relevanceRules);
    expect(excluded.total).toBeLessThan(clean.total);
  });
});

describe('scoreKeywordOpportunity', () => {
  const rules = { volumeWeight: 0.6, difficultyWeight: 0.4, volumeCap: 100000 };
  it('returns null when volume or difficulty is missing (never treats missing as 0)', () => {
    expect(scoreKeywordOpportunity(kw('a', { searchVolume: null, difficulty: 40 }), rules)).toBeNull();
    expect(scoreKeywordOpportunity(kw('a', { searchVolume: 100, difficulty: null }), rules)).toBeNull();
  });
  it('scores higher volume and lower difficulty higher', () => {
    const good = scoreKeywordOpportunity(kw('a', { searchVolume: 5000, difficulty: 20 }), rules)!;
    const bad = scoreKeywordOpportunity(kw('a', { searchVolume: 50, difficulty: 80 }), rules)!;
    expect(good.total).toBeGreaterThan(bad.total);
    expect(good.components).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/score.ts`:

```ts
import type { KeywordEvidence, NormalizedProjectBrief, ScoreBreakdown, ScoreComponent } from '../contracts/types';

export interface KeywordRelevanceRules {
  weights: { service: number; area: number; category: number };
  excludedTopicPenalty: number;
}

export interface OpportunityRules {
  volumeWeight: number;
  difficultyWeight: number;
  volumeCap: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function tokenOverlap(keywordTokens: Set<string>, text: string): number {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const hits = tokens.filter((t) => keywordTokens.has(t)).length;
  return hits / tokens.length;
}

export function scoreKeywordRelevance(
  keyword: KeywordEvidence,
  brief: NormalizedProjectBrief,
  rules: KeywordRelevanceRules
): ScoreBreakdown {
  const tokens = new Set(keyword.normalizedKeyword.split(' '));
  const serviceScore = Math.max(0, ...brief.services.map((s) => tokenOverlap(tokens, s.normalizedName)));
  const areaScore = Math.max(0, ...brief.serviceAreas.map((a) => tokenOverlap(tokens, a.city)));
  const categoryScore = tokenOverlap(tokens, brief.category);
  const excludedPenalty = brief.excludedTopics.some((t) => keyword.normalizedKeyword.includes(t))
    ? rules.excludedTopicPenalty
    : 0;

  const components: ScoreComponent[] = [
    { key: 'service_match', weight: rules.weights.service, rawValue: serviceScore, contribution: serviceScore * rules.weights.service },
    { key: 'area_match', weight: rules.weights.area, rawValue: areaScore, contribution: areaScore * rules.weights.area },
    { key: 'category_match', weight: rules.weights.category, rawValue: categoryScore, contribution: categoryScore * rules.weights.category },
    { key: 'excluded_topic_penalty', weight: 1, rawValue: excludedPenalty, contribution: -excludedPenalty },
  ];
  return { total: clamp01(components.reduce((sum, c) => sum + c.contribution, 0)), components };
}

// Returns null when required inputs are missing; never converts missing to zero.
export function scoreKeywordOpportunity(keyword: KeywordEvidence, rules: OpportunityRules): ScoreBreakdown | null {
  const { searchVolume, difficulty } = keyword.metrics;
  if (searchVolume === null || difficulty === null) return null;

  const volumeScore = clamp01(Math.log10(searchVolume + 1) / Math.log10(rules.volumeCap + 1));
  const easeScore = clamp01(1 - difficulty / 100);
  const components: ScoreComponent[] = [
    { key: 'volume', weight: rules.volumeWeight, rawValue: searchVolume, contribution: volumeScore * rules.volumeWeight },
    { key: 'ease', weight: rules.difficultyWeight, rawValue: difficulty, contribution: easeScore * rules.difficultyWeight },
  ];
  return { total: clamp01(components.reduce((sum, c) => sum + c.contribution, 0)), components };
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit** (`feat(blueprint): relevance and opportunity scoring with null semantics`)

---

### Task 15: Graph and slug validators

**Files:**
- Create: `workers/src/blueprint/domain/graph.ts`
- Test: `workers/src/blueprint/domain/graph.test.ts`

**Interfaces:**
- Consumes: `BlueprintPageNode`; `normalizeSlug`.
- Produces: `SlugValidation { valid: boolean; conflictPageIds: string[] }`; `validateSlugUniqueness(slug: string, pages: readonly BlueprintPageNode[], currentPageId?: string): SlugValidation`; `GraphError { code: 'no_root' | 'multiple_roots' | 'orphan' | 'cycle' | 'duplicate_slug' | 'duplicate_primary_keyword'; pageIds: string[]; message: string }`; `validateBlueprintGraph(pages: readonly BlueprintPageNode[]): { valid: boolean; errors: GraphError[] }`.

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/domain/graph.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSlugUniqueness, validateBlueprintGraph } from './graph';
import type { BlueprintPageNode } from '../contracts/types';

const page = (id: string, parentId: string | null, slug: string, primary: string | null = null, type: BlueprintPageNode['type'] = 'service'): BlueprintPageNode => ({
  id, parentId, type, title: id, slug, primaryKeywordNormalized: primary,
  recommendation: 'create', approval: 'proposed',
});

const validTree = [
  page('home', null, '/', 'plumber austin', 'home'),
  page('svc', 'home', '/services/', 'plumbing services', 'hub'),
  page('drain', 'svc', '/services/drain-cleaning/', 'drain cleaning austin'),
];

describe('validateSlugUniqueness', () => {
  it('detects conflicts after normalization, excluding the current page', () => {
    expect(validateSlugUniqueness('/services/Drain-Cleaning', validTree)).toEqual({ valid: false, conflictPageIds: ['drain'] });
    expect(validateSlugUniqueness('/services/drain-cleaning/', validTree, 'drain').valid).toBe(true);
    expect(validateSlugUniqueness('/new-page/', validTree).valid).toBe(true);
  });
});

describe('validateBlueprintGraph', () => {
  it('accepts a valid tree', () => {
    expect(validateBlueprintGraph(validTree)).toEqual({ valid: true, errors: [] });
  });
  it('rejects duplicate slugs and duplicate primary keywords', () => {
    const dupSlug = [...validTree, page('x', 'home', '/services/drain-cleaning/')];
    expect(validateBlueprintGraph(dupSlug).errors.some((e) => e.code === 'duplicate_slug')).toBe(true);
    const dupKw = [...validTree, page('y', 'home', '/other/', 'drain cleaning austin')];
    expect(validateBlueprintGraph(dupKw).errors.some((e) => e.code === 'duplicate_primary_keyword')).toBe(true);
  });
  it('rejects cycles, orphans, missing root, multiple roots', () => {
    const cycle = [page('a', 'b', '/a/'), page('b', 'a', '/b/')];
    expect(validateBlueprintGraph(cycle).errors.some((e) => e.code === 'cycle')).toBe(true);
    const orphan = [...validTree, page('lost', 'ghost', '/lost/')];
    expect(validateBlueprintGraph(orphan).errors.some((e) => e.code === 'orphan')).toBe(true);
    expect(validateBlueprintGraph(cycle).errors.some((e) => e.code === 'no_root')).toBe(true);
    const twoRoots = [...validTree, page('root2', null, '/root2/', null, 'home')];
    expect(validateBlueprintGraph(twoRoots).errors.some((e) => e.code === 'multiple_roots')).toBe(true);
  });
  it('ignores rejected pages for slug/keyword uniqueness', () => {
    const rejected = { ...page('z', 'home', '/services/drain-cleaning/', 'drain cleaning austin'), approval: 'rejected' as const };
    expect(validateBlueprintGraph([...validTree, rejected]).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/graph.ts`:

```ts
import type { BlueprintPageNode } from '../contracts/types';
import { normalizeSlug } from './slug';

export interface SlugValidation {
  valid: boolean;
  conflictPageIds: string[];
}

export interface GraphError {
  code: 'no_root' | 'multiple_roots' | 'orphan' | 'cycle' | 'duplicate_slug' | 'duplicate_primary_keyword';
  pageIds: string[];
  message: string;
}

const isActive = (p: BlueprintPageNode) => p.approval !== 'rejected';

export function validateSlugUniqueness(
  slug: string,
  pages: readonly BlueprintPageNode[],
  currentPageId?: string
): SlugValidation {
  const normalized = normalizeSlug(slug);
  const conflictPageIds = pages
    .filter((p) => p.id !== currentPageId && isActive(p) && normalizeSlug(p.slug) === normalized)
    .map((p) => p.id);
  return { valid: conflictPageIds.length === 0, conflictPageIds };
}

export function validateBlueprintGraph(pages: readonly BlueprintPageNode[]): { valid: boolean; errors: GraphError[] } {
  const errors: GraphError[] = [];
  const byId = new Map(pages.map((p) => [p.id, p]));

  const roots = pages.filter((p) => p.parentId === null);
  if (roots.length === 0) errors.push({ code: 'no_root', pageIds: [], message: 'Blueprint has no root page.' });
  if (roots.length > 1) errors.push({ code: 'multiple_roots', pageIds: roots.map((r) => r.id), message: 'Blueprint has more than one root page.' });

  for (const p of pages) {
    if (p.parentId !== null && !byId.has(p.parentId)) {
      errors.push({ code: 'orphan', pageIds: [p.id], message: `Page ${p.id} references missing parent ${p.parentId}.` });
    }
  }

  const inCycle = new Set<string>();
  for (const p of pages) {
    if (inCycle.has(p.id)) continue;
    const seen = new Set<string>([p.id]);
    let cursor = p.parentId;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        for (const id of seen) inCycle.add(id);
        errors.push({ code: 'cycle', pageIds: [...seen], message: `Hierarchy cycle involving ${[...seen].join(', ')}.` });
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const bySlug = new Map<string, string[]>();
  const byPrimaryKeyword = new Map<string, string[]>();
  for (const p of pages.filter(isActive)) {
    const slugKey = normalizeSlug(p.slug);
    bySlug.set(slugKey, [...(bySlug.get(slugKey) ?? []), p.id]);
    if (p.primaryKeywordNormalized) {
      byPrimaryKeyword.set(p.primaryKeywordNormalized, [...(byPrimaryKeyword.get(p.primaryKeywordNormalized) ?? []), p.id]);
    }
  }
  for (const [slug, ids] of bySlug) {
    if (ids.length > 1) errors.push({ code: 'duplicate_slug', pageIds: ids, message: `Slug ${slug} is used by ${ids.length} active pages.` });
  }
  for (const [keyword, ids] of byPrimaryKeyword) {
    if (ids.length > 1) errors.push({ code: 'duplicate_primary_keyword', pageIds: ids, message: `Primary keyword "${keyword}" is assigned to ${ids.length} active pages.` });
  }

  return { valid: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit** (`feat(blueprint): blueprint graph and slug validators`)

---

### Task 16: Doorway guardrails

**Files:**
- Create: `workers/src/blueprint/domain/doorway.ts`
- Test: `workers/src/blueprint/domain/doorway.test.ts`

**Interfaces:**
- Consumes: `NormalizedProjectBrief`, `PageCandidate`, `KeywordClusterSummary`, `BlueprintWarning`.
- Produces: `DoorwayGuardrailRules { requireLocalEvidence: boolean; requireUniqueProof: boolean; minClusterVolume: number | null }`; `ServiceLocationDecision { allowed: boolean; reasons: string[]; warnings: BlueprintWarning[] }`; `evaluateServiceLocationPage(service, area, cluster, rules): ServiceLocationDecision` (service/area use the `NormalizedProjectBrief` element types); `detectDoorwayRisk(candidate: PageCandidate, siblingCandidates: PageCandidate[], brief: NormalizedProjectBrief, rules: DoorwayGuardrailRules): BlueprintWarning[]`.

- [ ] **Step 1: Write the failing test**

Create `workers/src/blueprint/domain/doorway.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { evaluateServiceLocationPage, detectDoorwayRisk } from './doorway';
import type { NormalizedProjectBrief, PageCandidate, KeywordClusterSummary } from '../contracts/types';

const service = { id: 's1', name: 'Drain Cleaning', normalizedName: 'drain cleaning', description: null, synonyms: [], priority: 'primary' as const };
const areaWithProof = { id: 'a1', city: 'Austin', region: null, countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: ['Local crew based on South Lamar'] };
const areaNoProof = { id: 'a2', city: 'Round Rock', region: null, countryIso: 'US', radiusKm: null, isPrimary: false, uniqueProof: [] };
const cluster: KeywordClusterSummary = { id: 'c1', label: 'drain cleaning austin', keywordCount: 8, totalSearchVolume: 1400, hasLocalizedEvidence: true };
const rules = { requireLocalEvidence: true, requireUniqueProof: true, minClusterVolume: 50 };
const brief = { excludedTopics: [] } as unknown as NormalizedProjectBrief;

describe('evaluateServiceLocationPage', () => {
  it('allows a localized page with demand evidence and unique proof', () => {
    const d = evaluateServiceLocationPage(service, areaWithProof, cluster, rules);
    expect(d.allowed).toBe(true);
    expect(d.reasons).toEqual([]);
  });
  it('denies when there is no local demand evidence (cluster null)', () => {
    const d = evaluateServiceLocationPage(service, areaWithProof, null, rules);
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('no_local_demand_evidence');
  });
  it('denies when the area has no unique proof, with a missing_local_proof warning', () => {
    const d = evaluateServiceLocationPage(service, areaNoProof, cluster, rules);
    expect(d.allowed).toBe(false);
    expect(d.warnings.some((w) => w.code === 'missing_local_proof')).toBe(true);
  });
  it('null cluster volume produces missing_metrics warning, not a zero-volume denial', () => {
    const noVolume = { ...cluster, totalSearchVolume: null };
    const d = evaluateServiceLocationPage(service, areaWithProof, noVolume, rules);
    expect(d.allowed).toBe(true);
    expect(d.warnings.some((w) => w.code === 'missing_metrics')).toBe(true);
  });
  it('denies below the volume floor', () => {
    const tiny = { ...cluster, totalSearchVolume: 10 };
    const d = evaluateServiceLocationPage(service, areaWithProof, tiny, rules);
    expect(d.allowed).toBe(false);
    expect(d.reasons).toContain('below_volume_floor');
  });
});

describe('detectDoorwayRisk', () => {
  const candidate = (clientId: string, city: string, proof: string[] = []): PageCandidate => ({
    clientId, type: 'service_location', title: `Drain Cleaning ${city}`,
    proposedSlug: `/drain-cleaning-${city.toLowerCase().replace(/\s+/g, '-')}/`,
    serviceId: 's1', serviceAreaId: city, primaryKeywordNormalized: `drain cleaning ${city.toLowerCase()}`,
    uniqueProof: proof,
  });
  it('flags location-swap siblings without unique proof as doorway risk', () => {
    const warnings = detectDoorwayRisk(candidate('p1', 'Austin'), [candidate('p2', 'Round Rock'), candidate('p3', 'Pflugerville')], brief, rules);
    expect(warnings.some((w) => w.code === 'doorway_risk')).toBe(true);
    expect(warnings.some((w) => w.code === 'thin_content_risk')).toBe(true);
  });
  it('does not flag when the candidate has unique local proof', () => {
    const warnings = detectDoorwayRisk(candidate('p1', 'Austin', ['Dedicated Austin crew', 'Austin case studies']), [candidate('p2', 'Round Rock')], brief, rules);
    expect(warnings.some((w) => w.code === 'thin_content_risk')).toBe(false);
  });
  it('non service_location candidates produce no doorway warnings', () => {
    const svc: PageCandidate = { ...candidate('p1', 'Austin'), type: 'service' };
    expect(detectDoorwayRisk(svc, [], brief, rules)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

- [ ] **Step 3: Implement**

Create `workers/src/blueprint/domain/doorway.ts`:

```ts
import type {
  BlueprintWarning, KeywordClusterSummary, NormalizedProjectBrief, PageCandidate,
} from '../contracts/types';

type Service = NormalizedProjectBrief['services'][number];
type ServiceArea = NormalizedProjectBrief['serviceAreas'][number];

export interface DoorwayGuardrailRules {
  requireLocalEvidence: boolean;
  requireUniqueProof: boolean;
  minClusterVolume: number | null;
}

export interface ServiceLocationDecision {
  allowed: boolean;
  reasons: string[];
  warnings: BlueprintWarning[];
}

function warn(code: BlueprintWarning['code'], severity: BlueprintWarning['severity'], message: string): BlueprintWarning {
  return { code, severity, message, relatedPageIds: [], evidenceRefIds: [] };
}

// A service x location page must EARN its URL: local demand evidence plus
// unique local proof. Combinations are never generated automatically.
export function evaluateServiceLocationPage(
  service: Service,
  area: ServiceArea,
  cluster: KeywordClusterSummary | null,
  rules: DoorwayGuardrailRules
): ServiceLocationDecision {
  const reasons: string[] = [];
  const warnings: BlueprintWarning[] = [];

  if (cluster === null) {
    if (rules.requireLocalEvidence) reasons.push('no_local_demand_evidence');
  } else if (rules.minClusterVolume !== null) {
    if (cluster.totalSearchVolume === null) {
      warnings.push(warn('missing_metrics', 'info', `No volume data for "${service.name}" in ${area.city}; volume floor not applied.`));
    } else if (cluster.totalSearchVolume < rules.minClusterVolume) {
      reasons.push('below_volume_floor');
    }
  }

  if (rules.requireUniqueProof && area.uniqueProof.length === 0) {
    reasons.push('missing_unique_proof');
    warnings.push(warn('missing_local_proof', 'warning', `${area.city} has no unique local proof; a "${service.name}" page there risks being a doorway page.`));
  }

  return { allowed: reasons.length === 0, reasons, warnings };
}

export function detectDoorwayRisk(
  candidate: PageCandidate,
  siblingCandidates: PageCandidate[],
  _brief: NormalizedProjectBrief,
  rules: DoorwayGuardrailRules
): BlueprintWarning[] {
  if (candidate.type !== 'service_location') return [];
  const warnings: BlueprintWarning[] = [];

  const locationSwapSiblings = siblingCandidates.filter(
    (s) =>
      s.type === 'service_location' &&
      s.clientId !== candidate.clientId &&
      s.serviceId === candidate.serviceId &&
      s.serviceAreaId !== candidate.serviceAreaId
  );

  if (locationSwapSiblings.length > 0 && candidate.uniqueProof.length === 0) {
    warnings.push(
      warn('doorway_risk', 'warning',
        `"${candidate.title}" differs from ${locationSwapSiblings.length} sibling page(s) only by location and has no unique local content.`)
    );
  }
  if (rules.requireUniqueProof && candidate.uniqueProof.length === 0) {
    warnings.push(warn('thin_content_risk', 'warning', `"${candidate.title}" has no unique local proof to build distinct content from.`));
  }
  return warnings;
}
```

- [ ] **Step 4: Run to verify PASS**, then **Step 5: Commit** (`feat(blueprint): service-location doorway guardrails`)

---

### Task 17: End-to-end deterministic fixture + Phase 1 acceptance

**Files:**
- Create: `workers/src/blueprint/domain/fixture.e2e.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 8-16.

- [ ] **Step 1: Write the end-to-end fixture test** (this is the Phase 1 acceptance test: "a pure deterministic fixture can produce and validate a small blueprint")

Create `workers/src/blueprint/domain/fixture.e2e.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseProjectBrief, normalizeProjectBrief } from './brief';
import { buildSeedQueries } from './seeds';
import { mergeKeywordCandidates } from './merge';
import { scoreKeywordRelevance, scoreKeywordOpportunity } from './score';
import { validateBlueprintGraph } from './graph';
import { normalizeSlug } from './slug';
import { V1_LIMITS } from '../contracts/limits';
import type { BlueprintPageNode, KeywordCandidate } from '../contracts/types';

const rawBrief = {
  businessName: 'Aqua Plumbing',
  category: 'Plumber',
  countryIso: 'us',
  languageCode: 'en',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning' },
  ],
  serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true, uniqueProof: ['South Lamar office'] }],
};

// Fixture stands in for DataForSEO output. Note deliberate null metrics.
const fixtureCandidates: KeywordCandidate[][] = [
  [
    { keyword: 'emergency plumber austin', source: 'fixture_ideas', metrics: { searchVolume: 1900, cpcUsd: 12.5, difficulty: 35 }, evidenceRefs: ['ev_kw_1'] },
    { keyword: 'Emergency Plumber Austin!', source: 'fixture_suggestions', metrics: { searchVolume: null, cpcUsd: null, difficulty: null }, evidenceRefs: ['ev_kw_2'] },
    { keyword: 'drain cleaning austin', source: 'fixture_ideas', metrics: { searchVolume: 720, cpcUsd: null, difficulty: 28 }, evidenceRefs: ['ev_kw_3'] },
    { keyword: 'plumber near me', source: 'fixture_ideas', metrics: { searchVolume: 9900, cpcUsd: 8.1, difficulty: null }, evidenceRefs: ['ev_kw_4'] },
  ],
];

describe('Phase 1 acceptance: deterministic fixture blueprint', () => {
  it('brief -> seeds -> merge -> score -> pages -> valid graph, with nulls preserved end to end', async () => {
    const brief = await normalizeProjectBrief(parseProjectBrief(rawBrief), V1_LIMITS);

    const seedPlan = buildSeedQueries(brief, { maxTotalSeeds: V1_LIMITS.maxSeedQueries, includePrimaryAreaSeeds: true });
    expect(seedPlan.seeds.length).toBe(5); // category + 2 services + 2 service+austin
    expect(seedPlan.truncated).toBe(false);

    const universe = mergeKeywordCandidates(fixtureCandidates, 'en-US');
    expect(universe.keywords).toHaveLength(3); // the two emergency variants merged
    const merged = universe.keywords.find((k) => k.normalizedKeyword === 'emergency plumber austin')!;
    expect(merged.evidenceRefs).toEqual(['ev_kw_1', 'ev_kw_2']);

    const relevanceRules = { weights: { service: 0.5, area: 0.3, category: 0.2 }, excludedTopicPenalty: 0.5 };
    const opportunityRules = { volumeWeight: 0.6, difficultyWeight: 0.4, volumeCap: 100000 };
    for (const kw of universe.keywords) {
      expect(scoreKeywordRelevance(kw, brief, relevanceRules).total).toBeGreaterThanOrEqual(0);
    }
    // 'plumber near me' has null difficulty: opportunity must be null, never 0.
    const nearMe = universe.keywords.find((k) => k.normalizedKeyword === 'plumber near me')!;
    expect(scoreKeywordOpportunity(nearMe, opportunityRules)).toBeNull();

    const pages: BlueprintPageNode[] = [
      { id: 'home', parentId: null, type: 'home', title: 'Aqua Plumbing', slug: '/', primaryKeywordNormalized: 'plumber austin', recommendation: 'create', approval: 'proposed' },
      { id: 'p1', parentId: 'home', type: 'service', title: 'Emergency Plumbing in Austin', slug: normalizeSlug('emergency plumbing austin'), primaryKeywordNormalized: 'emergency plumber austin', recommendation: 'create', approval: 'proposed' },
      { id: 'p2', parentId: 'home', type: 'service', title: 'Drain Cleaning in Austin', slug: normalizeSlug('drain cleaning austin'), primaryKeywordNormalized: 'drain cleaning austin', recommendation: 'create', approval: 'proposed' },
    ];
    expect(validateBlueprintGraph(pages)).toEqual({ valid: true, errors: [] });

    // Determinism: rerunning the whole pipeline gives identical output.
    const brief2 = await normalizeProjectBrief(parseProjectBrief(rawBrief), V1_LIMITS);
    expect(brief2.inputHash).toBe(brief.inputHash);
    expect(mergeKeywordCandidates(fixtureCandidates, 'en-US')).toEqual(universe);
  });
});
```

- [ ] **Step 2: Run the whole Blueprint suite + boundary check + typecheck**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt/datawise-seo-insight-main/workers"
npx vitest run src/blueprint
npx tsc --noEmit
cd .. && node scripts/check-blueprint-boundary.mjs
```

Expected: all Blueprint tests pass, typecheck clean, boundary check passes.

- [ ] **Step 3: Run the FULL worker suite** (`cd workers && npm test`) — no regressions outside Blueprint.

- [ ] **Step 4: Commit**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git add datawise-seo-insight-main/workers/src/blueprint/domain/fixture.e2e.test.ts
git commit -m "test(blueprint): phase 1 acceptance fixture, deterministic end to end"
```

---

### Task 18: Phase 1 ship: PR + verification

**Files:** none (operational task)

- [ ] **Step 1: Push and open PR**

```bash
cd "/Users/nicolasgorrono/Desktop/datawise-blueprint-wt"
git push -u origin feat/blueprint-phase-1
gh pr create --base production --title "Blueprint Phase 1: contracts and deterministic domain engine" --body "Pure domain engine with fixture tests only. No provider calls, no routes changed, no member-visible changes. Covers: contracts/enums from the handoff, brief validation+normalization, seed planning (no service x area cross products), keyword merge with evidence preservation, scoring with null semantics, graph/slug validators, doorway guardrails, end-to-end deterministic fixture.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Verification summary for Nicolas** (Phase 1 acceptance mapping):
  - missing metrics remain null → `score.test.ts`, `merge.test.ts`, `fixture.e2e.test.ts`
  - semantic keyword variants dedupe without losing evidence → `merge.test.ts`
  - service-location hard boundaries behave per fixtures → `doorway.test.ts`
  - cycles, orphans, duplicate slugs, duplicate primary keywords rejected → `graph.test.ts`
  - pure deterministic fixture produces and validates a small blueprint → `fixture.e2e.test.ts`

- [ ] **Step 3: After Nicolas approves: merge PR.** No worker deploy is required for Phase 1 (pure code, unreferenced by routes), but deploying is harmless; skip unless asked. Phase 2 (persistence + durable orchestration) is the next plan.

---

## Self-review notes

- Spec coverage: Phase 0 deliverables (bindings, gate, boundary ADR-equivalent, skeleton) → Tasks 1-6. Phase 1 deliverables (DTO/schemas, brief validation, normalization, seed planning, dedup, scoring null semantics, graph/slug/cycle validators, doorway guardrails, deterministic fixture) → Tasks 7-17. Handoff Phase 1 items intentionally deferred: "market model with separate Labs and SERP codes" is contract-only here (ResolvedMarket lands with the DFS catalog work in Phase 3 where it is exercised); "blueprint JSON schema and versioning" beyond the graph validator lands in Phase 2 with `blueprint_versions` persistence. Both noted so they are not lost.
- Types are consistent across tasks (contracts defined once in Task 7; later tasks import them).
- No placeholder steps; every code step has complete code. wrangler resource IDs are runtime outputs by nature and are explicitly captured in Task 2 Step 1.
