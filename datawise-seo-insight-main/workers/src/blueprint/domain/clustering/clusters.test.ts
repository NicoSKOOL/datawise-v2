import { describe, it, expect } from 'vitest';
import { buildDeterministicClusters } from './clusters';
import type { KeywordNode, GraphEdge } from './graph';
import type { ConstraintViolation } from './constraints';
import { CLUSTER_RULESET_V1 } from './ruleset';
import type { ClusterRuleset } from './ruleset';

const RS = CLUSTER_RULESET_V1;

function kw(overrides: Partial<KeywordNode> & { keywordId: string }): KeywordNode {
  return {
    normalizedKeyword: overrides.keywordId,
    isBranded: false,
    intent: null,
    serviceIds: [],
    serviceAreaIds: [],
    tokens: [],
    coreKeyword: null,
    vector: null,
    serpUrls: null,
    relevance: null,
    volume: null,
    ...overrides,
  };
}

function edge(a: string, b: string, score: number, violations: ConstraintViolation[] = []): GraphEdge {
  const [x, y] = a < b ? [a, b] : [b, a];
  return {
    a: x,
    b: y,
    score,
    components: { semantic: null, serpJaccard: null, intent: null },
    weightsUsed: { semantic: 0, serpOverlap: 0, intent: 0 },
    violations,
  };
}

const empty = new Map<string, string>();

