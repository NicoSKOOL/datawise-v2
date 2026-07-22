import { describe, it, expect } from 'vitest';
import { hashNormalizedInput } from '../hash';
import { PAGE_PLAN_RULESET_V1 } from './ruleset';

// Drift guard: this hash is a canonical fingerprint of every threshold in
// PAGE_PLAN_RULESET_V1. If you change ANY value in that object, this test
// fails until you (1) bump `version` to a new string and (2) recompute this
// pinned hash by running the test once, reading the actual value out of the
// failure diff, and pasting it back in here. That two-step is the whole
// point: a silent threshold edit can never ship without a version bump.
const PINNED_HASH = '15b49a87bbb6e5648264a8bb05ff323c8001347592d4a0049da85b87f05eee37';

describe('PAGE_PLAN_RULESET_V1 drift guard', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(PAGE_PLAN_RULESET_V1)).toBe(true);
  });

  it('has the expected version string', () => {
    expect(PAGE_PLAN_RULESET_V1.version).toBe('pp-v2');
  });

  it('matches the pinned canonical hash (bump version + this hash together on any threshold change)', async () => {
    const hash = await hashNormalizedInput(PAGE_PLAN_RULESET_V1);
    expect(hash).toBe(PINNED_HASH);
  });
});
