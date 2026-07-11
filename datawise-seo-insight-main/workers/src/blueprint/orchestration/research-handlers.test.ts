import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import {
  collectKeywordEvidenceHandler,
  discoverCompetitorsHandler,
  collectCompetitorEvidenceHandler,
  validateSerpsAndQuestionsHandler,
  buildSerpQueriesFromSeeds,
} from './research-handlers';
import type { StageHandler, StageContext } from './handlers';
import type { BlueprintStage } from '../contracts/enums';
import { BlueprintApiError } from '../domain/api-errors';
import type { ResolvedMarket } from '../providers/dataforseo/catalogs';
import { SerpTasksPendingError } from '../providers/dataforseo/serp';
import type { SeedQuery } from '../domain/seeds';

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

// discoverCompetitorsHandler is exercised directly (not via processResearchRun)
// because it has no dependency on stage_input_hash beyond loadStageOutput's
// read of resolve_market's output_json -- inserting that one row directly is
// enough to satisfy the handler, and avoids re-driving validate_intake ->
// plan_research just to reach this stage for every scenario below.
describe('discoverCompetitorsHandler', () => {
  let restoreFetch: (() => void) | undefined;
  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  async function seedMarketStage(d1: D1Database, runId: string): Promise<void> {
    await d1
      .prepare(
        `INSERT INTO research_stage_runs
          (id, run_id, stage_name, stage_input_hash, status, required, attempt_count, output_json, finished_at)
         VALUES (?, ?, 'resolve_market', 'hash-resolve-market', 'succeeded', 1, 1, ?, ?)`
      )
      .bind(newId('stagerun'), runId, JSON.stringify(MARKET), nowIso())
      .run();
  }

  function buildCompetitorCtx(
    d1: D1Database,
    runId: string,
    projectId: string,
    briefVersionId: string,
    normalizedBrief: StageContext['normalizedBrief']
  ): StageContext {
    return {
      env: { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: { send: async () => undefined }, ...providerFields() } as any,
      d1,
      runId,
      projectId,
      briefVersionId,
      normalizedBrief,
      stage: 'discover_competitors',
      attempt: 1,
    };
  }

  // Answers whichever Labs discovery endpoint the handler calls with the
  // items the test supplies, and asserts exactly one call was made -- the
  // handler must call ONE of competitors_domain/serp_competitors per mode,
  // never both.
  function stubDiscoveryFetch(items: any[]): { restore: () => void; capturedBodies: Array<{ href: string; body: any }> } {
    const original = globalThis.fetch;
    const capturedBodies: Array<{ href: string; body: any }> = [];
    globalThis.fetch = (async (url: any, init?: any) => {
      const href = String(url);
      const body = init?.body ? JSON.parse(init.body)[0] : {};
      capturedBodies.push({ href, body });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status_code: 20000,
          tasks: [{ id: 't1', status_code: 20000, status_message: 'Ok.', cost: 0.05, result: [{ items }] }],
        }),
      } as any;
    }) as any;
    return { restore: () => { globalThis.fetch = original; }, capturedBodies };
  }

  it('existing_site mode posts target, filters out an excluded domain and the own domain, and auto-selects the top 5 by visibilityMetric (desc, nulls last)', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    const { restore, capturedBodies } = stubDiscoveryFetch([
      { domain: 'yelp.com', intersections: 999 }, // excluded directory domain
      { domain: 'aquaplumbing.com', intersections: 500 }, // own domain
      { domain: 'd90.com', intersections: 90 },
      { domain: 'd70.com', intersections: 70 },
      { domain: 'd30.com', intersections: 30 },
      { domain: 'd10.com', intersections: 10 },
      { domain: 'd5.com', intersections: 5 },
      { domain: 'dnull.com' }, // missing intersections -> null, sorts last
    ]);
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output, status } = await discoverCompetitorsHandler(ctx);

    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].href).toContain('/dataforseo_labs/google/competitors_domain/live');
    expect(capturedBodies[0].body).toMatchObject({ target: 'aquaplumbing.com', exclude_top_domains: true, max_rank_group: 20, limit: 20 });
    expect(status).toBe('succeeded');

    const parsedOutput = output as { candidateCount: number; selectedDomains: string[]; stageCostUsdMicro: number };
    // 8 raw items - yelp.com (excluded) - aquaplumbing.com (own domain) = 6 surviving candidates.
    expect(parsedOutput.candidateCount).toBe(6);
    expect(parsedOutput.selectedDomains.sort()).toEqual(
      ['d90.com', 'd70.com', 'd30.com', 'd10.com', 'd5.com'].sort()
    );
    expect(parsedOutput.selectedDomains).not.toContain('dnull.com');
    expect(parsedOutput.selectedDomains).not.toContain('yelp.com');
    expect(parsedOutput.selectedDomains).not.toContain('aquaplumbing.com');
    expect(parsedOutput.stageCostUsdMicro).toBe(50_000);

    const competitorRows = raw
      .prepare(`SELECT domain, selected, source, visibility_score FROM competitors WHERE run_id = ?`)
      .all(runId) as Array<{ domain: string; selected: number; source: string; visibility_score: number | null }>;
    expect(competitorRows).toHaveLength(6);
    const dnull = competitorRows.find((r) => r.domain === 'dnull.com');
    expect(dnull?.selected).toBe(0);
    expect(dnull?.visibility_score).toBeNull();
    for (const domain of ['d90.com', 'd70.com', 'd30.com', 'd10.com', 'd5.com']) {
      expect(competitorRows.find((r) => r.domain === domain)?.selected).toBe(1);
    }
    for (const row of competitorRows) expect(row.source).toBe('competitors_domain');

    const evidenceRows = raw
      .prepare(`SELECT ce.evidence_ref_id FROM competitor_evidence_refs ce
                 JOIN competitors c ON c.id = ce.competitor_id WHERE c.run_id = ?`)
      .all(runId) as Array<{ evidence_ref_id: string }>;
    expect(evidenceRows).toHaveLength(6);
    expect(new Set(evidenceRows.map((r) => r.evidence_ref_id)).size).toBe(1); // one DFS call -> one evidence ref, shared

    restore();
  });

  it('always selects every user-supplied known competitor even beyond the top-5-by-metric cut, on top of the metric-ranked fill', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    const { restore } = stubDiscoveryFetch([
      { domain: 'top1.com', intersections: 90 },
      { domain: 'top2.com', intersections: 80 },
      { domain: 'top3.com', intersections: 70 },
      { domain: 'top4.com', intersections: 60 },
    ]);
    restoreFetch = restore;

    const briefInput = {
      ...SAMPLE_BRIEF_INPUT,
      knownCompetitorDomains: ['https://www.known1.com', 'https://www.known2.com'],
    };
    const parsed = parseProjectBrief(briefInput);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    expect(normalizedBrief.knownCompetitorDomains).toEqual(['known1.com', 'known2.com']);
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output } = await discoverCompetitorsHandler(ctx);
    const parsedOutput = output as { selectedDomains: string[]; droppedKnownCompetitors: string[] };

    // Neither known competitor trips the own-domain/excluded guards.
    expect(parsedOutput.droppedKnownCompetitors).toEqual([]);

    // 2 known competitors always selected + top 3 discovered by metric to
    // reach the cap of 5 (top4.com, the 4th-ranked discovered candidate,
    // does not make the cut).
    expect(parsedOutput.selectedDomains.sort()).toEqual(
      ['known1.com', 'known2.com', 'top1.com', 'top2.com', 'top3.com'].sort()
    );
    expect(parsedOutput.selectedDomains).not.toContain('top4.com');

    const knownRows = raw
      .prepare(`SELECT domain, selected, source FROM competitors WHERE run_id = ? AND source = 'user_seed'`)
      .all(runId) as Array<{ domain: string; selected: number; source: string }>;
    expect(knownRows).toHaveLength(2);
    for (const row of knownRows) expect(row.selected).toBe(1);

    restore();
  });

  it('drops a known competitor equal to the project own domain: not persisted, not selected, reported in droppedKnownCompetitors', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    const { restore } = stubDiscoveryFetch([{ domain: 'rival.com', intersections: 50 }]);
    restoreFetch = restore;

    // aquaplumbing.com is SAMPLE_BRIEF_INPUT's own websiteUrl domain.
    const briefInput = {
      ...SAMPLE_BRIEF_INPUT,
      knownCompetitorDomains: ['https://www.aquaplumbing.com', 'legit-rival.com'],
    };
    const parsed = parseProjectBrief(briefInput);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output } = await discoverCompetitorsHandler(ctx);
    const parsedOutput = output as { selectedDomains: string[]; droppedKnownCompetitors: string[] };

    expect(parsedOutput.droppedKnownCompetitors).toEqual(['aquaplumbing.com']);
    expect(parsedOutput.selectedDomains).not.toContain('aquaplumbing.com');
    expect(parsedOutput.selectedDomains.sort()).toEqual(['legit-rival.com', 'rival.com'].sort());

    const ownRows = raw
      .prepare(`SELECT id FROM competitors WHERE run_id = ? AND domain = 'aquaplumbing.com'`)
      .all(runId) as Array<{ id: string }>;
    expect(ownRows).toHaveLength(0); // dropped entries are NOT persisted

    restore();
  });

  it('drops a known competitor matching EXCLUDED_COMPETITOR_DOMAINS (subdomain-aware): not persisted, reported in droppedKnownCompetitors', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    const { restore } = stubDiscoveryFetch([{ domain: 'rival.com', intersections: 50 }]);
    restoreFetch = restore;

    const briefInput = {
      ...SAMPLE_BRIEF_INPUT,
      knownCompetitorDomains: ['yelp.com', 'm.yelp.com', 'legit-rival.com'],
    };
    const parsed = parseProjectBrief(briefInput);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output } = await discoverCompetitorsHandler(ctx);
    const parsedOutput = output as { selectedDomains: string[]; droppedKnownCompetitors: string[] };

    expect(parsedOutput.droppedKnownCompetitors.sort()).toEqual(['m.yelp.com', 'yelp.com'].sort());
    expect(parsedOutput.selectedDomains.sort()).toEqual(['legit-rival.com', 'rival.com'].sort());

    const yelpRows = raw
      .prepare(`SELECT id FROM competitors WHERE run_id = ? AND domain IN ('yelp.com', 'm.yelp.com')`)
      .all(runId) as Array<{ id: string }>;
    expect(yelpRows).toHaveLength(0);

    // The legit known competitor is untouched by the guards: persisted,
    // selected, source user_seed.
    const legitRow = raw
      .prepare(`SELECT selected, source FROM competitors WHERE run_id = ? AND domain = 'legit-rival.com'`)
      .get(runId) as { selected: number; source: string } | undefined;
    expect(legitRow?.selected).toBe(1);
    expect(legitRow?.source).toBe('user_seed');

    restore();
  });

  it('resets a prior attempt stale selection: a previously-selected domain missing from the new top 5 flips back to selected=0', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    // Simulate a prior attempt's persisted state directly (deterministic:
    // no KV-cache variance): stale-winner.com was selected then, but the
    // new discovery response below will NOT include it in the top 5.
    raw
      .prepare(
        `INSERT INTO competitors (id, run_id, domain, source, selected, visibility_score)
         VALUES (?, ?, 'stale-winner.com', 'competitors_domain', 1, 40.0)`
      )
      .run(newId('comp'), runId);

    const { restore } = stubDiscoveryFetch([
      { domain: 'stale-winner.com', intersections: 40 }, // rank 6 now: below the new cut
      { domain: 'n1.com', intersections: 100 },
      { domain: 'n2.com', intersections: 90 },
      { domain: 'n3.com', intersections: 80 },
      { domain: 'n4.com', intersections: 70 },
      { domain: 'n5.com', intersections: 60 },
    ]);
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output } = await discoverCompetitorsHandler({ ...ctx, attempt: 2 });
    const parsedOutput = output as { selectedDomains: string[] };

    expect(parsedOutput.selectedDomains.sort()).toEqual(
      ['n1.com', 'n2.com', 'n3.com', 'n4.com', 'n5.com'].sort()
    );

    const rows = raw
      .prepare(`SELECT domain, selected FROM competitors WHERE run_id = ?`)
      .all(runId) as Array<{ domain: string; selected: number }>;
    // stale-winner.com kept its single row (no duplicate) but is no longer selected.
    expect(rows.filter((r) => r.domain === 'stale-winner.com')).toHaveLength(1);
    expect(rows.find((r) => r.domain === 'stale-winner.com')?.selected).toBe(0);
    // Exactly 5 selected, all from the new top 5 -- and the partial UNIQUE
    // index (run_id, domain) WHERE selected=1 was never violated (the
    // handler completing without throwing proves that; this asserts the
    // resulting state is also correct).
    expect(rows.filter((r) => r.selected === 1)).toHaveLength(5);

    restore();
  });

  it('keeps ALL user-supplied known competitors selected even when there are more than 5 of them', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    const { restore } = stubDiscoveryFetch([{ domain: 'discovered.com', intersections: 999 }]);
    restoreFetch = restore;

    const knownDomains = ['k1.com', 'k2.com', 'k3.com', 'k4.com', 'k5.com', 'k6.com'];
    const briefInput = { ...SAMPLE_BRIEF_INPUT, knownCompetitorDomains: knownDomains };
    const parsed = parseProjectBrief(briefInput);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output } = await discoverCompetitorsHandler(ctx);
    const parsedOutput = output as { selectedDomains: string[] };

    // All 6 known competitors are kept (never dropped to respect the cap);
    // with 6 already selected there is no room left for the metric-ranked
    // discovered candidate.
    expect(parsedOutput.selectedDomains.sort()).toEqual(knownDomains.sort());
    expect(parsedOutput.selectedDomains).not.toContain('discovered.com');

    const rows = raw
      .prepare(`SELECT selected FROM competitors WHERE run_id = ? AND domain = 'discovered.com'`)
      .all(runId) as Array<{ selected: number }>;
    expect(rows[0]?.selected).toBe(0);

    restore();
  });

  it('greenfield mode posts keywords + item_types [organic, local_pack] from primary-area seeds', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    const { restore, capturedBodies } = stubDiscoveryFetch([{ domain: 'greenfield-rival.com', avg_position: 3 }]);
    restoreFetch = restore;

    const { websiteUrl, ...greenfieldInput } = SAMPLE_BRIEF_INPUT;
    const parsed = parseProjectBrief(greenfieldInput);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    expect(normalizedBrief.mode).toBe('greenfield');
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output } = await discoverCompetitorsHandler(ctx);

    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0].href).toContain('/dataforseo_labs/google/serp_competitors/live');
    expect(capturedBodies[0].body).toMatchObject({
      include_subdomains: false,
      item_types: ['organic', 'local_pack'],
      limit: 20,
    });
    expect(Array.isArray(capturedBodies[0].body.keywords)).toBe(true);
    expect(capturedBodies[0].body.keywords.length).toBeGreaterThan(0);
    for (const kw of capturedBodies[0].body.keywords as string[]) {
      expect(kw).toContain('austin'); // every service_primary_area seed includes the primary area's city
    }

    const parsedOutput = output as { selectedDomains: string[] };
    expect(parsedOutput.selectedDomains).toContain('greenfield-rival.com');

    restore();
  });

  it('re-running the stage does not violate UNIQUE(run_id, domain) WHERE selected=1', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    const { restore } = stubDiscoveryFetch([
      { domain: 'd90.com', intersections: 90 },
      { domain: 'd70.com', intersections: 70 },
    ]);
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    // First attempt.
    const first = await discoverCompetitorsHandler(ctx);
    // Second attempt on the exact same run (simulating a retried stage
    // attempt after e.g. a transient failure in a later stage forced this
    // one to be re-driven): must not throw a UNIQUE constraint violation,
    // and must reproduce the same selection idempotently.
    const second = await discoverCompetitorsHandler({ ...ctx, attempt: 2 });

    expect((second.output as any).selectedDomains.sort()).toEqual(
      (first.output as any).selectedDomains.sort()
    );

    const rows = raw
      .prepare(`SELECT domain, selected FROM competitors WHERE run_id = ?`)
      .all(runId) as Array<{ domain: string; selected: number }>;
    // Still exactly one row per domain -- the retry reused the existing
    // rows (SELECT-before-INSERT) rather than creating duplicates.
    expect(rows).toHaveLength(2);

    restore();
  });

  it('throws provider_invalid_response when resolve_market has no output to read', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCompetitorCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    await expect(discoverCompetitorsHandler(ctx)).rejects.toMatchObject({
      code: 'provider_invalid_response',
    } satisfies Partial<BlueprintApiError>);
  });
});

