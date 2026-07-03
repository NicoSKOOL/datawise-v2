import { describe, it, expect } from 'vitest';
import { classifySourceTier } from '@/lib/source-tier';

describe('classifySourceTier', () => {
  it('classifies gov/edu/research as primary', () => {
    expect(classifySourceTier('https://www.cdc.gov/water/safety.html')).toBe('primary');
    expect(classifySourceTier('https://engineering.stanford.edu/study')).toBe('primary');
    expect(classifySourceTier('https://pubmed.ncbi.nlm.nih.gov/12345/')).toBe('primary');
    expect(classifySourceTier('https://www.ons.gov.uk/data')).toBe('primary');
  });

  it('classifies official documentation hosts', () => {
    expect(classifySourceTier('https://developer.mozilla.org/docs/Web')).toBe('official');
    expect(classifySourceTier('https://docs.python.org/3/')).toBe('official');
    expect(classifySourceTier('https://support.google.com/webmasters/answer/1')).toBe('official');
  });

  it('defaults everything else to general', () => {
    expect(classifySourceTier('https://someblog.com/10-best-tools')).toBe('general');
    expect(classifySourceTier(null)).toBe('general');
    expect(classifySourceTier('not a url')).toBe('general');
  });
});
