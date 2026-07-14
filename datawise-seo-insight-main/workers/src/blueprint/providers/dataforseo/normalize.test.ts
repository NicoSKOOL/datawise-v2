import { describe, it, expect } from 'vitest';
import { normalizeKeywordItem } from './normalize';

describe('normalizeKeywordItem', () => {
  it('normalizes a flat Labs item (keyword_ideas/keyword_suggestions shape)', () => {
    const item = {
      keyword: 'ac repair austin',
      keyword_info: { search_volume: 320, cpc: 4.5 },
      keyword_properties: { keyword_difficulty: 42 },
    };

    const candidate = normalizeKeywordItem(item, 'keyword_ideas', 'evr_1');

    expect(candidate).toEqual({
      keyword: 'ac repair austin',
      source: 'keyword_ideas',
      metrics: { searchVolume: 320, cpcUsd: 4.5, difficulty: 42 },
      evidenceRefs: ['evr_1'],
    });
  });

  it('normalizes a ranked-shape item (keyword nested under keyword_data)', () => {
    const item = {
      keyword_data: {
        keyword: 'hvac installation austin',
        keyword_info: { search_volume: 90, cpc: 6.2 },
        keyword_properties: { keyword_difficulty: 55 },
      },
      ranked_serp_element: { serp_item: { rank_group: 4 } },
    };

    const candidate = normalizeKeywordItem(item, 'ranked_keywords', 'evr_2');

    expect(candidate).toEqual({
      keyword: 'hvac installation austin',
      source: 'ranked_keywords',
      metrics: { searchVolume: 90, cpcUsd: 6.2, difficulty: 55 },
      evidenceRefs: ['evr_2'],
    });
  });

  it('leaves every metric null (never 0) when all metric fields are absent', () => {
    const item = { keyword: 'heating repair' };

    const candidate = normalizeKeywordItem(item, 'keyword_ideas', 'evr_3');

    expect(candidate).toEqual({
      keyword: 'heating repair',
      source: 'keyword_ideas',
      metrics: { searchVolume: null, cpcUsd: null, difficulty: null },
      evidenceRefs: ['evr_3'],
    });
  });

  it('returns null when the item has no keyword at all', () => {
    expect(normalizeKeywordItem({ keyword_info: { search_volume: 100 } }, 'keyword_ideas', 'evr_4')).toBeNull();
    expect(normalizeKeywordItem({ keyword_data: {} }, 'keyword_ideas', 'evr_5')).toBeNull();
    expect(normalizeKeywordItem(null, 'keyword_ideas', 'evr_6')).toBeNull();
    expect(normalizeKeywordItem(undefined, 'keyword_ideas', 'evr_7')).toBeNull();
  });

  it('treats a non-number search_volume/cpc/keyword_difficulty as absent (null), not coerced', () => {
    const item = {
      keyword: 'plumber austin',
      keyword_info: { search_volume: '100', cpc: null },
      keyword_properties: { keyword_difficulty: undefined },
    };

    const candidate = normalizeKeywordItem(item, 'keyword_ideas', 'evr_8');

    expect(candidate?.metrics).toEqual({ searchVolume: null, cpcUsd: null, difficulty: null });
  });
});
