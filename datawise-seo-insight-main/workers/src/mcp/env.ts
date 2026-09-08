import type { Env } from '../index';
import type { DfsMeter } from '../dataforseo/client';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

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
  // Stage 2: dedicated KV for @cloudflare/workers-oauth-provider state, and
  // the helpers the provider injects into env on every request it handles.
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
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

// What the OAuth provider hands the protected handler on ctx.props. Both auth
// kinds produce this shape (spec 4.3): grants store it encrypted per grant,
// personal tokens build it in resolveExternalToken.
export interface McpProps {
  userId: string;
  email: string;
  clientName: string;
  authKind: 'api_token' | 'oauth';
  tokenId: string;
}

// The ONLY place the MCP worker widens its env to the API worker's Env type.
export function asWorkerEnv(env: McpEnv): Env {
  return env as unknown as Env;
}
