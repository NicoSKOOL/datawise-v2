import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import { BlueprintApiError } from '../../domain/api-errors';
import { BlueprintValidationError } from '../../domain/errors';
import type { StageContext } from '../../orchestration/handlers';
import type { NormalizedProjectBrief } from '../../contracts/types';
import { resolveMarket } from './catalogs';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Real DataForSEO catalog/reference-endpoint shape: `result` is a flat array
// of records, NOT wrapped per-entry in an `items` field (unlike the "live"
// task endpoints). blueprintDfsCall's `.results` is what surfaces this.
function catalogResponse(records: unknown[], cost = 0) {
  return {
    status_code: 20000,
    tasks: [{ id: 'task-1', status_code: 20000, status_message: 'Ok.', cost, result: records }],
  };
}

const LABS_COUNTRIES = [
  {
    location_code: 2840,
    location_name: 'United States',
    country_iso_code: 'US',
    location_type: 'Country',
    languages: [{ language_code: 'en', language_name: 'English' }],
  },
];

const SERP_LOCATIONS_US = [
  { location_code: 2840, location_name: 'United States', country_iso_code: 'US', location_type: 'Country' },
  {
    location_code: 1023191,
    location_name: 'Austin,Texas,United States',
    country_iso_code: 'US',
    location_type: 'City',
  },
];

const SERP_LANGUAGES = [
  { language_code: 'en', language_name: 'English' },
  { language_code: 'es', language_name: 'Spanish' },
];

// Routes each GET to the right canned catalog payload by endpoint suffix, so
// a single fetch stub can serve all three calls resolveMarket makes.
function stubCatalogFetches(overrides: Partial<{ labs: unknown; serpLocations: unknown; serpLanguages: unknown }> = {}) {
  const labs = overrides.labs ?? catalogResponse(LABS_COUNTRIES);
  const serpLocations = overrides.serpLocations ?? catalogResponse(SERP_LOCATIONS_US);
  const serpLanguages = overrides.serpLanguages ?? catalogResponse(SERP_LANGUAGES);

  globalThis.fetch = (async (url: any) => {
    const href = String(url);
    if (href.includes('/dataforseo_labs/locations_and_languages')) {
      return { ok: true, status: 200, json: async () => labs } as any;
    }
    if (href.includes('/serp/google/locations/')) {
      return { ok: true, status: 200, json: async () => serpLocations } as any;
    }
    if (href.includes('/serp/google/languages')) {
      return { ok: true, status: 200, json: async () => serpLanguages } as any;
    }
    throw new Error(`unexpected fetch: ${href}`);
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

function makeBrief(overrides: Partial<NormalizedProjectBrief> = {}): NormalizedProjectBrief {
  return {
    mode: 'greenfield',
    businessName: 'Aqua Plumbing',
    normalizedBusinessName: 'aqua plumbing',
    category: 'Plumber',
    websiteDomain: null,
    websiteUrl: null,
    countryIso: 'US',
    languageCode: 'en',
    services: [],
    serviceAreas: [
      { id: 'a1', city: 'Austin', region: null, countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: [] },
    ],
    targetCustomers: [],
    differentiators: [],
    knownCompetitorDomains: [],
    excludedDomains: [],
    excludedTopics: [],
    goals: ['leads'],
    maxRecommendedPages: 50,
    enableUsFanout: false,
    inputHash: 'hash1',
    ...overrides,
  };
}

async function buildCtx(briefOverrides: Partial<NormalizedProjectBrief> = {}) {
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
    normalizedBrief: makeBrief(briefOverrides),
    stage: 'resolve_market',
    attempt: 1,
  };
  return { ctx, d1, runId, projectId };
}

describe('resolveMarket', () => {
  it('resolves a matching city to its SERP location code', async () => {
    const { ctx } = await buildCtx();
    stubCatalogFetches();

    const market = await resolveMarket(ctx);

    expect(market.labsLocationCode).toBe(2840);
    expect(market.languageCode).toBe('en');
    expect(market.fallbackSerpLocationCode).toBe(2840);
    expect(market.serpLocations).toEqual([
      { serviceAreaId: 'a1', locationCode: 1023191, locationName: 'Austin,Texas,United States' },
    ]);
    expect(market.unresolvedAreaIds).toEqual([]);
  });

  it('lands an unmatched area in unresolvedAreaIds and still reports the country fallback code', async () => {
    const { ctx } = await buildCtx({
      serviceAreas: [
        { id: 'a1', city: 'Nowhereville', region: null, countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: [] },
      ],
    });
    stubCatalogFetches();

    const market = await resolveMarket(ctx);

    expect(market.serpLocations).toEqual([]);
    expect(market.unresolvedAreaIds).toEqual(['a1']);
    expect(market.fallbackSerpLocationCode).toBe(2840);
  });

  it('throws BlueprintValidationError when the language is not in the SERP languages catalog', async () => {
    const { ctx } = await buildCtx({ languageCode: 'de' });
    stubCatalogFetches();

    await expect(resolveMarket(ctx)).rejects.toBeInstanceOf(BlueprintValidationError);
  });

  it('throws provider_invalid_response when the labs catalog has no matching country', async () => {
    const { ctx } = await buildCtx();
    stubCatalogFetches({ labs: catalogResponse([]) });

    await expect(resolveMarket(ctx)).rejects.toMatchObject({
      code: 'provider_invalid_response',
    });
  });

  it('throws provider_invalid_response (via BlueprintApiError) when the SERP locations catalog has no country entry', async () => {
    const { ctx } = await buildCtx();
    stubCatalogFetches({ serpLocations: catalogResponse(SERP_LOCATIONS_US.filter((e) => e.location_type !== 'Country')) });

    const err = await resolveMarket(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintApiError);
    expect((err as BlueprintApiError).code).toBe('provider_invalid_response');
  });

  it('prefers a City-type match over an earlier non-City match with the same name prefix', async () => {
    const { ctx } = await buildCtx();
    stubCatalogFetches({
      serpLocations: catalogResponse([
        { location_code: 2840, location_name: 'United States', country_iso_code: 'US', location_type: 'Country' },
        // Region entry sorted before the City entry: match-picking must still prefer City.
        { location_code: 9999, location_name: 'Austin Region', country_iso_code: 'US', location_type: 'Region' },
        { location_code: 1023191, location_name: 'Austin,Texas,United States', country_iso_code: 'US', location_type: 'City' },
      ]),
    });

    const market = await resolveMarket(ctx);

    expect(market.serpLocations).toEqual([
      { serviceAreaId: 'a1', locationCode: 1023191, locationName: 'Austin,Texas,United States' },
    ]);
  });
});
