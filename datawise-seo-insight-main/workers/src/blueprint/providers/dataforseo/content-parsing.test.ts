import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import type { StageContext } from '../../orchestration/handlers';
import type { DfsCostEstimates } from './costs';
import { fetchParsedPage } from './content-parsing';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const COSTS: DfsCostEstimates = {
  labsTaskUsdMicro: 50_000,
  serpTaskUsdMicro: 10_000,
  contentParsingTaskUsdMicro: 10_000,
};

// Positive-result TTL 7d, empty-result TTL 6h (mirrors the adapter's private
// constants; asserted numerically so the test fails if either constant moves).
const POSITIVE_TTL = 604_800;
const EMPTY_TTL = 21_600;

// Wraps a single content_parsing item in the standard DFS envelope
// (tasks[0].result[0].items[]). A successful task carries status_code 20000.
function contentResponse(item: any, cost = 0.01) {
  return {
    status_code: 20000,
    tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost, result: [{ items: [item] }] }],
  };
}

// A successful task whose result carries no items at all (the page could not
// be parsed): parsed.items and parsed.results are both empty, so the wrapper
// caches at the empty TTL and the adapter reports fetchFailed.
function noResultResponse(cost = 0.01) {
  return {
    status_code: 20000,
    tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost, result: [] }],
  };
}

// A genuine per-task DataForSEO failure (40501 band): the wrapper throws a
// sanitized BlueprintApiError before the adapter inspects anything.
function taskFailedResponse() {
  return {
    status_code: 40000,
    tasks: [{ id: 'task-1', status_code: 40501, status_message: 'Invalid Field.', cost: 0, result: null }],
  };
}

interface CapturedCall {
  url: string;
  body: any;
}

function stubFetchCapturing(response: any): CapturedCall[] {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    const parsedBody = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body: Array.isArray(parsedBody) ? parsedBody[0] : parsedBody });
    return { ok: true, status: 200, json: async () => response } as any;
  }) as any;
  return calls;
}

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, 'org1', 'user1', 'Test Project', 'existing_site', 'US', 'en', nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, 'brief1', 'estimate1', 'running', 1_000_000, 1_000_000, 'user1', nowIso())
    .run();
  return id;
}

interface KvPut {
  key: string;
  ttl: number | undefined;
}

function buildCtx(): { ctxPromise: Promise<StageContext>; kvPuts: KvPut[] } {
  const kvPuts: KvPut[] = [];
  const ctxPromise = (async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const kv = new Map<string, string>();
    const artifacts = new Map<string, string>();
    const env = {
      BLUEPRINT_DB: d1,
      BLUEPRINT_QUEUE: { send: async () => undefined },
      KV: {
        get: async (k: string) => kv.get(k) ?? null,
        put: async (k: string, v: string, opts?: { expirationTtl?: number }) => {
          kv.set(k, v);
          kvPuts.push({ key: k, ttl: opts?.expirationTtl });
        },
        delete: async (k: string) => {
          kv.delete(k);
        },
      } as unknown as KVNamespace,
      BLUEPRINT_ARTIFACTS: {
        put: async (k: string, v: string) => {
          artifacts.set(k, v);
        },
        get: async (k: string) => (artifacts.has(k) ? { text: async () => artifacts.get(k)! } : null),
      } as unknown as R2Bucket,
      DATAFORSEO_EMAIL: 'test@example.com',
      DATAFORSEO_PASSWORD: 'test-password',
    };
    return {
      env: env as any,
      d1,
      runId,
      projectId,
      briefVersionId: 'brief1',
      normalizedBrief: {} as any,
      stage: 'parse_competitor_pages',
      attempt: 1,
    } as StageContext;
  })();
  return { ctxPromise, kvPuts };
}

