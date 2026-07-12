import type { BlueprintStage, RunStatus } from '../contracts/enums';
import { BlueprintApiError, NotFoundError } from '../domain/api-errors';
import { BlueprintValidationError } from '../domain/errors';
import { safeErrorMessage } from '../providers/dataforseo/envelope';
import { buildStageInputHash, hashNormalizedInput } from '../domain/hash';
import type { NormalizedProjectBrief } from '../contracts/types';
import { nowIso } from '../db/util';
import { acquireStageLease, completeStage, failStage } from '../db/leases';
import { STAGE_HANDLERS } from './handlers';
import type { StageContext, StageHandler } from './handlers';
import { stageMeta } from './stages';
import { SerpTasksPendingError } from '../providers/dataforseo/serp';
import { nextRunnableStage, deriveRunStatus, loadGapStageNames } from './run-status';
import type { StageRowLite } from './run-status';

export interface BlueprintQueueEnv {
  BLUEPRINT_DB: D1Database;
  BLUEPRINT_QUEUE: { send(body: unknown, options?: { delaySeconds?: number }): Promise<void> };
}

// Widens BlueprintQueueEnv with the provider bindings/credentials real stage
// handlers need (KV cache, R2 raw-artifact storage, DataForSEO creds) so
// handlers can call out to providers without importing the full worker Env.
// The full worker Env structurally satisfies this (and BlueprintQueueEnv),
// so index.ts's route/queue call sites keep compiling unchanged.
export interface BlueprintProviderEnv extends BlueprintQueueEnv {
  KV: KVNamespace;
  BLUEPRINT_ARTIFACTS: R2Bucket;
  DATAFORSEO_EMAIL: string;
  DATAFORSEO_PASSWORD: string;
}

// Leases outlive a single Worker invocation only in spirit (Phase 2 has no
// real long-running handlers yet); this just needs to be longer than a
// stub handler could plausibly take.
const LEASE_MS = 5 * 60_000;
const RETRY_BACKOFF_MS = 30_000;
const MAX_ATTEMPTS = 3;

// Fences every run-status write below against a cancellation that landed
// concurrently (Task 8 Fix 1): 'cancel_requested'/'cancelled' are sticky and
// must never be clobbered back to 'running' (or any other terminal status)
// by a stage attempt that was already in flight when the cancel landed.
const RUN_STATUS_NOT_CANCELLED = `status NOT IN ('cancel_requested','cancelled')`;

export interface ProcessRunResult {
  advanced: boolean;
  runStatus: RunStatus;
  waitUntil?: string;
}

