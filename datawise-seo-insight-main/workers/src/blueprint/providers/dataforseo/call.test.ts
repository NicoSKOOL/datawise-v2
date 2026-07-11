import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import { hashNormalizedInput } from '../../domain/hash';
import { BlueprintApiError } from '../../domain/api-errors';
import type { StageContext } from '../../orchestration/handlers';
import { blueprintDfsCall, dollarsToMicro } from './call';
import type { DfsCallSpec } from './call';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const okResponse = (items: any[], cost = 0.05) => ({
  status_code: 20000,
  tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost, result: [{ items }] }],
});

const failedResponse = (message = 'Invalid Field.', cost = 0.01) => ({
  status_code: 40501,
  tasks: [{ id: 'task-1', status_code: 40501, status_message: message, cost, result: null }],
});

function stubFetchJson(response: any) {
  const calls: unknown[] = [];
  globalThis.fetch = (async (url: any, init?: any) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => response } as any;
  }) as any;
  return calls;
}

function stubFetchThrow(err: unknown) {
  const calls: unknown[] = [];
  globalThis.fetch = (async () => {
    calls.push(true);
    throw err;
  }) as any;
  return calls;
}

function stubFetchNeverCalled() {
  globalThis.fetch = (async () => {
    throw new Error('fetch should not have been called');
  }) as any;
}

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, 'org1', 'user1', 'Test Project', 'greenfield', 'US', 'en', nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(
  d1: D1Database,
  projectId: string,
  overrides: Partial<{ dataforseoBudgetUsdMicro: number }> = {}
): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      projectId,
      'brief1',
      'estimate1',
      'running',
      overrides.dataforseoBudgetUsdMicro ?? 1_000_000,
      1_000_000,
      'user1',
      nowIso()
    )
    .run();
  return id;
}

function fakeProviderEnv() {
  const kv = new Map<string, string>();
  const kvPuts: Array<{ key: string; options?: { expirationTtl?: number } }> = [];
  const artifacts = new Map<string, string>();
  return {
    kvPuts,
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string, options?: { expirationTtl?: number }) => {
        kv.set(k, v);
        kvPuts.push({ key: k, options });
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
}

async function buildCtx(overrides: Partial<{ dataforseoBudgetUsdMicro: number }> = {}) {
  const { d1 } = createTestDb();
  const projectId = await seedProject(d1);
  const runId = await seedRun(d1, projectId, overrides);
  const env = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: { send: async () => undefined }, ...fakeProviderEnv() };
  const ctx: StageContext = {
    env: env as any,
    d1,
    runId,
    projectId,
    briefVersionId: 'brief1',
    normalizedBrief: {} as any,
    stage: 'collect_keyword_evidence',
    attempt: 1,
  };
  return { ctx, d1, runId, projectId };
}

async function getRun(d1: D1Database, runId: string) {
  return d1
    .prepare(
      `SELECT dataforseo_reserved_usd_micro, dataforseo_actual_usd_micro FROM research_runs WHERE id = ?`
    )
    .bind(runId)
    .first<{ dataforseo_reserved_usd_micro: number; dataforseo_actual_usd_micro: number }>();
}

