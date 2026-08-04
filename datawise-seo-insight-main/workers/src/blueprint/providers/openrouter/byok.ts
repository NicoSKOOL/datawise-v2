import type { BlueprintProviderEnv } from '../../orchestration/process-run';
import { decryptToken } from '../../../lib/token-crypto';

// Every OpenRouter call a blueprint run makes is billed to the MEMBER's own
// OpenRouter account, never to a DataWise-managed server key. The member's key
// lives in the main D1 (`user_llm_configs`, encrypted at rest by
// routes/llm-config.ts, the same BYOK config the SEO Assistant and Content
// Writer use). A queue-driven run has no request context to read localStorage
// from, so the server-side backup copy is the only source: a member who has
// never saved their key in Settings simply gets a keyless run, and the
// adjudicator skips (see adjudicate-clusters.ts).
//
// There is deliberately NO env.OPENROUTER_API_KEY fallback here. Falling back
// would silently move member inference spend onto the platform's account.

export interface RunOpenRouterKey {
  apiKey: string;
  // The run's creator, i.e. whose OpenRouter account the calls bill to.
  userId: string;
}

interface StoredLLMConfig {
  provider?: string;
  api_key?: string;
  model?: string;
}

/**
 * Resolves the OpenRouter key belonging to the member who started `runId`.
 * Returns null (never throws, never falls back to a server key) when the key
 * cannot be resolved for any reason: no main-DB binding, no encryption key, an
 * unknown run, no saved BYOK config, ciphertext that no longer decrypts (e.g.
 * ENCRYPTION_KEY rotation), or a config with no api_key.
 */
export async function resolveRunOpenRouterKey(
  env: BlueprintProviderEnv,
  d1: D1Database,
  runId: string
): Promise<RunOpenRouterKey | null> {
  if (!env.DB || !env.ENCRYPTION_KEY) return null;

  const run = await d1
    .prepare('SELECT created_by FROM research_runs WHERE id = ?')
    .bind(runId)
    .first<{ created_by: string }>();
  const userId = run?.created_by;
  if (!userId) return null;

  const row = await env.DB
    .prepare('SELECT config_encrypted FROM user_llm_configs WHERE user_id = ?')
    .bind(userId)
    .first<{ config_encrypted: string }>();
  if (!row?.config_encrypted) return null;

  let parsed: StoredLLMConfig;
  try {
    parsed = JSON.parse(await decryptToken(row.config_encrypted, env.ENCRYPTION_KEY)) as StoredLLMConfig;
  } catch {
    // Undecryptable or malformed must degrade to "no key", exactly as
    // handleGetLLMConfig does, never a stage failure.
    return null;
  }

  const apiKey = typeof parsed?.api_key === 'string' ? parsed.api_key.trim() : '';
  if (!apiKey) return null;

  return { apiKey, userId };
}
