import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import { collectKeywordEvidenceHandler } from './research-handlers';
import type { StageHandler, StageContext } from './handlers';
import type { BlueprintStage } from '../contracts/enums';
import { BlueprintApiError } from '../domain/api-errors';
import type { ResolvedMarket } from '../providers/dataforseo/catalogs';

// This is the same STAGE_HANDLERS-driven approach process-run.test.ts and
// acceptance.e2e.test.ts already use: drive the real registry through
// processResearchRun so completeStage really runs (needed to prove the
// research_stage_runs.cost_usd_micro forwarding this task adds), overriding
// only resolve_market (the one real Task 8 handler that would otherwise hit
// the network) with a canned ResolvedMarket. loadStageOutput has no
// dependency on stage_input_hash, so this override is equivalent to
// "resolve_market's output is pre-seeded" for collect_keyword_evidence's
// purposes while staying inside the established override pattern instead of
// hand-deriving a stage_input_hash.

const MARKET: ResolvedMarket = {
  labsLocationCode: 2840,
  languageCode: 'en',
  serpLocations: [{ serviceAreaId: 'a1', locationCode: 1023191, locationName: 'Austin,Texas,United States' }],
  fallbackSerpLocationCode: 2840,
  unresolvedAreaIds: [],
};

const SAMPLE_BRIEF_INPUT = {
  businessName: 'Aqua Plumbing',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'en',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning', priority: 'secondary' as const },
  ],
  serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true }],
};

function providerFields(): Pick<BlueprintProviderEnv, 'KV' | 'BLUEPRINT_ARTIFACTS' | 'DATAFORSEO_EMAIL' | 'DATAFORSEO_PASSWORD'> {
  return {
    KV: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    } as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: {
      put: async () => undefined,
      get: async () => null,
    } as unknown as R2Bucket,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
  };
}

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, 'org1', 'u1', 'Aqua Plumbing', 'existing_site', 'US', 'en', nowIso(), nowIso())
    .run();
  return id;
}

async function seedBriefVersion(d1: D1Database, projectId: string): Promise<string> {
  const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
  const normalized = await normalizeProjectBrief(parsed, V1_LIMITS);
  const id = newId('briefv');
  await d1
    .prepare(
      `INSERT INTO project_brief_versions (id, project_id, version_number, input_json, normalized_json, input_hash, created_by, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, JSON.stringify(SAMPLE_BRIEF_INPUT), JSON.stringify(normalized), normalized.inputHash, 'u1', nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string, briefVersionId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status,
         dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, ?, ?, 'queued', 2000000, 0, 'u1', ?)`
    )
    .bind(id, projectId, briefVersionId, 'estimate1', nowIso())
    .run();
  return id;
}

function makeQueue() {
  const sent: unknown[] = [];
  return { sent, queue: { send: async (body: unknown) => { sent.push(body); } } };
}

function okResponse(items: any[], cost: number) {
  return {
    status_code: 20000,
    tasks: [{ id: 't1', status_code: 20000, status_message: 'Ok.', cost, result: [{ items }] }],
  };
}

// Dispatches by endpoint (and, for keyword_suggestions, by the requested
// seed keyword) so each of the six Labs calls this run makes gets a
// deliberately distinct, hand-picked canned response:
//  - keyword_ideas returns 'emergency plumbing austin' with volume+cpc but
//    no difficulty (needs bulk_keyword_difficulty enrichment).
//  - keyword_suggestions for that same seed echoes it back (proves
//    cross-source merge/dedup); the other primary-area seed
//    ('drain cleaning austin') gets an empty response, so it survives only
//    via the user-seed retention rule.
//  - keywords_for_site returns a fully-populated, unrelated keyword.
//  - keyword_overview (volume enrichment) returns nothing: every keyword
//    still missing volume after merge (all 4 user-seed fallbacks) stays
//    genuinely null.
//  - bulk_keyword_difficulty fills 'emergency plumbing austin''s missing
//    difficulty only.
function installKeywordFetchStub(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    const href = String(url);
    const body = init?.body ? JSON.parse(init.body)[0] : {};
    if (href.includes('/dataforseo_labs/google/keyword_ideas/live')) {
      return {
        ok: true,
        status: 200,
        json: async () => okResponse([{ keyword: 'emergency plumbing austin', keyword_info: { search_volume: 500, cpc: 4.2 } }], 0.05),
      } as any;
    }
    if (href.includes('/dataforseo_labs/google/keyword_suggestions/live')) {
      if (body.keyword === 'emergency plumbing austin') {
        return {
          ok: true,
          status: 200,
          json: async () => okResponse([{ keyword: 'emergency plumbing austin', keyword_info: { search_volume: 500 } }], 0.02),
        } as any;
      }
      return { ok: true, status: 200, json: async () => okResponse([], 0.02) } as any;
    }
    if (href.includes('/dataforseo_labs/google/keywords_for_site/live')) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          okResponse(
            [
              {
                keyword: 'plumbing repair',
                keyword_info: { search_volume: 300, cpc: 2.5 },
                keyword_properties: { keyword_difficulty: 45 },
              },
            ],
            0.03
          ),
      } as any;
    }
    if (href.includes('/dataforseo_labs/google/keyword_overview/live')) {
      return { ok: true, status: 200, json: async () => okResponse([], 0.01) } as any;
    }
    if (href.includes('/dataforseo_labs/google/bulk_keyword_difficulty/live')) {
      return {
        ok: true,
        status: 200,
        json: async () => okResponse([{ keyword: 'emergency plumbing austin', keyword_difficulty: 61 }], 0.02),
      } as any;
    }
    throw new Error(`installKeywordFetchStub: unexpected fetch to ${href}`);
  }) as any;
  return () => {
    globalThis.fetch = original;
  };
}

