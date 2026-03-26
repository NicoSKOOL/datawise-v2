import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface HistoricalDataPoint {
  date: string;
  avg_position: number;
  weighted_avg_position: number;
  keyword_count: number;
}

interface AveragePositionChartProps {
  data: HistoricalDataPoint[];
  loading?: boolean;
}

export default function AveragePositionChart({ data, loading }: AveragePositionChartProps) {
  const chartData = data.map(item => ({
    date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    position: item.avg_position,
    keywords: item.keyword_count
  }));

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Average Position Trend</CardTitle>
          <CardDescription>Historical ranking position over time</CardDescription>
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
          <CardTitle>Average Position Trend</CardTitle>
          <CardDescription>Historical ranking position over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="text-muted-foreground">No historical data available yet</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Average Position</CardTitle>
          <CardDescription>Track your ranking position over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex flex-col items-center justify-center gap-4">
            <div className="text-center">
              <div className="text-4xl font-bold text-primary mb-2">
                {chartData[0]?.position.toFixed(1)}
              </div>
              <div className="text-sm text-muted-foreground">
                Current Average Position
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
        <CardTitle>Average Position</CardTitle>
        <CardDescription>Track your ranking position over time</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart 
            data={chartData}
            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
          >
            <defs>
              <linearGradient id="positionGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.1}/>
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
              </linearGradient>
            </defs>
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
              reversed
              domain={[0, 'dataMax + 10']}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              dx={-10}
              orientation="right"
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
              formatter={(value: any, name: string) => {
                if (name === 'position') {
                  return [value.toFixed(1), 'Position'];
                }
                return [value, name];
              }}
              cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
            />
            
            <Line 
              type="monotoneX" 
              dataKey="position" 
              stroke="hsl(var(--primary))" 
              strokeWidth={2.5}
              dot={false}
              activeDot={{ 
                r: 5, 
                fill: "hsl(var(--primary))",
                stroke: "hsl(var(--background))",
                strokeWidth: 2
              }}
              fill="url(#positionGradient)"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
