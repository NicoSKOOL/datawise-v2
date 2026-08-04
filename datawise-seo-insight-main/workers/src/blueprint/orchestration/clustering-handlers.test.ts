import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { pseudoVector } from '../test-support/env';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import type { StageHandler, StageContext } from './handlers';
import type { BlueprintStage } from '../contracts/enums';
import { buildProvisionalClustersHandler, refineClustersHandler, persistAdjudications } from './clustering-handlers';
import { CLUSTER_RULESET_V2 } from '../domain/clustering/ruleset';
import type { AdjudicationCase } from '../domain/clustering/refine';

// Same STAGE_HANDLERS-driven approach research-handlers.test.ts uses: drive
// the real registry through processResearchRun so completeStage really
// runs (needed to prove research_stage_runs.ruleset_version lands as
// 'cluster-v3', which is stamped by process-run.ts itself via
// rulesetVersionForStage, not by the handler). Every stage before
// normalize_keyword_universe is overridden with a canned/no-op handler
// (this task does not re-test Phase 3's real evidence collection, and none
// of those overrides touch the network), and validate_serps_and_questions
// (the next REAL, network-calling handler after this stage) is also
// overridden so the drain loop never attempts a live DataForSEO call.

const MARKET = {
  labsLocationCode: 2840,
  languageCode: 'en',
  serpLocations: [],
  fallbackSerpLocationCode: 2840,
  unresolvedAreaIds: [],
};

const SAMPLE_BRIEF_INPUT = {
  businessName: 'Aqua Plumbing',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'en',
  services: [{ clientId: 's1', name: 'Drain Cleaning' }],
  serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true }],
  excludedTopics: ['jobs'],
};

// Fake Workers AI binding, same deterministic pseudoVector shared with
// test-support/env.ts's fakeEnv() (this file builds its own env object
// rather than using fakeEnv() directly -- see the R2/KV fixture comment
// below -- but the pseudoVector helper itself is exactly the kind of
// reusable, non-test module thing test-support/ exists for).
function providerFields(r2: R2Bucket, kv: KVNamespace): Pick<
  BlueprintProviderEnv,
  'KV' | 'BLUEPRINT_ARTIFACTS' | 'DATAFORSEO_EMAIL' | 'DATAFORSEO_PASSWORD' | 'AI'
> {
  return {
    KV: kv,
    BLUEPRINT_ARTIFACTS: r2,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
    AI: {
      async run(_model: string, input: Record<string, unknown>) {
        const texts = Array.isArray(input.text) ? (input.text as string[]) : [];
        return { shape: [texts.length, 32], data: texts.map(pseudoVector) };
      },
    },
  };
}

// In-memory R2/KV fakes, same shape as evidence-readback.test.ts's own
// fixtures (this file cannot import those -- they are declared inside that
// test file's module scope, not exported).
function fakeR2() {
  const objects = new Map<string, string>();
  const bucket = {
    async put(key: string, value: string) {
      objects.set(key, value);
    },
    async get(key: string) {
      const body = objects.get(key);
      if (body === undefined) return null;
      return { text: async () => body };
    },
  };
  return bucket as unknown as R2Bucket;
}

function fakeKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
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

interface SeedKeywordSpec {
  id: string;
  normalizedKeyword: string;
  displayKeyword?: string;
  searchVolume?: number | null;
  keywordDifficulty?: number | null;
}

async function insertKeywordRow(d1: D1Database, runId: string, spec: SeedKeywordSpec): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keywords
        (id, run_id, display_keyword, normalized_keyword, search_volume, cpc_usd_micro, keyword_difficulty, metrics_missing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      spec.id,
      runId,
      spec.displayKeyword ?? spec.normalizedKeyword,
      spec.normalizedKeyword,
      spec.searchVolume ?? null,
      null,
      spec.keywordDifficulty ?? null,
      1
    )
    .run();
}

function dfsEnvelope(items: any[]) {
  return {
    status_code: 20000,
    tasks: [{ id: 't1', status_code: 20000, status_message: 'Ok.', cost: 0, result: [{ items }] }],
  };
}

// Seeds a real R2 artifact + its matching evidence_refs/artifacts rows, so
// loadKeywordEnrichmentFromArtifacts's readback finds real enrichment data
// for the given keyword.
async function seedEnrichmentArtifact(
  d1: D1Database,
  r2: R2Bucket,
  args: { runId: string; storageKey: string; keyword: string; coreKeyword: string; mainIntent: string }
): Promise<void> {
  const artifactId = newId('art');
  await r2.put(
    args.storageKey,
    JSON.stringify(
      dfsEnvelope([
        {
          keyword: args.keyword,
          keyword_properties: { core_keyword: args.coreKeyword },
          search_intent_info: { main_intent: args.mainIntent },
        },
      ])
    )
  );
  await d1
    .prepare(
      `INSERT INTO artifacts (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
       VALUES (?, 'org1', ?, 'keyword_metric', ?, 'sha', 'application/json', 1, 0, ?)`
    )
    .bind(artifactId, args.runId, args.storageKey, nowIso())
    .run();
  await d1
    .prepare(
      `INSERT INTO evidence_refs (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro, artifact_id)
       VALUES (?, ?, 'dataforseo', 'keyword_metric', 'keyword_ideas', ?, ?, 0, ?)`
    )
    .bind(newId('evr'), args.runId, args.storageKey, nowIso(), artifactId)
    .run();
}

// Seeds an evidence_refs row pointing at an artifacts row whose storage_key
// was never written to R2 (and has no KV cache entry either) -- models an
// artifact that expired/was never actually persisted, exercising
// artifactsMissing.
async function seedMissingArtifactEvidenceRef(d1: D1Database, runId: string, storageKey: string): Promise<void> {
  const artifactId = newId('art');
  await d1
    .prepare(
      `INSERT INTO artifacts (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
       VALUES (?, 'org1', ?, 'keyword_metric', ?, 'sha', 'application/json', 1, 0, ?)`
    )
    .bind(artifactId, runId, storageKey, nowIso())
    .run();
  await d1
    .prepare(
      `INSERT INTO evidence_refs (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro, artifact_id)
       VALUES (?, ?, 'dataforseo', 'keyword_metric', 'keyword_ideas', ?, ?, 0, ?)`
    )
    .bind(newId('evr'), runId, storageKey, nowIso(), artifactId)
    .run();
}

function baseOverrides(): Partial<Record<BlueprintStage, StageHandler>> {
  return {
    resolve_market: async () => ({ output: MARKET, status: 'succeeded' as const }),
    discover_competitors: async () => ({ output: { stub: true }, status: 'succeeded' as const }),
    collect_competitor_evidence: async () => ({ output: { stub: true }, status: 'succeeded' as const }),
    validate_serps_and_questions: async () => ({ output: { stub: true }, status: 'succeeded' as const }),
    // Task 16: build_page_plan is now REAL and the single writer of
    // keyword_clusters.page_candidate + decision_reason. These clustering tests
    // drive the run to terminal and assert the clustering stage's OWN write to
    // those columns (page_candidate null, decision_reason names cluster-v3), so
    // stub build_page_plan here to keep them scoped to clustering. build_page_plan
    // has its own coverage in page-plan-handlers.test.ts / engine.test.ts.
    build_page_plan: async () => ({ output: { stage: 'build_page_plan' as const, stub: true }, status: 'succeeded' as const }),
  };
}

async function driveToNormalizeUniverse(
  env: BlueprintProviderEnv,
  runId: string,
  sent: unknown[],
  overrides: Partial<Record<BlueprintStage, StageHandler>>
): Promise<void> {
  await processResearchRun(env, runId, 'w1', overrides);
  let guard = 0;
  while (sent.length) {
    if (guard++ > 50) throw new Error('drive loop did not settle');
    sent.pop();
    await processResearchRun(env, runId, 'w1', overrides);
  }
}

