import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import type { StageHandler, StageContext } from './handlers';
import type { BlueprintStage } from '../contracts/enums';

// Same STAGE_HANDLERS-driven approach research-handlers.test.ts uses: drive
// the real registry through processResearchRun so completeStage really
// runs (needed to prove research_stage_runs.ruleset_version lands as
// 'cluster-v1', which is stamped by process-run.ts itself via
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

function providerFields(r2: R2Bucket, kv: KVNamespace): Pick<
  BlueprintProviderEnv,
  'KV' | 'BLUEPRINT_ARTIFACTS' | 'DATAFORSEO_EMAIL' | 'DATAFORSEO_PASSWORD'
> {
  return {
    KV: kv,
    BLUEPRINT_ARTIFACTS: r2,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
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
    expect(stageRow!.ruleset_version).toBe('cluster-v1');

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
      rulesetVersion: 'cluster-v1',
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
