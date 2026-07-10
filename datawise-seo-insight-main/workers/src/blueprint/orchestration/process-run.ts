import type { BlueprintStage, RunStatus } from '../contracts/enums';
import { NotFoundError } from '../domain/api-errors';
import { buildStageInputHash, hashNormalizedInput } from '../domain/hash';
import type { NormalizedProjectBrief } from '../contracts/types';
import { nowIso } from '../db/util';
import { acquireStageLease, completeStage, failStage } from '../db/leases';
import { STAGE_HANDLERS } from './handlers';
import type { StageContext, StageHandler } from './handlers';
import { stageMeta } from './stages';
import { nextRunnableStage, deriveRunStatus } from './run-status';
import type { StageRowLite } from './run-status';

export interface BlueprintQueueEnv {
  BLUEPRINT_DB: D1Database;
  BLUEPRINT_QUEUE: { send(body: unknown): Promise<void> };
}

// Leases outlive a single Worker invocation only in spirit (Phase 2 has no
// real long-running handlers yet); this just needs to be longer than a
// stub handler could plausibly take.
const LEASE_MS = 5 * 60_000;
const RETRY_BACKOFF_MS = 30_000;
const MAX_ATTEMPTS = 3;

interface RunRow {
  id: string;
  project_id: string;
  brief_version_id: string;
  status: RunStatus;
  partial_reasons_json: string;
}

interface BriefVersionRow {
  normalized_json: string;
  input_hash: string;
}

async function loadStageRows(d1: D1Database, runId: string): Promise<StageRowLite[]> {
  const result = await d1
    .prepare(`SELECT stage_name, status, required, next_retry_at FROM research_stage_runs WHERE run_id = ?`)
    .bind(runId)
    .all<StageRowLite>();
  return result.results;
}

async function appendPartialReason(d1: D1Database, runId: string, stage: BlueprintStage): Promise<void> {
  const row = await d1
    .prepare(`SELECT partial_reasons_json FROM research_runs WHERE id = ?`)
    .bind(runId)
    .first<{ partial_reasons_json: string }>();
  const reasons: string[] = row ? JSON.parse(row.partial_reasons_json) : [];
  if (!reasons.includes(stage)) reasons.push(stage);
  await d1
    .prepare(`UPDATE research_runs SET partial_reasons_json = ? WHERE id = ?`)
    .bind(JSON.stringify(reasons), runId)
    .run();
}

// Single place that decides what happens to the run row after a stage
// attempt (success, retry_wait, or terminal failure) resolves. Re-derives
// state from freshly reloaded rows via the Task 7 state machine rather than
// hand-tracking progress, so this stays correct however the attempt ended.
async function finalizeStageAttempt(
  env: BlueprintQueueEnv,
  runId: string,
  currentStatus: RunStatus,
  stageJustProcessed: BlueprintStage
): Promise<{ advanced: boolean; runStatus: RunStatus }> {
  const d1 = env.BLUEPRINT_DB;
  const rows = await loadStageRows(d1, runId);
  const next = nextRunnableStage(rows, new Date());

  if (next.kind === 'run' || next.kind === 'wait') {
    // More work exists (or is blocked on a future retry): the run is
    // (still) in flight. Only 'run' means there is something immediately
    // actionable, so only that case re-enqueues; a 'wait' stage is picked
    // up on its own future enqueue (queue consumer lands in Task 9).
    await d1
      .prepare(`UPDATE research_runs SET current_stage = ?, status = 'running' WHERE id = ?`)
      .bind(stageJustProcessed, runId)
      .run();
    if (next.kind === 'run') {
      await env.BLUEPRINT_QUEUE.send({ runId });
    }
    return { advanced: true, runStatus: 'running' };
  }

  const finalStatus: RunStatus = next.kind === 'failed' ? 'failed' : deriveRunStatus(rows, currentStatus);
  await d1
    .prepare(`UPDATE research_runs SET current_stage = ?, status = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ?`)
    .bind(stageJustProcessed, finalStatus, nowIso(), runId)
    .run();
  return { advanced: true, runStatus: finalStatus };
}