describe('normalizeKeywordUniverseHandler (via processResearchRun)', () => {
  it('backfills enrichment, scores, links services/areas, and excludes by precedence', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);

    const r2 = fakeR2();
    const kv = fakeKv();
    const sent: unknown[] = [];
    const env: BlueprintProviderEnv = {
      BLUEPRINT_DB: d1,
      BLUEPRINT_QUEUE: { send: async (body: unknown) => void sent.push(body) },
      ...providerFields(r2, kv),
    };

    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      ...baseOverrides(),
      collect_keyword_evidence: async (ctx: StageContext) => {
        await insertKeywordRow(ctx.d1, ctx.runId, {
          id: 'kw_seed',
          normalizedKeyword: 'drain cleaning austin',
          searchVolume: 500,
          keywordDifficulty: 20,
        });
        await insertKeywordRow(ctx.d1, ctx.runId, {
          id: 'kw_excluded_topic',
          normalizedKeyword: 'plumber jobs',
        });
        await insertKeywordRow(ctx.d1, ctx.runId, {
          id: 'kw_language_mismatch',
          normalizedKeyword: 'сантехник austin',
        });
        await insertKeywordRow(ctx.d1, ctx.runId, {
          id: 'kw_retained',
          normalizedKeyword: 'drain cleaning services austin',
        });
        await seedEnrichmentArtifact(ctx.d1, r2, {
          runId: ctx.runId,
          storageKey: `runs/${ctx.runId}/dfs/ideas.json`,
          keyword: 'drain cleaning austin',
          coreKeyword: 'drain cleaning',
          mainIntent: 'transactional',
        });
        return { output: { stub: true }, status: 'succeeded' as const };
      },
    };

    await driveToNormalizeUniverse(env, runId, sent, overrides);

    const stageRow = await d1
      .prepare(`SELECT status, output_json, ruleset_version FROM research_stage_runs WHERE run_id = ? AND stage_name = ?`)
      .bind(runId, 'normalize_keyword_universe')
      .first<{ status: string; output_json: string; ruleset_version: string }>();
    expect(stageRow).toBeTruthy();
    expect(stageRow!.status).toBe('succeeded');
    expect(stageRow!.ruleset_version).toBe('cluster-v3');

    const output = JSON.parse(stageRow!.output_json);
    expect(output).toMatchObject({
      stage: 'normalize_keyword_universe',
      total: 4,
      retained: 2,
      excluded: 2,
      languageMismatches: 1,
      enriched: 1,
      artifactsRead: 1,
      artifactsMissing: 0,
      rulesetVersion: 'cluster-v3',
    });
    expect(output.serviceLinksAdded).toBeGreaterThanOrEqual(2);
    expect(output.areaLinksAdded).toBeGreaterThanOrEqual(2);

    const keywordRows = raw
      .prepare(
        `SELECT id, core_keyword, main_intent, excluded_reason, language_code, is_language_mismatch, relevance_score
         FROM keywords WHERE run_id = ? ORDER BY id`
      )
      .all(runId) as Array<{
      id: string;
      core_keyword: string | null;
      main_intent: string | null;
      excluded_reason: string | null;
      language_code: string | null;
      is_language_mismatch: number;
      relevance_score: number;
    }>;
    const byId = new Map(keywordRows.map((r) => [r.id, r]));

    expect(byId.get('kw_seed')!.core_keyword).toBe('drain cleaning');
    expect(byId.get('kw_seed')!.main_intent).toBe('transactional');
    expect(byId.get('kw_seed')!.excluded_reason).toBeNull();
    expect(byId.get('kw_seed')!.language_code).toBe('en');

    expect(byId.get('kw_excluded_topic')!.excluded_reason).toBe('excluded_topic');

    expect(byId.get('kw_language_mismatch')!.excluded_reason).toBe('language_mismatch');
    expect(byId.get('kw_language_mismatch')!.is_language_mismatch).toBe(1);
    expect(byId.get('kw_language_mismatch')!.language_code).toBeNull();

    expect(byId.get('kw_retained')!.excluded_reason).toBeNull();
    expect(byId.get('kw_retained')!.relevance_score).toBeGreaterThan(0);

    const serviceLinkRows = raw
      .prepare(`SELECT keyword_id, service_id FROM keyword_services`)
      .all() as Array<{ keyword_id: string; service_id: string }>;
    expect(serviceLinkRows).toContainEqual({ keyword_id: 'kw_seed', service_id: 's1' });
    expect(serviceLinkRows).toContainEqual({ keyword_id: 'kw_retained', service_id: 's1' });

    const areaLinkRows = raw
      .prepare(`SELECT keyword_id, service_area_id FROM keyword_service_areas`)
      .all() as Array<{ keyword_id: string; service_area_id: string }>;
    expect(areaLinkRows).toContainEqual({ keyword_id: 'kw_seed', service_area_id: 'a1' });
  });

  it('reports partial status when a referenced artifact cannot be read back', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);

    const r2 = fakeR2();
    const kv = fakeKv();
    const sent: unknown[] = [];
    const env: BlueprintProviderEnv = {
      BLUEPRINT_DB: d1,
      BLUEPRINT_QUEUE: { send: async (body: unknown) => void sent.push(body) },
      ...providerFields(r2, kv),
    };

    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      ...baseOverrides(),
      collect_keyword_evidence: async (ctx: StageContext) => {
        await insertKeywordRow(ctx.d1, ctx.runId, { id: 'kw_1', normalizedKeyword: 'drain cleaning austin' });
        await seedMissingArtifactEvidenceRef(ctx.d1, ctx.runId, `runs/${ctx.runId}/dfs/expired.json`);
        return { output: { stub: true }, status: 'succeeded' as const };
      },
    };

    await driveToNormalizeUniverse(env, runId, sent, overrides);

    const stageRow = await d1
      .prepare(`SELECT status, output_json FROM research_stage_runs WHERE run_id = ? AND stage_name = ?`)
      .bind(runId, 'normalize_keyword_universe')
      .first<{ status: string; output_json: string }>();
    expect(stageRow!.status).toBe('partial');
    const output = JSON.parse(stageRow!.output_json);
    expect(output.artifactsMissing).toBe(1);
    expect(output.artifactsRead).toBe(0);
  });
});

describe('embedKeywordFeaturesHandler (via processResearchRun)', () => {
  it('embeds only retained keywords, stamps ruleset_version, and reports succeeded with no truncation', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);

    const r2 = fakeR2();
    const kv = fakeKv();
    const sent: unknown[] = [];
    const env: BlueprintProviderEnv = {
      BLUEPRINT_DB: d1,
      BLUEPRINT_QUEUE: { send: async (body: unknown) => void sent.push(body) },
      ...providerFields(r2, kv),
    };

    // No overrides for normalize_keyword_universe or embed_keyword_features:
    // both run for real, so normalize_keyword_universe's own excluded_reason
    // decision is what actually determines which keywords get embedded.
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      ...baseOverrides(),
      collect_keyword_evidence: async (ctx: StageContext) => {
        await insertKeywordRow(ctx.d1, ctx.runId, {
          id: 'kw_retained_1',
          normalizedKeyword: 'drain cleaning austin',
          searchVolume: 500,
        });
        await insertKeywordRow(ctx.d1, ctx.runId, {
          id: 'kw_retained_2',
          normalizedKeyword: 'drain cleaning services austin',
        });
        await insertKeywordRow(ctx.d1, ctx.runId, {
          id: 'kw_excluded',
          normalizedKeyword: 'plumber jobs',
        });
        return { output: { stub: true }, status: 'succeeded' as const };
      },
    };

    await driveToNormalizeUniverse(env, runId, sent, overrides);

    const stageRow = await d1
      .prepare(`SELECT status, output_json, ruleset_version FROM research_stage_runs WHERE run_id = ? AND stage_name = ?`)
      .bind(runId, 'embed_keyword_features')
      .first<{ status: string; output_json: string; ruleset_version: string }>();
    expect(stageRow).toBeTruthy();
    expect(stageRow!.status).toBe('succeeded');
    expect(stageRow!.ruleset_version).toBe('cluster-v3');

    const output = JSON.parse(stageRow!.output_json);
    expect(output.stage).toBe('embed_keyword_features');
    expect(output.model).toBe('@cf/baai/bge-m3');
    expect(output.vectorCount).toBe(2); // kw_excluded was never sent to AI
    expect(output.truncatedCount).toBe(0);
    expect(output.rulesetVersion).toBe('cluster-v3');
    expect(Array.isArray(output.artifacts)).toBe(true);
    expect(output.artifacts.length).toBeGreaterThan(0);

    // Confirm the excluded keyword's id never shows up in any persisted batch.
    for (const batch of output.artifacts as Array<{ storageKey: string }>) {
      const obj = await r2.get(batch.storageKey);
      const parsed = JSON.parse(await (obj as any).text());
      const ids = parsed.vectors.map((v: any) => v.keywordId);
      expect(ids).not.toContain('kw_excluded');
    }
  });
});

// ===== buildProvisionalClustersHandler =====

