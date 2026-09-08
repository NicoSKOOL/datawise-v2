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
