import type { Env } from '../index';
import { runEngine, classify, isEngineId, EngineTaskError, DEFAULT_LOCALE, type Locale } from '../ai-engines';
import { DataForSeoQuotaError } from '../dataforseo/client';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const INSTANT_CACHE_TTL_SECONDS = 3600;
const INSTANT_TIMEOUT_MS = 90_000;

// POST /api/ai/engine-check (credit-gated in index.ts). Instant Check's single
// route: one engine, one query, optional brand for a verdict.
export async function handleEngineCheck(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const engine = body.engine;
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!isEngineId(engine)) return json({ error: 'engine must be one of google_ai_mode, chatgpt, gemini, perplexity' }, 400);
  if (!query) return json({ error: 'query is required' }, 400);
  if (query.length > 500) return json({ error: 'query must be 500 characters or fewer' }, 400);

  const locationCode = Number(body.location_code);
  const languageCode = typeof body.language_code === 'string' ? body.language_code.trim().toLowerCase() : '';
  const locale: Locale = {
    location_code: Number.isFinite(locationCode) && locationCode > 0 ? locationCode : DEFAULT_LOCALE.location_code,
    language_code: languageCode || DEFAULT_LOCALE.language_code,
  };
  const brandDomain = typeof body.brand_domain === 'string' ? body.brand_domain.trim() : '';
  const brandTerms = Array.isArray(body.brand_terms) ? body.brand_terms.filter((t): t is string => typeof t === 'string') : [];

  try {
    const answer = await runEngine(env, engine, query, locale, { ttlSeconds: INSTANT_CACHE_TTL_SECONDS, timeoutMs: INSTANT_TIMEOUT_MS });
    const classification = brandDomain ? classify(answer, brandDomain, brandTerms) : null;
    return json({ engine, locale, answer, classification });
  } catch (err) {
    if (err instanceof DataForSeoQuotaError) throw err;
    if (err instanceof EngineTaskError) return json({ error: 'DataForSEO request failed', detail: err.message }, 502);
    return json({ error: 'AI engine request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}
