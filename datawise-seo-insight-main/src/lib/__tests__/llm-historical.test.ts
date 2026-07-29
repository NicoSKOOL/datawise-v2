import { describe, it, expect } from 'vitest';
import { mergeHistoricalSeries } from '../llm-historical';

const pt = (year: number, month: number, mentions: number, vol: number) => ({
  year,
  month,
  metrics: { mentions, ai_search_volume: vol },
});

describe('mergeHistoricalSeries', () => {
  it('returns an empty array when every series is empty', () => {
    expect(mergeHistoricalSeries([[], null, undefined])).toEqual([]);
  });

  it('sums matching months across platforms', () => {
    const result = mergeHistoricalSeries([
      [pt(2026, 1, 5, 100)],
      [pt(2026, 1, 3, 50)],
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ month: '2026-01', mentions: 8, aiVolume: 150 });
  });

  it('sorts chronologically and fills gap months with zeros', () => {
    const result = mergeHistoricalSeries([[pt(2026, 3, 2, 20), pt(2025, 12, 1, 10)]]);
    expect(result.map((r) => r.month)).toEqual(['2025-12', '2026-01', '2026-02', '2026-03']);
    expect(result[1]).toMatchObject({ mentions: 0, aiVolume: 0 });
    expect(result[3]).toMatchObject({ mentions: 2, aiVolume: 20 });
  });

  it('treats missing metrics as zero rather than NaN', () => {
    const result = mergeHistoricalSeries([[{ year: 2026, month: 2 }]]);
    expect(result[0]).toMatchObject({ month: '2026-02', mentions: 0, aiVolume: 0 });
  });

  it('labels months for display', () => {
    const result = mergeHistoricalSeries([[pt(2026, 1, 1, 1)]]);
    expect(result[0].label).toBe('Jan 26');
  });
});
