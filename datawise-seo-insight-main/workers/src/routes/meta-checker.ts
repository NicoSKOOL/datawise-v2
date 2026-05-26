import type { Env } from '../index';
import { safeFetch, UnsafeUrlError } from '../lib/safe-fetch';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_URLS = 100;
const FETCH_TIMEOUT_MS = 10_000;
const CONCURRENCY = 10;

export interface MetaCheckRow {
  url: string;
  status_code: number | null;
  title: string | null;
  title_length: number | null;
  description: string | null;
  description_length: number | null;
  error: string | null;
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!m) return null;
  return decodeHtml(m[1].replace(/\s+/g, ' ').trim()) || null;
}

function extractMetaDescription(html: string): string | null {
  // Match <meta ...> where name|property="description" (any order of attrs).
  // Case-insensitive, single or double quoted.
  const tagRegex = /<meta\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tag = tagMatch[0];
    const nameMatch = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i);
    if (!nameMatch) continue;
    if (nameMatch[1].toLowerCase() !== 'description') continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([\s\S]*?)["']/i);
    if (!contentMatch) continue;
    const value = decodeHtml(contentMatch[1].replace(/\s+/g, ' ').trim());
    if (value) return value;
  }
  return null;
}

function extractH1(html: string): string | null {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  if (!m) return null;
  return decodeHtml(stripTags(m[1]).replace(/\s+/g, ' ').trim()) || null;
}

