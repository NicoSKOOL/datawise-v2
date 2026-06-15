import { describe, it, expect } from 'vitest';
import { normalizeEmail } from './email-normalize';

describe('normalizeEmail', () => {
  it('collapses every Gmail +tag alias of the same inbox', () => {
    const canonical = 'gsmith0572@gmail.com';
    expect(normalizeEmail('gsmith0572@gmail.com')).toBe(canonical);
    expect(normalizeEmail('gsmith0572+dw2@gmail.com')).toBe(canonical);
    expect(normalizeEmail('gsmith0572+dw5@gmail.com')).toBe(canonical);
    expect(normalizeEmail('GSmith0572+ANYTHING@Gmail.com')).toBe(canonical);
  });

  it('ignores dots in the Gmail local part', () => {
    expect(normalizeEmail('g.smith.0572@gmail.com')).toBe('gsmith0572@gmail.com');
  });

  it('treats googlemail.com as gmail.com', () => {
    expect(normalizeEmail('gsmith0572+x@googlemail.com')).toBe('gsmith0572@gmail.com');
  });

  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo.Bar+promo@Gmail.com ')).toBe('foobar@gmail.com');
  });

  it('strips +tags but keeps dots for non-Gmail providers', () => {
    expect(normalizeEmail('john.doe+sale@outlook.com')).toBe('john.doe@outlook.com');
  });

  it('does not crash on malformed input', () => {
    expect(normalizeEmail('notanemail')).toBe('notanemail');
    expect(normalizeEmail('')).toBe('');
  });
});
