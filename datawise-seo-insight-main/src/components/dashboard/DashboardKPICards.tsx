import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import type { DashboardSummary } from '@/types/rank-tracking';
import type { GSCOverviewData } from '@/lib/gsc';

interface DashboardKPICardsProps {
  summary: DashboardSummary;
  gscOverview: GSCOverviewData | null;
}

function DeltaBadge({ current, previous, invert = false }: { current: number | null; previous: number | null; invert?: boolean }) {
  if (current == null || previous == null) {
    return null;
  }

  const diff = current - previous;
  if (diff === 0) {
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" /></span>;
  }

  const isGood = invert ? diff < 0 : diff > 0;

  if (isGood) {
    return (
      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 inline-flex items-center gap-0.5">
        <ArrowUp className="h-3 w-3" />{Math.abs(diff)}
      </span>
    );
  }

  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 inline-flex items-center gap-0.5">
      <ArrowDown className="h-3 w-3" />{Math.abs(diff)}
    </span>
  );
}

export default function DashboardKPICards({ summary, gscOverview }: DashboardKPICardsProps) {
  const top10Count = summary.distribution.top3 + summary.distribution.top10;
  const gscClicks = gscOverview?.summary.last_30_days.total_clicks || 0;

  const cards = [
    {
      label: 'Total Keywords',
      value: summary.total_keywords.toLocaleString(),
      delta: null as React.ReactNode,
    },
    {
      label: 'Avg Position',
      value: summary.avg_position != null ? String(summary.avg_position) : '--',
      delta: null as React.ReactNode,
    },
    {
      label: 'GSC Clicks (30d)',
      value: gscClicks > 1000 ? `${(gscClicks / 1000).toFixed(1)}k` : String(gscClicks),
      delta: null as React.ReactNode,
    },
    {
      label: 'Top 10 Keywords',
      value: String(top10Count),
      delta: null as React.ReactNode,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white p-5 rounded-xl shadow-[0_1px_4px_rgba(24,28,32,0.06)] space-y-1.5"
        >
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{card.value}</span>
            {card.delta}
          </div>
        </div>
      ))}
    </div>
  );
}