function extractH2s(html: string, max = 6): string[] {
  const out: string[] = [];
  const regex = /<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const text = decodeHtml(stripTags(m[1]).replace(/\s+/g, ' ').trim());
    if (text) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function extractMetaKeywords(html: string): string | null {
  const tagRegex = /<meta\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tag = tagMatch[0];
    const nameMatch = tag.match(/\bname\s*=\s*["']([^"']+)["']/i);
    if (!nameMatch || nameMatch[1].toLowerCase() !== 'keywords') continue;
    const contentMatch = tag.match(/\bcontent\s*=\s*["']([\s\S]*?)["']/i);
    if (!contentMatch) continue;
    const value = decodeHtml(contentMatch[1].replace(/\s+/g, ' ').trim());
    if (value) return value;
  }
  return null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ');
}

function extractBodyExcerpt(html: string, maxChars = 800): string {
  // Prefer <main> or <article> if present, otherwise <body>.
  const mainMatch =
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main\s*>/i) ||
    html.match(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/i);
  let region = mainMatch ? mainMatch[1] : (html.match(/<body\b[^>]*>([\s\S]*)/i)?.[1] ?? html);
  // Drop noisy elements that pollute the excerpt.
  region = region
    .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav\s*>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header\s*>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer\s*>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside\s*>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form\s*>/gi, ' ');
  const text = decodeHtml(stripTags(region).replace(/\s+/g, ' ').trim());
  return text.slice(0, maxChars);
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      const code = parseInt(n, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

async function checkOne(url: string): Promise<MetaCheckRow> {
  const row: MetaCheckRow = {
    url,
    status_code: null,
    title: null,
    title_length: null,
    description: null,
    description_length: null,
    error: null,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await safeFetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    row.status_code = resp.status;
    if (!resp.ok) {
      row.error = `HTTP ${resp.status}`;
      return row;
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      row.error = `Not HTML (${contentType.split(';')[0] || 'unknown'})`;
      return row;
    }
    // Cap read at ~512KB — the <head> is always near the top.
    const reader = resp.body?.getReader();
    if (!reader) {
      row.error = 'No response body';
      return row;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const MAX_BYTES = 512 * 1024;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.length;
    }
    const html = new TextDecoder('utf-8').decode(buf);
    // Only scan up to the end of <head> if we can find it.
    const headEnd = html.search(/<\/head\s*>/i);
    const scanRegion = headEnd > 0 ? html.slice(0, headEnd + 7) : html;

    const title = extractTitle(scanRegion);
    const desc = extractMetaDescription(scanRegion);
    row.title = title;
    row.title_length = title ? [...title].length : 0;
    row.description = desc;
    row.description_length = desc ? [...desc].length : 0;
    return row;
  } catch (err: unknown) {
    if (err instanceof UnsafeUrlError) {
      row.error = 'Blocked URL';
      return row;
    }
    if (err instanceof Error && err.name === 'AbortError') {
      row.error = 'Timeout';
      return row;
    }
    row.error = err instanceof Error ? err.message.slice(0, 120) : 'Fetch failed';
    return row;
  } finally {
    clearTimeout(timer);
  }
}

export interface PageContextFetch {
  ok: boolean;
  status_code: number | null;
  error: string | null;
  title: string | null;
  description: string | null;
  h1: string | null;
  h2s: string[];
  body_excerpt: string;
  keywords: string | null;
}

// Single HTTP fetch that pulls everything the meta-rewrite endpoint needs.
// Reuses the same safe-fetch + read-cap behavior as checkOne, plus h1/h2/body.
export async function fetchPageContext(url: string): Promise<PageContextFetch> {
  const out: PageContextFetch = {
    ok: false,
    status_code: null,
    error: null,
    title: null,
    description: null,
    h1: null,
    h2s: [],
    body_excerpt: '',
    keywords: null,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await safeFetch(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: controller.signal,
    });
    out.status_code = resp.status;
    if (!resp.ok) {
      out.error = `HTTP ${resp.status}`;
      return out;
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      out.error = `Not HTML (${contentType.split(';')[0] || 'unknown'})`;
      return out;
    }
    const reader = resp.body?.getReader();
    if (!reader) {
      out.error = 'No response body';
      return out;
    }
    // Larger cap than checkOne (1MB) so we get enough <body> for an excerpt.
    const MAX_BYTES = 1024 * 1024;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.length; }
    const html = new TextDecoder('utf-8').decode(buf);

    const headEnd = html.search(/<\/head\s*>/i);
    const headRegion = headEnd > 0 ? html.slice(0, headEnd + 7) : html;

    out.title = extractTitle(headRegion);
    out.description = extractMetaDescription(headRegion);
    out.keywords = extractMetaKeywords(headRegion);
    out.h1 = extractH1(html);
    out.h2s = extractH2s(html);
    out.body_excerpt = extractBodyExcerpt(html);
    out.ok = true;
    return out;
  } catch (err: unknown) {
    if (err instanceof UnsafeUrlError) { out.error = 'Blocked URL'; return out; }
    if (err instanceof Error && err.name === 'AbortError') { out.error = 'Timeout'; return out; }
    out.error = err instanceof Error ? err.message.slice(0, 120) : 'Fetch failed';
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= tasks.length) break;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

// Recursively parse a sitemap URL. Returns unique URLs found (<loc> entries
// from sitemap files), resolving sitemap indexes up to one level deep.
async function fetchAndParseSitemap(
  sitemapUrl: string,
  depth = 0,
  seen = new Set<string>()
): Promise<string[]> {
  if (depth > 2) return [];
  if (seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);

  let resp: Response;
  try {
    resp = await safeFetch(sitemapUrl, {
      headers: { 'User-Agent': UA, Accept: 'application/xml,text/xml,*/*' },
      redirect: 'follow',
    });
  } catch {
    return [];
  }
  if (!resp.ok) return [];
  const xml = await resp.text();

  const urls: string[] = [];
  const isIndex = /<sitemapindex/i.test(xml);
  if (isIndex) {
    const childRegex = /<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi;
    const childUrls: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = childRegex.exec(xml)) !== null) {
      childUrls.push(m[1].trim());
      if (childUrls.length >= 20) break;
    }
    for (const c of childUrls) {
      const nested = await fetchAndParseSitemap(c, depth + 1, seen);
      urls.push(...nested);
      if (urls.length >= 500) break;
    }
  } else {
    const locRegex = /<loc>([\s\S]*?)<\/loc>/gi;
    let m: RegExpExecArray | null;
    while ((m = locRegex.exec(xml)) !== null) {
      const u = m[1].trim();
      if (u) urls.push(u);
      if (urls.length >= 500) break;
    }
  }

  // Dedupe while preserving order
  const deduped: string[] = [];
  const dseen = new Set<string>();
  for (const u of urls) {
    if (dseen.has(u)) continue;
    dseen.add(u);
    deduped.push(u);
  }
  return deduped;
}

export async function handleFetchSitemap(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { url?: unknown };
  if (typeof body.url !== 'string' || !body.url.trim()) {
    return json({ error: 'url required' }, 400);
  }
  const normalized = normalizeUrl(body.url);
  if (!normalized) return json({ error: 'invalid url' }, 400);
  const urls = await fetchAndParseSitemap(normalized);
  return json({ pages: urls.map((u) => ({ url: u })) });
}

export async function handleMetaCheck(
  request: Request,
  _env: Env
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    urls?: unknown;
  };
  if (!Array.isArray(body.urls)) {
    return json({ error: 'urls must be an array' }, 400);
  }
  const raw = body.urls.filter((u): u is string => typeof u === 'string');
  if (raw.length === 0) {
    return json({ error: 'urls is empty' }, 400);
  }
  // Normalize + dedupe + cap.
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const r of raw) {
    const n = normalizeUrl(r);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    normalized.push(n);
    if (normalized.length >= MAX_URLS) break;
  }
  if (normalized.length === 0) {
    return json({ error: 'No valid URLs after normalization' }, 400);
  }

  const rows = await runWithConcurrency(
    normalized.map((u) => () => checkOne(u)),
    CONCURRENCY
  );

  return json({ rows, count: rows.length, truncated_at: MAX_URLS });
}
