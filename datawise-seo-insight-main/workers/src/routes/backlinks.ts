import type { Env } from '../index';
import { dataforseoRequestCached, extractResult } from '../dataforseo/client';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// POST /api/backlinks/summary
export async function handleBacklinksSummary(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target, internal_list_limit, include_subdomains, backlinks_status_type } = body;

  if (typeof target !== 'string' || target.trim() === '') {
    return json({ error: 'target is required and must be a non-empty string' }, 400);
  }

  const task = {
    target,
    internal_list_limit: internal_list_limit ?? 10,
    include_subdomains: include_subdomains ?? true,
    backlinks_status_type: backlinks_status_type ?? 'live',
  };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/backlinks/summary/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/backlinks/timeseries
export async function handleBacklinksTimeseries(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target, date_from, date_to, group_range, include_subdomains } = body;

  if (typeof target !== 'string' || target.trim() === '') {
    return json({ error: 'target is required and must be a non-empty string' }, 400);
  }

  const task: Record<string, unknown> = {
    target,
    group_range: group_range ?? 'month',
    include_subdomains: include_subdomains ?? true,
  };

  if (date_from !== undefined) task.date_from = date_from;
  if (date_to !== undefined) task.date_to = date_to;

  try {
    const data = await dataforseoRequestCached(
      env,
      '/backlinks/timeseries_new_lost_summary/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/backlinks/list
export async function handleBacklinksList(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target, limit, offset, mode, filters, order_by, backlinks_status_type, include_subdomains } = body;

  if (typeof target !== 'string' || target.trim() === '') {
    return json({ error: 'target is required and must be a non-empty string' }, 400);
  }

  const task: Record<string, unknown> = {
    target,
    limit: Math.min(typeof limit === 'number' ? limit : 100, 1000),
    mode: mode ?? 'one_per_domain',
    backlinks_status_type: backlinks_status_type ?? 'live',
    include_subdomains: include_subdomains ?? true,
  };

  if (offset !== undefined) task.offset = offset;
  if (filters !== undefined) task.filters = filters;
  if (order_by !== undefined) task.order_by = order_by;

  try {
    const data = await dataforseoRequestCached(
      env,
      '/backlinks/backlinks/live',
      [task],
      { ttlSeconds: 1800 }
    );
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/backlinks/referring-domains
export async function handleReferringDomains(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target, limit, offset, filters, order_by, include_subdomains } = body;

  if (typeof target !== 'string' || target.trim() === '') {
    return json({ error: 'target is required and must be a non-empty string' }, 400);
  }

  const task: Record<string, unknown> = {
    target,
    limit: Math.min(typeof limit === 'number' ? limit : 100, 1000),
    include_subdomains: include_subdomains ?? true,
  };

  if (offset !== undefined) task.offset = offset;
  if (filters !== undefined) task.filters = filters;
  if (order_by !== undefined) task.order_by = order_by;

  try {
    const data = await dataforseoRequestCached(
      env,
      '/backlinks/referring_domains/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/backlinks/anchors
export async function handleAnchors(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target, limit, internal_list_limit, include_subdomains } = body;

  if (typeof target !== 'string' || target.trim() === '') {
    return json({ error: 'target is required and must be a non-empty string' }, 400);
  }

  const task: Record<string, unknown> = {
    target,
    limit: Math.min(typeof limit === 'number' ? limit : 100, 1000),
    internal_list_limit: internal_list_limit ?? 5,
    include_subdomains: include_subdomains ?? true,
  };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/backlinks/anchors/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/backlinks/competitors
export async function handleBacklinksCompetitors(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { target, limit, exclude_large_domains, include_subdomains } = body;

  if (typeof target !== 'string' || target.trim() === '') {
    return json({ error: 'target is required and must be a non-empty string' }, 400);
  }

  const task: Record<string, unknown> = {
    target,
    limit: Math.min(typeof limit === 'number' ? limit : 20, 1000),
    exclude_large_domains: exclude_large_domains ?? true,
    include_subdomains: include_subdomains ?? true,
  };

  try {
    const data = await dataforseoRequestCached(
      env,
      '/backlinks/competitors/live',
      [task],
      { ttlSeconds: 604800 }
    );
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/backlinks/domain-intersection
export async function handleDomainIntersection(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { targets, limit, filters, exclude_targets } = body;

  if (!Array.isArray(targets) || targets.length < 2 || targets.length > 20) {
    return json({ error: 'targets is required and must be an array of 2-20 strings' }, 400);
  }

  // Build targets object: {"1": targets[0], "2": targets[1], ...}
  const targetsObj: Record<string, string> = {};
  for (let i = 0; i < (targets as string[]).length; i++) {
    targetsObj[String(i + 1)] = (targets as string[])[i];
  }

  const task: Record<string, unknown> = {
    targets: targetsObj,
    limit: Math.min(typeof limit === 'number' ? limit : 100, 1000),
  };

  if (filters !== undefined) task.filters = filters;
  if (exclude_targets !== undefined) task.exclude_targets = exclude_targets;

  try {
    const data = await dataforseoRequestCached(
      env,
      '/backlinks/domain_intersection/live',
      [task],
      { ttlSeconds: 86400 }
    );
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// POST /api/backlinks/bulk-ranks
export async function handleBulkRanks(request: Request, env: Env, _userId: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { targets } = body;

  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 1000) {
    return json({ error: 'targets is required and must be an array of 1-1000 strings' }, 400);
  }

  try {
    const data = await dataforseoRequestCached(
      env,
      '/backlinks/bulk_ranks/live',
      [{ targets }],
      { ttlSeconds: 604800 }
    );
    const result = extractResult(data);
    return json({ data: result, cost: (data as Record<string, unknown>)?.cost });
  } catch (err) {
    return json({ error: 'DataForSEO request failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}