// One stage per invocation (handoff contract): acquires exactly one stage's
// lease, runs (or reuses) it, persists the outcome, and either re-enqueues
// itself for the next stage or reports a terminal run status. Callers are
// expected to keep invoking this (driven by the queue consumer in Task 9)
// until `advanced` is false.
export async function processResearchRun(
  env: BlueprintQueueEnv,
  runId: string,
  workerId: string,
  overrides?: Partial<Record<BlueprintStage, StageHandler>>
): Promise<{ advanced: boolean; runStatus: RunStatus }> {
  const d1 = env.BLUEPRINT_DB;

  const run = await d1
    .prepare(
      `SELECT id, project_id, brief_version_id, status, partial_reasons_json FROM research_runs WHERE id = ?`
    )
    .bind(runId)
    .first<RunRow>();
  if (!run) throw new NotFoundError(`Research run not found: ${runId}`);

  // Cancellation is checked before selecting the next stage (and therefore
  // before any paid provider call a real handler would make).
  if (run.status === 'cancel_requested') {
    const now = nowIso();
    await d1
      .prepare(
        `UPDATE research_stage_runs SET status = 'cancelled', finished_at = ?
         WHERE run_id = ? AND status NOT IN ('succeeded','skipped','partial','cancelled','failed')`
      )
      .bind(now, runId)
      .run();
    await d1
      .prepare(`UPDATE research_runs SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE id = ?`)
      .bind(now, runId)
      .run();
    return { advanced: false, runStatus: 'cancelled' };
  }

  const rows = await loadStageRows(d1, runId);
  const next = nextRunnableStage(rows, new Date());

  if (next.kind === 'wait') {
    // Another worker holds the next stage's lease, or it is backing off; do
    // not sleep or poll, just report no progress this invocation.
    return { advanced: false, runStatus: run.status };
  }

  if (next.kind === 'done' || next.kind === 'failed') {
    const finalStatus: RunStatus = next.kind === 'failed' ? 'failed' : deriveRunStatus(rows, run.status);
    await d1
      .prepare(`UPDATE research_runs SET status = ?, finished_at = COALESCE(finished_at, ?) WHERE id = ?`)
      .bind(finalStatus, nowIso(), runId)
      .run();
    return { advanced: false, runStatus: finalStatus };
  }

  const stage = next.stage;
  const meta = stageMeta(stage);

  const briefRow = await d1
    .prepare(`SELECT normalized_json, input_hash FROM project_brief_versions WHERE id = ?`)
    .bind(run.brief_version_id)
    .first<BriefVersionRow>();
  if (!briefRow) throw new NotFoundError(`Brief version not found: ${run.brief_version_id}`);
  const normalizedBrief: NormalizedProjectBrief = JSON.parse(briefRow.normalized_json);

  const stageInputHash = await buildStageInputHash({
    runId,
    stage,
    normalizedInputHash: briefRow.input_hash,
    rulesetVersion: 'phase2-stub',
  });

  const lease = await acquireStageLease(d1, {
    runId,
    stage,
    stageInputHash,
    workerId,
    leaseMs: LEASE_MS,
    required: meta.required,
  });

  if (lease.kind === 'busy' || lease.kind === 'wait') {
    return { advanced: false, runStatus: run.status };
  }

  if (lease.kind === 'acquired') {
    const ctx: StageContext = {
      d1,
      runId,
      projectId: run.project_id,
      briefVersionId: run.brief_version_id,
      normalizedBrief,
    };
    const handler = overrides?.[stage] ?? STAGE_HANDLERS[stage];

    try {
      const result = await handler(ctx);
      const outputJson = JSON.stringify(result.output);
      const outputHash = await hashNormalizedInput(result.output);
      await completeStage(d1, lease.lease, outputJson, outputHash, { status: result.status ?? 'succeeded' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (lease.attemptCount < MAX_ATTEMPTS) {
        const nextRetryAt = new Date(Date.now() + RETRY_BACKOFF_MS).toISOString();
        await failStage(d1, lease.lease, { code: 'internal_error', message }, { kind: 'retry_wait', nextRetryAt });
      } else if (meta.required) {
        await failStage(d1, lease.lease, { code: 'internal_error', message }, { kind: 'failed' });
      } else {
        await failStage(d1, lease.lease, { code: 'internal_error', message }, { kind: 'skipped' });
        await appendPartialReason(d1, runId, stage);
      }
    }
  }
  // lease.kind === 'reuse': the stage already has a terminal outcome under
  // this exact input hash, nothing to run; fall through and let the state
  // machine decide what happens next.

  return finalizeStageAttempt(env, runId, run.status, stage);
}
