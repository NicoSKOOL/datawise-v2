import { describe, it, expect } from 'vitest';
import { refineClusters } from './refine';
import type { RefineClusterInput, LiveSerpEvidence } from './refine';
import type { KeywordNode } from './graph';
import { CLUSTER_RULESET_V2 } from './ruleset';
import { canonicalize } from '../hash';
import type { SearchIntent } from '../../contracts/enums';

// Pure-engine tests for refine_clusters. The engine takes caller-supplied
// nodes/clusters/live-SERP evidence and never touches IO, so these fixtures are
// hand-built graph nodes with exact vectors (cosine 1 for identical, 0 for
// orthogonal), which keeps every merge/split decision deterministic.

function node(partial: Partial<KeywordNode> & { keywordId: string; normalizedKeyword: string }): KeywordNode {
  return {
    tokens: partial.normalizedKeyword.split(' '),
    coreKeyword: null,
    vector: null,
    serpUrls: null,
    relevance: null,
    volume: null,
    isBranded: false,
    intent: null,
    serviceIds: [],
    serviceAreaIds: [],
    ...partial,
  };
}

function cluster(
  clusterId: string,
  memberIds: string[],
  primaryKeywordId: string,
  intent: SearchIntent | null = null
): RefineClusterInput {
  return { clusterId, memberIds, primaryKeywordId, intent };
}

function live(organicUrls: string[], relatedSearches: string[] = [], paaQuestions: string[] = []): LiveSerpEvidence {
  return { organicUrls, relatedSearches, paaQuestions };
}

function displayMap(nodes: KeywordNode[]): Map<string, string> {
  return new Map(nodes.map((n) => [n.keywordId, n.normalizedKeyword]));
}

