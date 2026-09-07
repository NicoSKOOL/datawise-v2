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
