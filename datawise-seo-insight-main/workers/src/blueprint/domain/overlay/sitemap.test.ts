import { describe, it, expect } from 'vitest';
import { parseRobotsTxt, parseSitemapXml, selectTitleFetchCandidates } from './sitemap';
import type { PlannedPage } from '../page-plan/types';

function plannedPage(over: Partial<PlannedPage> & { logicalId: string; slug: string }): PlannedPage {
  return {
    logicalId: over.logicalId,
    pageType: over.pageType ?? 'service',
    slug: over.slug,
    title: over.title ?? '',
    h1: over.h1 ?? '',
    parentLogicalId: over.parentLogicalId ?? null,
    primaryKeywordId: over.primaryKeywordId ?? null,
    primaryKeyword: over.primaryKeyword ?? null,
    clusterIds: over.clusterIds ?? [],
    sections: over.sections ?? [],
    metaDescription: over.metaDescription ?? null,
    recommendation: over.recommendation ?? 'create',
    consolidateTargetLogicalId: over.consolidateTargetLogicalId ?? null,
    scores: over.scores ?? { addressableVolume: null, confidence: null, scoreBreakdown: null, evidenceRefs: [] },
    warnings: over.warnings ?? [],
  };
}

describe('parseRobotsTxt', () => {
  it('extracts absolute Sitemap directives, deduped', () => {
    const body = [
      'User-agent: *',
      'Disallow: /admin',
      'Sitemap: https://example.com/sitemap.xml',
      'sitemap:   https://example.com/news.xml',
      'Sitemap: https://example.com/sitemap.xml',
    ].join('\n');
    expect(parseRobotsTxt(body)).toEqual(['https://example.com/sitemap.xml', 'https://example.com/news.xml']);
  });

  it('drops relative and non-http Sitemap values', () => {
    const body = 'Sitemap: /sitemap.xml\nSitemap: ftp://example.com/s.xml\nSitemap: https://example.com/ok.xml';
    expect(parseRobotsTxt(body)).toEqual(['https://example.com/ok.xml']);
  });

  it('caps the number of sitemaps at 10', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `Sitemap: https://example.com/s${i}.xml`);
    expect(parseRobotsTxt(lines.join('\n'))).toHaveLength(10);
  });
});

describe('parseSitemapXml', () => {
  it('parses a urlset, stripping fragments, deduping and sorting', () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://example.com/b</loc></url>
        <url><loc>https://example.com/a#frag</loc></url>
        <url><loc>https://example.com/a</loc></url>
      </urlset>`;
    const out = parseSitemapXml(xml, 500);
    expect(out.urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(out.childSitemaps).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it('parses a sitemapindex into childSitemaps', () => {
    const xml = `<sitemapindex>
      <sitemap><loc>https://example.com/s2.xml</loc></sitemap>
      <sitemap><loc>https://example.com/s1.xml</loc></sitemap>
    </sitemapindex>`;
    const out = parseSitemapXml(xml, 500);
    expect(out.childSitemaps).toEqual(['https://example.com/s1.xml', 'https://example.com/s2.xml']);
    expect(out.urls).toEqual([]);
  });

  it('tolerates malformed XML and still recovers locs', () => {
    const xml = '<urlset><url><loc>https://example.com/x</loc><url><loc>https://example.com/y</loc></urlset>';
    const out = parseSitemapXml(xml, 500);
    expect(out.urls).toEqual(['https://example.com/x', 'https://example.com/y']);
  });

  it('decodes XML entities in loc values', () => {
    const xml = '<urlset><url><loc>https://example.com/a?x=1&amp;y=2</loc></url></urlset>';
    const out = parseSitemapXml(xml, 500);
    expect(out.urls).toEqual(['https://example.com/a?x=1&y=2']);
  });

  it('caps urls at maxUrls and sets truncated', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`).join('');
    const out = parseSitemapXml(`<urlset>${urls}</urlset>`, 5);
    expect(out.urls).toHaveLength(5);
    expect(out.truncated).toBe(true);
  });

  it('caps childSitemaps at 50 and sets truncated', () => {
    const children = Array.from(
      { length: 60 },
      (_, i) => `<sitemap><loc>https://example.com/s${String(i).padStart(3, '0')}.xml</loc></sitemap>`
    ).join('');
    const out = parseSitemapXml(`<sitemapindex>${children}</sitemapindex>`, 500);
    expect(out.childSitemaps).toHaveLength(50);
    expect(out.truncated).toBe(true);
  });

  it('falls back to urls for a wrapperless malformed body with no sitemapindex root', () => {
    const xml = '<loc>https://example.com/x</loc>';
    const out = parseSitemapXml(xml, 500);
    expect(out.urls).toEqual(['https://example.com/x']);
    expect(out.childSitemaps).toEqual([]);
  });
});

describe('selectTitleFetchCandidates', () => {
  const planned = [
    plannedPage({ logicalId: 'p1', slug: '/emergency-plumbing/', primaryKeyword: 'emergency plumber' }),
    plannedPage({ logicalId: 'p2', slug: '/drain-cleaning/', primaryKeyword: 'drain cleaning' }),
  ];

  it('prioritizes URLs whose path tokens overlap planned slugs/keywords', () => {
    const urls = [
      'https://example.com/about',
      'https://example.com/emergency-plumbing-services',
      'https://example.com/contact',
    ];
    const picked = selectTitleFetchCandidates(urls, planned, 1);
    expect(picked).toEqual(['https://example.com/emergency-plumbing-services']);
  });

  it('caps at the requested count and is deterministic regardless of input order', () => {
    const a = ['https://example.com/drain-cleaning-help', 'https://example.com/emergency-plumbing-now', 'https://example.com/z'];
    const b = [...a].reverse();
    const pa = selectTitleFetchCandidates(a, planned, 2);
    const pb = selectTitleFetchCandidates(b, planned, 2);
    expect(pa).toEqual(pb);
    expect(pa).toHaveLength(2);
  });

  it('returns empty for a non-positive cap', () => {
    expect(selectTitleFetchCandidates(['https://example.com/x'], planned, 0)).toEqual([]);
  });
});
