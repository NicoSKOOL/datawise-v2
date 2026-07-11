import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import type { StageContext } from '../../orchestration/handlers';
import type { ResolvedMarket } from './catalogs';
import type { DfsCostEstimates } from './costs';
import {
  discoverCompetitorsForDomain,
  discoverSerpCompetitors,
  filterCompetitorCandidates,
  EXCLUDED_COMPETITOR_DOMAINS,
} from './competitors';
import type { CompetitorCandidate } from './competitors';

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
    stage: 'discover_competitors',
    attempt: 1,
  };
}

function candidate(overrides: Partial<CompetitorCandidate> = {}): CompetitorCandidate {
  return {
    domain: 'rival.com',
    visibilityMetric: 10,
    source: 'competitors_domain',
    evidenceRefId: 'evr_1',
    ...overrides,
  };
}

describe('discoverCompetitorsForDomain', () => {
  it('issues exactly one blueprintDfsCall with the Sec 7 verbatim body and normalizes intersections as visibilityMetric', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(
      okResponse([{ domain: 'rival-plumbing.com', intersections: 42 }])
    );

    const candidates = await discoverCompetitorsForDomain(ctx, MARKET, 'aquaplumbing.com', COSTS);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/dataforseo_labs/google/competitors_domain/live');
    expect(calls[0].body).toMatchObject({
      target: 'aquaplumbing.com',
      location_code: 2840,
      language_code: 'en',
      exclude_top_domains: true,
      max_rank_group: 20,
      limit: 20,
    });
    expect(calls[0].body.tag).toMatch(/^run:/);
    expect(candidates).toEqual([
      {
        domain: 'rival-plumbing.com',
        visibilityMetric: 42,
        source: 'competitors_domain',
        evidenceRefId: candidates[0].evidenceRefId,
      },
    ]);
  });

  it('leaves visibilityMetric null when intersections is absent, never coerced to 0', async () => {
    const ctx = await buildCtx();
    stubFetchCapturing(okResponse([{ domain: 'rival.com' }]));

    const candidates = await discoverCompetitorsForDomain(ctx, MARKET, 'aquaplumbing.com', COSTS);

    expect(candidates[0].visibilityMetric).toBeNull();
  });
});

describe('discoverSerpCompetitors', () => {
  it('issues exactly one blueprintDfsCall with the Sec 8 verbatim body and negates avg_position as visibilityMetric', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(
      okResponse([{ domain: 'rival-hvac.com', avg_position: 4.5 }])
    );

    const candidates = await discoverSerpCompetitors(
      ctx,
      MARKET,
      ['ac repair austin', 'hvac installation austin'],
      COSTS
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/dataforseo_labs/google/serp_competitors/live');
    expect(calls[0].body).toMatchObject({
      keywords: ['ac repair austin', 'hvac installation austin'],
      location_code: 2840,
      language_code: 'en',
      include_subdomains: false,
      item_types: ['organic', 'local_pack'],
      limit: 20,
    });
    expect(calls[0].body.tag).toMatch(/^run:/);
    expect(candidates[0]).toEqual({
      domain: 'rival-hvac.com',
      visibilityMetric: -4.5,
      source: 'serp_competitors',
      evidenceRefId: candidates[0].evidenceRefId,
    });
  });

  it('caps keywords at 200 per task', async () => {
    const ctx = await buildCtx();
    const calls = stubFetchCapturing(okResponse([]));
    const keywords = Array.from({ length: 250 }, (_, i) => `seed ${i}`);

    await discoverSerpCompetitors(ctx, MARKET, keywords, COSTS);

    expect(calls[0].body.keywords).toHaveLength(200);
  });

  it('leaves visibilityMetric null when avg_position is absent', async () => {
    const ctx = await buildCtx();
    stubFetchCapturing(okResponse([{ domain: 'rival.com' }]));

    const candidates = await discoverSerpCompetitors(ctx, MARKET, ['ac repair austin'], COSTS);

    expect(candidates[0].visibilityMetric).toBeNull();
  });
});

describe('filterCompetitorCandidates', () => {
  it('drops excluded directory/social/aggregator domains, including subdomain matches', () => {
    const candidates = [
      candidate({ domain: 'yelp.com' }),
      candidate({ domain: 'm.yelp.com' }),
      candidate({ domain: 'realplumbingco.com' }),
    ];

    const filtered = filterCompetitorCandidates(candidates, null);

    expect(filtered.map((c) => c.domain)).toEqual(['realplumbingco.com']);
  });

  it('drops the project own domain', () => {
    const candidates = [candidate({ domain: 'aquaplumbing.com' }), candidate({ domain: 'rival.com' })];

    const filtered = filterCompetitorCandidates(candidates, 'aquaplumbing.com');

    expect(filtered.map((c) => c.domain)).toEqual(['rival.com']);
  });

  it('drops duplicate domains, keeping the first occurrence', () => {
    const candidates = [
      candidate({ domain: 'rival.com', visibilityMetric: 10 }),
      candidate({ domain: 'rival.com', visibilityMetric: 99 }),
    ];

    const filtered = filterCompetitorCandidates(candidates, null);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].visibilityMetric).toBe(10);
  });

  it('covers every EXCLUDED_COMPETITOR_DOMAINS entry from the brief', () => {
    expect([...EXCLUDED_COMPETITOR_DOMAINS].sort()).toEqual(
      [
        'yelp.com',
        'facebook.com',
        'instagram.com',
        'linkedin.com',
        'angi.com',
        'thumbtack.com',
        'houzz.com',
        'bbb.org',
        'yellowpages.com',
        'wikipedia.org',
        'reddit.com',
        'amazon.com',
        'homeadvisor.com',
        'nextdoor.com',
        'mapquest.com',
        'tripadvisor.com',
      ].sort()
    );
  });
});
