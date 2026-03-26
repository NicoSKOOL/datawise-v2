import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface KeywordTimelinePoint {
  date: string;
  count: number;
}

interface KeywordsRankedChartProps {
  data: KeywordTimelinePoint[];
  loading?: boolean;
}

export default function KeywordsRankedChart({ data, loading = false }: KeywordsRankedChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Keywords Ranked Over Time</CardTitle>
          <CardDescription>Daily count of keywords in top 100</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map(point => ({
    date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    keywords: point.count
  }));

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Keywords Ranked Over Time</CardTitle>
          <CardDescription>Daily count of keywords in top 100</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="text-muted-foreground">No keyword ranking data available yet</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Keywords Ranked Over Time</CardTitle>
          <CardDescription>Daily count of keywords in top 100</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex flex-col items-center justify-center gap-4">
            <div className="text-center">
              <div className="text-4xl font-bold text-primary mb-2">
                {chartData[0]?.keywords}
              </div>
              <div className="text-sm text-muted-foreground">
                Keywords Currently Ranked
              </div>
            </div>
            <div className="text-sm text-muted-foreground text-center">
              Check rankings again tomorrow to see trends over time
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Keywords Ranked Over Time</CardTitle>
        <CardDescription>Daily count of keywords in top 100</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="date" 
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis 
              className="text-xs"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              label={{ 
                value: 'Keywords Ranked', 
                angle: -90, 
                position: 'insideLeft',
                style: { fill: 'hsl(var(--muted-foreground))', fontSize: '12px' }
              }}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                color: 'hsl(var(--popover-foreground))'
              }}
              labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
            />
            <Line 
              type="monotone" 
              dataKey="keywords" 
              stroke="hsl(var(--primary))" 
              strokeWidth={2}
              dot={{ fill: 'hsl(var(--primary))', r: 4 }}
              activeDot={{ r: 6 }}
              name="Keywords"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
