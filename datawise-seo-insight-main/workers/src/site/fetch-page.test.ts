import { describe, it, expect, vi, beforeEach } from 'vitest';

const dfs = vi.hoisted(() => ({ cached: vi.fn() }));
vi.mock('../dataforseo/client', () => ({ dataforseoRequestCached: (...a: unknown[]) => dfs.cached(...a) }));

import { fetchSitePage, mapLimit } from './fetch-page';

const kvStore = new Map<string, string>();
const env = { KV: { get: async (k: string) => kvStore.get(k) ?? null, put: async (k: string, v: string) => { kvStore.set(k, v); } }, DATAFORSEO_EMAIL: 'e', DATAFORSEO_PASSWORD: 'p' } as any;
const page = '<html><head><title>Services | Acme</title></head><body><h1>Hot Water</h1><p>Call 03 9000 0000.</p></body></html>';
const res = (body: string, status = 200, type = 'text/html') => ({ ok: status < 400, status, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) }, text: async () => body });

beforeEach(() => { kvStore.clear(); dfs.cached.mockReset(); });

describe('fetchSitePage', () => {
  it('uses the direct fetch when it works and caches the facts', async () => {
    const fetchImpl = vi.fn(async () => res(page));
    const f = await fetchSitePage(env, 'https://acme.com.au/services', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(f.source).toBe('direct');
    expect(f.title).toBe('Services | Acme');
    expect(f.headings.h1).toEqual(['Hot Water']);
    expect((fetchImpl.mock.calls[0] as any)[1].headers['user-agent']).toContain('Mozilla/5.0');
    expect(dfs.cached).not.toHaveBeenCalled();
    expect(kvStore.has('site-page:v1:https://acme.com.au/services')).toBe(true);
    const again = await fetchSitePage(env, 'https://acme.com.au/services', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(again.title).toBe('Services | Acme');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('falls back to DataForSEO content_parsing on 403 and marks the source', async () => {
    const fetchImpl = vi.fn(async () => res('Forbidden', 403));
    dfs.cached.mockResolvedValue({ tasks: [{ result: [{ items: [{ status_code: 200, page_content: {
      header: { primary_content: [{ text: 'Call 03 9000 0000' }] },
      main_topic: [{ h_title: 'Hot Water', level: 1, primary_content: [{ text: 'Open Monday to Friday 9am-5pm.' }] }, { h_title: 'Drains', level: 2, primary_content: [] }],
    } }] }] }] });
    const f = await fetchSitePage(env, 'https://acme.com.au/x', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(dfs.cached).toHaveBeenCalledWith(env, '/on_page/content_parsing/live', [{ url: 'https://acme.com.au/x', enable_javascript: true }], { ttlSeconds: 86400, timeoutMs: 8000 });
    expect(f.source).toBe('dataforseo');
    expect(f.status_code).toBe(200);
    expect(f.headings).toEqual({ h1: ['Hot Water'], h2: ['Drains'], h3: [] });
    expect(f.phones).toEqual(['03 9000 0000']);
    expect(f.hours_text).toEqual(['Open Monday to Friday 9am-5pm.']);
    expect(f.schema).toEqual([]);
    expect(f.body_text).toContain('Hot Water');
    expect(f.blocked).toBe(false);
  });
  it('falls back when the direct fetch trips the bot challenge detector', async () => {
    const fetchImpl = vi.fn(async () => res('<html><title>Just a moment...</title><body>Checking your browser</body></html>', 200));
    dfs.cached.mockResolvedValue({ tasks: [{ result: [{ items: [{ status_code: 200, page_content: { main_topic: [{ h_title: 'Real', level: 1, primary_content: [{ text: 'content' }] }] } }] }] }] });
    const f = await fetchSitePage(env, 'https://acme.com.au/', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(f.source).toBe('dataforseo');
    expect(f.headings.h1).toEqual(['Real']);
  });
  it('reports blocked when both paths fail', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    dfs.cached.mockRejectedValue(new Error('dfs down'));
    const f = await fetchSitePage(env, 'https://acme.com.au/', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(f.fetch_failed).toBe(true);
    expect(f.blocked).toBe(true);
    expect(f.body_text).toBeNull();
    expect(kvStore.size).toBe(0);
  });
  it('treats non-html content as failed without calling DataForSEO', async () => {
    const fetchImpl = vi.fn(async () => res('%PDF', 200, 'application/pdf'));
    const f = await fetchSitePage(env, 'https://acme.com.au/file', { bodyChars: 100, fetchImpl: fetchImpl as any });
    expect(f.fetch_failed).toBe(true);
    expect(dfs.cached).not.toHaveBeenCalled();
  });
});

describe('mapLimit', () => {
  it('runs at most `limit` at once and preserves order', async () => {
    let active = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