// collectCompetitorEvidenceHandler is exercised directly, same rationale as
// discoverCompetitorsHandler above: seeding one resolve_market stage row plus
// the selected competitors rows it reads is enough context, no need to
// re-drive the earlier stages of the pipeline for every scenario.
describe('collectCompetitorEvidenceHandler', () => {
  let restoreFetch: (() => void) | undefined;
  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  async function seedMarketStage(d1: D1Database, runId: string): Promise<void> {
    await d1
      .prepare(
        `INSERT INTO research_stage_runs
          (id, run_id, stage_name, stage_input_hash, status, required, attempt_count, output_json, finished_at)
         VALUES (?, ?, 'resolve_market', 'hash-resolve-market', 'succeeded', 1, 1, ?, ?)`
      )
      .bind(newId('stagerun'), runId, JSON.stringify(MARKET), nowIso())
      .run();
  }

  async function seedCompetitor(d1: D1Database, runId: string, domain: string): Promise<string> {
    const id = newId('comp');
    await d1
      .prepare(
        `INSERT INTO competitors (id, run_id, domain, source, selected) VALUES (?, ?, ?, 'competitors_domain', 1)`
      )
      .bind(id, runId, domain)
      .run();
    return id;
  }

  function buildCtx(
    d1: D1Database,
    runId: string,
    projectId: string,
    briefVersionId: string,
    normalizedBrief: StageContext['normalizedBrief']
  ): StageContext {
    return {
      env: { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: { send: async () => undefined }, ...providerFields() } as any,
      d1,
      runId,
      projectId,
      briefVersionId,
      normalizedBrief,
      stage: 'collect_competitor_evidence',
      attempt: 1,
    };
  }

  // Dispatches by endpoint AND by the requested `target` domain, so each
  // competitor + each of the two endpoints can be scripted independently.
  // Passing 'error' for a (domain, endpoint) pair returns a single-task
  // response with a non-20000 status_code (DFS error 40501, "Invalid
  // Field"), which is what blueprintDfsCall treats as a hard failure
  // (mapDfsFailure -> throw) since it is the ONLY task in that response.
  function stubEvidenceFetch(
    rankedByDomain: Record<string, any[] | 'error'>,
    pagesByDomain: Record<string, any[] | 'error'>
  ): { restore: () => void } {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: any, init?: any) => {
      const href = String(url);
      const body = init?.body ? JSON.parse(init.body)[0] : {};
      const domain = body.target;
      const errorResponse = () => ({
        status_code: 40006,
        tasks: [{ id: 't-err', status_code: 40501, status_message: 'Invalid Field.', cost: 0, result: [] }],
      });
      const okItemsResponse = (items: any[], cost: number) => ({
        status_code: 20000,
        tasks: [{ id: 't-ok', status_code: 20000, status_message: 'Ok.', cost, result: [{ items }] }],
      });
      if (href.includes('/dataforseo_labs/google/ranked_keywords/live')) {
        const entry = rankedByDomain[domain] ?? [];
        return { ok: true, status: 200, json: async () => (entry === 'error' ? errorResponse() : okItemsResponse(entry, 0.05)) } as any;
      }
      if (href.includes('/dataforseo_labs/google/relevant_pages/live')) {
        const entry = pagesByDomain[domain] ?? [];
        return { ok: true, status: 200, json: async () => (entry === 'error' ? errorResponse() : okItemsResponse(entry, 0.03)) } as any;
      }
      throw new Error(`stubEvidenceFetch: unexpected fetch to ${href}`);
    }) as any;
    return { restore: () => { globalThis.fetch = original; } };
  }

  function rankedItem(keyword: string, overrides: any = {}) {
    return {
      keyword_data: {
        keyword,
        keyword_info: { search_volume: 50, cpc: 3 },
        keyword_properties: { keyword_difficulty: 30 },
      },
      ranked_serp_element: { serp_item: { url: `https://rival.com/${keyword}`, rank_group: 5, type: 'organic', etv: 10 } },
      ...overrides,
    };
  }

  function pageItem(url: string, count = 5) {
    return { page_address: url, metrics: { organic: { count, etv: 20 } } };
  }

  it('persists ranked keywords, records competitor_evidence_refs for both calls, and returns succeeded with the correct stage cost', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);
    const competitorId = await seedCompetitor(d1, runId, 'rival.com');

    const { restore } = stubEvidenceFetch(
      { 'rival.com': [rankedItem('emergency plumbing austin')] },
      { 'rival.com': [pageItem('https://rival.com/emergency-plumbing/')] }
    );
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output, status } = await collectCompetitorEvidenceHandler(ctx);
    const parsedOutput = output as {
      perCompetitor: Array<{ domain: string; rankedCount: number | null; pagesCount: number | null; topPages: any[] }>;
      stageCostUsdMicro: number;
    };

    expect(status).toBe('succeeded');
    expect(parsedOutput.perCompetitor).toEqual([
      {
        domain: 'rival.com',
        rankedCount: 1,
        pagesCount: 1,
        topPages: [{ url: 'https://rival.com/emergency-plumbing/', keywordCount: 5, trafficEstimate: 20 }],
      },
    ]);
    // 0.05 (ranked) + 0.03 (pages) = 0.08 USD = 80,000 micro.
    expect(parsedOutput.stageCostUsdMicro).toBe(80_000);

    const keywordRow = raw
      .prepare(`SELECT id, search_volume, cpc_usd_micro, keyword_difficulty FROM keywords WHERE run_id = ? AND normalized_keyword = 'emergency plumbing austin'`)
      .get(runId) as { id: string; search_volume: number; cpc_usd_micro: number; keyword_difficulty: number } | undefined;
    expect(keywordRow).toBeTruthy();
    expect(keywordRow!.search_volume).toBe(50);
    expect(keywordRow!.cpc_usd_micro).toBe(3_000_000);
    expect(keywordRow!.keyword_difficulty).toBe(30);

    const evidenceRows = raw
      .prepare(`SELECT evidence_ref_id FROM competitor_evidence_refs WHERE competitor_id = ?`)
      .all(competitorId) as Array<{ evidence_ref_id: string }>;
    // One evidence ref from the ranked_keywords call, one from relevant_pages.
    expect(evidenceRows).toHaveLength(2);
    expect(new Set(evidenceRows.map((r) => r.evidence_ref_id)).size).toBe(2);

    const keywordEvidenceRows = raw
      .prepare(`SELECT evidence_ref_id FROM keyword_evidence_refs WHERE keyword_id = ?`)
      .all(keywordRow!.id) as Array<{ evidence_ref_id: string }>;
    expect(keywordEvidenceRows.length).toBeGreaterThan(0);

    restore();
  });

  it('merges ranked keywords from two different selected competitors into the same run universe without violating UNIQUE', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);
    const compA = await seedCompetitor(d1, runId, 'rivalA.com');
    const compB = await seedCompetitor(d1, runId, 'rivalB.com');

    const { restore } = stubEvidenceFetch(
      {
        'rivalA.com': [rankedItem('shared keyword austin'), rankedItem('unique to a')],
        'rivalB.com': [rankedItem('shared keyword austin')],
      },
      { 'rivalA.com': [], 'rivalB.com': [] }
    );
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output, status } = await collectCompetitorEvidenceHandler(ctx);
    expect(status).toBe('succeeded');
    const parsedOutput = output as { perCompetitor: Array<{ domain: string; rankedCount: number | null }> };
    expect(parsedOutput.perCompetitor.find((c) => c.domain === 'rivalA.com')?.rankedCount).toBe(2);
    expect(parsedOutput.perCompetitor.find((c) => c.domain === 'rivalB.com')?.rankedCount).toBe(1);

    // Exactly one row for the keyword both competitors ranked for -- the
    // UNIQUE(run_id, normalized_keyword) constraint was never violated.
    const sharedRows = raw
      .prepare(`SELECT id FROM keywords WHERE run_id = ? AND normalized_keyword = 'shared keyword austin'`)
      .all(runId) as Array<{ id: string }>;
    expect(sharedRows).toHaveLength(1);

    const uniqueRows = raw
      .prepare(`SELECT id FROM keywords WHERE run_id = ? AND normalized_keyword = 'unique to a'`)
      .all(runId) as Array<{ id: string }>;
    expect(uniqueRows).toHaveLength(1);

    // Both competitors' evidence refs got attached to the shared keyword.
    const sharedEvidence = raw
      .prepare(`SELECT evidence_ref_id FROM keyword_evidence_refs WHERE keyword_id = ?`)
      .all(sharedRows[0].id) as Array<{ evidence_ref_id: string }>;
    expect(sharedEvidence.length).toBe(2);

    // Both competitors still have their own competitor_evidence_refs rows.
    const compAEvidence = raw.prepare(`SELECT evidence_ref_id FROM competitor_evidence_refs WHERE competitor_id = ?`).all(compA);
    const compBEvidence = raw.prepare(`SELECT evidence_ref_id FROM competitor_evidence_refs WHERE competitor_id = ?`).all(compB);
    expect((compAEvidence as any[]).length).toBeGreaterThan(0);
    expect((compBEvidence as any[]).length).toBeGreaterThan(0);

    restore();
  });

  it('keywords discovered via a competitor merge into an existing run keyword (e.g. persisted earlier by collect_keyword_evidence) without violating UNIQUE', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);
    const competitorId = await seedCompetitor(d1, runId, 'rival.com');

    // Simulate collect_keyword_evidence having already persisted this
    // keyword earlier in the pipeline.
    const existingKeywordId = newId('kw');
    raw
      .prepare(
        `INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword, search_volume, cpc_usd_micro, keyword_difficulty, metrics_missing)
         VALUES (?, ?, 'Emergency Plumbing Austin', 'emergency plumbing austin', 500, 4200000, NULL, 1)`
      )
      .run(existingKeywordId, runId);

    const { restore } = stubEvidenceFetch(
      { 'rival.com': [rankedItem('emergency plumbing austin')] },
      { 'rival.com': [] }
    );
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    await expect(collectCompetitorEvidenceHandler(ctx)).resolves.toBeTruthy();

    const rows = raw
      .prepare(`SELECT id, search_volume FROM keywords WHERE run_id = ? AND normalized_keyword = 'emergency plumbing austin'`)
      .all(runId) as Array<{ id: string; search_volume: number }>;
    expect(rows).toHaveLength(1); // still one row: no UNIQUE violation
    expect(rows[0].id).toBe(existingKeywordId);
    expect(rows[0].search_volume).toBe(500); // ON CONFLICT DO NOTHING: original value preserved

    const evidenceRows = raw
      .prepare(`SELECT evidence_ref_id FROM keyword_evidence_refs WHERE keyword_id = ?`)
      .all(existingKeywordId) as Array<{ evidence_ref_id: string }>;
    expect(evidenceRows.length).toBeGreaterThan(0); // the competitor's evidence still got attached

    restore();
  });

  it('does not throw the whole handler when one competitor ranked_keywords call fails: that competitor reports rankedCount null and the stage is partial, other competitors still succeed', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);
    await seedCompetitor(d1, runId, 'broken.com');
    await seedCompetitor(d1, runId, 'healthy.com');

    const { restore } = stubEvidenceFetch(
      { 'broken.com': 'error', 'healthy.com': [rankedItem('drain cleaning austin')] },
      { 'broken.com': [pageItem('https://broken.com/page/')], 'healthy.com': [pageItem('https://healthy.com/page/')] }
    );
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output, status } = await collectCompetitorEvidenceHandler(ctx);
    expect(status).toBe('partial');

    const parsedOutput = output as {
      perCompetitor: Array<{ domain: string; rankedCount: number | null; pagesCount: number | null }>;
    };
    const broken = parsedOutput.perCompetitor.find((c) => c.domain === 'broken.com');
    const healthy = parsedOutput.perCompetitor.find((c) => c.domain === 'healthy.com');
    expect(broken?.rankedCount).toBeNull();
    // broken.com's relevant_pages call is independent and still succeeded.
    expect(broken?.pagesCount).toBe(1);
    expect(healthy?.rankedCount).toBe(1);
    expect(healthy?.pagesCount).toBe(1);

    restore();
  });

  it('caps topPages at 100 even if more relevant pages are returned', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);
    await seedCompetitor(d1, runId, 'rival.com');

    const manyPages = Array.from({ length: 150 }, (_, i) => pageItem(`https://rival.com/page-${i}/`));
    const { restore } = stubEvidenceFetch({ 'rival.com': [] }, { 'rival.com': manyPages });
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output } = await collectCompetitorEvidenceHandler(ctx);
    const parsedOutput = output as { perCompetitor: Array<{ topPages: any[]; pagesCount: number | null }> };
    expect(parsedOutput.perCompetitor[0].pagesCount).toBe(150);
    expect(parsedOutput.perCompetitor[0].topPages).toHaveLength(100);

    restore();
  });

  it('returns an empty perCompetitor list and succeeded status when there are no selected competitors', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output, status } = await collectCompetitorEvidenceHandler(ctx);
    expect(status).toBe('succeeded');
    expect((output as any).perCompetitor).toEqual([]);
    expect((output as any).stageCostUsdMicro).toBe(0);
  });

  it('throws provider_invalid_response when resolve_market has no output to read', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    await expect(collectCompetitorEvidenceHandler(ctx)).rejects.toMatchObject({
      code: 'provider_invalid_response',
    } satisfies Partial<BlueprintApiError>);
  });
});

