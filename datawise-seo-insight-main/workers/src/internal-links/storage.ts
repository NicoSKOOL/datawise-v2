// Stage data for Internal Links runs lives in R2, not KV: a run is advanced
// by many short slices, and each slice must read exactly what the previous
// one wrote. KV reads can be served stale from the edge cache for up to 60s,
// which would silently drop progress. R2 is strongly consistent.

import type { Env } from '../index';

const prefix = (runId: string) => `internal-links/${runId}/`;

export async function putRunJson(env: Env, runId: string, name: string, value: unknown): Promise<void> {
  await env.TASK_ATTACHMENTS.put(`${prefix(runId)}${name}.json`, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json' },
  });
}

export async function getRunJson<T>(env: Env, runId: string, name: string): Promise<T | null> {
  const obj = await env.TASK_ATTACHMENTS.get(`${prefix(runId)}${name}.json`);
  if (!obj) return null;
  return (await obj.json()) as T;
}

export async function deleteRunJson(env: Env, runId: string, names: string[]): Promise<void> {
  if (names.length) await env.TASK_ATTACHMENTS.delete(names.map((n) => `${prefix(runId)}${n}.json`));
}

export async function deleteRunData(env: Env, runId: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.TASK_ATTACHMENTS.list({ prefix: prefix(runId), cursor });
    if (listed.objects.length) await env.TASK_ATTACHMENTS.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
