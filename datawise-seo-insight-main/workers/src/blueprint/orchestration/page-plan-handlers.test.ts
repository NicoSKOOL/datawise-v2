import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import type { StageContext } from './handlers';
import { STAGE_HANDLERS } from './handlers';
import {
  parseCompetitorPagesHandler,
  buildPagePlanHandler,
  compareClustersForParsing,
  type RankableCluster,
  type ParseCompetitorPagesOutput,
  type BuildPagePlanOutput,
} from './page-plan-handlers';
import type { NormalizedProjectBrief } from '../contracts/types';
import { hashNormalizedInput } from '../domain/hash';
import { stageMeta } from './stages';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------- DFS content_parsing envelopes (mirror content-parsing.test.ts) ----------

function contentResponse(item: any, cost = 0.01) {
  return {
    status_code: 20000,
    tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost, result: [{ items: [item] }] }],
  };
}
function noResultResponse(cost = 0.01) {
  return {
    status_code: 20000,
    tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost, result: [] }],
  };
}
function taskFailedResponse() {
  return {
    status_code: 40000,
    tasks: [{ id: 'task-1', status_code: 40501, status_message: 'Invalid Field.', cost: 0, result: null }],
  };
}

// A page with real content (contentChars >= minContentChars=400): classified parsed.
function healthyItem(url: string) {
  return {
    status_code: 200,
    url,
    page_content: {
      main_topic: [{ h_title: 'Services', level: 1, primary_content: [{ text: 'x'.repeat(600), important: true }] }],
    },
  };
}
// A page that loads 200 but yields no content: classified empty.
function thinItem(url: string) {
  return { status_code: 200, url, page_content: { main_topic: [] } };
}
// An anti-bot stub: anomalous success status, no content: classified blocked.
function blockedItem(url: string) {
  return { status_code: 218, url, page_content: { main_topic: [] } };
}
// A real 404: fetchFailed, classified failed.
function failedItem(url: string) {
  return { status_code: 404, url, page_content: { main_topic: [] } };
}

// ---------- Fetch router keyed by url + enable_javascript ----------

interface FetchCall {
  url: string;
  js: boolean;
}
interface Route {
  no: any; // response for the no-JS (first) attempt
  js?: any; // response for the JS retry
}

function installFetch(routes: Record<string, Route>): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (_url: any, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const entry = Array.isArray(body) ? body[0] : body;
    const targetUrl: string = entry?.url;
    const js: boolean = !!entry?.enable_javascript;
    calls.push({ url: targetUrl, js });
    const route = routes[targetUrl];
    if (!route) throw new Error(`unexpected fetch for ${targetUrl}`);
    const response = js ? route.js : route.no;
    if (response === undefined) throw new Error(`unexpected ${js ? 'JS-retry' : 'first'} fetch for ${targetUrl}`);
    return { ok: true, status: 200, json: async () => response } as any;
  }) as any;
  return calls;
}

// ---------- Seeds ----------

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, 'org1', 'u1', 'Test', 'existing_site', 'US', 'en', ?, ?)`
    )
    .bind(id, nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, 'brief1', 'est1', 'running', 100000000, 0, 'u1', ?)`
    )
    .bind(id, projectId, nowIso())
    .run();
  return id;
}

async function seedKeyword(
  d1: D1Database,
  runId: string,
  spec: { id: string; nk: string; volume?: number | null }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword, search_volume, metrics_missing)
       VALUES (?, ?, ?, ?, ?, 0)`
    )
    .bind(spec.id, runId, spec.nk, spec.nk, spec.volume ?? null)
    .run();
}

async function seedCluster(
  d1: D1Database,
  runId: string,
  spec: { id: string; intent?: string | null; confidence?: number | null; primaryKeywordId: string; memberIds?: string[] }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keyword_clusters (id, run_id, label, intent, primary_keyword_id, confidence_score)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(spec.id, runId, spec.id, spec.intent ?? null, spec.primaryKeywordId, spec.confidence ?? null)
    .run();
  const members = spec.memberIds ?? [spec.primaryKeywordId];
  for (const mid of members) {
    await d1
      .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, membership_score, is_primary) VALUES (?, ?, 1, ?)`)
      .bind(spec.id, mid, mid === spec.primaryKeywordId ? 1 : 0)
      .run();
  }
}

