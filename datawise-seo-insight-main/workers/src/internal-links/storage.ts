// Stage data for Internal Links runs lives in R2, not KV: a run is advanced
// by many short slices, and each slice must read exactly what the previous
// one wrote. KV reads can be served stale from the edge cache for up to 60s,
// which would silently drop progress. R2 is strongly consistent.

import type { Env } from '../index';

const prefix = (runId: string) => `internal-links/${runId}/`;

// R2 occasionally answers with a transient "internal error (10001)"; one of
// those failed a 300-page run mid-scoring (yoast.com, 2026-10-02). Retry a
// few times before letting the error fail the run.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 500 * i));
    }
  }
}

export async function putRunJson(env: Env, runId: string, name: string, value: unknown): Promise<void> {
  const body = JSON.stringify(value);
  await withRetry(() =>
    env.TASK_ATTACHMENTS.put(`${prefix(runId)}${name}.json`, body, {
      httpMetadata: { contentType: 'application/json' },
    })
  );
}

export async function getRunJson<T>(env: Env, runId: string, name: string): Promise<T | null> {
  return withRetry(async () => {
    const obj = await env.TASK_ATTACHMENTS.get(`${prefix(runId)}${name}.json`);
    if (!obj) return null;
    return (await obj.json()) as T;
  });
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
