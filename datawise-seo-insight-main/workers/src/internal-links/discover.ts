// Find a site's page URLs from its sitemap: robots.txt Sitemap: lines first,
// then the usual locations, following sitemap indexes up to 3 levels deep
// (same order as run.py find_sitemap + crawl.py sitemap_urls).

import { BROWSER_UA, safeFetch } from '../lib/safe-fetch';
import { detectBotChallenge } from '../routes/content-tools';

const MAX_CHILD_SITEMAPS = 40;
// A run uses at most a few hundred pages, so stop reading child sitemaps
// once this many URLs are in hand: big WordPress sites list 20+ child
// sitemaps and reading them all took over a minute (yoast.com, 2026-10-02).
const MAX_URLS = 1500;
// Sitemap entries that are files, not pages.
const NON_PAGE = /\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|mp4|mp3|xml|txt|css|js|ico|docx?|xlsx?|pptx?)$/i;

export interface SitemapDiscovery {
  siteUrl: string;
  sitemapUrl: string | null;
  urls: string[];
  blocked: boolean;
  // HTTP status the site refused us with (401/403/429), when that was the block.
  blockedStatus: number | null;
}

// Statuses a firewall answers with when it refuses the crawler outright.
// Some hosts block every request from cloud IPs, Cloudflare Workers included,
// with a plain 403 page that no challenge signal matches
// (ethicaldogtraining.com.au, 2026-10-05).
export function isBlockStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

export function normalizeSiteUrl(raw: string): string {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  return `${u.protocol}//${u.host}`;
}

async function fetchText(url: string): Promise<{ status: number; text: string | null }> {
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'application/xml,text/xml,text/plain,*/*' },
      timeoutMs: 20_000,
      maxBytes: 20 * 1024 * 1024,
    });
    if (!res.ok) return { status: res.status, text: null };
    return { status: res.status, text: await res.text() };
  } catch {
    return { status: 0, text: null };
  }
}

export function locs(xml: string): string[] {
  // Page <loc> only: WordPress sitemaps also list <image:loc> / <video:loc>.
  return [...xml.matchAll(/<(?!image:|video:)(?:\w+:)?loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/(?:\w+:)?loc>/g)].map((m) =>
    m[1].trim().replace(/&amp;/g, '&')
  );
}

export async function discoverSitemap(rawSite: string): Promise<SitemapDiscovery> {
  const siteUrl = normalizeSiteUrl(rawSite);
  let blocked = false;
  let blockedStatus: number | null = null;
  const candidates: string[] = [];
  const get = async (url: string): Promise<string | null> => {
    const { status, text } = await fetchText(url);
    if (isBlockStatus(status)) {
      blocked = true;
      blockedStatus ??= status;
    }
    return text;
  };

  const robots = await get(`${siteUrl}/robots.txt`);
  if (robots) {
    if (detectBotChallenge(robots)) blocked = true;
    for (const line of robots.split('\n')) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (m) candidates.push(m[1]);
    }
  }
  candidates.push(`${siteUrl}/sitemap.xml`, `${siteUrl}/sitemap-index.xml`, `${siteUrl}/sitemap_index.xml`, `${siteUrl}/wp-sitemap.xml`);

  for (const sitemapUrl of [...new Set(candidates)]) {
    const xml = await get(sitemapUrl);
    if (!xml) continue;
    if (detectBotChallenge(xml)) {
      blocked = true;
      continue;
    }
    if (!/<(?:\w+:)?(urlset|sitemapindex)/.test(xml)) continue;

    const urls: string[] = [];
    let childBudget = MAX_CHILD_SITEMAPS;
    const walk = async (doc: string, depth: number): Promise<void> => {
      const found = locs(doc);
      if (/<(?:\w+:)?sitemapindex/.test(doc)) {
        if (depth >= 3) return;
        for (const child of found) {
          if (childBudget-- <= 0 || urls.length >= MAX_URLS) return;
          const childXml = await get(child);
          if (childXml) await walk(childXml, depth + 1);
        }
        return;
      }
      urls.push(...found);
    };
    await walk(xml, 0);

    const host = new URL(siteUrl).host.replace(/^www\./, '');
    const pages = [...new Set(urls)].filter((u) => {
      try {
        const parsed = new URL(u);
        return parsed.host.replace(/^www\./, '') === host && !NON_PAGE.test(parsed.pathname);
      } catch {
        return false;
      }
    });
    if (pages.length) return { siteUrl, sitemapUrl, urls: pages.slice(0, MAX_URLS), blocked, blockedStatus };
  }
  return { siteUrl, sitemapUrl: null, urls: [], blocked, blockedStatus };
}
