import { describe, it, expect } from 'vitest';
import { cleanTrackingDomain } from '@/lib/ai-tracking';

describe('cleanTrackingDomain', () => {
  it('normalizes protocol, sc-domain, www and trailing slash', () => {
    expect(cleanTrackingDomain('https://www.Example.com/')).toBe('example.com');
    expect(cleanTrackingDomain('sc-domain:example.com')).toBe('example.com');
  });

  it('returns empty string for projects without a domain', () => {
    expect(cleanTrackingDomain(null)).toBe('');
    expect(cleanTrackingDomain(undefined)).toBe('');
  });

  it('filtering projects with a null domain does not throw', () => {
    const projects = [{ domain: null }, { domain: 'https://example.com' }] as Array<{ domain: string | null }>;
    const matches = projects.filter((p) => cleanTrackingDomain(p.domain) === 'example.com');
    expect(matches).toHaveLength(1);
  });
});
