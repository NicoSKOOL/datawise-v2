import { describe, it, expect } from 'vitest';
import {
  cleanKeywordForNaming,
  NAMING_STRIPPED_PHRASES,
  NAMING_STRIPPED_LEADING_WORDS,
} from './keyword-naming';

describe('cleanKeywordForNaming (extracted module)', () => {
  it('strips proximity phrases anywhere', () => {
    expect(cleanKeywordForNaming('drain cleaning service near me')).toBe('drain cleaning service');
    expect(cleanKeywordForNaming('plumber near you')).toBe('plumber');
    expect(cleanKeywordForNaming('emergency plumber in my area')).toBe('emergency plumber');
    expect(cleanKeywordForNaming('water heater repair nearby')).toBe('water heater repair');
    expect(cleanKeywordForNaming('electrician close to me')).toBe('electrician');
  });

  it('strips leading modifier words only when they lead', () => {
    expect(cleanKeywordForNaming('best drain cleaning')).toBe('drain cleaning');
    expect(cleanKeywordForNaming('cheap water heater')).toBe('water heater');
    // Mid-keyword modifier words survive.
    expect(cleanKeywordForNaming('drain cleaning best practices')).toBe('drain cleaning best practices');
  });

  it('strips trailing year tokens', () => {
    expect(cleanKeywordForNaming('plumbing costs 2026')).toBe('plumbing costs');
  });

  it('returns the original when stripping would empty it', () => {
    expect(cleanKeywordForNaming('near me')).toBe('near me');
  });

  it('exposes the canonical modifier lists as frozen arrays', () => {
    expect(Object.isFrozen(NAMING_STRIPPED_PHRASES)).toBe(true);
    expect(Object.isFrozen(NAMING_STRIPPED_LEADING_WORDS)).toBe(true);
    expect(NAMING_STRIPPED_PHRASES).toContain('near me');
    expect(NAMING_STRIPPED_LEADING_WORDS).toContain('best');
  });
});
