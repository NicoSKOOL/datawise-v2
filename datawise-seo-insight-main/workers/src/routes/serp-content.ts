import type { Env } from '../index';
import { dataforseoRequestCached, getTaskError } from '../dataforseo/client';
import { keywordTokens, titleMatch, type MatchLevel } from './serp-analysis';

// Related-terms ("LSI") checker for SERP Analysis. Reads the main content of
// each ranking page (DataForSEO content_parsing), finds the phrases most of
// the top pages share, and scores every page (plus, optionally, the user's
// own page) on how many of those phrases it covers. Shared vocabulary across
// the pages Google already rewards is a practical proxy for topical coverage.

const CONTENT_TTL_SECONDS = 604800;
const MAX_URLS = 10;
const MAX_TERMS = 25;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const STOPWORDS = new Set(`a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further get got had has have having he her here hers him his how i if in into is it its itself just let me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours us via per etc one two three
 click read learn call today contact home page menu skip content copyright rights reserved privacy policy terms cookies cookie website site email phone`.split(/\s+/).filter(Boolean));

// Generic words that show up on almost any business page. Fine inside a
// phrase ("free quote"), useless as a standalone term.
const GENERIC_UNIGRAMS = new Set(`free high low best great good new make made need needs want like well work works working done ensure ensures whether every always never many much even back first last next year years time times day days way ways help helps team quality professional professionals service services company business customer customers client clients experience experienced expert experts job jobs look looking find range provide provides providing offer offers offering including include includes using used use available area areas local call quote quotes today friendly reliable affordable fast easy high-quality results result right best top trusted satisfaction guarantee guaranteed book booking online contact info information details question questions answer answers review reviews rated rating stars star enquiry enquire`.split(/\s+/).filter(Boolean));

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface ParsedPage {
  url: string;
  status: 'ok' | 'empty' | 'error';
  text: string;
  h1: string | null;
  headings: number;
}

// Pull readable text out of a content_parsing item, skipping header/footer
// chrome (menus, cookie banners) that would pollute the shared-phrase list.
export function parsePageContent(url: string, item: any): ParsedPage {
  const pc = item?.page_content;
  if (!pc) return { url, status: 'empty', text: '', h1: null, headings: 0 };
  const parts: string[] = [];
  let h1: string | null = null;
  let headings = 0;
  for (const topic of [...(pc.main_topic ?? []), ...(pc.secondary_topic ?? [])]) {
    if (topic?.h_title) {
      headings += 1;
      parts.push(topic.h_title);
      if (topic.level === 1 && !h1) h1 = topic.h_title;
    }
    for (const block of [...(topic?.primary_content ?? []), ...(topic?.secondary_content ?? [])]) {
      if (typeof block?.text === 'string') parts.push(block.text);
    }
  }
  const text = parts.join('\n');
  return { url, status: text.trim() ? 'ok' : 'empty', text, h1, headings };
}

function phrasesOf(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const gram = tokens.slice(i, i + n);
      if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[n - 1])) continue;
      if (gram.some((t) => /^\d+$/.test(t) || t.length < 2)) continue;
      if (n === 1 && (gram[0].length < 4 || GENERIC_UNIGRAMS.has(gram[0]))) continue;
      out.add(gram.join(' '));
    }
  }
  return out;
}

function tokenize(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean);
}

export interface SharedTerm {
  term: string;
  pages: number; // how many ranking pages use it
}

function singular(term: string): string {
  return term.split(' ').map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}

export function extractSharedTerms(keyword: string, pages: ParsedPage[]): SharedTerm[] {
  const ok = pages.filter((p) => p.status === 'ok');
  if (ok.length < 2) return [];
  const seedTokens = new Set(keywordTokens(keyword));
  const seedPhrase = normalize(keyword);
  const df = new Map<string, number>();
  for (const page of ok) {
    for (const phrase of phrasesOf(tokenize(page.text))) df.set(phrase, (df.get(phrase) ?? 0) + 1);
  }
  const minPages = Math.max(2, Math.ceil(ok.length * 0.3));
  const candidates = [...df.entries()]
    .filter(([term, count]) => {
      if (count < minPages) return false;
      if (term === seedPhrase) return false;
      // The keyword's own words are covered by the title/H1 checks already.
      return !term.split(' ').every((t) => seedTokens.has(t));
    })
    // Multi-word phrases carry the topic ("soft washing", "roof cleaning");
    // weight them so they outrank lone words used by the same share of pages.
    .map(([term, count]) => ({ term, pages: count, score: count * 10 + (term.split(' ').length - 1) * 12 }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

  // Drop a phrase when a longer selected phrase contains it and is used by
  // just as many pages ("soft" is noise next to "soft washing").
  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.length >= MAX_TERMS) break;
    const redundant = picked.some((p) => (p.pages >= c.pages && (` ${p.term} `.includes(` ${c.term} `) || ` ${c.term} `.includes(` ${p.term} `)))
      || singular(p.term) === singular(c.term));
    if (!redundant) picked.push(c);
  }
  return picked.map(({ term, pages: count }) => ({ term, pages: count }));
}