describe('collectKeywordEvidenceHandler (via processResearchRun)', () => {
  let restoreFetch: () => void;
  afterEach(() => {
    restoreFetch?.();
  });

  it('persists a deduped, evidence-backed keyword universe with correct null metrics and stage cost', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    restoreFetch = installKeywordFetchStub();

    const { sent, queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async () => ({ output: MARKET, status: 'succeeded' as const }),
    };

    // Drive: validate_intake -> resolve_market (override) -> normalize_brief
    // -> plan_research -> collect_keyword_evidence (real) -> ... to
    // whatever terminal status the remaining Phase 2 stub stages settle on.
    await processResearchRun(env, runId, 'w1', overrides);
    while (sent.length) {
      sent.pop();
      await processResearchRun(env, runId, 'w1', overrides);
    }

    const stageRow = await d1
      .prepare(`SELECT status, output_json, cost_usd_micro FROM research_stage_runs WHERE run_id = ? AND stage_name = ?`)
      .bind(runId, 'collect_keyword_evidence')
      .first<{ status: string; output_json: string; cost_usd_micro: number }>();
    expect(stageRow?.status).toBe('succeeded');
    const output = JSON.parse(stageRow!.output_json);

    // candidateCount: 1 (ideas) + 1 (suggestions for 'emergency plumbing
    // austin') + 0 (suggestions for 'drain cleaning austin') + 1 (site) = 3.
    expect(output.candidateCount).toBe(3);
    expect(output.sources).toEqual({ keyword_ideas: 1, keyword_suggestions: 1, keywords_for_site: 1 });
    expect(output.enrichmentTruncated).toBe(false);

    // mergedCount: 2 provider-sourced keywords ('emergency plumbing austin',
    // 'plumbing repair') + 4 user-seed fallbacks ('plumber',
    // 'emergency plumbing', 'drain cleaning', 'drain cleaning austin') = 6.
    expect(output.mergedCount).toBe(6);
    expect(output.persistedCount).toBe(6);

    // Stage cost is the sum of all 6 real DFS calls this handler made:
    // 0.05 (ideas) + 0.02 + 0.02 (two suggestions calls) + 0.03 (site) +
    // 0.01 (overview) + 0.02 (bulk_kd) = 0.15 USD = 150,000 micro. This is
    // the Task 10 completeStage-forwarding contract: the processor writes
    // the handler's own reported stageCostUsdMicro onto the stage row.
    expect(output.stageCostUsdMicro).toBe(150_000);
    expect(stageRow?.cost_usd_micro).toBe(150_000);

    const keywordRows = raw
      .prepare(`SELECT id, normalized_keyword, display_keyword, search_volume, cpc_usd_micro, keyword_difficulty, metrics_missing FROM keywords WHERE run_id = ?`)
      .all(runId) as Array<{
      id: string;
      normalized_keyword: string;
      display_keyword: string;
      search_volume: number | null;
      cpc_usd_micro: number | null;
      keyword_difficulty: number | null;
      metrics_missing: number;
    }>;
    expect(keywordRows.length).toBe(6);

    // Cross-source dedup: 'emergency plumbing austin' came back from BOTH
    // keyword_ideas and keyword_suggestions, but UNIQUE(run_id,
    // normalized_keyword) + the merge step collapse it to exactly one row,
    // fully enriched (bulk_kd filled its missing difficulty).
    const merged = keywordRows.filter((r) => r.normalized_keyword === 'emergency plumbing austin');
    expect(merged.length).toBe(1);
    expect(merged[0].search_volume).toBe(500);
    expect(merged[0].cpc_usd_micro).toBe(4_200_000);
    expect(merged[0].keyword_difficulty).toBe(61);
    expect(merged[0].metrics_missing).toBe(0);

    // The keywords_for_site candidate persisted with all metrics intact.
    const site = keywordRows.find((r) => r.normalized_keyword === 'plumbing repair');
    expect(site?.search_volume).toBe(300);
    expect(site?.cpc_usd_micro).toBe(2_500_000);
    expect(site?.keyword_difficulty).toBe(45);
    expect(site?.metrics_missing).toBe(0);

    // User seed with zero provider data anywhere ('drain cleaning austin',
    // the OTHER primary-area seed, whose suggestions call came back empty
    // and which the ideas/overview/bulk_kd canned responses never mention)
    // still gets a row: real NULLs via a raw SQL check (never silently
    // coerced to 0), metrics_missing = 1.
    const userSeedRow = raw
      .prepare(
        `SELECT search_volume, cpc_usd_micro, keyword_difficulty, metrics_missing, display_keyword
         FROM keywords WHERE run_id = ? AND normalized_keyword = 'drain cleaning austin'`
      )
      .get(runId) as
      | { search_volume: null; cpc_usd_micro: null; keyword_difficulty: null; metrics_missing: number; display_keyword: string }
      | undefined;
    expect(userSeedRow).toBeTruthy();
    expect(userSeedRow!.search_volume).toBeNull();
    expect(userSeedRow!.cpc_usd_micro).toBeNull();
    expect(userSeedRow!.keyword_difficulty).toBeNull();
    expect(userSeedRow!.metrics_missing).toBe(1);
    expect(userSeedRow!.display_keyword).toBe('drain cleaning austin');

    // Every other bare-seed fallback ('plumber', 'emergency plumbing',
    // 'drain cleaning') is present too, with the same all-null shape.
    for (const normalizedKeyword of ['plumber', 'emergency plumbing', 'drain cleaning']) {
      const row = keywordRows.find((r) => r.normalized_keyword === normalizedKeyword);
      expect(row).toBeTruthy();
      expect(row!.search_volume).toBeNull();
      expect(row!.cpc_usd_micro).toBeNull();
      expect(row!.keyword_difficulty).toBeNull();
      expect(row!.metrics_missing).toBe(1);
    }

    // keyword_evidence_refs: the merged provider-sourced keyword carries
    // evidence from all three calls that touched it (ideas, suggestions,
    // bulk_kd); the user-seed fallbacks carry none (there is no evidence to
    // attach, and the retention rule 'is not a mistake).
    const mergedEvidence = raw
      .prepare(`SELECT evidence_ref_id FROM keyword_evidence_refs WHERE keyword_id = ?`)
      .all(merged[0].id) as Array<{ evidence_ref_id: string }>;
    expect(mergedEvidence.length).toBeGreaterThan(0);
    expect(new Set(mergedEvidence.map((r) => r.evidence_ref_id)).size).toBe(mergedEvidence.length);

    const totalEvidenceRefRows = raw.prepare(`SELECT COUNT(*) AS n FROM keyword_evidence_refs`).get() as { n: number };
    expect(totalEvidenceRefRows.n).toBeGreaterThan(0);

    // keyword_services / keyword_service_areas: provenance from the seed
    // that produced the merged keyword ('emergency plumbing austin' came
    // from service s1 in area a1).
    const keywordId = merged[0].id;
    const services = raw.prepare(`SELECT service_id FROM keyword_services WHERE keyword_id = ?`).all(keywordId) as Array<{
      service_id: string;
    }>;
    expect(services.map((s) => s.service_id)).toEqual(['s1']);
    const areas = raw.prepare(`SELECT service_area_id FROM keyword_service_areas WHERE keyword_id = ?`).all(keywordId) as Array<{
      service_area_id: string;
    }>;
    expect(areas.map((a) => a.service_area_id)).toEqual(['a1']);
  });

  it('throws provider_invalid_response when resolve_market has no output to read', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);

    const ctx: StageContext = {
      env: { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: { send: async () => undefined }, ...providerFields() } as any,
      d1,
      runId,
      projectId,
      briefVersionId,
      normalizedBrief,
      stage: 'collect_keyword_evidence',
      attempt: 1,
    };

    // No resolve_market stage row exists at all for this run (a state that
    // should never occur in a healthy run, since it's a required stage that
    // always runs first) -- loadStageOutput returns null and the handler
    // must fail loudly rather than proceed with an undefined market.
    await expect(collectKeywordEvidenceHandler(ctx)).rejects.toMatchObject({
      code: 'provider_invalid_response',
    } satisfies Partial<BlueprintApiError>);
  });
});
