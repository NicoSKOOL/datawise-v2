import { BLUEPRINT_STAGES } from '../contracts/enums';
import type { BlueprintStage } from '../contracts/enums';

export interface StageMeta {
  stage: BlueprintStage;
  required: boolean;
  // Per-stage overrides of process-run.ts's generic MAX_ATTEMPTS/
  // RETRY_BACKOFF_MS. Undefined means "use the generic defaults". Only the
  // SERP task_post/task_get poll (validate_serps_and_questions, Task 13)
  // needs this today: DataForSEO's async task takes real wall-clock time to
  // finish, so this stage's "failure" (SerpTasksPendingError, thrown while
  // the provider is still processing) needs many more, longer-spaced
  // attempts than a genuine transient error would ever need.
  maxAttempts?: number;
  retryBackoffMs?: number;
}

// Maps the handoff Manual §8 "critical path" list onto BLUEPRINT_STAGES.
// A required stage failing fails the whole run (see run-status.ts); every
// other stage is optional and its failure only degrades the run to
// 'partial' (a blueprint with declared gaps), it never fails the run:
//   - input validation           -> validate_intake
//   - market resolution          -> resolve_market
//   - brief normalization        -> normalize_brief (every downstream stage depends on it)
//   - research planning          -> plan_research (gates which evidence stages even run)
//   - minimum keyword evidence   -> collect_keyword_evidence
//   - initial clustering         -> build_provisional_clusters
//   - deterministic page plan    -> build_page_plan (the site skeleton + placements every later stage consumes)
//   - blueprint validation       -> validate_blueprint
//   - persistence / publish      -> publish_blueprint
const REQUIRED_STAGES = new Set<BlueprintStage>([
  'validate_intake',
  'resolve_market',
  'normalize_brief',
  'plan_research',
  'collect_keyword_evidence',
  'build_provisional_clusters',
  'build_page_plan',
  'validate_blueprint',
  'publish_blueprint',
]);

// Per-stage retry overrides (see StageMeta doc comment). 30s spacing x 12
// attempts gives ~6 minutes of polling headroom for a DataForSEO SERP batch
// to finish before this optional stage exhausts attempts and degrades the
// run to partial (catalog Sec 12: polling, not postbacks, in this phase).
const STAGE_RETRY_OVERRIDES: Partial<Record<BlueprintStage, Pick<StageMeta, 'maxAttempts' | 'retryBackoffMs'>>> = {
  validate_serps_and_questions: { maxAttempts: 12, retryBackoffMs: 30_000 },
};

export const STAGE_REGISTRY: readonly StageMeta[] = BLUEPRINT_STAGES.map((stage) => ({
  stage,
  required: REQUIRED_STAGES.has(stage),
  ...STAGE_RETRY_OVERRIDES[stage],
}));

const REGISTRY_BY_STAGE = new Map(STAGE_REGISTRY.map((meta) => [meta.stage, meta]));

export function stageMeta(stage: BlueprintStage): StageMeta {
  const meta = REGISTRY_BY_STAGE.get(stage);
  if (!meta) throw new Error(`Unknown blueprint stage: ${stage}`);
  return meta;
}
