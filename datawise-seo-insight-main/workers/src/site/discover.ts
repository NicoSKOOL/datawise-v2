// Finds the pages on a business website that matter for a GBP comparison:
// homepage, contact, about, services, locations. Sitemap and robots are
// fetched directly from the Worker (free). Ranking is a pure function.

import { assertPublicWebTarget } from '../blueprint/domain/url';

export interface UrlCandidate { url: string; anchor?: string | null; fromNav?: boolean }

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|txt|zip|mp4|mp3|docx?|xlsx?|pptx?)$/i;
const SKIP_PATH = /(^|\/)(wp-json|wp-admin|wp-content|wp-login|feed|tag|tags|category|categories|author|page\/\d+|cart|checkout|my-account|login|search|cdn-cgi)(\/|$)/i;
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref$)/i;

export function siteOrigin(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes('.')) return null;
    const origin = `${u.protocol}//${u.host}`;
    assertPublicWebTarget(origin); // throws on private/internal/garbage targets
    return origin;
  } catch { return null; }
}

function sameSite(hostA: string, hostB: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return strip(hostA) === strip(hostB);
}

export function normalizeSiteUrl(raw: string, host: string): string | null {
  const s = raw.trim();
  if (!s || /^(mailto|tel|javascript|sms|whatsapp):/i.test(s)) return null;
  let u: URL;
  try { u = new URL(s, `https://${host}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, host)) return null;
  if (SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) return null;
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  let out = u.toString();
  if (u.pathname !== '/' && u.pathname.endsWith('/') && !u.search) out = out.replace(/\/$/, '');
  try { assertPublicWebTarget(out); } catch { return null; }
  return out;
}

export function parseRobotsSitemaps(text: string): string[] {
  return [...text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1].trim());
}

export function parseSitemapXml(xml: string): { sitemaps: string[]; urls: string[] } {
  const locs = (block: string) => [...block.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  if (/<sitemapindex/i.test(xml)) return { sitemaps: locs(xml), urls: [] };
  return { sitemaps: [], urls: locs(xml) };
}

const CONTACT = /(^|\/|-|_)(contact|contact-us|contactus|about|about-us|aboutus|our-team|team)(\/|-|_|$)/i;
const SERVICE = /(service|services|what-we-do|treatments|repairs|repair|pricing|prices|menu|products|solutions|specialties|practice-areas)/i;
const LOCATION = /(location|locations|areas|service-area|service-areas|areas-we-serve|near-me|suburbs|cities)/i;
const BLOG = /(^|\/)(blog|news|post|posts|article|articles|resources|insights)(\/|$)|\/20\d\d\//i;

export function scoreSiteUrl(url: string, anchor: string | null, fromNav: boolean): number {
  let path = '/';
  try { path = new URL(url).pathname; } catch { /* keep '/' */ }
  const a = (anchor ?? '').toLowerCase();
  if (path === '/' || path === '') return 100;
  if (CONTACT.test(path) || /^(contact|about)( us)?$/.test(a)) return 90;
  if (LOCATION.test(path) || LOCATION.test(a)) return 70;
  if (SERVICE.test(path) || SERVICE.test(a)) return 80;
  if (BLOG.test(path)) return 5;
  if (fromNav) return 60;
  return 10;
}

export function rankSiteUrls(candidates: UrlCandidate[], opts: { host: string; explicit: string[]; max: number }): string[] {
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (const raw of opts.explicit) {
    const u = normalizeSiteUrl(raw, opts.host);
    if (u && !seen.has(u)) { seen.add(u); chosen.push(u); }
  }
  const scored = new Map<string, { score: number; order: number }>();
  candidates.forEach((c, order) => {
    const u = normalizeSiteUrl(c.url, opts.host);
    if (!u || seen.has(u)) return;
    const score = scoreSiteUrl(u, c.anchor ?? null, Boolean(c.fromNav));
    const prev = scored.get(u);
    if (!prev || score > prev.score) scored.set(u, { score, order: prev?.order ?? order });
  });
  const ranked = [...scored.entries()].sort((a, b) => b[1].score - a[1].score || a[1].order - b[1].order).map(([u]) => u);
  for (const u of ranked) { if (chosen.length >= opts.max) break; chosen.push(u); }
  return chosen.slice(0, opts.max);
}

async function fetchText(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; DataWiseBot/1.0; +https://datawiseseo.com)' }, redirect: 'follow' });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; } finally { clearTimeout(t); }
}

export async function discoverSitemapUrls(origin: string, fetchImpl: typeof fetch, opts: { maxUrls?: number; timeoutMs?: number } = {}): Promise<{ sitemap_found: boolean; urls: string[] }> {
  const maxUrls = opts.maxUrls ?? 500;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const robots = await fetchText(fetchImpl, `${origin}/robots.txt`, timeoutMs);
  const fromRobots = robots ? parseRobotsSitemaps(robots) : [];
  const queue = fromRobots.length ? fromRobots : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const urls: string[] = [];
  let found = false;
  const visited = new Set<string>();
  let followedIndex = 0;
  while (queue.length && urls.length < maxUrls) {
    const sm = queue.shift()!;
    if (visited.has(sm)) continue;
    visited.add(sm);
    const xml = await fetchText(fetchImpl, sm, timeoutMs);
    if (!xml) continue;
    const parsed = parseSitemapXml(xml);
    if (parsed.urls.length || parsed.sitemaps.length) found = true;
    for (const u of parsed.urls) { if (urls.length >= maxUrls) break; urls.push(u); }
    // One level of index only: children of an index are read, their children are not.
    if (parsed.sitemaps.length && followedIndex < 1) { followedIndex++; queue.push(...parsed.sitemaps.slice(0, 20)); }
    if (found && !fromRobots.length && parsed.urls.length) break;
  }
  return { sitemap_found: found, urls };
}
