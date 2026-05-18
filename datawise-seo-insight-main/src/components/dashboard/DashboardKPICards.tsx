import { ArrowUp, ArrowDown, Minus, Info, MousePointerClick, Eye, Percent, Target } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Link } from 'react-router-dom';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { DashboardSummary } from '@/types/rank-tracking';
import type { GSCOverviewData, GSCRangeData } from '@/lib/gsc';

interface DashboardKPICardsProps {
  summary: DashboardSummary;
  gscOverview: GSCOverviewData | null;
  range: GSCRangeData | null;
}

type Daily = Array<{ date: string; clicks: number; impressions: number }>;

function pctChange(cur: number, prev: number | null): number | null {
  if (prev == null) return null;
  if (prev === 0) return cur > 0 ? 100 : null;
  return Math.round(((cur - prev) / prev) * 100);
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

function Sparkline({ daily, dataKey, color }: { daily: Daily; dataKey: 'clicks' | 'impressions'; color: string }) {
  if (!daily || daily.length < 2) return <div className="h-9" />;
  const data = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="h-9">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function DashboardKPICards({ gscOverview, range }: DashboardKPICardsProps) {
  // GSC-only command center: every card is real Search Console data, trended.
  // Numbers follow the dashboard time-range selector via the range block;
  // fall back to the fixed 30-day summary if the range block is absent.
  const days = range?.days ?? 30;
  const daily: Daily = range?.daily ?? gscOverview?.daily_trend ?? [];
  const clicks = range ? range.clicks : gscOverview?.summary.last_30_days.total_clicks || 0;
  const impressions = range ? range.impressions : gscOverview?.summary.last_30_days.total_impressions || 0;
  const strikingDistance = range ? range.striking_distance : gscOverview?.query_summary.striking_distance ?? 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const prevCtr =
    range && range.prev_clicks != null && range.prev_impressions != null && range.prev_impressions > 0
      ? (range.prev_clicks / range.prev_impressions) * 100
      : null;

  const periodLabel = `(${days}d)`;
  const prevSub = `vs previous ${days} days`;

  const cards = [
    {
      label: `Clicks ${periodLabel}`,
      value: fmt(clicks),
      badge: <PctBadge pct={range ? pctChange(clicks, range.prev_clicks) : null} />,
      sub: prevSub,
      spark: 'clicks' as const,
      icon: MousePointerClick,
      tint: 'bg-indigo-50 text-indigo-600',
      stroke: '#4f46e5',
      to: '/rank-tracking',
      help: `Total clicks from Google Search over the last ${days} days. The badge compares this with the previous ${days} days.`,
    },
    {
      label: `Impressions ${periodLabel}`,
      value: fmt(impressions),
      badge: <PctBadge pct={range ? pctChange(impressions, range.prev_impressions) : null} />,
      sub: prevSub,
      spark: 'impressions' as const,
      icon: Eye,
      tint: 'bg-sky-50 text-sky-600',
      stroke: '#0284c7',
      to: '/rank-tracking',
      help: `How many times your site appeared in Google Search results over the last ${days} days, compared with the previous ${days} days.`,
    },
    {
      label: `CTR ${periodLabel}`,
      value: `${ctr.toFixed(1)}%`,
      badge: <PctBadge pct={prevCtr != null ? pctChange(ctr, prevCtr) : null} />,
      sub: 'clicks ÷ impressions',
      spark: null,
      icon: Percent,
      tint: 'bg-emerald-50 text-emerald-600',
      stroke: '#059669',
      to: '/rank-tracking',
      help: `Click-through rate: clicks divided by impressions over the last ${days} days. A low CTR at decent positions usually means the page title or description needs work.`,
    },
    {
      label: 'Striking distance',
      value: strikingDistance.toLocaleString(),
      badge: null as React.ReactNode,
      sub: 'positions 11 to 20',
      spark: null,
      icon: Target,
      tint: 'bg-orange-50 text-orange-600',
      stroke: '#ea580c',
      to: '/keyword-research',
      help: 'Keywords ranking on page two (about positions 11 to 20). They already earn impressions, so they are the closest to breaking onto page one with focused on-page work.',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const CardIcon = card.icon;
        return (
          <Link
            key={card.label}
            to={card.to}
            className="group bg-white p-5 rounded-xl border border-border/60 shadow-[0_1px_4px_rgba(24,28,32,0.06)] space-y-1.5 block transition-all hover:shadow-md hover:border-primary/30"
          >
            <div className="flex items-start justify-between">
              <div className={`p-2 rounded-lg ${card.tint}`}>
                <CardIcon className="h-4 w-4" />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); }}
                    className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    aria-label={`What is ${card.label}?`}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                  {card.help}
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-1">{card.label}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{card.value}</span>
              {card.badge}
            </div>
            {card.spark && <Sparkline daily={daily} dataKey={card.spark} color={card.stroke} />}
            <p className="text-[11px] text-muted-foreground">{card.sub}</p>
          </Link>
        );
      })}
    </div>
  );
}
