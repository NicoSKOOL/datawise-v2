import { describe, it, expect } from 'vitest';
import { forbiddenEdgeViolations } from './constraints';
import type { ConstraintNode } from './constraints';

function node(overrides: Partial<ConstraintNode> = {}): ConstraintNode {
  return {
    isBranded: false,
    intent: null,
    serviceIds: [],
    serviceAreaIds: [],
    ...overrides,
  };
}

describe('branded_navigational_x_generic', () => {
  it('flags a branded-navigational node paired with a non-branded node', () => {
    const a = node({ isBranded: true, intent: 'navigational' });
    const b = node({ isBranded: false });
    expect(forbiddenEdgeViolations(a, b)).toContain('branded_navigational_x_generic');
    expect(forbiddenEdgeViolations(b, a)).toContain('branded_navigational_x_generic');
  });

  it('does not flag two branded-navigational nodes', () => {
    const a = node({ isBranded: true, intent: 'navigational' });
    const b = node({ isBranded: true, intent: 'navigational' });
    expect(forbiddenEdgeViolations(a, b)).not.toContain('branded_navigational_x_generic');
  });

  it('does not flag branded-navigational paired with a different branded node', () => {
    const a = node({ isBranded: true, intent: 'navigational' });
    const b = node({ isBranded: true, intent: 'commercial' });
    expect(forbiddenEdgeViolations(a, b)).not.toContain('branded_navigational_x_generic');
  });

  it('does not flag a branded but non-navigational node with a generic node', () => {
    const a = node({ isBranded: true, intent: 'commercial' });
    const b = node({ isBranded: false });
    expect(forbiddenEdgeViolations(a, b)).not.toContain('branded_navigational_x_generic');
  });
});

describe('different_services_same_city_only', () => {
  it('flags disjoint services sharing a service area', () => {
    const a = node({ serviceIds: ['s1'], serviceAreaIds: ['a1'] });
    const b = node({ serviceIds: ['s2'], serviceAreaIds: ['a1'] });
    expect(forbiddenEdgeViolations(a, b)).toContain('different_services_same_city_only');
  });

  it('does not flag when services overlap', () => {
    const a = node({ serviceIds: ['s1', 's2'], serviceAreaIds: ['a1'] });
    const b = node({ serviceIds: ['s2'], serviceAreaIds: ['a1'] });
    expect(forbiddenEdgeViolations(a, b)).not.toContain('different_services_same_city_only');
  });

  it('does not flag when no service area is shared', () => {
    const a = node({ serviceIds: ['s1'], serviceAreaIds: ['a1'] });
    const b = node({ serviceIds: ['s2'], serviceAreaIds: ['a2'] });
    expect(forbiddenEdgeViolations(a, b)).not.toContain('different_services_same_city_only');
  });

  it('does not flag when one side has no services', () => {
    const a = node({ serviceIds: [], serviceAreaIds: ['a1'] });
    const b = node({ serviceIds: ['s2'], serviceAreaIds: ['a1'] });
    expect(forbiddenEdgeViolations(a, b)).not.toContain('different_services_same_city_only');
  });
});

describe('service_location_x_national_informational', () => {
  it('flags a service-location node paired with a national informational node', () => {
    const a = node({ serviceIds: ['s1'], serviceAreaIds: ['a1'] });
    const b = node({ intent: 'informational', serviceAreaIds: [] });
    expect(forbiddenEdgeViolations(a, b)).toContain('service_location_x_national_informational');
    expect(forbiddenEdgeViolations(b, a)).toContain('service_location_x_national_informational');
  });

  it('does not flag when the informational node has a service area', () => {
    const a = node({ serviceIds: ['s1'], serviceAreaIds: ['a1'] });
    const b = node({ intent: 'informational', serviceAreaIds: ['a2'] });
    expect(forbiddenEdgeViolations(a, b)).not.toContain('service_location_x_national_informational');
  });

  it('does not flag when the service node lacks a service area', () => {
    const a = node({ serviceIds: ['s1'], serviceAreaIds: [] });
    const b = node({ intent: 'informational', serviceAreaIds: [] });
    expect(forbiddenEdgeViolations(a, b)).not.toContain('service_location_x_national_informational');
  });
});

describe('incompatible_intent', () => {
  it('flags transactional vs informational', () => {
    const a = node({ intent: 'transactional' });
    const b = node({ intent: 'informational' });
    expect(forbiddenEdgeViolations(a, b)).toContain('incompatible_intent');
    expect(forbiddenEdgeViolations(b, a)).toContain('incompatible_intent');
  });

  it('flags commercial vs informational', () => {
    const a = node({ intent: 'commercial' });
    const b = node({ intent: 'informational' });
    expect(forbiddenEdgeViolations(a, b)).toContain('incompatible_intent');
  });

  it('does not flag when a side is unknown/null', () => {
    expect(forbiddenEdgeViolations(node({ intent: 'unknown' }), node({ intent: 'informational' })))
      .not.toContain('incompatible_intent');
    expect(forbiddenEdgeViolations(node({ intent: null }), node({ intent: 'informational' })))
      .not.toContain('incompatible_intent');
  });

  it('does not flag transactional vs commercial', () => {
    expect(forbiddenEdgeViolations(node({ intent: 'transactional' }), node({ intent: 'commercial' })))
      .not.toContain('incompatible_intent');
  });
});

describe('accumulation', () => {
  it('returns multiple violations when several rules fire', () => {
    // Branded-navigational + service-location on side a; national informational
    // non-branded on side b. Fires branded_navigational_x_generic,
    // service_location_x_national_informational and incompatible_intent.
    const a = node({ isBranded: true, intent: 'navigational', serviceIds: ['s1'], serviceAreaIds: ['a1'] });
    const b = node({ isBranded: false, intent: 'informational', serviceIds: [], serviceAreaIds: [] });
    const v = forbiddenEdgeViolations(a, b);
    expect(v).toContain('branded_navigational_x_generic');
    expect(v).toContain('service_location_x_national_informational');
    expect(v.length).toBeGreaterThanOrEqual(2);
  });

  it('returns an empty array for a clean pair', () => {
    const a = node({ intent: 'commercial', serviceIds: ['s1'], serviceAreaIds: ['a1'] });
    const b = node({ intent: 'commercial', serviceIds: ['s1'], serviceAreaIds: ['a1'] });
    expect(forbiddenEdgeViolations(a, b)).toEqual([]);
  });

  it('emits violations in a deterministic (rule) order', () => {
    const a = node({ isBranded: true, intent: 'navigational', serviceIds: ['s1'], serviceAreaIds: ['a1'] });
    const b = node({ isBranded: false, intent: 'informational', serviceIds: [], serviceAreaIds: [] });
    const v1 = forbiddenEdgeViolations(a, b);
    const v2 = forbiddenEdgeViolations(a, b);
    expect(v1).toEqual(v2);
  });
});
