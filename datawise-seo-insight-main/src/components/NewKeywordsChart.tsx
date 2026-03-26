import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface NewKeywordDataPoint {
  date: string;
  count: number;
}

interface NewKeywordsChartProps {
  data: NewKeywordDataPoint[];
  totalNewKeywords: number;
  loading?: boolean;
}

export default function NewKeywordsChart({ data, totalNewKeywords, loading }: NewKeywordsChartProps) {
  const chartData = data.map(item => ({
    date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    count: item.count
  }));

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New Keywords Overtime</CardTitle>
          <CardDescription>Keywords that started ranking in this period</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="text-muted-foreground">Loading chart data...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New Keywords Overtime</CardTitle>
          <CardDescription>Keywords that started ranking in this period</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="text-muted-foreground">No new keywords in this period</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length < 2) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>New Keywords Overtime</CardTitle>
              <CardDescription>Keywords that started ranking in this period</CardDescription>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-primary">{totalNewKeywords}</div>
              <div className="text-sm text-muted-foreground">Total New</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex flex-col items-center justify-center gap-4">
            <div className="text-center">
              <div className="text-sm text-muted-foreground">
                Check rankings again tomorrow to see trends over time
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>New Keywords Overtime</CardTitle>
            <CardDescription>Keywords that started ranking in this period</CardDescription>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-primary">{totalNewKeywords}</div>
            <div className="text-sm text-muted-foreground">Total New</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart 
            data={chartData}
            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
          >
            <CartesianGrid 
              strokeDasharray="0" 
              stroke="hsl(var(--border))" 
              opacity={0.3}
              vertical={false}
            />
            <XAxis 
              dataKey="date" 
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dy={10}
            />
            <YAxis 
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dx={-10}
            />
            <Tooltip 
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}
              labelStyle={{
                color: 'hsl(var(--popover-foreground))',
                fontWeight: 600,
                marginBottom: '4px'
              }}
              formatter={(value: any) => [value, 'New Keywords']}
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.1 }}
            />
            <Bar 
              dataKey="count" 
              fill="hsl(var(--primary))" 
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
