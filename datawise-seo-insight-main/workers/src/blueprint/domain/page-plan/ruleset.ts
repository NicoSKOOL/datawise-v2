import type { DoorwayGuardrailRules } from '../doorway';
import { NAMING_STRIPPED_PHRASES, NAMING_STRIPPED_LEADING_WORDS } from '../keyword-naming';

// Frozen v1 ruleset for the page-planning engine (Phase 4:
// parse_competitor_pages, build_page_plan, overlay_existing_site,
// validate_blueprint, publish_blueprint). Every threshold those stages read
// must live here rather than be inlined at the call site:
// domain/page-plan/ruleset.test.ts pins a canonical hash of this object, so
// changing any value without also bumping `version` (and the pinned hash)
// fails CI. That is Phase 4's acceptance requirement: "changing a threshold
// records a new ruleset version".
export const PAGE_PLAN_RULESET_V1 = Object.freeze({
  version: 'pp-v2',
  // Search-query modifiers that make sense as keywords to TARGET but never as
  // page names: "drain cleaning service near me" is a real query, but no sane
  // site titles a page that. cleanKeywordForNaming strips these before a
  // cluster's primary keyword becomes a title/H1/slug/logical id; the page's
  // primaryKeyword field keeps the raw query. Phrases are removed anywhere in
  // the keyword; leading words only when they lead (so "best practices" content
  // topics mid-keyword survive).
  // The canonical lists live in domain/keyword-naming.ts (shared with the
  // clustering engine); referenced here so this ruleset and cleanKeywordForNaming
  // stay a single source of truth. Values are unchanged from pp-v2, so the pinned
  // drift hash is identical.
  naming: {
    strippedPhrases: NAMING_STRIPPED_PHRASES,
    strippedLeadingWords: NAMING_STRIPPED_LEADING_WORDS,
  },
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
