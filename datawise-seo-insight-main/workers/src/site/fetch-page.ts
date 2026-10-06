// Direct Worker fetch first (free). DataForSEO content_parsing when the site
// refuses us or serves a bot challenge. Facts are cached per URL for a day.
import { dataforseoRequestCached, DataForSeoQuotaError, type DataForSeoEnv } from '../dataforseo/client';
import { detectBotChallenge } from '../blueprint/domain/bot-challenge';
import { assertPublicWebTarget } from '../blueprint/domain/url';
import { extractPageFacts, extractPhones, extractAddresses, extractHoursLines, type PageFacts } from './extract';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 DataWiseBot/1.0 (+https://datawiseseo.com)';
const CONTENT_PARSING_TTL = 86400;

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function failed(url: string, statusCode: number | null, source: 'direct' | 'dataforseo', blocked: boolean): PageFacts {
  return {
    url, status_code: statusCode, source, blocked, fetch_failed: true, fetched_at: new Date().toISOString(),
    title: null, meta_description: null, canonical: null, headings: { h1: [], h2: [], h3: [] }, phones: [], addresses: [], hours_text: [],
    schema: [], nav_links: [], service_terms: [], word_count: 0, body_text: null,
  };
}

// A failed-fetch placeholder for a URL that was never fetched at all, for
// example one skipped because datawise_site_pages ran past its wall-clock
// deadline. Not blocked: a bot wall was never encountered, the URL simply
// wasn't tried.
export function failedPageFacts(url: string): PageFacts {
  return failed(url, null, 'direct', false);
}

async function fetchDirect(url: string, fetchImpl: typeof fetch, timeoutMs: number, bodyChars: number): Promise<{ facts: PageFacts | null; retryWithDfs: boolean }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'accept-language': 'en' } });
    const type = r.headers.get('content-type') ?? '';
    if (r.ok && type && !/html|xml|text\/plain/i.test(type)) return { facts: failed(url, r.status, 'direct', false), retryWithDfs: false };
    const html = await r.text();
    if (r.status === 403 || r.status === 429 || r.status >= 500) return { facts: null, retryWithDfs: true };
    if (!r.ok) return { facts: failed(url, r.status, 'direct', false), retryWithDfs: false };
    const facts = extractPageFacts(html, url, r.status, { bodyChars });
    if (facts.blocked) return { facts: null, retryWithDfs: true };
    return { facts, retryWithDfs: false };
  } catch {
    return { facts: null, retryWithDfs: true };
  } finally { clearTimeout(t); }
}

function fromContentParsing(url: string, item: any, bodyChars: number): PageFacts {
  const pc = item?.page_content ?? {};
  const topics: any[] = [...(Array.isArray(pc.main_topic) ? pc.main_topic : []), ...(Array.isArray(pc.secondary_topic) ? pc.secondary_topic : [])];
  const headings = { h1: [] as string[], h2: [] as string[], h3: [] as string[] };
  const blocks: string[] = [];
  const texts = (s: any) => (Array.isArray(s?.primary_content) ? s.primary_content : []).map((n: any) => (typeof n?.text === 'string' ? n.text.trim() : '')).filter(Boolean);
  blocks.push(...texts(pc.header));
  for (const t of topics) {
    const title = typeof t?.h_title === 'string' ? t.h_title.trim() : '';
    const level = typeof t?.level === 'number' ? t.level : 1;
    if (title) { if (level <= 1) headings.h1.push(title); else if (level === 2) headings.h2.push(title); else headings.h3.push(title); blocks.push(title); }
    blocks.push(...texts(t));
  }
  blocks.push(...texts(pc.footer));
  const text = blocks.join('\n');
  const flat = text.replace(/\s+/g, ' ').trim();
  const statusCode = typeof item?.status_code === 'number' ? item.status_code : null;
  const blocked = detectBotChallenge({ statusCode, textSample: flat.slice(0, 2000), headingCount: headings.h1.length + headings.h2.length + headings.h3.length, contentChars: flat.length });
  const terms = [...headings.h1, ...headings.h2, ...headings.h3].filter((v, i, a) => a.indexOf(v) === i);
  return {
    url, status_code: statusCode, source: 'dataforseo', blocked, fetch_failed: false, fetched_at: new Date().toISOString(),
    title: headings.h1[0] ?? null, meta_description: null, canonical: null, headings,
    phones: extractPhones(flat), addresses: extractAddresses(flat), hours_text: extractHoursLines(text),
    schema: [], nav_links: [], service_terms: terms.slice(0, 80), word_count: flat ? flat.split(/\s+/).length : 0,
    body_text: blocked ? null : flat.slice(0, bodyChars),
  };
}

export async function fetchSitePage(env: DataForSeoEnv, url: string, opts: { bodyChars: number; fetchImpl?: typeof fetch; timeoutMs?: number; kvTtlSeconds?: number }): Promise<PageFacts> {
  try {
    assertPublicWebTarget(url);
  } catch {
    return failed(url, null, 'direct', false);
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const cacheKey = `site-page:v1:${url}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      const facts = JSON.parse(cached) as PageFacts;
      if (facts && typeof facts.url === 'string') {
        return { ...facts, body_text: facts.body_text ? facts.body_text.slice(0, opts.bodyChars) : facts.body_text };
      }
    } catch { /* bad cache entry, fall through to a direct fetch and overwrite it */ }
  }

  const direct = await fetchDirect(url, fetchImpl, timeoutMs, Math.max(opts.bodyChars, 8000));
  let facts = direct.facts;
  if (!facts && direct.retryWithDfs) {
    try {
      const data = await dataforseoRequestCached(env, '/on_page/content_parsing/live', [{ url, enable_javascript: true }], { ttlSeconds: CONTENT_PARSING_TTL, timeoutMs });
      const item = data?.tasks?.[0]?.result?.[0]?.items?.[0];
      // Not blocked here: a DataForSEO error or empty item is a fetch failure,
      // not evidence of a bot wall (detectBotChallenge already covers that).
      facts = item ? fromContentParsing(url, item, Math.max(opts.bodyChars, 8000)) : failed(url, null, 'dataforseo', false);
    } catch (err) {
      if (err instanceof DataForSeoQuotaError) throw err;
      facts = failed(url, null, 'dataforseo', false);
    }
  }
  if (!facts) facts = failed(url, null, 'direct', false);

  if (!facts.fetch_failed && !facts.blocked) {
    await env.KV.put(cacheKey, JSON.stringify(facts), { expirationTtl: opts.kvTtlSeconds ?? 86400 });
  }
  return { ...facts, body_text: facts.body_text ? facts.body_text.slice(0, opts.bodyChars) : facts.body_text };
}
