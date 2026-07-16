import { describe, it, expect } from 'vitest';
import { detectLanguageMismatch } from './language';

describe('detectLanguageMismatch', () => {
  it('returns false for a latin keyword against an expected latin language', () => {
    expect(detectLanguageMismatch('emergency plumber austin', 'en')).toBe(false);
  });

  it('returns true for a cyrillic keyword against an expected latin language', () => {
    expect(detectLanguageMismatch('сантехник austin', 'en')).toBe(true);
  });

  it('returns false for a cjk (kanji) keyword against an expected cjk language', () => {
    expect(detectLanguageMismatch('配管工 東京', 'ja')).toBe(false);
  });

  it('returns false when non-letter characters (digits/punctuation/whitespace) dominate', () => {
    expect(detectLanguageMismatch('12345 67890', 'en')).toBe(false);
  });

  it('returns true when the majority of letters are outside the expected script', () => {
    // 2 latin letters ("ab") vs 3 cyrillic letters ("сан") -> cyrillic majority.
    expect(detectLanguageMismatch('ab сан', 'en')).toBe(true);
  });

  it('returns false when the majority of letters are inside the expected script', () => {
    // 3 latin letters ("abc") vs 2 cyrillic letters ("са") -> latin majority.
    expect(detectLanguageMismatch('abc са', 'en')).toBe(false);
  });

  it('returns false at an exact 50/50 split (not a strict majority either way)', () => {
    // 2 latin ("ab") vs 2 cyrillic ("са") -> exactly half, not "majority".
    expect(detectLanguageMismatch('ab са', 'en')).toBe(false);
  });

  it('defaults an unknown/unlisted language code to latin', () => {
    expect(detectLanguageMismatch('emergency plumber', 'xx')).toBe(false);
    expect(detectLanguageMismatch('сантехник', 'xx')).toBe(true);
  });

  it('is unaffected by a region subtag suffix', () => {
    expect(detectLanguageMismatch('plombier urgence', 'fr-CA')).toBe(false);
  });

  it('detects arabic vs an expected latin language', () => {
    expect(detectLanguageMismatch('سباك الطوارئ', 'en')).toBe(true);
  });

  it('detects hebrew and greek against each other', () => {
    expect(detectLanguageMismatch('שרברב חירום', 'el')).toBe(true);
    expect(detectLanguageMismatch('υδραυλικός', 'he')).toBe(true);
  });
});
