import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import type { StageContext } from '../../orchestration/handlers';
import type { NormalizedProjectBrief } from '../../contracts/types';
import { postSerpTasks, collectSerpTasks, SerpTasksPendingError } from './serp';
import type { SerpQuery } from './serp';
import { DEFAULT_DFS_COST_ESTIMATES } from './costs';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetchJson(response: any) {
  const calls: unknown[] = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => response } as any;
  }) as any;
  return calls;
}

function fakeProviderEnv() {
  const kv = new Map<string, string>();
  const kvPuts: Array<{ key: string }> = [];
  const artifacts = new Map<string, string>();
  return {
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => {
        kv.set(k, v);
        kvPuts.push({ key: k });
      },
      delete: async (k: string) => {
        kv.delete(k);
      },
    } as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: {
      put: async () => undefined,
      get: async () => null,
    } as unknown as R2Bucket,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
    kvPuts,
  };
}

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, 'org1', 'user1', 'Aqua Plumbing', 'greenfield', 'US', 'en', nowIso(), nowIso())
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
    .bind(id, projectId, 'brief1', 'estimate1', 'running', 5_000_000, 0, 'user1', nowIso())
    .run();
  return id;
}

const NORMALIZED_BRIEF: NormalizedProjectBrief = {
  mode: 'greenfield',
  businessName: 'Aqua Plumbing',
  normalizedBusinessName: 'aqua plumbing',
  category: 'Plumber',
  websiteDomain: null,
  websiteUrl: null,
  countryIso: 'US',
  languageCode: 'en',
  services: [],
  serviceAreas: [],
  targetCustomers: [],
  differentiators: [],
  knownCompetitorDomains: [],
  excludedDomains: [],
  excludedTopics: [],
} as unknown as NormalizedProjectBrief;

async function buildCtx() {
  const { d1 } = createTestDb();
  const projectId = await seedProject(d1);
  const runId = await seedRun(d1, projectId);
  const env = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: { send: async () => undefined }, ...fakeProviderEnv() };
  const ctx: StageContext = {
    env: env as any,
    d1,
    runId,
    projectId,
    briefVersionId: 'brief1',
    normalizedBrief: NORMALIZED_BRIEF,
    stage: 'validate_serps_and_questions',
    attempt: 1,
  };
  return { ctx, d1, runId, projectId };
}

async function seedKeywordRow(d1: D1Database, runId: string, displayKeyword: string, normalizedKeyword: string) {
  await d1
    .prepare(
      `INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword)
       VALUES (?, ?, ?, ?)`
    )
    .bind(newId('kw'), runId, displayKeyword, normalizedKeyword)
    .run();
}

function taskPostResponse(taskIds: string[]) {
  return {
    status_code: 20000,
    tasks: taskIds.map((id) => ({
      id,
      status_code: 20100, // "Task Created." -- task_post's real success code
      status_message: 'Task Created.',
      cost: 0.01,
      result: [{ id }],
    })),
  };
}

function notReadyTaskGetResponse(taskId: string) {
  return {
    status_code: 20000,
    tasks: [
      {
        id: taskId,
        status_code: 40601,
        status_message: 'Task In Queue.',
        cost: 0,
        result: null,
      },
    ],
  };
}

function readyTaskGetResponse(taskId: string, items: any[]) {
  return {
    status_code: 20000,
    tasks: [
      {
        id: taskId,
        status_code: 20000,
        status_message: 'Ok.',
        cost: 0,
        result: [{ items }],
      },
    ],
  };
}

