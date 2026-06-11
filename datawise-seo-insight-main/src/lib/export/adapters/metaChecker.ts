import type { ReportPayload, ReportSection } from '../types';
import type { ClassifiedRow, IssueGroup } from '@/lib/meta-checker';
import { cappedTable, excerpt } from './shared';

interface Args {
  rows: ClassifiedRow[];
  groups: IssueGroup[];
  siteLabel?: string;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'missing':
      return 'Missing';
    case 'too_long':
      return 'Too long';
    case 'too_short':
      return 'Too short';
    case 'duplicate':
      return 'Duplicate';
    default:
      return status;
  }
}

export function buildMetaCheckerReport({ rows, groups, siteLabel }: Args): ReportPayload {
  const sections: ReportSection[] = [];

  const titleIssues = rows.filter((r) => r.title_status !== 'ok').length;
  const descIssues = rows.filter((r) => r.description_status !== 'ok').length;
  const cleanPages = rows.filter((r) => !r.has_issue).length;

  sections.push({
    type: 'paragraph',
    text: `We checked the title tag and meta description of ${rows.length} URL${rows.length === 1 ? '' : 's'}. Titles should stay between 30 and 60 characters and descriptions between 70 and 160 characters to avoid truncation in search results.`,
  });

  sections.push({
    type: 'kpi-grid',
    items: [
      { label: 'URLs Checked', value: String(rows.length) },
      { label: 'Title Issues', value: String(titleIssues), tone: titleIssues > 0 ? 'down' : 'up' },
      { label: 'Description Issues', value: String(descIssues), tone: descIssues > 0 ? 'down' : 'up' },
      { label: 'Clean Pages', value: String(cleanPages), tone: 'up' },
    ],
  });

  // --- One table per issue group ---
  if (groups.length > 0) {
    sections.push({ type: 'heading', level: 2, text: 'Issues to Fix' });
    for (const group of groups) {
      sections.push({ type: 'heading', level: 3, text: group.title });
      sections.push({ type: 'paragraph', text: group.how_to_fix });
      const isTitleGroup = group.key.includes('title');
      sections.push(
        ...cappedTable(
          ['URL', isTitleGroup ? 'Current Title' : 'Current Description', 'Length'],
          group.rows.map((r) => [
            r.url,
            excerpt(isTitleGroup ? r.title : r.description, 180) || '(none)',
            (isTitleGroup ? r.title_length : r.description_length) ?? 0,
          ])
        )
      );
    }
  } else {
    sections.push({
      type: 'callout',
      tone: 'success',
      text: 'No title or meta description issues were found in the checked URLs.',
    });
  }

  // --- Full results table ---
  sections.push({ type: 'heading', level: 2, text: 'All Results' });
  sections.push(
    ...cappedTable(
      ['URL', 'Title Status', 'Title Length', 'Description Status', 'Description Length'],
      rows.map((r) => [
        r.url,
        statusLabel(r.title_status),
        r.title_length ?? 0,
        statusLabel(r.description_status),
        r.description_length ?? 0,
      ])
    )
  );

  return {
    title: 'Meta Tags Report',
    subtitle: siteLabel ? `${siteLabel}: ${rows.length} URLs checked` : `${rows.length} URLs checked`,
    domain: siteLabel,
    generatedAt: new Date(),
    sections,
  };
}
