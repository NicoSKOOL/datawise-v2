import { describe, it, expect, vi, beforeEach } from 'vitest';

const dfs = { calls: [] as Array<{ path: string; payload: any }>, impl: null as null | ((path: string, payload: any) => any) };
vi.mock('../dataforseo/client', () => ({
  dataforseoRequestCached: async (_env: unknown, path: string, payload: any) => {
    dfs.calls.push({ path, payload });
    return dfs.impl ? dfs.impl(path, payload) : null;
  },
  dataforseoGet: async () => null,
  getTaskError: (data: any) => (data?.tasks?.[0]?.status_code === 20000 ? null : 'failed'),
}));

import { analyzeSerp, handleSerpAnalysis, searchLocations, titleMatch, urlMatch } from './serp-analysis';

const ok = (result: unknown) => ({ tasks: [{ status_code: 20000, result: [result] }] });

const serpItems = [
  { type: 'local_pack', rank_group: 1, title: 'The Jet Co', domain: 'thejetco.com.au', url: 'https://thejetco.com.au/', rating: { value: 5, votes_count: 264 } },
  { type: 'organic', rank_group: 1, rank_absolute: 2, domain: 'www.sydneypressure.com.au', url: 'https://www.sydneypressure.com.au/', title: 'Sydney pressure washing service | Soft washing' },
  { type: 'people_also_ask', rank_group: 1, items: [] },
  { type: 'organic', rank_group: 2, rank_absolute: 4, domain: 'thejetco.com.au', url: 'https://thejetco.com.au/', title: 'The Jet Co Pressure Cleaning Sydney' },
  { type: 'organic', rank_group: 3, rank_absolute: 5, domain: 'www.airtasker.com', url: 'https://www.airtasker.com/au/services/high-pressure-cleaning/sydney/', title: 'Top 10 Best Rated High Pressure Cleaning in Sydney', rating: { value: 4.9, votes_count: 188 } },
];

const backlinkItems = [
  { url: 'https://www.sydneypressure.com.au/', backlinks: 18, referring_main_domains: 17 },
  { url: 'sydneypressure.com.au', backlinks: 37, referring_main_domains: 34 },
  { url: 'https://thejetco.com.au/', rank: 158, backlinks: 866, referring_main_domains: 124 },
  { url: 'thejetco.com.au', rank: 190, backlinks: 969, referring_main_domains: 178, first_seen: '2016-01-01 00:00:00 +00:00', referring_links_countries: { AU: 751, '': 146, US: 15 } },
  { url: 'https://www.airtasker.com/au/services/high-pressure-cleaning/sydney/', rank: 300, backlinks: 40, referring_main_domains: 12 },
  { url: 'airtasker.com', rank: 740, backlinks: 66_600_000, referring_main_domains: 90_000 },
];

describe('keyword matching', () => {
  it('grades title relevance', () => {
    expect(titleMatch('Sydney pressure washing service', 'pressure washing sydney')).toBe('all');
    expect(titleMatch('Pressure Washing Sydney | Get Blasted', 'pressure washing sydney')).toBe('exact');
    expect(titleMatch('Pressure Cleaning in Sydney', 'pressure washing sydney')).toBe('partial');
    expect(titleMatch('Jim\'s Cleaning', 'pressure washing sydney')).toBe('none');
  });

  it('matches glued-together domains', () => {
    expect(urlMatch('https://www.sydneypressure.com.au/', 'sydney pressure')).toBe('all');
    expect(urlMatch('https://jimscleaning.com.au/local/pressure-cleaning/nsw/north-sydney/', 'pressure washing sydney')).toBe('partial');
  });
});

