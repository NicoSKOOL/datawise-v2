import type { KeywordRelevanceRules, OpportunityRules } from '../score';

// Frozen v1 ruleset for the clustering engine (Phase 4: normalize_keyword_universe,
// embed_keyword_features, build_provisional_clusters, refine_clusters). Every
// threshold those stages read must live here rather than be inlined at the
// call site: domain/clustering/ruleset.test.ts pins a canonical hash of this
// object, so changing any value without also bumping `version` (and the
// pinned hash) fails CI. That is Phase 4's acceptance requirement:
// "changing a threshold records a new ruleset version".
export const CLUSTER_RULESET_V1 = Object.freeze({
  version: 'cluster-v1',
  edgeWeights: { semantic: 0.55, serpOverlap: 0.35, intent: 0.1 },
  edgeThreshold: 0.62,
  weightRenormalization: true,
  embedding: {
    model: '@cf/baai/bge-m3',
    dimensions: 1024,
    batchSize: 100,
    maxBatchesPerRun: 40,
    contextTemplate: 'kw_v1',
  },
  universe: {
    maxRetained: 1500,
    // Relevance/opportunity scoring itself is domain/score.ts's job; these
    // are just the rule inputs it needs, typed to its existing
    // KeywordRelevanceRules/OpportunityRules. Values copied from the
    // fixtures in domain/score.test.ts (relevanceRules / rules constants)
    // rather than invented, so they match already-reviewed behavior.
    relevanceRules: {
      weights: { service: 0.5, area: 0.3, category: 0.2 },
      excludedTopicPenalty: 0.5,
    } satisfies KeywordRelevanceRules,
    opportunityRules: {
      volumeWeight: 0.6,
      difficultyWeight: 0.4,
      volumeCap: 100_000,
    } satisfies OpportunityRules,
  },
  blocking: {
    maxCandidatePairs: 400_000,
  },
  clusters: {
    maxClusterSize: 25,
    oversizeRecutIncrement: 0.02,
    oversizeRecutMaxSteps: 10,
    lowCohesionSplitThreshold: 0.45,
    ambiguousBand: { low: 0.52, high: 0.62 },
  },
  refine: {
    relatedSearchJaccardFloor: 0.5,
  },
  confidenceLabels: { high: 0.78, medium: 0.55 },
} as const);

export type ClusterRuleset = typeof CLUSTER_RULESET_V1;