// Seeds a ranked_keywords-shaped artifact so loadCompetitorRankingUrls's
// readback finds real SERP URLs for the given keyword/url pairs. Mirrors
// seedEnrichmentArtifact above but with kind='ranking'/operation=
// 'ranked_keywords' and the ranked_serp_element.serp_item.url shape
// evidence-readback.ts's extractRankingUrlItem reads.
async function seedRankingUrlArtifact(
  d1: D1Database,
  r2: R2Bucket,
  args: { runId: string; storageKey: string; items: Array<{ keyword: string; url: string }> }
): Promise<void> {
  const artifactId = newId('art');
  await r2.put(
    args.storageKey,
    JSON.stringify(
      dfsEnvelope(
        args.items.map((i) => ({ keyword: i.keyword, ranked_serp_element: { serp_item: { url: i.url } } }))
      )
    )
  );
  await d1
    .prepare(
      `INSERT INTO artifacts (id, organization_id, run_id, kind, storage_key, sha256, content_type, byte_size, encrypted, created_at)
       VALUES (?, 'org1', ?, 'ranking', ?, 'sha', 'application/json', 1, 0, ?)`
    )
    .bind(artifactId, args.runId, args.storageKey, nowIso())
    .run();
  await d1
    .prepare(
      `INSERT INTO evidence_refs (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro, artifact_id)
       VALUES (?, ?, 'dataforseo', 'ranking', 'ranked_keywords', ?, ?, 0, ?)`
    )
    .bind(newId('evr'), args.runId, args.storageKey, nowIso(), artifactId)
    .run();
}

