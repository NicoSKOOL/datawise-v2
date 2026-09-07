import type { Env } from '../index';
import type { DfsMeter } from '../dataforseo/client';

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

// The ONLY place the MCP worker widens its env to the API worker's Env type.
export function asWorkerEnv(env: McpEnv): Env {
  return env as unknown as Env;
}
