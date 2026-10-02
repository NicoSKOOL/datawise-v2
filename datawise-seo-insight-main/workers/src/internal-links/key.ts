// Background runs have no request body to read the member's key from, so
// the key comes from their encrypted server-side backup (routes/llm-config.ts).
// Deliberately NO env.OPENROUTER_API_KEY fallback: Jev and anchor calls bill
// to the member's own OpenRouter account, never the platform's.

import type { Env } from '../index';
import { decryptToken } from '../lib/token-crypto';

export async function resolveUserOpenRouterKey(env: Env, userId: string): Promise<string | null> {
  if (!env.ENCRYPTION_KEY) return null;
  const row = await env.DB
    .prepare('SELECT config_encrypted FROM user_llm_configs WHERE user_id = ?')
    .bind(userId)
    .first<{ config_encrypted: string }>();
  if (!row?.config_encrypted) return null;
  try {
    const parsed = JSON.parse(await decryptToken(row.config_encrypted, env.ENCRYPTION_KEY)) as { api_key?: unknown };
    const key = typeof parsed.api_key === 'string' ? parsed.api_key.trim() : '';
    return key || null;
  } catch {
    return null;
  }
}
