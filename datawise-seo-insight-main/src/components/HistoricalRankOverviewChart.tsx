import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface HistoricalDataPoint {
  date: string;
  keyword_count: number;
  estimated_traffic: number;
}

interface HistoricalRankOverviewChartProps {
  data: HistoricalDataPoint[];
  loading?: boolean;
}

export default function HistoricalRankOverviewChart({ data, loading }: HistoricalRankOverviewChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historical Rank Overview</CardTitle>
          <CardDescription>Keywords ranked over time</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Historical Rank Overview</CardTitle>
          <CardDescription>Keywords ranked over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground space-y-2">
            <p className="text-center">No historical ranking data available for this domain yet.</p>
            <p className="text-sm text-center">Historical data may not be available if the domain is new or hasn't been tracked by DataForSEO previously.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map(item => ({
    date: new Date(item.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }),
    keywords: item.keyword_count,
    traffic: item.estimated_traffic,
    fullDate: item.date
  })).sort((a, b) => new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historical Rank Overview</CardTitle>
        <CardDescription>Keyword count and estimated traffic value over time</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="date" 
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis 
              yAxisId="left"
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              label={{ 
                value: 'Keywords', 
                angle: -90, 
                position: 'insideLeft',
                style: { fill: 'hsl(var(--muted-foreground))' }
              }}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              label={{ 
                value: 'Est. Traffic', 
                angle: 90, 
                position: 'insideRight',
                style: { fill: 'hsl(var(--muted-foreground))' }
              }}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                color: 'hsl(var(--popover-foreground))'
              }}
              formatter={(value: number, name: string) => [
                value.toLocaleString(), 
                name === 'keywords' ? 'Keywords' : 'Est. Traffic'
              ]}
              labelFormatter={(label) => `Date: ${label}`}
            />
            <Bar 
              yAxisId="left"
              dataKey="keywords" 
              fill="hsl(var(--primary))" 
              radius={[8, 8, 0, 0]}
              name="keywords"
            />
            <Bar 
              yAxisId="right"
              dataKey="traffic" 
              fill="hsl(var(--chart-2))" 
              radius={[8, 8, 0, 0]}
              name="traffic"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
