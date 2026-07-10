import { describe, it, expect } from 'vitest';
import { canonicalize, hashNormalizedInput, buildStageInputHash } from './hash';

describe('canonicalize', () => {
  it('is stable across object key order, recursively', () => {
    expect(canonicalize({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } }))
      .toBe(canonicalize({ a: { c: 3, d: [2, { y: 2, z: 1 }] }, b: 1 }));
  });
  it('preserves array order', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });
});

describe('hashNormalizedInput', () => {
  it('returns 64-char hex, equal for equivalent objects, different for different values', async () => {
    const a = await hashNormalizedInput({ x: 1, y: 'a' });
    const b = await hashNormalizedInput({ y: 'a', x: 1 });
    const c = await hashNormalizedInput({ x: 2, y: 'a' });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('buildStageInputHash', () => {
  it('changes when any component changes', async () => {
    const base = { runId: 'r1', stage: 'validate_intake' as const, normalizedInputHash: 'h1' };
    const h1 = await buildStageInputHash(base);
    const h2 = await buildStageInputHash({ ...base, normalizedInputHash: 'h2' });
    const h3 = await buildStageInputHash({ ...base, promptVersion: 'p1' });
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

describe('canonicalize guards', () => {
  it('rejects non-plain objects and non-finite numbers', () => {
    expect(() => canonicalize(new Date())).toThrow(TypeError);
    expect(() => canonicalize(new Map())).toThrow(TypeError);
    expect(() => canonicalize({ a: NaN })).toThrow(TypeError);
    expect(() => canonicalize({ a: Infinity })).toThrow(TypeError);
    expect(canonicalize({ a: null, b: [1, 'x', true] })).toBe('{"a":null,"b":[1,"x",true]}');
  });
});
