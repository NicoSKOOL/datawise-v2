import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Link } from 'react-router-dom';
import type { DashboardSummary } from '@/types/rank-tracking';
import type { GSCOverviewData, IndexationData } from '@/lib/gsc';

interface DashboardKPICardsProps {
  summary: DashboardSummary;
  gscOverview: GSCOverviewData | null;
  indexation: IndexationData | null;
}

// Week-over-week delta from the daily trend the dashboard already fetches
// (30 daily points): sum of the last 7 days vs the 7 days before that.
// Keeping this client-side keeps the whole redesign frontend-only.
function weekOverWeek(
  trend: Array<{ date: string; clicks: number; impressions: number }>,
  key: 'clicks' | 'impressions',
): number | null {
  if (!trend || trend.length < 14) return null;
  const sorted = [...trend].sort((a, b) => a.date.localeCompare(b.date));
  const last7 = sorted.slice(-7).reduce((s, d) => s + (d[key] || 0), 0);
  const prior7 = sorted.slice(-14, -7).reduce((s, d) => s + (d[key] || 0), 0);
  if (prior7 === 0) return last7 > 0 ? 100 : null;
  return Math.round(((last7 - prior7) / prior7) * 100);
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  if (pct === 0) {
    return (
      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5">
        <Minus className="h-3 w-3" />
      </span>
    );
  }
  const good = pct > 0;
  return (
    <span
      className={`text-xs font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ${
        good ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
      }`}
    >
      {good ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

function Sparkline({
  trend,
  dataKey,
}: {
  trend: Array<{ date: string; clicks: number; impressions: number }>;
  dataKey: 'clicks' | 'impressions';
}) {
  if (!trend || trend.length < 2) return <div className="h-9" />;
  const data = [...trend].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="h-9">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke="#005232"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function DashboardKPICards({ gscOverview, indexation }: DashboardKPICardsProps) {
  // GSC-only command center: every card is real Search Console data, trended.
  const trend = gscOverview?.daily_trend || [];
  const clicks30 = gscOverview?.summary.last_30_days.total_clicks || 0;
  const impr30 = gscOverview?.summary.last_30_days.total_impressions || 0;
  const strikingDistance = gscOverview?.query_summary.striking_distance ?? 0;

  const indexedPct =
    indexation && indexation.indexed_pct != null && indexation.status !== 'needs_sync'
      ? indexation.indexed_pct
      : null;

  const cards = [
    {
      label: 'Clicks (30d)',
      value: fmt(clicks30),
      badge: <PctBadge pct={weekOverWeek(trend, 'clicks')} />,
      sub: 'last 7d vs prior 7d',
      spark: 'clicks' as const,
      to: '/rank-tracking',
    },
    {
      label: 'Impressions (30d)',
      value: fmt(impr30),
      badge: <PctBadge pct={weekOverWeek(trend, 'impressions')} />,
      sub: 'last 7d vs prior 7d',
      spark: 'impressions' as const,
      to: '/rank-tracking',
    },
    {
      label: 'Striking distance',
      value: strikingDistance.toLocaleString(),
      badge: null as React.ReactNode,
      sub: 'queries at positions 4 to 15',
      spark: null,
      to: '/keyword-research',
    },
    {
      label: 'Indexed pages',
      value: indexedPct != null ? `${indexedPct}%` : '--',
      badge: null as React.ReactNode,
      sub: 'search-visible coverage',
      spark: null,
      to: '/rank-tracking',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Link
          key={card.label}
          to={card.to}
          className="bg-white p-5 rounded-xl shadow-[0_1px_4px_rgba(24,28,32,0.06)] space-y-1.5 block transition-all hover:shadow-md"
        >
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{card.label}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{card.value}</span>
            {card.badge}
          </div>
          {card.spark && <Sparkline trend={trend} dataKey={card.spark} />}
          <p className="text-[11px] text-muted-foreground">{card.sub}</p>
        </Link>
      ))}
    </div>
  );
}
