import { describe, it, expect } from 'vitest';
import { buildKeywordSimilarityGraph } from './graph';
import { buildDeterministicClusters } from './clusters';
import type { KeywordNode } from './graph';
import { CLUSTER_RULESET_V2 } from './ruleset';
import { canonicalize } from '../hash';
import type { SearchIntent } from '../../contracts/enums';

// Tiny local LCG for deterministic pseudo-randomness in tests only (allowed;
// the engine itself never uses Math.random). Numerical Recipes constants.
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const VOCAB = ['drain', 'clean', 'repair', 'install', 'leak', 'pipe', 'water', 'heater', 'sewer', 'faucet'];
const INTENTS: (SearchIntent | null)[] = ['transactional', 'commercial', 'informational', 'navigational', 'unknown', null];
const SERVICES = ['s1', 's2', 's3', 's4'];
const AREAS = ['a1', 'a2', 'a3'];

function buildFixture(): KeywordNode[] {
  const rand = lcg(12345);
  const nodes: KeywordNode[] = [];
  for (let i = 0; i < 60; i++) {
    const id = `kw${String(i).padStart(2, '0')}`;
    const dim = 8;
    const vector: number[] = [];
    for (let d = 0; d < dim; d++) vector.push(rand() * 2 - 1);
    const t1 = VOCAB[Math.floor(rand() * VOCAB.length)];
    const t2 = VOCAB[Math.floor(rand() * VOCAB.length)];
    const hasSerp = rand() > 0.3;
    const serpUrls = hasSerp
      ? new Set([`u${Math.floor(rand() * 20)}`, `u${Math.floor(rand() * 20)}`, `u${Math.floor(rand() * 20)}`])
      : null;
    nodes.push({
      keywordId: id,
      normalizedKeyword: `${t1} ${t2} ${i}`,
      isBranded: rand() > 0.85,
      intent: INTENTS[Math.floor(rand() * INTENTS.length)],
      serviceIds: rand() > 0.4 ? [SERVICES[Math.floor(rand() * SERVICES.length)]] : [],
      serviceAreaIds: rand() > 0.4 ? [AREAS[Math.floor(rand() * AREAS.length)]] : [],
      tokens: [t1, t2],
      coreKeyword: rand() > 0.5 ? t1 : null,
      vector,
      serpUrls,
      relevance: rand() > 0.2 ? rand() : null,
      volume: rand() > 0.2 ? Math.floor(rand() * 5000) : null,
    });
  }
  return nodes;
}

function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const rand = lcg(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function run(nodes: readonly KeywordNode[]) {
  const displayKeywords = new Map(nodes.map((n) => [n.keywordId, n.normalizedKeyword.toUpperCase()]));
  const graph = buildKeywordSimilarityGraph({ nodes, ruleset: CLUSTER_RULESET_V2 });
  const clusters = buildDeterministicClusters({
    nodes,
    edges: graph.edges,
    displayKeywords,
    ruleset: CLUSTER_RULESET_V2,
  });
  return { graph, clusters };
}

describe('determinism suite', () => {
  const fixture = buildFixture();

  it('produces the same graph and clusters regardless of input order', () => {
    const a = run(seededShuffle(fixture, 111));
    const b = run(seededShuffle(fixture, 999));
    expect(canonicalize(a.graph)).toBe(canonicalize(b.graph));
    expect(canonicalize(a.clusters)).toBe(canonicalize(b.clusters));
  });

  it('actually exercises the pipeline (non-trivial graph and clusters)', () => {
    const { graph, clusters } = run(fixture);
    expect(graph.stats.candidatePairs).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(clusters.clusters.length).toBeGreaterThan(0);
    // every node accounted for exactly once across clusters
    const seen = clusters.clusters.flatMap((c) => c.memberIds);
    expect(new Set(seen).size).toBe(60);
    expect(seen.length).toBe(60);
  });

  it('canonicalization is stable across repeated identical runs', () => {
    expect(canonicalize(run(fixture).clusters)).toBe(canonicalize(run(fixture).clusters));
  });
});
