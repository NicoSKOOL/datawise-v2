// Layering note: the Phase 4 plan originally sketched this module as
// contracts/ruleset.ts, importing CLUSTER_RULESET_V1 and PAGE_PLAN_RULESET_V1
// from domain/. That inverts the existing convention in this codebase:
// contracts/ is a leaf directory (its files only import from other files
// inside contracts/), domain/ imports from contracts/, and orchestration/
// imports from both. Nothing under contracts/ imports from domain/ or
// orchestration/ anywhere today (grep confirms it). Making contracts/ depend
// on domain/ would be a one-off exception to that rule for no real benefit,
// so this lives in domain/ instead, importing the two ruleset objects the
// same way domain/graph.ts imports domain/slug.ts (a normal domain-internal
// import) and importing BlueprintStage from contracts/enums the same way
// domain/hash.ts already does.
import type { BlueprintStage } from '../contracts/enums';
import { CLUSTER_RULESET_V1 } from './clustering/ruleset';
import { PAGE_PLAN_RULESET_V1 } from './page-plan/ruleset';

// The stub version stamped on every stage before this task, and still what
// every stage outside the clustering/page-planning families gets: those
// stages (intake, market resolution, evidence collection, etc.) do not read
// a versioned ruleset object yet, so there is nothing to bump.
export const LEGACY_RULESET_VERSION = 'phase2-stub';

// Composite version stamped on published blueprint_versions rows and useful
// for logging/debugging: identifies exactly which pair of frozen rulesets a
// run's clustering + page-planning stages were governed by.
export const BLUEPRINT_RULESET_VERSION = `${CLUSTER_RULESET_V1.version}+${PAGE_PLAN_RULESET_V1.version}`;

// Phase 4 schema tag, mirrors the 'p2'/'p3' schema_version literals already
// used elsewhere (e.g. orchestration/handlers.ts's publishBlueprintHandler).
export const BLUEPRINT_SCHEMA_VERSION = 'p4';

const CLUSTER_STAGES = new Set<BlueprintStage>([
  'normalize_keyword_universe',
  'embed_keyword_features',
  'build_provisional_clusters',
  'refine_clusters',
]);

const PAGE_PLAN_STAGES = new Set<BlueprintStage>([
  'parse_competitor_pages',
  'build_page_plan',
  'overlay_existing_site',
  'validate_blueprint',
  'publish_blueprint',
]);

// Single source of truth for "which ruleset version governs this stage's
// input hash and stage row". Every stage in BLUEPRINT_STAGES resolves to
// exactly one of: the clustering ruleset, the page-plan ruleset, or the
// legacy stub, so a threshold edit to either frozen ruleset automatically
// re-keys the stage input hashes of every stage that reads it.
export function rulesetVersionForStage(stage: BlueprintStage): string {
  if (CLUSTER_STAGES.has(stage)) return CLUSTER_RULESET_V1.version;
  if (PAGE_PLAN_STAGES.has(stage)) return PAGE_PLAN_RULESET_V1.version;
  return LEGACY_RULESET_VERSION;
}
