import type { Env } from '../index';
import type { AuthUser } from '../auth/google';
import { recordClientCrash, type ClientCrashInput } from '../activity';

const LIMITS = { name: 100, message: 500, stack: 4000, component_stack: 3000, route: 300, source: 40 } as const;

function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

// Pure so it can be unit tested: normalizes whatever the browser sent into the
// bounded shape the activity log stores.
export function buildClientCrashInput(body: unknown, userAgent: string | null): ClientCrashInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const message = clip(b.message, LIMITS.message);
  if (!message) return null;
  return {
    name: clip(b.name, LIMITS.name) || 'Error',
    message,
    stack: clip(b.stack, LIMITS.stack),
    component_stack: clip(b.component_stack, LIMITS.component_stack),
    route: clip(b.route, LIMITS.route),
    source: clip(b.source, LIMITS.source) || 'app',
    user_agent: clip(userAgent, 300),
  };
}

// POST /api/client-crash
export async function handleClientCrash(request: Request, env: Env, user: AuthUser): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const input = buildClientCrashInput(body, request.headers.get('User-Agent'));
  if (!input) {
    return new Response(JSON.stringify({ error: 'message is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  await recordClientCrash(env, user.id, input);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
