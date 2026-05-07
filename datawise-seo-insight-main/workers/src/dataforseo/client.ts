import type { Env } from '../index';

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

export interface DataForSeoCacheOptions {
  ttlSeconds?: number;
  timeoutMs?: number;
}

function getCredentials(env: Env): string {
  return btoa(`${env.DATAFORSEO_EMAIL}:${env.DATAFORSEO_PASSWORD}`);
}

function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError';
}

async function fetchDataForSeo(
  endpoint: string,
  init: RequestInit,
  timeoutMs?: number
): Promise<any> {
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
  return fetchDataForSeo(endpoint, {
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
  return fetchDataForSeo(endpoint, {
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
  await env.KV.put(key, JSON.stringify(data), { expirationTtl: ttlSeconds });
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
  await env.KV.put(key, JSON.stringify(data), { expirationTtl: ttlSeconds });
  return data;
}

// Helper to extract the standard nested result
export function extractResult(data: any): any {
  return data?.tasks?.[0]?.result?.[0] ?? null;
}

// Helper to extract items from result
export function extractItems(data: any): any[] {
  const result = extractResult(data);
  return result?.items ?? [];
}
