import type { Env } from '../../index';
import type { AuthUser } from '../../auth/google';
import { isAdmin } from '../../routes/admin';
import { actorFromUser, type Actor } from '../db/access';
import { failFrom } from './envelope';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  createEstimate,
  startResearchRun,
} from './projects';
import { getRun, cancelRun, retryRun, getUsage } from './runs';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function isBlueprintAuthorized(user: AuthUser | null, env?: Env): boolean {
  return !!user && isAdmin(user, env);
}

type RouteHandler = (
  request: Request,
  env: Env,
  actor: Actor,
  params: Record<string, string>
) => Promise<Response>;

interface RouteEntry {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

// No route logic lives here: every entry just matches method + path and
// delegates to a thin handler in projects.ts / runs.ts. Params come from
// the pattern's named capture groups.
const ROUTES: RouteEntry[] = [
  { method: 'POST', pattern: /^\/api\/blueprint\/v1\/projects$/, handler: createProject },
  { method: 'GET', pattern: /^\/api\/blueprint\/v1\/projects$/, handler: listProjects },
  { method: 'GET', pattern: /^\/api\/blueprint\/v1\/projects\/(?<id>[^/]+)$/, handler: getProject },
  { method: 'PATCH', pattern: /^\/api\/blueprint\/v1\/projects\/(?<id>[^/]+)$/, handler: updateProject },
  { method: 'DELETE', pattern: /^\/api\/blueprint\/v1\/projects\/(?<id>[^/]+)$/, handler: deleteProject },
  {
    method: 'POST',
    pattern: /^\/api\/blueprint\/v1\/projects\/(?<id>[^/]+)\/research-estimates$/,
    handler: createEstimate,
  },
  {
    method: 'POST',
    pattern: /^\/api\/blueprint\/v1\/projects\/(?<id>[^/]+)\/research-runs$/,
    handler: startResearchRun,
  },
  { method: 'GET', pattern: /^\/api\/blueprint\/v1\/research-runs\/(?<id>[^/]+)$/, handler: getRun },
  {
    method: 'POST',
    pattern: /^\/api\/blueprint\/v1\/research-runs\/(?<id>[^/]+)\/cancel$/,
    handler: cancelRun,
  },
  {
    method: 'POST',
    pattern: /^\/api\/blueprint\/v1\/research-runs\/(?<id>[^/]+)\/retry$/,
    handler: retryRun,
  },
  {
    method: 'GET',
    pattern: /^\/api\/blueprint\/v1\/research-runs\/(?<id>[^/]+)\/usage$/,
    handler: getUsage,
  },
];

export async function handleBlueprintRequest(
  request: Request,
  env: Env,
  user: AuthUser,
  path: string,
  method: string
): Promise<Response> {
  // Non-allowlisted users get 404: the feature does not exist for them.
  if (!isBlueprintAuthorized(user, env)) return json({ error: 'Not Found' }, 404);

  if (path === '/api/blueprint/v1/health' && method === 'GET') {
    return handleHealth(env);
  }

  const actor = actorFromUser(user);
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    const params = { ...(match.groups ?? {}) };
    try {
      return await route.handler(request, env, actor, params);
    } catch (err) {
      return failFrom(err);
    }
  }

  return json({ error: 'Not Found' }, 404);
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
