import { BLUEPRINT_STAGES } from '../contracts/enums';
import type { BlueprintStage, RunStatus, StageStatus } from '../contracts/enums';

// Lightweight view of a research_stage_runs row. `required` mirrors the
// column written by acquireStageLease (db/leases.ts): the run-state
// functions below trust the row's own flag rather than re-deriving it from
// STAGE_REGISTRY, so they stay correct even if a row was inserted before a
// stage's required-ness changed.
export interface StageRowLite {
  stage_name: string;
  status: StageStatus;
  required: number;
  next_retry_at: string | null;
}

export type NextRunnableResult =
  | { kind: 'run'; stage: BlueprintStage }
  | { kind: 'wait'; until: string }
  | { kind: 'done' }
  | { kind: 'failed'; stage: BlueprintStage };

// Statuses that stop a stage from ever becoming runnable again on this run.
// 'failed' is included because a failed OPTIONAL stage is terminal (it
// degrades the run to 'partial'); a failed REQUIRED stage is handled before
// this set is consulted, in both nextRunnableStage and deriveRunStatus.
const TERMINAL_STATUSES = new Set<StageStatus>([
  'succeeded',
  'skipped',
  'partial',
  'cancelled',
  'failed',
]);

// Statuses that, on an OPTIONAL stage, represent a declared gap in the
// final blueprint (used by deriveRunStatus to decide 'partial' vs 'succeeded').
const GAP_STATUSES = new Set<StageStatus>(['skipped', 'partial', 'failed', 'cancelled']);

// Stages are strictly sequential: a later stage must never run before an
// earlier one has reached a terminal state. So this walks BLUEPRINT_STAGES
// in order and returns as soon as it finds the first stage that is not yet
// terminal, which is by construction the only stage allowed to run next (or
// the reason the run is blocked/failed).
export function nextRunnableStage(rows: StageRowLite[], now: Date): NextRunnableResult {
  const nowIso = now.toISOString();
  const byStage = new Map(rows.map((row) => [row.stage_name, row]));

  for (const stage of BLUEPRINT_STAGES) {
    const row = byStage.get(stage);

    // No row yet counts as pending: it has never been attempted.
    if (!row) return { kind: 'run', stage };

    switch (row.status) {
      case 'pending':
      case 'queued':
        return { kind: 'run', stage };

      case 'retry_wait':
        if (row.next_retry_at && row.next_retry_at <= nowIso) {
          return { kind: 'run', stage };
        }
        // Blocks later stages until the backoff window elapses.
        return { kind: 'wait', until: row.next_retry_at ?? nowIso };

      case 'running':
        // Another worker holds the lease; caller should stop and re-poll.
        return { kind: 'wait', until: nowIso };

      case 'failed':
        if (row.required) return { kind: 'failed', stage };
        // Optional failure degrades the blueprint; keep scanning forward.
        continue;

      case 'succeeded':
      case 'skipped':
      case 'partial':
      case 'cancelled':
        continue;
    }
  }

  return { kind: 'done' };
}

// Derives the run-level status purely from the 19 stage rows plus the
// current status. Cancellation is sticky and short-circuits everything
// else: once a cancel has been requested (or completed) the row state no
// longer matters for the run status.
export function deriveRunStatus(rows: StageRowLite[], current: RunStatus): RunStatus {
  if (current === 'cancel_requested' || current === 'cancelled') {
    return current;
  }

  // A failed required stage fails the run immediately, even while other
  // stages are still pending/running: nothing downstream of it can produce
  // a valid blueprint, so there is no point waiting for the rest to settle.
  if (rows.some((row) => row.status === 'failed' && row.required)) {
    return 'failed';
  }

  const byStage = new Map(rows.map((row) => [row.stage_name, row]));
  const allTerminal = BLUEPRINT_STAGES.every((stage) => {
    const row = byStage.get(stage);
    return !!row && TERMINAL_STATUSES.has(row.status);
  });

  if (!allTerminal) return 'running';

  const hasGap = rows.some((row) => !row.required && GAP_STATUSES.has(row.status));
  return hasGap ? 'partial' : 'succeeded';
}
