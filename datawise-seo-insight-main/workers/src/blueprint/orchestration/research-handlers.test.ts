import { describe, it, expect, afterEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import { collectKeywordEvidenceHandler, discoverCompetitorsHandler } from './research-handlers';
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
    const parsedOutput = output as { selectedDomains: string[] };

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
