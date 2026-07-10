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
