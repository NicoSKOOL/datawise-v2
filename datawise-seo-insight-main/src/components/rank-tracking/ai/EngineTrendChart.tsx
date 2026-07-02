import { useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
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

const ENGINE_ORDER: AIEngine[] = ['google_ai_mode', 'chatgpt', 'perplexity'];

interface EngineTrendChartProps {
  trend: AITrendPoint[];
  engines: AIEngine[];
}

// One row per check date; one column per engine holding that engine's
// visibility rate (% of checked queries where the domain was cited, with
// mentions counting half), the same weighting as the headline score.
function buildRows(trend: AITrendPoint[], engines: AIEngine[]) {
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

function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function EngineTrendChart({ trend, engines }: EngineTrendChartProps) {
  const rows = useMemo(() => buildRows(trend, engines), [trend, engines]);
  const orderedEngines = ENGINE_ORDER.filter(e => engines.includes(e));

  // A trend needs at least two check dates to be a line.
  if (rows.length < 2) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">Visibility by engine</CardTitle>
        <p className="text-xs text-muted-foreground">
          Share of your tracked queries each engine cited you for, per weekly check. Mentions without a link count half.
        </p>
      </CardHeader>
      <CardContent>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v: number) => `${v}%`}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                formatter={(value: number, name: string) => [`${value}%`, AI_ENGINE_LABELS[name as AIEngine] ?? name]}
                labelFormatter={(label: string) => shortDate(label)}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--background))',
                  fontSize: 12,
                }}
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
        </div>
      </CardContent>
    </Card>
  );
}
