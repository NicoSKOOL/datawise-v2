import { describe, it, expect } from 'vitest';
import { classify, isVisibleStatus } from './classify';
import type { NormalizedAnswer } from './types';

const base = (over: Partial<NormalizedAnswer> = {}): NormalizedAnswer => ({
  engine: 'chatgpt', model: null,
  answerText: 'HubSpot and Zoho are popular. DataWise SEO also gets a mention here for analytics.',
  answerMarkdown: '', cited: [], retrieved: [], brands: [], ads: [], fanOut: [], ...over,
});
const src = (domain: string, position: number, url = `https://${domain}/p`) => ({ url, domain, title: null, position });

describe('classify', () => {
  it('cited when the project domain is among cited sources, with position and url', () => {
    const c = classify(base({ cited: [src('other.com', 1), src('blog.datawiseseo.com', 2)] }), 'datawiseseo.com', ['DataWise']);
    expect(c.status).toBe('cited');
    expect(c.citation_position).toBe(2);
    expect(c.cited_url).toBe('https://blog.datawiseseo.com/p');
    expect(c.answer_excerpt).toContain('HubSpot');
  });

  it('cited beats mentioned and retrieved', () => {
    const c = classify(base({ cited: [src('datawiseseo.com', 1)], retrieved: [src('datawiseseo.com', 1)], brands: [{ name: 'DataWise', category: null, urls: [] }] }), 'datawiseseo.com', ['DataWise']);
    expect(c.status).toBe('cited');
  });

  it('mentioned via brand entity name (case-insensitive)', () => {
    const c = classify(base({ answerText: 'nothing here', brands: [{ name: 'datawise seo', category: 'company', urls: [] }] }), 'datawiseseo.com', ['DataWise SEO']);
    expect(c.status).toBe('mentioned');
    expect(c.matched_brand).toBe('datawise seo');
  });

  it('mentioned via brand entity url matching the domain', () => {
    const c = classify(base({ answerText: 'nothing here', brands: [{ name: 'DW', category: null, urls: ['https://www.datawiseseo.com/'] }] }), 'datawiseseo.com', ['zzz']);
    expect(c.status).toBe('mentioned');
    expect(c.matched_brand).toBe('DW');
  });

  it('mentioned via a brand term in the text, with an excerpt around the match', () => {
    const c = classify(base(), 'datawiseseo.com', ['DataWise SEO']);
    expect(c.status).toBe('mentioned');
    expect(c.answer_excerpt).toContain('DataWise SEO');
    expect(c.matched_brand).toBe('DataWise SEO');
  });

  it('ignores brand terms shorter than 3 characters and matches whole words only', () => {
    expect(classify(base({ answerText: 'datawiseseoisgreat' }), 'datawiseseo.com', ['datawiseseo']).status).toBe('absent');
    expect(classify(base({ answerText: 'we use dw daily' }), 'x.com', ['dw']).status).toBe('absent');
  });

  it('retrieved when the domain was fetched but not cited', () => {
    const c = classify(base({ answerText: 'nothing here', retrieved: [src('datawiseseo.com', 3, 'https://datawiseseo.com/guide')] }), 'datawiseseo.com', ['zzz']);
    expect(c.status).toBe('retrieved');
    expect(c.retrieved_url).toBe('https://datawiseseo.com/guide');
    expect(c.answer_excerpt).toBe('nothing here');
  });

  it('no_answer when there is no text and no sources', () => {
    expect(classify(base({ answerText: '' }), 'datawiseseo.com', ['DataWise']).status).toBe('no_answer');
  });

  it('absent otherwise', () => {
    const c = classify(base({ answerText: 'HubSpot only' }), 'datawiseseo.com', ['DataWise']);
    expect(c).toEqual({ status: 'absent', citation_position: null, cited_url: null, retrieved_url: null, answer_excerpt: null, matched_brand: null });
  });
});

describe('isVisibleStatus', () => {
  it('counts cited and mentioned only', () => {
    expect(isVisibleStatus('cited')).toBe(true);
    expect(isVisibleStatus('mentioned')).toBe(true);
    expect(isVisibleStatus('retrieved')).toBe(false);
    expect(isVisibleStatus('absent')).toBe(false);
  });
});
