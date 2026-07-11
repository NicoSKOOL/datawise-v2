import { BLUEPRINT_STAGES } from '../contracts/enums';
import type { BlueprintStage } from '../contracts/enums';
import type { NormalizedProjectBrief } from '../contracts/types';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { hashNormalizedInput } from '../domain/hash';
import { V1_LIMITS } from '../contracts/limits';
import { newId, nowIso } from '../db/util';
import { loadGapStageNames } from './run-status';
import type { BlueprintProviderEnv } from './process-run';

export interface StageContext {
  env: BlueprintProviderEnv;
  d1: D1Database;
  runId: string;
  projectId: string;
  briefVersionId: string;
  normalizedBrief: NormalizedProjectBrief;
}

export type StageHandler = (
  ctx: StageContext
) => Promise<{ output: unknown; status?: 'succeeded' | 'partial' | 'skipped' }>;

// Every stage not otherwise overridden below is a deterministic zero-cost
// stub: Phase 2 wires the orchestration skeleton, real provider calls land
// stage-by-stage in later phases.
function makeStubStage(stage: BlueprintStage): StageHandler {
  return async () => ({ output: { stage, stub: true } });
}

interface BriefVersionRow {
  input_json: string;
  input_hash: string;
}

// Real validation, not a stub: re-parses the brief exactly as it was
// submitted so a schema drift between submission time and processing time
// (e.g. a deploy that tightened validation) surfaces as a stage failure
// instead of silently proceeding on stale-valid data.
async function validateIntakeHandler(ctx: StageContext) {
  const row = await ctx.d1
    .prepare(`SELECT input_json FROM project_brief_versions WHERE id = ?`)
    .bind(ctx.briefVersionId)
    .first<Pick<BriefVersionRow, 'input_json'>>();
  if (!row) throw new Error(`Brief version not found: ${ctx.briefVersionId}`);

  parseProjectBrief(JSON.parse(row.input_json));
  return { output: { stage: 'validate_intake' as const, valid: true } };
}

// Determinism check, not a stub: re-runs normalization and asserts it
// reproduces the exact input_hash stored at submission time. A mismatch
// means normalizeProjectBrief's output is not a pure function of its input
// (e.g. a nondeterministic default), which must fail loudly rather than
// silently diverge from the brief every downstream stage relies on.
async function normalizeBriefHandler(ctx: StageContext) {
  const row = await ctx.d1
    .prepare(`SELECT input_json, input_hash FROM project_brief_versions WHERE id = ?`)
    .bind(ctx.briefVersionId)
    .first<BriefVersionRow>();
  if (!row) throw new Error(`Brief version not found: ${ctx.briefVersionId}`);

  const parsed = parseProjectBrief(JSON.parse(row.input_json));
  const normalized = await normalizeProjectBrief(parsed, V1_LIMITS);
  if (normalized.inputHash !== row.input_hash) {
    throw new Error(
      'normalize_brief determinism check failed: recomputed inputHash does not match the stored input_hash'
    );
  }
  return { output: { stage: 'normalize_brief' as const, inputHash: normalized.inputHash } };
}

// Optional stage, zero-result success: Phase 2 does not implement the real
// US fan-out collection yet, so it always reports a clean skip (not a
// failure) rather than stubbing fake output.
async function collectUsFanoutHandler(): Promise<{
  output: unknown;
  status?: 'succeeded' | 'partial' | 'skipped';
}> {
  return { output: { stage: 'collect_us_fanout' as const, stub: true }, status: 'skipped' };
}

interface RunPublishRow {
  created_by: string;
}