export interface PageContentReport {
  url: string;
  status: 'ok' | 'empty' | 'error';
  wordCount: number;
  h1: string | null;
  h1Match: MatchLevel;
  headings: number;
  keywordMentions: number;
  termsFound: string[];
  termsMissing: string[];
  coverage: number; // 0-1 share of shared terms present
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export function scorePage(keyword: string, page: ParsedPage, terms: SharedTerm[]): PageContentReport {
  const norm = ` ${tokenize(page.text).join(' ')} `;
  const found: string[] = [];
  const missing: string[] = [];
  for (const { term } of terms) (norm.includes(` ${term} `) ? found : missing).push(term);
  return {
    url: page.url,
    status: page.status,
    wordCount: page.status === 'ok' ? norm.trim().split(' ').filter(Boolean).length : 0,
    h1: page.h1,
    h1Match: page.h1 ? titleMatch(page.h1, keyword) : 'none',
    headings: page.headings,
    keywordMentions: countOccurrences(norm, ` ${normalize(keyword)} `),
    termsFound: found,
    termsMissing: missing,
    coverage: terms.length > 0 ? found.length / terms.length : 0,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

async function fetchPage(env: Env, url: string): Promise<ParsedPage> {
  try {
    // Plain HTML first (10x cheaper); fall back to a JS render for pages that
    // build their content client-side and come back empty.
    const plain = await dataforseoRequestCached(env, '/on_page/content_parsing/live', [{ url }], { ttlSeconds: CONTENT_TTL_SECONDS, timeoutMs: 20000 });
    if (!getTaskError(plain)) {
      const parsed = parsePageContent(url, plain?.tasks?.[0]?.result?.[0]?.items?.[0]);
      if (parsed.status === 'ok') return parsed;
    }
    const rendered = await dataforseoRequestCached(env, '/on_page/content_parsing/live', [{ url, enable_javascript: true }], { ttlSeconds: CONTENT_TTL_SECONDS, timeoutMs: 30000 });
    if (getTaskError(rendered)) return { url, status: 'error', text: '', h1: null, headings: 0 };
    return parsePageContent(url, rendered?.tasks?.[0]?.result?.[0]?.items?.[0]);
  } catch (e) {
    console.error('serp-content fetch failed:', url, e);
    return { url, status: 'error', text: '', h1: null, headings: 0 };
  }
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// POST /api/keywords/serp-content
// Body: { keyword, urls: string[] (ranking pages, max 10), my_url?: string }
export async function handleSerpContent(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as any;
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  if (!keyword) return json({ error: 'Keyword is required' }, 400);
  const urls: string[] = Array.isArray(body?.urls) ? [...new Set((body.urls as unknown[]).filter(isHttpUrl))].slice(0, MAX_URLS) : [];
  if (urls.length === 0) return json({ error: 'urls must include at least one http(s) URL' }, 400);
  const myUrl = isHttpUrl(body?.my_url) ? body.my_url : null;
  if (body?.my_url && !myUrl) return json({ error: 'Your page URL must start with http:// or https://' }, 400);

  const [pages, mine] = await Promise.all([
    Promise.all(urls.map((u) => fetchPage(env, u))),
    myUrl ? fetchPage(env, myUrl) : Promise.resolve(null),
  ]);

  const terms = extractSharedTerms(keyword, pages);
  const reports = pages.map((p) => scorePage(keyword, p, terms));
  const okReports = reports.filter((r) => r.status === 'ok');

  return json({
    keyword,
    terms,
    pages: reports,
    my_page: mine ? scorePage(keyword, mine, terms) : null,
    summary: {
      pagesRead: okReports.length,
      medianWordCount: median(okReports.map((r) => r.wordCount)),
      medianCoverage: okReports.length ? median(okReports.map((r) => Math.round(r.coverage * 100))) / 100 : 0,
      medianKeywordMentions: median(okReports.map((r) => r.keywordMentions)),
    },
  });
}
