import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const mocks = vi.hoisted(() => ({ discover: vi.fn(), fetchPage: vi.fn() }));
vi.mock('../../site/discover', async (importActual) => {
  const actual = await importActual<typeof import('../../site/discover')>();
  return { ...actual, discoverSitemapUrls: (...a: unknown[]) => mocks.discover(...a) };
});
vi.mock('../../site/fetch-page', async (importActual) => {
  const actual = await importActual<typeof import('../../site/fetch-page')>();
  return { ...actual, fetchSitePage: (...a: unknown[]) => mocks.fetchPage(...a) };
});

import { sitePages } from './site-pages';
import { ALL_TOOLS } from './registry';
import { estimateCostUsd } from '../budget';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

const facts = (url: string, extra: Record<string, unknown> = {}) => ({
  url, status_code: 200, source: 'direct', blocked: false, fetch_failed: false, fetched_at: 'now', title: `T ${url}`, meta_description: null, canonical: null,
  headings: { h1: ['H'], h2: [], h3: [] }, phones: ['03 9000 0000'], addresses: ['1 Main St, Richmond VIC 3121'], hours_text: [], schema: [], nav_links: [],
  service_terms: ['H'], word_count: 50, body_text: 'body', ...extra,
});

beforeEach(() => {
  mocks.discover.mockReset(); mocks.fetchPage.mockReset();
  mocks.discover.mockResolvedValue({ sitemap_found: true, urls: ['https://acme.com.au/', 'https://acme.com.au/blog/post', 'https://acme.com.au/services/hot-water', 'https://acme.com.au/random'] });
  mocks.fetchPage.mockImplementation(async (_env: unknown, url: string) => {
    if (url === 'https://acme.com.au/') return facts(url, { nav_links: [{ anchor: 'Contact', url: 'https://acme.com.au/contact' }, { anchor: 'Areas', url: 'https://acme.com.au/service-areas' }], schema: [{ '@type': 'Plumber', telephone: '+61390000000', openingHoursSpecification: [{ dayOfWeek: 'Monday', opens: '08:00', closes: '17:00' }] }] });
    if (url === 'https://acme.com.au/random') return facts(url, { blocked: true, body_text: null });
    return facts(url);
  });
});

