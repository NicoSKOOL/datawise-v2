import type { NormalizedProjectBrief } from '../../contracts/types';
import type { BlueprintStage } from '../../contracts/enums';
import { buildSeedQueries } from '../../domain/seeds';
import { V1_LIMITS } from '../../contracts/limits';
import { PAGE_PLAN_RULESET_V1 } from '../../domain/page-plan/ruleset';

// Deliberate overestimates (real per-task cost is typically well under these):
// operators can lower either via the KV override below once real DataForSEO
// invoicing data is in. Keeping the defaults conservative means an
// under-configured KV never lets a run's actual spend blow past the budget
// ceiling this estimate is gating.
export interface DfsCostEstimates {
  labsTaskUsdMicro: number;
  serpTaskUsdMicro: number;
  contentParsingTaskUsdMicro: number;
}

export const DEFAULT_DFS_COST_ESTIMATES: DfsCostEstimates = {
  labsTaskUsdMicro: 50_000, // $0.05
  serpTaskUsdMicro: 10_000, // $0.01
  contentParsingTaskUsdMicro: 10_000, // $0.01 (deliberately overestimated per Phase 4 plan)
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
  const contentParsingTaskUsdMicro =
    typeof override.contentParsingTaskUsdMicro === 'number'
      ? override.contentParsingTaskUsdMicro
      : DEFAULT_DFS_COST_ESTIMATES.contentParsingTaskUsdMicro;

  return { labsTaskUsdMicro, serpTaskUsdMicro, contentParsingTaskUsdMicro };
}

export interface CallPlanLine {
  operation: string;
  tasks: number;
  estimatedUsdMicro: number;
  cacheEligible: boolean;
  stage: BlueprintStage;
}

export interface CallPlan {
  lines: CallPlanLine[];
  totalUsdMicro: number;
}

// Single owner of "which pipeline stage actually makes this DataForSEO call".
// Both the priced call-plan lines below (buildCallPlan) and the unpriced
// catalog/reference calls (catalogs.ts) are listed here so nothing else in
// the codebase needs (or is allowed to keep) its own copy of this mapping.
//
// A missing entry is not caught by the type checker: Record<string, ...>
// indexing types the lookup as BlueprintStage even for an operation string
// that isn't actually a key, so a forgotten mapping silently resolves to
// `undefined` at runtime. costs.test.ts's exhaustiveness test is what
// actually catches that, by asserting every operation buildCallPlan can
// produce has an entry here.
export const OPERATION_STAGE: Record<string, BlueprintStage> = {
  keyword_ideas: 'collect_keyword_evidence',
  keyword_suggestions: 'collect_keyword_evidence',
  keywords_for_site: 'collect_keyword_evidence',
  // Fix: enrichMissingMetrics (keywords.ts) runs inside
  // collectKeywordEvidenceHandler (orchestration/research-handlers.ts),
  // which is registered under collect_keyword_evidence
  // (orchestration/handlers.ts). It never runs as part of
  // normalize_keyword_universe, which is where this used to point.
  metric_enrichment: 'collect_keyword_evidence',
  competitor_discovery: 'discover_competitors',
  ranked_keywords: 'collect_competitor_evidence',
  relevant_pages: 'collect_competitor_evidence',
  serp_task_post: 'validate_serps_and_questions',
  // Catalog/reference calls (catalogs.ts): unpriced (estimateUsdMicro: 0),
  // never appear in buildCallPlan's lines, but resolveMarket runs them as
  // part of the resolve_market stage, so they belong in the same map.
  labs_locations_and_languages: 'resolve_market',
  serp_locations_catalog: 'resolve_market',
  serp_languages_catalog: 'resolve_market',
  // Phase 4 forward entries: these operations do not exist yet (no caller
  // makes them today). The entries are inert until a later Phase 4 task
  // adds the actual DataForSEO calls; kept here now so OPERATION_STAGE has
  // one owner from the start instead of catching up after the fact.
  content_parsing: 'parse_competitor_pages',
  site_ranked_urls: 'overlay_existing_site',
};

// Upper-bound planning constants (catalog Sec 15, adapted to Phase 3 scope).
// Competitor count is a plan-time guess: the real selected-competitor count
// isn't known until discover_competitors runs later in the pipeline, so this
// gate plans for the documented ceiling of 5 rather than the actual count.
const PLANNED_COMPETITOR_COUNT = 5;
const MAX_SUGGESTIONS_SEEDS = 8;
const MAX_SERP_SEEDS = 20;
const METRIC_ENRICHMENT_TASKS = 2; // one overview chunk + one bulk-KD chunk, upper bound
// parse_competitor_pages plans for the ruleset ceiling: up to maxClusters (10)
// clusters, pagesPerCluster (2) competitor URLs each = 20 content_parsing
// calls. This is a planning CEILING, not doubled for the single JS retry: the
// retry REPLACES an empty first pass (it is the exception, not an extra call
// per URL), and the plan doc's verification section budgets exactly 20 calls.
const CONTENT_PARSING_TASKS = PAGE_PLAN_RULESET_V1.parse.maxClusters * PAGE_PLAN_RULESET_V1.parse.pagesPerCluster;

function planLine(operation: string, tasks: number, unitUsdMicro: number): CallPlanLine {
  return {
    operation,
    tasks,
    estimatedUsdMicro: tasks * unitUsdMicro,
    cacheEligible: true,
    stage: OPERATION_STAGE[operation],
  };
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
    planLine('content_parsing', CONTENT_PARSING_TASKS, costs.contentParsingTaskUsdMicro),
  ].filter((l) => l.tasks > 0);

  const totalUsdMicro = lines.reduce((sum, l) => sum + l.estimatedUsdMicro, 0);
  return { lines, totalUsdMicro };
}
