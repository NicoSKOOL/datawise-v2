import { describe, it, expect, vi, beforeEach } from 'vitest';

const dfs = { calls: [] as Array<{ path: string; payload: any }>, impl: null as null | ((path: string, payload: any) => any) };
vi.mock('../dataforseo/client', () => ({
  dataforseoRequestCached: async (_env: unknown, path: string, payload: any) => {
    dfs.calls.push({ path, payload });
    return dfs.impl ? dfs.impl(path, payload) : null;
  },
}));

import { handleKeywordOverview } from './keywords';

// Bug 7d3588e0: KD showed a dash on the Overview tab because keyword_overview
// returns keyword_difficulty: null for seeds DataForSEO has not precomputed.
const overview = (kd: number | null) => ({
  tasks: [{ status_code: 20000, result: [{ items: [{ keyword: 'padstow cottages', keyword_info: { search_volume: 90 }, keyword_properties: { keyword_difficulty: kd } }] }] }],
});
const bulk = (kd: number | null) => ({
  tasks: [{ status_code: 20000, result: [{ items: [{ keyword: 'padstow cottages', keyword_difficulty: kd }] }] }],
});
const req = (body: unknown) => new Request('https://x/api/keywords/overview', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => { dfs.calls = []; dfs.impl = null; });

describe('handleKeywordOverview keyword difficulty fallback', () => {
  it('fills a null keyword_difficulty from bulk_keyword_difficulty for the same locale', async () => {
    dfs.impl = (path) => path.includes('keyword_overview') ? overview(null) : bulk(37);
    const res = await handleKeywordOverview(req({ keyword: 'padstow cottages', location_code: 2826, language_code: 'en' }), {} as any);
    const body = await res.json() as any;
    expect(body.tasks[0].result[0].items[0].keyword_properties.keyword_difficulty).toBe(37);
    expect(dfs.calls.map(c => c.path)).toEqual([
      '/dataforseo_labs/google/keyword_overview/live',
      '/dataforseo_labs/google/bulk_keyword_difficulty/live',
    ]);
    expect(dfs.calls[1].payload[0]).toEqual({ keywords: ['padstow cottages'], location_code: 2826, language_code: 'en' });
  });

  it('does not call bulk_keyword_difficulty when the overview already has a value, including a genuine 0', async () => {
    dfs.impl = () => overview(0);
    const res = await handleKeywordOverview(req({ keyword: 'padstow cottages' }), {} as any);
    const body = await res.json() as any;
    expect(body.tasks[0].result[0].items[0].keyword_properties.keyword_difficulty).toBe(0);
    expect(dfs.calls).toHaveLength(1);
  });

  it('leaves the overview untouched when the fallback has no number or throws', async () => {
    dfs.impl = (path) => path.includes('keyword_overview') ? overview(null) : bulk(null);
    let body = await (await handleKeywordOverview(req({ keyword: 'padstow cottages' }), {} as any)).json() as any;
    expect(body.tasks[0].result[0].items[0].keyword_properties.keyword_difficulty).toBeNull();

    dfs.impl = (path) => { if (path.includes('keyword_overview')) return overview(null); throw new Error('DataForSEO API error: 500'); };
    const res = await handleKeywordOverview(req({ keyword: 'padstow cottages' }), {} as any);
    expect(res.status).toBe(200);
    body = await res.json() as any;
    expect(body.tasks[0].result[0].items[0].keyword_properties.keyword_difficulty).toBeNull();
  });

  it('skips the fallback when the overview returned no item at all', async () => {
    dfs.impl = () => ({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
    await handleKeywordOverview(req({ keyword: 'zzz' }), {} as any);
    expect(dfs.calls).toHaveLength(1);
  });
});
