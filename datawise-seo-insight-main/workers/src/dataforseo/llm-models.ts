import { dataforseoGetCached, getTaskError, type DataForSeoEnv } from './client';

// Single source of truth for which model each DataForSEO LLM Responses call
// uses. Model names used to be hardcoded in ai.ts and ai-tracking.ts; when
// DataForSEO retired claude-3-5-sonnet and gemini-1.5-flash every call on
// those routes failed with task error 40501 "Invalid Field: 'model_name'".
//
// resolveModel() reads the live catalog (free endpoint, cached a day in KV)
// and picks the first PREFERRED model still listed with web search support,
// so a retirement degrades to the next choice instead of an error.
// llm-models.test.ts checks PREFERRED_MODELS against llm-models.snapshot.json;
// refresh the snapshot with `npm run llm-models:snapshot`.

export type LlmProvider = 'chat_gpt' | 'claude' | 'gemini' | 'perplexity';

export interface LlmModelInfo {
  model_name: string;
  web_search_supported: boolean;
  reasoning?: boolean;
  task_post_supported?: boolean;
}

// Ordered by preference. Index 0 is also the offline fallback, so it must be
// a model we are confident exists (guarded by the snapshot test).
export const PREFERRED_MODELS: Record<LlmProvider, string[]> = {
  // gpt-4o kept as the ChatGPT default for continuity of tracker history;
  // moving to a gpt-5.x model is a separate decision (changes cost + results).
  chat_gpt: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5.4-mini'],
  claude: ['claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
  gemini: ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  perplexity: ['sonar', 'sonar-pro'],
};

const MODELS_CACHE_TTL_SECONDS = 24 * 3600;
const MODELS_TIMEOUT_MS = 10_000;

export function pickModel(provider: LlmProvider, catalog: LlmModelInfo[]): string {
  const preferred = PREFERRED_MODELS[provider];
  const usable = new Set(
    catalog.filter((m) => m && m.web_search_supported && typeof m.model_name === 'string').map((m) => m.model_name)
  );
  for (const name of preferred) {
    if (usable.has(name)) return name;
  }
  const first = catalog.find((m) => m && m.web_search_supported && typeof m.model_name === 'string');
  return first ? first.model_name : preferred[0];
}

export async function fetchModelCatalog(env: DataForSeoEnv, provider: LlmProvider): Promise<LlmModelInfo[]> {
  const data = await dataforseoGetCached(
    env,
    `/ai_optimization/${provider}/llm_responses/models`,
    { ttlSeconds: MODELS_CACHE_TTL_SECONDS, timeoutMs: MODELS_TIMEOUT_MS }
  );
  if (getTaskError(data)) return [];
  const result = data?.tasks?.[0]?.result;
  return Array.isArray(result) ? (result as LlmModelInfo[]) : [];
}

export async function resolveModel(env: DataForSeoEnv, provider: LlmProvider): Promise<string> {
  try {
    const catalog = await fetchModelCatalog(env, provider);
    return pickModel(provider, catalog);
  } catch (err) {
    console.error(`LLM model catalog unavailable for ${provider}, using fallback:`, err instanceof Error ? err.message : err);
    return PREFERRED_MODELS[provider][0];
  }
}