interface RunRow {
  id: string;
  project_id: string;
  brief_version_id: string;
  status: RunStatus;
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

// Re-reads the run's real status after a fenced write reported zero
// matched rows, so callers report what's actually true in the DB (e.g. a
// concurrently-landed 'cancel_requested'/'cancelled') rather than the stale
// in-memory status they started this invocation with.
async function reloadRunStatus(d1: D1Database, runId: string, fallback: RunStatus): Promise<RunStatus> {
  const row = await d1.prepare(`SELECT status FROM research_runs WHERE id = ?`).bind(runId).first<{ status: RunStatus }>();
  return row?.status ?? fallback;
}

// Single place that decides what happens to the run row after a stage
// attempt (success, retry_wait, or terminal failure) resolves. Re-derives
// state from freshly reloaded rows via the Task 7 state machine rather than
// hand-tracking progress, so this stays correct however the attempt ended.
// Every write here is fenced against a concurrent cancellation and derives
// partial_reasons_json fresh from the stage rows (Task 8 Fix 1 + Fix 2): if
// the run was cancelled or a cancel was requested while this stage attempt
// was in flight, the UPDATE simply does not match, and we return the run's
// real (reloaded) status instead of clobbering it back to 'running'.
async function finalizeStageAttempt(
  env: BlueprintProviderEnv,
  runId: string,
  currentStatus: RunStatus,
  stageJustProcessed: BlueprintStage
): Promise<ProcessRunResult> {
  const d1 = env.BLUEPRINT_DB;
  const rows = await loadStageRows(d1, runId);
  const next = nextRunnableStage(rows, new Date());
  const now = nowIso();
  const partialReasonsJson = JSON.stringify(await loadGapStageNames(d1, runId));

  if (next.kind === 'run' || next.kind === 'wait') {
    // More work exists (or is blocked on a future retry): the run is
    // (still) in flight. Only 'run' means there is something immediately
    // actionable, so only that case re-enqueues; a 'wait' stage is picked
    // up on its own future enqueue (queue consumer lands in Task 9).
    const update = await d1
      .prepare(
        `UPDATE research_runs
         SET current_stage = ?, status = 'running', partial_reasons_json = ?, started_at = COALESCE(started_at, ?)
         WHERE id = ? AND ${RUN_STATUS_NOT_CANCELLED}`
      )
      .bind(stageJustProcessed, partialReasonsJson, now, runId)
      .run();
    if (update.meta.changes === 0) {
      return { advanced: false, runStatus: await reloadRunStatus(d1, runId, currentStatus) };
    }
    if (next.kind === 'run') {
      await env.BLUEPRINT_QUEUE.send({ runId });
      return { advanced: true, runStatus: 'running' };
    }
    // next.kind === 'wait': a stage just landed in retry_wait (or is held by
    // another worker's lease). Surface the computed next_retry_at so the
    // queue consumer can schedule a delayed wake-up instead of relying on a
    // client poll to ever come back and re-drive this run.
    return { advanced: true, runStatus: 'running', waitUntil: next.until };
  }

  const finalStatus: RunStatus = next.kind === 'failed' ? 'failed' : deriveRunStatus(rows, currentStatus);
  const update = await d1
    .prepare(
      `UPDATE research_runs
       SET current_stage = ?, status = ?, partial_reasons_json = ?, started_at = COALESCE(started_at, ?), finished_at = COALESCE(finished_at, ?)
       WHERE id = ? AND ${RUN_STATUS_NOT_CANCELLED}`
    )
    .bind(stageJustProcessed, finalStatus, partialReasonsJson, now, now, runId)
    .run();
  if (update.meta.changes === 0) {
    return { advanced: false, runStatus: await reloadRunStatus(d1, runId, currentStatus) };
  }
  return { advanced: true, runStatus: finalStatus };
}

// One stage per invocation (handoff contract): acquires exactly one stage's
// lease, runs (or reuses) it, persists the outcome, and either re-enqueues
// itself for the next stage or reports a terminal run status. Callers are
// expected to keep invoking this (driven by the queue consumer in Task 9)
// until `advanced` is false.
export async function processResearchRun(
  env: BlueprintProviderEnv,
  runId: string,
  workerId: string,
  overrides?: Partial<Record<BlueprintStage, StageHandler>>
): Promise<ProcessRunResult> {
  const d1 = env.BLUEPRINT_DB;

  const run = await d1
    .prepare(`SELECT id, project_id, brief_version_id, status FROM research_runs WHERE id = ?`)
    .bind(runId)
    .first<RunRow>();
  if (!run) throw new NotFoundError(`Research run not found: ${runId}`);

  // Cancellation is sticky: once a run has finished cancelling, every later
  // invocation (including a duplicate queue delivery of a stage message
  // that was already in flight when the cancel landed) is an idempotent
  // no-op. Do not touch stage rows, do not enqueue, do not execute a stage.
  if (run.status === 'cancelled') {
    return { advanced: false, runStatus: 'cancelled' };
  }

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
    return { advanced: false, runStatus: run.status, waitUntil: next.until };
  }

