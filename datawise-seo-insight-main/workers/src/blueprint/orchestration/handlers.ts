import { BLUEPRINT_STAGES } from '../contracts/enums';
import type { BlueprintStage } from '../contracts/enums';
import type { NormalizedProjectBrief } from '../contracts/types';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { hashNormalizedInput } from '../domain/hash';
import { V1_LIMITS } from '../contracts/limits';
import { newId, nowIso } from '../db/util';
import { loadGapStageNames } from './run-status';
import type { BlueprintProviderEnv } from './process-run';
import { loadDfsCostEstimates, buildCallPlan } from '../providers/dataforseo/costs';
import { BlueprintApiError } from '../domain/api-errors';
import { safeErrorMessage } from '../providers/dataforseo/envelope';
import { resolveMarket } from '../providers/dataforseo/catalogs';
import {
  collectKeywordEvidenceHandler,
  discoverCompetitorsHandler,
  collectCompetitorEvidenceHandler,
  validateSerpsAndQuestionsHandler,
} from './research-handlers';
import {
  normalizeKeywordUniverseHandler,
  embedKeywordFeaturesHandler,
  buildProvisionalClustersHandler,
  refineClustersHandler,
} from './clustering-handlers';
import {
  parseCompetitorPagesHandler,
  buildPagePlanHandler,
  overlayExistingSiteHandler,
  validateBlueprintHandler,
  loadFullPagePlan,
  loadOverlayArtifact,
} from './page-plan-handlers';
import type { ValidateBlueprintOutput } from './page-plan-handlers';
import { loadStageOutput } from './stage-io';
import { composeBlueprint } from '../domain/validate/compose';
import {
  orderPublishPages,
  buildPageJson,
  buildRevisionHashInput,
  buildBlueprintSummary,
} from '../domain/validate/publish';
import type { PublishPage } from '../domain/validate/publish';
import { BLUEPRINT_RULESET_VERSION, BLUEPRINT_SCHEMA_VERSION } from '../domain/ruleset';
import { runBatchedStatements, assertRowBudget } from '../db/batch';

