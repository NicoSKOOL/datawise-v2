import { describe, expect, it } from 'vitest';
import { intentLabel } from '../keyword-intent';
import { toPlannerIntent } from '../planner-keyword-selection';

describe('intentLabel', () => {
  it('labels the DataForSEO main intent', () => {
    expect(intentLabel({ main_intent: 'commercial', foreign_intent: ['transactional'] })).toBe('Commercial');
    expect(intentLabel({ main_intent: 'navigational' })).toBe('Navigational');
  });

  it('falls back to a dash when intent is missing or unknown', () => {
    expect(intentLabel(undefined)).toBe('-');
    expect(intentLabel(null)).toBe('-');
    expect(intentLabel({ main_intent: null })).toBe('-');
    expect(intentLabel({ main_intent: 'other' })).toBe('-');
  });

  it('round-trips into a planner intent', () => {
    expect(toPlannerIntent(intentLabel({ main_intent: 'transactional' }))).toBe('transactional');
    expect(toPlannerIntent(intentLabel(undefined))).toBeUndefined();
  });
});
