import { describe, it, expect } from 'vitest';
import {
  zoomForRadius,
  ratingDistributionFallback,
  buildSnapshot,
  shouldWriteSnapshot,
  aggregateGeogridCompetitors,
  computeReviewsHash,
  computeVelocity,
  pickBaselineCount,
  reviewVelocityFromSamples,
  withUserRowFacts,
  validateReviewThemes,
  extractJsonObject,
  type GeoGridPointResult,
} from './local-reviews-analysis';

describe('zoomForRadius', () => {
  // Calibrated live 2026-09-25 at 53N (Nottingham): the east edge dropped out
  // at 5km/13z and 10km/12z because desktop Maps hides whatever sits under the
  // left results panel. One zoom out brought every edge point back.
  it('zooms out at UK latitudes so the east edge stays clear of the panel', () => {
    expect(zoomForRadius(5, 52.97)).toBe('12z');
    expect(zoomForRadius(10, 52.97)).toBe('11z');
    expect(zoomForRadius(2.5, 52.97)).toBe('13z');
  });
  it('keeps the zoom that already worked at UK latitudes', () => {
    expect(zoomForRadius(3, 52.97)).toBe('13z');
  });
  it('matches the old radius buckets at US latitudes', () => {
    expect(zoomForRadius(1, 35)).toBe('15z');
    expect(zoomForRadius(2.5, 35)).toBe('14z');
    expect(zoomForRadius(5, 35)).toBe('13z');
    expect(zoomForRadius(10, 35)).toBe('12z');
  });
  it('never goes tighter than 15z or wider than 10z', () => {
    expect(zoomForRadius(0.5, 0)).toBe('15z');
    expect(zoomForRadius(20, 70)).toBe('10z');
  });
  it('falls back to the equator when latitude is missing or invalid', () => {
    expect(zoomForRadius(5, Number.NaN)).toBe(zoomForRadius(5, 0));
  });
});

describe('ratingDistributionFallback', () => {
  it('counts reviews per star and ignores null ratings', () => {
    const dist = ratingDistributionFallback([
      { rating: 5, owner_response: null }, { rating: 5, owner_response: 'thanks' },
      { rating: 3, owner_response: null }, { rating: 1, owner_response: null },
      { rating: null, owner_response: null },
    ]);
    expect(dist).toEqual({ '5': 2, '4': 0, '3': 1, '2': 0, '1': 1 });
  });
  it('clamps fractional ratings into 1-5', () => {
    expect(ratingDistributionFallback([{ rating: 4.6, owner_response: null }])['5']).toBe(1);
  });
});

describe('buildSnapshot', () => {
  const reviews = [
    { rating: 5, owner_response: 'thanks' },
    { rating: 2, owner_response: null },
    { rating: 3, owner_response: null },
    { rating: 4, owner_response: null },
  ];
  it('computes response rate and unanswered low-star count', () => {
    const snap = buildSnapshot({ rating: 4.2, reviews_count: 120, reviews, rating_distribution: null });
    expect(snap.fetched_count).toBe(4);
    expect(snap.responded_count).toBe(1);
    expect(snap.response_rate).toBe(25);
    expect(snap.unanswered_low_star).toBe(2);
    expect(JSON.parse(snap.rating_distribution)).toEqual({ '5': 1, '4': 1, '3': 1, '2': 1, '1': 0 });
  });
  it('prefers a provided rating_distribution over the fallback', () => {
    const snap = buildSnapshot({ rating: 4.2, reviews_count: 120, reviews, rating_distribution: { '5': 90, '4': 20, '3': 5, '2': 3, '1': 2 } });
    expect(JSON.parse(snap.rating_distribution)['5']).toBe(90);
  });
  it('handles zero reviews without dividing by zero', () => {
    const snap = buildSnapshot({ rating: null, reviews_count: 0, reviews: [], rating_distribution: null });
    expect(snap.response_rate).toBe(0);
    expect(snap.unanswered_low_star).toBe(0);
  });
});