async function countReservations(d1: D1Database, runId: string) {
  const row = await d1
    .prepare(`SELECT COUNT(*) as count FROM provider_budget_reservations WHERE run_id = ? AND provider = 'dataforseo'`)
    .bind(runId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

async function getEvidenceRefs(d1: D1Database, runId: string) {
  const rows = await d1
    .prepare(`SELECT * FROM evidence_refs WHERE run_id = ?`)
    .bind(runId)
    .all<any>();
  return rows.results;
}

const baseSpec: DfsCallSpec = {
  method: 'POST',
  endpoint: '/dataforseo_labs/google/keyword_ideas/live',
  body: { keywords: ['plumber austin'] },
  ttlSeconds: 3600,
  emptyTtlSeconds: 60,
  kind: 'keyword_metric',
  operation: 'keyword_ideas',
  scopeId: 'scope-1',
  estimateUsdMicro: 200_000,
};

describe('blueprintDfsCall', () => {
  it('miss path reserves then reconciles: reserved back to 0, actual == dollarsToMicro(cost)', async () => {
    const { ctx, d1, runId } = await buildCtx();
    stubFetchJson(okResponse([{ keyword: 'plumber austin', search_volume: 100 }], 0.05));

    const result = await blueprintDfsCall(ctx, baseSpec);

    expect(result.cacheStatus).toBe('miss');
    expect(result.costUsdMicro).toBe(dollarsToMicro(0.05));
    expect(result.items).toEqual([{ keyword: 'plumber austin', search_volume: 100 }]);

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(dollarsToMicro(0.05));
  });

  it('evidence_refs row exists with the right kind/hash on miss', async () => {
    const { ctx, d1, runId } = await buildCtx();
    stubFetchJson(okResponse([{ keyword: 'plumber austin' }], 0.05));

    const requestHash = await hashNormalizedInput([baseSpec.method, baseSpec.endpoint, baseSpec.body ?? null]);
    const result = await blueprintDfsCall(ctx, baseSpec);

    const refs = await getEvidenceRefs(d1, runId);
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe(result.evidenceRefId);
    expect(refs[0].kind).toBe('keyword_metric');
    expect(refs[0].request_hash).toBe(requestHash);
    expect(refs[0].cost_usd_micro).toBe(dollarsToMicro(0.05));
  });

  it('hit path (pre-seeded KV) makes zero fetch calls and zero reservations, evidence row exists with right kind/hash', async () => {
    const { ctx, d1, runId } = await buildCtx();
    const requestHash = await hashNormalizedInput([baseSpec.method, baseSpec.endpoint, baseSpec.body ?? null]);
    await (ctx.env as any).KV.put(`bp:dfs:${requestHash}`, JSON.stringify(okResponse([{ keyword: 'cached' }], 0.05)));
    stubFetchNeverCalled();

    const result = await blueprintDfsCall(ctx, baseSpec);

    expect(result.cacheStatus).toBe('hit');
    expect(result.costUsdMicro).toBe(0);
    expect(result.items).toEqual([{ keyword: 'cached' }]);

    expect(await countReservations(d1, runId)).toBe(0);
    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(0);

    const refs = await getEvidenceRefs(d1, runId);
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe(result.evidenceRefId);
    expect(refs[0].kind).toBe('keyword_metric');
    expect(refs[0].request_hash).toBe(requestHash);
    expect(refs[0].cost_usd_micro).toBe(0);
    expect(refs[0].operation).toBe('keyword_ideas:cache');
  });

  it('provider throw releases the reservation and surfaces a BlueprintApiError', async () => {
    const { ctx, d1, runId } = await buildCtx();
    stubFetchThrow(new Error('network exploded'));

    await expect(blueprintDfsCall(ctx, baseSpec)).rejects.toBeInstanceOf(BlueprintApiError);

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(0);
    expect(await countReservations(d1, runId)).toBe(1); // reservation row exists, released
  });

  it('all-tasks-failed response releases and throws', async () => {
    const { ctx, d1, runId } = await buildCtx();
    stubFetchJson(failedResponse('Invalid Field.', 0.01));

    await expect(blueprintDfsCall(ctx, baseSpec)).rejects.toBeInstanceOf(BlueprintApiError);

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(0);
  });

  it('retry after a released reservation reserves fresh (attempt-scoped keys), no stage_conflict', async () => {
    const { ctx, d1, runId } = await buildCtx();

    stubFetchThrow(new Error('request timed out'));
    await expect(blueprintDfsCall({ ...ctx, attempt: 1 }, baseSpec)).rejects.toMatchObject({
      code: 'provider_timeout',
    });

    stubFetchJson(okResponse([{ keyword: 'retry win' }], 0.07));
    const result = await blueprintDfsCall({ ...ctx, attempt: 2 }, baseSpec);

    expect(result.cacheStatus).toBe('miss');
    expect(result.costUsdMicro).toBe(dollarsToMicro(0.07));

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(dollarsToMicro(0.07));

    const rows = await d1
      .prepare(
        `SELECT operation_key, status FROM provider_budget_reservations WHERE run_id = ? ORDER BY operation_key`
      )
      .bind(runId)
      .all<{ operation_key: string; status: string }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0].operation_key).toBe('keyword_ideas:scope-1:a1');
    expect(rows.results[0].status).toBe('released');
    expect(rows.results[1].operation_key).toBe('keyword_ideas:scope-1:a2');
    expect(rows.results[1].status).toBe('reconciled');
  });

  it('paid call with an empty tasks array throws provider_invalid_response and releases', async () => {
    const { ctx, d1, runId } = await buildCtx();
    stubFetchJson({ status_code: 20000, tasks: [] });

    await expect(blueprintDfsCall(ctx, baseSpec)).rejects.toMatchObject({
      code: 'provider_invalid_response',
    });

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(0);
    const row = await d1
      .prepare(`SELECT status FROM provider_budget_reservations WHERE run_id = ?`)
      .bind(runId)
      .first<{ status: string }>();
    expect(row?.status).toBe('released');
  });

  it('provider_usage.stage records ctx.stage, not spec.operation', async () => {
    const { ctx, d1, runId } = await buildCtx();
    stubFetchJson(okResponse([{ keyword: 'x' }], 0.05));

    await blueprintDfsCall(ctx, baseSpec);

    const row = await d1
      .prepare(`SELECT stage, operation FROM provider_usage WHERE run_id = ?`)
      .bind(runId)
      .first<{ stage: string; operation: string }>();
    expect(row?.stage).toBe('collect_keyword_evidence');
    expect(row?.operation).toBe('keyword_ideas');
  });

  it('a catalog-shaped response (flat records in result, no items) caches under ttlSeconds, not emptyTtlSeconds', async () => {
    const { ctx } = await buildCtx();
    const catalogSpec: DfsCallSpec = {
      method: 'GET',
      endpoint: '/serp/google/languages',
      ttlSeconds: 604_800,
      emptyTtlSeconds: 21_600,
      kind: 'serp_snapshot',
      operation: 'serp_languages_catalog',
      scopeId: 'catalog',
      estimateUsdMicro: 0,
    };
    // Real catalog/reference endpoints return each record directly in
    // tasks[].result -- there is NO per-record `items` wrapper, so
    // parsed.items is empty while parsed.results holds the records. The TTL
    // selector must treat that as a NON-empty response (7d), not an empty
    // one (6h).
    stubFetchJson({
      status_code: 20000,
      tasks: [
        {
          id: 'task-1',
          status_code: 20000,
          status_message: 'Ok.',
          cost: 0,
          result: [
            { language_code: 'en', language_name: 'English' },
            { language_code: 'es', language_name: 'Spanish' },
          ],
        },
      ],
    });

    const result = await blueprintDfsCall(ctx, catalogSpec);
    expect(result.items).toEqual([]);
    expect(result.results).toHaveLength(2);

    const kvPuts = (ctx.env as any).kvPuts as Array<{ key: string; options?: { expirationTtl?: number } }>;
    const cachePut = kvPuts.find((p) => p.key.startsWith('bp:dfs:'));
    expect(cachePut).toBeTruthy();
    expect(cachePut!.options?.expirationTtl).toBe(604_800);
  });

  it('a genuinely empty response (no items AND no results) caches under emptyTtlSeconds', async () => {
    const { ctx } = await buildCtx();
    const catalogSpec: DfsCallSpec = {
      method: 'GET',
      endpoint: '/serp/google/languages',
      ttlSeconds: 604_800,
      emptyTtlSeconds: 21_600,
      kind: 'serp_snapshot',
      operation: 'serp_languages_catalog',
      scopeId: 'catalog',
      estimateUsdMicro: 0,
    };
    stubFetchJson({
      status_code: 20000,
      tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost: 0, result: [] }],
    });

    await blueprintDfsCall(ctx, catalogSpec);

    const kvPuts = (ctx.env as any).kvPuts as Array<{ key: string; options?: { expirationTtl?: number } }>;
    const cachePut = kvPuts.find((p) => p.key.startsWith('bp:dfs:'));
    expect(cachePut).toBeTruthy();
    expect(cachePut!.options?.expirationTtl).toBe(21_600);
  });

  it('a call with estimateUsdMicro: 0 never touches budget tables', async () => {
    const { ctx, d1, runId } = await buildCtx();
    const freeSpec: DfsCallSpec = {
      method: 'GET',
      endpoint: '/serp/google/locations',
      ttlSeconds: 86400,
      emptyTtlSeconds: 3600,
      kind: 'serp_snapshot',
      operation: 'locations_catalog',
      scopeId: 'catalog',
      estimateUsdMicro: 0,
    };
    stubFetchJson(okResponse([{ location_code: 1023191 }], 0));

    const result = await blueprintDfsCall(ctx, freeSpec);

    expect(result.evidenceRefId).toBeNull();
    expect(await countReservations(d1, runId)).toBe(0);
    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(0);
  });
});
