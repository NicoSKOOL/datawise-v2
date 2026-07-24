import type {
  ConfidenceLabel, PageType, RecommendationStatus, SearchIntent,
} from '../../contracts/enums';
import type { BlueprintWarning, ScoreBreakdown } from '../../contracts/types';

// Page-plan domain vocabulary (stage 15 `build_page_plan`). Pure types only:
// nothing here reads a clock, a network, or D1. Everything a PlannedPage carries
// maps onto a `blueprint_pages` column (see db/schema.sql) or is folded into its
// `page_json` blob so stage 19 can materialize a row without re-deriving it.
//
// PageType is re-exported from contracts/enums rather than redefined so it stays
// identical to the value stage 19 writes into `blueprint_pages.page_type`. Note
// the naming: the handoff spec's "informational" page is `resource` here and its
// "about" page is `company`; this module uses the canonical enum names.
export type { PageType };

// ---------------------------------------------------------------------------
// Placement + signal vocabulary
// ---------------------------------------------------------------------------

// Where a cluster's demand is served. A dedicated_page earns its own URL; a
// section rides inside a parent page's body; a faq rides inside a parent's FAQ
// block. The >= minStrongSignals decision that chooses between these lives in
// the engine (Task 16); this module only supplies the evidence.
export type Placement = 'dedicated_page' | 'section' | 'faq';

// The six "strong signals" that argue for a dedicated page (handoff manual,
// stage 13 decision logic). Each name is a stable string so it can be persisted
// in `keyword_clusters.decision_reason` and rendered in the UI.
export type StrongSignalKind =
  | 'distinct_intent'            // cluster intent differs from the parent it would fold into
  | 'low_serp_overlap'           // cluster SERP results barely overlap the parent's
  | 'competitor_dedicated_pages' // >= 40% of parsed competitors give this topic its own page
  | 'unique_conversion'          // cluster owns a distinct conversion action vs the parent
  | 'sufficient_demand'          // addressable volume clears the demand floor
  | 'unique_local_proof';        // cluster ties to a service area backed by real local proof

// Alias used by PlacementDecision.strongSignals: the list of signal names that
// fired for a cluster. Kept distinct from SignalEvaluation (which also carries
// the absent signals + reasons) so callers can store just the fired names.
export type StrongSignal = StrongSignalKind;

// One evaluated signal: present or absent, always with a human reason string so
// score_breakdown / decision_reason can explain the call either way.
export interface SignalEvaluation {
  kind: StrongSignalKind;
  present: boolean;
  reason: string;
}

// The engine's per-cluster placement outcome. `strongSignals` holds only the
// signals that fired; `reasons` accumulates the human-readable evidence lines
// (from signal evaluations and fold checks) written back to decision_reason.
export interface PlacementDecision {
  clusterId: string;
  placement: Placement;
  targetLogicalId: string;
  strongSignals: StrongSignal[];
  reasons: string[];
}

// A borderline service-variant fold the engine could not decide deterministically
// (pp-v3, spec 3.3a): the cluster's cleaned tokens are a subset of the service
// tokens + generic modifiers EXCEPT for exactly one extra token that is neither
// generic nor a number. The engine folds it into the service page as a section
// (never mints a variant page) AND surfaces this case so the orchestration layer
// can persist a `variant_fold` cluster_adjudications row (decision 'pending') for
// the Phase D LLM adjudicator. `extraToken` is the single token that failed the
// subset test.
export interface VariantFoldCase {
  clusterId: string;
  serviceId: string;
  keyword: string;
  extraToken: string;
}

// shouldFold's verdict. `as` is only meaningful when `fold` is true; it defaults
// to 'section' otherwise.
export interface FoldDecision {
  fold: boolean;
  as: 'section' | 'faq';
  reason: string;
}

// ---------------------------------------------------------------------------
// Facts the engine feeds these building blocks (stage 16 facts loader).
// Minimal + serializable: sourced from keyword_clusters, parsed_competitor_pages,
// and the normalized brief. Missing metrics are null, NEVER 0 (handoff rule).
// ---------------------------------------------------------------------------

// A single parsed competitor page as it bears on one cluster. `hasParsedData`
// separates "competitor considered but page never parsed" (evidence absent)
// from "parsed and simply does not cover this topic" (evidence against). Tokens
// are already normalized (lowercased, punctuation-stripped) by the loader.
export interface CompetitorPageFact {
  competitorDomain: string;
  hasParsedData: boolean;
  titleTokens: string[];
  headingTokens: string[];
}

// SERP result URLs for a cluster. `urls === null` means SERP data was never
// collected (signal absent, never assumed); an empty array means collected but
// empty. Both are treated as "overlap not computable".
export interface ClusterSerpFacts {
  urls: string[] | null;
}

