// Preflight check for OpenRouter user keys.
//
// OpenRouter has two key types: Inference keys (sk-or-v1-…, from
// openrouter.ai/keys) and Provisioning/Management keys (from
// openrouter.ai/settings/management-keys). Management keys return HTTP 200
// from GET /api/v1/key — so the SPA-side validator that only checks status
// cannot tell them apart. They DO fail at /chat/completions, but with 401/404
// which users misread as "the tool doesn't recognise my key" (see bug
// 9223aa85). This module hits /api/v1/key and inspects the
// is_provisioning_key / is_management_key booleans returned in the body so
// we can fail fast with an actionable message.
//
// Result is cached in KV for 24h (keyed by sha256 prefix of the key) so a
// good key only costs one OpenRouter round-trip per day.

import type { Env } from '../index';

const CACHE_TTL_SECONDS = 86400;
const KEY_PREFIX = 'or_key_check:';

export type KeyCheck =
  | { ok: true }
  | { ok: false; reason: 'management' | 'invalid'; message: string };

interface ApiKeyResponse {
  data?: {
    is_provisioning_key?: boolean;
    is_management_key?: boolean;
    label?: string;
  };
}

async function hashKey(apiKey: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 16);
}

const MANAGEMENT_MESSAGE =
  'OpenRouter says this looks like a Provisioning or Management key. Management keys cannot run models. Create an Inference API key at openrouter.ai/keys (it starts with sk-or-v1-) and paste that into Settings.';

const INVALID_MESSAGE =
  'OpenRouter rejected this API key. Double-check you copied the full key from openrouter.ai/keys, or create a new Inference API key and paste it into Settings.';

// Returns { ok: true } on success OR on any transient/network failure
// (fail-open). Returns ok:false ONLY when we have a definitive signal from
// OpenRouter that the key won't work for inference.
export async function validateOpenRouterKey(apiKey: string, env: Env): Promise<KeyCheck> {
  if (!apiKey) return { ok: false, reason: 'invalid', message: INVALID_MESSAGE };

  const cacheKey = KEY_PREFIX + (await hashKey(apiKey));
  try {
    const cached = await env.KV.get(cacheKey, 'json') as KeyCheck | null;
    if (cached) return cached;
  } catch { /* KV miss / read error — fall through */ }

  let response: Response;
  try {
    response = await fetch('https://openrouter.ai/api/v1/key', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
  } catch (err) {
    console.warn('[openrouter-key] network error during validation, failing open:', err);
    return { ok: true };
  }

  if (response.status === 401 || response.status === 403) {
    const result: KeyCheck = { ok: false, reason: 'invalid', message: INVALID_MESSAGE };
    // Do NOT cache — the user may rotate the key and retry immediately.
    return result;
  }

  if (!response.ok) {
    // 5xx, 429, etc. — fail open, don't cache.
    console.warn('[openrouter-key] non-ok status %d during validation, failing open', response.status);
    return { ok: true };
  }

  let body: ApiKeyResponse;
  try {
    body = await response.json() as ApiKeyResponse;
  } catch {
    return { ok: true };
  }

  const isMgmt = Boolean(body.data?.is_provisioning_key || body.data?.is_management_key);
  const result: KeyCheck = isMgmt
    ? { ok: false, reason: 'management', message: MANAGEMENT_MESSAGE }
    : { ok: true };

  try {
    await env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });
  } catch { /* cache write best-effort */ }

  return result;
}
