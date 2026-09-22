import { dataforseoRequestCached, getTaskError, type DataForSeoEnv } from '../dataforseo/client';
import { chatgptAdapter } from './chatgpt';
import { geminiAdapter } from './gemini';
import { googleAiModeAdapter } from './google-ai-mode';
import { perplexityAdapter } from './perplexity';
import type { EngineAdapter, EngineId, Locale, NormalizedAnswer } from './types';

export * from './types';
export * from './classify';

export const ENGINES: Record<EngineId, EngineAdapter> = {
  google_ai_mode: googleAiModeAdapter,
  chatgpt: chatgptAdapter,
  gemini: geminiAdapter,
  perplexity: perplexityAdapter,
};

export const ENGINE_LABELS: Record<EngineId, string> = {
  google_ai_mode: 'Google AI Mode',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  perplexity: 'Perplexity',
};

// A DataForSEO task that failed inside an HTTP 200 (status 40xxx/50xxx).
// Callers record it as `error`; it is never cached (client.ts refuses).
export class EngineTaskError extends Error {
  readonly engine: EngineId;
  constructor(engine: EngineId, message: string) {
    super(message);
    this.name = 'EngineTaskError';
    this.engine = engine;
  }
}

export interface RunEngineOptions {
  ttlSeconds: number;
  timeoutMs: number;
}

export async function runEngine(
  env: DataForSeoEnv,
  engine: EngineId,
  query: string,
  locale: Locale,
  opts: RunEngineOptions
): Promise<NormalizedAnswer> {
  const adapter = ENGINES[engine];
  const { endpoint, body } = await adapter.buildRequest(env, query, locale);
  const raw = await dataforseoRequestCached(env, endpoint, body, { ttlSeconds: opts.ttlSeconds, timeoutMs: opts.timeoutMs });
  const taskError = getTaskError(raw);
  if (taskError) throw new EngineTaskError(engine, taskError);
  return adapter.parse(raw);
}
