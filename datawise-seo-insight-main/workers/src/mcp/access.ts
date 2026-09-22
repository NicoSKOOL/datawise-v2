import type { McpEnv, McpIdentity } from './env';
import type { TokenIdentity } from './tokens';
import { isAdmin } from '../routes/admin';
import type { AuthUser } from '../auth/google';

export type AccessDenial = 'paused' | 'not_member' | 'early_access';

interface UserRow {
  id: string;
  email: string;
  subscription_tier: string | null;
  is_community_member: number | null;
  is_admin: number | null;
  banned: number | null;
  default_location_code: number | null;
  default_language_code: string | null;
}

export async function loadIdentity(
  env: McpEnv,
  token: TokenIdentity,
  authKind: 'api_token' | 'oauth' = 'api_token',
): Promise<McpIdentity | null> {
  const row = await env.DB.prepare(
    `SELECT id, email, subscription_tier, is_community_member, is_admin, banned,
            default_location_code, default_language_code
     FROM users WHERE id = ?`
  ).bind(token.userId).first<UserRow>();
  if (!row || row.banned) return null;

  const authUser = { id: row.id, email: row.email, is_admin: row.is_admin === 1 } as unknown as AuthUser;
  return {
    userId: row.id,
    email: row.email,
    tier: row.subscription_tier ?? 'free',
    isAdmin: isAdmin(authUser, env),
    isCommunityMember: row.is_community_member === 1,
    defaultLocationCode: row.default_location_code ?? 2840,
    defaultLanguageCode: row.default_language_code ?? 'en',
    tokenId: token.tokenId,
    tokenName: token.tokenName,
    authKind,
  };
}

// Spec 6.1. The lifetime credit counter is deliberately not consulted.
export function hasMemberAccess(identity: McpIdentity): boolean {
  return identity.isAdmin || identity.isCommunityMember || identity.tier === 'pro' || identity.tier === 'community';
}

export async function checkAccess(env: McpEnv, identity: McpIdentity): Promise<AccessDenial | null> {
  if (await env.KV.get('mcp-paused')) return 'paused';
  if (!hasMemberAccess(identity)) return 'not_member';

  const allowlist = (await env.KV.get('mcp-allowlist')) ?? '';
  const emails = allowlist.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length && !identity.isAdmin && !emails.includes(identity.email.toLowerCase())) return 'early_access';

  return null;
}

export function denialMessage(denial: AccessDenial): string {
  switch (denial) {
    case 'paused':
      return 'The DataWise MCP server is temporarily paused for maintenance. Try again later.';
    case 'not_member':
      return 'MCP access is included with AI Ranking Skool membership and DataWise Pro. Upgrade at https://datawiseseo.com/settings to use these tools.';
    case 'early_access':
      return 'The DataWise MCP server is in early access. Your account is not on the early-access list yet.';
  }
}
