import { describe, it, expect, vi } from 'vitest';
import { siteOrigin, normalizeSiteUrl, parseRobotsSitemaps, parseSitemapXml, scoreSiteUrl, rankSiteUrls, discoverSitemapUrls } from './discover';

describe('siteOrigin + normalizeSiteUrl', () => {
  it('reduces any url to the origin', () => {
    expect(siteOrigin('acme.com.au/services/drains?x=1')).toBe('https://acme.com.au');
    expect(siteOrigin('http://www.acme.com.au')).toBe('http://www.acme.com.au');
    expect(siteOrigin('not a url at all')).toBeNull();
  });
  it('rejects private and internal hosts via the SSRF guard', () => {
    expect(siteOrigin('http://192.168.1.10/')).toBeNull();
    expect(siteOrigin('http://169.254.169.254/latest')).toBeNull();
    expect(siteOrigin('http://localhost:8080')).toBeNull();
    expect(normalizeSiteUrl('http://10.0.0.5/x', 'acme.com.au')).toBeNull();
  });
  it('keeps same-host html pages and drops junk', () => {
    const h = 'acme.com.au';
    expect(normalizeSiteUrl('https://acme.com.au/services/#top', h)).toBe('https://acme.com.au/services');
    expect(normalizeSiteUrl('https://acme.com.au/about?utm_source=x&id=2', h)).toBe('https://acme.com.au/about?id=2');
    expect(normalizeSiteUrl('/contact', h)).toBe('https://acme.com.au/contact');
    expect(normalizeSiteUrl('https://www.acme.com.au/x', h)).toBe('https://www.acme.com.au/x');
    expect(normalizeSiteUrl('https://other.com/x', h)).toBeNull();
    expect(normalizeSiteUrl('https://acme.com.au/brochure.pdf', h)).toBeNull();
    expect(normalizeSiteUrl('https://acme.com.au/wp-json/x', h)).toBeNull();
    expect(normalizeSiteUrl('https://acme.com.au/tag/x', h)).toBeNull();
    expect(normalizeSiteUrl('mailto:a@b.c', h)).toBeNull();
    expect(normalizeSiteUrl('tel:123', h)).toBeNull();
  });
});

describe('robots + sitemap parsing', () => {
  it('reads Sitemap lines', () => {
    expect(parseRobotsSitemaps('User-agent: *\nDisallow:\nSitemap: https://a.com/sitemap.xml\nsitemap: https://a.com/news.xml')).toEqual(['https://a.com/sitemap.xml', 'https://a.com/news.xml']);
  });
  it('reads urlset and sitemapindex', () => {
    expect(parseSitemapXml('<urlset><url><loc>https://a.com/</loc></url><url><loc> https://a.com/x </loc></url></urlset>')).toEqual({ sitemaps: [], urls: ['https://a.com/', 'https://a.com/x'] });
    expect(parseSitemapXml('<sitemapindex><sitemap><loc>https://a.com/page-sitemap.xml</loc></sitemap></sitemapindex>')).toEqual({ sitemaps: ['https://a.com/page-sitemap.xml'], urls: [] });
  });
});

describe('scoring and ranking', () => {
  it('scores by page kind', () => {
    expect(scoreSiteUrl('https://a.com/', null, false)).toBe(100);
    expect(scoreSiteUrl('https://a.com/contact-us', null, false)).toBe(90);
    expect(scoreSiteUrl('https://a.com/about', 'About', false)).toBe(90);
    expect(scoreSiteUrl('https://a.com/services/hot-water', null, false)).toBe(80);
    expect(scoreSiteUrl('https://a.com/x', 'Our Services', false)).toBe(80);
    expect(scoreSiteUrl('https://a.com/service-areas/richmond', null, false)).toBe(70);
    expect(scoreSiteUrl('https://a.com/anything', null, true)).toBe(60);
    expect(scoreSiteUrl('https://a.com/blog/2024/post', null, false)).toBe(5);
    expect(scoreSiteUrl('https://a.com/random', null, false)).toBe(10);
    // A blog page reached via nav is still a blog page: the blog penalty
    // must outrank the generic fromNav score.
    expect(scoreSiteUrl('https://a.com/blog', 'Blog', true)).toBe(5);
  });
  it('ranks explicit urls first, then by score, deduplicated and capped', () => {
    const out = rankSiteUrls([
      { url: 'https://a.com/random' }, { url: 'https://a.com/services' }, { url: 'https://a.com/' },
      { url: 'https://a.com/services/' }, { url: 'https://a.com/contact', anchor: 'Contact', fromNav: true }, { url: 'https://a.com/blog/post' },
    ], { host: 'a.com', explicit: ['https://a.com/pricing'], max: 4 });
    expect(out).toEqual(['https://a.com/pricing', 'https://a.com/', 'https://a.com/contact', 'https://a.com/services']);
  });
});

describe('discoverSitemapUrls', () => {
  const res = (body: string, ok = true) => ({ ok, status: ok ? 200 : 404, text: async () => body });
  it('reads robots, follows one index level, caps urls', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://a.com/robots.txt') return res('Sitemap: https://a.com/sitemap_index.xml');
      if (url === 'https://a.com/sitemap_index.xml') return res('<sitemapindex><sitemap><loc>https://a.com/page-sitemap.xml</loc></sitemap></sitemapindex>');
      if (url === 'https://a.com/page-sitemap.xml') return res('<urlset><url><loc>https://a.com/</loc></url><url><loc>https://a.com/services</loc></url></urlset>');
      return res('', false);
    });
    const out = await discoverSitemapUrls('https://a.com', fetchImpl as any, { maxUrls: 1 });
    expect(out.sitemap_found).toBe(true);
    expect(out.urls).toEqual(['https://a.com/']);
  });
  it('falls back to /sitemap.xml and reports none when nothing exists', async () => {
    const fetchImpl = vi.fn(async () => res('', false));
    const out = await discoverSitemapUrls('https://a.com', fetchImpl as any);
    expect(fetchImpl.mock.calls.map((c: any[]) => c[0])).toEqual(['https://a.com/robots.txt', 'https://a.com/sitemap.xml', 'https://a.com/sitemap_index.xml']);
    expect(out).toEqual({ sitemap_found: false, urls: [] });
  });
  it('survives a fetch that throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    expect(await discoverSitemapUrls('https://a.com', fetchImpl as any)).toEqual({ sitemap_found: false, urls: [] });
  });
});
