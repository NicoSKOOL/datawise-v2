import { INTENT_LABELS, STATUS_LABELS, type PlannerKeyword, type PlannerCluster } from './planner';

const CSV_HEADER = [
  'keyword',
  'intent',
  'status',
  'search_volume',
  'keyword_difficulty',
  'cpc',
  'cluster',
  'assigned_url',
  'notes',
] as const;

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function keywordsToCsv(items: PlannerKeyword[], clusters: PlannerCluster[] = []): string {
  const clusterName = new Map(clusters.map((c) => [c.id, c.name]));
  const rows: string[] = [CSV_HEADER.join(',')];
  for (const k of items) {
    rows.push([
      escapeCsv(k.keyword),
      escapeCsv(INTENT_LABELS[k.intent]),
      escapeCsv(STATUS_LABELS[k.status]),
      escapeCsv(k.search_volume),
      escapeCsv(k.keyword_difficulty),
      escapeCsv(k.cpc),
      escapeCsv(k.cluster_id ? clusterName.get(k.cluster_id) ?? '' : ''),
      escapeCsv(k.assigned_url),
      escapeCsv(k.notes),
    ].join(','));
  }
  return rows.join('\n');
}

export function keywordsToList(items: PlannerKeyword[]): string {
  return items.map((k) => k.keyword).join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cluster';
}