describe('analyzeSerp', () => {
  const out = analyzeSerp({ keyword: 'pressure washing sydney', serpItems, backlinkItems, countryIso: 'AU', countryLabel: 'Australia' });

  it('keeps only organic rows in order and joins page + domain link stats', () => {
    expect(out.results.map((r) => r.domain)).toEqual(['sydneypressure.com.au', 'thejetco.com.au', 'airtasker.com']);
    expect(out.results[1].page?.rank).toBe(16);
    expect(out.results[1].site?.rank).toBe(19);
    expect(out.results[1].site?.referringDomains).toBe(178);
    expect(out.results[0].page?.rank).toBe(0);
  });

  it('explains why results rank', () => {
    const jet = out.results[1];
    const labels = jet.reasons.map((r) => r.label).join(' | ');
    expect(jet.inLocalPack).toBe(true);
    expect(labels).toContain('Local Pack');
    expect(labels).toContain('Homepage');
    expect(labels).toContain('of its links come from Australia sites');
    expect(labels).toContain('since 2016');
    const airtasker = out.results[2];
    expect(airtasker.reasons.some((r) => r.label.startsWith('Big-brand'))).toBe(true);
    expect(airtasker.reasons.some((r) => r.label.includes('188 reviews'))).toBe(true);
  });

  it('flags the weakest ranking page as beatable but never a big brand', () => {
    expect(out.results[0].beatable).toBe(true);
    expect(out.results[2].beatable).toBe(false);
  });

  it('summarises the SERP', () => {
    expect(out.localPack).toHaveLength(1);
    expect(out.localPack[0].hasOrganicListing).toBe(true);
    expect(out.summary.serpFeatures).toEqual(expect.arrayContaining(['Local Pack', 'People Also Ask']));
    expect(out.summary.homepageCount).toBe(2);
    expect(out.summary.verdict).toContain('Local Pack');
  });
});

describe('handleSerpAnalysis', () => {
  beforeEach(() => { dfs.calls = []; dfs.impl = null; });
  const req = (body: unknown) => new Request('https://x/api/keywords/serp-analysis', { method: 'POST', body: JSON.stringify(body) });

  it('uses the city code for the SERP, the country code for Labs, and one backlinks call for pages + domains', async () => {
    dfs.impl = (path) => {
      if (path.includes('/serp/')) return ok({ items: serpItems });
      if (path.includes('keyword_overview')) return ok({ items: [{ keyword: 'pressure washing sydney', keyword_info: { search_volume: 110, monthly_searches: [{ year: 2026, month: 8, search_volume: 700 }] }, keyword_properties: { keyword_difficulty: 23 } }] });
      if (path.includes('bulk_pages_summary')) return ok({ items: backlinkItems });
      return null;
    };
    const res = await handleSerpAnalysis(req({ keyword: 'pressure washing sydney', location_code: 2036, serp_location_code: 1000286, language_code: 'en', country_iso: 'AU', country_label: 'Australia' }), {} as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const serpCall = dfs.calls.find((c) => c.path.includes('/serp/'))!;
    const labsCall = dfs.calls.find((c) => c.path.includes('keyword_overview'))!;
    const blCall = dfs.calls.find((c) => c.path.includes('bulk_pages_summary'))!;
    expect(serpCall.payload[0].location_code).toBe(1000286);
    expect(labsCall.payload[0].location_code).toBe(2036);
    expect(blCall.payload[0].targets).toEqual(expect.arrayContaining(['https://thejetco.com.au/', 'thejetco.com.au', 'airtasker.com']));
    expect(body.metrics.keyword_difficulty).toBe(23);
    expect(body.metrics.monthly_searches).toHaveLength(1);
    expect(body.results).toHaveLength(3);
    expect(body.backlinks_available).toBe(true);
  });

  it('still returns the SERP when the backlinks call fails', async () => {
    dfs.impl = (path) => {
      if (path.includes('/serp/')) return ok({ items: serpItems });
      if (path.includes('bulk_pages_summary')) throw new Error('boom');
      return null;
    };
    const res = await handleSerpAnalysis(req({ keyword: 'pressure washing sydney' }), {} as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.backlinks_available).toBe(false);
    expect(body.metrics).toBeNull();
    expect(body.results[0].page).toBeNull();
  });

  it('returns 404 (credit refunded) when the SERP has no organic results', async () => {
    dfs.impl = () => ok({ items: [] });
    const res = await handleSerpAnalysis(req({ keyword: 'zzzz' }), {} as any);
    expect(res.status).toBe(404);
  });
});

describe('searchLocations', () => {
  const list: Array<[number, string, string]> = [
    [2036, 'Australia', 'Country'],
    [20035, 'New South Wales,Australia', 'State'],
    [1000286, 'Sydney,New South Wales,Australia', 'City'],
    [9051234, 'Sydney Olympic Park,New South Wales,Australia', 'Neighborhood'],
    [1000999, 'North Sydney,New South Wales,Australia', 'City'],
  ];
  it('ranks exact city names first, then prefixes, then contains', () => {
    const names = searchLocations(list, 'sydney').map((l) => l.location_name);
    expect(names[0]).toBe('Sydney,New South Wales,Australia');
    expect(names[1]).toBe('Sydney Olympic Park,New South Wales,Australia');
    expect(names).toContain('North Sydney,New South Wales,Australia');
  });
  it('returns nothing for an empty query', () => {
    expect(searchLocations(list, ' ')).toEqual([]);
  });
});
