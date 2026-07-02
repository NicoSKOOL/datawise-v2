import { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AI_ENGINE_LABELS, type AIEngine, type AITrendPoint } from '@/lib/ai-tracking';

// Fixed engine → color assignment (never cycled, never reordered). Palette
// validated for the light card surface: lightness band, chroma floor, CVD
// separation, and contrast all pass (dataviz validator, 2026-07-02).
export const ENGINE_COLORS: Record<AIEngine, string> = {
  google_ai_mode: '#1F7A43',
  chatgpt: '#2563EB',
  perplexity: '#D97706',
};

// Answer-outcome colors: a single-hue ramp, dark → light = strong → no
// visibility. The two greens pass the validator as a pair (CVD ΔE 15.0,
// contrast ≥ 3:1); the gray is a deliberate neutral for "not appearing",
// kept legible via the legend, tooltip, and segment gaps.
const OUTCOME_COLORS = {
  cited: '#1F7A43',
  mentioned: '#4E9E6F',
  absent: '#C9D2CC',
} as const;

const OUTCOME_LABELS: Record<keyof typeof OUTCOME_COLORS, string> = {
  cited: 'Cited (linked)',
  mentioned: 'Mentioned (no link)',
  absent: 'Not appearing',
};

const ENGINE_ORDER: AIEngine[] = ['google_ai_mode', 'chatgpt', 'perplexity'];

interface EngineTrendChartProps {
  trend: AITrendPoint[];
  engines: AIEngine[];
}

// One row per check date; one column per engine holding that engine's
// visibility rate (% of checked queries where the domain was cited, with
// mentions counting half), the same weighting as the headline score.
function buildEngineRows(trend: AITrendPoint[], engines: AIEngine[]) {
  const byDate = new Map<string, Record<string, number | string | null>>();
  for (const point of trend) {
    if (!engines.includes(point.engine)) continue;
    const row = byDate.get(point.date) || { date: point.date };
    row[point.engine] = point.total > 0
      ? Math.round((100 * (point.cited + point.mentioned * 0.5)) / point.total)
      : null;
    byDate.set(point.date, row);
  }
  return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// One row per check date, engines combined: how many AI answers cited you,
// mentioned you without a link, or left you out entirely.
function buildOutcomeRows(trend: AITrendPoint[], engines: AIEngine[]) {
  const byDate = new Map<string, { date: string; cited: number; mentioned: number; absent: number; total: number }>();
  for (const point of trend) {
    if (!engines.includes(point.engine)) continue;
    const row = byDate.get(point.date) || { date: point.date, cited: 0, mentioned: 0, absent: 0, total: 0 };
    row.cited += point.cited;
    row.mentioned += point.mentioned;
    row.absent += Math.max(0, point.total - point.cited - point.mentioned);
    row.total += point.total;
    byDate.set(point.date, row);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--background))',
  fontSize: 12,
} as const;

const AXIS_TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;

// Full-width breakdown of one check: with a single data point a time axis is
// meaningless, so show the composition directly and say when the trend starts.
function SingleCheckBreakdown({ row }: { row: { date: string; cited: number; mentioned: number; absent: number; total: number } }) {
  const segments = ([
    ['cited', row.cited],
    ['mentioned', row.mentioned],
    ['absent', row.absent],
  ] as const).filter(([, count]) => count > 0);

  return (
    <div className="space-y-3">
      <div className="flex h-7 w-full gap-0.5 overflow-hidden rounded-lg">
        {segments.map(([key, count]) => (
          <div
            key={key}
            className="flex items-center justify-center text-[11px] font-bold text-white"
            style={{ width: `${(100 * count) / Math.max(row.total, 1)}%`, background: OUTCOME_COLORS[key], minWidth: 28 }}
            title={`${OUTCOME_LABELS[key]}: ${count} of ${row.total}`}
          >
            <span className={key === 'absent' ? 'text-foreground/70' : ''}>{count}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(['cited', 'mentioned', 'absent'] as const).map(key => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: OUTCOME_COLORS[key] }} />
            {OUTCOME_LABELS[key]}: <strong>{row[key]}</strong>
          </span>
        ))}
        <span className="text-muted-foreground">{row.total} AI answers checked on {shortDate(row.date)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        The week-over-week trend appears after your second check. Checks run automatically every Monday.
      </p>
    </div>
  );
}

