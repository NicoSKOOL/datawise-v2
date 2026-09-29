import { escapeCsv } from '@/lib/serp-analysis-csv';
import type { BacklinkItem, ReferringDomainItem } from '@/lib/backlinks';

// Generic "rows to CSV" plus the column sets for the Backlinks tabs and the
// Rank Tracking Page 2 list (feature requests 61154434 and 545e93e7).

export interface CsvColumn<T> {
  label: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

export function rowsToCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => escapeCsv(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => escapeCsv(c.value(row))).join(','));
  return lines.join('\n');
}

const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');

export const BACKLINK_CSV_COLUMNS: CsvColumn<BacklinkItem>[] = [
  { label: 'Source domain', value: (r) => r.domain_from },
  { label: 'Source URL', value: (r) => r.url_from },
  { label: 'Source page title', value: (r) => r.page_from_title },
  { label: 'Anchor', value: (r) => r.anchor },
  { label: 'Links to', value: (r) => r.url_to },
  { label: 'Dofollow', value: (r) => (r.dofollow == null ? '' : r.dofollow ? 'Yes' : 'No') },
  { label: 'Domain rank', value: (r) => r.domain_from_rank },
  { label: 'Page rank', value: (r) => r.page_from_rank },
  { label: 'Spam score', value: (r) => r.backlink_spam_score },
  { label: 'First seen', value: (r) => day(r.first_seen) },
  { label: 'Last seen', value: (r) => day(r.last_seen) },
];

export const REFERRING_DOMAIN_CSV_COLUMNS: CsvColumn<ReferringDomainItem>[] = [
  { label: 'Domain', value: (r) => r.domain },
  { label: 'Domain rank', value: (r) => r.rank },
  { label: 'Backlinks', value: (r) => r.backlinks },
  { label: 'Referring pages', value: (r) => r.referring_pages },
  { label: 'Spam score', value: (r) => r.backlinks_spam_score },
  { label: 'First seen', value: (r) => day(r.first_seen) },
];

export function csvFilename(...parts: Array<string | null | undefined>): string {
  const slug = parts
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'export'}-${new Date().toISOString().slice(0, 10)}.csv`;
}

// Search Console rows from /gsc/queries. 'pages' mode is the Page 2 list.
export function gscRowColumns(mode: 'queries' | 'pages'): CsvColumn<GscCsvRow>[] {
  const lead: CsvColumn<GscCsvRow>[] = mode === 'pages'
    ? [{ label: 'Page', value: (r) => r.page }, { label: 'Queries', value: (r) => r.query_count }]
    : [{ label: 'Query', value: (r) => r.query }];
  return [
    ...lead,
    { label: 'Clicks', value: (r) => r.clicks },
    { label: 'Impressions', value: (r) => r.impressions },
    { label: 'Avg position', value: (r) => r.avg_position },
    { label: 'CTR %', value: (r) => (r.avg_ctr == null ? '' : Math.round(r.avg_ctr * 10000) / 100) },
  ];
}

export interface GscCsvRow {
  query?: string;
  page?: string;
  clicks: number;
  impressions: number;
  avg_position: number;
  avg_ctr: number;
  query_count?: number;
}