async function seedCompetitor(
  d1: D1Database,
  runId: string,
  spec: { id: string; domain: string; selected?: boolean }
): Promise<void> {
  await d1
    .prepare(`INSERT INTO competitors (id, run_id, domain, source, selected) VALUES (?, ?, ?, 'discovered', ?)`)
    .bind(spec.id, runId, spec.domain, spec.selected === false ? 0 : 1)
    .run();
}

async function seedSnapshot(
  d1: D1Database,
  runId: string,
  keywordId: string,
  organic: Array<{ rank: number | null; url: string; domain?: string | null }>
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO serp_snapshots (id, run_id, keyword_id, location_code, language_code, checked_at, organic_json)
       VALUES (?, ?, ?, 2840, 'en', ?, ?)`
    )
    .bind(newId('snap'), runId, keywordId, nowIso(), JSON.stringify(organic))
    .run();
}

async function seedCompetitorEvidenceOutput(
  d1: D1Database,
  runId: string,
  perCompetitor: Array<{ domain: string; topPages: Array<{ url: string }> }>
): Promise<void> {
  const output = {
    perCompetitor: perCompetitor.map((c) => ({
      domain: c.domain,
      rankedCount: null,
      pagesCount: c.topPages.length,
      topPages: c.topPages.map((p) => ({ url: p.url, keywordCount: null, trafficEstimate: null })),
    })),
    stageCostUsdMicro: 0,
  };
  await d1
    .prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, output_json, finished_at)
       VALUES (?, ?, 'collect_competitor_evidence', ?, 'succeeded', ?, ?)`
    )
    .bind(newId('rsr'), runId, `hash-${newId('h')}`, JSON.stringify(output), nowIso())
    .run();
}

