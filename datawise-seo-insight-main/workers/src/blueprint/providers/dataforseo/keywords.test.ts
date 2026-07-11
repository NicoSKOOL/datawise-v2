import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import type { StageContext } from '../../orchestration/handlers';
import type { MergedKeyword, KeywordUniverse } from '../../contracts/types';
import type { ResolvedMarket } from './catalogs';
import type { DfsCostEstimates } from './costs';
import {
  fetchKeywordIdeas,
  fetchKeywordSuggestions,
  fetchKeywordsForSite,
  enrichMissingMetrics,
} from './keywords';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const COSTS: DfsCostEstimates = { labsTaskUsdMicro: 50_000, serpTaskUsdMicro: 10_000 };

const MARKET: ResolvedMarket = {
  labsLocationCode: 2840,
  languageCode: 'en',
  serpLocations: [],
  fallbackSerpLocationCode: 2840,
  unresolvedAreaIds: [],
};

function okResponse(items: any[], cost = 0.05) {
  return {
    status_code: 20000,
    tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost, result: [{ items }] }],
  };
}

interface CapturedCall {
  url: string;
  body: any; // parsed JSON body of the single task object (init.body[0])
}

// Captures every outbound fetch call and always answers with `response`
// (or, if an array is given, one response per call in order).
function stubFetchCapturing(response: any | any[]): CapturedCall[] {
  const calls: CapturedCall[] = [];
  let callIndex = 0;
  globalThis.fetch = (async (url: any, init?: any) => {
    const parsedBody = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body: Array.isArray(parsedBody) ? parsedBody[0] : parsedBody });
    const resolved = Array.isArray(response) ? response[callIndex] : response;
    callIndex += 1;
    return { ok: true, status: 200, json: async () => resolved } as any;
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
    .bind(id, 'org1', 'user1', 'Test Project', 'greenfield', 'US', 'en', nowIso(), nowIso())
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

function fakeProviderEnv() {
  const kv = new Map<string, string>();
  const artifacts = new Map<string, string>();
  return {
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => {
        kv.set(k, v);
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

async function buildCtx(): Promise<StageContext> {
  const { d1 } = createTestDb();
  const projectId = await seedProject(d1);
  const runId = await seedRun(d1, projectId);
  const env = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: { send: async () => undefined }, ...fakeProviderEnv() };
  return {
    env: env as any,
    d1,
    runId,
    projectId,
    briefVersionId: 'brief1',
    normalizedBrief: {} as any,
    stage: 'collect_keyword_evidence',
    attempt: 1,
  };
}

function mergedKeyword(overrides: Partial<MergedKeyword> = {}): MergedKeyword {
  return {
    normalizedKeyword: 'ac repair austin',
    variants: ['AC Repair Austin'],
    sources: ['keyword_ideas'],
    metrics: { searchVolume: null, cpcUsd: null, difficulty: null },
    evidenceRefs: ['evr_seed'],
    ...overrides,
  };
}

describe('fetchKeywordIdeas', () => {
  it('issues exactly one blueprintDfsCall with the verbatim keyword_ideas body', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(
      okResponse([{ keyword: 'ac repair austin', keyword_info: { search_volume: 100 } }])
    );

    const candidates = await fetchKeywordIdeas(ctx, MARKET, ['ac repair', 'hvac installation'], COSTS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/dataforseo_labs/google/keyword_ideas/live');
    expect(calls[0].body).toMatchObject({
      keywords: ['ac repair', 'hvac installation'],
      location_code: 2840,
      language_code: 'en',
      closely_variants: false,
      ignore_synonyms: false,
      include_serp_info: true,
      limit: 500,
    });
    expect(calls[0].body.tag).toMatch(/^run:/);
    expect(candidates).toEqual([
      {
        keyword: 'ac repair austin',
        source: 'keyword_ideas',
        metrics: { searchVolume: 100, cpcUsd: null, difficulty: null },
        evidenceRefs: [candidates[0].evidenceRefs[0]],
      },
    ]);
  });

  it('caps seeds at 200 per task', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(okResponse([]));
    const seeds = Array.from({ length: 250 }, (_, i) => `seed ${i}`);

    await fetchKeywordIdeas(ctx, MARKET, seeds, COSTS);

    expect(calls[0].body.keywords).toHaveLength(200);
  });
});

describe('fetchKeywordSuggestions', () => {
  it('issues exactly one blueprintDfsCall with the verbatim suggestions body for the given seed', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(
      okResponse([{ keyword: 'ac repair austin tx', keyword_info: { search_volume: 40 } }])
    );

    const candidates = await fetchKeywordSuggestions(
      ctx,
      MARKET,
      { query: 'ac repair austin', serviceId: 'svc1' },
      COSTS
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/dataforseo_labs/google/keyword_suggestions/live');
    expect(calls[0].body).toMatchObject({
      keyword: 'ac repair austin',
      location_code: 2840,
      language_code: 'en',
      include_seed_keyword: true,
      include_serp_info: true,
      ignore_synonyms: false,
      limit: 100,
    });
    expect(calls[0].body.tag).toMatch(/^run:/);
    expect(candidates[0].source).toBe('keyword_suggestions');
  });
});

describe('fetchKeywordsForSite', () => {
  it('issues exactly one blueprintDfsCall with the verbatim keywords_for_site body', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(
      okResponse([{ keyword: 'plumber austin', keyword_info: { search_volume: 200 } }])
    );

    const candidates = await fetchKeywordsForSite(ctx, MARKET, 'example.com', COSTS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/dataforseo_labs/google/keywords_for_site/live');
    expect(calls[0].body).toMatchObject({
      target: 'example.com',
      location_code: 2840,
      language_code: 'en',
      include_subdomains: true,
      include_serp_info: true,
      limit: 200,
    });
    expect(calls[0].body.tag).toMatch(/^run:/);
    expect(candidates[0].source).toBe('keywords_for_site');
  });
});

describe('enrichMissingMetrics', () => {
  it('makes zero calls and returns the universe unchanged when nothing is missing', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(okResponse([]));
    const universe: KeywordUniverse = {
      keywords: [mergedKeyword({ metrics: { searchVolume: 100, cpcUsd: 2, difficulty: 30 } })],
    };

    const { universe: result, enrichmentTruncated } = await enrichMissingMetrics(ctx, MARKET, universe, COSTS);

    expect(calls).toHaveLength(0);
    expect(result).toEqual(universe);
    expect(enrichmentTruncated).toBe(false);
  });

  it('fills only the missing field via keyword_overview, leaving an already-known difficulty untouched', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(
      okResponse([{ keyword: 'ac repair austin', keyword_info: { search_volume: 500, cpc: 3.1 } }])
    );
    const universe: KeywordUniverse = {
      keywords: [
        mergedKeyword({
          normalizedKeyword: 'ac repair austin',
          variants: ['AC Repair Austin'],
          metrics: { searchVolume: null, cpcUsd: null, difficulty: 25 },
        }),
      ],
    };

    const { universe: result } = await enrichMissingMetrics(ctx, MARKET, universe, COSTS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/dataforseo_labs/google/keyword_overview/live');
    expect(calls[0].body).toMatchObject({
      keywords: ['AC Repair Austin'],
      location_code: 2840,
      language_code: 'en',
    });
    expect(result.keywords[0].metrics).toEqual({ searchVolume: 500, cpcUsd: 3.1, difficulty: 25 });
  });

  it('fills only the missing difficulty via bulk_keyword_difficulty, leaving a known search volume untouched', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(
      okResponse([{ keyword: 'ac repair austin', keyword_difficulty: 61 }])
    );
    const universe: KeywordUniverse = {
      keywords: [
        mergedKeyword({
          normalizedKeyword: 'ac repair austin',
          variants: ['AC Repair Austin'],
          metrics: { searchVolume: 400, cpcUsd: 1.5, difficulty: null },
        }),
      ],
    };

    const { universe: result } = await enrichMissingMetrics(ctx, MARKET, universe, COSTS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/dataforseo_labs/google/bulk_keyword_difficulty/live');
    expect(calls[0].body).toMatchObject({
      keywords: ['AC Repair Austin'],
      location_code: 2840,
      language_code: 'en',
    });
    expect(result.keywords[0].metrics).toEqual({ searchVolume: 400, cpcUsd: 1.5, difficulty: 61 });
  });

  it('issues both enrichment calls when both metrics are missing, and keeps a still-unmatched keyword null', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing([
      okResponse([{ keyword: 'ac repair austin', keyword_info: { search_volume: 500 } }]),
      okResponse([{ keyword: 'ac repair austin', keyword_difficulty: 61 }]),
    ]);
    const universe: KeywordUniverse = {
      keywords: [
        mergedKeyword({
          normalizedKeyword: 'ac repair austin',
          variants: ['AC Repair Austin'],
          metrics: { searchVolume: null, cpcUsd: null, difficulty: null },
        }),
        mergedKeyword({
          normalizedKeyword: 'unrelated term',
          variants: ['Unrelated Term'],
          metrics: { searchVolume: null, cpcUsd: null, difficulty: null },
        }),
      ],
    };

    const { universe: result, enrichmentTruncated } = await enrichMissingMetrics(ctx, MARKET, universe, COSTS);

    expect(calls).toHaveLength(2);
    const acRepair = result.keywords.find((k) => k.normalizedKeyword === 'ac repair austin');
    expect(acRepair?.metrics).toEqual({ searchVolume: 500, cpcUsd: null, difficulty: 61 });
    const unrelated = result.keywords.find((k) => k.normalizedKeyword === 'unrelated term');
    expect(unrelated?.metrics).toEqual({ searchVolume: null, cpcUsd: null, difficulty: null });
    expect(enrichmentTruncated).toBe(false);
  });

  it('does not mutate the input universe', async () => {
    const ctx = await buildCtx();
    stubFetchCapturing(okResponse([{ keyword: 'ac repair austin', keyword_info: { search_volume: 500 } }]));
    const universe: KeywordUniverse = {
      keywords: [
        mergedKeyword({
          normalizedKeyword: 'ac repair austin',
          variants: ['AC Repair Austin'],
          metrics: { searchVolume: null, cpcUsd: null, difficulty: 10 },
        }),
      ],
    };

    await enrichMissingMetrics(ctx, MARKET, universe, COSTS);

    expect(universe.keywords[0].metrics.searchVolume).toBeNull();
  });

  it('flags enrichmentTruncated when more than 700 keywords are missing search volume', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(okResponse([]));
    const keywords: MergedKeyword[] = Array.from({ length: 701 }, (_, i) =>
      mergedKeyword({
        normalizedKeyword: `term ${i}`,
        variants: [`term ${i}`],
        metrics: { searchVolume: null, cpcUsd: null, difficulty: 10 },
      })
    );

    const { enrichmentTruncated } = await enrichMissingMetrics(ctx, MARKET, { keywords }, COSTS);

    expect(enrichmentTruncated).toBe(true);
    expect(calls[0].body.keywords).toHaveLength(700);
  });
});
