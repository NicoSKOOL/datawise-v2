import type { ResearchRunView, ResearchStageView, ProviderUsageEntry, ProviderUsageSummary } from '../contracts/api';
import type { BlueprintStage, RunStatus, StageStatus, BlueprintErrorCode } from '../contracts/enums';
import { STAGE_REGISTRY } from '../orchestration/stages';
import { assertRunAccess, type Actor, type RunRow } from '../db/access';
import { NotFoundError, BlueprintApiError } from '../domain/api-errors';
import { microToUsd } from '../db/util';
import { ok } from './envelope';
import type { BlueprintQueueEnv } from '../orchestration/process-run';

interface StageRunRow {
  stage_name: string;
  status: StageStatus;
  required: number;
  attempt_count: number;
  started_at: string | null;
  finished_at: string | null;
  next_retry_at: string | null;
  safe_error_code: BlueprintErrorCode | null;
  safe_error_message: string | null;
  cost_usd_micro: number;
}

interface BlueprintVersionRow {
  id: string;
}

interface ProviderUsageRow {
  id: string;
  run_id: string;
  stage: string;
  provider: string;
  operation: string;
  endpoint_or_model: string;
  provider_request_id: string | null;
  provider_task_ids_json: string;
  provider_generation_id: string | null;
  cache_status: string;
  request_count: number;
  returned_item_count: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  cached_tokens: number | null;
  finish_reason: string | null;
  cost_usd_micro: number;
  latency_ms: number;
  created_at: string;
}

function buildPendingStageView(stage: BlueprintStage, required: boolean): ResearchStageView {
  return {
    stage,
    status: 'pending',
    required,
    progressCurrent: null,
    progressTotal: null,
    attemptCount: 0,
    startedAt: null,
    finishedAt: null,
    nextRetryAt: null,
    message: null,
    safeErrorCode: null,
    actualCostUsd: '0.00',
  };
}

function buildStageViewFromRow(row: StageRunRow): ResearchStageView {
  return {
    stage: row.stage_name as BlueprintStage,
    status: row.status,
    required: !!row.required,
    progressCurrent: null,
    progressTotal: null,
    attemptCount: row.attempt_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    nextRetryAt: row.next_retry_at,
    message: row.safe_error_message,
    safeErrorCode: row.safe_error_code,
    actualCostUsd: microToUsd(row.cost_usd_micro),
  };
}

// The embedded run-level usage summary reflects the run's own actual-cost
// columns (kept current by budget reconciliation elsewhere), not a live
// aggregate over provider_usage rows. Phase 2 tracks no token/request
// counts on the run row itself, so those fields are 0 here; the dedicated
// usage endpoint below sums the real provider_usage rows instead.
function buildUsageSummaryFromRunActuals(run: RunRow): ProviderUsageSummary {
  const dataForSeoCostUsd = microToUsd(run.dataforseo_actual_usd_micro);
  const openRouterCostUsd = microToUsd(run.openrouter_actual_usd_micro);
  const totalCostUsd = microToUsd(run.dataforseo_actual_usd_micro + run.openrouter_actual_usd_micro);
  return {
    dataForSeoCostUsd,
    openRouterCostUsd,
    totalCostUsd,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    requestCount: 0,
  };
}

// Shared view builder (used by getRun, cancelRun, retryRun, and
// projects.ts's startResearchRun): merges the persisted stage rows for a
// run over the full 19-stage registry so a stage that has never been
// attempted still shows up as an explicit 'pending' entry instead of being
// absent from the response.
export async function buildRunView(d1: D1Database, runId: string): Promise<ResearchRunView> {
  const run = await d1.prepare('SELECT * FROM research_runs WHERE id = ?').bind(runId).first<RunRow>();
  if (!run) throw new NotFoundError(`Research run not found: ${runId}`);

  const stageRows = await d1
    .prepare('SELECT * FROM research_stage_runs WHERE run_id = ?')
    .bind(runId)
    .all<StageRunRow>();
  const byStage = new Map(stageRows.results.map((row) => [row.stage_name, row]));

  const stages = STAGE_REGISTRY.map((meta) => {
    const row = byStage.get(meta.stage);
    return row ? buildStageViewFromRow(row) : buildPendingStageView(meta.stage, meta.required);
  });

  const blueprintVersion = await d1
    .prepare('SELECT id FROM blueprint_versions WHERE run_id = ?')
    .bind(runId)
    .first<BlueprintVersionRow>();

  const partialReasons: string[] = JSON.parse(run.partial_reasons_json || '[]');

  return {
    id: run.id,
    projectId: run.project_id,
    status: run.status as RunStatus,
    currentStage: (run.current_stage as BlueprintStage | null) ?? null,
    stages,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    blueprintVersionId: blueprintVersion?.id ?? null,
    partialReasons,
    usage: buildUsageSummaryFromRunActuals(run),
  };
}

export async function getRun(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  await assertRunAccess(env.BLUEPRINT_DB, actor, params.id);
  const view = await buildRunView(env.BLUEPRINT_DB, params.id);
  return ok(view);
}

// Exported so other routes (deleteProject) that need to cancel runs in bulk
// reuse the exact same non-terminal status set instead of re-deriving it.
export const CANCELLABLE_STATUSES = ['queued', 'running', 'partial'];
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'cancelled']);