export default function EngineTrendChart({ trend, engines }: EngineTrendChartProps) {
  const engineRows = useMemo(() => buildEngineRows(trend, engines), [trend, engines]);
  const outcomeRows = useMemo(() => buildOutcomeRows(trend, engines), [trend, engines]);
  const scoreRows = useMemo(
    () => outcomeRows.map(r => ({ date: r.date, score: Math.round((100 * (r.cited + r.mentioned * 0.5)) / Math.max(r.total, 1)) })),
    [outcomeRows],
  );
  const orderedEngines = ENGINE_ORDER.filter(e => engines.includes(e));
  const [view, setView] = useState<'outcomes' | 'score' | 'engines'>('outcomes');

  if (outcomeRows.length === 0) return null;

  const singleCheck = outcomeRows.length < 2;
  const activeView = singleCheck ? 'outcomes' : view;

  const descriptions: Record<typeof activeView, string> = {
    outcomes: singleCheck
      ? 'Your tracked queries were asked to every enabled engine. Here is how those AI answers treated you.'
      : 'Every weekly check, each tracked query is asked to every engine. Each bar splits those AI answers into cited, mentioned without a link, or not appearing.',
    score: 'Visibility score per check, out of 100: the share of AI answers where you appear. Citations count full, name-only mentions count half.',
    engines: 'Share of your tracked queries each engine cited you for, per weekly check. Mentions without a link count half.',
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-sm font-semibold">{singleCheck ? 'Latest check breakdown' : 'Visibility over time'}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{descriptions[activeView]}</p>
        </div>
        {!singleCheck && (
          <div className="flex flex-shrink-0 gap-1">
            {([['outcomes', 'Answers'], ['score', 'Score'], ['engines', 'By engine']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  activeView === key ? 'bg-[#005232] text-white' : 'bg-secondary text-foreground hover:bg-secondary/70'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {singleCheck ? (
          <SingleCheckBreakdown row={outcomeRows[0]} />
        ) : (
          <div className="h-56">
            {activeView === 'outcomes' && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={outcomeRows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--secondary))', opacity: 0.4 }}
                    formatter={(value: number, name: string, entry: { payload?: { total?: number } }) => {
                      const total = entry?.payload?.total || 0;
                      const pct = total > 0 ? Math.round((100 * value) / total) : 0;
                      return [`${value} of ${total} (${pct}%)`, OUTCOME_LABELS[name as keyof typeof OUTCOME_LABELS] ?? name];
                    }}
                    labelFormatter={(label: string) => shortDate(label)}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-xs text-foreground">{OUTCOME_LABELS[value as keyof typeof OUTCOME_LABELS] ?? value}</span>
                    )}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Bar dataKey="cited" stackId="answers" fill={OUTCOME_COLORS.cited} stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={44} isAnimationActive={false} />
                  <Bar dataKey="mentioned" stackId="answers" fill={OUTCOME_COLORS.mentioned} stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={44} isAnimationActive={false} />
                  <Bar dataKey="absent" stackId="answers" fill={OUTCOME_COLORS.absent} stroke="hsl(var(--card))" strokeWidth={2} maxBarSize={44} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
            {activeView === 'score' && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreRows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="aiScoreFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1F7A43" stopOpacity={0.14} />
                      <stop offset="100%" stopColor="#1F7A43" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
                  <Tooltip
                    formatter={(value: number) => [`${value}/100`, 'Visibility score']}
                    labelFormatter={(label: string) => shortDate(label)}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Area type="monotone" dataKey="score" stroke="#1F7A43" strokeWidth={2} fill="url(#aiScoreFill)" dot={{ r: 3, strokeWidth: 0, fill: '#1F7A43' }} activeDot={{ r: 5 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
            {activeView === 'engines' && (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={engineRows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value}%`, AI_ENGINE_LABELS[name as AIEngine] ?? name]}
                    labelFormatter={(label: string) => shortDate(label)}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-xs text-foreground">{AI_ENGINE_LABELS[value as AIEngine] ?? value}</span>
                    )}
                    iconType="plainline"
                  />
                  {orderedEngines.map(engine => (
                    <Line
                      key={engine}
                      type="monotone"
                      dataKey={engine}
                      stroke={ENGINE_COLORS[engine]}
                      strokeWidth={2}
                      dot={{ r: 3, strokeWidth: 0, fill: ENGINE_COLORS[engine] }}
                      activeDot={{ r: 5 }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