function buildCtx(d1: D1Database, projectId: string, runId: string): StageContext {
  const kv = new Map<string, string>();
  const artifacts = new Map<string, string>();
  const env = {
    BLUEPRINT_DB: d1,
    BLUEPRINT_QUEUE: { send: async () => undefined },
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: {
      put: async (k: string, v: string) => void artifacts.set(k, v),
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
}

async function countRows(d1: D1Database, runId: string): Promise<number> {
  const row = await d1
    .prepare(`SELECT COUNT(*) AS n FROM parsed_competitor_pages WHERE run_id = ?`)
    .bind(runId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// ---------- Pure ranking ----------

describe('compareClustersForParsing', () => {
  const c = (o: Partial<RankableCluster> & { id: string }): RankableCluster => ({
    id: o.id,
    intent: o.intent ?? null,
    confidenceScore: o.confidenceScore ?? null,
    totalVolume: o.totalVolume ?? 0,
  });

  it('ranks intent first: transactional/commercial above the rest', () => {
    const arr = [
      c({ id: 'a', intent: 'informational', confidenceScore: 1, totalVolume: 9999 }),
      c({ id: 'b', intent: 'transactional', confidenceScore: 0, totalVolume: 0 }),
      c({ id: 'c', intent: 'commercial', confidenceScore: 0, totalVolume: 0 }),
      c({ id: 'd', intent: 'navigational', confidenceScore: 1, totalVolume: 5000 }),
    ];
    const order = arr.slice().sort(compareClustersForParsing).map((x) => x.id);
    expect(order).toEqual(['b', 'c', 'd', 'a']);
  });

  it('breaks intent ties by confidence DESC, then volume DESC, then id ASC', () => {
    const arr = [
      c({ id: 'z', intent: 'commercial', confidenceScore: 0.5, totalVolume: 100 }),
      c({ id: 'y', intent: 'commercial', confidenceScore: 0.9, totalVolume: 10 }),
      c({ id: 'x', intent: 'commercial', confidenceScore: 0.5, totalVolume: 300 }),
      c({ id: 'w', intent: 'commercial', confidenceScore: 0.5, totalVolume: 300 }),
    ];
    const order = arr.slice().sort(compareClustersForParsing).map((x) => x.id);
    // y (conf .9) first; then volume 300 tie w<x by id; then z (volume 100).
    expect(order).toEqual(['y', 'w', 'x', 'z']);
  });

  it('is a total order (null intent/confidence sink to the bottom deterministically)', () => {
    const arr = [
      c({ id: 'n2', intent: null, confidenceScore: null, totalVolume: 0 }),
      c({ id: 'n1', intent: null, confidenceScore: null, totalVolume: 0 }),
      c({ id: 'k', intent: 'unknown', confidenceScore: 0, totalVolume: 0 }),
    ];
    const order = arr.slice().sort(compareClustersForParsing).map((x) => x.id);
    expect(order).toEqual(['k', 'n1', 'n2']);
  });
});

// ---------- Registration ----------

describe('parse_competitor_pages registration', () => {
  it('is wired into STAGE_HANDLERS (stub replaced)', () => {
    expect(STAGE_HANDLERS.parse_competitor_pages).toBe(parseCompetitorPagesHandler);
  });
});

// ---------- Handler integration ----------

describe('parseCompetitorPagesHandler', () => {
  it('skips with no_clusters when the run has no clusters', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    installFetch({});
    const ctx = buildCtx(d1, projectId, runId);

    const { output, status } = (await parseCompetitorPagesHandler(ctx)) as {
      output: ParseCompetitorPagesOutput;
      status: string;
    };
    expect(status).toBe('succeeded');
    expect(output.skipped).toBe(true);
    expect(output.reason).toBe('no_clusters');
    expect(output.rulesetVersion).toBe('pp-v2');
  });

  it('selects competitor SERP URLs by domain match in rank order, classifies parsed', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'drain cleaning', volume: 500 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw1' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    await seedCompetitor(d1, runId, { id: 'comp2', domain: 'other.com' });
    await seedSnapshot(d1, runId, 'kw1', [
      { rank: 3, url: 'https://other.com/page', domain: 'other.com' },
      { rank: 1, url: 'https://www.rival.com/top', domain: 'www.rival.com' },
      { rank: 2, url: 'https://notacompetitor.com/x', domain: 'notacompetitor.com' },
    ]);

    const calls = installFetch({
      'https://www.rival.com/top': { no: contentResponse(healthyItem('https://www.rival.com/top')) },
      'https://other.com/page': { no: contentResponse(healthyItem('https://other.com/page')) },
    });
    const ctx = buildCtx(d1, projectId, runId);
    const { output, status } = (await parseCompetitorPagesHandler(ctx)) as {
      output: ParseCompetitorPagesOutput;
      status: string;
    };

    expect(status).toBe('succeeded');
    // pagesPerCluster=2: rank-1 rival top + rank-4 other; non-competitor and rank-3 dropped.
    expect(output.urlsSelected).toBe(2);
    expect(output.parsed).toBe(2);
    expect(output.jsRetries).toBe(0);
    expect(calls.map((c) => c.url).sort()).toEqual(['https://other.com/page', 'https://www.rival.com/top']);

    const rows = await d1
      .prepare(`SELECT url, fetch_state, competitor_id, js_rendered FROM parsed_competitor_pages WHERE run_id = ? ORDER BY url`)
      .bind(runId)
      .all<{ url: string; fetch_state: string; competitor_id: string | null; js_rendered: number }>();
    expect(rows.results.map((r) => r.fetch_state)).toEqual(['parsed', 'parsed']);
    const rivalRow = rows.results.find((r) => r.url.includes('rival'));
    expect(rivalRow?.competitor_id).toBe('comp1');
  });

  it('falls back to collect_competitor_evidence topPages when no snapshot URL matches', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'drain cleaning', volume: 500 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw1' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    // Snapshot has only non-competitor organic hits -> forces the fallback.
    await seedSnapshot(d1, runId, 'kw1', [{ rank: 1, url: 'https://wikipedia.org/x', domain: 'wikipedia.org' }]);
    await seedCompetitorEvidenceOutput(d1, runId, [
      { domain: 'rival.com', topPages: [{ url: 'https://rival.com/best' }, { url: 'https://rival.com/second' }, { url: 'https://rival.com/third' }] },
    ]);

    installFetch({
      'https://rival.com/best': { no: contentResponse(healthyItem('https://rival.com/best')) },
      'https://rival.com/second': { no: contentResponse(healthyItem('https://rival.com/second')) },
    });
    const ctx = buildCtx(d1, projectId, runId);
    const { output } = (await parseCompetitorPagesHandler(ctx)) as { output: ParseCompetitorPagesOutput };

    // pagesPerCluster=2: first two topPages, third dropped.
    expect(output.urlsSelected).toBe(2);
    expect(output.parsed).toBe(2);
    const urls = await d1
      .prepare(`SELECT url FROM parsed_competitor_pages WHERE run_id = ? ORDER BY url`)
      .bind(runId)
      .all<{ url: string }>();
    expect(urls.results.map((r) => r.url)).toEqual(['https://rival.com/best', 'https://rival.com/second']);
  });

  it('dedupes a URL two clusters both pick: one fetch, two (cluster,url) rows', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'drain cleaning', volume: 500 });
    await seedKeyword(d1, runId, { id: 'kw2', nk: 'drain repair', volume: 400 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.9, primaryKeywordId: 'kw1' });
    await seedCluster(d1, runId, { id: 'cl2', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw2' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    // Both clusters' representative queries return the SAME competitor URL.
    await seedSnapshot(d1, runId, 'kw1', [{ rank: 1, url: 'https://rival.com/shared', domain: 'rival.com' }]);
    await seedSnapshot(d1, runId, 'kw2', [{ rank: 1, url: 'https://rival.com/shared', domain: 'rival.com' }]);

    const calls = installFetch({
      'https://rival.com/shared': { no: contentResponse(healthyItem('https://rival.com/shared')) },
    });
    const ctx = buildCtx(d1, projectId, runId);
    const { output } = (await parseCompetitorPagesHandler(ctx)) as { output: ParseCompetitorPagesOutput };

    expect(output.urlsSelected).toBe(2);
    expect(output.uniqueFetches).toBe(1);
    expect(output.parsed).toBe(1); // one classification
    expect(calls).toHaveLength(1); // fetched once
    expect(await countRows(d1, runId)).toBe(2); // one row per (cluster,url)
  });

  it('does ONE JS retry on thin content, classifies empty, never a second retry', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'drain cleaning', volume: 500 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw1' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    await seedSnapshot(d1, runId, 'kw1', [{ rank: 1, url: 'https://rival.com/thin', domain: 'rival.com' }]);

    const calls = installFetch({
      'https://rival.com/thin': { no: contentResponse(thinItem('https://rival.com/thin')), js: contentResponse(thinItem('https://rival.com/thin')) },
    });
    const ctx = buildCtx(d1, projectId, runId);
    const { output, status } = (await parseCompetitorPagesHandler(ctx)) as {
      output: ParseCompetitorPagesOutput;
      status: string;
    };

    expect(output.jsRetries).toBe(1);
    expect(output.empty).toBe(1);
    // An `empty` result is reachable-but-thin, not a failure: the stage stays
    // succeeded (only all-failed-or-blocked degrades to partial).
    expect(status).toBe('succeeded');
    expect(output.warnings).not.toContain('all_fetches_failed_or_blocked');
    expect(calls).toEqual([
      { url: 'https://rival.com/thin', js: false },
      { url: 'https://rival.com/thin', js: true },
    ]);
    const row = await d1
      .prepare(`SELECT fetch_state, js_rendered FROM parsed_competitor_pages WHERE run_id = ?`)
      .bind(runId)
      .first<{ fetch_state: string; js_rendered: number }>();
    expect(row?.fetch_state).toBe('empty');
    expect(row?.js_rendered).toBe(1);
  });

  it('retries on a bot challenge and classifies blocked; a healthy parse never retries', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'a', volume: 500 });
    await seedKeyword(d1, runId, { id: 'kw2', nk: 'b', volume: 400 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.9, primaryKeywordId: 'kw1' });
    await seedCluster(d1, runId, { id: 'cl2', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw2' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    await seedSnapshot(d1, runId, 'kw1', [{ rank: 1, url: 'https://rival.com/blocked', domain: 'rival.com' }]);
    await seedSnapshot(d1, runId, 'kw2', [{ rank: 1, url: 'https://rival.com/healthy', domain: 'rival.com' }]);

    const calls = installFetch({
      'https://rival.com/blocked': { no: contentResponse(blockedItem('https://rival.com/blocked')), js: contentResponse(blockedItem('https://rival.com/blocked')) },
      'https://rival.com/healthy': { no: contentResponse(healthyItem('https://rival.com/healthy')) }, // no `js`: an unexpected retry would throw
    });
    const ctx = buildCtx(d1, projectId, runId);
    const { output, status } = (await parseCompetitorPagesHandler(ctx)) as {
      output: ParseCompetitorPagesOutput;
      status: string;
    };

    expect(status).toBe('succeeded'); // one parsed keeps it succeeded
    expect(output.blocked).toBe(1);
    expect(output.parsed).toBe(1);
    expect(output.jsRetries).toBe(1); // only the blocked url retried
    expect(calls.filter((c) => c.url.includes('healthy'))).toHaveLength(1); // healthy never retried
  });

  it('classifies a 404 as failed after its single retry', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'a', volume: 500 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw1' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    await seedSnapshot(d1, runId, 'kw1', [{ rank: 1, url: 'https://rival.com/gone', domain: 'rival.com' }]);

    installFetch({
      'https://rival.com/gone': { no: contentResponse(failedItem('https://rival.com/gone')), js: contentResponse(failedItem('https://rival.com/gone')) },
    });
    const ctx = buildCtx(d1, projectId, runId);
    const { output, status } = (await parseCompetitorPagesHandler(ctx)) as {
      output: ParseCompetitorPagesOutput;
      status: string;
    };
    expect(output.failed).toBe(1);
    expect(status).toBe('partial'); // all fetches failed/blocked
    expect(output.warnings).toContain('all_fetches_failed_or_blocked');
  });

  it('warns no_competitor_urls (succeeded) when clusters exist but nothing is fetchable', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'a', volume: 500 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw1' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    // No snapshot, no topPages -> nothing to fetch.
    installFetch({});
    const ctx = buildCtx(d1, projectId, runId);
    const { output, status } = (await parseCompetitorPagesHandler(ctx)) as {
      output: ParseCompetitorPagesOutput;
      status: string;
    };
    expect(status).toBe('succeeded');
    expect(output.urlsSelected).toBe(0);
    expect(output.warnings).toEqual(['no_competitor_urls']);
  });

  it('propagates a task-level provider throw (does not swallow it)', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'a', volume: 500 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw1' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    await seedSnapshot(d1, runId, 'kw1', [{ rank: 1, url: 'https://rival.com/boom', domain: 'rival.com' }]);

    installFetch({ 'https://rival.com/boom': { no: taskFailedResponse() } });
    const ctx = buildCtx(d1, projectId, runId);
    await expect(parseCompetitorPagesHandler(ctx)).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });

  it('is rerun-safe: a second run replaces rows without duplicating them', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedKeyword(d1, runId, { id: 'kw1', nk: 'a', volume: 500 });
    await seedCluster(d1, runId, { id: 'cl1', intent: 'commercial', confidence: 0.8, primaryKeywordId: 'kw1' });
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    await seedSnapshot(d1, runId, 'kw1', [{ rank: 1, url: 'https://rival.com/p', domain: 'rival.com' }]);

    installFetch({ 'https://rival.com/p': { no: contentResponse(healthyItem('https://rival.com/p')) } });
    const ctx = buildCtx(d1, projectId, runId);
    await parseCompetitorPagesHandler(ctx);
    expect(await countRows(d1, runId)).toBe(1);
    await parseCompetitorPagesHandler(ctx); // second attempt (KV-cached fetch)
    expect(await countRows(d1, runId)).toBe(1);
  });

  it('chunks persistence past the per-statement row budget (many rows persist intact)', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedCompetitor(d1, runId, { id: 'comp1', domain: 'rival.com' });
    const routes: Record<string, Route> = {};
    // 8 clusters x 1 competitor URL each = 8 rows, past the 6-rows-per-statement chunk.
    for (let i = 0; i < 8; i++) {
      const kw = `kw${i}`;
      const nk = `keyword ${i}`;
      const url = `https://rival.com/p${i}`;
      await seedKeyword(d1, runId, { id: kw, nk, volume: 100 });
      await seedCluster(d1, runId, { id: `cl${i}`, intent: 'commercial', confidence: 0.5, primaryKeywordId: kw });
      await seedSnapshot(d1, runId, kw, [{ rank: 1, url, domain: 'rival.com' }]);
      routes[url] = { no: contentResponse(healthyItem(url)) };
    }
    installFetch(routes);
    const ctx = buildCtx(d1, projectId, runId);
    const { output } = (await parseCompetitorPagesHandler(ctx)) as { output: ParseCompetitorPagesOutput };
    expect(output.clustersSelected).toBe(8);
    expect(output.urlsSelected).toBe(8);
    expect(await countRows(d1, runId)).toBe(8);
  });
});

