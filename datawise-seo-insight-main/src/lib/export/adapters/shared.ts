import type { ReportSection } from '../types';

/** Hard cap on exported table size to keep PDFs and DOCX files manageable. */
export const MAX_TABLE_ROWS = 500;

/**
 * Build a table section capped at MAX_TABLE_ROWS rows. When the input is
 * larger, a callout follows the table explaining how many rows were omitted.
 */
export function cappedTable(
  headers: string[],
  rows: Array<Array<string | number>>,
  caption?: string
): ReportSection[] {
  if (rows.length <= MAX_TABLE_ROWS) {
    return [{ type: 'table', headers, rows, caption }];
  }
  const omitted = rows.length - MAX_TABLE_ROWS;
  return [
    { type: 'table', headers, rows: rows.slice(0, MAX_TABLE_ROWS), caption },
    {
      type: 'callout',
      tone: 'info',
      text: `Showing the first ${MAX_TABLE_ROWS} rows. ${omitted} ${omitted === 1 ? 'row was' : 'rows were'} omitted from this export.`,
    },
  ];
}

/** Truncate long free text for table cells and excerpts. */
export function excerpt(text: string | null | undefined, max = 300): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
