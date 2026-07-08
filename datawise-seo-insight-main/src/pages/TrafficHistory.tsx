import { useMemo, useState } from "react";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, Download } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { fetchTrafficHistory } from "@/lib/dataforseo";
import { useToast } from "@/components/ui/use-toast";
import { downloadCSV } from "@/lib/csvUtils";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";

interface TrafficHistoryMonth {
  date: string;
  organic_etv: number;
  organic_count: number;
  paid_etv: number;
  paid_count: number;
}

interface TargetSeries {
  target: string;
  months: TrafficHistoryMonth[];
}

// Deliberately far-apart hues so up to 10 compared domains stay tellable
// apart (feedback 25747527: competitor lines "look almost the same color").
const SERIES_COLORS = [
  "#047857", "#2563eb", "#dc2626", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#65a30d", "#475569", "#b45309",
];

const RANGE_OPTIONS = [
  { value: "6", label: "Last 6 months" },
  { value: "12", label: "Last 12 months" },
  { value: "24", label: "Last 24 months" },
];

function monthLabel(date: string): string {
  const [y, m] = date.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function pctChange(first: number, last: number): string {
  if (first <= 0) return last > 0 ? "new" : "--";
  const pct = Math.round(((last - first) / first) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

export default function TrafficHistory() {
  const [targets, setTargets] = usePersistentState<string>("competitor:traffic-history:targets", "");
  const [scope, setScope] = usePersistentState<string>("competitor:traffic-history:scope", "all");
  const [language, setLanguage] = usePersistentState<string>("competitor:traffic-history:language", "en");
  const [months, setMonths] = usePersistentState<string>("competitor:traffic-history:months", "12");
  const [series, setSeries] = usePersistentState<TargetSeries[]>("competitor:traffic-history:series", []);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleAnalyze = async () => {
    const targetList = targets.split("\n").map((t) => t.trim()).filter(Boolean);
    if (targetList.length === 0) return;
    if (targetList.length > 10) {
      toast({ title: "Too many domains", description: "Enter up to 10 domains per run.", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const data = await fetchTrafficHistory({
        targets: targetList,
        months: parseInt(months),
        ...(scope !== "all" ? { location_code: parseInt(scope), language_code: language } : {}),
      });
      const withData = (data.targets || []).filter((t) => t.months.length > 0);
      setSeries(data.targets || []);
      if (withData.length === 0) {
        toast({ title: "No history found", description: "DataForSEO has no ranked-keyword history for these domains in this scope. Try Worldwide." });
      } else {
        toast({ title: "Success", description: `Traffic history loaded for ${withData.length} domain${withData.length === 1 ? "" : "s"}.` });
      }
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to fetch traffic history", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // One chart row per month, one key per domain, so recharts draws a line per
  // domain over a shared x-axis even when a domain is missing some months.
  const chartData = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    for (const s of series) {
      for (const m of s.months) {
        const row = rows.get(m.date) ?? { date: m.date };
        row[s.target] = m.organic_etv;
        rows.set(m.date, row);
      }
    }
    return [...rows.values()]
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((r) => ({ ...r, label: monthLabel(String(r.date)) }));
  }, [series]);

  const summaries = useMemo(() => series.map((s, i) => {
    const first = s.months[0];
    const last = s.months[s.months.length - 1];
    return {
      target: s.target,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      latest: last?.organic_etv ?? 0,
      latestKeywords: last?.organic_count ?? 0,
      change: first && last ? pctChange(first.organic_etv, last.organic_etv) : "--",
      hasData: s.months.length > 0,
    };
  }), [series]);

  const handleExport = () => {
    const rows = series.flatMap((s) => s.months.map((m) => ({
      domain: s.target,
      month: m.date.slice(0, 7),
      organic_traffic: m.organic_etv,
      organic_keywords: m.organic_count,
      paid_traffic: m.paid_etv,
      paid_keywords: m.paid_count,
    })));
    downloadCSV(rows, `traffic-history-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Traffic Trends</h1>
        <p className="text-muted-foreground">
          Estimated monthly organic traffic for any domain over time, no Search Console access needed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Historical Traffic Estimation
          </CardTitle>
          <CardDescription>
            Enter up to 10 domains (one per line) to compare their estimated organic traffic month by month
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="traffic-history-targets">Domains (one per line)</Label>
            <Textarea
              id="traffic-history-targets"
              placeholder={"calixpert.com\ncompetitor.com"}
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              className="w-full min-h-[100px]"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="traffic-history-range">Time Range</Label>
              <Select value={months} onValueChange={setMonths}>
                <SelectTrigger id="traffic-history-range">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="traffic-history-scope">Market</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger id="traffic-history-scope">
                  <SelectValue placeholder="Select market" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Worldwide (all markets)</SelectItem>
                  {locationOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value.toString()}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {scope !== "all" && (
              <div>
                <Label htmlFor="traffic-history-language">Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="traffic-history-language">
                    <SelectValue placeholder="Select language" />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="flex justify-start">
            <Button onClick={handleAnalyze} disabled={loading || !targets.trim()} className="w-full md:w-auto">
              {loading ? "Loading history..." : "Show Traffic Trends"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {summaries.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {summaries.map((s) => (
            <Card key={s.target}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="truncate">{s.target}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {s.hasData ? (
                  <>
                    <div className="text-2xl font-bold">{s.latest.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">
                      est. monthly organic visits · {s.change} over period · {s.latestKeywords.toLocaleString()} keywords
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No ranked-keyword history in this scope</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-sm font-medium">Estimated Organic Traffic</CardTitle>
              <CardDescription className="text-xs">
                Monthly estimate from ranked keywords (search volume x CTR by position), the same method Ahrefs and Semrush use
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString()}k` : String(v))}
                />
                <Tooltip
                  contentStyle={{ borderRadius: "8px", fontSize: "12px", border: "1px solid #e5e7eb" }}
                  formatter={(value: number) => value.toLocaleString()}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                {series.map((s, i) => (
                  <Line
                    key={s.target}
                    type="monotone"
                    dataKey={s.target}
                    stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 2.5 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
