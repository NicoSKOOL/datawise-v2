import { describe, it, expect, vi, beforeEach } from 'vitest';

const dfs = { calls: [] as Array<{ path: string; payload: any }>, impl: null as null | ((path: string, payload: any) => any) };
vi.mock('../dataforseo/client', () => ({
  dataforseoRequest: async (_env: unknown, path: string, payload: any) => {
    dfs.calls.push({ path, payload });
    return dfs.impl ? dfs.impl(path, payload) : null;
  },
  dataforseoGet: async () => null,
  getTaskError: (data: any) => (data?.tasks?.[0]?.status_code === 20000 ? null : 'failed'),
}));

import { extractSharedTerms, handleSerpContent, parsePageContent, scorePage, type ParsedPage } from './serp-content';

const page = (url: string, text: string, h1: string | null = null): ParsedPage => ({ url, status: 'ok', text, h1, headings: 1 });

const pages = [
  page('https://a.test/', 'Roof cleaning and driveway cleaning. We remove mould from brick. Free quote today.', 'Pressure Washing Sydney'),
  page('https://b.test/', 'Soft washing for roof cleaning, mould removal, driveway cleaning and graffiti removal.'),
  page('https://c.test/', 'Driveway cleaning, roof cleaning, graffiti removal. Great service, free quote.'),
  page('https://d.test/', 'Window cleaning only. Call today.'),
];

describe('extractSharedTerms', () => {
  it('keeps phrases most ranking pages share and drops keyword words, generic words and one-off terms', () => {
    const terms = extractSharedTerms('pressure washing sydney', pages).map((t) => t.term);
    expect(terms).toEqual(expect.arrayContaining(['roof cleaning', 'driveway cleaning', 'graffiti removal']));
    expect(terms).not.toContain('pressure');
    expect(terms).not.toContain('free');
    expect(terms).not.toContain('window cleaning');
  });

  it('needs at least two readable pages', () => {
    expect(extractSharedTerms('x', [pages[0]])).toEqual([]);
  });
});

describe('scorePage', () => {
  it('reports found/missing terms, coverage, word count and H1 match', () => {
    const terms = extractSharedTerms('pressure washing sydney', pages);
    const r = scorePage('pressure washing sydney', pages[3], terms);
    expect(r.termsFound).not.toContain('roof cleaning');
    expect(r.termsMissing).toContain('driveway cleaning');
    expect(r.coverage).toBeLessThan(0.5);
    const a = scorePage('pressure washing sydney', pages[0], terms);
    expect(a.termsFound).toContain('roof cleaning');
    expect(a.h1Match).toBe('exact');
    expect(a.wordCount).toBeGreaterThan(5);
  });
});

describe('parsePageContent', () => {
  it('reads topics, skips header/footer, finds the H1', () => {
    const p = parsePageContent('https://x.test/', {
      page_content: {
        header: { primary_content: [{ text: 'Menu Home Contact' }] },
        main_topic: [{ h_title: 'Roof Cleaning Sydney', level: 1, primary_content: [{ text: 'We clean roofs.' }] }],
        secondary_topic: [{ h_title: 'FAQ', level: 2, secondary_content: [{ text: 'How long does it take?' }] }],
      },
    });
    expect(p.status).toBe('ok');
    expect(p.h1).toBe('Roof Cleaning Sydney');
    expect(p.headings).toBe(2);
    expect(p.text).not.toContain('Menu');
  });
  it('marks missing content as empty', () => {
    expect(parsePageContent('https://x.test/', null).status).toBe('empty');
  });
});

const makeEnv = () => {
  const store = new Map<string, { value: string; ttl?: number }>();
  return {
    store,
    KV: {
      get: async (k: string) => store.get(k)?.value ?? null,
      put: async (k: string, value: string, opts?: { expirationTtl?: number }) => { store.set(k, { value, ttl: opts?.expirationTtl }); },
    },
  } as any;
};

describe('handleSerpContent', () => {
  beforeEach(() => { dfs.calls = []; dfs.impl = null; });
  const req = (body: unknown) => new Request('https://x/api/keywords/serp-content', { method: 'POST', body: JSON.stringify(body) });
  const parsed = (text: string) => ({ tasks: [{ status_code: 20000, result: [{ items: [{ page_content: { main_topic: [{ h_title: 'T', level: 1, primary_content: [{ text }] }] } }] }] }] });
  const empty = { tasks: [{ status_code: 20000, result: [{ items: null }] }] };

  it('retries empty pages with JavaScript rendering and scores the user page', async () => {
    dfs.impl = (_p, payload) => {
      const { url, enable_javascript } = payload[0];
      if (url === 'https://js.test/' && !enable_javascript) return empty;
      return parsed('roof cleaning and driveway cleaning with mould removal');
    };
    const res = await handleSerpContent(req({ keyword: 'pressure washing', urls: ['https://a.test/', 'https://js.test/', 'ftp://bad'], my_url: 'https://mine.test/' }), makeEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pages).toHaveLength(2);
    expect(body.pages.every((p: any) => p.status === 'ok')).toBe(true);
    expect(dfs.calls.filter((c) => c.payload[0].enable_javascript)).toHaveLength(1);
    expect(body.my_page.url).toBe('https://mine.test/');
    expect(body.terms.length).toBeGreaterThan(0);
  });

  it('rejects a non-http own-page URL', async () => {
    const res = await handleSerpContent(req({ keyword: 'k', urls: ['https://a.test/'], my_url: 'javascript:alert(1)' }), makeEnv());
    expect(res.status).toBe(400);
  });

  it('caps ranking URLs at 10', async () => {
    dfs.impl = () => parsed('roof cleaning');
    const urls = Array.from({ length: 15 }, (_, i) => `https://p${i}.test/`);
    const res = await handleSerpContent(req({ keyword: 'k', urls }), makeEnv());
    const body = await res.json() as any;
    expect(body.pages).toHaveLength(10);
  });

  it('caches good reads for a week, empty reads for 6h, and serves repeats from cache', async () => {
    dfs.impl = (_p, payload) => (payload[0].url === 'https://blocked.test/' ? empty : parsed('roof cleaning'));
    const env = makeEnv();
    await handleSerpContent(req({ keyword: 'k', urls: ['https://a.test/', 'https://blocked.test/'] }), env);
    const ttls = [...env.store.values()].map((v: any) => v.ttl).sort();
    expect(ttls).toEqual([21600, 604800]);
    const before = dfs.calls.length;
    await handleSerpContent(req({ keyword: 'k', urls: ['https://a.test/', 'https://blocked.test/'] }), env);
    expect(dfs.calls.length).toBe(before);
  });
});