describe('shouldWriteSnapshot', () => {
  const now = new Date('2026-06-10T15:00:00Z');
  it('writes when there is no previous snapshot', () => {
    expect(shouldWriteSnapshot(null, now)).toBe(true);
  });
  it('skips when the last snapshot is from the same UTC day', () => {
    expect(shouldWriteSnapshot('2026-06-10 02:11:00', now)).toBe(false);
  });
  it('writes when the last snapshot is from a previous day', () => {
    expect(shouldWriteSnapshot('2026-06-09 23:59:00', now)).toBe(true);
  });
});

describe('aggregateGeogridCompetitors', () => {
  const comp = (title: string, position: number, rating = 4.5, reviews = 100) =>
    ({ title, rating, reviews, position });
  const points: GeoGridPointResult[] = [
    { position: 1, top_competitors: [comp('Rival A', 2), comp('Rival B', 3)] },
    { position: 4, top_competitors: [comp('Rival A', 1), comp('Rival B', 2), comp('Rival C', 3)] },
    { position: null, top_competitors: [comp('Rival A', 1), comp('Rival C', 2)] },
  ];
  it('aggregates appearances, avg and best position per competitor', () => {
    const out = aggregateGeogridCompetitors(points, 'My Shop');
    const rivalA = out.find(c => c.name === 'Rival A')!;
    expect(rivalA.appearances).toBe(3);
    expect(rivalA.total_points).toBe(3);
    expect(rivalA.avg_position).toBeCloseTo(1.3, 1);
    expect(rivalA.best_position).toBe(1);
    expect(rivalA.rating).toBe(4.5);
    expect(rivalA.is_user).toBe(false);
  });
  it('synthesizes the user business from per-point positions', () => {
    const out = aggregateGeogridCompetitors(points, 'My Shop');
    const own = out.find(c => c.is_user)!;
    expect(own.name).toBe('My Shop');
    expect(own.appearances).toBe(1); // top 3 share: only the position-1 point
    expect(own.best_position).toBe(1);
  });
  it('averages the user position over every found point, like the scan summary', () => {
    const own = aggregateGeogridCompetitors(points, 'My Shop').find(c => c.is_user)!;
    expect(own.avg_position).toBe(2.5); // (1 + 4) / 2, not top-3 only
  });
  it('fills the user rating and reviews when provided', () => {
    const own = aggregateGeogridCompetitors(points, 'My Shop', { rating: 5, reviews: 141 }).find(c => c.is_user)!;
    expect(own.rating).toBe(5);
    expect(own.reviews).toBe(141);
    const bare = aggregateGeogridCompetitors(points, 'My Shop').find(c => c.is_user)!;
    expect(bare.rating).toBeNull();
    expect(bare.reviews).toBeNull();
  });
  it('omits the user entry when never in top 3 or no name given', () => {
    expect(aggregateGeogridCompetitors(points, null).some(c => c.is_user)).toBe(false);
    const noTop3: GeoGridPointResult[] = [{ position: 7, top_competitors: [comp('Rival A', 1)] }];
    expect(aggregateGeogridCompetitors(noTop3, 'My Shop').some(c => c.is_user)).toBe(false);
  });
  it('caps the list at 10, sorted by appearances', () => {
    const many: GeoGridPointResult[] = [{
      position: null,
      top_competitors: Array.from({ length: 15 }, (_, i) => comp(`Biz ${i}`, (i % 3) + 1)),
    }];
    const out = aggregateGeogridCompetitors(many, null);
    expect(out.length).toBe(10);
  });
  it('skips competitors with empty titles', () => {
    const out = aggregateGeogridCompetitors([{ position: null, top_competitors: [comp('', 1), comp('Real', 2)] }], null);
    expect(out.map(c => c.name)).toEqual(['Real']);
  });
});

