import type { BlueprintStage } from '../contracts/enums';

// Lets a later stage handler read an earlier (required or optional) stage's
// persisted output without re-running it. Only 'succeeded' and 'partial' are
// readable: those are the two terminal statuses that still produced usable
// output_json (a 'skipped' or 'failed' optional stage has none to read, and
// callers must handle a null return as "this stage produced nothing").
// ORDER BY finished_at DESC LIMIT 1 is defensive: UNIQUE(run_id, stage_name,
// stage_input_hash) means a run should only ever have one row per stage in
// practice (the stage input hash is stable for the run's lifetime), but this
// keeps the helper correct even if that ever changes.
export async function loadStageOutput<T>(
  d1: D1Database,
  runId: string,
  stage: BlueprintStage
): Promise<T | null> {
  const row = await d1
    .prepare(
      `SELECT output_json FROM research_stage_runs
       WHERE run_id = ? AND stage_name = ? AND status IN ('succeeded','partial')
       ORDER BY finished_at DESC LIMIT 1`
    )
    .bind(runId, stage)
    .first<{ output_json: string | null }>();
  if (!row || row.output_json == null) return null;
  return JSON.parse(row.output_json) as T;
}
