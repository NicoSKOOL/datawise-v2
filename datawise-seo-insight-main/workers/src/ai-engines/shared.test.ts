import { describe, it, expect } from 'vitest';
import { normalizeDomain, domainsMatch, dedupeSources, stripMarkdown, toSource } from './shared';

describe('normalizeDomain', () => {
  it('strips scheme, www and path', () => {
    expect(normalizeDomain('https://www.Example.com/path?x=1')).toBe('example.com');
    expect(normalizeDomain('www.example.com')).toBe('example.com');
    expect(normalizeDomain('sc-domain:example.com')).toBe('example.com');
  });
  it('returns null for empty input', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe('domainsMatch', () => {
  it('matches equal domains and subdomains either way', () => {
    expect(domainsMatch('blog.example.com', 'example.com')).toBe(true);
    expect(domainsMatch('example.com', 'blog.example.com')).toBe(true);
    expect(domainsMatch('example.co', 'example.com')).toBe(false);
  });
});

describe('toSource', () => {
  it('builds a source from url and falls back to the domain field', () => {
    expect(toSource({ url: 'https://www.a.com/x', title: 'A' }, 1)).toEqual({ url: 'https://www.a.com/x', domain: 'a.com', title: 'A', position: 1 });
    expect(toSource({ domain: 'www.b.com' }, 2)).toEqual({ url: null, domain: 'b.com', title: null, position: 2 });
    expect(toSource({ title: 'no location' }, 3)).toBeNull();
  });
});

describe('dedupeSources', () => {
  it('dedupes by url, then by domain when there is no url, and renumbers positions', () => {
    const out = dedupeSources([
      { url: 'https://a.com/1', domain: 'a.com', title: null, position: 9 },
      { url: 'https://a.com/1', domain: 'a.com', title: 'dup', position: 9 },
      { url: null, domain: 'b.com', title: null, position: 9 },
      { url: null, domain: 'b.com', title: null, position: 9 },
    ]);
    expect(out.map((s) => [s.url, s.domain, s.position])).toEqual([['https://a.com/1', 'a.com', 1], [null, 'b.com', 2]]);
  });
});

describe('stripMarkdown', () => {
  it('removes links, emphasis, headings and table pipes but keeps the words', () => {
    expect(stripMarkdown('## Best **CRM** [HubSpot](https://hubspot.com) | col')).toBe('Best CRM HubSpot col');
  });
});