describe('buildSerpQueriesFromSeeds', () => {
  it('caps the query list at 20 even with more service-in-primary-area seeds available', () => {
    const seeds: SeedQuery[] = Array.from({ length: 25 }, (_, i) => ({
      query: `service ${i} austin`,
      serviceId: `s${i}`,
      serviceAreaId: 'a1',
      source: 'service_primary_area' as const,
    }));

    const queries = buildSerpQueriesFromSeeds(seeds, MARKET);
    expect(queries).toHaveLength(20);
    expect(queries[0]).toEqual({ keyword: 'service 0 austin', serviceAreaId: 'a1', locationCode: 1023191 });
  });

  it('drops non-service_primary_area seeds and falls back to the market fallback code when a service area is unresolved', () => {
    const seeds: SeedQuery[] = [
      { query: 'plumber', serviceId: 's1', serviceAreaId: null, source: 'category' as const },
      { query: 'emergency plumbing', serviceId: 's1', serviceAreaId: null, source: 'service' as const },
      { query: 'emergency plumbing round rock', serviceId: 's1', serviceAreaId: 'a2', source: 'service_primary_area' as const },
    ];

    const queries = buildSerpQueriesFromSeeds(seeds, MARKET);
    expect(queries).toEqual([
      { keyword: 'emergency plumbing round rock', serviceAreaId: 'a2', locationCode: MARKET.fallbackSerpLocationCode },
    ]);
  });
});

