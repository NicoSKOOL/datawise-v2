import { ArrowUp, ArrowDown, Minus, Info, MousePointerClick, Eye, Percent, Target } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Link } from 'react-router-dom';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { DashboardSummary } from '@/types/rank-tracking';
import type { GSCOverviewData } from '@/lib/gsc';

interface DashboardKPICardsProps {
  summary: DashboardSummary;
  gscOverview: GSCOverviewData | null;
}

type Trend = Array<{ date: string; clicks: number; impressions: number }>;

// Week-over-week from the daily trend the dashboard already fetches (30 daily
// points): last 7 days vs the 7 days before. Client-side keeps this frontend-only.
function sumWindow(trend: Trend, key: 'clicks' | 'impressions', from: number, to?: number) {
  const sorted = [...trend].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.slice(from, to).reduce((s, d) => s + (d[key] || 0), 0);
}

function pctChange(last: number, prior: number): number | null {
  if (prior === 0) return last > 0 ? 100 : null;
  return Math.round(((last - prior) / prior) * 100);
}

function clicksImprWoW(trend: Trend, key: 'clicks' | 'impressions'): number | null {
  if (!trend || trend.length < 14) return null;
  return pctChange(sumWindow(trend, key, -7), sumWindow(trend, key, -14, -7));
}

function ctrWoW(trend: Trend): number | null {
  if (!trend || trend.length < 14) return null;
  const lc = sumWindow(trend, 'clicks', -7);
  const li = sumWindow(trend, 'impressions', -7);
  const pc = sumWindow(trend, 'clicks', -14, -7);
  const pi = sumWindow(trend, 'impressions', -14, -7);
  if (li === 0 || pi === 0) return null;
  return pctChange(lc / li, pc / pi);
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

function Sparkline({ trend, dataKey, color }: { trend: Trend; dataKey: 'clicks' | 'impressions'; color: string }) {
  if (!trend || trend.length < 2) return <div className="h-9" />;
  const data = [...trend].sort((a, b) => a.date.localeCompare(b.date));
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

export default function DashboardKPICards({ gscOverview }: DashboardKPICardsProps) {
  // GSC-only command center: every card is real Search Console data, trended.
  const trend = gscOverview?.daily_trend || [];
  const clicks30 = gscOverview?.summary.last_30_days.total_clicks || 0;
  const impr30 = gscOverview?.summary.last_30_days.total_impressions || 0;
  const strikingDistance = gscOverview?.query_summary.striking_distance ?? 0;
  const ctr30 = impr30 > 0 ? (clicks30 / impr30) * 100 : 0;

  const cards = [
    {
      label: 'Clicks (30d)',
      value: fmt(clicks30),
      badge: <PctBadge pct={clicksImprWoW(trend, 'clicks')} />,
      sub: 'last 7d vs prior 7d',
      spark: 'clicks' as const,
      icon: MousePointerClick,
      tint: 'bg-indigo-50 text-indigo-600',
      stroke: '#4f46e5',
      to: '/rank-tracking',
      help: 'Total clicks from Google Search over the last 30 days. The badge compares the most recent 7 days with the 7 days before.',
    },
    {
      label: 'Impressions (30d)',
      value: fmt(impr30),
      badge: <PctBadge pct={clicksImprWoW(trend, 'impressions')} />,
      sub: 'last 7d vs prior 7d',
      spark: 'impressions' as const,
      icon: Eye,
      tint: 'bg-sky-50 text-sky-600',
      stroke: '#0284c7',
      to: '/rank-tracking',
      help: 'How many times your site appeared in Google Search results over the last 30 days. The badge compares the last 7 days with the prior 7.',
    },
    {
      label: 'CTR (30d)',
      value: `${ctr30.toFixed(1)}%`,
      badge: <PctBadge pct={ctrWoW(trend)} />,
      sub: 'clicks ÷ impressions',
      spark: null,
      icon: Percent,
      tint: 'bg-emerald-50 text-emerald-600',
      stroke: '#059669',
      to: '/rank-tracking',
      help: 'Click-through rate: clicks divided by impressions over 30 days. A low CTR at decent positions usually means the page title or description needs work.',
    },
    {
      label: 'Striking distance',
      value: strikingDistance.toLocaleString(),
      badge: null as React.ReactNode,
      sub: 'positions 4 to 15',
      spark: null,
      icon: Target,
      tint: 'bg-orange-50 text-orange-600',
      stroke: '#ea580c',
      to: '/keyword-research',
      help: 'Keywords ranking just off page one (about positions 4 to 15). They already earn impressions, so small on-page improvements can push them onto page one for fast traffic gains.',
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
            {card.spark && <Sparkline trend={trend} dataKey={card.spark} color={card.stroke} />}
            <p className="text-[11px] text-muted-foreground">{card.sub}</p>
          </Link>
        );
      })}
    </div>
  );
}
