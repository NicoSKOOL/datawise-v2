import { describe, it, expect } from 'vitest';
import { getTaskError, isCacheableDfsResponse } from './client';

const okResponse = {
  status_code: 20000,
  tasks_error: 0,
  tasks: [
    {
      status_code: 20000,
      status_message: 'Ok.',
      result: [{ total: {}, items: [{ key: 'coldiq' }] }],
    },
  ],
};

// DFS returns HTTP 200 with the failure inside the task (e.g. 40501 invalid
// domain). This shape was found cached in production KV on 2026-06-11.
const taskErrorResponse = {
  status_code: 20000,
  tasks_error: 1,
  tasks: [
    {
      status_code: 40501,
      status_message: "Invalid Field: ''domain' must be a valid domain.'.",
      result: null,
    },
  ],
};

const emptyTasksResponse = { status_code: 20000, tasks: [] };

describe('getTaskError', () => {
  it('returns null for a successful task', () => {
    expect(getTaskError(okResponse)).toBeNull();
  });

  it('returns the status message for a failed task', () => {
    expect(getTaskError(taskErrorResponse)).toContain('Invalid Field');
  });

  it('returns a generic message when tasks are missing', () => {
    expect(getTaskError(emptyTasksResponse)).toBe('DataForSEO returned no task');
    expect(getTaskError(null)).toBe('DataForSEO returned no task');
  });
});

describe('isCacheableDfsResponse', () => {
  it('caches successful task responses', () => {
    expect(isCacheableDfsResponse(okResponse)).toBe(true);
  });

  it('does not cache task-level failures', () => {
    expect(isCacheableDfsResponse(taskErrorResponse)).toBe(false);
  });

  it('does not cache responses with no tasks', () => {
    expect(isCacheableDfsResponse(emptyTasksResponse)).toBe(false);
    expect(isCacheableDfsResponse(null)).toBe(false);
  });
});

import { vi } from 'vitest';
import { dataforseoRequestCached, type DfsMeter } from './client';

function fakeKv(store = new Map<string, string>()) {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
}

describe('dfsMeter', () => {
  it('adds live cost and counts cache hits', async () => {
    const meter: DfsMeter = { costUsd: 0, liveCalls: 0, cacheHits: 0 };
    const env = { KV: fakeKv(), DATAFORSEO_EMAIL: 'e', DATAFORSEO_PASSWORD: 'p', dfsMeter: meter };
    const live = { ...okResponse, cost: 0.0123 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(live), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await dataforseoRequestCached(env, '/x/live', [{ a: 1 }], { ttlSeconds: 60 });
    await dataforseoRequestCached(env, '/x/live', [{ a: 1 }], { ttlSeconds: 60 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(meter.liveCalls).toBe(1);
    expect(meter.cacheHits).toBe(1);
    expect(meter.costUsd).toBeCloseTo(0.0123, 6);
    vi.unstubAllGlobals();
  });

  it('is a no-op without a meter', async () => {
    const env = { KV: fakeKv(), DATAFORSEO_EMAIL: 'e', DATAFORSEO_PASSWORD: 'p' };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...okResponse, cost: 1 }), { status: 200 })));
    const data = await dataforseoRequestCached(env, '/y/live', [{}], { ttlSeconds: 0 });
    expect(data.cost).toBe(1);
    vi.unstubAllGlobals();
  });
});
