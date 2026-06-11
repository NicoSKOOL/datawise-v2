import type { Env } from '../index';

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

export interface DataForSeoCacheOptions {
  ttlSeconds?: number;
  timeoutMs?: number;
}

export class DataForSeoQuotaError extends Error {
  readonly provider = 'dataforseo';
  readonly statusCode = 402;
  readonly providerMessage?: string;
  constructor(providerMessage?: string) {
    super(providerMessage || 'DataForSEO daily quota exhausted');
    this.name = 'DataForSeoQuotaError';
    this.providerMessage = providerMessage;
  }
}

function getCredentials(env: Env): string {
  return btoa(`${env.DATAFORSEO_EMAIL}:${env.DATAFORSEO_PASSWORD}`);
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError';
}

// Short-circuit guard: once a 402 has been observed today, every subsequent
// outbound DataForSEO call would burn ~3.8s of wall time only to receive the
// same 402. We KV-flag the day so future calls fail fast until UTC midnight.
function quotaBlockedKey(): string {
  return `dfs-quota-blocked:${new Date().toISOString().slice(0, 10)}`;
}

function secondsUntilNextUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return Math.max(60, Math.floor((next - now.getTime()) / 1000));
}

async function fetchDataForSeo(
  env: Env,
  endpoint: string,
  init: RequestInit,
  timeoutMs?: number
): Promise<any> {
  // Fast path: if today is already flagged as quota-exhausted, throw
  // immediately without making the subrequest.
  const blocked = await env.KV.get(quotaBlockedKey());
  if (blocked) {
    throw new DataForSeoQuotaError('DataForSEO daily quota exhausted (cached)');
  }

  const controller = timeoutMs != null ? new AbortController() : null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  if (controller) {
    init.signal = controller.signal;
    timeout = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const response = await fetch(`${DATAFORSEO_BASE}${endpoint}`, init);
    const data = await response.json();

    if (!response.ok) {
      console.error(`DataForSEO error [${endpoint}]:`, JSON.stringify(data));
      if (response.status === 402) {
        const statusMsg = (data as { status_message?: unknown })?.status_message;
        const providerMessage = typeof statusMsg === 'string' ? statusMsg : undefined;
        // Flag the day so the next call short-circuits.
        try {
          await env.KV.put(quotaBlockedKey(), '1', { expirationTtl: secondsUntilNextUtcMidnight() + 3600 });
        } catch (kvErr) {
          console.error('KV put failed for dfs-quota-blocked key:', kvErr);
        }
        throw new DataForSeoQuotaError(providerMessage);
      }
      throw new Error(`DataForSEO API error: ${response.status}`);
    }

    return data;
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error(`DataForSEO ${endpoint} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function dataforseoRequest(
  env: Env,
  endpoint: string,
  body: unknown[],
  timeoutMs?: number
): Promise<any> {
  return fetchDataForSeo(env, endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${getCredentials(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, timeoutMs);
}

export async function dataforseoGet(
  env: Env,
  endpoint: string,
  timeoutMs?: number
): Promise<any> {
  return fetchDataForSeo(env, endpoint, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${getCredentials(env)}`,
    },
  }, timeoutMs);
}

async function dataforseoCacheKey(
  method: 'GET' | 'POST',
  endpoint: string,
  body?: unknown
): Promise<string> {
  const raw = JSON.stringify([method, endpoint, body ?? null]);
  const encoded = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `dataforseo:${method.toLowerCase()}:${hash}`;
}

export async function dataforseoRequestCached(
  env: Env,
  endpoint: string,
  body: unknown[],
  options: DataForSeoCacheOptions = {}
): Promise<any> {
  const ttlSeconds = options.ttlSeconds ?? 0;
  if (ttlSeconds <= 0) {
    return dataforseoRequest(env, endpoint, body, options.timeoutMs);
  }

  const key = await dataforseoCacheKey('POST', endpoint, body);
  const cached = await env.KV.get(key);
  if (cached) return JSON.parse(cached);

  const data = await dataforseoRequest(env, endpoint, body, options.timeoutMs);
  if (isCacheableDfsResponse(data)) {
    await env.KV.put(key, JSON.stringify(data), { expirationTtl: ttlSeconds });
  }
  return data;
}

export async function dataforseoGetCached(
  env: Env,
  endpoint: string,
  options: DataForSeoCacheOptions = {}
): Promise<any> {
  const ttlSeconds = options.ttlSeconds ?? 0;
  if (ttlSeconds <= 0) {
    return dataforseoGet(env, endpoint, options.timeoutMs);
  }

  const key = await dataforseoCacheKey('GET', endpoint);
  const cached = await env.KV.get(key);
  if (cached) return JSON.parse(cached);

  const data = await dataforseoGet(env, endpoint, options.timeoutMs);
  if (isCacheableDfsResponse(data)) {
    await env.KV.put(key, JSON.stringify(data), { expirationTtl: ttlSeconds });
  }
  return data;
}

// Helper to extract the standard nested result
export function extractResult(data: any): any {
  return data?.tasks?.[0]?.result?.[0] ?? null;
}

// DFS returns HTTP 200 even when the task inside failed (e.g. 40501 invalid
// domain). Returns the task-level error message, or null if the task is ok.
export function getTaskError(data: any): string | null {
  const task = data?.tasks?.[0];
  if (!task) return 'DataForSEO returned no task';
  if (task.status_code === 20000) return null;
  return typeof task.status_message === 'string' && task.status_message
    ? task.status_message
    : `DataForSEO task failed with status ${task.status_code}`;
}

// Only successful task responses may be KV-cached. Caching a transient task
// failure pins the error for the full TTL (bug 5308c018: Brand Tracker compare
// showed "no comparison data" for 6h after one bad DFS response).
export function isCacheableDfsResponse(data: any): boolean {
  return getTaskError(data) === null;
}

// Helper to extract items from result
export function extractItems(data: any): any[] {
  const result = extractResult(data);
  return result?.items ?? [];
}
