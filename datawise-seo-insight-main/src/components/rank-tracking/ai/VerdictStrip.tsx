import { useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { AI_ENGINE_LABELS, type AIEngine, type AITrackedQuery, type AITrendPoint } from '@/lib/ai-tracking';
import EngineTrendChart from './EngineTrendChart';

interface VerdictStripProps {
  queries: AITrackedQuery[];
  trend: AITrendPoint[];
  engines: AIEngine[];
}

function resultValue(status: string): number {
  if (status === 'cited') return 1;
  if (status === 'mentioned') return 0.5;
  return 0;
}

function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// The report header: headline score with a plain-language verdict, the score
// history as a real chart (axis + tooltip, not a sparkline), and the
// per-engine trend. Shared by the AI Visibility Performance tab and the
// Rank Tracking AI panel.
export default function VerdictStrip({ queries, trend, engines }: VerdictStripProps) {
  const stats = useMemo(() => {
    let sum = 0;
    let denom = 0;
    let citedQueries = 0;
    let mentionedQueries = 0;
    let appearQueries = 0;
    const byEngine: Record<string, { hit: number; total: number }> = {};
    for (const engine of engines) byEngine[engine] = { hit: 0, total: 0 };

    for (const query of queries) {
      let cited = false;
      let mentioned = false;
      for (const engine of engines) {
        const result = query.engines[engine];
        if (!result || result.status === 'error') continue;
        denom += 1;
        sum += resultValue(result.status);
        byEngine[engine].total += 1;
        if (result.status === 'cited' || result.status === 'mentioned') byEngine[engine].hit += 1;
        if (result.status === 'cited') cited = true;
        if (result.status === 'mentioned') mentioned = true;
      }
      if (cited) citedQueries += 1;
      else if (mentioned) mentionedQueries += 1;
      if (cited || mentioned) appearQueries += 1;
    }

    return { score: Math.round((100 * sum) / Math.max(denom, 1)), citedQueries, mentionedQueries, appearQueries, byEngine };
  }, [queries, engines]);

  const dateScores = useMemo(() => {
    const byDate = new Map<string, { weighted: number; total: number }>();
    for (const point of trend) {
      const entry = byDate.get(point.date) || { weighted: 0, total: 0 };
      entry.weighted += point.cited + point.mentioned * 0.5;
      entry.total += point.total;
      byDate.set(point.date, entry);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { weighted, total }]) => ({ date, score: Math.round((100 * weighted) / Math.max(total, 1)) }));
  }, [trend]);

  const delta = dateScores.length >= 2 ? dateScores[dateScores.length - 1].score - dateScores[dateScores.length - 2].score : null;

  // One sentence a user can read instead of decoding the numbers.
  const verdict = useMemo(() => {
    if (queries.length === 0) return null;
    const appear = `AI answers cite or mention you for ${stats.appearQueries} of your ${queries.length} tracked ${queries.length === 1 ? 'query' : 'queries'}`;
    if (delta === null || delta === 0) return `${appear}.`;
    return `${appear}, ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} score ${Math.abs(delta) === 1 ? 'point' : 'points'} since the last check.`;
  }, [queries.length, stats.appearQueries, delta]);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardContent className="p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">AI Visibility Score</div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-extrabold tabular-nums text-[#005232]">{stats.score}</span>
              {delta !== null && delta !== 0 && (
                <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                  {delta > 0 ? '+' : ''}{delta} vs last check
                </span>
              )}
            </div>
            {verdict && <p className="mt-1 text-sm text-muted-foreground">{verdict}</p>}
            {dateScores.length > 1 && (
              <div className="mt-3 h-24">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dateScores} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="aiScoreFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1F7A43" stopOpacity={0.14} />
                        <stop offset="100%" stopColor="#1F7A43" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      tickLine={false}
                      axisLine={{ stroke: 'hsl(var(--border))' }}
                      interval="preserveStartEnd"
                    />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      formatter={(value: number) => [`${value}`, 'Score']}
                      labelFormatter={(label: string) => shortDate(label)}
                      contentStyle={{
                        borderRadius: 8,
                        border: '1px solid hsl(var(--border))',
                        background: 'hsl(var(--background))',
                        fontSize: 12,
                      }}
                    />
                    <Area type="monotone" dataKey="score" stroke="#1F7A43" strokeWidth={2} fill="url(#aiScoreFill)" dot={{ r: 2.5, strokeWidth: 0, fill: '#1F7A43' }} activeDot={{ r: 4 }} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Queries where you appear</div>
              <div className="text-2xl font-extrabold tabular-nums">
                {stats.appearQueries}
                <span className="text-base font-bold text-muted-foreground">/{queries.length}</span>
              </div>
              <div className="text-xs text-muted-foreground">cited in {stats.citedQueries}, mentioned in {stats.mentionedQueries}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">By engine</div>
              <div className="space-y-1 text-xs">
                {engines.map(engine => {
                  const { hit, total } = stats.byEngine[engine];
                  return (
                    <div key={engine} className="flex items-center justify-between">
                      <span>{AI_ENGINE_LABELS[engine]}</span>
                      <span className={`font-bold tabular-nums ${hit === 0 && total > 0 ? 'text-red-600' : ''}`}>{hit}/{total}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <EngineTrendChart trend={trend} engines={engines} />
    </div>
  );
}
