import { describe, it, expect } from 'vitest';
import { cosineSimilarity, jaccardSerpOverlap, intentCompatibility } from './similarity';
import type { SearchIntent } from '../../contracts/enums';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 12);
  });

  it('returns 1 for parallel vectors of different magnitude', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 12);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 12);
  });

  it('returns null for a zero-norm vector', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBeNull();
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBeNull();
  });

  it('returns null for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBeNull();
  });

  it('returns null for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBeNull();
  });

  it('never returns NaN', () => {
    const r = cosineSimilarity([1e-300, 0], [0, 1e-300]);
    expect(r === null || !Number.isNaN(r)).toBe(true);
  });

  it('clamps to [-1, 1] against float overshoot', () => {
    const r = cosineSimilarity([0.1, 0.1, 0.1], [0.1, 0.1, 0.1]);
    expect(r).not.toBeNull();
    expect(r as number).toBeLessThanOrEqual(1);
    expect(r as number).toBeGreaterThanOrEqual(-1);
  });
});

describe('jaccardSerpOverlap', () => {
  it('returns null when either side is null', () => {
    expect(jaccardSerpOverlap(null, ['a'])).toBeNull();
    expect(jaccardSerpOverlap(['a'], null)).toBeNull();
    expect(jaccardSerpOverlap(null, null)).toBeNull();
  });

  it('returns null when either side is empty', () => {
    expect(jaccardSerpOverlap([], ['a'])).toBeNull();
    expect(jaccardSerpOverlap(['a'], [])).toBeNull();
    expect(jaccardSerpOverlap(new Set<string>(), new Set(['a']))).toBeNull();
  });

  it('computes intersection over union', () => {
    // {a,b,c} vs {b,c,d}: intersection {b,c}=2, union {a,b,c,d}=4 -> 0.5
    expect(jaccardSerpOverlap(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(0.5, 12);
  });

  it('returns 1 for identical sets', () => {
    expect(jaccardSerpOverlap(['a', 'b'], ['b', 'a'])).toBeCloseTo(1, 12);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSerpOverlap(['a', 'b'], ['c', 'd'])).toBeCloseTo(0, 12);
  });

  it('dedupes array inputs', () => {
    // {a,a,b} -> {a,b} vs {b} : inter {b}=1 union {a,b}=2 -> 0.5
    expect(jaccardSerpOverlap(['a', 'a', 'b'], ['b'])).toBeCloseTo(0.5, 12);
  });

  it('accepts Set inputs', () => {
    expect(jaccardSerpOverlap(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBeCloseTo(0.5, 12);
  });
});

describe('intentCompatibility', () => {
  const intents: SearchIntent[] = ['transactional', 'commercial', 'informational', 'navigational', 'unknown'];

  it('returns 1 for identical known intents', () => {
    for (const i of intents) {
      if (i === 'unknown') continue;
      expect(intentCompatibility(i, i)).toBe(1);
    }
  });

  it('returns null when both sides are unknown/null', () => {
    expect(intentCompatibility('unknown', 'unknown')).toBeNull();
    expect(intentCompatibility(null, null)).toBeNull();
    expect(intentCompatibility('unknown', null)).toBeNull();
    expect(intentCompatibility(null, 'unknown')).toBeNull();
  });

  it('returns 0.5 when exactly one side is unknown/null', () => {
    expect(intentCompatibility('unknown', 'transactional')).toBe(0.5);
    expect(intentCompatibility('commercial', 'unknown')).toBe(0.5);
    expect(intentCompatibility(null, 'informational')).toBe(0.5);
    expect(intentCompatibility('navigational', null)).toBe(0.5);
  });

  it('returns 0.5 for commercial<->transactional', () => {
    expect(intentCompatibility('commercial', 'transactional')).toBe(0.5);
    expect(intentCompatibility('transactional', 'commercial')).toBe(0.5);
  });

  it('returns 0 for other known mismatches', () => {
    expect(intentCompatibility('transactional', 'informational')).toBe(0);
    expect(intentCompatibility('commercial', 'informational')).toBe(0);
    expect(intentCompatibility('transactional', 'navigational')).toBe(0);
    expect(intentCompatibility('commercial', 'navigational')).toBe(0);
    expect(intentCompatibility('informational', 'navigational')).toBe(0);
    expect(intentCompatibility('navigational', 'informational')).toBe(0);
  });

  it('is symmetric across the full matrix', () => {
    const all: (SearchIntent | null)[] = [...intents, null];
    for (const a of all) {
      for (const b of all) {
        expect(intentCompatibility(a, b)).toBe(intentCompatibility(b, a));
      }
    }
  });
});
