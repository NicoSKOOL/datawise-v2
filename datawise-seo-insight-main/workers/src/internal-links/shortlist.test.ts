import { describe, expect, it, vi } from 'vitest';
import { embed, embedBatchSize } from './shortlist';
import { locs } from './discover';

describe('embedding batches', () => {
  it('caps a batch by total characters as well as count', () => {
    const long = Array(80).fill('x'.repeat(2500));
    // Each text counts as 2,000 chars (truncated), so 45 fit under 90k.
    expect(embedBatchSize(long, 0)).toBe(45);
    expect(embedBatchSize(Array(80).fill('short'), 0)).toBe(50);
    expect(embedBatchSize(['a'], 0)).toBe(1);
  });

  it('splits a batch that still exceeds the model context and keeps order', async () => {
    const run = vi.fn(async (_m: string, { text }: { text: string[] }) => {
      if (text.length > 2) throw new Error('3030: Max context reached 73900 tokens but model supports only 60000');
      return { data: text.map((t) => [t.length, 1]) };
    });
    const out = await embed({ run }, ['a', 'bb', 'ccc', 'dddd', 'eeeee']);
    expect(out.map((v) => Math.round((v[0] / v[1]) * 10) / 10)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('sitemap locs', () => {
  it('ignores image and video entries', () => {
    const xml = '<url><loc>https://s.com/a/</loc><image:image><image:loc>https://s.com/a.jpg</image:loc></image:image></url>';
    expect(locs(xml)).toEqual(['https://s.com/a/']);
  });
});
