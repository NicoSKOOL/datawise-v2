import type { Env } from '../index';

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3';

function getCredentials(env: Env): string {
  return btoa(`${env.DATAFORSEO_EMAIL}:${env.DATAFORSEO_PASSWORD}`);
}

export async function dataforseoRequest(
  env: Env,
  endpoint: string,
  body: unknown[]
): Promise<any> {
  const response = await fetch(`${DATAFORSEO_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${getCredentials(env)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`DataForSEO error [${endpoint}]:`, JSON.stringify(data));
    throw new Error(`DataForSEO API error: ${response.status}`);
  }

  return data;
}

export async function dataforseoGet(
  env: Env,
  endpoint: string
): Promise<any> {
  const response = await fetch(`${DATAFORSEO_BASE}${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${getCredentials(env)}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    console.error(`DataForSEO GET error [${endpoint}]:`, JSON.stringify(data));
    throw new Error(`DataForSEO API error: ${response.status}`);
  }

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
