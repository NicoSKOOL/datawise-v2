import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowUp, ArrowDown } from 'lucide-react';
import {
  AI_ENGINE_SHORT_LABELS, AI_ENGINE_ORDER,
  type AIEngine, type AITrackedQuery, type AITrendPoint,
} from '@/lib/ai-tracking';
import EngineLogo from './EngineLogo';

interface KpiRailProps {
  queries: AITrackedQuery[];
  engines: AIEngine[];
  trend: AITrendPoint[];
}

function Delta({ value }: { value: number | null }) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[13px] font-bold ${up ? 'text-[#1F7A43]' : 'text-red-600'}`}>
      {up ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}{Math.abs(value)}
    </span>
  );
}

// The four-tile score rail from the v2 design: the concrete "right now"
// fraction on brand green, then score, cited count, and best engine.
export default function KpiRail({ queries, engines, trend }: KpiRailProps) {
  const stats = useMemo(() => {
    let cited = 0;
    let mentioned = 0;
    let total = 0;
    const byEngine = new Map<AIEngine, { hit: number; total: number }>();
    for (const engine of engines) byEngine.set(engine, { hit: 0, total: 0 });

    for (const query of queries) {
      for (const engine of engines) {
        const result = query.engines[engine];
        if (!result || result.status === 'error') continue;
        total += 1;
        const e = byEngine.get(engine)!;
        e.total += 1;
        if (result.status === 'cited') { cited += 1; e.hit += 1; }
        if (result.status === 'mentioned') { mentioned += 1; e.hit += 1; }
      }
    }

    const ranked = AI_ENGINE_ORDER.filter(e => engines.includes(e))
      .map(e => ({ engine: e, ...byEngine.get(e)! }))
      .sort((a, b) => b.hit - a.hit);

    return {
      cited,
      appear: cited + mentioned,
      total,
      score: Math.round((100 * (cited + mentioned * 0.5)) / Math.max(total, 1)),
      best: ranked[0] ?? null,
      worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    };
  }, [queries, engines]);

  // Per-date aggregates from the trend feed the deltas vs the previous check.
  const deltas = useMemo(() => {
    const byDate = new Map<string, { weighted: number; cited: number; total: number }>();
    for (const point of trend) {
      const entry = byDate.get(point.date) || { weighted: 0, cited: 0, total: 0 };
      entry.weighted += point.cited + point.mentioned * 0.5;
      entry.cited += point.cited;
      entry.total += point.total;
      byDate.set(point.date, entry);
    }
    const dates = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b));
    if (dates.length < 2) return { score: null as number | null, cited: null as number | null };
    const [, prev] = dates[dates.length - 2];
    const [, last] = dates[dates.length - 1];
    return {
      score: Math.round((100 * last.weighted) / Math.max(last.total, 1)) - Math.round((100 * prev.weighted) / Math.max(prev.total, 1)),
      cited: last.cited - prev.cited,
    };
  }, [trend]);

  if (stats.total === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="flex flex-col gap-1.5 rounded-xl bg-[#166337] p-5 text-white">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-[#A9D9B9]">Right now</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-extrabold leading-none tracking-tight tabular-nums">{stats.appear}</span>
          <span className="text-lg font-bold text-[#A9D9B9]">/ {stats.total} answers</span>
        </div>
        <div className="text-xs leading-snug text-[#CFE8D6]">
          cite or mention you · {queries.length} {queries.length === 1 ? 'query' : 'queries'} × {engines.length} {engines.length === 1 ? 'engine' : 'engines'}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-1.5 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Score</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold leading-none tracking-tight tabular-nums">{stats.score}</span>
            <Delta value={deltas.score} />
          </div>
          <div className="text-xs text-muted-foreground">of 100 · cite = 1, mention = ½</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-1.5 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Cited</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold leading-none tracking-tight tabular-nums">{stats.cited}</span>
            <Delta value={deltas.cited} />
          </div>
          <div className="text-xs text-muted-foreground">answers link to you</div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-1.5 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Best engine</div>
          {stats.best && stats.best.hit > 0 ? (
            <>
              <div className="flex items-center gap-2 text-[22px] font-extrabold leading-tight tracking-tight">
                <EngineLogo engine={stats.best.engine} className="h-5 w-5" />
                {AI_ENGINE_SHORT_LABELS[stats.best.engine]}
              </div>
              <div className="text-xs text-muted-foreground">
                {stats.best.hit} of {stats.best.total}
                {stats.worst ? ` · ${AI_ENGINE_SHORT_LABELS[stats.worst.engine]} weakest` : ''}
              </div>
            </>
          ) : (
            <>
              <div className="text-[22px] font-extrabold leading-tight tracking-tight text-muted-foreground">None yet</div>
              <div className="text-xs text-muted-foreground">no engine cites or mentions you</div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
