import assert from 'node:assert/strict';
import {
  buildPlannerItem,
  getKeywordRowKey,
  getSelectedPlannerItems,
  toggleSelectedKeyword,
} from '../src/lib/planner-keyword-selection';

const keywordRow = {
  keyword: '  SEO Tools  ',
  search_volume: '1200',
  keyword_difficulty: 38,
  cpc: '4.5',
  competition: null,
  competition_level: 'LOW',
};

assert.equal(getKeywordRowKey(keywordRow, 0), 'seo tools');

const selected = toggleSelectedKeyword(new Set<string>(), 'seo tools', true);
assert.deepEqual(Array.from(selected), ['seo tools']);
assert.equal(toggleSelectedKeyword(selected, 'seo tools', false).size, 0);

assert.deepEqual(
  buildPlannerItem(keywordRow, {
    source: 'related-keywords',
    intent: 'commercial',
    sourceContext: { seed_keyword: 'seo' },
  }),
  {
    keyword: 'seo tools',
    intent: 'commercial',
    source: 'related-keywords',
    search_volume: 1200,
    keyword_difficulty: 38,
    cpc: 4.5,
    competition: null,
    source_context: {
      seed_keyword: 'seo',
      result: keywordRow,
    },
  },
);

assert.equal(
  buildPlannerItem({ keyword: '   ' }, { source: 'keyword-overview' }),
  null,
);

assert.deepEqual(
  getSelectedPlannerItems(
    [
      keywordRow,
      { keyword: 'Content Planning', search_volume: 90 },
      { keyword: '' },
    ],
    new Set(['seo tools', 'content planning']),
    { source: 'keyword-suggestions' },
  ).map((item) => item.keyword),
  ['seo tools', 'content planning'],
);
