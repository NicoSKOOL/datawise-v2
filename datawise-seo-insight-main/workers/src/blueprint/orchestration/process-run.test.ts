import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import { buildStageInputHash } from '../domain/hash';
import { LEGACY_RULESET_VERSION } from '../domain/ruleset';
import { acquireStageLease } from '../db/leases';
import type { BlueprintStage } from '../contracts/enums';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import type { StageHandler } from './handlers';
import { BlueprintApiError } from '../domain/api-errors';
import { BlueprintValidationError } from '../domain/errors';
import { installDfsCatalogFetchStub } from '../test-support/dfs-catalog';
import { SerpTasksPendingError } from '../providers/dataforseo/serp';
import { validateSerpsAndQuestionsHandler } from './research-handlers';
import { DataForSeoQuotaError } from '../../dataforseo/client';
import { pseudoVector } from '../test-support/env';

// Same sample brief used by Task 11's domain/brief.test.ts (validInput).
const SAMPLE_BRIEF_INPUT = {
  businessName: '  Aqua Plumbing  ',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'EN',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning', priority: 'secondary' as const },
  ],
  serviceAreas: [
    { clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true, uniqueProof: ['Office on South Lamar'] },
    { clientId: 'a2', city: 'Round Rock', countryIso: 'us', isPrimary: false },
  ],
  excludedTopics: ['Jobs', 'jobs'],
  knownCompetitorDomains: ['https://www.rivalplumbing.com/'],
};

interface RunRow {
  id: string;
  status: string;
  current_stage: string | null;
  partial_reasons_json: string;
  finished_at: string | null;
}

interface StageRow {
  stage_name: string;
  status: string;
  required: number;
  attempt_count: number;
  safe_error_code: string | null;
  safe_error_message: string | null;
  ruleset_version: string | null;
}

interface BlueprintVersionRow {
  id: string;
  run_id: string;
  version_number: number;
  completeness: string;
  partial_reasons_json: string;
  latest_revision_id: string | null;
}

interface BlueprintRevisionRow {
  id: string;
  blueprint_version_id: string;
  revision_number: number;
}

interface ProjectRow {
  id: string;
  latest_blueprint_version_id: string | null;
  latest_blueprint_revision_id: string | null;
  latest_run_id: string | null;
}

function makeQueue() {
  const sent: unknown[] = [];
  return { sent, queue: { send: async (body: unknown) => { sent.push(body); } } };
}

// Task 14 registers the REAL validateSerpsAndQuestionsHandler onto
// STAGE_HANDLERS. That handler unconditionally throws SerpTasksPendingError
// on its very first (posting) attempt, by design (research-handlers.ts) --
// no fetch stub can make it resolve in one attempt, and no test in this file
// below is actually testing SERP behavior (Task 13's own tests further down
// pass validateSerpsAndQuestionsHandler explicitly where they want it).
// Tests that just want a normal terminal drive use this trivial always-
// succeeds stub in their overrides instead, restoring this file's original
// pre-Task-14 assumption that every stage but the ones a test explicitly
// cares about is a deterministic, zero-cost no-op.
const stubValidateSerps: StageHandler = async () => ({
  output: { stage: 'validate_serps_and_questions' as const, stub: true },
  status: 'succeeded' as const,
});

