import { describe, it, expect } from 'vitest';
import { aggregateOwnRankedUrls } from './site-pages';

// Fixture-shaped ranked_keywords item: the ranking URL + rank live at
// ranked_serp_element.serp_item, exactly as competitors.ts reads them.
function item(url: string | undefined, rankGroup?: number): any {
  return { ranked_serp_element: { serp_item: { url, rank_group: rankGroup } } };
}

describe('aggregateOwnRankedUrls', () => {
  it('folds many keyword items into distinct page URLs with best rank + keyword count', () => {
    const out = aggregateOwnRankedUrls(
      [
        item('https://acme.com/drains', 5),
        item('https://acme.com/drains', 2), // same URL, better rank
        item('https://acme.com/drains', 8),
        item('https://acme.com/repair', 3),
      ],
      500
    );
    expect(out).toEqual([
      { url: 'https://acme.com/drains', bestRank: 2, keywordCount: 3 },
      { url: 'https://acme.com/repair', bestRank: 3, keywordCount: 1 },
    ]);
  });

  it('orders by keyword count desc, then best rank asc (nulls last), then url asc', () => {
    const out = aggregateOwnRankedUrls(
      [
        item('https://acme.com/b', 10),
        item('https://acme.com/b', 10), // /b: count 2
        item('https://acme.com/a', 1), // /a: count 1, rank 1
        item('https://acme.com/c', undefined), // /c: count 1, rank null
      ],
      500
    );
    expect(out.map((u) => u.url)).toEqual(['https://acme.com/b', 'https://acme.com/a', 'https://acme.com/c']);
    expect(out[2]).toEqual({ url: 'https://acme.com/c', bestRank: null, keywordCount: 1 });
  });

  it('caps the distinct-URL result at maxUrls, keeping the highest-priority URLs', () => {
    const items = Array.from({ length: 10 }, (_, i) => item(`https://acme.com/p${i}`, i + 1));
    const out = aggregateOwnRankedUrls(items, 3);
    expect(out).toHaveLength(3);
    // Each URL has count 1, so the tiebreak is best rank asc: p0 (rank 1) first.
    expect(out.map((u) => u.url)).toEqual(['https://acme.com/p0', 'https://acme.com/p1', 'https://acme.com/p2']);
  });

  it('returns an empty list for an empty response', () => {
    expect(aggregateOwnRankedUrls([], 500)).toEqual([]);
  });

  it('degrades gracefully on malformed items (missing url / missing serp_item), never throwing', () => {
    const out = aggregateOwnRankedUrls(
      [
        item(undefined, 3), // no url
        { ranked_serp_element: {} }, // no serp_item
        {}, // nothing
        null, // not an object
        item('https://acme.com/ok', 4), // the one good item
      ],
      500
    );
    expect(out).toEqual([{ url: 'https://acme.com/ok', bestRank: 4, keywordCount: 1 }]);
  });
});
