import { describe, expect, it } from 'vitest';
import { rowsToCsv, gscRowColumns, BACKLINK_CSV_COLUMNS, csvFilename } from '../table-csv';
import { parseManualKeywords } from '@/components/planner/AddKeywordsManuallyDialog';

describe('rowsToCsv', () => {
  it('writes a header and escapes commas, quotes and formula prefixes', () => {
    const csv = rowsToCsv(BACKLINK_CSV_COLUMNS, [
      { domain_from: 'a.com', anchor: 'best, "cheap" plumber', dofollow: true, first_seen: '2026-01-02 10:00:00 +00:00' },
      { domain_from: 'b.com', anchor: '=HYPERLINK("x")', dofollow: false },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Source domain,Source URL,Source page title,Anchor,Links to,Dofollow,Domain rank,Page rank,Spam score,First seen,Last seen');
    expect(lines[1]).toContain('"best, ""cheap"" plumber"');
    expect(lines[1]).toContain(',Yes,');
    expect(lines[1]).toContain('2026-01-02');
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('exports Page 2 rows by page with CTR as a percent', () => {
    const csv = rowsToCsv(gscRowColumns('pages'), [
      { page: 'https://x.com/a', query_count: 12, clicks: 3, impressions: 400, avg_position: 13.2, avg_ctr: 0.0075 },
    ]);
    expect(csv.split('\n')).toEqual([
      'Page,Queries,Clicks,Impressions,Avg position,CTR %',
      'https://x.com/a,12,3,400,13.2,0.75',
    ]);
  });

  it('builds a dated, slugged filename', () => {
    expect(csvFilename('Example.com', 'gsc', 'page-2-opportunities')).toMatch(/^example.com-gsc-page-2-opportunities-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe('parseManualKeywords', () => {
  it('splits lines and commas, trims, collapses spaces and dedupes case-insensitively', () => {
    expect(parseManualKeywords(' plumber  brisbane \nPlumber Brisbane\n\nleak repair, tap fix ')).toEqual([
      'plumber brisbane',
      'leak repair',
      'tap fix',
    ]);
  });
});