describe('refineClusters', () => {
  it('auto-merges two clusters with live evidence, a clean boundary, and score >= edgeThreshold', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'], serviceAreaIds: ['a1'], relevance: 0.9, volume: 500 }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain cleaning services austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'], serviceAreaIds: ['a1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const liveByQuery = new Map<string, LiveSerpEvidence>([
      ['drain cleaning austin', live(['u1', 'u2'])],
      ['drain cleaning services austin', live(['u1', 'u2'])],
    ]);

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.autoMerges).toBe(1);
    expect(result.stats.liveSnapshotCoverage).toBe(2);
    expect(result.clusters).toHaveLength(1);
    const merged = result.clusters[0];
    expect(merged.changed).toBe(true);
    expect(merged.preservedClusterId).toBeNull();
    expect(merged.origin).toBe('merge');
    expect(merged.draft.memberIds).toEqual(['kwA', 'kwB']);
    expect(result.adjudications).toHaveLength(0);
  });

  it('emits a pending merge adjudication for an ambiguous-band boundary (with live evidence)', () => {
    // kwB has no vector, so the semantic component drops out and the score comes
    // from serpOverlap (0.6) + intent (0.5): (0.35*0.6 + 0.10*0.5)/0.45 = 0.577,
    // inside the ambiguous band [0.52, 0.62).
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0], intent: 'commercial', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'water heater repair austin', vector: null, intent: 'transactional', serviceIds: ['s1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'commercial'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const liveByQuery = new Map<string, LiveSerpEvidence>([
      ['drain cleaning austin', live(['u1', 'u2', 'u3'])],
      ['water heater repair austin', live(['u1', 'u2', 'u3', 'u4', 'u5'])],
    ]);

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.autoMerges).toBe(0);
    expect(result.clusters).toHaveLength(2);
    expect(result.adjudications).toHaveLength(1);
    const adj = result.adjudications[0];
    expect(adj.caseType).toBe('merge');
    expect(adj.decision).toBe('pending');
    expect(adj.scoreContext.reason).toBe('ambiguous_band');
    expect(adj.clusterIds).toEqual(['c_a', 'c_b']);
    expect(adj.scoreContext.score).toBeGreaterThanOrEqual(0.52);
    expect(adj.scoreContext.score).toBeLessThan(0.62);
    expect(result.stats.adjudicationsPending).toBe(1);
  });

  it('emits an insufficient_evidence merge adjudication when there is no live SERP evidence', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain cleaning services austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    // No entries -> no cluster has a live snapshot.
    const liveByQuery = new Map<string, LiveSerpEvidence>();

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.autoMerges).toBe(0);
    expect(result.stats.liveSnapshotCoverage).toBe(0);
    expect(result.clusters).toHaveLength(2);
    expect(result.adjudications).toHaveLength(1);
    expect(result.adjudications[0].caseType).toBe('merge');
    expect(result.adjudications[0].decision).toBe('insufficient_evidence');
    expect(result.adjudications[0].scoreContext.reason).toBe('no_live_evidence');
    expect(result.stats.adjudicationsInsufficient).toBe(1);
  });

  it('does not auto-merge on empty SERP snapshots (null overlap); routes to a pending adjudication', () => {
    // Both clusters have a live snapshot, but each snapshot is empty (no organic
    // URLs, no related searches, no PAA) -- e.g. an anti-bot/empty SERP. The live
    // overlap is unmeasurable (null), so even with cosine 1 + intent 1 the pair
    // must NOT auto-merge on the embedding signal alone; it becomes a pending
    // merge adjudication tagged no_measurable_serp_overlap.
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain cleaning services austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const liveByQuery = new Map<string, LiveSerpEvidence>([
      ['drain cleaning austin', live([], [], [])],
      ['drain cleaning services austin', live([], [], [])],
    ]);

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.autoMerges).toBe(0);
    expect(result.stats.liveSnapshotCoverage).toBe(2); // both snapshots exist, just empty
    expect(result.clusters).toHaveLength(2);
    expect(result.adjudications).toHaveLength(1);
    const adj = result.adjudications[0];
    expect(adj.caseType).toBe('merge');
    expect(adj.decision).toBe('pending');
    expect(adj.scoreContext.reason).toBe('no_measurable_serp_overlap');
    expect(adj.scoreContext.serpOverlap).toBeNull();
  });

  it('never merges across a hard constraint even at a high score, and emits no adjudication for it', () => {
    // kwA is branded-navigational, kwB is generic non-branded: a hard
    // branded_navigational_x_generic block. Identical vectors + full organic
    // overlap would otherwise score ~1.
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'bluedog plumbing austin', tokens: ['bluedog', 'plumbing', 'austin'], vector: [1, 0, 0, 0], intent: 'navigational', isBranded: true }),
      node({ keywordId: 'kwB', normalizedKeyword: 'affordable plumbing austin', tokens: ['affordable', 'plumbing', 'austin'], vector: [1, 0, 0, 0], intent: 'transactional', isBranded: false }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'navigational'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const liveByQuery = new Map<string, LiveSerpEvidence>([
      ['bluedog plumbing austin', live(['u1', 'u2'])],
      ['affordable plumbing austin', live(['u1', 'u2'])],
    ]);

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.autoMerges).toBe(0);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.every((c) => !c.changed)).toBe(true);
    expect(result.adjudications).toHaveLength(0);
  });

  it('emits an intent_exception adjudication when only an incompatible intent blocks a similar pair', () => {
    // Transactional vs informational: incompatible_intent (not a hard block).
    // High similarity, so the intent conflict is the deciding factor.
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'emergency plumber austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'how plumbing works austin', vector: [1, 0, 0, 0], intent: 'informational', serviceIds: ['s1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'informational'),
    ];
    const liveByQuery = new Map<string, LiveSerpEvidence>([
      ['emergency plumber austin', live(['u1', 'u2'])],
      ['how plumbing works austin', live(['u1', 'u2'])],
    ]);

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.autoMerges).toBe(0);
    expect(result.adjudications).toHaveLength(1);
    expect(result.adjudications[0].caseType).toBe('intent_exception');
    expect(result.adjudications[0].decision).toBe('pending');
    expect(result.adjudications[0].scoreContext.violations).toContain('incompatible_intent');
  });

  // SYNTHETIC cut-mechanism test: exercises the auto-split 2-cut code with a
  // cluster whose members form two disconnected vector groups. This is NOT a
  // reachable production state: stage 10 could never emit two disconnected
  // groups as a single cluster (clusters are connected components), and Phase 4
  // has no per-member live SERPs to live-adjust the intra-cluster edges, so
  // auto-split is inert on real input (see the inertness note in refine.ts).
  // This test only proves the deterministic cut mechanism itself is correct.
  it('cut mechanism (synthetic input): splits a cluster whose members form two disconnected groups', () => {
    const nodes = [
      node({ keywordId: 'm1', normalizedKeyword: 'drain repair austin', vector: [1, 0, 0, 0], relevance: 0.9 }),
      node({ keywordId: 'm2', normalizedKeyword: 'drain repair services austin', vector: [1, 0, 0, 0] }),
      node({ keywordId: 'm3', normalizedKeyword: 'water heater install austin', vector: [0, 1, 0, 0] }),
      node({ keywordId: 'm4', normalizedKeyword: 'water heater install cost austin', vector: [0, 1, 0, 0] }),
    ];
    const clusters = [cluster('c_low', ['m1', 'm2', 'm3', 'm4'], 'm1')];
    const liveByQuery = new Map<string, LiveSerpEvidence>([['drain repair austin', live(['u1', 'u2'])]]);

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.autoSplits).toBe(1);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.every((c) => c.changed && c.origin === 'split')).toBe(true);
    const memberSets = result.clusters.map((c) => c.draft.memberIds.join(',')).sort();
    expect(memberSets).toEqual(['m1,m2', 'm3,m4']);
    expect(result.adjudications).toHaveLength(0);
  });

  it('emits a split adjudication for a low-cohesion cluster with no clean 2-cut', () => {
    // m2 bridges m1 and m3 (both edges >= 0.62), so the intra-cluster graph is
    // one connected component: no clean 2-cut, but mean cohesion (0.65+0.65+0)/3
    // = 0.433 < 0.45, so it is a split candidate.
    const nodes = [
      node({ keywordId: 'm1', normalizedKeyword: 'plumbing austin one', vector: [1, 0, 0] }),
      node({ keywordId: 'm2', normalizedKeyword: 'plumbing austin two', vector: [0.65, 0.65, 0.3937] }),
      node({ keywordId: 'm3', normalizedKeyword: 'plumbing austin three', vector: [0, 1, 0] }),
    ];
    const clusters = [cluster('c_low', ['m1', 'm2', 'm3'], 'm1')];
    const liveByQuery = new Map<string, LiveSerpEvidence>([['plumbing austin one', live(['u1'])]]);

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.autoSplits).toBe(0);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].changed).toBe(false);
    expect(result.clusters[0].preservedClusterId).toBe('c_low');
    expect(result.adjudications).toHaveLength(1);
    expect(result.adjudications[0].caseType).toBe('split');
    expect(result.adjudications[0].decision).toBe('pending');
    expect(result.adjudications[0].scoreContext.reason).toBe('low_cohesion_no_clean_cut');
  });

  it('preserves the id and marks unchanged a cluster untouched by refinement', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0], intent: 'transactional' }),
      node({ keywordId: 'kwZ', normalizedKeyword: 'sewer inspection dallas', vector: [0, 0, 0, 1], intent: 'transactional' }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_z', ['kwZ'], 'kwZ', 'transactional'),
    ];
    const liveByQuery = new Map<string, LiveSerpEvidence>([['drain cleaning austin', live(['u1'])]]);

    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    expect(result.clusters).toHaveLength(2);
    for (const c of result.clusters) {
      expect(c.changed).toBe(false);
      expect(c.preservedClusterId).not.toBeNull();
      expect(c.liveBreakdown).toBeNull();
    }
    expect(result.clusters.map((c) => c.preservedClusterId).sort()).toEqual(['c_a', 'c_z']);
  });

  it('is deterministic: identical output regardless of input cluster order (double-run hash)', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain cleaning services austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwC', normalizedKeyword: 'plumber reviews austin', vector: [0, 1, 0, 0], intent: 'informational', serviceIds: ['s1'] }),
      node({ keywordId: 'kwD', normalizedKeyword: 'water heater install dallas', vector: [0, 0, 1, 0], intent: 'transactional', serviceIds: ['s2'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
      cluster('c_c', ['kwC'], 'kwC', 'informational'),
      cluster('c_d', ['kwD'], 'kwD', 'transactional'),
    ];
    const liveByQuery = new Map<string, LiveSerpEvidence>([
      ['drain cleaning austin', live(['u1', 'u2'], ['plumbing help'])],
      ['drain cleaning services austin', live(['u1', 'u2'], ['plumbing help'])],
      ['plumber reviews austin', live(['u9'])],
      ['water heater install dallas', live(['u7'])],
    ]);
    const displayKeywords = displayMap(nodes);

    const run = (cs: RefineClusterInput[]) =>
      refineClusters({ clusters: cs, nodes, displayKeywords, liveByQuery, ruleset: CLUSTER_RULESET_V2 });

    const forward = run(clusters);
    const reversed = run([...clusters].reverse());
    expect(canonicalize(forward)).toBe(canonicalize(reversed));
    // And stable across two identical runs.
    expect(canonicalize(run(clusters))).toBe(canonicalize(run(clusters)));
    // Non-trivial: c_a and c_b auto-merge (identical vectors, full overlap).
    expect(forward.stats.autoMerges).toBe(1);
  });
});