const RICH_ITEM = {
  type: 'content_parsing_element',
  status_code: 200,
  url: 'https://rival.com/ac-repair',
  page_content: {
    header: { primary_content: [{ text: 'Header intro paragraph.', important: false }] },
    main_topic: [
      { h_title: 'AC Repair Services', level: 1, primary_content: [{ text: 'We fix all AC units.', important: true }] },
      { h_title: 'Pricing', level: 2, primary_content: [{ text: 'Flat rate pricing.', important: false }] },
    ],
    secondary_topic: [{ h_title: 'FAQ', level: 2, primary_content: [{ text: 'Common questions.', important: false }] }],
  },
  topics: ['air conditioning', { name: 'hvac' }],
  links: [{ link_to: 'https://rival.com/contact', text: 'Contact us' }],
};

describe('fetchParsedPage happy path', () => {
  it('posts the Sec content_parsing body and returns a bounded, normalized extract', async () => {
    const { ctxPromise, kvPuts } = buildCtx();
    const ctx = await ctxPromise;
    const calls = stubFetchCapturing(contentResponse(RICH_ITEM));

    const extract = await fetchParsedPage(ctx, 'https://rival.com/ac-repair', false, 'page_1', COSTS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/on_page/content_parsing/live');
    expect(calls[0].body).toMatchObject({ url: 'https://rival.com/ac-repair', enable_javascript: false });
    expect(calls[0].body.tag).toMatch(/^run:/);

    expect(extract.statusCode).toBe(200);
    expect(extract.crawlStatusCode).toBe(200);
    expect(extract.headings).toEqual([
      { level: 1, text: 'AC Repair Services' },
      { level: 2, text: 'Pricing' },
      { level: 2, text: 'FAQ' },
    ]);
    expect(extract.textBlocks).toEqual([
      'Header intro paragraph.',
      'We fix all AC units.',
      'Flat rate pricing.',
      'Common questions.',
    ]);
    expect(extract.contentChars).toBe(
      extract.textBlocks.reduce((sum, b) => sum + b.length, 0)
    );
    expect(extract.topics).toEqual(['air conditioning', 'hvac']);
    expect(extract.links).toEqual([{ href: 'https://rival.com/contact', anchor: 'Contact us' }]);
    expect(extract.structure).toEqual({ headingLevelCounts: { '1': 1, '2': 2 }, hasSchema: null });
    expect(extract.isEmpty).toBe(false);
    expect(extract.fetchFailed).toBe(false);

    // Positive result -> cached at the 7d TTL.
    expect(kvPuts).toHaveLength(1);
    expect(kvPuts[0].ttl).toBe(POSITIVE_TTL);
  });

  it('round-trips enable_javascript=true into the request body', async () => {
    const { ctxPromise } = buildCtx();
    const ctx = await ctxPromise;
    const calls = stubFetchCapturing(contentResponse(RICH_ITEM));

    await fetchParsedPage(ctx, 'https://rival.com/ac-repair', true, 'page_1', COSTS);

    expect(calls[0].body.enable_javascript).toBe(true);
  });
});

describe('fetchParsedPage empty + failure signals', () => {
  it('reports isEmpty when the page loads but yields no headings or text', async () => {
    const { ctxPromise } = buildCtx();
    const ctx = await ctxPromise;
    stubFetchCapturing(
      contentResponse({ status_code: 200, url: 'https://rival.com/thin', page_content: { main_topic: [] } })
    );

    const extract = await fetchParsedPage(ctx, 'https://rival.com/thin', false, 'page_1', COSTS);

    expect(extract.contentChars).toBe(0);
    expect(extract.headings).toEqual([]);
    expect(extract.textBlocks).toEqual([]);
    expect(extract.isEmpty).toBe(true);
    expect(extract.fetchFailed).toBe(false);
  });

  it('caches at the empty TTL and reports fetchFailed when the task returns no result', async () => {
    const { ctxPromise, kvPuts } = buildCtx();
    const ctx = await ctxPromise;
    stubFetchCapturing(noResultResponse());

    const extract = await fetchParsedPage(ctx, 'https://rival.com/gone', false, 'page_1', COSTS);

    expect(extract.fetchFailed).toBe(true);
    expect(extract.isEmpty).toBe(false);
    expect(extract.structure).toBeNull();
    expect(extract.crawlStatusCode).toBeNull();
    expect(kvPuts).toHaveLength(1);
    expect(kvPuts[0].ttl).toBe(EMPTY_TTL);
  });

  it('reports fetchFailed on a page-level error status (>= 400)', async () => {
    const { ctxPromise } = buildCtx();
    const ctx = await ctxPromise;
    stubFetchCapturing(
      contentResponse({ status_code: 404, url: 'https://rival.com/missing', page_content: { main_topic: [] } })
    );

    const extract = await fetchParsedPage(ctx, 'https://rival.com/missing', false, 'page_1', COSTS);

    expect(extract.crawlStatusCode).toBe(404);
    expect(extract.fetchFailed).toBe(true);
    expect(extract.isEmpty).toBe(false);
  });

  it('throws a sanitized error (never fetchFailed) on a genuine provider task failure', async () => {
    const { ctxPromise } = buildCtx();
    const ctx = await ctxPromise;
    stubFetchCapturing(taskFailedResponse());

    await expect(fetchParsedPage(ctx, 'https://rival.com/x', false, 'page_1', COSTS)).rejects.toMatchObject({
      code: 'provider_invalid_response',
    });
  });
});

describe('fetchParsedPage degradation + bounds', () => {
  it('degrades to empty arrays / null when optional fields are missing, never throwing', async () => {
    const { ctxPromise } = buildCtx();
    const ctx = await ctxPromise;
    stubFetchCapturing(contentResponse({ status_code: 200 }));

    const extract = await fetchParsedPage(ctx, 'https://rival.com/bare', false, 'page_1', COSTS);

    expect(extract.headings).toEqual([]);
    expect(extract.textBlocks).toEqual([]);
    expect(extract.topics).toEqual([]);
    expect(extract.links).toEqual([]);
    expect(extract.contentChars).toBe(0);
    expect(extract.structure).toEqual({ headingLevelCounts: {}, hasSchema: null });
    expect(extract.isEmpty).toBe(true);
    expect(extract.fetchFailed).toBe(false);
  });

  it('caps headings at 50 and truncates over-long heading text to 300 chars', async () => {
    const { ctxPromise } = buildCtx();
    const ctx = await ctxPromise;
    const main_topic = Array.from({ length: 60 }, (_, i) => ({
      h_title: i === 0 ? 'H'.repeat(400) : `Heading ${i}`,
      level: 2,
      primary_content: [],
    }));
    stubFetchCapturing(contentResponse({ status_code: 200, page_content: { main_topic } }));

    const extract = await fetchParsedPage(ctx, 'https://rival.com/many', false, 'page_1', COSTS);

    expect(extract.headings).toHaveLength(50);
    expect(extract.headings[0].text).toHaveLength(300);
  });

  it('caps links at 100 and text blocks at their per-block length', async () => {
    const { ctxPromise } = buildCtx();
    const ctx = await ctxPromise;
    const links = Array.from({ length: 150 }, (_, i) => ({ link_to: `https://rival.com/p${i}`, text: `l${i}` }));
    const main_topic = [{ h_title: 'H', level: 1, primary_content: [{ text: 'x'.repeat(3000), important: false }] }];
    stubFetchCapturing(contentResponse({ status_code: 200, page_content: { main_topic }, links }));

    const extract = await fetchParsedPage(ctx, 'https://rival.com/big', false, 'page_1', COSTS);

    expect(extract.links).toHaveLength(100);
    expect(extract.textBlocks[0]).toHaveLength(2000);
    expect(extract.contentChars).toBe(2000);
  });
});

describe('fetchParsedPage URL safety', () => {
  it('rejects a private/internal target before making any request', async () => {
    const { ctxPromise } = buildCtx();
    const ctx = await ctxPromise;
    const calls = stubFetchCapturing(contentResponse(RICH_ITEM));

    await expect(fetchParsedPage(ctx, 'http://192.168.1.10/admin', false, 'page_1', COSTS)).rejects.toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
