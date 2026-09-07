import type { McpEnv } from './env';

export const TOKEN_PREFIX = 'dwmcp_';
export const MAX_ACTIVE_TOKENS = 5;
const KV_TTL_SECONDS = 3600;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export class TokenLimitError extends Error {
  constructor() {
    super(`You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`);
    this.name = 'TokenLimitError';
  }
}

export interface ApiTokenRow {
  id: string;
  name: string;
  token_suffix: string;
  created_at: string;
  last_used_at: string | null;
}

export interface TokenIdentity {
  userId: string;
  tokenId: string;
  tokenName: string;
}

export function generateToken(): string {
  const bytes = new Uint8Array(40);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return TOKEN_PREFIX + out;
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const kvKey = (hash: string) => `mcptoken:${hash}`;

export async function createApiToken(env: McpEnv, userId: string, name: string): Promise<ApiTokenRow & { token: string }> {
  const active = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL'
  ).bind(userId).first<{ n: number }>();
  if ((active?.n ?? 0) >= MAX_ACTIVE_TOKENS) throw new TokenLimitError();

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const id = crypto.randomUUID().replace(/-/g, '');
  const suffix = token.slice(-4);
  const cleanName = name.trim().slice(0, 60) || 'Untitled token';

  await env.DB.prepare(
    'INSERT INTO api_tokens (id, user_id, name, token_hash, token_suffix) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, cleanName, tokenHash, suffix).run();

  const row = await env.DB.prepare(
    'SELECT id, name, token_suffix, created_at, last_used_at FROM api_tokens WHERE id = ?'
  ).bind(id).first<ApiTokenRow>();

  return { ...(row as ApiTokenRow), token };
}

export async function validateApiToken(env: McpEnv, bearer: string): Promise<TokenIdentity | null> {
  if (!bearer || !bearer.startsWith(TOKEN_PREFIX) || bearer.length !== TOKEN_PREFIX.length + 40) return null;
  const tokenHash = await hashToken(bearer);

  const cached = await env.KV.get(kvKey(tokenHash));
  if (cached) return JSON.parse(cached) as TokenIdentity;

  const row = await env.DB.prepare(
    `SELECT id, user_id, name, expires_at, revoked_at FROM api_tokens WHERE token_hash = ?`
  ).bind(tokenHash).first<{ id: string; user_id: string; name: string; expires_at: string | null; revoked_at: string | null }>();
  if (!row || row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

  const identity: TokenIdentity = { userId: row.user_id, tokenId: row.id, tokenName: row.name };
  await env.KV.put(kvKey(tokenHash), JSON.stringify(identity), { expirationTtl: KV_TTL_SECONDS });

  // Throttled: at most one write per token per hour.
  await env.DB.prepare(
    `UPDATE api_tokens SET last_used_at = datetime('now')
     WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-1 hour'))`
  ).bind(row.id).run();

  return identity;
}

export async function listApiTokens(env: McpEnv, userId: string): Promise<ApiTokenRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, token_suffix, created_at, last_used_at FROM api_tokens
     WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`
  ).bind(userId).all<ApiTokenRow>();
  return results;
}

export async function revokeApiToken(env: McpEnv, userId: string, tokenId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT token_hash FROM api_tokens WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
  ).bind(tokenId, userId).first<{ token_hash: string }>();
  if (!row) return false;
  await env.DB.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?").bind(tokenId).run();
  await env.KV.delete(kvKey(row.token_hash));
  return true;
}
