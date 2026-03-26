import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { HistoryEntry } from '@/types/rank-tracking';

interface PositionHistoryChartProps {
  history: HistoryEntry[];
  keywordName: string;
}

export default function PositionHistoryChart({ history, keywordName }: PositionHistoryChartProps) {
  const chartData = useMemo(() => {
    const reversed = [...history].reverse();
    return reversed.map((entry) => ({
      date: new Date(`${entry.checked_at}Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      position: entry.position,
      fullDate: entry.checked_at,
    }));
  }, [history]);

  const hasData = chartData.some((d) => d.position != null);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
        No position data to chart yet.
      </div>
    );
  }

  const positions = chartData.filter((d) => d.position != null).map((d) => d.position!);
  const maxPosition = Math.max(...positions);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis
          dataKey="date"
          className="text-xs"
          tick={{ fill: 'hsl(var(--muted-foreground))' }}
        />
        <YAxis
          reversed
          domain={[1, maxPosition + 5]}
          className="text-xs"
          tick={{ fill: 'hsl(var(--muted-foreground))' }}
          label={{
            value: 'Position',
            angle: -90,
            position: 'insideLeft',
            style: { fill: 'hsl(var(--muted-foreground))' },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            border: '1px solid hsl(var(--border))',
            borderRadius: '8px',
            color: 'hsl(var(--popover-foreground))',
          }}
          formatter={(value: number) => [value != null ? `#${value}` : 'Not ranking', keywordName]}
          labelFormatter={(label) => `Date: ${label}`}
        />
        <Line
          type="monotone"
          dataKey="position"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          dot={{ r: 4, fill: 'hsl(var(--primary))' }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