describe('name-based auto-merge (cluster-v3)', () => {
  it('merges two clusters cleaning to the same page name with NO live SERP evidence', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain cleaning near me', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    // No live snapshots: the merge is driven purely by the cleaned name.
    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery: new Map(), ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.nameMerges).toBe(1);
    expect(result.stats.autoMerges).toBe(0);
    expect(result.stats.liveSnapshotCoverage).toBe(0);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].changed).toBe(true);
    expect(result.clusters[0].origin).toBe('merge');
    expect(result.clusters[0].draft.memberIds).toEqual(['kwA', 'kwB']);
    // No contradictory adjudication for a pair merged by name.
    expect(result.adjudications).toHaveLength(0);
  });

  it('near-name merges two clusters differing only by a trailing "services" suffix', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'emergency plumbing', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'emergency plumbing services', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery: new Map(), ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.nameMerges).toBe(1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].draft.memberIds).toEqual(['kwA', 'kwB']);
    expect(result.adjudications).toHaveLength(0);
  });

  it('does NOT name-merge two clusters with identical cleaned names but different services', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain cleaning', tokens: ['drain', 'cleaning'], vector: [0, 1, 0, 0], intent: 'transactional', serviceIds: ['s2'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery: new Map(), ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.nameMerges).toBe(0);
    expect(result.stats.autoMerges).toBe(0);
    expect(result.clusters).toHaveLength(2);
  });

  it('never name-merges branded-navigational into generic even with identical cleaned names', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'bluedog plumbing', tokens: ['bluedog', 'plumbing'], vector: [1, 0, 0, 0], intent: 'navigational', isBranded: true }),
      node({ keywordId: 'kwB', normalizedKeyword: 'bluedog plumbing', tokens: ['bluedog', 'plumbing'], vector: [1, 0, 0, 0], intent: 'transactional', isBranded: false }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'navigational'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery: new Map(), ruleset: CLUSTER_RULESET_V2 });

    expect(result.stats.nameMerges).toBe(0);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters.every((c) => !c.changed)).toBe(true);
  });

  it('is deterministic: identical output regardless of input order (double-run hash) with a name merge', () => {
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain cleaning near me', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwC', normalizedKeyword: 'water heater install dallas', vector: [0, 0, 1, 0], intent: 'transactional', serviceIds: ['s2'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
      cluster('c_c', ['kwC'], 'kwC', 'transactional'),
    ];
    const run = (cs: RefineClusterInput[]) =>
      refineClusters({ clusters: cs, nodes, displayKeywords: displayMap(nodes), liveByQuery: new Map(), ruleset: CLUSTER_RULESET_V2 });

    const forward = run(clusters);
    const reversed = run([...clusters].reverse());
    expect(canonicalize(forward)).toBe(canonicalize(reversed));
    expect(canonicalize(run(clusters))).toBe(canonicalize(run(clusters)));
    expect(forward.stats.nameMerges).toBe(1);
  });
});

