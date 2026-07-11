import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { handleBlueprintRequest } from '../routes/router';
import { newId } from '../db/util';
import { processResearchRun } from './process-run';
import type { BlueprintProviderEnv } from './process-run';
import type { StageHandler } from './handlers';
import type { AuthUser } from '../../auth/google';
import type {
  ApiSuccess,
  ApiFailure,
  ProjectView,
  ResearchEstimate,
  ResearchRunView,
} from '../contracts/api';
import type { BlueprintStage } from '../contracts/enums';

// This file drives the FULL Phase 2 orchestration stack end to end through
// the real route handlers (handleBlueprintRequest) plus the real
// processResearchRun stage-by-stage processor, exactly as routes/*.test.ts
// and orchestration/process-run.test.ts already exercise each piece in
// isolation. It is TEST-ONLY: an assertion failing here means an earlier
// Phase 2 task drifted from its own settled contract, not that this file's
// expectations are wrong. Do not "fix" production code to make this pass.
//
// Expired lease recovery + stale worker fencing are covered by
// db/leases.test.ts (behaviors 3-4). Concurrent budget reservations are
// covered by db/budget.test.ts. Neither is duplicated here.

const adminUser = {
  id: 'u1',
  google_id: 'g1',
  email: 'nico@airankingskool.com',
  name: 'Nico',
  avatar_url: '',
  subscription_tier: 'pro',
  is_community_member: false,
  is_admin: true,
  credits_used: 0,
} as AuthUser;

export function fakeEnv(): BlueprintProviderEnv & { BLUEPRINT_KV: unknown; BLUEPRINT_QUEUE: { sent: unknown[]; send: (body: unknown) => Promise<void> } } {
  const { d1 } = createTestDb();
  const sent: unknown[] = [];
  return {
    BLUEPRINT_DB: d1,
    BLUEPRINT_QUEUE: { sent, send: async (body: unknown) => void sent.push(body) },
    BLUEPRINT_KV: { put: async () => undefined },
    KV: (() => {
      const m = new Map<string, string>();
      return {
        get: async (k: string) => m.get(k) ?? null,
        put: async (k: string, v: string) => { m.set(k, v); },
        delete: async (k: string) => { m.delete(k); },
      };
    })() as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: (() => {
      const m = new Map<string, string>();
      return {
        put: async (k: string, v: string) => { m.set(k, v); },
        get: async (k: string) => (m.has(k) ? { text: async () => m.get(k)! } : null),
      };
    })() as unknown as R2Bucket,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
  } as any;
}

