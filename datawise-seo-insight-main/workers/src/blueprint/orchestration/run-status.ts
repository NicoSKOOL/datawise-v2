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

// A stage row counts as a declared "gap" in the final blueprint when it
// ended 'skipped' or 'partial' -- REQUIRED or optional. A required stage
// that only reached 'partial' still leaves the blueprint short of what a
// full run would have produced (collect_keyword_evidence's own
// enrichmentTruncated 'partial' is the motivating case: it is a REQUIRED
// stage, per stages.ts), so it must degrade the run exactly like an
// optional 'skipped'/'partial' does -- never get waved through as
// 'succeeded'. A 'failed' row only counts as a gap when it is NOT required:
// a required 'failed' row is not a "gap", it is a whole-run failure, and is
// handled by deriveRunStatus's own required-failed check before this
// predicate is ever consulted for that row (so by the time hasGap below
// looks at a 'failed' row, it is guaranteed already optional).
// 'cancelled' rows are deliberately excluded: they only occur on a
// cancelled run, where deriveRunStatus already short-circuits before gaps
// matter.
//
// Shared by deriveRunStatus (in-memory rows, one query per processor
// invocation) and loadGapStageNames (its own fresh D1 query, called
// separately by process-run.ts and publish_blueprint) so run status and
// partial_reasons can never disagree about what counts as a gap.
export function isGapStageRow(row: Pick<StageRowLite, 'status' | 'required'>): boolean {
  if (row.status === 'skipped' || row.status === 'partial') return true;
  return row.status === 'failed' && !row.required;
}

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

  const hasGap = rows.some(isGapStageRow);
  return hasGap ? 'partial' : 'succeeded';
}

// Shared derivation used both when the processor finalizes a run's status
// and when publish_blueprint computes the published version's completeness
// (Task 8 Fix 2), so the two can never disagree. Loads status/required fresh
// from D1 and filters through the exact same isGapStageRow predicate
// deriveRunStatus's own hasGap check uses above, rather than re-deriving an
// overlapping-but-separate definition in SQL: that is what previously let a
// REQUIRED stage's 'partial' row count as a gap here (any 'skipped'/'partial'
// row, required or not) while deriveRunStatus's old inline check silently
// excluded it (`!row.required && ...`), so a required-partial run could
// finish 'succeeded' while partial_reasons_json still named the stage that
// caused it. Routing both through isGapStageRow makes that drift structurally
// impossible.
export async function loadGapStageNames(d1: D1Database, runId: string): Promise<string[]> {
  const result = await d1
    .prepare(`SELECT stage_name, status, required FROM research_stage_runs WHERE run_id = ?`)
    .bind(runId)
    .all<{ stage_name: string; status: StageStatus; required: number }>();
  return result.results.filter(isGapStageRow).map((row) => row.stage_name);
}