describe('semantic-only adjudication floor (cluster-v2)', () => {
  it('emits NO adjudication for an unevidenced pair below the adjudication floor', () => {
    // cosine([1,0,0,0],[0.6,0.8,0,0]) = 0.6, below
    // semanticOnlyAdjudicationFloor (0.75). Same intent, no live evidence, no
    // SERP urls: cluster-v1 wrote this as an insufficient_evidence row;
    // cluster-v2 treats it as an unevidenced non-relationship and stays quiet.
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain repair austin', vector: [0.6, 0.8, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery: new Map(), ruleset: CLUSTER_RULESET_V2 });

    expect(result.adjudications).toHaveLength(0);
    expect(result.clusters).toHaveLength(2);
  });

  it('still emits insufficient_evidence for an unevidenced pair at within-service cosine (>= floor)', () => {
    // cosine([1,0,0,0],[0.8,0.6,0,0]) = 0.8, above the 0.75 floor but below
    // the 0.85 merge floor: worth a future adjudicator, not a merge.
    const nodes = [
      node({ keywordId: 'kwA', normalizedKeyword: 'drain cleaning austin', vector: [1, 0, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
      node({ keywordId: 'kwB', normalizedKeyword: 'drain unclogging austin', vector: [0.8, 0.6, 0, 0], intent: 'transactional', serviceIds: ['s1'] }),
    ];
    const clusters = [
      cluster('c_a', ['kwA'], 'kwA', 'transactional'),
      cluster('c_b', ['kwB'], 'kwB', 'transactional'),
    ];
    const result = refineClusters({ clusters, nodes, displayKeywords: displayMap(nodes), liveByQuery: new Map(), ruleset: CLUSTER_RULESET_V2 });

    expect(result.adjudications).toHaveLength(1);
    expect(result.adjudications[0].caseType).toBe('merge');
    expect(result.adjudications[0].decision).toBe('insufficient_evidence');
    expect(result.adjudications[0].scoreContext.reason).toBe('no_live_evidence');
  });
});
