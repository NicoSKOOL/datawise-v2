import { newId, nowIso } from './util';
import { BlueprintApiError } from '../domain/api-errors';
import type { BlueprintStage, BlueprintErrorCode } from '../contracts/enums';

export interface StageLease {
  stageRunId: string;
  runId: string;
  stage: BlueprintStage;
  workerId: string;
  leaseEpoch: number;
  expiresAt: string;
}

export type StageLeaseResult =
  | { kind: 'acquired'; lease: StageLease; attemptCount: number }
  | { kind: 'reuse'; outputJson: string | null; status: 'succeeded' | 'skipped' }
  | { kind: 'busy' }
  | { kind: 'wait'; nextRetryAt: string };

interface StageRunRow {
  id: string;
  status: string;
  output_json: string | null;
  next_retry_at: string | null;
  lease_epoch: number;
  attempt_count: number;
}

// Claim-first fencing: the conditional UPDATE below is the single place a
// worker takes ownership of a stage run. It only matches rows that are not
// currently held by another live lease (lease_owner IS NULL), whose lease
// has expired (lease_expires_at < now), or that this same worker already
// owns. On every match it bumps lease_epoch, so a worker that later tries to
// persist a result carries a stale epoch once someone else claims the row,
// and completeStage/failStage/renewStageLease reject it via CAS.
export async function acquireStageLease(
  d1: D1Database,
  input: {
    runId: string;
    stage: BlueprintStage;
    stageInputHash: string;
    workerId: string;
    leaseMs: number;
    required: boolean;
    now?: Date;
  }
): Promise<StageLeaseResult> {
  const now = input.now ?? new Date();
  const nowStr = now.toISOString();

  await d1
    .prepare(
      `INSERT OR IGNORE INTO research_stage_runs
        (id, run_id, stage_name, stage_input_hash, status, required)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    )
    .bind(newId('stagerun'), input.runId, input.stage, input.stageInputHash, input.required ? 1 : 0)
    .run();

  const row = await d1
    .prepare(
      `SELECT id, status, output_json, next_retry_at, lease_epoch, attempt_count
       FROM research_stage_runs WHERE run_id = ? AND stage_name = ? AND stage_input_hash = ?`
    )
    .bind(input.runId, input.stage, input.stageInputHash)
    .first<StageRunRow>();
  if (!row) throw new Error('research stage run not found after insert');

  if (row.status === 'succeeded' || row.status === 'skipped') {
    return { kind: 'reuse', outputJson: row.output_json, status: row.status };
  }

  if (row.status === 'retry_wait' && row.next_retry_at && nowStr < row.next_retry_at) {
    return { kind: 'wait', nextRetryAt: row.next_retry_at };
  }

  const expiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
  const claim = await d1
    .prepare(
      `UPDATE research_stage_runs
       SET lease_owner = ?, lease_expires_at = ?, lease_epoch = lease_epoch + 1,
           status = 'running', attempt_count = attempt_count + 1, started_at = COALESCE(started_at, ?)
       WHERE id = ? AND status IN ('pending','queued','retry_wait','running','failed','partial')
         AND (lease_owner IS NULL OR lease_expires_at < ? OR lease_owner = ?)`
    )
    .bind(input.workerId, expiresAt, nowStr, row.id, nowStr, input.workerId)
    .run();
  if (claim.meta.changes === 0) {
    return { kind: 'busy' };
  }

  const claimed = await d1
    .prepare(`SELECT id, status, output_json, next_retry_at, lease_epoch, attempt_count FROM research_stage_runs WHERE id = ?`)
    .bind(row.id)
    .first<StageRunRow>();
  if (!claimed) throw new Error('research stage run disappeared after claim');

  return {
    kind: 'acquired',
    lease: {
      stageRunId: claimed.id,
      runId: input.runId,
      stage: input.stage,
      workerId: input.workerId,
      leaseEpoch: claimed.lease_epoch,
      expiresAt,
    },
    attemptCount: claimed.attempt_count,
  };
}

// CAS on lease_epoch: only the current epoch holder can renew, and renewing
// mints a new epoch so a worker that let its lease lapse (and got its lease
// reassigned) cannot resurrect it by renewing a stale copy.
export async function renewStageLease(d1: D1Database, lease: StageLease, leaseMs: number): Promise<StageLease> {
  const expiresAt = new Date(Date.now() + leaseMs).toISOString();
  const claim = await d1
    .prepare(
      `UPDATE research_stage_runs
       SET lease_expires_at = ?, lease_epoch = lease_epoch + 1
       WHERE id = ? AND lease_owner = ? AND lease_epoch = ?`
    )
    .bind(expiresAt, lease.stageRunId, lease.workerId, lease.leaseEpoch)
    .run();
  if (claim.meta.changes === 0) {
    throw new BlueprintApiError('stage_conflict', 'Stage lease was reassigned before renewal');
  }
  return { ...lease, leaseEpoch: lease.leaseEpoch + 1, expiresAt };
}

// CAS on (lease_owner, lease_epoch): a stale worker whose lease was
// reassigned to someone else always fails this WHERE clause and never
// overwrites the newer worker's in-flight or completed result.
export async function completeStage(
  d1: D1Database,
  lease: StageLease,
  outputJson: string,
  outputHash: string,
  extra?: {
    status?: 'succeeded' | 'partial' | 'skipped';
    costUsdMicro?: number;
    latencyMs?: number;
    rulesetVersion?: string;
  }
): Promise<void> {
  const status = extra?.status ?? 'succeeded';
  const claim = await d1
    .prepare(
      `UPDATE research_stage_runs
       SET status = ?, output_json = ?, output_hash = ?, finished_at = ?,
           cost_usd_micro = COALESCE(?, cost_usd_micro), latency_ms = COALESCE(?, latency_ms),
           ruleset_version = COALESCE(?, ruleset_version),
           lease_owner = NULL, lease_expires_at = NULL
       WHERE id = ? AND lease_owner = ? AND lease_epoch = ?`
    )
    .bind(
      status,
      outputJson,
      outputHash,
      nowIso(),
      extra?.costUsdMicro ?? null,
      extra?.latencyMs ?? null,
      extra?.rulesetVersion ?? null,
      lease.stageRunId,
      lease.workerId,
      lease.leaseEpoch
    )
    .run();
  if (claim.meta.changes === 0) {
    throw new BlueprintApiError('stage_conflict', 'Stage lease was reassigned before completion', {
      stage: lease.stage,
    });
  }
}

// Same CAS guard as completeStage. retry_wait leaves the row available for a
// future acquire once next_retry_at passes; failed/skipped are terminal.
// All three branches release the lease so the row is immediately claimable
// again (subject to the retry_wait gate in acquireStageLease).
//
// The optional `extra.costUsdMicro` mirrors Task 2's rulesetVersion
// COALESCE pattern: when the caller has already summed a stage's real
// provider_usage spend (Task 4, only meaningful on a terminal 'failed' or
// 'skipped' decision, since a retry_wait row will get its cost re-summed
// when it eventually completes or terminally fails), it is written through
// COALESCE(?, cost_usd_micro) so an omitted value leaves the column
// untouched rather than resetting it to 0.
export async function failStage(
  d1: D1Database,
  lease: StageLease,
  error: { code: BlueprintErrorCode; message: string },
  decision: { kind: 'retry_wait'; nextRetryAt: string } | { kind: 'failed' } | { kind: 'skipped' },
  extra?: { costUsdMicro?: number }
): Promise<void> {
  let claim: { meta: { changes: number } };
  if (decision.kind === 'retry_wait') {
    claim = await d1
      .prepare(
        `UPDATE research_stage_runs
         SET status = 'retry_wait', next_retry_at = ?, safe_error_code = ?, safe_error_message = ?,
             cost_usd_micro = COALESCE(?, cost_usd_micro),
             lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND lease_owner = ? AND lease_epoch = ?`
      )
      .bind(
        decision.nextRetryAt,
        error.code,
        error.message,
        extra?.costUsdMicro ?? null,
        lease.stageRunId,
        lease.workerId,
        lease.leaseEpoch
      )
      .run();
  } else {
    const status = decision.kind === 'failed' ? 'failed' : 'skipped';
    claim = await d1
      .prepare(
        `UPDATE research_stage_runs
         SET status = ?, safe_error_code = ?, safe_error_message = ?, finished_at = ?,
             cost_usd_micro = COALESCE(?, cost_usd_micro),
             lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND lease_owner = ? AND lease_epoch = ?`
      )
      .bind(
        status,
        error.code,
        error.message,
        nowIso(),
        extra?.costUsdMicro ?? null,
        lease.stageRunId,
        lease.workerId,
        lease.leaseEpoch
      )
      .run();
  }
  if (claim.meta.changes === 0) {
    throw new BlueprintApiError('stage_conflict', 'Stage lease was reassigned before failure was recorded', {
      stage: lease.stage,
    });
  }
}