describe('datawise_site_pages', () => {
  it('discovers, ranks, fetches with the homepage first and rolls up site facts', async () => {
    const { env } = makeMcpTestEnv();
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'acme.com.au/services/hot-water?utm_source=x', max_pages: 5 }), { env, identity });
    const s = out.structuredContent as any;
    expect(out.isError).toBeFalsy();
    expect(mocks.discover).toHaveBeenCalledWith('https://acme.com.au', expect.any(Function), { maxUrls: 500, timeoutMs: 5000 });
    expect(mocks.fetchPage.mock.calls[0][1]).toBe('https://acme.com.au/');
    expect(s.site).toEqual({ url: 'https://acme.com.au', host: 'acme.com.au', sitemap_found: true, pages_discovered: 6, pages_returned: 5 });
    expect(s.pages.map((p: any) => p.url)).toEqual(['https://acme.com.au/', 'https://acme.com.au/contact', 'https://acme.com.au/services/hot-water', 'https://acme.com.au/service-areas', 'https://acme.com.au/random']);
    expect(s.blocked_urls).toEqual(['https://acme.com.au/random']);
    expect(s.site_facts.phones).toEqual([{ value: '03 9000 0000', pages: 4 }]);
    expect(s.site_facts.addresses).toEqual([{ value: '1 Main St, Richmond VIC 3121', pages: 4 }]);
    expect(s.site_facts.local_business_schema['@type']).toBe('Plumber');
    expect(s.site_facts.hours_from_schema).toEqual([{ dayOfWeek: 'Monday', opens: '08:00', closes: '17:00' }]);
    expect(out.content[0].text).toContain('acme.com.au: 5 pages');
  });
  it('explicit urls come first and count against the cap', async () => {
    const { env } = makeMcpTestEnv();
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'https://acme.com.au', urls: ['https://acme.com.au/pricing'], max_pages: 2 }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.pages.map((p: any) => p.url)).toEqual(['https://acme.com.au/', 'https://acme.com.au/pricing']);
  });
  it('rejects a bad url and reports when the homepage and sitemap both fail', async () => {
    const { env } = makeMcpTestEnv();
    expect((await sitePages.run(sitePages.inputSchema.parse({ url: 'nope' }), { env, identity })).isError).toBe(true);
    mocks.discover.mockResolvedValue({ sitemap_found: false, urls: [] });
    mocks.fetchPage.mockResolvedValue(facts('https://acme.com.au', { fetch_failed: true, blocked: true, body_text: null, nav_links: [] }));
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'https://acme.com.au' }), { env, identity });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('could not be fetched');
  });
  it('is registered at position 16 with a budget line', () => {
    expect(ALL_TOOLS[15].name).toBe('datawise_site_pages');
    expect(ALL_TOOLS).toHaveLength(16);
    expect(estimateCostUsd('datawise_site_pages', { max_pages: 15 })).toBeCloseTo(0.03, 5);
    expect(estimateCostUsd('datawise_site_pages', { max_pages: 25, urls: ['a', 'b'] })).toBeCloseTo(0.05, 5);
  });

  it('does not treat a plain Organization schema block as LocalBusiness', async () => {
    const { env } = makeMcpTestEnv();
    mocks.fetchPage.mockImplementation(async (_env: unknown, url: string) => {
      if (url === 'https://acme.com.au/') return facts(url, { schema: [{ '@type': 'Organization', name: 'Acme' }] });
      return facts(url);
    });
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'https://acme.com.au', max_pages: 3 }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.site_facts.local_business_schema).toBeNull();
    expect(out.content[0].text).toContain('LocalBusiness schema no');
  });

  it('still recognizes a LocalBusiness subtype like Plumber', async () => {
    const { env } = makeMcpTestEnv();
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'https://acme.com.au', max_pages: 3 }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.site_facts.local_business_schema['@type']).toBe('Plumber');
    expect(out.content[0].text).toContain('LocalBusiness schema yes');
  });

  it('excludes a fetch_failed, non-blocked page from blocked_urls and site_facts rollups but counts it as skipped', async () => {
    const { env } = makeMcpTestEnv();
    mocks.fetchPage.mockImplementation(async (_env: unknown, url: string) => {
      if (url === 'https://acme.com.au/') return facts(url, { nav_links: [{ anchor: 'Contact', url: 'https://acme.com.au/contact' }] });
      if (url === 'https://acme.com.au/contact') return facts(url, { fetch_failed: true, blocked: false, body_text: null, phones: ['999 999 999'], addresses: ['999 Unique St'] });
      return facts(url);
    });
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'https://acme.com.au', max_pages: 2 }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.pages.map((p: any) => p.url)).toContain('https://acme.com.au/contact');
    expect(s.blocked_urls).toEqual([]);
    expect(s.skipped_urls_count).toBe(1);
    expect(s.site_facts.phones.some((p: any) => p.value === '999 999 999')).toBe(false);
    expect(s.site_facts.addresses.some((a: any) => a.value === '999 Unique St')).toBe(false);
  });

  it('stops fetching once the wall-clock deadline has passed and returns a fetch_failed placeholder', async () => {
    const { env } = makeMcpTestEnv();
    let calls = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      calls++;
      // Call 1 captures the deadline, call 2 is the first in-loop check
      // (still within budget); everything from call 3 on is past the 60s
      // deadline, simulating time passing after the first non-home page.
      return calls <= 2 ? 1_000_000 : 1_000_000 + 61_000;
    });
    try {
      const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'https://acme.com.au', max_pages: 3 }), { env, identity });
      const s = out.structuredContent as any;
      const fetchedUrls = mocks.fetchPage.mock.calls.map((c: any[]) => c[1]);
      expect(fetchedUrls).toEqual(['https://acme.com.au/', 'https://acme.com.au/contact']);
      const skipped = s.pages.find((p: any) => p.url === 'https://acme.com.au/services/hot-water');
      expect(skipped.fetch_failed).toBe(true);
      expect(skipped.blocked).toBe(false);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
