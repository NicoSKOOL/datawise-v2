import { describe, it, expect } from 'vitest';
import { buildKeywordSimilarityGraph } from './graph';
import type { KeywordNode } from './graph';
import { CLUSTER_RULESET_V1 } from './ruleset';
import type { ClusterRuleset } from './ruleset';

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

const RS = CLUSTER_RULESET_V1;

describe('blocking / candidate generation', () => {
  it('pairs nodes that share a token', () => {
    const nodes = [
      kw({ keywordId: 'k1', tokens: ['drain'], intent: 'commercial' }),
      kw({ keywordId: 'k2', tokens: ['drain'], intent: 'commercial' }),
    ];
    const { edges, stats } = buildKeywordSimilarityGraph({ nodes, ruleset: RS });
    expect(stats.candidatePairs).toBe(1);
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ a: 'k1', b: 'k2' });
  });

  it('does not pair nodes that share nothing', () => {
    const nodes = [
      kw({ keywordId: 'k1', tokens: ['drain'], intent: 'commercial' }),
      kw({ keywordId: 'k2', tokens: ['roof'], intent: 'commercial' }),
    ];
    const { edges, stats } = buildKeywordSimilarityGraph({ nodes, ruleset: RS });
    expect(stats.candidatePairs).toBe(0);
    expect(edges.length).toBe(0);
  });

  it('pairs via shared coreKeyword, serviceId or serviceAreaId', () => {
    const core = [kw({ keywordId: 'a', coreKeyword: 'x' }), kw({ keywordId: 'b', coreKeyword: 'x' })];
    expect(buildKeywordSimilarityGraph({ nodes: core, ruleset: RS }).stats.candidatePairs).toBe(1);
    const svc = [kw({ keywordId: 'a', serviceIds: ['s1'] }), kw({ keywordId: 'b', serviceIds: ['s1'] })];
    expect(buildKeywordSimilarityGraph({ nodes: svc, ruleset: RS }).stats.candidatePairs).toBe(1);
    const area = [kw({ keywordId: 'a', serviceAreaIds: ['r1'] }), kw({ keywordId: 'b', serviceAreaIds: ['r1'] })];
    expect(buildKeywordSimilarityGraph({ nodes: area, ruleset: RS }).stats.candidatePairs).toBe(1);
  });

  it('dedupes a pair reachable through multiple dimensions', () => {
    const nodes = [
      kw({ keywordId: 'a', tokens: ['t'], serviceIds: ['s1'], coreKeyword: 'c' }),
      kw({ keywordId: 'b', tokens: ['t'], serviceIds: ['s1'], coreKeyword: 'c' }),
    ];
    expect(buildKeywordSimilarityGraph({ nodes, ruleset: RS }).stats.candidatePairs).toBe(1);
  });
});

describe('edge scoring / renormalization', () => {
  it('renormalizes weights over present components (semantic 0.8 + intent 1.0, no serp)', () => {
    // a=[1,0], b=[0.8,0.6] -> cosine 0.8. Same known intent -> intent 1.0. No SERP.
    const nodes = [
      kw({ keywordId: 'k1', tokens: ['t'], intent: 'commercial', vector: [1, 0] }),
      kw({ keywordId: 'k2', tokens: ['t'], intent: 'commercial', vector: [0.8, 0.6] }),
    ];
    const { edges } = buildKeywordSimilarityGraph({ nodes, ruleset: RS });
    expect(edges.length).toBe(1);
    const e = edges[0];
    expect(e.components.semantic).toBeCloseTo(0.8, 12);
    expect(e.components.serpJaccard).toBeNull();
    expect(e.components.intent).toBe(1);
    // 0.55/0.65 and 0.10/0.65
    expect(e.weightsUsed.semantic).toBeCloseTo(0.846154, 6);
    expect(e.weightsUsed.intent).toBeCloseTo(0.153846, 6);
    expect(e.weightsUsed.serpOverlap).toBe(0);
    // 0.8*0.8461538 + 1.0*0.1538462 = 0.830769
    expect(e.score).toBe(0.830769);
  });

  it('uses weight 1.0 for a lone semantic component', () => {
    // Both intents null/unknown -> intent null; no serp. Only semantic present.
    const nodes = [
      kw({ keywordId: 'k1', tokens: ['t'], vector: [1, 0], intent: null }),
      kw({ keywordId: 'k2', tokens: ['t'], vector: [0.6, 0.8], intent: null }),
    ];
    const { edges } = buildKeywordSimilarityGraph({ nodes, ruleset: RS });
    expect(edges.length).toBe(1);
    expect(edges[0].weightsUsed.semantic).toBe(1);
    expect(edges[0].score).toBe(0.6); // cosine([1,0],[0.6,0.8]) = 0.6
  });
});

