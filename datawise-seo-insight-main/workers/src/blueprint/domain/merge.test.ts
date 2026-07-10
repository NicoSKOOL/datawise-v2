import { describe, it, expect } from 'vitest';
import { mergeKeywordCandidates } from './merge';
import type { KeywordCandidate } from '../contracts/types';

const cand = (keyword: string, source: string, metrics: Partial<KeywordCandidate['metrics']> = {}, refs: string[] = []): KeywordCandidate => ({
  keyword,
  source,
  metrics: { searchVolume: null, cpcUsd: null, difficulty: null, ...metrics },
  evidenceRefs: refs,
});

describe('mergeKeywordCandidates', () => {
  it('merges semantic variants into one keyword without losing evidence', () => {
    const universe = mergeKeywordCandidates(
      [
        [cand('Emergency Plumber!', 'ideas', { searchVolume: 900 }, ['ev1'])],
        [cand('emergency   plumber', 'suggestions', { cpcUsd: 4.2 }, ['ev2'])],
      ],
      'en-US'
    );
    expect(universe.keywords).toHaveLength(1);
    const kw = universe.keywords[0];
    expect(kw.normalizedKeyword).toBe('emergency plumber');
    expect(kw.variants).toEqual(['Emergency Plumber!', 'emergency   plumber']);
    expect(kw.sources).toEqual(['ideas', 'suggestions']);
    expect(kw.evidenceRefs).toEqual(['ev1', 'ev2']);
    expect(kw.metrics).toEqual({ searchVolume: 900, cpcUsd: 4.2, difficulty: null });
  });
  it('keeps first non-null metric, never converts null to 0', () => {
    const universe = mergeKeywordCandidates(
      [[cand('a', 's1', { searchVolume: 100 })], [cand('a', 's2', { searchVolume: 500 })]],
      'en-US'
    );
    expect(universe.keywords[0].metrics.searchVolume).toBe(100);
    const empty = mergeKeywordCandidates([[cand('b', 's1')]], 'en-US');
    expect(empty.keywords[0].metrics.searchVolume).toBeNull();
  });
  it('drops empty keywords and dedupes evidence refs', () => {
    const universe = mergeKeywordCandidates([[cand('  ', 's1'), cand('x', 's1', {}, ['e', 'e'])]], 'en-US');
    expect(universe.keywords).toHaveLength(1);
    expect(universe.keywords[0].evidenceRefs).toEqual(['e']);
  });
});