export async function cancelRun(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  await assertRunAccess(env.BLUEPRINT_DB, actor, params.id);

  const update = await env.BLUEPRINT_DB
    .prepare(
      `UPDATE research_runs SET status = 'cancel_requested'
       WHERE id = ? AND status IN (${CANCELLABLE_STATUSES.map(() => '?').join(',')})`
    )
    .bind(params.id, ...CANCELLABLE_STATUSES)
    .run();

  if (update.meta.changes === 0) {
    const run = await assertRunAccess(env.BLUEPRINT_DB, actor, params.id);
    if (TERMINAL_RUN_STATUSES.has(run.status as RunStatus)) {
      throw new BlueprintApiError('run_cancelled', `Run is already in a terminal state: ${run.status}`);
    }
    throw new BlueprintApiError('stage_conflict', `Run cannot be cancelled from status: ${run.status}`);
  }

  // Prompt the cancel_requested -> cancelled conversion instead of waiting
  // for whatever message is already in flight (there may be none, e.g. a
  // run parked in retry_wait between queue deliveries). Non-fatal: a queue
  // outage here must not block returning the 202 the client is waiting on;
  // the next production wake-up (see orchestration/consumer.ts) or a later
  // retry will still pick up the cancellation.
  try {
    await env.BLUEPRINT_QUEUE.send({ runId: params.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Blueprint cancelRun: failed to send wake-up for run ${params.id}: ${message}`);
  }

  const view = await buildRunView(env.BLUEPRINT_DB, params.id);
  return ok(view, 202);
}

const RETRYABLE_RUN_STATUSES = ['failed', 'cancelled', 'partial'];
const RETRYABLE_STAGE_STATUSES = ['failed', 'cancelled', 'retry_wait'];

export async function retryRun(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  await assertRunAccess(env.BLUEPRINT_DB, actor, params.id);
  // RetryRunInput (fromStage/failedOnly) is accepted on the wire but ignored
  // in Phase 2: every eligible stage row resets, there is no partial-retry
  // scoping yet. The body is intentionally not read here since it carries
  // no fields this phase acts on.

  const update = await env.BLUEPRINT_DB
    .prepare(
      `UPDATE research_runs SET status = 'queued', finished_at = NULL
       WHERE id = ? AND status IN (${RETRYABLE_RUN_STATUSES.map(() => '?').join(',')})`
    )
    .bind(params.id, ...RETRYABLE_RUN_STATUSES)
    .run();

  if (update.meta.changes === 0) {
    const run = await assertRunAccess(env.BLUEPRINT_DB, actor, params.id);
    throw new BlueprintApiError('stage_conflict', `Run cannot be retried from status: ${run.status}`);
  }

  // Reset only failed/cancelled/retry_wait stage rows; succeeded/skipped
  // rows are left exactly as they are so a retry never reruns work that
  // already completed (acceptance criterion: restarting a failed late stage
  // does not rerun successful stages).
  await env.BLUEPRINT_DB
    .prepare(
      `UPDATE research_stage_runs
       SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL, next_retry_at = NULL,
           safe_error_code = NULL, safe_error_message = NULL, attempt_count = 0
       WHERE run_id = ? AND status IN (${RETRYABLE_STAGE_STATUSES.map(() => '?').join(',')})`
    )
    .bind(params.id, ...RETRYABLE_STAGE_STATUSES)
    .run();

  await env.BLUEPRINT_QUEUE.send({ runId: params.id });

  const view = await buildRunView(env.BLUEPRINT_DB, params.id);
  return ok(view, 202);
}

interface UsageAccumulator {
  dataForSeoMicro: number;
  openRouterMicro: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  requestCount: number;
}

function summarizeUsageRows(rows: ProviderUsageRow[]): ProviderUsageSummary {
  const acc = rows.reduce<UsageAccumulator>(
    (a, row) => {
      if (row.provider === 'dataforseo') a.dataForSeoMicro += row.cost_usd_micro;
      if (row.provider === 'openrouter') a.openRouterMicro += row.cost_usd_micro;
      a.promptTokens += row.prompt_tokens ?? 0;
      a.completionTokens += row.completion_tokens ?? 0;
      a.reasoningTokens += row.reasoning_tokens ?? 0;
      a.cachedTokens += row.cached_tokens ?? 0;
      a.requestCount += row.request_count;
      return a;
    },
    {
      dataForSeoMicro: 0,
      openRouterMicro: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cachedTokens: 0,
      requestCount: 0,
    }
  );
  return {
    dataForSeoCostUsd: microToUsd(acc.dataForSeoMicro),
    openRouterCostUsd: microToUsd(acc.openRouterMicro),
    totalCostUsd: microToUsd(acc.dataForSeoMicro + acc.openRouterMicro),
    promptTokens: acc.promptTokens,
    completionTokens: acc.completionTokens,
    reasoningTokens: acc.reasoningTokens,
    cachedTokens: acc.cachedTokens,
    requestCount: acc.requestCount,
  };
}

export async function getUsage(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  await assertRunAccess(env.BLUEPRINT_DB, actor, params.id);

  const result = await env.BLUEPRINT_DB
    .prepare('SELECT * FROM provider_usage WHERE run_id = ? ORDER BY created_at ASC')
    .bind(params.id)
    .all<ProviderUsageRow>();

  const items: ProviderUsageEntry[] = result.results.map((row) => ({
    id: row.id,
    runId: row.run_id,
    stage: row.stage as BlueprintStage,
    provider: row.provider as ProviderUsageEntry['provider'],
    operation: row.operation,
    endpointOrModel: row.endpoint_or_model,
    providerRequestId: row.provider_request_id,
    providerTaskIds: JSON.parse(row.provider_task_ids_json || '[]'),
    providerGenerationId: row.provider_generation_id,
    cacheStatus: row.cache_status as ProviderUsageEntry['cacheStatus'],
    requestCount: row.request_count,
    returnedItemCount: row.returned_item_count,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    cachedTokens: row.cached_tokens,
    finishReason: row.finish_reason,
    costUsd: microToUsd(row.cost_usd_micro),
    latencyMs: row.latency_ms,
    createdAt: row.created_at,
  }));

  return ok({ items, summary: summarizeUsageRows(result.results) });
}
