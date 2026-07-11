import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import { buildStageInputHash } from '../domain/hash';
import { acquireStageLease } from '../db/leases';
import type { BlueprintStage } from '../contracts/enums';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import type { StageHandler } from './handlers';

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

// Stub provider bindings/credentials this file's tests never actually
// exercise (no handler override here reads ctx.env), but processResearchRun
// now requires a BlueprintProviderEnv, so every constructed env needs these
// fields to satisfy the type.
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
       VALUES (?, ?, ?, ?, 'queued', 0, 0, 'u1', ?)`
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

describe('processResearchRun', () => {
  it('behaviors 1-3: drives a full run stage-by-stage to a terminal status, then is a no-op', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { sent, queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };

    // Behavior 1: first invocation runs validate_intake, marks it succeeded,
    // sets current_stage, and enqueues { runId }.
    const first = await processResearchRun(env, runId, 'w1');
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
      await processResearchRun(env, runId, 'w1');
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
    // clean skip by the time the run finishes.
    expect(JSON.parse(finalRun.partial_reasons_json)).toEqual(['collect_us_fanout']);

    const finalStageRows = await getStageRows(d1, runId);
    expect(finalStageRows.length).toBe(19);
    for (const row of finalStageRows) {
      expect(['succeeded', 'skipped', 'partial', 'failed', 'cancelled']).toContain(row.status);
    }
    const fanoutRow = finalStageRows.find((r) => r.stage_name === 'collect_us_fanout');
    expect(fanoutRow?.status).toBe('skipped');

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
    expect(JSON.parse(versions.results[0].partial_reasons_json)).toEqual(['collect_us_fanout']);
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
      rulesetVersion: 'phase2-stub',
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
      rulesetVersion: 'phase2-stub',
    });
    const hashB = await buildStageInputHash({
      runId: runB,
      stage: 'validate_intake',
      normalizedInputHash: inputHash,
      rulesetVersion: 'phase2-stub',
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

  it('behavior 6b: an OPTIONAL stage handler that throws is skipped after 3 attempts and the run continues to partial', async () => {
    const { d1, projectId, briefVersionId } = await setup();
    const runId = await seedRun(d1, projectId, briefVersionId);
    const { queue } = makeQueue();
    const env: BlueprintProviderEnv = { BLUEPRINT_DB: d1, BLUEPRINT_QUEUE: queue, ...providerFields() };
    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      discover_competitors: async () => {
        throw new Error('boom-optional');
      },
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
});
