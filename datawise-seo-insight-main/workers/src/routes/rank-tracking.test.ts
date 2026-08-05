import { describe, it, expect } from 'vitest';
import { resolveKeywordLocale, parseLocationCode, parseLanguageCode } from './rank-tracking';

// Regression tests for the "Locale says United States but my site is UK" report.
// A UK user (account default 2826) had a rank-tracking project auto-created
// without a country, so the API defaulted it to 2840, and the Add Keywords
// dialog then stamped 2840 onto all 33 keywords. Every position returned was a
// US SERP position for a Newcastle business.

const UK = 2826;
const US = 2840;
const ukAccount = { location_code: UK, language_code: 'en' };

describe('resolveKeywordLocale', () => {
  it('uses the project country when the request omits one', () => {
    const locale = resolveKeywordLocale({
      requested: {},
      project: { location_code: UK },
      accountDefault: { location_code: US, language_code: 'en' },
    });
    expect(locale.location_code).toBe(UK);
  });

  it('falls back to the account default, never to a hardcoded US', () => {
    const locale = resolveKeywordLocale({
      requested: {},
      project: { location_code: null },
      accountDefault: ukAccount,
    });
    expect(locale.location_code).toBe(UK);
    expect(locale.location_code).not.toBe(US);
  });

  it('lets an explicit request override the project', () => {
    const locale = resolveKeywordLocale({
      requested: { location_code: US, language_code: 'es' },
      project: { location_code: UK },
      accountDefault: ukAccount,
    });
    expect(locale).toEqual({ location_code: US, language_code: 'es' });
  });

  it('ignores junk location codes rather than writing them to the database', () => {
    for (const junk of [0, -1, 'abc', null, undefined, NaN, 1.5, '']) {
      const locale = resolveKeywordLocale({
        requested: { location_code: junk },
        project: { location_code: UK },
        accountDefault: ukAccount,
      });
      expect(locale.location_code).toBe(UK);
    }
  });

  it('accepts a numeric string location code (the UI sends select values as strings)', () => {
    const locale = resolveKeywordLocale({
      requested: { location_code: '2826' },
      project: { location_code: US },
      accountDefault: { location_code: US, language_code: 'en' },
    });
    expect(locale.location_code).toBe(UK);
  });

  it('language falls back to the account default, since projects have no language column', () => {
    const locale = resolveKeywordLocale({
      requested: { location_code: UK },
      project: { location_code: UK },
      accountDefault: { location_code: UK, language_code: 'es' },
    });
    expect(locale.language_code).toBe('es');
  });

  it('a whitespace-only language is not a choice', () => {
    const locale = resolveKeywordLocale({
      requested: { language_code: '   ' },
      project: { location_code: UK },
      accountDefault: ukAccount,
    });
    expect(locale.language_code).toBe('en');
  });
});

describe('parseLocationCode', () => {
  it('accepts positive integers only', () => {
    expect(parseLocationCode(2826)).toBe(2826);
    expect(parseLocationCode('2826')).toBe(2826);
    expect(parseLocationCode(0)).toBeNull();
    expect(parseLocationCode(-2826)).toBeNull();
    expect(parseLocationCode(2826.5)).toBeNull();
    expect(parseLocationCode('nope')).toBeNull();
    expect(parseLocationCode(undefined)).toBeNull();
  });
});

describe('parseLanguageCode', () => {
  it('trims and caps length, rejecting empties', () => {
    expect(parseLanguageCode(' en ')).toBe('en');
    expect(parseLanguageCode('')).toBeNull();
    expect(parseLanguageCode('  ')).toBeNull();
    expect(parseLanguageCode(42)).toBeNull();
    expect(parseLanguageCode('x'.repeat(40))).toHaveLength(16);
  });
});