describe('validateSerpsAndQuestionsHandler', () => {
  let restoreFetch: (() => void) | undefined;
  afterEach(() => {
    restoreFetch?.();
    restoreFetch = undefined;
  });

  async function seedMarketStage(d1: D1Database, runId: string): Promise<void> {
    await d1
      .prepare(
        `INSERT INTO research_stage_runs
          (id, run_id, stage_name, stage_input_hash, status, required, attempt_count, output_json, finished_at)
         VALUES (?, ?, 'resolve_market', 'hash-resolve-market', 'succeeded', 1, 1, ?, ?)`
      )
      .bind(newId('stagerun'), runId, JSON.stringify(MARKET), nowIso())
      .run();
  }

  function buildCtx(
    d1: D1Database,
    runId: string,
    projectId: string,
    briefVersionId: string,
    normalizedBrief: StageContext['normalizedBrief']
  ): StageContext {
    return {
      env: { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: { send: async () => undefined }, ...providerFields() } as any,
      d1,
      runId,
      projectId,
      briefVersionId,
      normalizedBrief,
      stage: 'validate_serps_and_questions',
      attempt: 1,
    };
  }

  async function seedKeywordRows(d1: D1Database, runId: string, keywords: string[]): Promise<void> {
    for (const keyword of keywords) {
      await d1
        .prepare(`INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword) VALUES (?, ?, ?, ?)`)
        .bind(newId('kw'), runId, keyword, keyword)
        .run();
    }
  }

  function taskPostFetchStub(taskIds: string[]): { restore: () => void } {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status_code: 20000,
        tasks: taskIds.map((id) => ({ id, status_code: 20100, status_message: 'Task Created.', cost: 0.01, result: [{ id }] })),
      }),
    })) as any;
    return { restore: () => { globalThis.fetch = original; } };
  }

  it('first attempt (no dfs_serp_tasks rows yet): posts a batch and throws SerpTasksPendingError', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);
    await seedKeywordRows(d1, runId, ['emergency plumbing austin', 'drain cleaning austin']);

    const { restore } = taskPostFetchStub(['task-1', 'task-2']);
    restoreFetch = restore;

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    await expect(validateSerpsAndQuestionsHandler(ctx)).rejects.toBeInstanceOf(SerpTasksPendingError);

    const rows = await d1.prepare(`SELECT status FROM dfs_serp_tasks WHERE run_id = ?`).bind(runId).all<{ status: string }>();
    expect(rows.results.length).toBeGreaterThan(0);
    expect(rows.results.every((r) => r.status === 'posted')).toBe(true);
  });

  it('later attempt with a not-ready posted row: throws SerpTasksPendingError again and leaves the row posted', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);
    await seedKeywordRows(d1, runId, ['emergency plumbing austin']);
    await d1
      .prepare(
        `INSERT INTO dfs_serp_tasks (id, run_id, keyword, service_area_id, location_code, provider_task_id, status, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'posted', ?)`
      )
      .bind(newId('serpt'), runId, 'emergency plumbing austin', 'a1', 1023191, 'task-1', nowIso())
      .run();

    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status_code: 20000,
        tasks: [{ id: 'task-1', status_code: 40601, status_message: 'Task In Queue.', cost: 0, result: null }],
      }),
    })) as any;
    restoreFetch = () => { globalThis.fetch = original; };

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    await expect(validateSerpsAndQuestionsHandler(ctx)).rejects.toBeInstanceOf(SerpTasksPendingError);

    const row = await d1.prepare(`SELECT status FROM dfs_serp_tasks WHERE run_id = ?`).bind(runId).first<{ status: string }>();
    expect(row?.status).toBe('posted');
  });

  it('later attempt with everything ready: returns succeeded with snapshots/failed counts', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    await seedMarketStage(d1, runId);
    await seedKeywordRows(d1, runId, ['emergency plumbing austin']);
    await d1
      .prepare(
        `INSERT INTO dfs_serp_tasks (id, run_id, keyword, service_area_id, location_code, provider_task_id, status, posted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'posted', ?)`
      )
      .bind(newId('serpt'), runId, 'emergency plumbing austin', 'a1', 1023191, 'task-1', nowIso())
      .run();

    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status_code: 20000,
        tasks: [
          {
            id: 'task-1',
            status_code: 20000,
            status_message: 'Ok.',
            cost: 0,
            result: [{ items: [{ type: 'organic', rank_group: 1, url: 'https://a.com', title: 'A', domain: 'a.com' }] }],
          },
        ],
      }),
    })) as any;
    restoreFetch = () => { globalThis.fetch = original; };

    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    const { output, status } = await validateSerpsAndQuestionsHandler(ctx);
    expect(status).toBe('succeeded');
    expect(output).toEqual({ snapshots: 1, failed: 0 });
  });

  it('throws provider_invalid_response when resolve_market has no output to read', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);
    const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
    const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
    const ctx = buildCtx(d1, runId, projectId, briefVersionId, normalizedBrief);

    await expect(validateSerpsAndQuestionsHandler(ctx)).rejects.toMatchObject({
      code: 'provider_invalid_response',
    } satisfies Partial<BlueprintApiError>);
  });
});