// Real persistence, not a stub: this is the only stage that writes outside
// research_stage_runs. It is written to be safe under a lease race (two
// workers both believing they hold the lease for this run/stage/hash) by
// reusing whatever row a UNIQUE-constraint loser's competitor already wrote,
// mirroring the INSERT-then-catch idempotency pattern used by
// db/idempotency.ts and db/budget.ts elsewhere in this module.
async function publishBlueprintHandler(ctx: StageContext) {
  const { d1, runId, projectId } = ctx;

  const runRow = await d1
    .prepare(`SELECT created_by FROM research_runs WHERE id = ?`)
    .bind(runId)
    .first<RunPublishRow>();
  if (!runRow) throw new Error(`Research run not found: ${runId}`);

  const maxVersionRow = await d1
    .prepare(`SELECT MAX(version_number) AS maxVersion FROM blueprint_versions WHERE project_id = ?`)
    .bind(projectId)
    .first<{ maxVersion: number | null }>();
  const versionNumber = (maxVersionRow?.maxVersion ?? 0) + 1;

  // Same derivation the processor uses to finalize the run's own status
  // (Task 8 Fix 2): completeness and partial_reasons must never disagree
  // with the run row, so both are computed directly from the stage rows
  // rather than trusted off the run row's partial_reasons_json, which is
  // not yet authoritative for this invocation (the processor's own finalize
  // write for this stage attempt happens after this handler returns).
  const gapStages = await loadGapStageNames(d1, runId);
  const partialReasonsJson = JSON.stringify(gapStages);
  const completeness = gapStages.length > 0 ? 'partial' : 'complete';
  const publishedAt = nowIso();

  let versionId = newId('bpv');
  try {
    await d1
      .prepare(
        `INSERT INTO blueprint_versions
          (id, project_id, run_id, version_number, status, schema_version, ruleset_version,
           completeness, partial_reasons_json, summary_json, latest_revision_id, published_at, created_at)
         VALUES (?, ?, ?, ?, 'published', 'p2', 'phase2-stub', ?, ?, '{}', NULL, ?, ?)`
      )
      .bind(
        versionId,
        projectId,
        runId,
        versionNumber,
        completeness,
        partialReasonsJson,
        publishedAt,
        publishedAt
      )
      .run();
  } catch (err) {
    // UNIQUE(run_id) collision: someone already published this run. Reuse it
    // instead of failing, so a lease race is idempotent rather than fatal.
    const existing = await d1
      .prepare(`SELECT id FROM blueprint_versions WHERE run_id = ?`)
      .bind(runId)
      .first<{ id: string }>();
    if (!existing) throw err;
    versionId = existing.id;
  }

  const revisionHash = await hashNormalizedInput({ runId, versionId });
  let revisionId = newId('bprev');
  try {
    await d1
      .prepare(
        `INSERT INTO blueprint_revisions
          (id, blueprint_version_id, parent_revision_id, revision_number, revision_hash, change_summary, created_by, created_at)
         VALUES (?, ?, NULL, 1, ?, NULL, ?, ?)`
      )
      .bind(revisionId, versionId, revisionHash, runRow.created_by, publishedAt)
      .run();
  } catch (err) {
    const existing = await d1
      .prepare(`SELECT id FROM blueprint_revisions WHERE blueprint_version_id = ? AND revision_number = 1`)
      .bind(versionId)
      .first<{ id: string }>();
    if (!existing) throw err;
    revisionId = existing.id;
  }

  await d1
    .prepare(`UPDATE blueprint_versions SET latest_revision_id = ? WHERE id = ?`)
    .bind(revisionId, versionId)
    .run();

  await d1
    .prepare(
      `UPDATE projects
       SET latest_blueprint_version_id = ?, latest_blueprint_revision_id = ?, latest_run_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(versionId, revisionId, runId, publishedAt, projectId)
    .run();

  return {
    output: { stage: 'publish_blueprint' as const, versionId, revisionId },
    status: 'succeeded' as const,
  };
}

export const STAGE_HANDLERS: Record<BlueprintStage, StageHandler> = Object.fromEntries(
  BLUEPRINT_STAGES.map((stage) => [stage, makeStubStage(stage)])
) as Record<BlueprintStage, StageHandler>;

STAGE_HANDLERS.validate_intake = validateIntakeHandler;
STAGE_HANDLERS.normalize_brief = normalizeBriefHandler;
STAGE_HANDLERS.collect_us_fanout = collectUsFanoutHandler;
STAGE_HANDLERS.publish_blueprint = publishBlueprintHandler;
