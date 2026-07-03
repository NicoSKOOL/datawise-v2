import { describe, it, expect } from 'vitest';
import { filterCitationsByDomains } from './source-filter';

describe('filterCitationsByDomains', () => {
  it('filters out an exact host match', () => {
    const citations = [
      { url: 'https://rejected.com/article' },
      { url: 'https://kept.com/article' },
    ];
    const { sources, filteredCount } = filterCitationsByDomains(citations, ['rejected.com']);
    expect(sources).toEqual([{ url: 'https://kept.com/article' }]);
    expect(filteredCount).toBe(1);
  });

  it('filters a subdomain of a rejected domain', () => {
    const citations = [
      { url: 'https://blog.rejected.com/post' },
      { url: 'https://kept.com/article' },
    ];
    const { sources, filteredCount } = filterCitationsByDomains(citations, ['rejected.com']);
    expect(sources).toEqual([{ url: 'https://kept.com/article' }]);
    expect(filteredCount).toBe(1);
  });

  it('strips a leading www. before comparing', () => {
    const citations = [{ url: 'https://www.rejected.com/article' }];
    const { sources, filteredCount } = filterCitationsByDomains(citations, ['rejected.com']);
    expect(sources).toEqual([]);
    expect(filteredCount).toBe(1);
  });

  it('keeps a citation whose URL cannot be parsed', () => {
    const citations = [{ url: 'not-a-valid-url' }];
    const { sources, filteredCount } = filterCitationsByDomains(citations, ['rejected.com']);
    expect(sources).toEqual(citations);
    expect(filteredCount).toBe(0);
  });

  it('returns the input unchanged when the domains list is empty', () => {
    const citations = [{ url: 'https://rejected.com/article' }];
    const { sources, filteredCount } = filterCitationsByDomains(citations, []);
    expect(sources).toBe(citations);
    expect(filteredCount).toBe(0);
  });

  it('returns the input unchanged when citations is undefined', () => {
    const { sources, filteredCount } = filterCitationsByDomains(undefined, ['rejected.com']);
    expect(sources).toBeUndefined();
    expect(filteredCount).toBe(0);
  });

  it('does not match an unrelated domain that merely contains the rejected domain as a substring', () => {
    const citations = [{ url: 'https://notrejected.com/article' }];
    const { sources, filteredCount } = filterCitationsByDomains(citations, ['rejected.com']);
    expect(sources).toEqual(citations);
    expect(filteredCount).toBe(0);
  });

  it('computes filteredCount correctly across a mix of kept and filtered citations', () => {
    const citations = [
      { url: 'https://rejected.com/a' },
      { url: 'https://kept.com/b' },
      { url: 'https://sub.rejected.com/c' },
      { url: 'https://kept2.com/d' },
    ];
    const { sources, filteredCount } = filterCitationsByDomains(citations, ['rejected.com']);
    expect(sources).toEqual([{ url: 'https://kept.com/b' }, { url: 'https://kept2.com/d' }]);
    expect(filteredCount).toBe(2);
  });
});
