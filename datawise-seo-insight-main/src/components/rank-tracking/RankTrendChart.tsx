import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TrendPoint } from '@/types/rank-tracking';

interface RankTrendChartProps {
  trend: TrendPoint[];
}

export default function RankTrendChart({ trend }: RankTrendChartProps) {
  if (!trend.length) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Ranking Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[260px] text-sm text-muted-foreground">
            Run rank checks over multiple days to see trends
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatted = trend.map(t => ({
    ...t,
    date: new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Ranking Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={formatted} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px', border: '1px solid #e5e7eb' }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
            <Area type="monotone" dataKey="top3" stackId="1" name="Top 3" stroke="#22c55e" fill="#22c55e" fillOpacity={0.8} />
            <Area type="monotone" dataKey="top10" stackId="1" name="4-10" stroke="#10b981" fill="#10b981" fillOpacity={0.7} />
            <Area type="monotone" dataKey="top20" stackId="1" name="11-20" stroke="#eab308" fill="#eab308" fillOpacity={0.6} />
            <Area type="monotone" dataKey="top50" stackId="1" name="21-50" stroke="#f97316" fill="#f97316" fillOpacity={0.5} />
            <Area type="monotone" dataKey="above50" stackId="1" name="50+" stroke="#ef4444" fill="#ef4444" fillOpacity={0.4} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
