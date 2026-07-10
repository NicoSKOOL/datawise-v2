import { BLUEPRINT_STAGES } from '../contracts/enums';
import type { BlueprintStage } from '../contracts/enums';

export interface StageMeta {
  stage: BlueprintStage;
  required: boolean;
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
//   - blueprint validation       -> validate_blueprint
//   - persistence / publish      -> publish_blueprint
const REQUIRED_STAGES = new Set<BlueprintStage>([
  'validate_intake',
  'resolve_market',
  'normalize_brief',
  'plan_research',
  'collect_keyword_evidence',
  'build_provisional_clusters',
  'validate_blueprint',
  'publish_blueprint',
]);

export const STAGE_REGISTRY: readonly StageMeta[] = BLUEPRINT_STAGES.map((stage) => ({
  stage,
  required: REQUIRED_STAGES.has(stage),
}));

const REGISTRY_BY_STAGE = new Map(STAGE_REGISTRY.map((meta) => [meta.stage, meta]));

export function stageMeta(stage: BlueprintStage): StageMeta {
  const meta = REGISTRY_BY_STAGE.get(stage);
  if (!meta) throw new Error(`Unknown blueprint stage: ${stage}`);
  return meta;
}
