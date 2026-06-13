import type { Env } from '../index';
import { dataforseoRequestCached, extractResult, getTaskError } from '../dataforseo/client';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// POST /api/llm-mentions/aggregate
export async function handleAggregate(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target, platform = 'google', location_code = 2840, language_code = 'en', internal_list_limit = 10, ...rest } = body;

  if (!Array.isArray(target) || target.length === 0) {
    return json({ error: 'target is required and must be a non-empty array' }, 400);
  }

  const task = { target, platform, location_code, language_code, internal_list_limit, ...rest };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/ai_optimization/llm_mentions/aggregated_metrics/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const taskError = getTaskError(data);
    if (taskError) {
      return json({ error: 'DataForSEO request failed', detail: taskError }, 502);
    }
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/llm-mentions/cross-aggregate
export async function handleCrossAggregate(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { targets, platform = 'google', location_code = 2840, language_code = 'en', internal_list_limit = 5, ...rest } = body;

  if (!Array.isArray(targets) || targets.length < 2 || targets.length > 10) {
    return json({ error: 'targets is required and must be an array with 2-10 items' }, 400);
  }

  const task = { targets, platform, location_code, language_code, internal_list_limit, ...rest };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/ai_optimization/llm_mentions/cross_aggregated_metrics/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const taskError = getTaskError(data);
    if (taskError) {
      return json({ error: 'DataForSEO request failed', detail: taskError }, 502);
    }
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/llm-mentions/search
export async function handleSearch(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target, platform = 'google', location_code = 2840, language_code = 'en', limit = 100, ...rest } = body;

  if (!Array.isArray(target) || target.length === 0) {
    return json({ error: 'target is required and must be a non-empty array' }, 400);
  }

  const cappedLimit = Math.min(typeof limit === 'number' ? limit : 100, 1000);
  const task = { target, platform, location_code, language_code, limit: cappedLimit, ...rest };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/ai_optimization/llm_mentions/search/live',
      [task],
      // 24h cache: this is the priciest DFS call ($0.10+/req) and brand mentions
      // shift slowly. Was 1h, which barely cached same-day dashboard re-views.
      { ttlSeconds: 86400 }
    );
    const taskError = getTaskError(data);
    if (taskError) {
      return json({ error: 'DataForSEO request failed', detail: taskError }, 502);
    }
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/llm-mentions/top-domains
export async function handleTopDomains(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    target,
    platform = 'google',
    location_code = 2840,
    language_code = 'en',
    links_scope = 'sources',
    items_list_limit = 10,
    internal_list_limit = 10,
    ...rest
  } = body;

  if (!Array.isArray(target) || target.length === 0) {
    return json({ error: 'target is required and must be a non-empty array' }, 400);
  }

  const task = { target, platform, location_code, language_code, links_scope, items_list_limit, internal_list_limit, ...rest };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/ai_optimization/llm_mentions/top_domains/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const taskError = getTaskError(data);
    if (taskError) {
      return json({ error: 'DataForSEO request failed', detail: taskError }, 502);
    }
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/llm-mentions/top-pages
export async function handleTopPages(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    target,
    platform = 'google',
    location_code = 2840,
    language_code = 'en',
    links_scope = 'sources',
    items_list_limit = 10,
    internal_list_limit = 10,
    ...rest
  } = body;

  if (!Array.isArray(target) || target.length === 0) {
    return json({ error: 'target is required and must be a non-empty array' }, 400);
  }

  const task = { target, platform, location_code, language_code, links_scope, items_list_limit, internal_list_limit, ...rest };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/ai_optimization/llm_mentions/top_pages/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const taskError = getTaskError(data);
    if (taskError) {
      return json({ error: 'DataForSEO request failed', detail: taskError }, 502);
    }
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/llm-mentions/keyword-volume
export async function handleKeywordVolume(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { keywords, location_code = 2840, language_code = 'en', ...rest } = body;

  if (!Array.isArray(keywords) || keywords.length === 0 || keywords.length > 1000) {
    return json({ error: 'keywords is required and must be an array of 1-1000 items' }, 400);
  }

  for (const kw of keywords) {
    if (typeof kw !== 'string' || kw.length > 250) {
      return json({ error: 'Each keyword must be a string of at most 250 characters' }, 400);
    }
  }

  const normalized = (keywords as string[]).map(k => k.toLowerCase());
  const task = { keywords: normalized, location_code, language_code, ...rest };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/ai_optimization/ai_keyword_data/keywords_search_volume/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const taskError = getTaskError(data);
    if (taskError) {
      return json({ error: 'DataForSEO request failed', detail: taskError }, 502);
    }
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}
