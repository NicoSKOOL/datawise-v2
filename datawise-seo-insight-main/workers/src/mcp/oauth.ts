import { OAuthProvider, ExternalTokenError, type OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import type { McpEnv, McpProps } from './env';
import { validateApiToken, TOKEN_PREFIX } from './tokens';
import { loadIdentity } from './access';
import { handleMcpRequest } from './server';
import { handleAccountRequest } from './account';
import { iconResponse } from './icon';
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
    if (path === '/icon.png' || path === '/favicon.ico') return iconResponse();
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
      // Deliberate: log 4xx at warn level while connectors (claude.ai, ChatGPT)
      // are still being attached for the first time, so a rejected authorize/
      // token/register call is diagnosable from worker logs during rollout.
      else if (status >= 400) console.warn('[mcp-oauth]', status, code, description);
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
