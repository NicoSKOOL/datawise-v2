import { describe, it, expect } from 'vitest';
import { assertEmbeddingSetCompatible, validateVectors } from './embeddings';
import type { KeywordVector } from './embeddings';

function vec(keywordId: string, values: number[]): KeywordVector {
  return { keywordId, normalizedKeyword: keywordId, contentHash: `hash-${keywordId}`, vector: values };
}

describe('assertEmbeddingSetCompatible', () => {
  const meta = { model: '@cf/baai/bge-m3', dimensions: 4 };

  it('does not throw when every batch matches the reference meta', () => {
    expect(() =>
      assertEmbeddingSetCompatible(meta, [
        { model: '@cf/baai/bge-m3', dimensions: 4 },
        { model: '@cf/baai/bge-m3', dimensions: 4 },
      ])
    ).not.toThrow();
  });

  it('throws on a mixed model', () => {
    expect(() =>
      assertEmbeddingSetCompatible(meta, [
        { model: '@cf/baai/bge-m3', dimensions: 4 },
        { model: '@cf/some-other-model', dimensions: 4 },
      ])
    ).toThrow(/mixed embedding models/);
  });

  it('throws on mixed dimensions', () => {
    expect(() =>
      assertEmbeddingSetCompatible(meta, [
        { model: '@cf/baai/bge-m3', dimensions: 4 },
        { model: '@cf/baai/bge-m3', dimensions: 8 },
      ])
    ).toThrow(/mixed embedding dimensions/);
  });
});

describe('validateVectors', () => {
  it('returns the shared dimension count for a well-formed batch', () => {
    const result = validateVectors([vec('k1', [0.1, 0.2, 0.3]), vec('k2', [0.4, 0.5, 0.6])]);
    expect(result.dimensions).toBe(3);
  });

  it('throws on an empty vector set', () => {
    expect(() => validateVectors([])).toThrow(/empty vector set/);
  });

  it('throws on NaN/non-finite components', () => {
    expect(() => validateVectors([vec('k1', [0.1, Number.NaN, 0.3])])).toThrow(/non-finite/);
    expect(() => validateVectors([vec('k1', [0.1, Number.POSITIVE_INFINITY, 0.3])])).toThrow(/non-finite/);
  });

  it('throws on ragged vectors (mismatched lengths within one batch)', () => {
    expect(() => validateVectors([vec('k1', [0.1, 0.2, 0.3]), vec('k2', [0.1, 0.2])])).toThrow(/ragged/);
  });

  it('throws on duplicate keywordIds', () => {
    expect(() => validateVectors([vec('k1', [0.1, 0.2]), vec('k1', [0.3, 0.4])])).toThrow(/duplicate keywordId/);
  });
});
