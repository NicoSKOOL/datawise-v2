import type { ReportPayload, ReportSection } from '../types';
import { cappedTable } from './shared';

export type KeywordTableCell = string | number | null | undefined;

export type KeywordTableRow = Record<string, KeywordTableCell>;

interface Args {
  /** Report title prefix, for example "Keyword Overview". */
  surface: string;
  /** Seed keyword or analyzed domain. */
  seed: string;
  /** Human-readable location or context label, used as the subtitle. */
  location?: string;
  rows: KeywordTableRow[];
  kpis?: Array<{ label: string; value: string }>;
  description?: string;
}

function prettyHeader(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

/**
 * Generic keyword table report: a KPI strip plus a single capped table whose
 * columns are derived from the first row. Reused by every keyword surface
 * that renders a flat metrics table.
 */
export function buildKeywordTableReport({
  surface,
  seed,
  location,
  rows,
  kpis,
  description,
}: Args): ReportPayload {
  const sections: ReportSection[] = [];

  if (description) {
    sections.push({ type: 'paragraph', text: description });
  }

  if (kpis && kpis.length > 0) {
    sections.push({
      type: 'kpi-grid',
      items: kpis.map((k) => ({ label: k.label, value: k.value })),
    });
  }

  if (rows.length === 0) {
    sections.push({ type: 'paragraph', text: 'No keyword data to export yet.' });
  } else {
    const headers = Object.keys(rows[0]);
    sections.push(
      ...cappedTable(
        headers.map(prettyHeader),
        rows.map((r) => headers.map((h) => (r[h] == null || r[h] === '' ? '--' : (r[h] as string | number))))
      )
    );
  }

  return {
    title: `${surface}: ${seed}`,
    subtitle: location,
    generatedAt: new Date(),
    sections,
  };
}