function makeRequest(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Request {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function call(
  env: any,
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<Response> {
  const method = opts.method ?? 'GET';
  // Mirrors index.ts: `path` dispatched to the router is url.pathname only
  // (no query string), matching routes/projects.test.ts's `call` helper.
  const pathname = path.split('?')[0];
  return handleBlueprintRequest(makeRequest(path, opts), env, adminUser, pathname, method);
}

// Sample brief per the task brief: 2 services, 1 primary area with uniqueProof.
const SAMPLE_BRIEF = {
  businessName: 'Aqua Plumbing',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'en',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning', priority: 'secondary' as const },
  ],
  serviceAreas: [
    { clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true, uniqueProof: ['Office on South Lamar'] },
  ],
};

async function createProject(env: any, key = newId('idem'), body: unknown = SAMPLE_BRIEF) {
  const res = await call(env, '/api/blueprint/v1/projects', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': key },
  });
  const json = (await res.json()) as ApiSuccess<ProjectView>;
  return { res, json };
}

async function createEstimate(env: any, projectId: string): Promise<ResearchEstimate> {
  const res = await call(env, `/api/blueprint/v1/projects/${projectId}/research-estimates`, {
    method: 'POST',
    body: {},
  });
  const body = (await res.json()) as ApiSuccess<ResearchEstimate>;
  return body.data;
}

async function startRun(
  env: any,
  projectId: string,
  estimateId: string,
  key: string
): Promise<{ res: Response; json: ApiSuccess<ResearchRunView> }> {
  const res = await call(env, `/api/blueprint/v1/projects/${projectId}/research-runs`, {
    method: 'POST',
    body: {
      estimateId,
      acceptedDataForSeoCeilingUsd: '5.00',
      acceptedOpenRouterCeilingUsd: '2.00',
    },
    headers: { 'Idempotency-Key': key },
  });
  const json = (await res.json()) as ApiSuccess<ResearchRunView>;
  return { res, json };
}

// Standard drain: pops every queued message and runs it to completion. This
// is correct whenever every stage attempt either advances immediately or
// terminates the run outright -- i.e. whenever nothing lands in retry_wait,
// since a 'wait' outcome is never re-enqueued by processResearchRun itself
// (see process-run.ts's finalizeStageAttempt: the 'wait' branch updates the
// run row but does not call BLUEPRINT_QUEUE.send).
export async function drainQueue(
  env: BlueprintProviderEnv,
  sent: unknown[],
  workerId = 'w1',
  overrides?: Partial<Record<BlueprintStage, StageHandler>>,
  maxIterations = 200
): Promise<void> {
  let iterations = 0;
  while (sent.length) {
    if (iterations++ > maxIterations) {
      throw new Error(`drainQueue exceeded ${maxIterations} iterations without settling`);
    }
    const msg = sent.pop() as { runId: string };
    await processResearchRun(env, msg.runId, workerId, overrides);
  }
}

async function getRunStatus(d1: D1Database, runId: string): Promise<string> {
  const row = await d1.prepare(`SELECT status FROM research_runs WHERE id = ?`).bind(runId).first<{ status: string }>();
  if (!row) throw new Error(`run not found: ${runId}`);
  return row.status;
}

async function getStageRow(
  d1: D1Database,
  runId: string,
  stage: string
): Promise<{ status: string; attempt_count: number } | null> {
  return d1
    .prepare(`SELECT status, attempt_count FROM research_stage_runs WHERE run_id = ? AND stage_name = ?`)
    .bind(runId, stage)
    .first<{ status: string; attempt_count: number }>();
}

const TERMINAL_STATUSES = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

// A REQUIRED stage stuck in retry_wait is never redelivered by the queue in
// this in-memory harness (the 30s RETRY_BACKOFF_MS in process-run.ts is real
// wall-clock time, and finalizeStageAttempt does not enqueue a 'wait'
// outcome). A real Cloudflare Queue redelivers the message once the backoff
// elapses; here we simulate that redelivery by forcing next_retry_at into
// the past (the same technique orchestration/process-run.test.ts's
// forceRetryNow helper uses for behavior 6a) and invoking
// processResearchRun directly, standing in for the queue message that would
// eventually be redelivered. Bounded to 10 iterations per the task brief.
async function driveRequiredStageToFailure(
  env: BlueprintProviderEnv,
  d1: D1Database,
  runId: string,
  stage: string,
  overrides: Partial<Record<BlueprintStage, StageHandler>>,
  maxIterations = 10
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const status = await getRunStatus(d1, runId);
    if (TERMINAL_STATUSES.has(status)) return;
    await d1
      .prepare(`UPDATE research_stage_runs SET next_retry_at = ? WHERE run_id = ? AND stage_name = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), runId, stage)
      .run();
    await processResearchRun(env, runId, 'w1', overrides);
  }
  const finalStatus = await getRunStatus(d1, runId);
  if (!TERMINAL_STATUSES.has(finalStatus)) {
    throw new Error(`run ${runId} did not reach a terminal status within ${maxIterations} iterations (stuck at ${finalStatus})`);
  }
}

describe('Phase 2 orchestration acceptance', () => {
  it('acceptance: idempotent run start replays the same runId for the same key+body, 409s on same key + different body', async () => {
    const env = fakeEnv();
    const { json: project } = await createProject(env);
    const estimate = await createEstimate(env, project.data.id);
    const key = newId('idem');
    const requestBody = {
      estimateId: estimate.estimateId,
      acceptedDataForSeoCeilingUsd: '5.00',
      acceptedOpenRouterCeilingUsd: '2.00',
    };

    const first = await call(env, `/api/blueprint/v1/projects/${project.data.id}/research-runs`, {
      method: 'POST',
      body: requestBody,
      headers: { 'Idempotency-Key': key },
    });
    const firstBody = (await first.json()) as ApiSuccess<ResearchRunView>;

    // Same key + same body -> same runId, no second run created.
    const second = await call(env, `/api/blueprint/v1/projects/${project.data.id}/research-runs`, {
      method: 'POST',
      body: requestBody,
      headers: { 'Idempotency-Key': key },
    });
    const secondBody = (await second.json()) as ApiSuccess<ResearchRunView>;
    expect(secondBody.data.id).toBe(firstBody.data.id);

    // Same key + different body -> 409.
    const conflict = await call(env, `/api/blueprint/v1/projects/${project.data.id}/research-runs`, {
      method: 'POST',
      body: { ...requestBody, acceptedOpenRouterCeilingUsd: '3.00' },
      headers: { 'Idempotency-Key': key },
    });
    expect(conflict.status).toBe(409);
    const conflictBody = (await conflict.json()) as ApiFailure;
    expect(conflictBody.error.code).toBe('stage_conflict');
  });

  it('acceptance: a full clean drive ends partial (collect_us_fanout gap), every executed stage attempt_count 1, blueprint published as partial', async () => {
    const env = fakeEnv();
    const { json: project } = await createProject(env);
    const estimate = await createEstimate(env, project.data.id);
    const { json: run } = await startRun(env, project.data.id, estimate.estimateId, newId('idem'));
    expect(run.data.status).toBe('queued');

    await drainQueue(env, env.BLUEPRINT_QUEUE.sent);

    const finalStatus = await getRunStatus(env.BLUEPRINT_DB, run.data.id);
    // Settled semantics: collect_us_fanout's stub always reports 'skipped'
    // (an optional-stage gap), and deriveRunStatus folds any terminal gap to
    // 'partial', never 'succeeded' (see process-run.test.ts behaviors 1-3
    // and run-status.ts's own tests). This is a declared Phase 2 gap, not a
    // bug in this test.
    expect(finalStatus).toBe('partial');

    const runRow = await env.BLUEPRINT_DB
      .prepare(`SELECT partial_reasons_json FROM research_runs WHERE id = ?`)
      .bind(run.data.id)
      .first<{ partial_reasons_json: string }>();
    expect(JSON.parse(runRow!.partial_reasons_json)).toEqual(['collect_us_fanout']);

    const stageRows = await env.BLUEPRINT_DB
      .prepare(`SELECT stage_name, status, attempt_count FROM research_stage_runs WHERE run_id = ?`)
      .bind(run.data.id)
      .all<{ stage_name: string; status: string; attempt_count: number }>();
    expect(stageRows.results.length).toBe(19);
    for (const row of stageRows.results) {
      // Every executed stage on a clean drive (no injected failures) reaches
      // its terminal outcome on the first attempt.
      expect(row.attempt_count).toBe(1);
    }
    expect(stageRows.results.find((r) => r.stage_name === 'collect_us_fanout')?.status).toBe('skipped');

    const versionRow = await env.BLUEPRINT_DB
      .prepare(`SELECT completeness, partial_reasons_json FROM blueprint_versions WHERE run_id = ?`)
      .bind(run.data.id)
      .first<{ completeness: string; partial_reasons_json: string }>();
    expect(versionRow?.completeness).toBe('partial');
    expect(JSON.parse(versionRow!.partial_reasons_json)).toEqual(['collect_us_fanout']);
  });

  it('acceptance: cancellation mid-drain ends the run cancelled with no blueprint_versions row published', async () => {
    const env = fakeEnv();
    const { json: project } = await createProject(env);
    const estimate = await createEstimate(env, project.data.id);
    const { json: run } = await startRun(env, project.data.id, estimate.estimateId, newId('idem'));
    const sent = env.BLUEPRINT_QUEUE.sent;

    // Drive a few stages forward, then cancel via the route mid-drain.
    for (let i = 0; i < 3 && sent.length; i++) {
      const msg = sent.pop() as { runId: string };
      await processResearchRun(env, msg.runId, 'w1');
    }

    const cancelRes = await call(env, `/api/blueprint/v1/research-runs/${run.data.id}/cancel`, { method: 'POST' });
    expect(cancelRes.status).toBe(202);
    const cancelBody = (await cancelRes.json()) as ApiSuccess<ResearchRunView>;
    expect(cancelBody.data.status).toBe('cancel_requested');

    await drainQueue(env, sent);

    const finalStatus = await getRunStatus(env.BLUEPRINT_DB, run.data.id);
    expect(finalStatus).toBe('cancelled');

    const versionRow = await env.BLUEPRINT_DB
      .prepare(`SELECT id FROM blueprint_versions WHERE run_id = ?`)
      .bind(run.data.id)
      .first<{ id: string }>();
    expect(versionRow).toBeNull();
  });

  it('acceptance: retry after a required-stage failure does not rerun succeeded stages, and the run completes', async () => {
    const env = fakeEnv();
    const { json: project } = await createProject(env);
    const estimate = await createEstimate(env, project.data.id);
    const { json: run } = await startRun(env, project.data.id, estimate.estimateId, newId('idem'));
    const runId = run.data.id;
    const sent = env.BLUEPRINT_QUEUE.sent;

    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      validate_blueprint: async () => {
        throw new Error('boom-validate-blueprint');
      },
    };

    // Drive forward through the normal queue drain until the injected
    // failure lands in retry_wait. validate_blueprint is REQUIRED (Task 7
    // stage registry), so nextRunnableStage blocks the entire run behind it
    // and the standard drain naturally empties the queue once it's reached
    // (see drainQueue's docstring: a 'wait' outcome is never re-enqueued).
    await drainQueue(env, sent, 'w1', overrides);
    expect(sent.length).toBe(0);

    let stageRow = await getStageRow(env.BLUEPRINT_DB, runId, 'validate_blueprint');
    expect(stageRow?.status).toBe('retry_wait');
    expect(stageRow?.attempt_count).toBe(1);

    // Force the remaining retry attempts to their terminal 'failed' outcome
    // (MAX_ATTEMPTS = 3 in process-run.ts).
    await driveRequiredStageToFailure(env, env.BLUEPRINT_DB, runId, 'validate_blueprint', overrides);

    expect(await getRunStatus(env.BLUEPRINT_DB, runId)).toBe('failed');
    stageRow = await getStageRow(env.BLUEPRINT_DB, runId, 'validate_blueprint');
    expect(stageRow?.status).toBe('failed');
    expect(stageRow?.attempt_count).toBe(3);

    // A stage that succeeded before the failure keeps its single attempt.
    const validateIntakeBeforeRetry = await getStageRow(env.BLUEPRINT_DB, runId, 'validate_intake');
    expect(validateIntakeBeforeRetry?.status).toBe('succeeded');
    expect(validateIntakeBeforeRetry?.attempt_count).toBe(1);

    // Retry via the route: resets only the failed stage, requeues the run.
    const retryRes = await call(env, `/api/blueprint/v1/research-runs/${runId}/retry`, { method: 'POST', body: {} });
    expect(retryRes.status).toBe(202);
    const retryBody = (await retryRes.json()) as ApiSuccess<ResearchRunView>;
    expect(retryBody.data.status).toBe('queued');
    const resetValidateBlueprint = retryBody.data.stages.find((s) => s.stage === 'validate_blueprint');
    expect(resetValidateBlueprint?.status).toBe('pending');
    expect(resetValidateBlueprint?.attemptCount).toBe(0);

    // Drain WITHOUT the failing override: validate_blueprint now succeeds
    // for real and the run proceeds to a terminal status.
    await drainQueue(env, sent, 'w1');

    const finalStatus = await getRunStatus(env.BLUEPRINT_DB, runId);
    // Same declared gap as the clean-drive acceptance case: collect_us_fanout
    // was already terminally 'skipped' before the failure, so the retried
    // run still lands on 'partial', not 'succeeded'.
    expect(finalStatus).toBe('partial');

    const finalValidateBlueprint = await getStageRow(env.BLUEPRINT_DB, runId, 'validate_blueprint');
    expect(finalValidateBlueprint?.status).toBe('succeeded');
    expect(finalValidateBlueprint?.attempt_count).toBe(1);

    // The stage that succeeded before the failure was never touched by the
    // retry: still attempt_count 1, not rerun.
    const validateIntakeAfterRetry = await getStageRow(env.BLUEPRINT_DB, runId, 'validate_intake');
    expect(validateIntakeAfterRetry?.status).toBe('succeeded');
    expect(validateIntakeAfterRetry?.attempt_count).toBe(1);

    const versionRow = await env.BLUEPRINT_DB
      .prepare(`SELECT id FROM blueprint_versions WHERE run_id = ?`)
      .bind(runId)
      .first<{ id: string }>();
    expect(versionRow).toBeTruthy();
  });

  it('acceptance: a previously published blueprint stays readable while a second run is mid-drain', async () => {
    const env = fakeEnv();
    const { json: project } = await createProject(env);
    const projectId = project.data.id;

    // Run 1: drive to completion and publish.
    const estimate1 = await createEstimate(env, projectId);
    const { json: run1 } = await startRun(env, projectId, estimate1.estimateId, newId('idem'));
    await drainQueue(env, env.BLUEPRINT_QUEUE.sent);
    expect(await getRunStatus(env.BLUEPRINT_DB, run1.data.id)).toBe('partial');

    const version1 = await env.BLUEPRINT_DB
      .prepare(`SELECT id FROM blueprint_versions WHERE run_id = ?`)
      .bind(run1.data.id)
      .first<{ id: string }>();
    expect(version1).toBeTruthy();

    const projectAfterRun1 = await env.BLUEPRINT_DB
      .prepare(`SELECT latest_blueprint_version_id, latest_run_id FROM projects WHERE id = ?`)
      .bind(projectId)
      .first<{ latest_blueprint_version_id: string; latest_run_id: string }>();
    expect(projectAfterRun1?.latest_blueprint_version_id).toBe(version1!.id);
    expect(projectAfterRun1?.latest_run_id).toBe(run1.data.id);

    // Run 2: fresh estimate + new Idempotency-Key, driven only partially
    // (a handful of stage invocations, not to completion).
    const estimate2 = await createEstimate(env, projectId);
    const { json: run2 } = await startRun(env, projectId, estimate2.estimateId, newId('idem'));
    expect(run2.data.id).not.toBe(run1.data.id);

    const sent2 = env.BLUEPRINT_QUEUE.sent;
    for (let i = 0; i < 3 && sent2.length; i++) {
      const msg = sent2.pop() as { runId: string };
      await processResearchRun(env, msg.runId, 'w1');
    }
    const run2Status = await getRunStatus(env.BLUEPRINT_DB, run2.data.id);
    expect(run2Status).toBe('running');
    // Run 2 has not published yet.
    const version2 = await env.BLUEPRINT_DB
      .prepare(`SELECT id FROM blueprint_versions WHERE run_id = ?`)
      .bind(run2.data.id)
      .first<{ id: string }>();
    expect(version2).toBeNull();

    // Run 1's published blueprint is still readable, and the project's
    // pointer still resolves to it (run 2 has not overwritten it).
    const getRun1Res = await call(env, `/api/blueprint/v1/research-runs/${run1.data.id}`);
    expect(getRun1Res.status).toBe(200);
    const run1View = (await getRun1Res.json()) as ApiSuccess<ResearchRunView>;
    expect(run1View.data.blueprintVersionId).toBe(version1!.id);

    const version1StillThere = await env.BLUEPRINT_DB
      .prepare(`SELECT id FROM blueprint_versions WHERE id = ?`)
      .bind(version1!.id)
      .first<{ id: string }>();
    expect(version1StillThere).toBeTruthy();

    // latest_run_id tracks "most recently started run" (set the instant a
    // run starts, see routes/projects.ts's startResearchRun) and correctly
    // moves to run2 -- that pointer is not the one this acceptance criterion
    // is about. latest_blueprint_version_id/latest_blueprint_revision_id are
    // written only by publishBlueprintHandler, which run2 has not reached
    // yet, so they must still resolve to run1's published version.
    const projectMidRun2 = await env.BLUEPRINT_DB
      .prepare(`SELECT latest_blueprint_version_id, latest_blueprint_revision_id FROM projects WHERE id = ?`)
      .bind(projectId)
      .first<{ latest_blueprint_version_id: string; latest_blueprint_revision_id: string }>();
    expect(projectMidRun2?.latest_blueprint_version_id).toBe(version1!.id);

    const projectRes = await call(env, `/api/blueprint/v1/projects/${projectId}`);
    const projectView = (await projectRes.json()) as ApiSuccess<ProjectView>;
    // The project's latest run pointer correctly reflects run2 (the one now
    // in flight); the published blueprint pointer (checked above) is the
    // acceptance-critical one and still resolves to run1.
    expect(projectView.data.latestRunId).toBe(run2.data.id);
  });
});
