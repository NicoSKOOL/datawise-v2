import type { NormalizedProjectBrief } from '../../contracts/types';
import { buildSeedQueries } from '../../domain/seeds';
import { V1_LIMITS } from '../../contracts/limits';

// Deliberate overestimates (real per-task cost is typically well under these):
// operators can lower either via the KV override below once real DataForSEO
// invoicing data is in. Keeping the defaults conservative means an
// under-configured KV never lets a run's actual spend blow past the budget
// ceiling this estimate is gating.
export interface DfsCostEstimates {
  labsTaskUsdMicro: number;
  serpTaskUsdMicro: number;
}

export const DEFAULT_DFS_COST_ESTIMATES: DfsCostEstimates = {
  labsTaskUsdMicro: 50_000, // $0.05
  serpTaskUsdMicro: 10_000, // $0.01
};

const DFS_COST_ESTIMATES_KV_KEY = 'bp:config:dfs-cost-estimates';

// Invalid JSON or a missing/mistyped field falls back to the default for
// that field specifically, not the whole record: an operator fixing one
// price should never accidentally zero out the other.
export async function loadDfsCostEstimates(kv: KVNamespace): Promise<DfsCostEstimates> {
  const raw = await kv.get(DFS_COST_ESTIMATES_KV_KEY);
  if (!raw) return { ...DEFAULT_DFS_COST_ESTIMATES };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_DFS_COST_ESTIMATES };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_DFS_COST_ESTIMATES };

  const override = parsed as Record<string, unknown>;
  const labsTaskUsdMicro =
    typeof override.labsTaskUsdMicro === 'number'
      ? override.labsTaskUsdMicro
      : DEFAULT_DFS_COST_ESTIMATES.labsTaskUsdMicro;
  const serpTaskUsdMicro =
    typeof override.serpTaskUsdMicro === 'number'
      ? override.serpTaskUsdMicro
      : DEFAULT_DFS_COST_ESTIMATES.serpTaskUsdMicro;

  return { labsTaskUsdMicro, serpTaskUsdMicro };
}

export interface CallPlanLine {
  operation: string;
  tasks: number;
  estimatedUsdMicro: number;
  cacheEligible: boolean;
}

export interface CallPlan {
  lines: CallPlanLine[];
  totalUsdMicro: number;
}

// Upper-bound planning constants (catalog Sec 15, adapted to Phase 3 scope).
// Competitor count is a plan-time guess: the real selected-competitor count
// isn't known until discover_competitors runs later in the pipeline, so this
// gate plans for the documented ceiling of 5 rather than the actual count.
const PLANNED_COMPETITOR_COUNT = 5;
const MAX_SUGGESTIONS_SEEDS = 8;
const MAX_SERP_SEEDS = 20;
const METRIC_ENRICHMENT_TASKS = 2; // one overview chunk + one bulk-KD chunk, upper bound

function planLine(operation: string, tasks: number, unitUsdMicro: number): CallPlanLine {
  return { operation, tasks, estimatedUsdMicro: tasks * unitUsdMicro, cacheEligible: true };
}

// Recomputes the plan from the normalized brief every time: this is the
// fail-fast budget gate's source of truth, so it must never trust a
// previously stored estimate that could have drifted from the current brief
// or current KV-configured prices.
export function buildCallPlan(brief: NormalizedProjectBrief, costs: DfsCostEstimates): CallPlan {
  const seedPlan = buildSeedQueries(brief, {
    maxTotalSeeds: V1_LIMITS.maxSeedQueries,
    includePrimaryAreaSeeds: true,
  });
  // Same population the SERP validation stage will use later, just capped
  // differently per operation below.
  const primaryAreaSeedCount = seedPlan.seeds.filter((s) => s.source === 'service_primary_area').length;

  const lines: CallPlanLine[] = [
    planLine('keyword_ideas', 1, costs.labsTaskUsdMicro),
    planLine('keyword_suggestions', Math.min(primaryAreaSeedCount, MAX_SUGGESTIONS_SEEDS), costs.labsTaskUsdMicro),
    ...(brief.mode === 'existing_site' && brief.websiteDomain
      ? [planLine('keywords_for_site', 1, costs.labsTaskUsdMicro)]
      : []),
    planLine('competitor_discovery', 1, costs.labsTaskUsdMicro),
    planLine('ranked_keywords', PLANNED_COMPETITOR_COUNT, costs.labsTaskUsdMicro),
    planLine('relevant_pages', PLANNED_COMPETITOR_COUNT, costs.labsTaskUsdMicro),
    planLine('metric_enrichment', METRIC_ENRICHMENT_TASKS, costs.labsTaskUsdMicro),
    planLine('serp_task_post', Math.min(primaryAreaSeedCount, MAX_SERP_SEEDS), costs.serpTaskUsdMicro),
  ].filter((l) => l.tasks > 0);

  const totalUsdMicro = lines.reduce((sum, l) => sum + l.estimatedUsdMicro, 0);
  return { lines, totalUsdMicro };
}
