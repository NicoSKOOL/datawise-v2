import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Plus, X, Trophy, TrendingUp, Search, DollarSign, Target } from "lucide-react";
import { fetchDomainRankOverview } from "@/lib/dataforseo";
import { useToast } from "@/components/ui/use-toast";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from "recharts";

// Softer, brand-aligned palette: forest teal, warm terracotta, slate blue, muted gold, sage
const DOMAIN_COLORS = ["#0d7357", "#c06a45", "#5b7fa6", "#b89a3d", "#7a8f7e"];

interface DomainResult {
  domain: string;
  total_keywords: number;
  organic_traffic: number;
  paid_traffic: number;
  organic_keywords: number;
  paid_keywords: number;
  top_3_count: number;
  top_10_count: number;
  top_100_count: number;
  estimated_cost: number;
  position_1: number;
  position_2_3: number;
  position_4_10: number;
  position_11_20: number;
  position_21_30: number;
  position_31_40: number;
  position_41_50: number;
  position_51_100: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// --- Metric Winner Cards ---
function MetricWinnerCards({ results }: { results: DomainResult[] }) {
  const metrics = [
    { key: "total_keywords" as const, label: "Total Keywords", icon: Search, prefix: "" },
    { key: "organic_traffic" as const, label: "Organic Traffic", icon: TrendingUp, prefix: "" },
    { key: "top_10_count" as const, label: "Top 10 Keywords", icon: Target, prefix: "" },
    { key: "estimated_cost" as const, label: "Traffic Value", icon: DollarSign, prefix: "$" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map(({ key, label, icon: Icon, prefix }) => {
        const sorted = [...results].sort((a, b) => b[key] - a[key]);
        const winner = sorted[0];
        const maxVal = Math.max(...results.map((r) => r[key]), 1);

        return (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {results.map((r, i) => {
                const isWinner = results.length > 1 && r.domain === winner.domain && r[key] > 0;
                const barWidth = (r[key] / maxVal) * 100;
                return (
                  <div key={r.domain} className="space-y-0.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className={`truncate mr-2 ${isWinner ? "font-semibold" : "text-muted-foreground"}`}>
                        {isWinner && <Trophy className="inline h-3 w-3 mr-1 text-amber-500" />}
                        {r.domain}
                      </span>
                      <span className="tabular-nums font-medium shrink-0">
                        {prefix}{formatNumber(r[key])}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${barWidth}%`, backgroundColor: DOMAIN_COLORS[i % DOMAIN_COLORS.length] }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// --- Radar Chart ---
function ComparisonRadarChart({ results }: { results: DomainResult[] }) {
  const axes = [
    { key: "total_keywords", label: "Keywords" },
    { key: "organic_traffic", label: "Traffic" },
    { key: "top_3_count", label: "Top 3" },
    { key: "top_10_count", label: "Top 10" },
    { key: "estimated_cost", label: "Value" },
    { key: "top_100_count", label: "Top 100" },
  ];

  // Normalize each metric to 0-100
  const maxes: Record<string, number> = {};
  axes.forEach(({ key }) => {
    maxes[key] = Math.max(...results.map((r) => (r as any)[key] || 0), 1);
  });

  const radarData = axes.map(({ key, label }) => {
    const point: any = { metric: label };
    results.forEach((r, i) => {
      point[r.domain] = Math.round(((r as any)[key] / maxes[key]) * 100);
    });
    return point;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Competitive Profile</CardTitle>
        <CardDescription>Normalized comparison across key metrics</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <RadarChart data={radarData} outerRadius="75%">
            <PolarGrid strokeDasharray="3 3" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            {results.map((r, i) => (
              <Radar
                key={r.domain}
                name={r.domain}
                dataKey={r.domain}
                stroke={DOMAIN_COLORS[i % DOMAIN_COLORS.length]}
                fill={DOMAIN_COLORS[i % DOMAIN_COLORS.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Tooltip
              formatter={(value: number, name: string, props: any) => {
                const metricKey = axes.find((a) => a.label === props.payload.metric)?.key;
                if (!metricKey) return [value, name];
                const result = results.find((r) => r.domain === name);
                const actual = result ? (result as any)[metricKey] : 0;
                return [formatNumber(actual), name];
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Grouped Bar Chart for Position Distribution ---
function PositionDistributionChart({ results }: { results: DomainResult[] }) {
  const ranges = [
    { label: "#1", key: "position_1" },
    { label: "#2-3", key: "position_2_3" },
    { label: "#4-10", key: "position_4_10" },
    { label: "#11-20", key: "position_11_20" },
    { label: "#21-50", keys: ["position_21_30", "position_31_40", "position_41_50"] },
    { label: "#51-100", key: "position_51_100" },
  ];

  const chartData = ranges.map((range) => {
    const point: any = { range: range.label };
    results.forEach((r) => {
      if ("keys" in range) {
        point[r.domain] = range.keys.reduce((sum, k) => sum + ((r as any)[k] || 0), 0);
      } else {
        point[r.domain] = (r as any)[range.key] || 0;
      }
    });
    return point;
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Position Distribution</CardTitle>
        <CardDescription>Keywords by ranking position range</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} barGap={2} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="range" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
            <Tooltip formatter={(value: number) => [formatNumber(value), ""]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {results.map((r, i) => (
              <Bar
                key={r.domain}
                dataKey={r.domain}
                fill={DOMAIN_COLORS[i % DOMAIN_COLORS.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// --- Detail Comparison Table (rows = metrics, cols = domains) ---
function DetailComparisonTable({ results }: { results: DomainResult[] }) {
  const rows = [
    { label: "Total Keywords", key: "total_keywords", prefix: "" },
    { label: "Organic Traffic", key: "organic_traffic", prefix: "" },
    { label: "Paid Traffic", key: "paid_traffic", prefix: "" },
    { label: "Top 3 Keywords", key: "top_3_count", prefix: "" },
    { label: "Top 10 Keywords", key: "top_10_count", prefix: "" },
    { label: "Top 100 Keywords", key: "top_100_count", prefix: "" },
    { label: "Traffic Value", key: "estimated_cost", prefix: "$" },
    { label: "Position #1", key: "position_1", prefix: "" },
    { label: "Position #2-3", key: "position_2_3", prefix: "" },
    { label: "Position #4-10", key: "position_4_10", prefix: "" },
    { label: "Position #11-20", key: "position_11_20", prefix: "" },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Full Metrics Breakdown</CardTitle>
        <CardDescription>All metrics with winner highlighted per row</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-0 divide-y">
          {/* Header */}
          <div className={`grid gap-2 pb-3 text-xs font-medium text-muted-foreground uppercase tracking-wider`}
            style={{ gridTemplateColumns: `140px repeat(${results.length},1fr) auto` }}>
            <div>Metric</div>
            {results.map((r, i) => (
              <div key={r.domain} className="text-right flex items-center justify-end gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: DOMAIN_COLORS[i % DOMAIN_COLORS.length] }} />
                <span className="truncate">{r.domain}</span>
              </div>
            ))}
            <div className="text-center pl-3"><Trophy className="inline h-3 w-3" /></div>
          </div>
          {/* Rows */}
          {rows.map(({ label, key, prefix }) => {
            const values = results.map((r) => (r as any)[key] || 0);
            const maxVal = Math.max(...values);
            const winnerIdx = values.indexOf(maxVal);
            return (
              <div
                key={key}
                className="grid gap-2 py-2.5 items-center text-sm"
                style={{ gridTemplateColumns: `140px repeat(${results.length},1fr) auto` }}
              >
                <div className="text-muted-foreground text-xs">{label}</div>
                {results.map((r, i) => {
                  const val = (r as any)[key] || 0;
                  const isWinner = results.length > 1 && i === winnerIdx && maxVal > 0;
                  return (
                    <div
                      key={r.domain}
                      className={`text-right tabular-nums ${isWinner ? "font-semibold text-foreground" : ""}`}
                    >
                      {prefix}{formatNumber(val)}
                    </div>
                  );
                })}
                <div className="text-center pl-3">
                  {maxVal > 0 && results.length > 1 && (
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{ backgroundColor: DOMAIN_COLORS[winnerIdx % DOMAIN_COLORS.length] }}
                      title={results[winnerIdx].domain}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Single Domain Summary ---
function SingleDomainSummary({ result }: { result: DomainResult }) {
  const cards = [
    { label: "Total Keywords", value: result.total_keywords, prefix: "" },
    { label: "Organic Traffic", value: result.organic_traffic, prefix: "" },
    { label: "Top 10 Keywords", value: result.top_10_count, prefix: "" },
    { label: "Traffic Value", value: result.estimated_cost, prefix: "$" },
  ];

  const positions = [
    { label: "#1", value: result.position_1 },
    { label: "#2-3", value: result.position_2_3 },
    { label: "#4-10", value: result.position_4_10 },
    { label: "#11-20", value: result.position_11_20 },
    { label: "#21-50", value: (result.position_21_30 || 0) + (result.position_31_40 || 0) + (result.position_41_50 || 0) },
    { label: "#51-100", value: result.position_51_100 },
  ];

  const posChartData = positions.map((p) => ({ range: p.label, keywords: p.value }));

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{c.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">{c.prefix}{formatNumber(c.value)}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Position Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={posChartData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="range" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)} />
              <Tooltip formatter={(value: number) => [formatNumber(value), "Keywords"]} />
              <Bar dataKey="keywords" radius={[4, 4, 0, 0]}>
                {posChartData.map((_, i) => (
                  <Cell key={i} fill={i < 3 ? "#0d7357" : "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </>
  );
}

// --- Main Page ---
export default function DomainRankOverview() {
  const [domains, setDomains] = useState([""]);
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DomainResult[]>([]);
  const { toast } = useToast();

  const addDomain = () => {
    if (domains.length < 5) setDomains([...domains, ""]);
  };

  const removeDomain = (index: number) => {
    if (domains.length > 1) setDomains(domains.filter((_, i) => i !== index));
  };

  const cleanDomainInput = (value: string): string => {
    return value.trim().replace(/^https?:\/\//, '').replace(/^www\./, '');
  };

  const updateDomain = (index: number, value: string) => {
    const newDomains = [...domains];
    newDomains[index] = cleanDomainInput(value);
    setDomains(newDomains);
  };

  const processResult = (result: any, inputDomain: string): DomainResult | null => {
    if (result.items && result.items.length > 0) {
      const item = result.items[0];
      const org = item.metrics?.organic || {};
      const paid = item.metrics?.paid || {};
      const top3 = (org.pos_1 || 0) + (org.pos_2_3 || 0);
      return {
        domain: result.target || inputDomain,
        total_keywords: org.count || 0,
        organic_traffic: Math.round(org.etv || 0),
        paid_traffic: Math.round(paid.etv || 0),
        organic_keywords: org.count || 0,
        paid_keywords: paid.count || 0,
        top_3_count: top3,
        top_10_count: top3 + (org.pos_4_10 || 0),
        top_100_count: org.count || 0,
        estimated_cost: Math.round(org.estimated_paid_traffic_cost || 0),
        position_1: org.pos_1 || 0,
        position_2_3: org.pos_2_3 || 0,
        position_4_10: org.pos_4_10 || 0,
        position_11_20: org.pos_11_20 || 0,
        position_21_30: org.pos_21_30 || 0,
        position_31_40: org.pos_31_40 || 0,
        position_41_50: org.pos_41_50 || 0,
        position_51_100: (org.pos_51_60 || 0) + (org.pos_61_70 || 0) + (org.pos_71_80 || 0) + (org.pos_81_90 || 0) + (org.pos_91_100 || 0),
      };
    }
    return null;
  };

  const handleAnalyze = async () => {
    const activeDomains = domains.filter((d) => d.trim());
    if (activeDomains.length === 0) return;

    setLoading(true);
    setResults([]);

    try {
      const requestBody =
        activeDomains.length > 1
          ? { targets: activeDomains, location_code: parseInt(location), language_code: language }
          : { target: activeDomains[0].trim(), location_code: parseInt(location), language_code: language };

      const data: any = await fetchDomainRankOverview(requestBody);

      if (data?.tasks?.length > 0) {
        const cleaned: DomainResult[] = [];
        let hasData = false;

        data.tasks.forEach((task: any, index: number) => {
          if (task.result?.length > 0) {
            const inputDomain = activeDomains[index] || task.data?.target;
            const processed = processResult(task.result[0], inputDomain);
            if (processed) {
              cleaned.push(processed);
              hasData = true;
            } else {
              cleaned.push({
                domain: task.result[0].target || inputDomain,
                total_keywords: 0, organic_traffic: 0, paid_traffic: 0, organic_keywords: 0,
                paid_keywords: 0, top_3_count: 0, top_10_count: 0, top_100_count: 0,
                estimated_cost: 0, position_1: 0, position_2_3: 0, position_4_10: 0,
                position_11_20: 0, position_21_30: 0, position_31_40: 0, position_41_50: 0,
                position_51_100: 0,
              });
            }
          }
        });

        if (hasData) {
          setResults(cleaned);
          toast({
            title: "Success",
            description:
              activeDomains.length > 1
                ? `Comparison completed for ${cleaned.length} domains`
                : "Domain rank overview completed",
          });
        } else {
          toast({ title: "No data available", description: "No ranking data found in DataForSEO's database.", variant: "destructive" });
        }
      } else {
        toast({ title: "No results", description: "No ranking data found. The domain may be too new.", variant: "destructive" });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to fetch domain rank overview", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const isMulti = results.length > 1;

  return (
    <div className="space-y-6">
      {/* Input Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Domain Analysis
          </CardTitle>
          <CardDescription>
            {domains.length > 1
              ? "Compare multiple domains side by side."
              : "Enter a domain to get detailed ranking and traffic data."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {domains.map((domain, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="flex-1">
                  <Label htmlFor={`domain-${index}`}>
                    {domains.length > 1 ? `Domain ${index + 1}` : "Target Domain"}
                  </Label>
                  <Input
                    id={`domain-${index}`}
                    placeholder="e.g., google.com, github.com"
                    value={domain}
                    onChange={(e) => updateDomain(index, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  />
                </div>
                {domains.length > 1 && (
                  <Button variant="outline" size="icon" onClick={() => removeDomain(index)} className="mt-6">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {domains.length < 5 && (
              <Button variant="outline" onClick={addDomain} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add another domain ({domains.length}/5)
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="location">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger id="location"><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locationOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value.toString()}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="language">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language"><SelectValue placeholder="Select language" /></SelectTrigger>
                <SelectContent>
                  {languageOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleAnalyze}
            disabled={loading || domains.filter((d) => d.trim()).length === 0}
            className="w-full md:w-auto"
          >
            {loading
              ? domains.length > 1 ? "Comparing..." : "Analyzing..."
              : domains.length > 1 ? "Compare Domains" : "Get Overview"}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        isMulti ? (
          <>
            {/* 1. Winner Metric Cards */}
            <MetricWinnerCards results={results} />

            {/* 2. Radar + Position Distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ComparisonRadarChart results={results} />
              <PositionDistributionChart results={results} />
            </div>

            {/* 3. Full Detail Table */}
            <DetailComparisonTable results={results} />
          </>
        ) : (
          <SingleDomainSummary result={results[0]} />
        )
      )}
    </div>
  );
}