describe('constraint flagging', () => {
  it('keeps a forbidden edge but flags it', () => {
    // transactional vs informational -> incompatible_intent. Share token to be a candidate.
    const nodes = [
      kw({ keywordId: 'k1', tokens: ['t'], intent: 'transactional', vector: [1, 0] }),
      kw({ keywordId: 'k2', tokens: ['t'], intent: 'informational', vector: [1, 0] }),
    ];
    const { edges, stats } = buildKeywordSimilarityGraph({ nodes, ruleset: RS });
    expect(edges.length).toBe(1);
    expect(edges[0].violations).toContain('incompatible_intent');
    expect(stats.forbiddenEdges).toBe(1);
  });

  it('returns a forbidden edge even when its score is below the band', () => {
    // Low semantic (orthogonal), incompatible intent -> score low but reported.
    const nodes = [
      kw({ keywordId: 'k1', tokens: ['t'], intent: 'transactional', vector: [1, 0] }),
      kw({ keywordId: 'k2', tokens: ['t'], intent: 'informational', vector: [0, 1] }),
    ];
    const { edges } = buildKeywordSimilarityGraph({ nodes, ruleset: RS });
    expect(edges.length).toBe(1);
    expect(edges[0].score).toBeLessThan(RS.clusters.ambiguousBand.low);
    expect(edges[0].violations).toContain('incompatible_intent');
  });
});

describe('output filtering', () => {
  it('includes ambiguous-band edges', () => {
    // Construct a clean edge whose score lands in [0.52, 0.62).
    // semantic 0.55 alone -> score 0.55.
    const nodes = [
      kw({ keywordId: 'k1', tokens: ['t'], vector: [1, 0], intent: null }),
      kw({ keywordId: 'k2', tokens: ['t'], vector: [0.55, Math.sqrt(1 - 0.55 * 0.55)], intent: null }),
    ];
    const { edges } = buildKeywordSimilarityGraph({ nodes, ruleset: RS });
    expect(edges.length).toBe(1);
    expect(edges[0].score).toBeGreaterThanOrEqual(RS.clusters.ambiguousBand.low);
    expect(edges[0].score).toBeLessThan(RS.clusters.ambiguousBand.high);
    expect(edges[0].violations).toEqual([]);
  });

  it('drops a clean edge below the ambiguous band', () => {
    // semantic 0.3 alone -> score 0.3 < 0.52, clean -> not returned.
    const nodes = [
      kw({ keywordId: 'k1', tokens: ['t'], vector: [1, 0], intent: null }),
      kw({ keywordId: 'k2', tokens: ['t'], vector: [0.3, Math.sqrt(1 - 0.09)], intent: null }),
    ];
    const { edges, stats } = buildKeywordSimilarityGraph({ nodes, ruleset: RS });
    expect(edges.length).toBe(0);
    expect(stats.scoredEdges).toBe(1); // scored but filtered out
  });
});

describe('cap after sort', () => {
  it('applies the candidate cap after lexicographic sort and counts the excess', () => {
    const nodes = [
      kw({ keywordId: 'a', tokens: ['t'], intent: 'commercial', vector: [1, 0] }),
      kw({ keywordId: 'b', tokens: ['t'], intent: 'commercial', vector: [1, 0] }),
      kw({ keywordId: 'c', tokens: ['t'], intent: 'commercial', vector: [1, 0] }),
    ];
    // 3 nodes in one bucket -> C(3,2)=3 pairs: a b, a c, b c. Cap at 2.
    const capped = { ...RS, blocking: { maxCandidatePairs: 2 } } as unknown as ClusterRuleset;
    const { edges, stats } = buildKeywordSimilarityGraph({ nodes, ruleset: capped });
    expect(stats.candidatePairs).toBe(3);
    expect(stats.blockedByCap).toBe(1);
    // Sorted pair keys: "a b", "a c", "b c" -> first two retained.
    const kept = edges.map((e) => `${e.a}${e.b}`).sort();
    expect(kept).toEqual(['ab', 'ac']);
  });
});

describe('determinism under input reordering', () => {
  it('produces identical output regardless of node order', () => {
    const base = [
      kw({ keywordId: 'k1', tokens: ['t'], intent: 'commercial', vector: [1, 0] }),
      kw({ keywordId: 'k2', tokens: ['t'], intent: 'commercial', vector: [0.8, 0.6] }),
      kw({ keywordId: 'k3', tokens: ['t'], intent: 'commercial', vector: [0.9, 0.436] }),
    ];
    const r1 = buildKeywordSimilarityGraph({ nodes: base, ruleset: RS });
    const r2 = buildKeywordSimilarityGraph({ nodes: [...base].reverse(), ruleset: RS });
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