// Inserts a research_stage_runs row directly (bypassing the lease/queue
// machinery entirely), so a handler can be unit-tested via a hand-built
// StageContext without driving the whole pipeline through
// processResearchRun. Mirrors what completeStage (db/leases.ts) would leave
// behind for loadStageOutput's purposes: only status/output_json/finished_at
// matter to that reader.
async function seedStageOutput(
  d1: D1Database,
  runId: string,
  stage: string,
  output: unknown,
  status: 'succeeded' | 'partial' | 'skipped' = 'succeeded'
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, output_json, finished_at)
       VALUES (?, ?, ?, 'hash', ?, ?, ?)`
    )
    .bind(newId('rsr'), runId, stage, status, JSON.stringify(output), nowIso())
    .run();
}

async function seedBaseRun(): Promise<{
  d1: D1Database;
  raw: import('better-sqlite3').Database;
  runId: string;
  projectId: string;
  briefVersionId: string;
}> {
  const { d1, raw } = createTestDb();
  const projectId = await seedProject(d1);
  const briefVersionId = await seedBriefVersion(d1, projectId);
  const runId = await seedRun(d1, projectId, briefVersionId);
  return { d1, raw, runId, projectId, briefVersionId };
}

// Hand-built StageContext for direct handler unit tests (same pattern
// research-handlers.test.ts's "throws provider_invalid_response when
// resolve_market has no output" test uses for collectKeywordEvidenceHandler).
// briefInput defaults to SAMPLE_BRIEF_INPUT; the brand-token overlap tests
// below pass their own so they can control category/service vocabulary
// independently of the business name.
async function buildDirectCtx(
  d1: D1Database,
  r2: R2Bucket,
  kv: KVNamespace,
  runId: string,
  projectId: string,
  briefVersionId: string,
  briefInput: unknown = SAMPLE_BRIEF_INPUT
): Promise<StageContext> {
  const parsed = parseProjectBrief(briefInput);
  const normalizedBrief = await normalizeProjectBrief(parsed, V1_LIMITS);
  return {
    env: { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: { send: async () => undefined }, ...providerFields(r2, kv) } as any,
    d1,
    runId,
    projectId,
    briefVersionId,
    normalizedBrief,
    stage: 'build_provisional_clusters',
    attempt: 1,
  };
}

describe('buildProvisionalClustersHandler (via processResearchRun)', () => {
  it('persists clusters with sane confidence, exactly one primary per cluster, and representative queries', async () => {
    const { d1, raw } = createTestDb();
    const projectId = await seedProject(d1);
    const briefVersionId = await seedBriefVersion(d1, projectId);
    const runId = await seedRun(d1, projectId, briefVersionId);

    const r2 = fakeR2();
    const kv = fakeKv();
    const sent: unknown[] = [];
    const env: BlueprintProviderEnv = {
      BLUEPRINT_DB: d1,
      BLUEPRINT_QUEUE: { send: async (body: unknown) => void sent.push(body) },
      ...providerFields(r2, kv),
    };

    let evidenceRefId = '';

    // Fixed vectors (not the real embedKeywordFeaturesHandler / fake AI
    // binding): identical vectors give an exact cosine of 1, orthogonal
    // vectors give an exact cosine of 0, so this cluster's shape is fully
    // deterministic instead of depending on pseudoVector's hash-based
    // (effectively random, for unrelated strings) similarity.
    const VEC: Record<string, number[]> = {
      'drain cleaning austin': [1, 0, 0, 0],
      'drain cleaning services austin': [1, 0, 0, 0],
      'plumber austin reviews': [0, 1, 0, 0],
      'bluedogplumbing austin': [0, 0, 1, 0],
    };

    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      ...baseOverrides(),
      discover_competitors: async (ctx: StageContext) => {
        await ctx.d1
          .prepare(`INSERT INTO competitors (id, run_id, domain, source, selected) VALUES (?, ?, ?, 'dfs_discovery', 1)`)
          .bind(newId('cmp'), ctx.runId, 'bluedogplumbing.com')
          .run();
        return { output: { stub: true }, status: 'succeeded' as const };
      },
      collect_keyword_evidence: async (ctx: StageContext) => {
        await insertKeywordRow(ctx.d1, ctx.runId, { id: 'kw_a', normalizedKeyword: 'drain cleaning austin', searchVolume: 500 });
        await insertKeywordRow(ctx.d1, ctx.runId, { id: 'kw_b', normalizedKeyword: 'drain cleaning services austin' });
        await insertKeywordRow(ctx.d1, ctx.runId, { id: 'kw_c', normalizedKeyword: 'plumber austin reviews', searchVolume: 300 });
        await insertKeywordRow(ctx.d1, ctx.runId, { id: 'kw_brand', normalizedKeyword: 'bluedogplumbing austin' });
        await insertKeywordRow(ctx.d1, ctx.runId, { id: 'kw_excluded', normalizedKeyword: 'plumber jobs' });

        await seedEnrichmentArtifact(ctx.d1, r2, {
          runId: ctx.runId,
          storageKey: `runs/${ctx.runId}/dfs/a.json`,
          keyword: 'drain cleaning austin',
          coreKeyword: 'drain cleaning',
          mainIntent: 'transactional',
        });
        await seedEnrichmentArtifact(ctx.d1, r2, {
          runId: ctx.runId,
          storageKey: `runs/${ctx.runId}/dfs/b.json`,
          keyword: 'drain cleaning services austin',
          coreKeyword: 'drain cleaning',
          mainIntent: 'transactional',
        });
        await seedEnrichmentArtifact(ctx.d1, r2, {
          runId: ctx.runId,
          storageKey: `runs/${ctx.runId}/dfs/c.json`,
          keyword: 'plumber austin reviews',
          coreKeyword: 'plumber reviews',
          mainIntent: 'informational',
        });
        await seedEnrichmentArtifact(ctx.d1, r2, {
          runId: ctx.runId,
          storageKey: `runs/${ctx.runId}/dfs/brand.json`,
          keyword: 'bluedogplumbing austin',
          coreKeyword: 'bluedogplumbing',
          mainIntent: 'navigational',
        });

        evidenceRefId = newId('evr');
        await ctx.d1
          .prepare(
            `INSERT INTO evidence_refs (id, run_id, provider, kind, operation, request_hash, fetched_at, cost_usd_micro)
             VALUES (?, ?, 'dataforseo', 'keyword_metric', 'keyword_ideas', 'evref-1', ?, 0)`
          )
          .bind(evidenceRefId, ctx.runId, nowIso())
          .run();
        await ctx.d1
          .prepare(`INSERT INTO keyword_evidence_refs (keyword_id, evidence_ref_id) VALUES (?, ?)`)
          .bind('kw_a', evidenceRefId)
          .run();

        return { output: { stub: true }, status: 'succeeded' as const };
      },
      embed_keyword_features: async (ctx: StageContext) => {
        const result = await ctx.d1
          .prepare(
            `SELECT id, normalized_keyword FROM keywords WHERE run_id = ? AND excluded_reason IS NULL ORDER BY normalized_keyword ASC`
          )
          .bind(ctx.runId)
          .all<{ id: string; normalized_keyword: string }>();
        const retained = result.results ?? [];
        const vectors = retained.map((row) => ({
          keywordId: row.id,
          normalizedKeyword: row.normalized_keyword,
          contentHash: 'h',
          vector: VEC[row.normalized_keyword],
        }));
        const storageKey = `runs/${ctx.runId}/embeddings/0.json`;
        await r2.put(storageKey, JSON.stringify({ model: 'fake-model', dimensions: 4, template: 'kw_v1', vectors }));
        return {
          output: {
            stage: 'embed_keyword_features',
            model: 'fake-model',
            dimensions: 4,
            vectorCount: vectors.length,
            batchCount: 1,
            inputHash: 'fake-hash',
            truncatedCount: 0,
            artifacts: [{ artifactId: 'art_fake', storageKey, count: vectors.length }],
            rulesetVersion: 'cluster-v3',
          },
          status: 'succeeded' as const,
        };
      },
    };

    await driveToNormalizeUniverse(env, runId, sent, overrides);

    const stageRow = await d1
      .prepare(`SELECT status, output_json, ruleset_version FROM research_stage_runs WHERE run_id = ? AND stage_name = ?`)
      .bind(runId, 'build_provisional_clusters')
      .first<{ status: string; output_json: string; ruleset_version: string }>();
    expect(stageRow).toBeTruthy();
    expect(stageRow!.status).toBe('succeeded');
    expect(stageRow!.ruleset_version).toBe('cluster-v3');

    const output = JSON.parse(stageRow!.output_json);
    expect(output).toMatchObject({
      stage: 'build_provisional_clusters',
      keywordCount: 4,
      clusterCount: 3,
      singletonCount: 2,
      edgeCount: 6,
      forbiddenEdgeCount: 5,
      blockedByCap: 0,
      oversizedSplit: 0,
      rulesetVersion: 'cluster-v3',
    });
    // dims=4 in this fixture, deliberately narrower than the ruleset's
    // pinned 1024 -- proves the self-consistent-but-off-ruleset-width
    // warning plumbing without throwing.
    expect(output.warnings).toEqual(['unexpected_embedding_dimensions']);

    expect(output.representativeQueries).toHaveLength(1);
    const rq = output.representativeQueries[0];
    expect(rq.serviceAreaId).toBe('a1');

    const clusterRows = raw
      .prepare(
        `SELECT id, service_id, service_area_id, primary_keyword_id, confidence_score, confidence_label,
                page_candidate, adjudication_json, ruleset_version, score_breakdown_json, decision_reason
         FROM keyword_clusters WHERE run_id = ? ORDER BY id`
      )
      .all(runId) as Array<{
      id: string;
      service_id: string | null;
      service_area_id: string | null;
      primary_keyword_id: string;
      confidence_score: number;
      confidence_label: string;
      page_candidate: string | null;
      adjudication_json: string | null;
      ruleset_version: string;
      score_breakdown_json: string;
      decision_reason: string;
    }>;
    expect(clusterRows).toHaveLength(3);
    for (const row of clusterRows) {
      expect(row.page_candidate).toBeNull();
      expect(row.adjudication_json).toBeNull();
      expect(row.ruleset_version).toBe('cluster-v3');
      expect(['low', 'medium', 'high']).toContain(row.confidence_label);
      expect(row.decision_reason).toContain('cluster-v3');
      const breakdown = JSON.parse(row.score_breakdown_json);
      expect(breakdown.rulesetVersion).toBe('cluster-v3');
      expect(Array.isArray(breakdown.evidenceRefIds)).toBe(true);
    }

    const memberRows = raw
      .prepare(`SELECT cluster_id, keyword_id, is_primary FROM cluster_keywords ORDER BY cluster_id, keyword_id`)
      .all() as Array<{ cluster_id: string; keyword_id: string; is_primary: number }>;
    expect(memberRows).toHaveLength(4); // one row per retained keyword, none dropped

    const byCluster = new Map<string, typeof memberRows>();
    for (const m of memberRows) {
      const arr = byCluster.get(m.cluster_id) ?? [];
      arr.push(m);
      byCluster.set(m.cluster_id, arr);
    }
    for (const members of byCluster.values()) {
      expect(members.filter((m) => m.is_primary === 1)).toHaveLength(1);
    }

    const groups = [...byCluster.values()];
    const multiMember = groups.find((g) => g.length === 2);
    expect(multiMember).toBeTruthy();
    const multiClusterId = multiMember![0].cluster_id;
    const multiRow = clusterRows.find((r) => r.id === multiClusterId)!;
    // metricCoverage=0.5 (kw_a has volume, kw_b doesn't), intentCertainty=1.0
    // (both transactional), serpAgreement=null (no SERP evidence) -> avg 0.75.
    expect(multiRow.confidence_score).toBeCloseTo(0.75, 6);
    expect(multiRow.confidence_label).toBe('medium');
    const multiBreakdown = JSON.parse(multiRow.score_breakdown_json);
    expect(multiBreakdown.evidenceRefIds).toContain(evidenceRefId);
    expect(rq.clusterId).toBe(multiClusterId);
    expect(rq.keywordId).toBe(multiRow.primary_keyword_id);

    const singletonLabels = groups
      .filter((g) => g.length === 1)
      .map((g) => clusterRows.find((r) => r.id === g[0].cluster_id)!.confidence_label)
      .sort();
    // kw_c: metricCoverage=1 (has volume), intentCertainty=1 (singleton
    // matches its own intent) -> avg 1.0 -> 'high'.
    // kw_brand: metricCoverage=0 (no volume), intentCertainty=1 -> avg 0.5 -> 'low'.
    expect(singletonLabels).toEqual(['high', 'low']);
  });

  it('is retry-safe: a second invocation resets and reapplies cleanly (no duplicate rows)', async () => {
    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();
    await insertKeywordRow(d1, runId, { id: 'kw1', normalizedKeyword: 'drain cleaning austin' });
    await insertKeywordRow(d1, runId, { id: 'kw2', normalizedKeyword: 'pipe repair dallas' });
    await insertKeywordRow(d1, runId, { id: 'kw3', normalizedKeyword: 'water heater install miami' });

    const r2 = fakeR2();
    const vectors = [
      { keywordId: 'kw1', normalizedKeyword: 'drain cleaning austin', contentHash: 'h1', vector: [1, 0, 0, 0] },
      { keywordId: 'kw2', normalizedKeyword: 'pipe repair dallas', contentHash: 'h2', vector: [0, 1, 0, 0] },
      { keywordId: 'kw3', normalizedKeyword: 'water heater install miami', contentHash: 'h3', vector: [0, 0, 1, 0] },
    ];
    const storageKey = `runs/${runId}/embeddings/0.json`;
    await r2.put(storageKey, JSON.stringify({ model: 'fake-model', dimensions: 4, template: 'kw_v1', vectors }));
    await seedStageOutput(d1, runId, 'embed_keyword_features', {
      stage: 'embed_keyword_features',
      model: 'fake-model',
      dimensions: 4,
      vectorCount: 3,
      batchCount: 1,
      inputHash: 'h',
      truncatedCount: 0,
      artifacts: [{ artifactId: 'art1', storageKey, count: 3 }],
      rulesetVersion: 'cluster-v3',
    });

    const ctx = await buildDirectCtx(d1, r2, fakeKv(), runId, projectId, briefVersionId);

    await buildProvisionalClustersHandler(ctx);
    const clusterCount1 = (raw.prepare(`SELECT COUNT(*) AS n FROM keyword_clusters WHERE run_id = ?`).get(runId) as { n: number }).n;
    const memberCount1 = (raw.prepare(`SELECT COUNT(*) AS n FROM cluster_keywords`).get() as { n: number }).n;
    expect(clusterCount1).toBe(3); // three mutually-orthogonal, unrelated vectors -> 3 singletons
    expect(memberCount1).toBe(3);

    await buildProvisionalClustersHandler(ctx);
    const clusterCount2 = (raw.prepare(`SELECT COUNT(*) AS n FROM keyword_clusters WHERE run_id = ?`).get(runId) as { n: number }).n;
    const memberCount2 = (raw.prepare(`SELECT COUNT(*) AS n FROM cluster_keywords`).get() as { n: number }).n;
    expect(clusterCount2).toBe(clusterCount1);
    expect(memberCount2).toBe(memberCount1);
  });

  it('a truncated keyword (no vector) still clusters via the SERP/intent path', async () => {
    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();
    await insertKeywordRow(d1, runId, { id: 'kw1', normalizedKeyword: 'drain cleaning austin' });
    await insertKeywordRow(d1, runId, { id: 'kw2', normalizedKeyword: 'drain cleaning services austin' });
    await d1
      .prepare(`UPDATE keywords SET main_intent = 'transactional' WHERE id IN ('kw1', 'kw2')`)
      .run();

    const r2 = fakeR2();
    // Only kw1 gets a vector -- kw2 is "truncated" (no vector at all, same
    // observable shape as embed_keyword_features's own truncatedCount>0
    // path: a retained keyword absent from every batch).
    const vectors = [{ keywordId: 'kw1', normalizedKeyword: 'drain cleaning austin', contentHash: 'h1', vector: [1, 0, 0, 0] }];
    const storageKey = `runs/${runId}/embeddings/0.json`;
    await r2.put(storageKey, JSON.stringify({ model: 'fake-model', dimensions: 4, template: 'kw_v1', vectors }));
    await seedStageOutput(d1, runId, 'embed_keyword_features', {
      stage: 'embed_keyword_features',
      model: 'fake-model',
      dimensions: 4,
      vectorCount: 1,
      batchCount: 1,
      inputHash: 'h',
      truncatedCount: 1,
      artifacts: [{ artifactId: 'art1', storageKey, count: 1 }],
      rulesetVersion: 'cluster-v3',
    });

    await seedRankingUrlArtifact(d1, r2, {
      runId,
      storageKey: `runs/${runId}/dfs/ranked.json`,
      items: [
        { keyword: 'drain cleaning austin', url: 'https://example.com/page' },
        { keyword: 'drain cleaning services austin', url: 'https://example.com/page' },
      ],
    });

    const ctx = await buildDirectCtx(d1, r2, fakeKv(), runId, projectId, briefVersionId);
    const result = await buildProvisionalClustersHandler(ctx);
    expect(result.status).toBe('succeeded');
    const output = result.output as { clusterCount: number; singletonCount: number; keywordCount: number };
    expect(output.keywordCount).toBe(2);
    expect(output.clusterCount).toBe(1);
    expect(output.singletonCount).toBe(0);

    const memberRows = raw.prepare(`SELECT keyword_id FROM cluster_keywords`).all() as Array<{ keyword_id: string }>;
    expect(memberRows.map((r) => r.keyword_id).sort()).toEqual(['kw1', 'kw2']);
  });

  it('reports a truthful zero-cluster result (not a throw) when the keyword universe is legitimately empty', async () => {
    // Mirrors process-run.test.ts's "Finding 1" scenario: collect_keyword_evidence
    // (a REQUIRED stage) can degrade to 'partial' having persisted zero
    // keywords, in which case embed_keyword_features runs for real over zero
    // inputs and reports a real vectorCount:0 'succeeded' output -- that is
    // not a signal that embeddings broke, it is a signal there was nothing to
    // embed. build_provisional_clusters must not fail the whole run over it.
    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();
    await seedStageOutput(d1, runId, 'embed_keyword_features', {
      stage: 'embed_keyword_features',
      model: 'fake-model',
      dimensions: 4,
      vectorCount: 0,
      batchCount: 0,
      inputHash: 'h',
      truncatedCount: 0,
      artifacts: [],
      rulesetVersion: 'cluster-v3',
    });
    const ctx = await buildDirectCtx(d1, fakeR2(), fakeKv(), runId, projectId, briefVersionId);
    const result = await buildProvisionalClustersHandler(ctx);
    expect(result.status).toBe('succeeded');
    // Finding 2: total === 0 (no keyword rows at all for this run, not just
    // zero retained) is the genuinely-empty-universe branch -- 'succeeded',
    // no warning.
    expect(result.output).toMatchObject({
      keywordCount: 0,
      clusterCount: 0,
      singletonCount: 0,
      totalKeywords: 0,
      retainedKeywords: 0,
      warnings: [],
    });
    const clusterRows = raw.prepare(`SELECT COUNT(*) AS n FROM keyword_clusters WHERE run_id = ?`).get(runId) as { n: number };
    expect(clusterRows.n).toBe(0);
  });

  it('Finding 2: reports partial with an all_keywords_excluded warning when the universe is non-empty but every keyword was excluded upstream', async () => {
    // Distinguishes a genuinely empty universe (previous test: total === 0)
    // from stage 8 (normalize_keyword_universe) having excluded every real
    // keyword due to a bug -- both used to collapse to the same
    // 'succeeded'/zero-cluster result, hiding the second case from anyone
    // reading run status alone.
    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();
    await insertKeywordRow(d1, runId, { id: 'kw1', normalizedKeyword: 'plumber jobs austin' });
    await insertKeywordRow(d1, runId, { id: 'kw2', normalizedKeyword: 'plumber jobs dallas' });
    await d1.prepare(`UPDATE keywords SET excluded_reason = 'excluded_topic' WHERE run_id = ?`).bind(runId).run();
    await seedStageOutput(d1, runId, 'embed_keyword_features', {
      stage: 'embed_keyword_features',
      model: 'fake-model',
      dimensions: 4,
      vectorCount: 0,
      batchCount: 0,
      inputHash: 'h',
      truncatedCount: 0,
      artifacts: [],
      rulesetVersion: 'cluster-v3',
    });

    const ctx = await buildDirectCtx(d1, fakeR2(), fakeKv(), runId, projectId, briefVersionId);
    const result = await buildProvisionalClustersHandler(ctx);
    expect(result.status).toBe('partial');
    expect(result.output).toMatchObject({
      keywordCount: 0,
      clusterCount: 0,
      singletonCount: 0,
      totalKeywords: 2,
      retainedKeywords: 0,
      warnings: ['all_keywords_excluded'],
    });
    // Still reset-then-applies (no stale cluster rows survive), same as the
    // genuinely-empty branch.
    const clusterRows = raw.prepare(`SELECT COUNT(*) AS n FROM keyword_clusters WHERE run_id = ?`).get(runId) as { n: number };
    expect(clusterRows.n).toBe(0);
  });

  it('throws provider_invalid_response when embed_keyword_features has no readable output', async () => {
    const { d1, runId, projectId, briefVersionId } = await seedBaseRun();
    const ctx = await buildDirectCtx(d1, fakeR2(), fakeKv(), runId, projectId, briefVersionId);
    await expect(buildProvisionalClustersHandler(ctx)).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });

  it('throws provider_invalid_response when embed_keyword_features reported zero vectors for a non-empty universe', async () => {
    const { d1, runId, projectId, briefVersionId } = await seedBaseRun();
    await insertKeywordRow(d1, runId, { id: 'kw1', normalizedKeyword: 'drain cleaning austin' });
    await seedStageOutput(d1, runId, 'embed_keyword_features', {
      stage: 'embed_keyword_features',
      model: 'fake-model',
      dimensions: 4,
      vectorCount: 0,
      batchCount: 0,
      inputHash: 'h',
      truncatedCount: 0,
      artifacts: [],
      rulesetVersion: 'cluster-v3',
    });
    const ctx = await buildDirectCtx(d1, fakeR2(), fakeKv(), runId, projectId, briefVersionId);
    await expect(buildProvisionalClustersHandler(ctx)).rejects.toMatchObject({ code: 'provider_invalid_response' });
  });

  it('throws when stage-9 artifacts disagree on embedding dimensions (self-inconsistent)', async () => {
    const { d1, runId, projectId, briefVersionId } = await seedBaseRun();
    await insertKeywordRow(d1, runId, { id: 'kw1', normalizedKeyword: 'drain cleaning austin' });
    await insertKeywordRow(d1, runId, { id: 'kw2', normalizedKeyword: 'pipe repair austin' });

    const r2 = fakeR2();
    await r2.put(
      `runs/${runId}/embeddings/0.json`,
      JSON.stringify({
        model: 'fake-model',
        dimensions: 8,
        template: 'kw_v1',
        vectors: [{ keywordId: 'kw1', normalizedKeyword: 'drain cleaning austin', contentHash: 'h1', vector: [1, 0, 0, 0, 0, 0, 0, 0] }],
      })
    );
    await r2.put(
      `runs/${runId}/embeddings/1.json`,
      JSON.stringify({
        model: 'fake-model',
        dimensions: 6,
        template: 'kw_v1',
        vectors: [{ keywordId: 'kw2', normalizedKeyword: 'pipe repair austin', contentHash: 'h2', vector: [1, 0, 0, 0, 0, 0] }],
      })
    );
    await seedStageOutput(d1, runId, 'embed_keyword_features', {
      stage: 'embed_keyword_features',
      model: 'fake-model',
      dimensions: 8,
      vectorCount: 2,
      batchCount: 2,
      inputHash: 'h',
      truncatedCount: 0,
      artifacts: [
        { artifactId: 'a1', storageKey: `runs/${runId}/embeddings/0.json`, count: 1 },
        { artifactId: 'a2', storageKey: `runs/${runId}/embeddings/1.json`, count: 1 },
      ],
      rulesetVersion: 'cluster-v3',
    });

    const ctx = await buildDirectCtx(d1, r2, fakeKv(), runId, projectId, briefVersionId);
    await expect(buildProvisionalClustersHandler(ctx)).rejects.toThrow(/dimensions/);
  });

  it('records a warning (not a throw) when embeddings are self-consistent but narrower than the ruleset width', async () => {
    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();
    await insertKeywordRow(d1, runId, { id: 'kw1', normalizedKeyword: 'drain cleaning austin' });
    await insertKeywordRow(d1, runId, { id: 'kw2', normalizedKeyword: 'pipe repair dallas' });

    const r2 = fakeR2();
    const vectors = [
      { keywordId: 'kw1', normalizedKeyword: 'drain cleaning austin', contentHash: 'h1', vector: pseudoVector('drain cleaning austin') },
      { keywordId: 'kw2', normalizedKeyword: 'pipe repair dallas', contentHash: 'h2', vector: pseudoVector('pipe repair dallas') },
    ];
    const storageKey = `runs/${runId}/embeddings/0.json`;
    await r2.put(storageKey, JSON.stringify({ model: 'fake-model', dimensions: 32, template: 'kw_v1', vectors }));
    await seedStageOutput(d1, runId, 'embed_keyword_features', {
      stage: 'embed_keyword_features',
      model: 'fake-model',
      dimensions: 32,
      vectorCount: 2,
      batchCount: 1,
      inputHash: 'h',
      truncatedCount: 0,
      artifacts: [{ artifactId: 'a1', storageKey, count: 2 }],
      rulesetVersion: 'cluster-v3',
    });

    const ctx = await buildDirectCtx(d1, r2, fakeKv(), runId, projectId, briefVersionId);
    const result = await buildProvisionalClustersHandler(ctx);
    expect(result.status).toBe('succeeded');
    const output = result.output as { warnings: string[] };
    expect(output.warnings).toEqual(['unexpected_embedding_dimensions']);

    const clusterRows = raw.prepare(`SELECT id FROM keyword_clusters WHERE run_id = ?`).all(runId) as Array<{ id: string }>;
    expect(clusterRows.length).toBeGreaterThan(0);
  });

  // Finding 1: a generic category/service word that happens to be a
  // substring of the business name (the repo's own 'Aqua Plumbing' fixture)
  // must not become a brand token -- otherwise every generic keyword
  // containing that word looks branded, which (combined with a navigational
  // intent) trips branded_navigational_x_generic and fragments clusters that
  // should merge. A genuinely distinct brand token ('aqua') must still be
  // detected and still trip that same constraint.
  it("Finding 1: a business-name token shared with the brief's category/services is not a brand token, but a distinct one still is", async () => {
    const BRAND_TOKEN_BRIEF_INPUT = {
      businessName: 'Aqua Plumbing',
      category: 'Plumbing', // shares the token 'plumbing' with the business name
      websiteUrl: 'https://www.aquaplumbing.com',
      countryIso: 'us',
      languageCode: 'en',
      services: [{ clientId: 's1', name: 'Installation' }],
      serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true }],
    };

    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();

    // Group A: 'plumbing' is the only business-name-overlapping token here.
    // kwA1 is navigational -- before the fix, 'plumbing' being a (false
    // positive) brand token would make this branded-navigational and force
    // a forbidden edge against kwA2 (generic, non-branded). After the fix
    // neither is branded, so the pair is free to merge.
    await insertKeywordRow(d1, runId, { id: 'kwA1', normalizedKeyword: 'plumbing repair austin' });
    await insertKeywordRow(d1, runId, { id: 'kwA2', normalizedKeyword: 'affordable plumbing repair austin' });
    await d1
      .prepare(`UPDATE keywords SET main_intent = 'navigational' WHERE id = 'kwA1'`)
      .run();
    await d1
      .prepare(`UPDATE keywords SET main_intent = 'informational' WHERE id = 'kwA2'`)
      .run();

    // Group B: 'aqua' is a genuinely distinctive brand token (not shared
    // with category/services), so kwB1 (navigational, contains 'aqua') must
    // still be flagged branded and must still trip the constraint against
    // kwB2 (generic, non-branded, same 'plumbing'/'install' vocabulary).
    await insertKeywordRow(d1, runId, { id: 'kwB1', normalizedKeyword: 'aqua plumbing install dallas' });
    await insertKeywordRow(d1, runId, { id: 'kwB2', normalizedKeyword: 'affordable plumbing install dallas' });
    await d1
      .prepare(`UPDATE keywords SET main_intent = 'navigational' WHERE id = 'kwB1'`)
      .run();
    await d1
      .prepare(`UPDATE keywords SET main_intent = 'informational' WHERE id = 'kwB2'`)
      .run();

    const r2 = fakeR2();
    // Group A shares one vector, group B shares a different (orthogonal)
    // vector: within-group cosine similarity is an exact 1 (so the only
    // thing that can stop a within-group pair from merging is a forbidden
    // edge), cross-group cosine similarity is an exact 0 (so cross-group
    // pairs never merge on similarity alone, keeping the two groups'
    // outcomes independent of each other).
    const vectors = [
      { keywordId: 'kwA1', normalizedKeyword: 'plumbing repair austin', contentHash: 'ha1', vector: [1, 0, 0, 0] },
      { keywordId: 'kwA2', normalizedKeyword: 'affordable plumbing repair austin', contentHash: 'ha2', vector: [1, 0, 0, 0] },
      { keywordId: 'kwB1', normalizedKeyword: 'aqua plumbing install dallas', contentHash: 'hb1', vector: [0, 1, 0, 0] },
      { keywordId: 'kwB2', normalizedKeyword: 'affordable plumbing install dallas', contentHash: 'hb2', vector: [0, 1, 0, 0] },
    ];
    const storageKey = `runs/${runId}/embeddings/0.json`;
    await r2.put(storageKey, JSON.stringify({ model: 'fake-model', dimensions: 4, template: 'kw_v1', vectors }));
    await seedStageOutput(d1, runId, 'embed_keyword_features', {
      stage: 'embed_keyword_features',
      model: 'fake-model',
      dimensions: 4,
      vectorCount: 4,
      batchCount: 1,
      inputHash: 'h',
      truncatedCount: 0,
      artifacts: [{ artifactId: 'art1', storageKey, count: 4 }],
      rulesetVersion: 'cluster-v3',
    });

    const ctx = await buildDirectCtx(d1, r2, fakeKv(), runId, projectId, briefVersionId, BRAND_TOKEN_BRIEF_INPUT);
    const result = await buildProvisionalClustersHandler(ctx);
    expect(result.status).toBe('succeeded');

    const memberRows = raw
      .prepare(`SELECT cluster_id, keyword_id FROM cluster_keywords ORDER BY cluster_id, keyword_id`)
      .all() as Array<{ cluster_id: string; keyword_id: string }>;
    const clusterOf = new Map(memberRows.map((r) => [r.keyword_id, r.cluster_id]));

    // Group A merged into one cluster: 'plumbing' (shared with the brief's
    // own category) was correctly excluded from the brand-token set, so
    // kwA1's navigational intent never triggers branded_navigational_x_generic.
    expect(clusterOf.get('kwA1')).toBe(clusterOf.get('kwA2'));

    // Group B did NOT merge: 'aqua' is a real brand token, so kwB1
    // (navigational + branded) still trips the constraint against kwB2
    // (generic, non-branded) despite otherwise-identical vocabulary/vector
    // similarity to group A.
    expect(clusterOf.get('kwB1')).not.toBe(clusterOf.get('kwB2'));

    const output = result.output as { forbiddenEdgeCount: number };
    expect(output.forbiddenEdgeCount).toBeGreaterThan(0);
  });
});

// ===== refineClustersHandler =====

// Seeds a keyword_clusters row + its cluster_keywords members. decisionReason
// defaults to a recognizable marker so identity-preservation tests can prove an
// unchanged cluster's row was left untouched.
async function seedClusterRow(
  d1: D1Database,
  runId: string,
  spec: {
    id: string;
    label: string;
    primaryKeywordId: string;
    memberIds: string[];
    intent?: string | null;
    decisionReason?: string;
  }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO keyword_clusters
        (id, run_id, label, service_id, service_area_id, intent, primary_keyword_id,
         semantic_cohesion, serp_overlap_cohesion, confidence_score, confidence_label,
         page_candidate, decision_reason, warnings_json, adjudication_json, ruleset_version, score_breakdown_json)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, 0.5, 'medium', NULL, ?, '[]', NULL, 'cluster-v3', '{}')`
    )
    .bind(spec.id, runId, spec.label, spec.intent ?? null, spec.primaryKeywordId, spec.decisionReason ?? 'ORIGINAL')
    .run();
  for (const kid of spec.memberIds) {
    await d1
      .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, membership_score, is_primary) VALUES (?, ?, 1, ?)`)
      .bind(spec.id, kid, kid === spec.primaryKeywordId ? 1 : 0)
      .run();
  }
}

// Seeds a serp_snapshots row (organic URLs + related searches) plus optional
// PAA faq_evidence rows, keyed to a keyword id.
async function seedSerpSnapshot(
  d1: D1Database,
  runId: string,
  spec: { keywordId: string; organicUrls: string[]; related?: string[]; paa?: string[] }
): Promise<void> {
  const snapshotId = newId('serpsnap');
  await d1
    .prepare(
      `INSERT INTO serp_snapshots
        (id, run_id, keyword_id, service_area_id, location_code, language_code, checked_at,
         organic_json, related_searches_json, local_pack_present, featured_snippet_present, ai_overview_status)
       VALUES (?, ?, ?, NULL, 2840, 'en', ?, ?, ?, 0, 0, 'unchecked')`
    )
    .bind(
      snapshotId,
      runId,
      spec.keywordId,
      nowIso(),
      JSON.stringify(spec.organicUrls.map((url) => ({ rank: 1, url, title: null, domain: null }))),
      JSON.stringify(spec.related ?? [])
    )
    .run();
  for (const question of spec.paa ?? []) {
    await d1
      .prepare(
        `INSERT INTO faq_evidence (id, run_id, serp_snapshot_id, question, answer_text, source_title, source_url, parent_question_id, paa_depth)
         VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 1)`
      )
      .bind(newId('faq'), runId, snapshotId, question)
      .run();
  }
}

// Seeds an embed_keyword_features stage output + its R2 vector artifact so
// buildClusteringNodes (shared with build_provisional_clusters) can rebuild the
// same nodes refine_clusters clustered over.
async function seedEmbeddings(
  d1: D1Database,
  r2: R2Bucket,
  runId: string,
  vectors: Array<{ keywordId: string; normalizedKeyword: string; vector: number[] }>
): Promise<void> {
  const dimensions = vectors[0]?.vector.length ?? 4;
  const storageKey = `runs/${runId}/embeddings/0.json`;
  await r2.put(
    storageKey,
    JSON.stringify({
      model: 'fake-model',
      dimensions,
      template: 'kw_v1',
      vectors: vectors.map((v) => ({ ...v, contentHash: 'h' })),
    })
  );
  await seedStageOutput(d1, runId, 'embed_keyword_features', {
    stage: 'embed_keyword_features',
    model: 'fake-model',
    dimensions,
    vectorCount: vectors.length,
    batchCount: 1,
    inputHash: 'h',
    truncatedCount: 0,
    artifacts: [{ artifactId: 'art1', storageKey, count: vectors.length }],
    rulesetVersion: 'cluster-v3',
  });
}

async function buildRefineCtx(
  d1: D1Database,
  r2: R2Bucket,
  kv: KVNamespace,
  runId: string,
  projectId: string,
  briefVersionId: string
): Promise<StageContext> {
  const base = await buildDirectCtx(d1, r2, kv, runId, projectId, briefVersionId);
  return { ...base, stage: 'refine_clusters' as BlueprintStage };
}

describe('refineClustersHandler', () => {
  it('skips (succeeded) with no_clusters when the run has zero clusters', async () => {
    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();
    const ctx = await buildRefineCtx(d1, fakeR2(), fakeKv(), runId, projectId, briefVersionId);
    const result = await refineClustersHandler(ctx);
    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({ stage: 'refine_clusters', skipped: true, reason: 'no_clusters', clustersIn: 0 });
    const adj = raw.prepare(`SELECT COUNT(*) AS n FROM cluster_adjudications WHERE run_id = ?`).get(runId) as { n: number };
    expect(adj.n).toBe(0);
  });

  it('auto-merges two clusters with overlapping live SERPs and persists the merge changed-only', async () => {
    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();
    await insertKeywordRow(d1, runId, { id: 'kwA', normalizedKeyword: 'drain cleaning austin', searchVolume: 500 });
    await insertKeywordRow(d1, runId, { id: 'kwB', normalizedKeyword: 'drain cleaning services austin' });
    await d1.prepare(`UPDATE keywords SET main_intent = 'transactional' WHERE id IN ('kwA','kwB')`).run();

    const r2 = fakeR2();
    await seedEmbeddings(d1, r2, runId, [
      { keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0] },
      { keywordId: 'kwB', normalizedKeyword: 'drain cleaning services austin', vector: [1, 0, 0, 0] },
    ]);
    await seedClusterRow(d1, runId, { id: 'c_a', label: 'Drain cleaning', primaryKeywordId: 'kwA', memberIds: ['kwA'], intent: 'transactional' });
    await seedClusterRow(d1, runId, { id: 'c_b', label: 'Drain cleaning services', primaryKeywordId: 'kwB', memberIds: ['kwB'], intent: 'transactional' });
    await seedSerpSnapshot(d1, runId, { keywordId: 'kwA', organicUrls: ['u1', 'u2'] });
    await seedSerpSnapshot(d1, runId, { keywordId: 'kwB', organicUrls: ['u1', 'u2'] });

    const ctx = await buildRefineCtx(d1, r2, fakeKv(), runId, projectId, briefVersionId);
    const result = await refineClustersHandler(ctx);

    expect(result.status).toBe('succeeded');
    expect(result.output).toMatchObject({ autoMerges: 1, clustersIn: 2, clustersOut: 1, liveSnapshotCoverage: 2 });

    const clusterRows = raw
      .prepare(`SELECT id, ruleset_version, decision_reason FROM keyword_clusters WHERE run_id = ? ORDER BY id`)
      .all(runId) as Array<{ id: string; ruleset_version: string; decision_reason: string }>;
    expect(clusterRows).toHaveLength(1);
    expect(clusterRows[0].id.startsWith('kcl_')).toBe(true); // new merged identity, not c_a/c_b
    expect(clusterRows[0].ruleset_version).toBe('cluster-v3');
    expect(clusterRows[0].decision_reason).toContain('Refined by live SERP evidence');

    const members = raw
      .prepare(`SELECT keyword_id FROM cluster_keywords ORDER BY keyword_id`)
      .all() as Array<{ keyword_id: string }>;
    expect(members.map((m) => m.keyword_id)).toEqual(['kwA', 'kwB']);
  });

  it('completes partial with no_live_serp_evidence, persists insufficient_evidence adjudications, and is rerun-idempotent', async () => {
    const { d1, raw, runId, projectId, briefVersionId } = await seedBaseRun();
    await insertKeywordRow(d1, runId, { id: 'kwA', normalizedKeyword: 'drain cleaning austin' });
    await insertKeywordRow(d1, runId, { id: 'kwB', normalizedKeyword: 'drain cleaning services austin' });
    await d1.prepare(`UPDATE keywords SET main_intent = 'transactional' WHERE id IN ('kwA','kwB')`).run();

    const r2 = fakeR2();
    await seedEmbeddings(d1, r2, runId, [
      { keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0] },
      { keywordId: 'kwB', normalizedKeyword: 'drain cleaning services austin', vector: [1, 0, 0, 0] },
    ]);
    // Two identical-vector clusters, but NO serp_snapshots at all -> zero coverage.
    await seedClusterRow(d1, runId, { id: 'c_a', label: 'Drain cleaning', primaryKeywordId: 'kwA', memberIds: ['kwA'], intent: 'transactional', decisionReason: 'ORIGINAL_A' });
    await seedClusterRow(d1, runId, { id: 'c_b', label: 'Drain cleaning services', primaryKeywordId: 'kwB', memberIds: ['kwB'], intent: 'transactional', decisionReason: 'ORIGINAL_B' });

    const ctx = await buildRefineCtx(d1, r2, fakeKv(), runId, projectId, briefVersionId);
    const result = await refineClustersHandler(ctx);

    expect(result.status).toBe('partial');
    expect((result.output as { warnings: string[] }).warnings).toContain('no_live_serp_evidence');
    expect(result.output).toMatchObject({ autoMerges: 0, adjudicationsInsufficient: 1, adjudicationsPending: 0, liveSnapshotCoverage: 0 });

    // No auto-changes: both original clusters untouched (rows still carry their
    // seeded decision_reason markers).
    const clustersAfter = raw
      .prepare(`SELECT id, decision_reason FROM keyword_clusters WHERE run_id = ? ORDER BY id`)
      .all(runId) as Array<{ id: string; decision_reason: string }>;
    expect(clustersAfter.map((c) => c.id)).toEqual(['c_a', 'c_b']);
    expect(clustersAfter.map((c) => c.decision_reason)).toEqual(['ORIGINAL_A', 'ORIGINAL_B']);

    const adjRows = raw
      .prepare(`SELECT case_type, decision FROM cluster_adjudications WHERE run_id = ?`)
      .all(runId) as Array<{ case_type: string; decision: string }>;
    expect(adjRows).toHaveLength(1);
    expect(adjRows[0]).toMatchObject({ case_type: 'merge', decision: 'insufficient_evidence' });

    // Rerun: adjudications reset (no duplicate rows), clusters still untouched.
    await refineClustersHandler(ctx);
    const adjAfterRerun = raw.prepare(`SELECT COUNT(*) AS n FROM cluster_adjudications WHERE run_id = ?`).get(runId) as { n: number };
    expect(adjAfterRerun.n).toBe(1);
    const clustersAfterRerun = raw.prepare(`SELECT COUNT(*) AS n FROM keyword_clusters WHERE run_id = ?`).get(runId) as { n: number };
    expect(clustersAfterRerun.n).toBe(2);
  });

  it('runs end-to-end through processResearchRun and stamps ruleset_version cluster-v3', async () => {
    const { d1, runId, projectId, briefVersionId } = await seedBaseRun();
    void projectId;
    void briefVersionId;

    const r2 = fakeR2();
    const kv = fakeKv();
    const sent: unknown[] = [];
    const env: BlueprintProviderEnv = {
      BLUEPRINT_DB: d1,
      BLUEPRINT_QUEUE: { send: async (body: unknown) => void sent.push(body) },
      ...providerFields(r2, kv),
    };

    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      ...baseOverrides(),
      collect_keyword_evidence: async (ctx: StageContext) => {
        await insertKeywordRow(ctx.d1, ctx.runId, { id: 'kw_a', normalizedKeyword: 'drain cleaning austin', searchVolume: 500 });
        await insertKeywordRow(ctx.d1, ctx.runId, { id: 'kw_b', normalizedKeyword: 'drain cleaning services austin' });
        await ctx.d1.prepare(`UPDATE keywords SET main_intent = 'transactional' WHERE run_id = ?`).bind(ctx.runId).run();
        return { output: { stub: true }, status: 'succeeded' as const };
      },
      embed_keyword_features: async (ctx: StageContext) => {
        const rows = await ctx.d1
          .prepare(`SELECT id, normalized_keyword FROM keywords WHERE run_id = ? AND excluded_reason IS NULL ORDER BY normalized_keyword ASC`)
          .bind(ctx.runId)
          .all<{ id: string; normalized_keyword: string }>();
        const vectors = (rows.results ?? []).map((row) => ({
          keywordId: row.id,
          normalizedKeyword: row.normalized_keyword,
          contentHash: 'h',
          vector: [1, 0, 0, 0],
        }));
        const storageKey = `runs/${ctx.runId}/embeddings/0.json`;
        await r2.put(storageKey, JSON.stringify({ model: 'fake-model', dimensions: 4, template: 'kw_v1', vectors }));
        return {
          output: {
            stage: 'embed_keyword_features',
            model: 'fake-model',
            dimensions: 4,
            vectorCount: vectors.length,
            batchCount: 1,
            inputHash: 'h',
            truncatedCount: 0,
            artifacts: [{ artifactId: 'art1', storageKey, count: vectors.length }],
            rulesetVersion: 'cluster-v3',
          },
          status: 'succeeded' as const,
        };
      },
      // validate_serps_and_questions runs between build_provisional_clusters and
      // refine_clusters; override it to persist a live SERP snapshot for the
      // merged cluster's representative query so refine has evidence to read.
      validate_serps_and_questions: async (ctx: StageContext) => {
        const kw = await ctx.d1
          .prepare(`SELECT id FROM keywords WHERE run_id = ? AND normalized_keyword = ?`)
          .bind(ctx.runId, 'drain cleaning austin')
          .first<{ id: string }>();
        if (kw) await seedSerpSnapshot(ctx.d1, ctx.runId, { keywordId: kw.id, organicUrls: ['u1', 'u2'] });
        return { output: { stub: true }, status: 'succeeded' as const };
      },
    };

    await driveToNormalizeUniverse(env, runId, sent, overrides);

    const stageRow = await d1
      .prepare(`SELECT status, output_json, ruleset_version FROM research_stage_runs WHERE run_id = ? AND stage_name = 'refine_clusters'`)
      .bind(runId)
      .first<{ status: string; output_json: string; ruleset_version: string }>();
    expect(stageRow).toBeTruthy();
    expect(stageRow!.ruleset_version).toBe('cluster-v3');
    expect(['succeeded', 'partial']).toContain(stageRow!.status);
    const output = JSON.parse(stageRow!.output_json);
    expect(output.stage).toBe('refine_clusters');
    expect(output.rulesetVersion).toBe('cluster-v3');
  });
});

describe('persistAdjudications cap', () => {
  async function seedRun(d1: D1Database, runId: string): Promise<void> {
    const now = nowIso();
    await d1
      .prepare(
        `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
         VALUES (?, 'org_t', 'usr_t', 'cap test', 'greenfield', 'US', 'en', ?, ?)`
      )
      .bind(`prj_${runId}`, now, now)
      .run();
    await d1
      .prepare(
        `INSERT INTO research_runs (id, project_id, brief_version_id, estimate_id, status, created_by, created_at)
         VALUES (?, ?, 'bv_t', 'est_t', 'running', 'usr_t', ?)`
      )
      .bind(runId, `prj_${runId}`, now)
      .run();
  }

  function fakeCase(i: number, score: number | null): AdjudicationCase {
    return {
      caseType: 'merge',
      decision: 'insufficient_evidence',
      clusterIds: [`c_${String(i).padStart(6, '0')}`, 'c_zzz'],
      keywordIds: ['kw_a', 'kw_b'],
      scoreContext: {
        reason: 'no_live_evidence',
        score,
        semantic: score,
        serpOverlap: null,
        intent: null,
        cohesion: null,
        hasLiveEvidence: false,
        violations: [],
        edgeThreshold: CLUSTER_RULESET_V2.edgeThreshold,
        ambiguousBand: CLUSTER_RULESET_V2.clusters.ambiguousBand,
      },
    };
  }

  it('keeps only the highest-scoring maxPersistedAdjudications cases and reports the truncation', async () => {
    const { d1 } = createTestDb();
    const runId = 'run_captest';
    await seedRun(d1, runId);
    const cap = CLUSTER_RULESET_V2.clusters.maxPersistedAdjudications;
    // cap + 10 cases with ascending scores; the 10 lowest must be dropped.
    const cases = Array.from({ length: cap + 10 }, (_, i) => fakeCase(i, i / (cap + 10)));

    const { truncated } = await persistAdjudications(d1, runId, cases, nowIso());
    expect(truncated).toBe(10);

    const rows = await d1
      .prepare(`SELECT COUNT(*) AS n, MIN(json_extract(score_context_json, '$.score')) AS min_score FROM cluster_adjudications WHERE run_id = ?`)
      .bind(runId)
      .first<{ n: number; min_score: number }>();
    expect(rows!.n).toBe(cap);
    // The 10 lowest scores (i = 0..9) were dropped, so the minimum persisted
    // score belongs to i = 10.
    expect(rows!.min_score).toBeCloseTo(10 / (cap + 10), 10);
  });

  it('persists everything untruncated when under the cap', async () => {
    const { d1 } = createTestDb();
    const runId = 'run_captest2';
    await seedRun(d1, runId);
    const { truncated } = await persistAdjudications(d1, runId, [fakeCase(1, 0.6), fakeCase(2, null)], nowIso());
    expect(truncated).toBe(0);
    const rows = await d1
      .prepare(`SELECT COUNT(*) AS n FROM cluster_adjudications WHERE run_id = ?`)
      .bind(runId)
      .first<{ n: number }>();
    expect(rows!.n).toBe(2);
  });
});
