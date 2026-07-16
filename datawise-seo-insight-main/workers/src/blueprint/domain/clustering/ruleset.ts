import type { KeywordRelevanceRules, OpportunityRules } from '../score';

// Frozen ruleset for the clustering engine (Phase 4: normalize_keyword_universe,
// embed_keyword_features, build_provisional_clusters, refine_clusters). Every
// threshold those stages read must live here rather than be inlined at the
// call site: domain/clustering/ruleset.test.ts pins a canonical hash of this
// object, so changing any value without also bumping `version` (and the
// pinned hash) fails CI. That is Phase 4's acceptance requirement:
// "changing a threshold records a new ruleset version".
//
// cluster-v2 (2026-07-16): cluster-v1's first live run produced one
// 614-keyword mega-cluster (41% of the universe). Root cause: most keyword
// pairs have no SERP evidence, so weight renormalization scored them on
// bge-m3 cosine + intent alone, an effective merge bar of cosine >= 0.551,
// which is BELOW the cross-service cosine median (~0.52-0.57) measured on
// that run's 1505 stored vectors. v2 adds semantic-only floors calibrated
// from that benchmark: within-service medians 0.65-0.71, cross-service p95
// never above 0.74, true synonym pairs 0.88-0.96. See
// clusters.semanticOnlyMergeFloor / semanticOnlyAdjudicationFloor below.
export const CLUSTER_RULESET_V2 = Object.freeze({
  version: 'cluster-v2',
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
    // 19 steps take the local recut threshold from edgeThreshold (0.62) up to
    // 1.00. cluster-v1's 10-step ceiling (0.82) sat BELOW the minimum score a
    // gated semantic-only edge can carry (~0.87 at the 0.85 cosine floor), so
    // an oversized semantic-only component could never be cut. Calibration on
    // run_3c63faa9's vectors: synonym-template chains ("24 hour X near me")
    // percolate past cosine 0.91 and only fall under maxClusterSize around
    // 0.95, well above the old ceiling.
    oversizeRecutMaxSteps: 19,
    lowCohesionSplitThreshold: 0.45,
    ambiguousBand: { low: 0.52, high: 0.62 },
    // A pair with NO measured SERP overlap may only drive a merge when its
    // cosine is at synonym level. 0.85 sits above every cross-service p95
    // (max 0.74 in the calibration run) and above generic-head-term pairs
    // like "plumber" x "drain cleaning" (0.747), while true intent variants
    // ("emergency plumber" x "emergency plumbing" 0.956, "drain cleaning" x
    // "drain cleaning near me" 0.878) clear it. Pairs WITH measured SERP
    // overlap keep the combined edgeThreshold above.
    semanticOnlyMergeFloor: 0.85,
    // Below the merge floor, an unevidenced pair is only worth surfacing as
    // an adjudication case when its cosine is at least within-service level;
    // anything lower is noise, not ambiguity (cluster-v1 wrote 21K such rows
    // in one run).
    semanticOnlyAdjudicationFloor: 0.75,
    // Backstop for adjudication persistence: keep the highest-scoring cases,
    // never more than this many rows per run.
    maxPersistedAdjudications: 2000,
  },
  refine: {
    relatedSearchJaccardFloor: 0.5,
  },
  confidenceLabels: { high: 0.78, medium: 0.55 },
} as const);

export type ClusterRuleset = typeof CLUSTER_RULESET_V2;
