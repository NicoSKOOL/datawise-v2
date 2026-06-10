import { useMemo } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { AI_ENGINE_LABELS, type AIEngine, type AITrackedQuery, type AITrendPoint } from '@/lib/ai-tracking';

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

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">AI Visibility Score</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tabular-nums text-[#005232]">{stats.score}</span>
            {delta !== null && delta !== 0 && (
              <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {delta > 0 ? '+' : ''}{delta} vs last check
              </span>
            )}
          </div>
          {dateScores.length > 1 && (
            <div className="mt-1 h-7">
              <ResponsiveContainer width="100%" height={28}>
                <LineChart data={dateScores} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
                  <Line type="monotone" dataKey="score" stroke="#005232" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Queries where you appear</div>
          <div className="text-3xl font-extrabold tabular-nums">
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
  );
}
