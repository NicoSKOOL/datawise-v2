import type { DoorwayGuardrailRules } from '../doorway';

// Frozen v1 ruleset for the page-planning engine (Phase 4:
// parse_competitor_pages, build_page_plan, overlay_existing_site,
// validate_blueprint, publish_blueprint). Every threshold those stages read
// must live here rather than be inlined at the call site:
// domain/page-plan/ruleset.test.ts pins a canonical hash of this object, so
// changing any value without also bumping `version` (and the pinned hash)
// fails CI. That is Phase 4's acceptance requirement: "changing a threshold
// records a new ruleset version".
export const PAGE_PLAN_RULESET_V1 = Object.freeze({
  version: 'pp-v1',
  separate: {
    minStrongSignals: 2,
    lowSerpOverlapMax: 0.3,
    dedicatedCompetitorRatioMin: 0.4,
    minDemandVolume: 50,
  },
  fold: {
    highSerpOverlapMin: 0.6,
    questionWords: ['how', 'what', 'why', 'when', 'which', 'can', 'do', 'does', 'is', 'are', 'should'],
  },
  hubs: { serviceHubMinChildren: 3, locationHubMinChildren: 2 },
  // Type-compatible with domain/doorway.ts's DoorwayGuardrailRules: local
  // evidence required, unique proof required, a volume floor of 20 (below
  // that, evaluateServiceLocationPage denies the page as a doorway risk).
  doorway: {
    requireLocalEvidence: true,
    requireUniqueProof: true,
    minClusterVolume: 20,
  } satisfies DoorwayGuardrailRules,
  cannibalization: { serpOverlapWarnMin: 0.7 },
  parse: { maxClusters: 10, pagesPerCluster: 2, minContentChars: 400, maxHeadings: 50 },
  overlay: { maxSitemapUrls: 500, maxPageFetches: 20, keepMatchScoreMin: 0.75, matchScoreMin: 0.4 },
  caps: { maxTitleChars: 120, maxSlugChars: 200 },
} as const);

export type PagePlanRuleset = typeof PAGE_PLAN_RULESET_V1;
