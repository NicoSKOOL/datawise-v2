import type { ReportPayload, ReportSection } from '../types';
import type {
  Project,
  ProjectReport,
  TrackedKeyword,
  PeriodSnapshot,
} from '@/types/rank-tracking';

interface Args {
  project: Project;
  report: ProjectReport | null;
  keywords: TrackedKeyword[];
  charts?: {
    distributionPng?: string | null;
    trendPng?: string | null;
  };
  periodLabel?: string;
}

export function buildRankTrackingReport({
  project,
  report,
  keywords,
  charts,
  periodLabel,
}: Args): ReportPayload {
  const sections: ReportSection[] = [];

  if (report) {
    sections.push({
      type: 'kpi-grid',
      items: kpiItems(report.current, report.previous),
    });
    sections.push({
      type: 'kpi-grid',
      items: [
        {
          label: 'Improved',
          value: String(report.current.improved),
          tone: 'up',
        },
        {
          label: 'Declined',
          value: String(report.current.declined),
          tone: 'down',
        },
        {
          label: 'Stable',
          value: String(report.current.stable),
          tone: 'neutral',
        },
      ],
    });
  }

  if (charts?.distributionPng) {
    sections.push({ type: 'heading', level: 2, text: 'Rank Distribution' });
    sections.push({
      type: 'chart',
      pngDataUrl: charts.distributionPng,
      caption: 'Distribution of tracked keywords across ranking buckets',
    });
  }

  if (charts?.trendPng) {
    sections.push({ type: 'heading', level: 2, text: 'Position Trend' });
    sections.push({
      type: 'chart',
      pngDataUrl: charts.trendPng,
      caption: 'Average position and bucket counts over the selected period',
    });
  }

  const movers = topMovers(keywords);
  if (movers.length) {
    sections.push({ type: 'heading', level: 2, text: 'Top Movers' });
    sections.push({
      type: 'table',
      headers: ['Keyword', 'Previous', 'Current', 'Change'],
      rows: movers.map((k) => [
        k.keyword,
        k.prev_position == null ? '—' : k.prev_position,
        k.position == null ? '—' : k.position,
        formatChange(k),
      ]),
    });
  }

  sections.push({ type: 'heading', level: 2, text: 'All Tracked Keywords' });
  sections.push({
    type: 'table',
    headers: ['Keyword', 'Position', 'Change', 'Est. Traffic', 'Checked'],
    rows: keywords.map((k) => [
      k.keyword,
      k.position == null ? '—' : k.position,
      formatChange(k),
      k.estimated_traffic == null ? '—' : Math.round(k.estimated_traffic).toLocaleString(),
      k.checked_at ? new Date(k.checked_at).toLocaleDateString() : '—',
    ]),
  });

  const dateRange =
    report?.trend && report.trend.length > 1
      ? {
          from: formatDate(report.trend[0].date),
          to: formatDate(report.trend[report.trend.length - 1].date),
        }
      : undefined;

  return {
    title: `Rank Tracking Report: ${project.name}`,
    subtitle: periodLabel ? `${project.domain}  ·  ${periodLabel}` : project.domain,
    domain: project.domain,
    dateRange,
    generatedAt: new Date(),
    sections,
  };
}

function kpiItems(
  current: PeriodSnapshot,
  previous: PeriodSnapshot
): Array<{
  label: string;
  value: string;
  delta?: string;
  tone?: 'up' | 'down' | 'neutral';
}> {
  return [
    {
      label: 'Total Keywords',
      value: String(current.total_keywords),
      delta: deltaText(current.total_keywords - previous.total_keywords),
      tone: tone(current.total_keywords - previous.total_keywords, false),
    },
    {
      label: 'Ranking',
      value: String(current.ranking_keywords),
      delta: deltaText(current.ranking_keywords - previous.ranking_keywords),
      tone: tone(current.ranking_keywords - previous.ranking_keywords, false),
    },
    {
      label: 'Avg Position',
      value:
        current.avg_position == null
          ? '—'
          : current.avg_position.toFixed(1),
      delta: positionDelta(current.avg_position, previous.avg_position),
      tone: positionTone(current.avg_position, previous.avg_position),
    },
    {
      label: 'Est. Traffic',
      value: Math.round(current.estimated_traffic).toLocaleString(),
      delta: deltaText(
        Math.round(current.estimated_traffic - previous.estimated_traffic)
      ),
      tone: tone(current.estimated_traffic - previous.estimated_traffic, false),
    },
  ];
}

function topMovers(keywords: TrackedKeyword[]): TrackedKeyword[] {
  return [...keywords]
    .filter((k) => k.position != null && k.prev_position != null)
    .sort((a, b) => {
      const da = Math.abs((a.prev_position ?? 0) - (a.position ?? 0));
      const db = Math.abs((b.prev_position ?? 0) - (b.position ?? 0));
      return db - da;
    })
    .slice(0, 10);
}

function formatChange(k: TrackedKeyword): string {
  if (k.position == null || k.prev_position == null) return '—';
  const diff = k.prev_position - k.position; // positive = moved up
  if (diff === 0) return '0';
  return diff > 0 ? `▲ ${diff}` : `▼ ${Math.abs(diff)}`;
}

function deltaText(diff: number): string | undefined {
  if (diff === 0) return undefined;
  return diff > 0 ? `+${diff}` : `${diff}`;
}

function tone(diff: number, lowerIsBetter: boolean): 'up' | 'down' | 'neutral' {
  if (diff === 0) return 'neutral';
  if (lowerIsBetter) return diff < 0 ? 'up' : 'down';
  return diff > 0 ? 'up' : 'down';
}

function positionDelta(
  current: number | null,
  previous: number | null
): string | undefined {
  if (current == null || previous == null) return undefined;
  const diff = previous - current; // positive = moved up
  if (diff === 0) return undefined;
  return diff > 0 ? `▲ ${diff.toFixed(1)}` : `▼ ${Math.abs(diff).toFixed(1)}`;
}

function positionTone(
  current: number | null,
  previous: number | null
): 'up' | 'down' | 'neutral' {
  if (current == null || previous == null) return 'neutral';
  const diff = previous - current;
  if (diff === 0) return 'neutral';
  return diff > 0 ? 'up' : 'down';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