async function countReservations(d1: D1Database, runId: string) {
  const row = await d1
    .prepare(`SELECT COUNT(*) as count FROM provider_budget_reservations WHERE run_id = ? AND provider = 'dataforseo'`)
    .bind(runId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe('postSerpTasks', () => {
  it('inserts one dfs_serp_tasks row per successful task and reserves once for the whole batch', async () => {
    const { ctx, d1, runId } = await buildCtx();
    stubFetchJson(taskPostResponse(['task-1', 'task-2']));

    const queries: SerpQuery[] = [
      { keyword: 'emergency plumbing austin', serviceAreaId: 'a1', locationCode: 1023191 },
      { keyword: 'drain cleaning austin', serviceAreaId: 'a1', locationCode: 1023191 },
    ];

    await postSerpTasks(ctx, queries, DEFAULT_DFS_COST_ESTIMATES);

    const rows = await d1
      .prepare(`SELECT keyword, provider_task_id, status FROM dfs_serp_tasks WHERE run_id = ? ORDER BY keyword`)
      .bind(runId)
      .all<{ keyword: string; provider_task_id: string; status: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.map((r) => r.status)).toEqual(['posted', 'posted']);
    expect(new Set(rows.results.map((r) => r.provider_task_id))).toEqual(new Set(['task-1', 'task-2']));

    expect(await countReservations(d1, runId)).toBe(1);
  });

  it('posts device desktop / os windows / depth 10 / people_also_ask_click_depth 1 / priority 1 with a per-query tag', async () => {
    const { ctx, runId } = await buildCtx();
    const calls = stubFetchJson(taskPostResponse(['task-1']));

    await postSerpTasks(
      ctx,
      [{ keyword: 'emergency plumbing austin', serviceAreaId: 'a1', locationCode: 1023191 }],
      DEFAULT_DFS_COST_ESTIMATES
    );

    const call = calls[0] as { init: { body: string } };
    const sentBodies = JSON.parse(call.init.body);
    expect(sentBodies).toHaveLength(1);
    expect(sentBodies[0]).toMatchObject({
      keyword: 'emergency plumbing austin',
      location_code: 1023191,
      language_code: 'en',
      device: 'desktop',
      os: 'windows',
      depth: 10,
      people_also_ask_click_depth: 1,
      priority: 1,
      tag: `run:${runId}:serp:a1`,
    });
  });

  it('does nothing for an empty query list', async () => {
    const { ctx, d1, runId } = await buildCtx();
    globalThis.fetch = (async () => {
      throw new Error('fetch should not have been called');
    }) as any;

    await postSerpTasks(ctx, [], DEFAULT_DFS_COST_ESTIMATES);

    const rows = await d1.prepare(`SELECT COUNT(*) as c FROM dfs_serp_tasks WHERE run_id = ?`).bind(runId).first<{ c: number }>();
    expect(rows?.c).toBe(0);
  });
});

describe('collectSerpTasks', () => {
  async function seedPostedRow(d1: D1Database, runId: string, overrides: Partial<{ keyword: string; providerTaskId: string; serviceAreaId: string | null }> = {}) {
    const id = newId('serpt');
    await d1
      .prepare(
        `INSERT INTO dfs_serp_tasks (id, run_id, keyword, service_area_id, location_code, provider_task_id, status, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'posted', ?)`
      )
      .bind(
        id,
        runId,
        overrides.keyword ?? 'emergency plumbing austin',
        overrides.serviceAreaId ?? 'a1',
        1023191,
        overrides.providerTaskId ?? 'task-1',
        nowIso()
      )
      .run();
    return id;
  }

  it('a not-ready task_get leaves the row posted and counts it as pending', async () => {
    const { ctx, d1, runId } = await buildCtx();
    await seedKeywordRow(d1, runId, 'emergency plumbing austin', 'emergency plumbing austin');
    const rowId = await seedPostedRow(d1, runId);
    stubFetchJson(notReadyTaskGetResponse('task-1'));

    const result = await collectSerpTasks(ctx);

    expect(result).toEqual({ completed: 0, pending: 1, failed: 0 });
    const row = await d1.prepare(`SELECT status FROM dfs_serp_tasks WHERE id = ?`).bind(rowId).first<{ status: string }>();
    expect(row?.status).toBe('posted');
  });

  it('a ready payload writes serp_snapshots + one faq_evidence row per PAA question, ai_overview unchecked, and marks the row completed', async () => {
    const { ctx, d1, runId } = await buildCtx();
    await seedKeywordRow(d1, runId, 'emergency plumbing austin', 'emergency plumbing austin');
    const rowId = await seedPostedRow(d1, runId);

    const items = [
      { type: 'organic', rank_group: 1, url: 'https://a.com', title: 'A', domain: 'a.com' },
      { type: 'organic', rank_group: 2, url: 'https://b.com', title: 'B', domain: 'b.com' },
      {
        type: 'people_also_ask',
        items: [
          {
            type: 'people_also_ask_element',
            title: 'How much does emergency plumbing cost?',
            expanded_element: [{ type: 'people_also_ask_expanded_element', title: 'Cost Guide', url: 'https://c.com', description: 'It depends.' }],
          },
          {
            type: 'people_also_ask_element',
            title: 'Is emergency plumbing worth it?',
            expanded_element: [{ type: 'people_also_ask_expanded_element', title: 'Worth Guide', url: 'https://d.com', description: 'Usually.' }],
          },
        ],
      },
      { type: 'related_searches', items: ['24 hour plumber austin', 'cheap plumber austin'] },
      { type: 'local_pack' },
      { type: 'featured_snippet' },
    ];
    stubFetchJson(readyTaskGetResponse('task-1', items));

    const result = await collectSerpTasks(ctx);

    expect(result).toEqual({ completed: 1, pending: 0, failed: 0 });

    const row = await d1
      .prepare(`SELECT status, snapshot_id FROM dfs_serp_tasks WHERE id = ?`)
      .bind(rowId)
      .first<{ status: string; snapshot_id: string }>();
    expect(row?.status).toBe('completed');
    expect(row?.snapshot_id).toBeTruthy();

    const snapshot = await d1
      .prepare(`SELECT * FROM serp_snapshots WHERE id = ?`)
      .bind(row!.snapshot_id)
      .first<any>();
    expect(snapshot.ai_overview_status).toBe('unchecked');
    expect(snapshot.local_pack_present).toBe(1);
    expect(snapshot.featured_snippet_present).toBe(1);
    expect(JSON.parse(snapshot.organic_json)).toHaveLength(2);
    expect(JSON.parse(snapshot.related_searches_json)).toEqual(['24 hour plumber austin', 'cheap plumber austin']);

    const faqRows = await d1
      .prepare(`SELECT question, answer_text FROM faq_evidence WHERE serp_snapshot_id = ? ORDER BY question`)
      .bind(row!.snapshot_id)
      .all<{ question: string; answer_text: string }>();
    expect(faqRows.results).toHaveLength(2);
    expect(faqRows.results.map((r) => r.question)).toEqual([
      'How much does emergency plumbing cost?',
      'Is emergency plumbing worth it?',
    ]);

    const evidenceRows = await d1
      .prepare(`SELECT kind FROM evidence_refs WHERE run_id = ? ORDER BY kind`)
      .bind(runId)
      .all<{ kind: string }>();
    expect(evidenceRows.results.map((r) => r.kind)).toEqual(['paa_question', 'paa_question', 'serp_snapshot']);
  });

  it('a genuine per-task DataForSEO failure marks the row failed, not posted, and does not throw', async () => {
    const { ctx, d1, runId } = await buildCtx();
    await seedKeywordRow(d1, runId, 'emergency plumbing austin', 'emergency plumbing austin');
    const rowId = await seedPostedRow(d1, runId);
    stubFetchJson({
      status_code: 20000,
      tasks: [{ id: 'task-1', status_code: 40501, status_message: 'Invalid Field.', cost: 0, result: null }],
    });

    const result = await collectSerpTasks(ctx);

    expect(result).toEqual({ completed: 0, pending: 0, failed: 1 });
    const row = await d1.prepare(`SELECT status FROM dfs_serp_tasks WHERE id = ?`).bind(rowId).first<{ status: string }>();
    expect(row?.status).toBe('failed');
  });

  it('mixed posted rows: leaves not-ready pending, completes ready ones, independently', async () => {
    const { ctx, d1, runId } = await buildCtx();
    await seedKeywordRow(d1, runId, 'emergency plumbing austin', 'emergency plumbing austin');
    await seedKeywordRow(d1, runId, 'drain cleaning austin', 'drain cleaning austin');
    await seedPostedRow(d1, runId, { keyword: 'emergency plumbing austin', providerTaskId: 'task-1' });
    await seedPostedRow(d1, runId, { keyword: 'drain cleaning austin', providerTaskId: 'task-2' });

    globalThis.fetch = (async (url: any) => {
      const href = String(url);
      if (href.includes('task-1')) {
        return { ok: true, status: 200, json: async () => notReadyTaskGetResponse('task-1') } as any;
      }
      return { ok: true, status: 200, json: async () => readyTaskGetResponse('task-2', [{ type: 'organic', rank_group: 1, url: 'https://e.com', title: 'E', domain: 'e.com' }]) } as any;
    }) as any;

    const result = await collectSerpTasks(ctx);
    expect(result).toEqual({ completed: 1, pending: 1, failed: 0 });
  });
});

describe('SerpTasksPendingError', () => {
  it('is a plain Error subclass (not a BlueprintApiError)', () => {
    const err = new SerpTasksPendingError('pending');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SerpTasksPendingError');
    expect(err.message).toBe('pending');
  });
});
