import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, TrendingUp, BarChart3, Search } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface HistoricalData {
  date: string;
  metrics: {
    organic: {
      estimated_traffic: number;
      keyword_count: number;
      pos_1: number;
      pos_2_3: number;
      pos_4_10: number;
      pos_11_20: number;
      pos_21_30: number;
      pos_31_40: number;
      pos_41_50: number;
      pos_51_100: number;
    };
  };
}

interface HistoricalPerformanceProps {
  websiteUrl: string;
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

export default function HistoricalPerformance({ websiteUrl }: HistoricalPerformanceProps) {
  const [data, setData] = useState<HistoricalData[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState("3months");
  const { toast } = useToast();

  const fetchHistoricalData = async () => {
    if (!websiteUrl) return;
    
    setLoading(true);
    try {
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      
      switch (dateRange) {
        case "1month":
          startDate.setMonth(endDate.getMonth() - 1);
          break;
        case "3months":
          startDate.setMonth(endDate.getMonth() - 3);
          break;
        case "6months":
          startDate.setMonth(endDate.getMonth() - 6);
          break;
        case "1year":
          startDate.setFullYear(endDate.getFullYear() - 1);
          break;
      }

      const domain = websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      
      const { data: result, error } = await supabase.functions.invoke('historical-rank-overview', {
        body: {
          target: domain,
          location_code: 2840,
          language_code: "en",
          date_from: startDate.toISOString().split('T')[0],
          date_to: endDate.toISOString().split('T')[0]
        }
      });

      if (error) throw error;
      
      if (result.error) {
        throw new Error(result.error);
      }

      setData(result.historical_data || []);
    } catch (error) {
      console.error('Error fetching historical data:', error);
      toast({
        title: "Error",
        description: "Failed to fetch historical performance data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistoricalData();
  }, [websiteUrl, dateRange]);

  // Format data for traffic chart
  const trafficChartData = data.map(item => ({
    date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    traffic: Math.round(item.metrics.organic.estimated_traffic),
    keywords: item.metrics.organic.keyword_count
  }));

  // Format data for position distribution (latest month)
  const latestData = data[data.length - 1];
  const positionDistribution = latestData ? [
    { name: 'Position 1', value: latestData.metrics.organic.pos_1, color: COLORS[0] },
    { name: 'Position 2-3', value: latestData.metrics.organic.pos_2_3, color: COLORS[1] },
    { name: 'Position 4-10', value: latestData.metrics.organic.pos_4_10, color: COLORS[2] },
    { name: 'Position 11-20', value: latestData.metrics.organic.pos_11_20, color: COLORS[3] },
    { name: 'Position 21+', value: latestData.metrics.organic.pos_21_30 + latestData.metrics.organic.pos_31_40 + latestData.metrics.organic.pos_41_50 + latestData.metrics.organic.pos_51_100, color: COLORS[4] }
  ].filter(item => item.value > 0) : [];

  // Calculate metrics
  const currentTraffic = latestData?.metrics.organic.estimated_traffic || 0;
  const previousTraffic = data.length > 1 ? data[data.length - 2]?.metrics.organic.estimated_traffic || 0 : 0;
  const trafficChange = previousTraffic > 0 ? ((currentTraffic - previousTraffic) / previousTraffic * 100) : 0;

  const currentKeywords = latestData?.metrics.organic.keyword_count || 0;
  const previousKeywords = data.length > 1 ? data[data.length - 2]?.metrics.organic.keyword_count || 0 : 0;
  const keywordsChange = previousKeywords > 0 ? ((currentKeywords - previousKeywords) / previousKeywords * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Historical Performance</h2>
          <p className="text-muted-foreground">Track your website's SEO performance over time</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1month">1 Month</SelectItem>
              <SelectItem value="3months">3 Months</SelectItem>
              <SelectItem value="6months">6 Months</SelectItem>
              <SelectItem value="1year">1 Year</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={fetchHistoricalData} disabled={loading}>
            {loading ? "Loading..." : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Estimated Traffic</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">{currentTraffic.toLocaleString()}</p>
                  <div className={`flex items-center text-sm ${trafficChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <TrendingUp className="h-4 w-4 mr-1" />
                    {trafficChange > 0 ? '+' : ''}{trafficChange.toFixed(1)}%
                  </div>
                </div>
              </div>
              <BarChart3 className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Ranking Keywords</p>
                <div className="flex items-center gap-2">
                  <p className="text-2xl font-bold">{currentKeywords.toLocaleString()}</p>
                  <div className={`flex items-center text-sm ${keywordsChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <TrendingUp className="h-4 w-4 mr-1" />
                    {keywordsChange > 0 ? '+' : ''}{keywordsChange.toFixed(1)}%
                  </div>
                </div>
              </div>
              <Search className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Top 10 Keywords</p>
                <p className="text-2xl font-bold">
                  {latestData ? (latestData.metrics.organic.pos_1 + latestData.metrics.organic.pos_2_3 + latestData.metrics.organic.pos_4_10).toLocaleString() : 0}
                </p>
              </div>
              <Calendar className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Traffic Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Estimated Traffic Trend</CardTitle>
            <CardDescription>Monthly estimated organic traffic</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="text-muted-foreground">Loading chart data...</div>
              </div>
            ) : trafficChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trafficChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip 
                    formatter={(value: any) => [value.toLocaleString(), 'Traffic']}
                    labelFormatter={(label) => `Month: ${label}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="traffic" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))", strokeWidth: 2, r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center">
                <div className="text-muted-foreground">No data available</div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Position Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Keyword Position Distribution</CardTitle>
            <CardDescription>Current ranking position breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="text-muted-foreground">Loading chart data...</div>
              </div>
            ) : positionDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={positionDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {positionDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => [value.toLocaleString(), 'Keywords']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center">
                <div className="text-muted-foreground">No data available</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Keywords Count Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Ranking Keywords Trend</CardTitle>
          <CardDescription>Total number of ranking keywords over time</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="text-muted-foreground">Loading chart data...</div>
            </div>
          ) : trafficChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trafficChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip 
                  formatter={(value: any) => [value.toLocaleString(), 'Keywords']}
                  labelFormatter={(label) => `Month: ${label}`}
                />
                <Bar dataKey="keywords" fill="hsl(var(--chart-2))" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center">
              <div className="text-muted-foreground">No data available</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}