describe('known topology', () => {
  const nodes = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'].map((id) => kw({ keywordId: id }));
  const edges = [
    edge('k1', 'k2', 0.8),
    edge('k2', 'k3', 0.7),
    edge('k4', 'k5', 0.75),
    edge('k5', 'k6', 0.72),
    edge('k6', 'k7', 0.68),
  ];

  it('produces 2 clusters and 1 singleton with exact membership', () => {
    const { clusters, stats } = buildDeterministicClusters({ nodes, edges, displayKeywords: empty, ruleset: RS });
    expect(clusters.map((c) => c.clusterKey)).toEqual(['k1', 'k4', 'k8']);
    expect(clusters[0].memberIds).toEqual(['k1', 'k2', 'k3']);
    expect(clusters[1].memberIds).toEqual(['k4', 'k5', 'k6', 'k7']);
    expect(clusters[2].memberIds).toEqual(['k8']);
    expect(stats).toEqual({ clusterCount: 3, singletonCount: 1, oversizedSplit: 0 });
  });

  it('ignores forbidden edges even at high score', () => {
    const withForbidden = [...edges, edge('k7', 'k8', 0.99, ['incompatible_intent'])];
    const { clusters } = buildDeterministicClusters({ nodes, edges: withForbidden, displayKeywords: empty, ruleset: RS });
    // k8 stays a singleton; k7 stays in cluster 2.
    expect(clusters.find((c) => c.memberIds.includes('k8'))!.memberIds).toEqual(['k8']);
  });

  it('ignores sub-threshold (ambiguous-band) edges', () => {
    const withAmbiguous = [...edges, edge('k7', 'k8', 0.55)];
    const { clusters } = buildDeterministicClusters({ nodes, edges: withAmbiguous, displayKeywords: empty, ruleset: RS });
    expect(clusters.find((c) => c.memberIds.includes('k8'))!.memberIds).toEqual(['k8']);
  });

  it('computes membership scores as mean incident clean-edge score (1.0 singleton)', () => {
    const { clusters } = buildDeterministicClusters({ nodes, edges, displayKeywords: empty, ruleset: RS });
    const c1 = clusters[0];
    expect(c1.membershipScores).toEqual({ k1: 0.8, k2: 0.75, k3: 0.7 });
    const singleton = clusters[2];
    expect(singleton.membershipScores).toEqual({ k8: 1 });
  });

  it('is order-invariant', () => {
    const r1 = buildDeterministicClusters({ nodes, edges, displayKeywords: empty, ruleset: RS });
    const r2 = buildDeterministicClusters({
      nodes: [...nodes].reverse(),
      edges: [...edges].reverse(),
      displayKeywords: empty,
      ruleset: RS,
    });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});

describe('primary / label / service / area / intent selection', () => {
  const nodes = [
    kw({ keywordId: 'k1', normalizedKeyword: 'alpha', relevance: 0.5, volume: 100, serviceIds: ['s2'], serviceAreaIds: ['a1'], intent: 'commercial' }),
    kw({ keywordId: 'k2', normalizedKeyword: 'beta', relevance: 0.9, volume: 50, serviceIds: ['s1'], serviceAreaIds: ['a1'], intent: 'commercial' }),
    kw({ keywordId: 'k3', normalizedKeyword: 'gamma', relevance: null, volume: 999, serviceIds: ['s1'], serviceAreaIds: ['a2'], intent: 'informational' }),
  ];
  const edges = [edge('k1', 'k2', 0.7), edge('k2', 'k3', 0.7)];
  const display = new Map([['k2', 'Beta Display']]);

  it('picks primary by relevance desc, volume desc, keyword asc', () => {
    const { clusters } = buildDeterministicClusters({ nodes, edges, displayKeywords: display, ruleset: RS });
    expect(clusters[0].primaryKeywordId).toBe('k2'); // highest relevance 0.9
    expect(clusters[0].label).toBe('Beta Display');
  });

  it('picks most frequent service/area with smallest-id tie-break', () => {
    const { clusters } = buildDeterministicClusters({ nodes, edges, displayKeywords: display, ruleset: RS });
    expect(clusters[0].serviceId).toBe('s1'); // s1 appears twice
    expect(clusters[0].serviceAreaId).toBe('a1'); // a1 twice
  });

  it('picks majority intent', () => {
    const { clusters } = buildDeterministicClusters({ nodes, edges, displayKeywords: display, ruleset: RS });
    expect(clusters[0].intent).toBe('commercial'); // 2 commercial vs 1 informational
  });

  it('falls back to normalizedKeyword label when display map lacks the primary', () => {
    const { clusters } = buildDeterministicClusters({ nodes, edges, displayKeywords: empty, ruleset: RS });
    expect(clusters[0].label).toBe('beta');
  });
});

describe('cohesion null-safety', () => {
  it('returns null semanticCohesion when fewer than 2 members have vectors', () => {
    const nodes = [kw({ keywordId: 'k1', vector: [1, 0] }), kw({ keywordId: 'k2' })];
    const { clusters } = buildDeterministicClusters({ nodes, edges: [edge('k1', 'k2', 0.7)], displayKeywords: empty, ruleset: RS });
    expect(clusters[0].semanticCohesion).toBeNull();
  });

  it('computes semanticCohesion mean when vectors exist', () => {
    const nodes = [
      kw({ keywordId: 'k1', vector: [1, 0] }),
      kw({ keywordId: 'k2', vector: [0, 1] }), // cosine 0
    ];
    const { clusters } = buildDeterministicClusters({ nodes, edges: [edge('k1', 'k2', 0.7)], displayKeywords: empty, ruleset: RS });
    expect(clusters[0].semanticCohesion).toBe(0);
  });

  it('returns null serpOverlapCohesion when no pair has URLs', () => {
    const nodes = [kw({ keywordId: 'k1', serpUrls: new Set(['u']) }), kw({ keywordId: 'k2' })];
    const { clusters } = buildDeterministicClusters({ nodes, edges: [edge('k1', 'k2', 0.7)], displayKeywords: empty, ruleset: RS });
    expect(clusters[0].serpOverlapCohesion).toBeNull();
  });

  it('computes serpOverlapCohesion when pairs share URLs', () => {
    const nodes = [
      kw({ keywordId: 'k1', serpUrls: new Set(['a', 'b', 'c']) }),
      kw({ keywordId: 'k2', serpUrls: new Set(['b', 'c', 'd']) }), // jaccard 0.5
    ];
    const { clusters } = buildDeterministicClusters({ nodes, edges: [edge('k1', 'k2', 0.7)], displayKeywords: empty, ruleset: RS });
    expect(clusters[0].serpOverlapCohesion).toBe(0.5);
  });
});

describe('oversize recut', () => {
  it('splits an oversized component at a raised local threshold', () => {
    const rs = { ...RS, clusters: { ...RS.clusters, maxClusterSize: 3 } } as unknown as ClusterRuleset;
    const nodes = ['n1', 'n2', 'n3', 'n4'].map((id) => kw({ keywordId: id }));
    // Chain: n1-n2 (0.9), n2-n3 (0.63), n3-n4 (0.9). At threshold+0.02=0.64 the
    // weak middle edge (0.63) drops, splitting {n1,n2} | {n3,n4}.
    const edges = [edge('n1', 'n2', 0.9), edge('n2', 'n3', 0.63), edge('n3', 'n4', 0.9)];
    const { clusters, stats } = buildDeterministicClusters({ nodes, edges, displayKeywords: empty, ruleset: rs });
    expect(stats.oversizedSplit).toBe(1);
    expect(clusters.map((c) => c.memberIds)).toEqual([['n1', 'n2'], ['n3', 'n4']]);
    expect(clusters.every((c) => c.warnings.length === 0)).toBe(true);
  });

  it('warns weak_serp_distinction when recut is exhausted', () => {
    const rs = {
      ...RS,
      clusters: { ...RS.clusters, maxClusterSize: 2, oversizeRecutMaxSteps: 2 },
    } as unknown as ClusterRuleset;
    const nodes = ['n1', 'n2', 'n3'].map((id) => kw({ keywordId: id }));
    // Triangle of strong edges that never split under any raised threshold.
    const edges = [edge('n1', 'n2', 0.99), edge('n2', 'n3', 0.99), edge('n1', 'n3', 0.99)];
    const { clusters } = buildDeterministicClusters({ nodes, edges, displayKeywords: empty, ruleset: rs });
    expect(clusters.length).toBe(1);
    expect(clusters[0].memberIds).toEqual(['n1', 'n2', 'n3']);
    expect(clusters[0].warnings).toEqual(['weak_serp_distinction']);
  });
});
