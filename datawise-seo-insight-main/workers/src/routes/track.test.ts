import { describe, it, expect } from 'vitest';
import { handlePageview } from './track';

// Captures what would be written to pageviews, so we can assert that
// credentials in query strings never reach storage.
function makeEnv() {
  const inserted: unknown[][] = [];
  const kv = new Map<string, string>();
  const env = {
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v); },
    },
    DB: {
      prepare: (_sql: string) => ({
        bind: (...args: unknown[]) => ({
          run: async () => { inserted.push(args); return { meta: { changes: 1 } }; },
        }),
      }),
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { env: env as any, inserted };
}

function beacon(path: string) {
  return new Request('https://api.test/api/track/pageview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body: JSON.stringify({ session_id: 's1', path }),
  });
}

describe('handlePageview path sanitizing', () => {
  it.each([
    ['/auth/callback?token=secret123', '/auth/callback'],
    ['/reset-password?token=abc#x', '/reset-password'],
    ['/dashboard#section', '/dashboard'],
    ['/keywords', '/keywords'],
  ])('stores %s as %s', async (input, expected) => {
    const { env, inserted } = makeEnv();
    const res = await handlePageview(beacon(input), env);
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][2]).toBe(expected);
    expect(JSON.stringify(inserted[0])).not.toContain('token=');
  });
});