describe('computeReviewsHash', () => {
  const reviews = [
    { date: '2026-06-01T10:00:00Z', text: 'Great service' },
    { date: '2026-05-20T08:00:00Z', text: 'Slow response' },
  ];
  it('is deterministic', async () => {
    expect(await computeReviewsHash(reviews)).toBe(await computeReviewsHash(reviews));
  });
  it('changes when a review text changes', async () => {
    const edited = [reviews[0], { ...reviews[1], text: 'Slow response!!' }];
    expect(await computeReviewsHash(edited)).not.toBe(await computeReviewsHash(reviews));
  });
  it('returns a 64-char hex string', async () => {
    expect(await computeReviewsHash(reviews)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeVelocity', () => {
  it('computes current and previous period gains', () => {
    expect(computeVelocity({ currentCount: 120, startOfPeriodCount: 110, startOfPreviousPeriodCount: 95 }))
      .toEqual({ current: 10, previous: 15 });
  });
  it('returns nulls when baselines are missing', () => {
    expect(computeVelocity({ currentCount: 120, startOfPeriodCount: null, startOfPreviousPeriodCount: null }))
      .toEqual({ current: null, previous: null });
    expect(computeVelocity({ currentCount: 120, startOfPeriodCount: 110, startOfPreviousPeriodCount: null }))
      .toEqual({ current: 10, previous: null });
  });
});

describe('validateReviewThemes', () => {
  const valid = {
    summary: 'Customers love the staff but mention slow scheduling.',
    themes: [
      { theme: 'Friendly staff', sentiment: 'positive', mention_count: 4, quotes: ['so friendly'], review_indexes: [0, 2] },
      { theme: 'Scheduling delays', sentiment: 'negative', mention_count: 2, quotes: ['took weeks', 'never called back', 'extra'], review_indexes: [1, 99] },
    ],
  };
  it('drops out-of-range review indexes and caps quotes at 2', () => {
    const out = validateReviewThemes(valid, 5)!;
    expect(out.themes[1].review_indexes).toEqual([1]);
    expect(out.themes[1].quotes.length).toBe(2);
  });
  it('rejects non-objects and missing fields', () => {
    expect(validateReviewThemes(null, 5)).toBeNull();
    expect(validateReviewThemes('text', 5)).toBeNull();
    expect(validateReviewThemes({ summary: 'x' }, 5)).toBeNull();
    expect(validateReviewThemes({ summary: 'x', themes: [{ theme: 1, sentiment: 'positive' }] }, 5)).toBeNull();
  });
  it('normalizes neutral and unknown sentiments to mixed instead of rejecting', () => {
    const out = validateReviewThemes({
      summary: 'x',
      themes: [
        { theme: 'a', sentiment: 'neutral', mention_count: 1, quotes: [], review_indexes: [0] },
        { theme: 'b', sentiment: 'ANGRY', mention_count: 1, quotes: [], review_indexes: [0] },
        { theme: 'c', sentiment: 'Positive', mention_count: 1, quotes: [], review_indexes: [0] },
      ],
    }, 5)!;
    expect(out).not.toBeNull();
    expect(out.themes.map((t) => t.sentiment)).toEqual(['mixed', 'mixed', 'positive']);
  });
  it('keeps valid themes and drops malformed ones instead of failing the whole set', () => {
    const out = validateReviewThemes({
      summary: 'x',
      themes: [
        { theme: 'good', sentiment: 'positive', mention_count: 2, quotes: [], review_indexes: [0] },
        { theme: 123, sentiment: 'positive' },
        'not an object',
      ],
    }, 5)!;
    expect(out.themes.map((t) => t.theme)).toEqual(['good']);
  });
  it('tolerates a missing summary', () => {
    const out = validateReviewThemes({
      themes: [{ theme: 'a', sentiment: 'positive', mention_count: 1, quotes: [], review_indexes: [0] }],
    }, 5)!;
    expect(out.summary).toBe('');
    expect(out.themes.length).toBe(1);
  });
  it('returns null when no usable themes remain', () => {
    expect(validateReviewThemes({ summary: 'x', themes: [] }, 5)).toBeNull();
    expect(validateReviewThemes({ summary: 'x', themes: [{ theme: '', sentiment: 'positive' }] }, 5)).toBeNull();
  });
  it('caps at 8 themes', () => {
    const many = {
      summary: 'x',
      themes: Array.from({ length: 12 }, (_, i) => ({ theme: `t${i}`, sentiment: 'mixed', mention_count: 1, quotes: [], review_indexes: [0] })),
    };
    expect(validateReviewThemes(many, 5)!.themes.length).toBe(8);
  });
});

describe('extractJsonObject', () => {
  it('parses clean JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it('strips code fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('extracts a JSON object embedded in prose', () => {
    expect(extractJsonObject('Here is the result:\n{"a":1}\nHope that helps')).toEqual({ a: 1 });
  });
  it('tolerates trailing commas', () => {
    expect(extractJsonObject('{"a":1,"b":[1,2,],}')).toEqual({ a: 1, b: [1, 2] });
  });
  it('returns null when there is no JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

describe('pickBaselineCount', () => {
  const day = 86400000;
  const now = Date.UTC(2026, 8, 23, 13, 0, 0);
  const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString().replace('T', ' ').slice(0, 19);
  it('picks the sample closest to the target within tolerance', () => {
    const samples = [{ count: 128, at: at(34) }, { count: 130, at: at(31) }, { count: 141, at: at(0) }];
    expect(pickBaselineCount(samples, now - 30 * day, 7.5 * day)).toBe(130);
  });
  it('returns null when nothing is near the target (no stale fallback)', () => {
    const samples = [{ count: 128, at: at(34) }, { count: 141, at: at(0) }];
    expect(pickBaselineCount(samples, now - 7 * day, 2 * day)).toBeNull();
  });
  it('ignores null counts and unparseable dates', () => {
    const samples = [{ count: null, at: at(7) }, { count: 5, at: 'nope' }];
    expect(pickBaselineCount(samples, now - 7 * day, 2 * day)).toBeNull();
  });
});

describe('reviewVelocityFromSamples', () => {
  const day = 86400000;
  const now = Date.UTC(2026, 8, 23, 13, 0, 0);
  const at = (daysAgo: number) => new Date(now - daysAgo * day).toISOString().replace('T', ' ').slice(0, 19);
  // Stephen d0c90bb4 on 2026-09-23: snapshots 126 (08-10), 128 (08-20),
  // 141 (09-23); rank checks 130 (08-23), 141 (09-23).
  const stephen = [
    { count: 126, at: at(44) }, { count: 128, at: at(34) }, { count: 130, at: at(31) }, { count: 141, at: at(0) },
  ];
  it('gives the same 30-day answer to every screen', () => {
    expect(reviewVelocityFromSamples(stephen, 141, 30, now)).toEqual({ current: 11, previous: null });
  });
  it('reports no 7-day velocity instead of a 34-day delta', () => {
    expect(reviewVelocityFromSamples(stephen, 141, 7, now)).toEqual({ current: null, previous: null });
  });
  it('computes both periods when history exists', () => {
    const samples = [{ count: 100, at: at(60) }, { count: 110, at: at(30) }, { count: 125, at: at(0) }];
    expect(reviewVelocityFromSamples(samples, 125, 30, now)).toEqual({ current: 15, previous: 10 });
  });
  it('never reports negative growth from a noisy sample', () => {
    const samples = [{ count: 130, at: at(30) }];
    expect(reviewVelocityFromSamples(samples, 128, 30, now)).toEqual({ current: 0, previous: null });
  });
});

describe('withUserRowFacts', () => {
  const base = { appearances: 70, total_points: 81, best_position: 1, is_user: false } as const;
  const rows = [
    { ...base, name: 'Gutter Cleaned', avg_position: 1.5, rating: null, reviews: null, is_user: true },
    { ...base, name: 'Rival', avg_position: 2.2, rating: 4.8, reviews: 108 },
  ];
  it('aligns the stored user row with the scan summary and snapshot', () => {
    const out = withUserRowFacts(rows, { avgPosition: 1.6, rating: 5, reviews: 141 });
    expect(out[0]).toMatchObject({ avg_position: 1.6, rating: 5, reviews: 141 });
    expect(out[1]).toEqual(rows[1]);
  });
  it('keeps stored values when facts are missing', () => {
    const out = withUserRowFacts(rows, { avgPosition: null, rating: null, reviews: null });
    expect(out[0]).toMatchObject({ avg_position: 1.5, rating: null, reviews: null });
  });
});
