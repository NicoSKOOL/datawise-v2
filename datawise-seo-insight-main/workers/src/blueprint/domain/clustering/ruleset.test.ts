import { describe, it, expect } from 'vitest';
import { hashNormalizedInput } from '../hash';
import { CLUSTER_RULESET_V2 } from './ruleset';

// Drift guard: this hash is a canonical fingerprint of every threshold in
// CLUSTER_RULESET_V2. If you change ANY value in that object, this test
// fails until you (1) bump `version` to a new string and (2) recompute this
// pinned hash by running the test once, reading the actual value out of the
// failure diff, and pasting it back in here. That two-step is the whole
// point: a silent threshold edit can never ship without a version bump.
const PINNED_HASH = '7bfa090aa0a83fc06fe37a8fd776d3a272f375d48a52bf27336c9d4b13fb1015';

describe('CLUSTER_RULESET_V2 drift guard', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(CLUSTER_RULESET_V2)).toBe(true);
  });

  it('has the expected version string', () => {
    expect(CLUSTER_RULESET_V2.version).toBe('cluster-v2');
  });

  it('matches the pinned canonical hash (bump version + this hash together on any threshold change)', async () => {
    const hash = await hashNormalizedInput(CLUSTER_RULESET_V2);
    expect(hash).toBe(PINNED_HASH);
  });
});
