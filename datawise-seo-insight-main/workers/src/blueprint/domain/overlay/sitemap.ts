// Pure parsers for stage 16 overlay_existing_site's site inventory discovery.
//
// These take text a caller already fetched (the fetcher lives in
// providers/site-fetch/): nothing here touches the network, a clock, or D1.
// Determinism is a hard requirement (the overlay result feeds a persisted
// inventory), so every list this module returns is deduped and, for URL lists,
// totally ordered.
//
// XML is parsed with linear regex extraction rather than a DOM/XML parser on
// purpose: sitemaps in the wild are frequently malformed (unclosed tags, stray
// bytes, BOMs, wrong namespaces), a strict parser would throw on them and lose
// the URLs we could otherwise recover, and there is no XML parser in the Workers
// runtime we would want to pull in. We only ever read <loc> text out of the
// document; we never interpret it as markup, so malformed input degrades to
// "fewer URLs found", never to an error.

import { normalizeKeyword } from '../keyword';
import { normalizeSlug } from '../slug';
import type { PlannedPage } from '../page-plan/types';

// Absolute Sitemap: directives we will trust from a robots.txt. Capped so a
// hostile or broken robots.txt cannot point us at an unbounded fan-out of
// sitemaps.
const ROBOTS_SITEMAP_CAP = 10;

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    });
}

// Normalize a discovered URL: absolute http(s) only, fragment stripped. Returns
// null for anything else so callers can drop it. new URL() also canonicalizes
// (lowercased host, default-port removal) which keeps dedupe honest.
function normalizeDiscoveredUrl(raw: string): string | null {
  const trimmed = decodeXmlEntities(raw).trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  return url.href;
}

function dedupeSorted(urls: string[]): string[] {
  return Array.from(new Set(urls)).sort();
}

// Extract absolute `Sitemap:` directives from a robots.txt body. Deduped, capped
// at ROBOTS_SITEMAP_CAP, encounter order preserved (deterministic for a given
// body). Relative directives are dropped: robots.txt Sitemap values are required
// to be absolute, and we have no reliable base here.
export function parseRobotsTxt(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    if (!m) continue;
    const normalized = normalizeDiscoveredUrl(m[1]);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= ROBOTS_SITEMAP_CAP) break;
  }
  return out;
}

export interface ParsedSitemap {
  // Page URLs (from <urlset>). Deduped, sorted, capped at maxUrls.
  urls: string[];
  // Child sitemap URLs (from <sitemapindex>). Deduped, sorted.
  childSitemaps: string[];
  // True when `urls` was cut to maxUrls.
  truncated: boolean;
}

function extractLocs(fragment: string): string[] {
  const out: string[] = [];
  const re = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment)) !== null) {
    const normalized = normalizeDiscoveredUrl(m[1]);
    if (normalized) out.push(normalized);
  }
  return out;
}

function extractBlocks(body: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.push(m[1]);
  return out;
}

// Parse a sitemap XML body, handling both <urlset> (page URLs) and
// <sitemapindex> (child sitemaps). Tolerant of malformed XML (see file header).
export function parseSitemapXml(body: string, maxUrls: number): ParsedSitemap {
  const sitemapBlocks = extractBlocks(body, 'sitemap');
  const urlBlocks = extractBlocks(body, 'url');

  let rawUrls: string[] = [];
  let rawChildren: string[] = [];

  if (urlBlocks.length > 0 || sitemapBlocks.length > 0) {
    // Well-formed enough: <loc>s live inside their <url>/<sitemap> wrappers, so
    // we can tell page URLs from child sitemaps by context.
    for (const block of urlBlocks) rawUrls.push(...extractLocs(block));
    for (const block of sitemapBlocks) rawChildren.push(...extractLocs(block));
  } else {
    // Malformed / wrapperless: fall back to the root element to decide what the
    // bare <loc>s are. A sitemapindex root means they are child sitemaps.
    const allLocs = extractLocs(body);
    if (/<sitemapindex\b/i.test(body)) {
      rawChildren = allLocs;
    } else {
      rawUrls = allLocs;
    }
  }

  const childSitemaps = dedupeSorted(rawChildren);
  const allUrls = dedupeSorted(rawUrls);
  const truncated = allUrls.length > maxUrls;
  const urls = truncated ? allUrls.slice(0, maxUrls) : allUrls;
  return { urls, childSitemaps, truncated };
}

// ---------------------------------------------------------------------------
// Title-fetch candidate selection
// ---------------------------------------------------------------------------

// Tokenize a URL's path for overlap scoring: slug-normalize (ascii-fold,
// lowercase) then split on '/' and '-'. Locale-free on purpose so a path token
// set is directly comparable to a planned page's slug/keyword tokens.
function pathTokens(rawUrl: string): Set<string> {
  let pathname: string;
  try {
    pathname = new URL(rawUrl).pathname;
  } catch {
    pathname = rawUrl;
  }
  return new Set(
    normalizeSlug(pathname)
      .split(/[/-]/)
      .filter(Boolean)
  );
}

// The union of every planned page's slug tokens and primary-keyword tokens: the
// vocabulary a candidate URL's path is scored against.
function plannedTokenSet(plannedPages: PlannedPage[]): Set<string> {
  const tokens = new Set<string>();
  for (const page of plannedPages) {
    for (const t of page.slug.split('/')) {
      for (const s of normalizeSlug(t).split(/[/-]/)) if (s) tokens.add(s);
    }
    if (page.primaryKeyword) {
      for (const t of normalizeKeyword(page.primaryKeyword, 'en').split(/\s+/)) if (t) tokens.add(t);
    }
  }
  return tokens;
}

// Choose which existing URLs deserve a (budget-limited) title fetch: prioritize
// URLs whose path tokens overlap the planned-page vocabulary, so the fetch
// budget lands on likely matches. Deterministic: sorted by overlap desc, then
// url asc; returns at most `cap` URLs.
export function selectTitleFetchCandidates(
  urls: string[],
  plannedPages: PlannedPage[],
  cap: number
): string[] {
  if (cap <= 0) return [];
  const vocab = plannedTokenSet(plannedPages);
  const scored = Array.from(new Set(urls)).map((url) => {
    let overlap = 0;
    for (const t of pathTokens(url)) if (vocab.has(t)) overlap++;
    return { url, overlap };
  });
  scored.sort((a, b) => (b.overlap - a.overlap) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return scored.slice(0, cap).map((s) => s.url);
}
