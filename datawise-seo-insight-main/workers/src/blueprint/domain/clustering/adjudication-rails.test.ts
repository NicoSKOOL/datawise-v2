import { describe, it, expect } from 'vitest';
import { mergeAcceptPassesRails, geoExclusionPassesRails } from './adjudication-rails';
import type { ConstraintNode } from './constraints';

function node(overrides: Partial<ConstraintNode>): ConstraintNode {
  return {
    isBranded: false,
    intent: 'commercial',
    serviceIds: [],
    serviceAreaIds: [],
    ...overrides,
  };
}

describe('mergeAcceptPassesRails', () => {
  it('passes a clean union with no hard-constraint violations', () => {
    const union = [node({ serviceIds: ['svc1'] }), node({ serviceIds: ['svc1'] })];
    expect(mergeAcceptPassesRails(union)).toBe(true);
  });

  it('rejects a branded-navigational x generic union (hard block)', () => {
    const union = [
      node({ isBranded: true, intent: 'navigational' }),
      node({ isBranded: false, intent: 'commercial' }),
    ];
    expect(mergeAcceptPassesRails(union)).toBe(false);
  });

  it('rejects different-services-same-city union (hard block)', () => {
    const union = [
      node({ serviceIds: ['svcA'], serviceAreaIds: ['area1'] }),
      node({ serviceIds: ['svcB'], serviceAreaIds: ['area1'] }),
    ];
    expect(mergeAcceptPassesRails(union)).toBe(false);
  });

  it('rejects a transitive hard block (A-B clean, B-C clean, A-C forbidden)', () => {
    const union = [
      node({ serviceIds: ['svcA'], serviceAreaIds: ['area1'] }),
      node({ serviceIds: ['svcA', 'svcB'], serviceAreaIds: ['area1'] }),
      node({ serviceIds: ['svcB'], serviceAreaIds: ['area1'] }),
    ];
    expect(mergeAcceptPassesRails(union)).toBe(false);
  });

  it('permits an intent-only conflict (incompatible_intent is not a hard block)', () => {
    const union = [
      node({ intent: 'commercial', serviceIds: ['svc1'] }),
      node({ intent: 'informational', serviceIds: ['svc1'] }),
    ];
    expect(mergeAcceptPassesRails(union)).toBe(true);
  });
});

describe('geoExclusionPassesRails', () => {
  const flagged = new Set(['kw-dallas', 'kw-omaha']);

  it('permits excluding a flagged geo candidate', () => {
    expect(geoExclusionPassesRails('kw-dallas', flagged)).toBe(true);
  });

  it('discards an unflagged / in-area keyword id', () => {
    expect(geoExclusionPassesRails('kw-austin', flagged)).toBe(false);
  });

  it('discards an unknown / hallucinated keyword id', () => {
    expect(geoExclusionPassesRails('kw-does-not-exist', flagged)).toBe(false);
  });
});
