import { describe, it, expect } from 'vitest';
import { normalizeKeyword } from './keyword';

describe('normalizeKeyword', () => {
  it('lowercases, trims, collapses whitespace, strips noise punctuation', () => {
    expect(normalizeKeyword('  Plumber   Near Me!! ', 'en-US')).toBe('plumber near me');
    expect(normalizeKeyword('\u201cbest\u201d plumber, austin?', 'en-US')).toBe('best plumber austin');
  });
  it('canonicalizes curly apostrophes and strips curly double quotes', () => {
    expect(normalizeKeyword('women\u2019s co-working space', 'en-US')).toBe("women's co-working space");
    expect(normalizeKeyword('\u201csmart\u201d quotes', 'en-US')).toBe('smart quotes');
  });
  it('preserves meaningful tokens: hyphens, apostrophes, accents, locality', () => {
    expect(normalizeKeyword("women's co-working space", 'en-US')).toBe("women's co-working space");
    expect(normalizeKeyword('Fontanería MÁLAGA', 'es-ES')).toBe('fontanería málaga');
  });
  it('applies unicode NFKC (fullwidth to ascii)', () => {
    expect(normalizeKeyword('ｓｅｏ ａｕｄｉｔ', 'en-US')).toBe('seo audit');
  });
});