// The cluster surface the page-plan engine reasons over. Richer than Phase 1's
// KeywordClusterSummary: it carries intent, SERP URLs, service/area links, and
// the parsed-competitor evidence needed by the strong-signal evaluators.
export interface PagePlanCluster {
  clusterId: string;
  label: string;
  primaryKeywordId: string;
  primaryKeyword: string;          // normalized (normalizeKeyword output)
  coreTokens: string[];            // minimal normalized tokens that define the topic
  intent: SearchIntent | null;
  addressableVolume: number | null; // null when metrics missing, never 0-as-missing
  confidence: ConfidenceLabel | null;
  serviceId: string | null;
  serviceAreaId: string | null;
  hasLocalizedEvidence: boolean;
  serp: ClusterSerpFacts;
  competitorPages: CompetitorPageFact[];
  // Evidence-ref ids backing this cluster's placement decision: the union of its
  // member keywords' evidence refs, as the clustering stage already computed and
  // stored in keyword_clusters.score_breakdown_json.evidenceRefIds. The facts
  // loader threads these through so a PlannedPage can carry the evidence its
  // decision rests on (Phase 4 acceptance: score breakdown + evidence refs on
  // every page decision). Empty when the cluster carries no refs, never fabricated.
  evidenceRefIds: string[];
  // The cluster's member keywords with their search volumes, volume DESC (null
  // volumes last). Feeds each page's supportingKeywords list (pp-v3, spec 3.7):
  // a page's supporting keywords are the member keywords of every cluster on it,
  // minus the page's primary keyword. Empty when the cluster has no members loaded.
  memberKeywords: Array<{ keyword: string; volume: number | null }>;
}

// The candidate parent a cluster would attach to or fold into (home, a hub, a
// service page, ...). Signals compare a cluster against this shape.
export interface ParentCandidate {
  logicalId: string;
  pageType: PageType;
  intent: SearchIntent | null;
  serpUrls: string[] | null;
  serviceId: string | null;
  serviceAreaId: string | null;
}

// Brief-derived facts the signals need beyond the cluster itself (unique local
// proof lookup). Minimal projection of NormalizedProjectBrief.
export interface PagePlanBriefFacts {
  businessName: string;
  normalizedBusinessName: string;
  category: string;
  languageCode: string;
  countryIso: string;
  services: Array<{
    id: string;
    name: string;
    normalizedName: string;
    priority: 'primary' | 'secondary';
  }>;
  serviceAreas: Array<{
    id: string;
    city: string;
    region: string | null;
    isPrimary: boolean;
    uniqueProof: string[];
  }>;
}

// Placeholder for stage 14 (overlay_existing_site) output. Greenfield runs pass
// null. Fleshed out in the overlay task; kept minimal + serializable here.
export interface PagePlanOverlay {
  matchedLogicalIds: string[];
}

// Everything the engine consumes to plan a site.
export interface PagePlanFacts {
  brief: PagePlanBriefFacts;
  clusters: PagePlanCluster[];
  overlay: PagePlanOverlay | null;
}

// ---------------------------------------------------------------------------
// The planned page (engine output; stage 19 materializes it to blueprint_pages)
// ---------------------------------------------------------------------------

// One section inside a page. clusterId is absent for skeleton sections that do
// not fold a cluster (e.g. a hand-authored intro block).
export interface PlannedPageSection {
  heading: string;
  clusterId?: string;
  keywordIds: string[];
}

// Scoring + evidence carried on a page (folded into `page_json`). addressable
// volume counts each primary keyword once and is null when metrics are missing.
// scoreBreakdown is null until the engine scores the page.
export interface PlannedPageScores {
  addressableVolume: number | null;
  confidence: ConfidenceLabel | null;
  scoreBreakdown: ScoreBreakdown | null;
  evidenceRefs: string[];
}

// A page in the plan. logicalId + slug + title + h1 + parentLogicalId +
// primaryKeyword + recommendation map to blueprint_pages columns; the rest rides
// in page_json. metaDescription stays null until synthesize_page_briefs fills it
// (placeholder policy). recommendation defaults to 'create'; the overlay stage
// may later set update/keep/consolidate. sections is bounded by the engine.
//
// consolidateTargetLogicalId is the logical id of the page this page should be
// consolidated INTO, and is meaningful only when recommendation === 'consolidate'
// (blueprint_pages enforces this with a CHECK: a consolidate row must carry a
// non-null consolidate_target_logical_page_id, see db/schema.sql). The build_page_plan
// engine always leaves it null: it only ever proposes 'create'. Stage 16
// overlay_existing_site is the stage that can turn an existing URL into a
// consolidation proposal; this field is where that target would live once the
// overlay handler (Task 18) folds its match result back onto the plan.
export interface PlannedPage {
  logicalId: string;
  pageType: PageType;
  slug: string;
  title: string;
  h1: string;
  parentLogicalId: string | null;
  primaryKeywordId: string | null;
  primaryKeyword: string | null;
  clusterIds: string[];
  sections: PlannedPageSection[];
  // Ranked secondary keywords for this page (pp-v3, spec 3.7): the member keywords
  // of every cluster on the page minus the primary keyword, deduped, volume DESC,
  // capped at ruleset.supporting.storeCap. Persisted to
  // blueprint_pages.supporting_keywords_json.
  supportingKeywords: string[];
  metaDescription: string | null;
  recommendation: RecommendationStatus;
  consolidateTargetLogicalId: string | null;
  scores: PlannedPageScores;
  warnings: BlueprintWarning[];
}
