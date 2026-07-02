import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowUp, ArrowDown, Info } from 'lucide-react';
import { AI_ENGINE_LABELS, type AIEngine, type AITrackedQuery, type AITrendPoint } from '@/lib/ai-tracking';
import EngineTrendChart from './EngineTrendChart';

interface VerdictStripProps {
  queries: AITrackedQuery[];
  trend: AITrendPoint[];
  engines: AIEngine[];
}

// Answer-outcome ramp shared with the trend chart: dark → light = strong → no
// visibility (see EngineTrendChart for the validation notes).
const OUTCOME_COLORS = { cited: '#1F7A43', mentioned: '#4E9E6F', absent: '#C9D2CC' } as const;

// The report header: a concrete headline (how many AI answers cite or mention
// you, out of how many we checked), the weighted score as a small explained
// chip, and a per-engine breakdown as mini composition bars. Sized for the
// cold start: two queries and one check must not produce acres of white space.
export default function VerdictStrip({ queries, trend, engines }: VerdictStripProps) {
  const stats = useMemo(() => {
    let cited = 0;
    let mentioned = 0;
    let total = 0;
    const byEngine: Record<string, { cited: number; mentioned: number; total: number }> = {};
    for (const engine of engines) byEngine[engine] = { cited: 0, mentioned: 0, total: 0 };

    for (const query of queries) {
      for (const engine of engines) {
        const result = query.engines[engine];
        if (!result || result.status === 'error') continue;
        total += 1;
        byEngine[engine].total += 1;
        if (result.status === 'cited') { cited += 1; byEngine[engine].cited += 1; }
        if (result.status === 'mentioned') { mentioned += 1; byEngine[engine].mentioned += 1; }
      }
    }

    const score = Math.round((100 * (cited + mentioned * 0.5)) / Math.max(total, 1));
    return { cited, mentioned, appear: cited + mentioned, total, score, byEngine };
  }, [queries, engines]);

  // Score per check date, for the delta sentence (the score history itself
  // lives in the trend card below).
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

  if (stats.total === 0) return <EngineTrendChart trend={trend} engines={engines} />;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Latest check</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold tabular-nums text-[#005232]">{stats.appear}</span>
                <span className="text-lg font-semibold text-muted-foreground">of {stats.total}</span>
              </div>
              <p className="text-sm">
                AI answers cite or mention you
                <span className="text-muted-foreground"> ({stats.cited} with a link, {stats.mentioned} by name only)</span>
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex cursor-help items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold"
                  title="Visibility score out of 100: the share of checked AI answers where you appear. A citation with a link counts full, a name-only mention counts half."
                >
                  Score {stats.score}/100
                  <Info className="h-3 w-3 text-muted-foreground" />
                </span>
                {delta !== null && delta !== 0 && (
                  <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${delta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {delta > 0 ? '+' : ''}{delta} vs previous check
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">By engine</div>
              {engines.map(engine => {
                const e = stats.byEngine[engine];
                const absent = Math.max(0, e.total - e.cited - e.mentioned);
                return (
                  <div key={engine} className="flex items-center gap-3 text-xs">
                    <span className="w-28 flex-shrink-0 truncate">{AI_ENGINE_LABELS[engine]}</span>
                    <div className="flex h-2.5 flex-1 gap-px overflow-hidden rounded-full bg-secondary">
                      {e.cited > 0 && <div style={{ width: `${(100 * e.cited) / Math.max(e.total, 1)}%`, background: OUTCOME_COLORS.cited }} />}
                      {e.mentioned > 0 && <div style={{ width: `${(100 * e.mentioned) / Math.max(e.total, 1)}%`, background: OUTCOME_COLORS.mentioned }} />}
                      {absent > 0 && <div style={{ width: `${(100 * absent) / Math.max(e.total, 1)}%`, background: OUTCOME_COLORS.absent }} />}
                    </div>
                    <span className={`w-12 flex-shrink-0 text-right font-bold tabular-nums ${e.cited + e.mentioned === 0 && e.total > 0 ? 'text-red-600' : ''}`}>
                      {e.cited + e.mentioned}/{e.total}
                    </span>
                  </div>
                );
              })}
              <p className="text-[11px] text-muted-foreground">Answers that cite you (dark), mention you (light green), or leave you out (gray).</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <EngineTrendChart trend={trend} engines={engines} />
    </div>
  );
}