// ======================= build_page_plan (Task 16) =======================

function planBrief(overrides: Partial<NormalizedProjectBrief> = {}): NormalizedProjectBrief {
  return {
    mode: 'greenfield',
    businessName: 'Acme Plumbing',
    normalizedBusinessName: 'acme plumbing',
    category: 'plumber',
    websiteDomain: null,
    websiteUrl: null,
    countryIso: 'US',
    languageCode: 'en',
    services: [{ id: 's1', name: 'Drain Cleaning', normalizedName: 'drain cleaning', description: null, synonyms: [], priority: 'primary' }],
    serviceAreas: [{ id: 'a1', city: 'Austin', region: 'TX', countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: ['travis county'] }],
    targetCustomers: [],
    differentiators: [],
    knownCompetitorDomains: [],
    excludedDomains: [],
    excludedTopics: [],
    goals: [],
    maxRecommendedPages: 30,
    enableUsFanout: false,
    inputHash: 'hash1',
    ...overrides,
  };
}

function buildPlanCtx(
  d1: D1Database,
  projectId: string,
  runId: string,
  brief: NormalizedProjectBrief,
): { ctx: StageContext; artifacts: Map<string, string> } {
  const kv = new Map<string, string>();
  const artifacts = new Map<string, string>();
  const env = {
    BLUEPRINT_DB: d1,
    BLUEPRINT_QUEUE: { send: async () => undefined },
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: {
      put: async (k: string, v: string) => void artifacts.set(k, v),
      get: async (k: string) => (artifacts.has(k) ? { text: async () => artifacts.get(k)! } : null),
    } as unknown as R2Bucket,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
  };
  const ctx = {
    env: env as any,
    d1,
    runId,
    projectId,
    briefVersionId: 'brief1',
    normalizedBrief: brief,
    stage: 'build_page_plan',
    attempt: 1,
  } as StageContext;
  return { ctx, artifacts };
}