export interface StageContext {
  env: BlueprintProviderEnv;
  d1: D1Database;
  runId: string;
  projectId: string;
  briefVersionId: string;
  normalizedBrief: NormalizedProjectBrief;
  // The stage being executed and the lease's attempt count for this
  // invocation. Provider wrappers scope budget reservation keys by attempt
  // so a retry after a released reservation reserves fresh instead of
  // colliding with the prior attempt's terminal reservation row.
  stage: BlueprintStage;
  attempt: number;
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

// blueprint_pages has 14 columns; one INSERT OR IGNORE statement per page keeps
// each statement at 14 bound params (well under D1's 100 limit) and lets
// runBatchedStatements group them, the same one-statement-per-row pattern
// page-plan-handlers.ts's persistPageCandidates uses. assertRowBudget fails at
// module load if a column addition ever pushes a single row past the limit.
const BLUEPRINT_PAGE_PARAMS_PER_ROW = 14;
assertRowBudget(1, BLUEPRINT_PAGE_PARAMS_PER_ROW, 'blueprint_pages materialization');

// Real persistence, not a stub: this is the only stage that writes outside
// research_stage_runs. It is written to be safe under a lease race (two
// workers both believing they hold the lease for this run/stage/hash) by
// reusing whatever row a UNIQUE-constraint loser's competitor already wrote,
// mirroring the INSERT-then-catch idempotency pattern used by
// db/idempotency.ts and db/budget.ts elsewhere in this module.
//
// Phase 4 (Task 20) extends it to materialize the real page set: it composes
// stage 15's page-plan.json + stage 16's overlay.json through the SAME
// composeBlueprint validate used (single composition source of truth), writes
// one blueprint_pages row per composed page, stamps the real ruleset/schema
// versions, folds the counts into summary_json, and folds the composed pages
// into revision_hash. All the added writes are idempotent under the same lease
// race: the pages use INSERT OR IGNORE keyed by UNIQUE(revision_id,
// logical_page_id), so a losing racer that reuses the winner's revision row
// re-inserts the identical page set as no-ops rather than duplicating or
// erroring. Composition, ordering, hashing, and summary counts are pure and
// deterministic (domain/validate/publish.ts), so both racers compute byte-
// identical hashes/blobs from the identical artifacts.
export async function publishBlueprintHandler(ctx: StageContext) {
  const { d1, runId, projectId } = ctx;

  const runRow = await d1
    .prepare(`SELECT created_by FROM research_runs WHERE id = ?`)
    .bind(runId)
    .first<RunPublishRow>();
  if (!runRow) throw new Error(`Research run not found: ${runId}`);

  // Compose the final page set the same way validate did. loadFullPagePlan
  // throws internal_error if page-plan.json is missing (a broken pipeline
  // precondition: build_page_plan is REQUIRED and ran before this stage), so
  // publish never silently ships an empty blueprint when a plan was expected.
  // Overlay is OPTIONAL (null -> every page 'create'). A plan that composes to
  // zero pages does not throw here: validate (the invalid-blueprint gate) runs
  // before publish and would have failed first; build_page_plan always emits at
  // least the brief-derived skeleton (> 0 pages), so a zero-page publish is
  // unreachable in practice, and if it ever occurred publish still records the
  // version/revision with pageCount 0 rather than inventing pages.
  const plan = await loadFullPagePlan(ctx);
  const overlay = await loadOverlayArtifact(ctx);
  const composed = composeBlueprint(plan.pages, overlay);

  // Pair each composed page with the PlannedPage it was composed from (for the
  // page_json detail + volume ordering). compose maps 1:1 off the plan, so a
  // missing counterpart is a corrupt-artifact invariant break -> internal_error.
  const plannedById = new Map(plan.pages.map((p) => [p.logicalId, p]));
  const publishPages: PublishPage[] = composed.pages.map((cp) => {
    const planned = plannedById.get(cp.logicalId);
    if (!planned) throw new BlueprintApiError('internal_error', safeErrorMessage('internal_error'));
    return { composed: cp, planned };
  });
  const ordered = orderPublishPages(publishPages);

  // revision_hash folds in the composed page set (+ consolidation proposals):
  // same plan -> same hash on replay; a different plan -> a different hash. Pure
  // function of the artifacts, no runId/versionId (those are random per run and
  // would defeat "the hash reflects the pages").
  const revisionHash = await hashNormalizedInput(buildRevisionHashInput(ordered, composed.consolidations));

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

  // summary_json counts come from the composed page set (so summary and the
  // materialized rows can never disagree). warningCount is read from
  // validate_blueprint's own output (it already computed the warning set);
  // absent -> 0 (publish never re-runs validation).
  const validateOutput = await loadStageOutput<ValidateBlueprintOutput>(d1, runId, 'validate_blueprint');
  const summary = buildBlueprintSummary({
    pages: composed.pages,
    consolidations: composed.consolidations,
    addressableDemandTotal: plan.stats.totalAddressableVolume ?? null,
    warningCount: validateOutput?.warningCount ?? 0,
    partialStages: gapStages,
  });
  const summaryJson = JSON.stringify(summary);
  const publishedAt = nowIso();

  let versionId = newId('bpv');
  try {
    await d1
      .prepare(
        `INSERT INTO blueprint_versions
          (id, project_id, run_id, version_number, status, schema_version, ruleset_version,
           completeness, partial_reasons_json, summary_json, latest_revision_id, published_at, created_at)
         VALUES (?, ?, ?, ?, 'published', ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .bind(
        versionId,
        projectId,
        runId,
        versionNumber,
        BLUEPRINT_SCHEMA_VERSION,
        BLUEPRINT_RULESET_VERSION,
        completeness,
        partialReasonsJson,
        summaryJson,
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

  // Materialize the pages against the (created or reused) revision. INSERT OR
  // IGNORE + UNIQUE(blueprint_revision_id, logical_page_id) makes this a no-op
  // on replay and lease-race safe: a losing racer that reused the winner's
  // revision id re-inserts the identical rows, which the unique constraint
  // ignores. Written after the revision row exists so the FK holds.
  const pageStatements: D1PreparedStatement[] = ordered.map((p, i) => {
    const c = p.composed;
    return d1
      .prepare(
        `INSERT OR IGNORE INTO blueprint_pages
          (row_id, blueprint_revision_id, logical_page_id, parent_logical_page_id, page_type,
           title, slug, primary_keyword_normalized, recommendation, approval,
           consolidate_target_logical_page_id, priority, confidence_label, page_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, NULL, ?, ?)`
      )
      .bind(
        newId('bppage'),
        revisionId,
        c.logicalId,
        c.parentLogicalId,
        c.pageType,
        c.title,
        c.slug,
        c.primaryKeyword,
        c.recommendation,
        c.recommendation === 'consolidate' ? c.consolidateTargetLogicalId : null,
        c.confidence,
        JSON.stringify(buildPageJson(p, i))
      );
  });
  await runBatchedStatements(d1, pageStatements);

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
    output: {
      stage: 'publish_blueprint' as const,
      versionId,
      revisionId,
      pageCount: summary.pageCount,
    },
    status: 'succeeded' as const,
  };
}

interface RunBudgetRow {
  dataforseo_budget_usd_micro: number;
}

// The fail-fast budget gate before any paid stage: recomputes the request
// plan fresh from the normalized brief and the (KV-overridable) cost
// estimates, then throws budget_exceeded if the plan's total would blow the
// run's approved DataForSEO budget ceiling. This is a REQUIRED stage: the
// throw fails the whole run rather than skipping ahead into paid calls.
async function planResearchHandler(ctx: StageContext) {
  const runRow = await ctx.d1
    .prepare(`SELECT dataforseo_budget_usd_micro FROM research_runs WHERE id = ?`)
    .bind(ctx.runId)
    .first<RunBudgetRow>();
  if (!runRow) throw new Error(`Research run not found: ${ctx.runId}`);

  const costs = await loadDfsCostEstimates(ctx.env.KV);
  const plan = buildCallPlan(ctx.normalizedBrief, costs);

  if (plan.totalUsdMicro > runRow.dataforseo_budget_usd_micro) {
    throw new BlueprintApiError('budget_exceeded', safeErrorMessage('budget_exceeded'));
  }

  return { output: { stage: 'plan_research' as const, plan } };
}

// Real market resolution, not a stub: pins the Labs location code, the
// per-service-area SERP location codes, and the run's language against the
// live DataForSEO catalogs. Required stage, but never throws for an
// individual unresolved service area -- those degrade into
// unresolvedAreaIds (downstream stages fall back to the country-level SERP
// code for them) rather than failing the whole run. It DOES throw for an
// unsupported language (BlueprintValidationError, permanent/user-correctable)
// or a country missing from a catalog (BlueprintApiError
// provider_invalid_response, via resolveMarket).
async function resolveMarketHandler(ctx: StageContext) {
  const market = await resolveMarket(ctx);
  return { output: market, status: 'succeeded' as const };
}

export const STAGE_HANDLERS: Record<BlueprintStage, StageHandler> = Object.fromEntries(
  BLUEPRINT_STAGES.map((stage) => [stage, makeStubStage(stage)])
) as Record<BlueprintStage, StageHandler>;

STAGE_HANDLERS.validate_intake = validateIntakeHandler;
STAGE_HANDLERS.resolve_market = resolveMarketHandler;
STAGE_HANDLERS.normalize_brief = normalizeBriefHandler;
STAGE_HANDLERS.plan_research = planResearchHandler;
STAGE_HANDLERS.collect_keyword_evidence = collectKeywordEvidenceHandler;
STAGE_HANDLERS.discover_competitors = discoverCompetitorsHandler;
STAGE_HANDLERS.collect_competitor_evidence = collectCompetitorEvidenceHandler;
STAGE_HANDLERS.validate_serps_and_questions = validateSerpsAndQuestionsHandler;
STAGE_HANDLERS.normalize_keyword_universe = normalizeKeywordUniverseHandler;
STAGE_HANDLERS.embed_keyword_features = embedKeywordFeaturesHandler;
STAGE_HANDLERS.build_provisional_clusters = buildProvisionalClustersHandler;
STAGE_HANDLERS.refine_clusters = refineClustersHandler;
STAGE_HANDLERS.parse_competitor_pages = parseCompetitorPagesHandler;
STAGE_HANDLERS.build_page_plan = buildPagePlanHandler;
STAGE_HANDLERS.overlay_existing_site = overlayExistingSiteHandler;
STAGE_HANDLERS.validate_blueprint = validateBlueprintHandler;
STAGE_HANDLERS.collect_us_fanout = collectUsFanoutHandler;
STAGE_HANDLERS.publish_blueprint = publishBlueprintHandler;