  if (next.kind === 'done' || next.kind === 'failed') {
    const finalStatus: RunStatus = next.kind === 'failed' ? 'failed' : deriveRunStatus(rows, run.status);
    const partialReasonsJson = JSON.stringify(await loadGapStageNames(d1, runId));
    const now = nowIso();
    const update = await d1
      .prepare(
        `UPDATE research_runs
         SET status = ?, partial_reasons_json = ?, finished_at = COALESCE(finished_at, ?)
         WHERE id = ? AND ${RUN_STATUS_NOT_CANCELLED}`
      )
      .bind(finalStatus, partialReasonsJson, now, runId)
      .run();
    if (update.meta.changes === 0) {
      return { advanced: false, runStatus: await reloadRunStatus(d1, runId, run.status) };
    }
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

  if (lease.kind === 'busy') {
    return { advanced: false, runStatus: run.status };
  }

  if (lease.kind === 'wait') {
    return { advanced: false, runStatus: run.status, waitUntil: lease.nextRetryAt };
  }

  if (lease.kind === 'acquired') {
    const ctx: StageContext = {
      env,
      d1,
      runId,
      projectId: run.project_id,
      briefVersionId: run.brief_version_id,
      normalizedBrief,
      stage,
      attempt: lease.attemptCount,
    };
    const handler = overrides?.[stage] ?? STAGE_HANDLERS[stage];

    try {
      const result = await handler(ctx);
      const outputJson = JSON.stringify(result.output);
      const outputHash = await hashNormalizedInput(result.output);
      // A handler that tracked its own real provider spend (so far only
      // collect_keyword_evidence, Task 10) reports it as a numeric
      // stageCostUsdMicro field on its output; forward that into the stage
      // row's cost_usd_micro rather than leaving it at completeStage's
      // default of 0. Every other (stub/free) handler's output has no such
      // field, so costUsdMicro stays undefined and completeStage's own
      // COALESCE(?, cost_usd_micro) leaves the column untouched.
      const stageCostUsdMicro =
        result.output != null &&
        typeof result.output === 'object' &&
        typeof (result.output as Record<string, unknown>).stageCostUsdMicro === 'number'
          ? (result.output as Record<string, number>).stageCostUsdMicro
          : undefined;
      await completeStage(d1, lease.lease, outputJson, outputHash, {
        status: result.status ?? 'succeeded',
        costUsdMicro: stageCostUsdMicro,
      });
    } catch (err) {
      // Operator-only diagnostics: the persisted stage row is sanitized by
      // design, so the raw cause must be visible somewhere. Worker logs
      // (wrangler tail / dashboard) are operator-scoped, never user-facing.
      console.error(
        `[blueprint] stage ${stage} attempt ${lease.attemptCount} threw:`,
        err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      );
      if (err instanceof BlueprintValidationError) {
        // Permanent, user-correctable failure (e.g. resolve_market's
        // unsupported-language throw): retrying can never succeed, only a
        // brief change can, so fail/skip the stage immediately instead of
        // burning MAX_ATTEMPTS retry cycles and then masking the real reason
        // behind a generic internal_error. The message is our own validation
        // text (never raw provider output), so it is safe to persist.
        const decision = meta.required ? ({ kind: 'failed' } as const) : ({ kind: 'skipped' } as const);
        await failStage(d1, lease.lease, { code: 'invalid_input', message: err.message }, decision);
      } else {
        // Only a BlueprintApiError has already been through a sanitizer (e.g.
        // mapDfsFailure) and carries a code/message safe to persist verbatim.
        // Anything else (raw provider errors, thrown strings, bugs) could
        // contain account emails, internal URLs, or other provider-body text,
        // so it is always collapsed to the fixed internal_error message
        // before it reaches the stage row (never store `err.message` as-is).
        // SerpTasksPendingError (Task 13) is neither: it is a plain Error
        // subclass, thrown deliberately by validate_serps_and_questions
        // while its DataForSEO SERP batch is still processing, so it is
        // classified like the generic retryable path but with its own safe
        // code/message (provider_timeout) rather than falling through to the
        // generic internal_error label.
        const { code, message } =
          err instanceof SerpTasksPendingError
            ? { code: 'provider_timeout' as const, message: safeErrorMessage('provider_timeout') }
            : err instanceof BlueprintApiError
              ? { code: err.code, message: err.message }
              : { code: 'internal_error' as const, message: safeErrorMessage('internal_error') };
        // Per-stage overrides (stages.ts StageMeta.maxAttempts/retryBackoffMs)
        // fall back to the generic MAX_ATTEMPTS/RETRY_BACKOFF_MS when unset.
        const maxAttempts = meta.maxAttempts ?? MAX_ATTEMPTS;
        const retryBackoffMs = meta.retryBackoffMs ?? RETRY_BACKOFF_MS;
        if (lease.attemptCount < maxAttempts) {
          const nextRetryAt = new Date(Date.now() + retryBackoffMs).toISOString();
          await failStage(d1, lease.lease, { code, message }, { kind: 'retry_wait', nextRetryAt });
        } else if (meta.required) {
          await failStage(d1, lease.lease, { code, message }, { kind: 'failed' });
        } else {
          await failStage(d1, lease.lease, { code, message }, { kind: 'skipped' });
        }
      }
    }
  }
  // lease.kind === 'reuse': the stage already has a terminal outcome under
  // this exact input hash, nothing to run; fall through and let the state
  // machine decide what happens next.

  return finalizeStageAttempt(env, runId, run.status, stage);
}
