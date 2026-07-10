import { describe, it, expect } from 'vitest';
import { normalizeSlug } from './slug';

describe('normalizeSlug', () => {
  it('produces root-relative lowercase paths with one trailing slash', () => {
    expect(normalizeSlug('Emergency Plumbing')).toBe('/emergency-plumbing/');
    expect(normalizeSlug('/services/Drain-Cleaning')).toBe('/services/drain-cleaning/');
    expect(normalizeSlug('https://example.com/Services/AC Repair/')).toBe('/services/ac-repair/');
  });
  it('transliterates accents and strips unsafe characters', () => {
    expect(normalizeSlug('fontanería málaga')).toBe('/fontaneria-malaga/');
    expect(normalizeSlug('a&b (c)')).toBe('/a-b-c/');
  });
  it('home path stays /', () => {
    expect(normalizeSlug('/')).toBe('/');
    expect(normalizeSlug('')).toBe('/');
  });
});