// Stub provider bindings/credentials this file's tests never actually
// exercise directly (no handler override here reads ctx.env itself), but
// processResearchRun now requires a BlueprintProviderEnv, so every
// constructed env needs these fields to satisfy the type. Real in-memory
// Map-backed KV/R2 (not pure no-op get-always-null stubs): Phase 4 Task 7
// registers normalize_keyword_universe as the first REAL reader of the R2
// artifacts/KV cache entries collect_keyword_evidence/discover_competitors/
// collect_competitor_evidence write earlier in this same full-drive path
// (providers/dataforseo/evidence-readback.ts). A no-op `get` that always
// returns null makes every one of those real writes look "missing" the
// moment something finally reads them back, which would incorrectly degrade
// normalize_keyword_universe to 'partial' on every run through this test,
// even though nothing was actually lost. A real round-trip (put really
// stores, get really returns it) is what production R2/KV actually do, so
// this is a fixture-fidelity fix, not a behavior change to what's being
// tested here.
function providerFields(): Pick<BlueprintProviderEnv, 'KV' | 'BLUEPRINT_ARTIFACTS' | 'DATAFORSEO_EMAIL' | 'DATAFORSEO_PASSWORD' | 'AI'> {
  const kvStore = new Map<string, string>();
  const r2Store = new Map<string, string>();
  return {
    KV: {
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => {
        kvStore.set(key, value);
      },
      delete: async (key: string) => {
        kvStore.delete(key);
      },
    } as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: {
      put: async (key: string, value: string) => {
        r2Store.set(key, value);
      },
      get: async (key: string) => {
        const body = r2Store.get(key);
        return body === undefined ? null : { text: async () => body };
      },
    } as unknown as R2Bucket,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
    // Phase 4 Task 8: embed_keyword_features is now a REAL handler that
    // calls env.AI.run for every retained keyword, so every full-drive test
    // in this file needs a working (not undefined) AI binding -- same
    // deterministic pseudoVector fake test-support/env.ts's own fakeEnv()
    // uses, not a real model call.
    AI: {
      async run(_model: string, input: Record<string, unknown>) {
        const texts = Array.isArray(input.text) ? (input.text as string[]) : [];
        return { shape: [texts.length, 32], data: texts.map(pseudoVector) };
      },
    },
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

async function seedBriefVersion(d1: D1Database, projectId: string): Promise<{ id: string; inputHash: string }> {
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
  return { id, inputHash: normalized.inputHash };
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

async function setup() {
  const { d1 } = createTestDb();
  const projectId = await seedProject(d1);
  const { id: briefVersionId, inputHash } = await seedBriefVersion(d1, projectId);
  return { d1, projectId, briefVersionId, inputHash };
}

async function getRun(d1: D1Database, runId: string): Promise<RunRow> {
  const row = await d1.prepare(`SELECT * FROM research_runs WHERE id = ?`).bind(runId).first<RunRow>();
  if (!row) throw new Error('run not found');
  return row;
}

async function getStageRows(d1: D1Database, runId: string): Promise<StageRow[]> {
  const res = await d1.prepare(`SELECT * FROM research_stage_runs WHERE run_id = ?`).bind(runId).all<StageRow>();
  return res.results;
}

async function forceRetryNow(d1: D1Database, runId: string, stage: string): Promise<void> {
  await d1
    .prepare(`UPDATE research_stage_runs SET next_retry_at = ? WHERE run_id = ? AND stage_name = ?`)
    .bind(new Date(Date.now() - 1000).toISOString(), runId, stage)
    .run();
}

// Task 4: writes one provider_usage row for a run+stage, the same shape a
// real paid DataForSEO call writes (providers/dataforseo/call.ts), so tests
// can assert that the stage row's cost_usd_micro is the SUM of these rather
// than anything the handler's own output reports.
async function insertProviderUsage(
  d1: D1Database,
  runId: string,
  stage: string,
  costUsdMicro: number
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO provider_usage
        (id, run_id, stage, provider, operation, endpoint_or_model, cache_status, request_count, cost_usd_micro, latency_ms, created_at)
       VALUES (?, ?, ?, 'dataforseo', 'keyword_ideas', 'keywords_data/keyword_ideas', 'miss', 1, ?, 100, ?)`
    )
    .bind(newId('pu'), runId, stage, costUsdMicro, nowIso())
    .run();
}

async function getStageCost(d1: D1Database, runId: string, stage: string): Promise<{ status: string; cost_usd_micro: number }> {
  const row = await d1
    .prepare(`SELECT status, cost_usd_micro FROM research_stage_runs WHERE run_id = ? AND stage_name = ?`)
    .bind(runId, stage)
    .first<{ status: string; cost_usd_micro: number }>();
  if (!row) throw new Error(`stage row not found: ${stage}`);
  return row;
}

describe('processResearchRun', () => {
  // resolve_market (Task 8) makes real DataForSEO catalog GETs; every test in
  // this file drives runs through it without overriding it (a handful of
  // tests below DO override resolve_market to test retry/error-mapping
  // behavior, which takes precedence and never reaches the stub fetch).
  let restoreFetch: () => void;
  beforeEach(() => {
    restoreFetch = installDfsCatalogFetchStub();
  });
  afterEach(() => {
    restoreFetch();
  });

  it('behaviors 1-3: drives a full run stage-by-stage to a terminal status, then is a no-op', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { sent, queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides = { validate_serps_and_questions: stubValidateSerps };

    // Behavior 1: first invocation runs validate_intake, marks it succeeded,
    // sets current_stage, and enqueues { runId }.
    const first = await processResearchRun(env, runId, 'w1', overrides);
    expect(first).toEqual({ advanced: true, runStatus: 'running' });
    expect(sent).toEqual([{ runId }]);

    const rowsAfterFirst = await getStageRows(d1, runId);
    const validateIntakeRow = rowsAfterFirst.find((r) => r.stage_name === 'validate_intake');
    expect(validateIntakeRow?.status).toBe('succeeded');

    const runAfterFirst = await getRun(d1, runId);
    expect(runAfterFirst.current_stage).toBe('validate_intake');

    // Behavior 2: drive the queue loop to completion.
    while (sent.length) {
      sent.pop();
      await processResearchRun(env, runId, 'w1', overrides);
    }

    const finalRun = await getRun(d1, runId);
    // NOTE: the brief's Step 1 text says this lands at `succeeded`. It does
    // not: collect_us_fanout is an optional stage whose stub always returns
    // status 'skipped', and deriveRunStatus (Task 7, run-status.ts, tested
    // explicitly with collect_us_fanout as its own worked example) makes any
    // terminal optional-stage gap fold the run to 'partial', never
    // 'succeeded'. Flagged in the report as a brief/state-machine conflict;
    // this test asserts the actual, already-tested state-machine contract.
    expect(finalRun.status).toBe('partial');
    expect(finalRun.finished_at).toBeTruthy();
    // Task 8 Fix 2: partial_reasons is derived from stage rows, not
    // incrementally appended, so it must already list collect_us_fanout's
    // clean skip by the time the run finishes. refine_clusters (Task 12) is a
    // second gap here: this drive stubs validate_serps_and_questions so no live
    // SERP snapshots exist, and refine_clusters over clusters with zero live
    // coverage completes 'partial' with a no_live_serp_evidence warning by
    // design. overlay_existing_site (Task 18) is a third gap: this existing-site
    // brief's robots/sitemap fetches throw in the harness and its labs fallback
    // returns an empty ranked-keywords response, so it completes 'partial' with
    // inventory_limited. Sorted before comparison because loadGapStageNames has
    // no total ORDER BY (TEXT-PK scan order), so the gap list order is not guaranteed.
    expect(JSON.parse(finalRun.partial_reasons_json).sort()).toEqual(['collect_us_fanout', 'overlay_existing_site', 'refine_clusters']);

    const finalStageRows = await getStageRows(d1, runId);
    expect(finalStageRows.length).toBe(19);
    for (const row of finalStageRows) {
      expect(['succeeded', 'skipped', 'partial', 'failed', 'cancelled']).toContain(row.status);
    }
    const fanoutRow = finalStageRows.find((r) => r.stage_name === 'collect_us_fanout');
    expect(fanoutRow?.status).toBe('skipped');

    // Part E plumbing: rulesetVersionForStage(stage) is stamped onto every
    // completed stage row via completeStage's ruleset_version column, not
    // just baked into the input hash. Clustering/page-plan stages get their
    // real versioned ruleset; every other stage still gets the legacy stub.
    const clusterStageRow = finalStageRows.find((r) => r.stage_name === 'build_provisional_clusters');
    expect(clusterStageRow?.ruleset_version).toBe('cluster-v3');
    const pagePlanStageRow = finalStageRows.find((r) => r.stage_name === 'build_page_plan');
    expect(pagePlanStageRow?.ruleset_version).toBe('pp-v3');
    const legacyStageRow = finalStageRows.find((r) => r.stage_name === 'validate_intake');
    expect(legacyStageRow?.ruleset_version).toBe(LEGACY_RULESET_VERSION);

    const versions = await d1
      .prepare(`SELECT * FROM blueprint_versions WHERE project_id = ?`)
      .bind(projectId)
      .all<BlueprintVersionRow>();
    expect(versions.results.length).toBe(1);
    expect(versions.results[0].run_id).toBe(runId);
    // Task 8 Fix 2: completeness/partial_reasons are derived directly from
    // the stage rows (any skipped/partial stage, or an exhausted optional
    // failure), not from an incrementally-appended run column, so a clean
    // collect_us_fanout skip counts as a gap the same as a throw-and-exhaust
    // would. Status ('partial'), run.partial_reasons_json, and version
    // completeness must all agree.
    expect(versions.results[0].completeness).toBe('partial');
    expect(JSON.parse(versions.results[0].partial_reasons_json).sort()).toEqual(['collect_us_fanout', 'overlay_existing_site', 'refine_clusters']);
    expect(versions.results[0].latest_revision_id).toBeTruthy();

    const revisions = await d1
      .prepare(`SELECT * FROM blueprint_revisions WHERE blueprint_version_id = ?`)
      .bind(versions.results[0].id)
      .all<BlueprintRevisionRow>();
    expect(revisions.results.length).toBe(1);
    expect(revisions.results[0].revision_number).toBe(1);
    expect(versions.results[0].latest_revision_id).toBe(revisions.results[0].id);

    const project = await d1.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first<ProjectRow>();
    expect(project?.latest_blueprint_version_id).toBe(versions.results[0].id);
    expect(project?.latest_blueprint_revision_id).toBe(revisions.results[0].id);
    expect(project?.latest_run_id).toBe(runId);

    // Behavior 3: re-running after completion is a no-op.
    const noop = await processResearchRun(env, runId, 'w1');
    expect(noop).toEqual({ advanced: false, runStatus: 'partial' });
    expect(sent.length).toBe(0);
  });

  it('behavior 4: cancellation before the next stage cancels all non-terminal stage rows and stops the run', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { sent, queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };

    // Drive exactly 3 stages forward.
    for (let i = 0; i < 3; i++) {
      await processResearchRun(env, runId, 'w1');
      sent.pop();
    }
    const rowsAfter3 = await getStageRows(d1, runId);
    expect(rowsAfter3.map((r) => r.stage_name).sort()).toEqual(
      ['validate_intake', 'resolve_market', 'normalize_brief'].sort()
    );
    for (const row of rowsAfter3) expect(row.status).toBe('succeeded');

    // Simulate a stage that is mid-flight (retry_wait, not yet due) when the
    // cancellation lands, so "mark all non-terminal stage rows cancelled"
    // has something non-terminal to actually exercise.
    const briefRow = await d1
      .prepare(`SELECT input_hash FROM project_brief_versions WHERE id = ?`)
      .bind(briefVersionId)
      .first<{ input_hash: string }>();
    const inFlightHash = await buildStageInputHash({
      runId,
      stage: 'plan_research',
      normalizedInputHash: briefRow!.input_hash,
      rulesetVersion: LEGACY_RULESET_VERSION,
    });
    await d1
      .prepare(
        `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, required, attempt_count, next_retry_at)
         VALUES (?, ?, 'plan_research', ?, 'retry_wait', 1, 1, ?)`
      )
      .bind(newId('stagerun'), runId, inFlightHash, new Date(Date.now() + 60_000).toISOString())
      .run();

    await d1.prepare(`UPDATE research_runs SET status = 'cancel_requested' WHERE id = ?`).bind(runId).run();

    const result = await processResearchRun(env, runId, 'w1');
    expect(result).toEqual({ advanced: false, runStatus: 'cancelled' });
    expect(sent.length).toBe(0);

    const run = await getRun(d1, runId);
    expect(run.status).toBe('cancelled');
    expect(run.finished_at).toBeTruthy();

    const rowsAfterCancel = await getStageRows(d1, runId);
    const planResearchRow = rowsAfterCancel.find((r) => r.stage_name === 'plan_research');
    expect(planResearchRow?.status).toBe('cancelled');
    for (const stage of ['validate_intake', 'resolve_market', 'normalize_brief']) {
      expect(rowsAfterCancel.find((r) => r.stage_name === stage)?.status).toBe('succeeded');
    }
  });

  it('behavior 5: stage input hash is per-run, and a same-hash reacquire within a run hits the lease reuse path', async () => {
    const { d1, projectId, briefVersionId, inputHash } = await setup();
    const runA = await seedRun(d1, projectId, briefVersionId);
    const runB = await seedRun(d1, projectId, briefVersionId);
    const { queue: queueA } = makeQueue();
    const { queue: queueB } = makeQueue();
    const envA: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queueA, ...providerFields() };
    const envB: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queueB, ...providerFields() };

    await processResearchRun(envA, runA, 'w1');
    await processResearchRun(envB, runB, 'w1');

    const hashA = await buildStageInputHash({
      runId: runA,
      stage: 'validate_intake',
      normalizedInputHash: inputHash,
      rulesetVersion: LEGACY_RULESET_VERSION,
    });
    const hashB = await buildStageInputHash({
      runId: runB,
      stage: 'validate_intake',
      normalizedInputHash: inputHash,
      rulesetVersion: LEGACY_RULESET_VERSION,
    });
    // Different runId -> different stage hash: nothing is reused across runs.
    expect(hashA).not.toBe(hashB);

    // A retried acquire within the SAME run, same stage, same hash hits reuse.
    const reacquire = await acquireStageLease(d1, {
      runId: runA,
      stage: 'validate_intake',
      stageInputHash: hashA,
      workerId: 'external-retry',
      leaseMs: 60_000,
      required: true,
    });
    expect(reacquire.kind).toBe('reuse');

    const row = await d1
      .prepare(
        `SELECT attempt_count FROM research_stage_runs WHERE run_id = ? AND stage_name = ? AND stage_input_hash = ?`
      )
      .bind(runA, 'validate_intake', hashA)
      .first<{ attempt_count: number }>();
    expect(row?.attempt_count).toBe(1);
  });

  it('behavior 6a: a REQUIRED stage handler that throws lands in retry_wait, then fails the run after 3 attempts', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { sent, queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async () => {
        throw new Error('boom-required');
      },
    };

    await processResearchRun(env, runId, 'w1', overrides); // validate_intake succeeds
    sent.pop();

    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await processResearchRun(env, runId, 'w1', overrides);
      expect(result.advanced).toBe(true);
      if (attempt < 3) {
        expect(result.runStatus).toBe('running');
        // The finalize path surfaces the computed next_retry_at as
        // waitUntil so the queue consumer has something to schedule a
        // delayed wake-up against (RETRY_BACKOFF_MS is 30s).
        expect(result.waitUntil).toBeTruthy();
        const waitUntilMs = Date.parse(result.waitUntil!);
        expect(waitUntilMs).toBeGreaterThan(Date.now());
        expect(waitUntilMs).toBeLessThanOrEqual(Date.now() + 30_000 + 5_000);
        const row = await getStageRows(d1, runId);
        const resolveMarketRow = row.find((r) => r.stage_name === 'resolve_market');
        expect(resolveMarketRow?.status).toBe('retry_wait');
        await forceRetryNow(d1, runId, 'resolve_market');
      } else {
        expect(result.runStatus).toBe('failed');
      }
    }
    expect(sent.length).toBe(0);

    const run = await getRun(d1, runId);
    expect(run.status).toBe('failed');
    expect(run.finished_at).toBeTruthy();

    const rows = await getStageRows(d1, runId);
    const resolveMarketRow = rows.find((r) => r.stage_name === 'resolve_market');
    expect(resolveMarketRow?.status).toBe('failed');
    expect(resolveMarketRow?.safe_error_code).toBe('internal_error');
    expect(resolveMarketRow?.attempt_count).toBe(3);
  });

  it('sanitizes a raw (non-BlueprintApiError) stage failure before it reaches the stage row', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const rawMessage =
      'DataForSEO auth failed for account ops@client-example.com against https://internal-provider.example.com/v3/task';
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async () => {
        throw new Error(rawMessage);
      },
    };

    await processResearchRun(env, runId, 'w1', overrides); // validate_intake succeeds
    await processResearchRun(env, runId, 'w1', overrides); // resolve_market throws -> retry_wait

    const rows = await getStageRows(d1, runId);
    const resolveMarketRow = rows.find((r) => r.stage_name === 'resolve_market');
    expect(resolveMarketRow?.safe_error_code).toBe('internal_error');
    expect(resolveMarketRow?.safe_error_message).toBeTruthy();
    expect(resolveMarketRow?.safe_error_message).not.toContain('ops@client-example.com');
    expect(resolveMarketRow?.safe_error_message).not.toContain('internal-provider.example.com');
    expect(resolveMarketRow?.safe_error_message).toBe('The research step failed.');
  });

  it('a BlueprintValidationError from a REQUIRED stage fails immediately on attempt 1 (permanent, no retry_wait) with code invalid_input', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { sent, queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async () => {
        throw new BlueprintValidationError('invalid_input', [
          { path: 'languageCode', message: 'Unsupported market: language "xx" is not available for SERP research in US.' },
        ]);
      },
    };

    await processResearchRun(env, runId, 'w1', overrides); // validate_intake succeeds
    sent.pop();
    const result = await processResearchRun(env, runId, 'w1', overrides); // resolve_market throws validation error

    // Permanent user-correctable failure: no retry_wait, the run fails on
    // the FIRST attempt with the validation signal preserved (retrying an
    // unsupported market can never succeed; only a brief change can).
    expect(result.runStatus).toBe('failed');

    const rows = await getStageRows(d1, runId);
    const resolveMarketRow = rows.find((r) => r.stage_name === 'resolve_market');
    expect(resolveMarketRow?.status).toBe('failed');
    expect(resolveMarketRow?.attempt_count).toBe(1);
    expect(resolveMarketRow?.safe_error_code).toBe('invalid_input');
    expect(resolveMarketRow?.safe_error_message).toBe(
      'Unsupported market: language "xx" is not available for SERP research in US.'
    );

    const run = await getRun(d1, runId);
    expect(run.status).toBe('failed');
    expect(run.finished_at).toBeTruthy();
  });

  it('preserves the code and message of a stage failure that already threw a BlueprintApiError', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async () => {
        throw new BlueprintApiError(
          'provider_rate_limited',
          'The research provider rate-limited this request. It will be retried automatically.'
        );
      },
    };

    await processResearchRun(env, runId, 'w1', overrides); // validate_intake succeeds
    await processResearchRun(env, runId, 'w1', overrides); // resolve_market throws -> retry_wait

    const rows = await getStageRows(d1, runId);
    const resolveMarketRow = rows.find((r) => r.stage_name === 'resolve_market');
    expect(resolveMarketRow?.safe_error_code).toBe('provider_rate_limited');
    expect(resolveMarketRow?.safe_error_message).toBe(
      'The research provider rate-limited this request. It will be retried automatically.'
    );
  });

  it('behavior 6b: an OPTIONAL stage handler that throws is skipped after 3 attempts and the run continues to partial', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      discover_competitors: async () => {
        throw new Error('boom-optional');
      },
      validate_serps_and_questions: stubValidateSerps,
    };

    // 5 stages precede discover_competitors in BLUEPRINT_STAGES order.
    for (let i = 0; i < 5; i++) {
      await processResearchRun(env, runId, 'w1', overrides);
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
      await processResearchRun(env, runId, 'w1', overrides);
      if (attempt < 3) await forceRetryNow(d1, runId, 'discover_competitors');
    }

    const midRows = await getStageRows(d1, runId);
    const discoverRow = midRows.find((r) => r.stage_name === 'discover_competitors');
    expect(discoverRow?.status).toBe('skipped');
    expect(discoverRow?.attempt_count).toBe(3);

    const runMid = await getRun(d1, runId);
    expect(JSON.parse(runMid.partial_reasons_json)).toContain('discover_competitors');

    // Drive the remaining stages to completion (bounded, not sent-driven).
    let result: { advanced: boolean; runStatus: string } = { advanced: true, runStatus: runMid.status };
    for (let i = 0; i < 20 && result.advanced; i++) {
      result = await processResearchRun(env, runId, 'w1', overrides);
    }

    const run = await getRun(d1, runId);
    expect(run.status).toBe('partial');

    const versions = await d1
      .prepare(`SELECT * FROM blueprint_versions WHERE project_id = ? AND run_id = ?`)
      .bind(projectId, runId)
      .all<BlueprintVersionRow>();
    expect(versions.results.length).toBe(1);
    expect(versions.results[0].completeness).toBe('partial');
    expect(JSON.parse(versions.results[0].partial_reasons_json)).toContain('discover_competitors');
  });

  it('Task 13: validate_serps_and_questions honors its per-stage maxAttempts: 12 -- a 4th attempt is still scheduled (retry_wait), not skipped', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      validate_serps_and_questions: async () => {
        throw new Error('serp-still-pending');
      },
    };

    // 10 stages precede validate_serps_and_questions in BLUEPRINT_STAGES
    // order (validate_intake through build_provisional_clusters); every one
    // of them is either a Phase 2 deterministic stub or a real Task 8-12
    // handler that succeeds cleanly against the DFS catalog stub installed
    // in this describe block's beforeEach.
    for (let i = 0; i < 10; i++) {
      await processResearchRun(env, runId, 'w1', overrides);
    }

    // Under the GENERIC MAX_ATTEMPTS (3), a 4th attempt would already have
    // been skipped (see behavior 6b above). This stage's maxAttempts: 12
    // override must still schedule it.
    for (let attempt = 1; attempt <= 4; attempt++) {
      await processResearchRun(env, runId, 'w1', overrides);
      const rows = await getStageRows(d1, runId);
      const row = rows.find((r) => r.stage_name === 'validate_serps_and_questions');
      expect(row?.status).toBe('retry_wait');
      expect(row?.attempt_count).toBe(attempt);
      expect(row?.safe_error_code).toBe('internal_error'); // generic Error, not SerpTasksPendingError, here
      if (attempt < 4) await forceRetryNow(d1, runId, 'validate_serps_and_questions');
    }
  });

  it('Task 13: a quota error during a real task_get poll lands the stage in retry_wait with safe_error_code provider_quota_exhausted and leaves serp rows posted', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    // Run the REAL handler (it is exported but not registered until Task
    // 14's sweep), driven through the processor so the stage row's
    // safe_error_code is what gets asserted, not just the thrown error.
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      validate_serps_and_questions: validateSerpsAndQuestionsHandler,
    };

    for (let i = 0; i < 10; i++) {
      await processResearchRun(env, runId, 'w1', overrides);
    }

    // Pre-seed one posted dfs_serp_tasks row so the handler takes the
    // collect (task_get) path rather than the first-attempt post path.
    const serpRowId = newId('serpt');
    await d1
      .prepare(
        `INSERT INTO dfs_serp_tasks (id, run_id, keyword, service_area_id, location_code, provider_task_id, status, posted_at)
         VALUES (?, ?, 'emergency plumbing austin', 'a1', 1023191, 'task-quota', 'posted', ?)`
      )
      .bind(serpRowId, runId, nowIso())
      .run();

    // task_get hits the provider quota wall; every other endpoint keeps
    // being served by the catalog stub installed in beforeEach.
    const stubFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).includes('/serp/google/organic/task_get/')) {
        throw new DataForSeoQuotaError('daily limit reached for ops@internal.example');
      }
      return (stubFetch as any)(url, init);
    }) as any;

    await processResearchRun(env, runId, 'w1', overrides);

    const rows = await getStageRows(d1, runId);
    const row = rows.find((r) => r.stage_name === 'validate_serps_and_questions');
    expect(row?.status).toBe('retry_wait');
    expect(row?.safe_error_code).toBe('provider_quota_exhausted');
    expect(row?.safe_error_message).toBe(
      'The research provider daily quota is exhausted. The run will resume when quota is available.'
    );

    const serpRow = await d1
      .prepare(`SELECT status FROM dfs_serp_tasks WHERE id = ?`)
      .bind(serpRowId)
      .first<{ status: string }>();
    expect(serpRow?.status).toBe('posted');
  });

  it('Task 13: a thrown SerpTasksPendingError is classified as provider_timeout (not internal_error) and lands in retry_wait', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      validate_serps_and_questions: async () => {
        throw new SerpTasksPendingError('SERP tasks posted; awaiting task_get results');
      },
    };

    for (let i = 0; i < 10; i++) {
      await processResearchRun(env, runId, 'w1', overrides);
    }
    await processResearchRun(env, runId, 'w1', overrides);

    const rows = await getStageRows(d1, runId);
    const row = rows.find((r) => r.stage_name === 'validate_serps_and_questions');
    expect(row?.status).toBe('retry_wait');
    expect(row?.safe_error_code).toBe('provider_timeout');
    expect(row?.safe_error_message).toBe(
      'The research provider timed out. It will be retried automatically.'
    );
  });

  it('behavior 7 (Task 8 Fix 1): a cancel_requested set concurrently mid-stage is not clobbered back to running, and the next invocation finishes the cancellation', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { sent, queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };

    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      validate_intake: async (ctx) => {
        // Simulate a cancel request landing on the D1 row while this
        // stage's handler is still executing (e.g. the user hit Cancel
        // mid-request). The in-memory `run.status` this invocation started
        // with is now stale.
        await d1.prepare(`UPDATE research_runs SET status = 'cancel_requested' WHERE id = ?`).bind(ctx.runId).run();
        return { output: { stage: 'validate_intake' as const, valid: true } };
      },
    };

    const result = await processResearchRun(env, runId, 'w1', overrides);

    // The stage's own row write is not fenced (completeStage is a CAS on
    // the lease, not on run status), so it still completes. But the
    // finalize write that would set the run row back to 'running' and
    // enqueue the next stage must be fenced out by the concurrent cancel.
    expect(result).toEqual({ advanced: false, runStatus: 'cancel_requested' });
    expect(sent.length).toBe(0);

    const stageRows = await getStageRows(d1, runId);
    expect(stageRows.find((r) => r.stage_name === 'validate_intake')?.status).toBe('succeeded');

    const runAfterFirst = await getRun(d1, runId);
    expect(runAfterFirst.status).toBe('cancel_requested');
    expect(runAfterFirst.current_stage).toBeNull();

    // The next invocation sees the sticky cancel_requested at the entry
    // guard and finishes the cancellation as normal (behavior 4's path).
    const second = await processResearchRun(env, runId, 'w1');
    expect(second).toEqual({ advanced: false, runStatus: 'cancelled' });
    expect(sent.length).toBe(0);

    const runFinal = await getRun(d1, runId);
    expect(runFinal.status).toBe('cancelled');
    expect(runFinal.finished_at).toBeTruthy();

    const stageRowsFinal = await getStageRows(d1, runId);
    expect(stageRowsFinal.find((r) => r.stage_name === 'validate_intake')?.status).toBe('succeeded');
  });

  it('behavior 8 (Task 8 Fix 1): duplicate delivery on an already-cancelled run is a pure no-op', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { sent, queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };

    await d1
      .prepare(`UPDATE research_runs SET status = 'cancelled', finished_at = ? WHERE id = ?`)
      .bind(nowIso(), runId)
      .run();

    const result = await processResearchRun(env, runId, 'w1');
    expect(result).toEqual({ advanced: false, runStatus: 'cancelled' });
    expect(sent.length).toBe(0);

    const stageRows = await getStageRows(d1, runId);
    expect(stageRows.length).toBe(0);

    const run = await getRun(d1, runId);
    expect(run.status).toBe('cancelled');
  });

  // Task 4: stage cost now comes from SUM(provider_usage), not from a
  // handler-reported stageCostUsdMicro output field (that field is kept,
  // but purely informational -- see research-handlers.ts). This test used
  // to assert the opposite (Task 10's original forwarding behavior); it is
  // rewritten here to prove the new source of truth, deliberately using a
  // DIFFERENT amount on the output field than on the provider_usage row so
  // a regression back to output-forwarding would be caught immediately.
  it('Task 4: cost_usd_micro comes from SUM(provider_usage), not the handler-reported stageCostUsdMicro output field', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async () => {
        await insertProviderUsage(d1, runId, 'resolve_market', 99_000);
        return { output: { stage: 'resolve_market' as const, stub: true, stageCostUsdMicro: 123_456 } };
      },
    };

    await processResearchRun(env, runId, 'w1', overrides); // validate_intake
    await processResearchRun(env, runId, 'w1', overrides); // resolve_market (overridden, writes a usage row)

    const stageRow = await getStageCost(d1, runId, 'resolve_market');
    expect(stageRow.cost_usd_micro).toBe(99_000);
  });

  it("Task 4: a stage with no provider_usage rows at all leaves cost_usd_micro at 0 (the SUM's default)", async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };

    await processResearchRun(env, runId, 'w1'); // validate_intake: real handler, no provider_usage rows

    const stageRow = await getStageCost(d1, runId, 'validate_intake');
    expect(stageRow.cost_usd_micro).toBe(0);
  });

  it('Task 4: a handler output with NO stageCostUsdMicro field (the validate_serps shape) still gets cost_usd_micro = SUM(provider_usage)', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async () => {
        await insertProviderUsage(d1, runId, 'resolve_market', 75_000);
        // No stageCostUsdMicro field on this output at all.
        return { output: { stage: 'resolve_market' as const, stub: true } };
      },
    };

    await processResearchRun(env, runId, 'w1', overrides); // validate_intake
    await processResearchRun(env, runId, 'w1', overrides); // resolve_market (overridden, writes a usage row)

    const stageRow = await getStageCost(d1, runId, 'resolve_market');
    expect(stageRow.cost_usd_micro).toBe(75_000);
  });

  it('Task 4: sums provider_usage across TWO attempts (first throws after writing a row, retry completes and writes another) into the completed stage row', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async (ctx) => {
        if (ctx.attempt === 1) {
          await insertProviderUsage(d1, runId, 'resolve_market', 40_000);
          throw new Error('boom-transient');
        }
        await insertProviderUsage(d1, runId, 'resolve_market', 60_000);
        return { output: { stage: 'resolve_market' as const, stub: true } };
      },
    };

    await processResearchRun(env, runId, 'w1', overrides); // validate_intake succeeds
    await processResearchRun(env, runId, 'w1', overrides); // resolve_market attempt 1: writes a row, throws -> retry_wait
    await forceRetryNow(d1, runId, 'resolve_market');
    await processResearchRun(env, runId, 'w1', overrides); // resolve_market attempt 2: writes another row, succeeds

    const stageRow = await getStageCost(d1, runId, 'resolve_market');
    expect(stageRow.status).toBe('succeeded');
    expect(stageRow.cost_usd_micro).toBe(100_000);
  });

  it('Task 4: a REQUIRED stage that fails permanently after writing provider_usage rows on earlier attempts carries their SUM on the failed stage row', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async () => {
        await insertProviderUsage(d1, runId, 'resolve_market', 20_000);
        throw new Error('boom-required');
      },
    };

    await processResearchRun(env, runId, 'w1', overrides); // validate_intake succeeds

    for (let attempt = 1; attempt <= 3; attempt++) {
      await processResearchRun(env, runId, 'w1', overrides);
      if (attempt < 3) await forceRetryNow(d1, runId, 'resolve_market');
    }

    const stageRow = await getStageCost(d1, runId, 'resolve_market');
    expect(stageRow.status).toBe('failed');
    // Three attempts, each writing a 20_000 provider_usage row before
    // throwing: the failed row must carry the SUM of all three, proving the
    // terminal-failure path (failStage) sums cost the same way the
    // success path (completeStage) does.
    expect(stageRow.cost_usd_micro).toBe(60_000);
  });

  // Finding 1 (final whole-branch review): collect_keyword_evidence is a
  // REQUIRED stage that can end 'partial' on its own (enrichmentTruncated),
  // not just via retry exhaustion. Before the fix, deriveRunStatus's inline
  // gap check only counted a 'partial' row as a gap when it was optional, so
  // this run would have finished 'succeeded' while partial_reasons_json
  // (loadGapStageNames, which counted ANY 'partial' row) still named
  // collect_keyword_evidence -- the exact disagreement Finding 1 flagged.
  it('Finding 1: a REQUIRED stage handler that reports status partial directly degrades the whole run to partial, and the stage name appears in partial_reasons', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      collect_keyword_evidence: async () => ({
        output: { stage: 'collect_keyword_evidence' as const, enrichmentTruncated: true },
        status: 'partial' as const,
      }),
      validate_serps_and_questions: stubValidateSerps,
    };

    let result: { advanced: boolean; runStatus: string } = { advanced: true, runStatus: 'running' };
    for (let i = 0; i < 25 && result.advanced; i++) {
      result = await processResearchRun(env, runId, 'w1', overrides);
    }

    const finalRun = await getRun(d1, runId);
    expect(finalRun.status).toBe('partial');
    expect(JSON.parse(finalRun.partial_reasons_json)).toContain('collect_keyword_evidence');

    const stageRows = await getStageRows(d1, runId);
    const stageRow = stageRows.find((r) => r.stage_name === 'collect_keyword_evidence');
    expect(stageRow?.status).toBe('partial');
    expect(stageRow?.required).toBe(1);

    const versions = await d1
      .prepare(`SELECT * FROM blueprint_versions WHERE project_id = ? AND run_id = ?`)
      .bind(projectId, runId)
      .all<BlueprintVersionRow>();
    expect(versions.results.length).toBe(1);
    expect(versions.results[0].completeness).toBe('partial');
    expect(JSON.parse(versions.results[0].partial_reasons_json)).toContain('collect_keyword_evidence');
  });
});
