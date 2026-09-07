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
