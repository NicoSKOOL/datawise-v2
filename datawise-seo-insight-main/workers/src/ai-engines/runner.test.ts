import { describe, it, expect, vi, afterEach } from 'vitest';
import { runEngine, EngineTaskError, ENGINES, ALL_ENGINES } from './index';
import chatgptFixture from './__fixtures__/chatgpt.json';
import taskError from './__fixtures__/chatgpt-task-error.json';

const kv = new Map<string, string>();
const env = {
  KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } },
  DATAFORSEO_EMAIL: 'x', DATAFORSEO_PASSWORD: 'y',
} as any;
const locale = { location_code: 2840, language_code: 'en' };

afterEach(() => { kv.clear(); vi.unstubAllGlobals(); });

describe('runEngine', () => {
  it('has an adapter for every engine', () => {
    for (const id of ALL_ENGINES) expect(ENGINES[id].id).toBe(id);
  });

  it('posts the adapter request, parses the answer, and serves the second call from KV', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(chatgptFixture), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 });
    const second = await runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 });
    expect(first.cited.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toContain('/ai_optimization/chat_gpt/llm_scraper/live/advanced');
    expect(JSON.parse(init.body)[0]).toMatchObject({ keyword: 'best crm', location_code: 2840 });
  });

  it('throws EngineTaskError on a task-level error and does not cache it', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(taskError), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 }))
      .rejects.toBeInstanceOf(EngineTaskError);
    await expect(runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 }))
      .rejects.toThrow(/Timeout/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('separates cache entries by locale', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(chatgptFixture), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await runEngine(env, 'chatgpt', 'best crm', locale, { ttlSeconds: 3600, timeoutMs: 5000 });
    await runEngine(env, 'chatgpt', 'best crm', { location_code: 2724, language_code: 'es' }, { ttlSeconds: 3600, timeoutMs: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
