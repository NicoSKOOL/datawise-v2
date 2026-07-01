import { describe, expect, it } from 'vitest';
import {
  countFilterableWords,
  deriveBrandTokens,
  emptyKeywordFilterState,
  filterKeywordRows,
  isKeywordFilterActive,
  parseFilterTerms,
} from '../keyword-filters';

const row = (keyword: string, search_volume = 100, intent?: string) => ({
  keyword,
  search_volume,
  ...(intent ? { intent } : {}),
});

describe('parseFilterTerms', () => {
  it('splits on commas, trims, lowercases, drops empties', () => {
    expect(parseFilterTerms(' How, WHAT ,,why ')).toEqual(['how', 'what', 'why']);
  });

  it('returns empty array for blank input', () => {
    expect(parseFilterTerms('   ')).toEqual([]);
  });
});

describe('deriveBrandTokens', () => {
  it('extracts name tokens from domains, dropping TLDs and short tokens', () => {
    expect(deriveBrandTokens(['nike.com', 'on-running.co.uk'])).toEqual([
      'nike',
      'running',
    ]);
  });

  it('ignores null and undefined domains', () => {
    expect(deriveBrandTokens([null, undefined, 'ahrefs.com'])).toEqual(['ahrefs']);
  });
});

describe('countFilterableWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countFilterableWords('  best hvac  installation cost ')).toBe(4);
  });
});

describe('isKeywordFilterActive', () => {
  it('is false for the empty state', () => {
    expect(isKeywordFilterActive(emptyKeywordFilterState)).toBe(false);
  });

  it('is true when any field is set', () => {
    expect(
      isKeywordFilterActive({ ...emptyKeywordFilterState, minVolume: 10 }),
    ).toBe(true);
    expect(
      isKeywordFilterActive({ ...emptyKeywordFilterState, includeTerms: 'how' }),
    ).toBe(true);
    expect(
      isKeywordFilterActive({ ...emptyKeywordFilterState, excludeBrand: true }),
    ).toBe(true);
  });
});

describe('filterKeywordRows', () => {
  const rows = [
    row('how to fix hvac', 500, 'Informational'),
    row('nike running shoes', 9000, 'Commercial'),
    row('buy hvac unit', 50, 'Commercial'),
    row('hvac', 12000, 'Navigational'),
  ];

  it('returns rows unchanged for the empty state', () => {
    expect(filterKeywordRows(rows, emptyKeywordFilterState)).toEqual(rows);
  });

  it('include terms: keeps rows containing ANY include term', () => {
    const state = { ...emptyKeywordFilterState, includeTerms: 'how, buy' };
    expect(filterKeywordRows(rows, state).map((r) => r.keyword)).toEqual([
      'how to fix hvac',
      'buy hvac unit',
    ]);
  });

  it('exclude terms: drops rows containing ANY exclude term', () => {
    const state = { ...emptyKeywordFilterState, excludeTerms: 'nike' };
    expect(filterKeywordRows(rows, state).map((r) => r.keyword)).toEqual([
      'how to fix hvac',
      'buy hvac unit',
      'hvac',
    ]);
  });

  it('volume range: min and max inclusive', () => {
    const state = { ...emptyKeywordFilterState, minVolume: 500, maxVolume: 9000 };
    expect(filterKeywordRows(rows, state).map((r) => r.keyword)).toEqual([
      'how to fix hvac',
      'nike running shoes',
    ]);
  });

  it('treats missing search_volume as 0 for min-volume checks', () => {
    const state = { ...emptyKeywordFilterState, minVolume: 1 };
    const noVolume = [{ keyword: 'orphan keyword' }];
    expect(filterKeywordRows(noVolume, state)).toEqual([]);
  });

  it('word count range', () => {
    const state = { ...emptyKeywordFilterState, minWordCount: 2, maxWordCount: 3 };
    expect(filterKeywordRows(rows, state).map((r) => r.keyword)).toEqual([
      'nike running shoes',
      'buy hvac unit',
    ]);
  });

  it('intent filter: empty list means all, otherwise case-insensitive match', () => {
    const state = { ...emptyKeywordFilterState, intents: ['commercial'] };
    expect(filterKeywordRows(rows, state).map((r) => r.keyword)).toEqual([
      'nike running shoes',
      'buy hvac unit',
    ]);
  });

  it('intent filter keeps rows with no intent field', () => {
    const state = { ...emptyKeywordFilterState, intents: ['commercial'] };
    const mixed = [row('no intent here', 10), row('buy now', 10, 'Commercial')];
    expect(filterKeywordRows(mixed, state).map((r) => r.keyword)).toEqual([
      'no intent here',
      'buy now',
    ]);
  });

  it('brand exclusion: drops rows whose keyword contains a brand token as a whole word', () => {
    const state = { ...emptyKeywordFilterState, excludeBrand: true };
    const out = filterKeywordRows(rows, state, { brandTokens: ['nike'] });
    expect(out.map((r) => r.keyword)).toEqual([
      'how to fix hvac',
      'buy hvac unit',
      'hvac',
    ]);
  });

  it('brand exclusion is a no-op when excludeBrand is false or tokens are empty', () => {
    const state = { ...emptyKeywordFilterState, excludeBrand: true };
    expect(filterKeywordRows(rows, state, { brandTokens: [] })).toEqual(rows);
    expect(
      filterKeywordRows(rows, { ...state, excludeBrand: false }, { brandTokens: ['nike'] }),
    ).toEqual(rows);
  });
});
