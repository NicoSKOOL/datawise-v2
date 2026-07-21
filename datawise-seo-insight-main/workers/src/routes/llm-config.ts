import type { Env } from '../index';
import type { AuthUser } from '../auth/google';
import { encryptToken, decryptToken } from '../lib/token-crypto';

// Server-side backup of the member's BYOK OpenRouter config. localStorage
// remains the runtime source; this copy exists so the key survives browser
// site-data clears and follows the account across devices (Pat Donelson,
// bugs 702e4f26 / 663ce49c). The whole config JSON is encrypted at rest.

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type StoredConfig = { provider: 'openrouter'; api_key: string; model?: string };

// GET /api/llm-config
export async function handleGetLLMConfig(env: Env, user: AuthUser): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT config_encrypted FROM user_llm_configs WHERE user_id = ?'
  ).bind(user.id).first<{ config_encrypted: string }>();
  if (!row?.config_encrypted) return json({ config: null });
  try {
    const parsed = JSON.parse(await decryptToken(row.config_encrypted, env.ENCRYPTION_KEY)) as StoredConfig;
    if (!parsed?.api_key) return json({ config: null });
    return json({ config: { provider: 'openrouter', api_key: parsed.api_key, model: parsed.model } });
  } catch {
    // Undecryptable (e.g. rotated ENCRYPTION_KEY) must degrade to "no backup",
    // never a 500: the client then simply behaves as before this feature.
    return json({ config: null });
  }
}

// PUT /api/llm-config
export async function handlePutLLMConfig(request: Request, env: Env, user: AuthUser): Promise<Response> {
  let body: { api_key?: unknown; model?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';
  if (!/^sk-or-/i.test(apiKey) || apiKey.length < 20 || apiKey.length > 300) {
    return json({ error: 'api_key must be an OpenRouter Inference API key (sk-or-...)' }, 400);
  }
  const model = typeof body.model === 'string' && body.model.length <= 100 ? body.model : undefined;
  const payload: StoredConfig = { provider: 'openrouter', api_key: apiKey, ...(model ? { model } : {}) };
  const encrypted = await encryptToken(JSON.stringify(payload), env.ENCRYPTION_KEY);
  await env.DB.prepare(
    `INSERT INTO user_llm_configs (user_id, config_encrypted, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       config_encrypted = excluded.config_encrypted,
       updated_at = excluded.updated_at`
  ).bind(user.id, encrypted).run();
  return json({ success: true });
}

// DELETE /api/llm-config
export async function handleDeleteLLMConfig(env: Env, user: AuthUser): Promise<Response> {
  await env.DB.prepare('DELETE FROM user_llm_configs WHERE user_id = ?').bind(user.id).run();
  return json({ success: true });
}