async function seedStrongCluster(
  d1: D1Database,
  runId: string,
  spec: { id: string; nk: string; volume: number; serviceId?: string | null; serviceAreaId?: string | null; intent?: string; evidenceRefIds?: string[] },
): Promise<void> {
  const kid = `k-${spec.id}`;
  await d1
    .prepare(`INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword, search_volume, metrics_missing) VALUES (?, ?, ?, ?, ?, 0)`)
    .bind(kid, runId, spec.nk, spec.nk, spec.volume)
    .run();
  const scoreBreakdownJson = spec.evidenceRefIds !== undefined
    ? JSON.stringify({ rulesetVersion: 'cluster-v3', evidenceRefIds: spec.evidenceRefIds })
    : null;
  await d1
    .prepare(
      `INSERT INTO keyword_clusters (id, run_id, label, intent, confidence_label, service_id, service_area_id, primary_keyword_id, score_breakdown_json)
       VALUES (?, ?, ?, ?, 'high', ?, ?, ?, ?)`,
    )
    .bind(spec.id, runId, spec.nk, spec.intent ?? 'transactional', spec.serviceId ?? null, spec.serviceAreaId ?? null, kid, scoreBreakdownJson)
    .run();
  await d1
    .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, membership_score, is_primary) VALUES (?, ?, 1, 1)`)
    .bind(spec.id, kid)
    .run();
}

describe('buildPagePlanHandler', () => {
  it('is registered as a REQUIRED stage', () => {
    expect(STAGE_HANDLERS.build_page_plan).toBe(buildPagePlanHandler);
    expect(stageMeta('build_page_plan').required).toBe(true);
  });

  it('persists the plan to R2 + an artifacts row, writes page_candidate back, and returns a compact summary', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedStrongCluster(d1, runId, { id: 'c1', nk: 'drain cleaning', volume: 500, serviceId: 's1', evidenceRefIds: ['evr_1', 'evr_2'] });

    const { ctx, artifacts } = buildPlanCtx(d1, projectId, runId, planBrief());
    const result = await buildPagePlanHandler(ctx);
    expect(result.status).toBe('succeeded');
    const output = result.output as BuildPagePlanOutput;

    // R2 artifact written at the deterministic key.
    expect(output.storageKey).toBe(`runs/${runId}/page-plan.json`);
    expect(artifacts.has(output.storageKey)).toBe(true);
    const stored = JSON.parse(artifacts.get(output.storageKey)!);
    expect(stored.rulesetVersion).toBe('pp-v2');
    expect(Array.isArray(stored.pages)).toBe(true);
    // evidence refs threaded from the cluster onto its dedicated page.
    const resourcePage = stored.pages.find((p: any) => p.pageType === 'resource');
    expect(resourcePage.scores.evidenceRefs).toEqual(['evr_1', 'evr_2']);

    // artifacts row parity.
    const artRow = await d1
      .prepare(`SELECT kind, storage_key, content_type FROM artifacts WHERE run_id = ? AND storage_key = ?`)
      .bind(runId, output.storageKey)
      .first<{ kind: string; storage_key: string; content_type: string }>();
    expect(artRow?.kind).toBe('page_plan');
    expect(artRow?.content_type).toBe('application/json');

    // compact summary carries the skeleton + the earned dedicated page.
    expect(output.stage).toBe('build_page_plan');
    expect(output.skeletonPageCount).toBeGreaterThanOrEqual(4);
    expect(output.dedicatedPageCount).toBe(1);
    expect(output.pages.some((p) => p.pageType === 'resource')).toBe(true);

    // page_candidate write-back for the cluster.
    const clusterRow = await d1
      .prepare(`SELECT page_candidate, decision_reason FROM keyword_clusters WHERE id = ?`)
      .bind('c1')
      .first<{ page_candidate: string | null; decision_reason: string | null }>();
    expect(clusterRow?.page_candidate).toBeTruthy();
    expect(clusterRow?.decision_reason).toBeTruthy();
  });

  it('rerun is safe: a second run overwrites the same artifact (no duplicate rows) and page_candidate stays consistent', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedStrongCluster(d1, runId, { id: 'c1', nk: 'drain cleaning', volume: 500, serviceId: 's1' });

    const { ctx } = buildPlanCtx(d1, projectId, runId, planBrief());
    await buildPagePlanHandler(ctx);
    const firstCandidate = await d1.prepare(`SELECT page_candidate FROM keyword_clusters WHERE id = 'c1'`).first<{ page_candidate: string }>();
    await buildPagePlanHandler(ctx);
    const secondCandidate = await d1.prepare(`SELECT page_candidate FROM keyword_clusters WHERE id = 'c1'`).first<{ page_candidate: string }>();

    expect(secondCandidate?.page_candidate).toBe(firstCandidate?.page_candidate);
    const artCount = await d1
      .prepare(`SELECT COUNT(*) AS n FROM artifacts WHERE run_id = ? AND storage_key = ?`)
      .bind(runId, `runs/${runId}/page-plan.json`)
      .first<{ n: number }>();
    expect(artCount?.n).toBe(1);
  });

  it('a run with zero clusters still emits a valid minimal plan (skeleton only), not a skip', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);

    const { ctx } = buildPlanCtx(d1, projectId, runId, planBrief());
    const result = await buildPagePlanHandler(ctx);
    expect(result.status).toBe('succeeded');
    const output = result.output as BuildPagePlanOutput;
    expect(output.clustersPlaced).toBe(0);
    expect(output.dedicatedPageCount).toBe(0);
    expect(output.pageCount).toBeGreaterThanOrEqual(4);
    expect(output.warnings).toContain('no_clusters_planned');
  });

  it('is deterministic: the stored plan artifact hashes identically across two fresh runs on the same data', async () => {
    async function run(): Promise<string> {
      const { d1 } = createTestDb();
      const projectId = await seedProject(d1);
      const runId = await seedRun(d1, projectId);
      await seedStrongCluster(d1, runId, { id: 'c1', nk: 'drain cleaning', volume: 500, serviceId: 's1' });
      await seedStrongCluster(d1, runId, { id: 'c2', nk: 'drain cleaning austin', volume: 300, serviceId: 's1', serviceAreaId: 'a1' });
      const { ctx, artifacts } = buildPlanCtx(d1, projectId, runId, planBrief());
      const result = await buildPagePlanHandler(ctx);
      const key = (result.output as BuildPagePlanOutput).storageKey;
      // Hash the plan body with the per-run runId stripped: only the plan shape
      // (pages/placements/warnings) must be identical, not the run-scoped key.
      const stored = JSON.parse(artifacts.get(key)!);
      return hashNormalizedInput(stored);
    }
    const [a, b] = await Promise.all([run(), run()]);
    expect(a).toBe(b);
  });
});
