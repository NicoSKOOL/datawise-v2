import { describe, expect, it } from 'vitest';
import { geogridPointPopupHtml } from '../geogrid-popup';

const base = { row: 0, col: 0, lat: 0, lng: 0 };

describe('geogridPointPopupHtml', () => {
  it('lists the full top 20 with the user highlighted', () => {
    const html = geogridPointPopupHtml({
      ...base, position: 2, total_results: 20,
      top20: [
        { title: 'Acme Plumbing', rating: 4.8, reviews: 120, position: 1 },
        { title: 'My Biz', rating: 4.5, reviews: 30, position: 2, is_you: true },
      ],
    });
    expect(html).toContain('Your position: #2');
    expect(html).toContain('Top 2 at this point');
    expect(html).toContain('My Biz (you)');
    expect(html).toContain('4.8&#9733; (120)');
  });

  it('escapes business names', () => {
    const html = geogridPointPopupHtml({
      ...base, position: null, total_results: 20,
      top20: [{ title: '<img src=x onerror=alert(1)>', rating: null, reviews: null, position: 1 }],
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('falls back to the stored top 3 on older scans', () => {
    const html = geogridPointPopupHtml({
      ...base, position: null, total_results: 12,
      top_competitors: [{ title: 'Rival', rating: 4, reviews: 9, position: 1 }],
    });
    expect(html).toContain('Not shown by Google here');
    expect(html).toContain('Top competitors at this point');
    expect(html).toContain('Re-run the scan');
  });
});
