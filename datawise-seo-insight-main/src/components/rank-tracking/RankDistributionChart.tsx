import { PieChart, Pie, Cell, Legend, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DistributionBuckets } from '@/types/rank-tracking';

const COLORS: Record<string, string> = {
  'Top 3': '#22c55e',
  '4-10': '#10b981',
  '11-20': '#eab308',
  '21-50': '#f97316',
  '50+': '#ef4444',
  'Not ranking': '#a1a1aa',
};

interface RankDistributionChartProps {
  distribution: DistributionBuckets;
  rankingCount?: number;
}

export default function RankDistributionChart({ distribution, rankingCount }: RankDistributionChartProps) {
  const data = [
    { name: 'Top 3', value: distribution.top3 },
    { name: '4-10', value: distribution.top10 },
    { name: '11-20', value: distribution.top20 },
    { name: '21-50', value: distribution.top50 },
    { name: '50+', value: distribution.above50 },
    { name: 'Not ranking', value: distribution.not_ranking },
  ].filter(d => d.value > 0);

  const total = rankingCount ?? (distribution.top3 + distribution.top10 + distribution.top20 + distribution.top50 + distribution.above50);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Position Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={COLORS[entry.name]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value} keywords`, name]}
              contentStyle={{ borderRadius: '8px', fontSize: '12px', border: '1px solid #e5e7eb' }}
            />
            <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-3xl font-bold">
              {total}
            </text>
            <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">
              ranking
            </text>
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap justify-center gap-3 mt-2">
          {data.map((entry) => (
            <div key={entry.name} className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[entry.name] }} />
              <span className="text-muted-foreground">{entry.name}</span>
              <span className="font-medium">{entry.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
