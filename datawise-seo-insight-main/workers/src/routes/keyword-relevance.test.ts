import { describe, it, expect } from 'vitest';
import { pickRelevantKeywords, seedTokens } from './keyword-relevance';

type Row = { keyword: string; search_volume: number };
const pick = (seed: string, rows: Row[], limit: number) =>
  pickRelevantKeywords(seed, rows, limit, (r) => r.keyword, (r) => r.search_volume).map((r) => r.keyword);

describe('seedTokens', () => {
  it('splits on hyphens and drops short words', () => {
    expect(seedTokens('WordPress-Wartung in DE')).toEqual(['wordpress', 'wartung']);
  });
});

describe('pickRelevantKeywords', () => {
  // Bug ebb0cef0: the merged pool for "wordpress wartung" (Germany) held huge
  // category-level terms that won a volume sort before the cap.
  const pool: Row[] = [
    { keyword: 'wordpress wartung', search_volume: 590 },
    { keyword: 'website erstellen', search_volume: 18100 },
    { keyword: 'wordpress wartungsmodus aktivieren', search_volume: 320 },
    { keyword: 'wolf cgb-2 20 bedienungsanleitung pdf', search_volume: 260 },
    { keyword: 'website wartung', search_volume: 480 },
    { keyword: '2 bundesliga spiele', search_volume: 3350000 },
    { keyword: 'qr code erstellen', search_volume: 90500 },
  ];

  it('keeps keywords sharing a seed word ahead of bigger unrelated ones', () => {
    expect(pick('wordpress wartung', pool, 3)).toEqual([
      'wordpress wartung',
      'website wartung',
      'wordpress wartungsmodus aktivieren',
    ]);
  });

  it('fills remaining slots with unrelated rows in source order, then sorts by volume', () => {
    expect(pick('wordpress wartung', pool, 5)).toEqual([
      'website erstellen',
      'wordpress wartung',
      'website wartung',
      'wordpress wartungsmodus aktivieren',
      'wolf cgb-2 20 bedienungsanleitung pdf',
    ]);
  });

  it('caps in source (DFS relevance) order when the seed has no usable words', () => {
    expect(pick('ai', pool, 2)).toEqual(['website erstellen', 'wordpress wartung']);
  });
});
