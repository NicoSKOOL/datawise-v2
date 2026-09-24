import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, Download, ExternalLink, Globe, MapPin, Search, Star, Target, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";
import { fetchSerpAnalysis, searchSerpLocations } from "@/lib/dataforseo";
import { serpAnalysisToCsv } from "@/lib/serp-analysis-csv";
import { downloadCsv, slugify } from "@/lib/planner-export";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { useKeywordFilters } from "@/hooks/use-keyword-filters";

type MatchLevel = "exact" | "all" | "partial" | "none";

interface LinkStats {
  rank: number;
  backlinks: number;
  referringDomains: number;
  spamScore: number | null;
  firstSeen: string | null;
  localLinkShare: number | null;
}

interface TrafficStats {
  etv: number;
  keywords: number;
  localPackEtv: number;
}

interface SerpRow {
  position: number;
  title: string;
  url: string;
  domain: string;
  description: string;
  isHomepage: boolean;
  inLocalPack: boolean;
  rating: { value: number; votes: number } | null;
  titleMatch: MatchLevel;
  urlMatch: MatchLevel;
  page: LinkStats | null;
  site: LinkStats | null;
  pageTraffic: TrafficStats | null;
  siteTraffic: TrafficStats | null;
  reasons: Array<{ kind: "strength" | "weakness"; label: string }>;
  beatable: boolean;
}

interface LocalPackEntry {
  position: number;
  title: string;
  domain: string | null;
  url: string | null;
  rating: { value: number; votes: number } | null;
  description: string | null;
  hasOrganicListing: boolean;
}

interface SerpAnalysisResponse {
  keyword: string;
  checked_at: string | null;
  metrics: {
    search_volume: number | null;
    cpc: number | null;
    competition: number | null;
    keyword_difficulty: number | null;
    monthly_searches: Array<{ year: number; month: number; search_volume: number }>;
    search_intent: string | null;
  } | null;
  backlinks_available: boolean;
  traffic_available?: boolean;
  results: SerpRow[];
  localPack: LocalPackEntry[];
  summary: {
    organicCount: number;
    medianDomainRank: number;
    medianPageReferringDomains: number;
    medianSiteTraffic?: number | null;
    exactTitleCount: number;
    keywordInTitleCount: number;
    keywordInUrlCount: number;
    homepageCount: number;
    beatableCount: number;
    serpFeatures: string[];
    verdict: string;
  };
}

interface CityChoice {
  code: number;
  name: string;
  country: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
function fmt(n: number | null | undefined): string {
  if (n == null) return "--";
  return n >= 10000 ? compact.format(n) : n.toLocaleString();
}

function difficultyLabel(kd: number): { label: string; bar: string; chip: string } {
  if (kd < 15) return { label: "Very easy", bar: "bg-emerald-500", chip: "bg-emerald-500 text-white" };
  if (kd < 30) return { label: "Easy", bar: "bg-emerald-500", chip: "bg-emerald-500 text-white" };
  if (kd < 50) return { label: "Possible", bar: "bg-amber-500", chip: "bg-amber-500 text-white" };
  if (kd < 70) return { label: "Hard", bar: "bg-orange-500", chip: "bg-orange-500 text-white" };
  return { label: "Very hard", bar: "bg-red-500", chip: "bg-red-500 text-white" };
}

// Cell shading reads as "how hard is this result to beat", relative to the
// rest of this SERP: green = weaker than typical, red = much stronger.
type Tone = "green" | "amber" | "red" | "neutral";
function strengthTone(value: number | undefined, median: number): Tone {
  if (value == null) return "neutral";
  if (value < 5 || value <= median * 0.6) return "green";
  if (value <= Math.max(median * 1.6, 5)) return "amber";
  return "red";
}
const toneCell: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  neutral: "bg-muted text-muted-foreground",
};

function MetricCell({ value, tone, title }: { value: string; tone: Tone; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex min-w-[3.25rem] justify-center rounded-md px-2 py-1 text-xs font-semibold tabular-nums", toneCell[tone])}>
      {value}
    </span>
  );
}

function MatchCell({ level }: { level: MatchLevel }) {
  const map: Record<MatchLevel, { text: string; tone: Tone }> = {
    exact: { text: "Exact", tone: "red" },
    all: { text: "Yes", tone: "amber" },
    partial: { text: "Partial", tone: "green" },
    none: { text: "No", tone: "green" },
  };
  const m = map[level];
  return <MetricCell value={m.text} tone={m.tone} />;
}

function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Globe className="h-6 w-6 shrink-0 text-muted-foreground" />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`}
      alt=""
      className="h-6 w-6 shrink-0 rounded"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function HeaderHint({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-4">{label}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px] text-xs leading-relaxed">{hint}</TooltipContent>
    </Tooltip>
  );
}

// # | Result | Domain Rank | Page Rank | Links to page | Links to site | Est. traffic | Kw in title | Kw in URL
const RESULT_COL_WIDTHS = [56, 400, 96, 96, 100, 100, 100, 104, 112];

// A table whose header row sticks to the top of the window while you scroll
// through the rows, and settles back in place when you scroll above the table.
// CSS sticky alone cannot do this here: the table needs its own horizontal
// scroll box, and a sticky <thead> inside that box sticks to the box, not the
// page. So the header lives in a separate sticky strip with the same fixed
// column widths, and its horizontal scroll is kept in sync with the body.
function StickyHeaderTable({ colWidths, header, children }: { colWidths: number[]; header: ReactNode; children: ReactNode }) {
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const minWidth = colWidths.reduce((sum, w) => sum + w, 0);
  const tableStyle: CSSProperties = { width: "100%", minWidth, tableLayout: "fixed" };
  const cols = (
    <colgroup>
      {colWidths.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  );
  const syncScroll = () => {
    if (headRef.current && bodyRef.current) headRef.current.scrollLeft = bodyRef.current.scrollLeft;
  };
  return (
    <>
      <div ref={headRef} className="sticky top-0 z-20 overflow-hidden border-b bg-card shadow-[0_4px_6px_-4px_rgba(0,0,0,0.12)]">
        <table className="caption-bottom text-sm" style={tableStyle}>
          {cols}
          <thead>{header}</thead>
        </table>
      </div>
      <div ref={bodyRef} className="overflow-x-auto" onScroll={syncScroll}>
        <table className="caption-bottom text-sm" style={tableStyle}>
          {cols}
          <tbody className="[&_tr:last-child]:border-0">{children}</tbody>
        </table>
      </div>
    </>
  );
}

function CityPicker({ country, value, onChange }: { country: string; value: CityChoice | null; onChange: (c: CityChoice | null) => void }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Array<{ location_code: number; location_name: string; location_type: string }>>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await searchSerpLocations(country, query.trim());
        if (!cancelled) setOptions(res.locations);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, country]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (value) {
    return (
      <div className="flex h-10 items-center justify-between rounded-md border bg-background px-3 text-sm">
        <span className="flex min-w-0 items-center gap-2 truncate">
          <MapPin className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate">{value.name}</span>
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-muted-foreground hover:text-foreground" aria-label="Clear city">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id="serp-city"
        placeholder="Whole country, or type a city (e.g. Sydney)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {searching && options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Searching...</div>}
          {!searching && options.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No matching locations</div>}
          {options.map((o) => (
            <button
              key={o.location_code}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange({ code: o.location_code, name: o.location_name, country });
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="truncate">{o.location_name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{o.location_type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SerpAnalysis() {
  const { keyword, setKeyword, location, setLocation, language, setLanguage } = useKeywordFilters();
  const [city, setCity] = usePersistentState<CityChoice | null>("serp-analysis:city", null);
  const [data, setData] = usePersistentState<SerpAnalysisResponse | null>("serp-analysis:data", null);
  const [searchedLabel, setSearchedLabel] = usePersistentState<string>("serp-analysis:label", "");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const { toast } = useToast();

  const country = locationOptions.find((o) => o.value.toString() === location);
  const countryIso = country?.countryCode ?? "US";
  const activeCity = city && city.country === countryIso ? city : null;

  const handleAnalyze = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setExpanded(new Set());
    try {
      const res = (await fetchSerpAnalysis({
        keyword: keyword.trim(),
        location_code: parseInt(location),
        serp_location_code: activeCity?.code,
        language_code: language,
        country_iso: countryIso,
        country_label: country?.label,
      })) as SerpAnalysisResponse;
      setData(res);
      setSearchedLabel(activeCity ? activeCity.name.replace(/,/g, ", ") : country?.label ?? "");
    } catch (error: unknown) {
      toast({ title: "SERP analysis failed", description: error instanceof Error ? error.message : "Please try again", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const csv = serpAnalysisToCsv(data.results);
    downloadCsv(`serp-analysis-${slugify(data.keyword)}-${slugify(searchedLabel.split(",")[0] || "location")}.csv`, csv);
  };

  const toggle = (pos: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });

  const m = data?.metrics;
  const kd = m?.keyword_difficulty ?? null;
  const kdInfo = kd != null ? difficultyLabel(kd) : null;
  const trend = (m?.monthly_searches ?? []).map((p) => ({ label: `${MONTHS[p.month - 1]} ${String(p.year).slice(2)}`, volume: p.search_volume }));
  const s = data?.summary;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            SERP Analysis
          </CardTitle>
          <CardDescription>
            See who ranks on page one for a keyword in a specific place, and the signals that explain why they rank.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="serp-keyword">Keyword</Label>
            <Input
              id="serp-keyword"
              placeholder="e.g., pressure washing sydney"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="serp-country">Country</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger id="serp-country">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value.toString()}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="serp-city">City or region (optional)</Label>
              <CityPicker country={countryIso} value={activeCity} onChange={setCity} />
            </div>
            <div>
              <Label htmlFor="serp-language">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="serp-language">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleAnalyze} disabled={loading || !keyword.trim()} className="w-full md:w-auto">
              <Search className="mr-2 h-4 w-4" />
              {loading ? "Checking Google..." : "Analyze SERP"}
            </Button>
            <span className="text-xs text-muted-foreground">Live Google results. Uses 2 credits on the free plan.</span>
          </div>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pulling the live results and the link data behind each one. This takes 10 to 20 seconds.
          </CardContent>
        </Card>
      )}

      {!loading && data && s && (
        <>
          <Card>
            <CardContent className="space-y-5 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold">{data.keyword}</h2>
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {searchedLabel}
                    {data.checked_at && <span>· checked {new Date(data.checked_at.replace(" +00:00", "Z")).toLocaleDateString()}</span>}
                  </p>
                </div>
                {kdInfo && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">Difficulty: {kdInfo.label}</span>
                    <span className={cn("rounded-md px-3 py-1.5 text-lg font-bold tabular-nums", kdInfo.chip)}>{kd}</span>
                  </div>
                )}
              </div>
              {kdInfo && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className={cn("h-full rounded-full", kdInfo.bar)} style={{ width: `${Math.max(kd ?? 0, 2)}%` }} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: "Monthly volume", value: fmt(m?.search_volume) },
                  { label: "CPC", value: m?.cpc != null ? `$${m.cpc.toFixed(2)}` : "--" },
                  { label: "Ad competition", value: m?.competition != null ? m.competition.toFixed(2) : "--" },
                  { label: "Search intent", value: m?.search_intent ? m.search_intent[0].toUpperCase() + m.search_intent.slice(1) : "--" },
                ].map((t) => (
                  <div key={t.label} className="rounded-lg border bg-muted/30 px-4 py-3 text-center">
                    <div className="text-xs text-muted-foreground">{t.label}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{t.value}</div>
                  </div>
                ))}
              </div>
              {activeCity && m && (
                <p className="text-xs text-muted-foreground">
                  Volume, CPC and difficulty are {country?.label}-wide figures. The results below are what Google shows searchers in {searchedLabel.split(",")[0]}.
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">What it takes to rank here</CardTitle>
              <CardDescription className="text-sm leading-relaxed text-foreground/80">{s.verdict}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                {[
                  { label: "Typical Domain Rank", value: String(s.medianDomainRank) },
                  { label: "Typical links to page", value: `${s.medianPageReferringDomains} sites` },
                  { label: "Typical site traffic", value: s.medianSiteTraffic != null ? `${fmt(s.medianSiteTraffic)}/mo` : "--" },
                  { label: "Keyword in title", value: `${s.keywordInTitleCount} of ${s.organicCount}` },
                  { label: "Homepages ranking", value: `${s.homepageCount} of ${s.organicCount}` },
                  { label: "Weak spots", value: `${s.beatableCount} of ${s.organicCount}` },
                ].map((t) => (
                  <div key={t.label} className="rounded-lg border px-3 py-2.5">
                    <div className="text-xs text-muted-foreground">{t.label}</div>
                    <div className="mt-0.5 text-base font-semibold tabular-nums">{t.value}</div>
                  </div>
                ))}
              </div>
              {s.serpFeatures.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">On this results page:</span>
                  {s.serpFeatures.map((f) => (
                    <Badge key={f} variant="secondary">{f}</Badge>
                  ))}
                </div>
              )}
              {!data.backlinks_available && (
                <p className="text-xs text-amber-600">Link data could not be loaded for this search, so authority columns are empty.</p>
              )}
            </CardContent>
          </Card>

          {trend.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Search trend</CardTitle>
                <CardDescription>Monthly searches, past {trend.length} months ({country?.label})</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="serpTrendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} tickFormatter={(v) => compact.format(v)} />
                      <ChartTooltip formatter={(v: number) => [v.toLocaleString(), "Searches"]} />
                      <Area type="monotone" dataKey="volume" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#serpTrendFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {data.localPack.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Local Pack</CardTitle>
                <CardDescription>The map results Google shows above the organic listings</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-3">
                {data.localPack.map((lp) => (
                  <div key={`${lp.position}-${lp.title}`} className="rounded-lg border p-3">
                    <div className="flex items-start gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{lp.position}</span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{lp.title}</div>
                        {lp.rating && (
                          <div className="mt-0.5 flex items-center gap-1 text-sm">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                            <span className="font-medium">{lp.rating.value}</span>
                            <span className="text-muted-foreground">({lp.rating.votes.toLocaleString()} reviews)</span>
                          </div>
                        )}
                        {lp.domain && <div className="truncate text-xs text-muted-foreground">{lp.domain}</div>}
                        {lp.hasOrganicListing && <Badge variant="secondary" className="mt-2 text-[11px]">Also ranks organically</Badge>}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Who ranks and why</CardTitle>
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download className="mr-2 h-4 w-4" />
                  Export CSV
                </Button>
              </div>
              <CardDescription>
                Colors show how hard each result is to beat compared with the rest of this page: green is weaker, red is stronger. Click a row to see why it ranks.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <StickyHeaderTable
                colWidths={RESULT_COL_WIDTHS}
                header={
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">#</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead className="text-center"><HeaderHint label="Domain Rank" hint="DataForSEO authority score for the whole site, 0 to 100. Similar in spirit to DA or DR." /></TableHead>
                      <TableHead className="text-center"><HeaderHint label="Page Rank" hint="DataForSEO authority score for this exact page, 0 to 100." /></TableHead>
                      <TableHead className="text-center"><HeaderHint label="Links to page" hint="Number of unique websites linking to this exact page." /></TableHead>
                      <TableHead className="text-center"><HeaderHint label="Links to site" hint="Number of unique websites linking anywhere on this domain." /></TableHead>
                      <TableHead className="text-center"><HeaderHint label="Est. traffic" hint="Estimated monthly visits the whole site gets from Google organic search in this country (DataForSEO). Hover a value for keyword counts." /></TableHead>
                      <TableHead className="text-center"><HeaderHint label="Keyword in title" hint="Exact = the full phrase appears. Yes = every word appears. Partial = some words." /></TableHead>
                      <TableHead className="pr-6 text-center"><HeaderHint label="Keyword in URL" hint="Whether the keyword words appear in the domain or page address." /></TableHead>
                    </TableRow>
                }
              >
                    {data.results.map((r) => {
                      const isOpen = expanded.has(r.position);
                      const strengths = r.reasons.filter((x) => x.kind === "strength");
                      const weaknesses = r.reasons.filter((x) => x.kind === "weakness");
                      return (
                        <Fragment key={r.position}>
                          <TableRow className="cursor-pointer" onClick={() => toggle(r.position)}>
                            <TableCell className="pl-6 align-top font-semibold tabular-nums">{r.position}</TableCell>
                            <TableCell className="align-top">
                              <div className="flex items-start gap-3">
                                <Favicon domain={r.domain} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                                    <span className="line-clamp-1 font-medium">{r.title}</span>
                                  </div>
                                  <a
                                    href={r.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex max-w-[360px] items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary"
                                  >
                                    <span className="truncate">{r.url.replace(/^https?:\/\//, "")}</span>
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                  </a>
                                  <div className="mt-1.5 flex flex-wrap gap-1">
                                    {r.beatable && <Badge className="bg-emerald-600 text-[11px] hover:bg-emerald-600">Weak spot</Badge>}
                                    {r.inLocalPack && <Badge variant="secondary" className="text-[11px]">In Local Pack</Badge>}
                                    {r.isHomepage && <Badge variant="outline" className="text-[11px]">Homepage</Badge>}
                                    {r.rating && (
                                      <Badge variant="outline" className="gap-1 text-[11px]">
                                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                        {r.rating.value} ({fmt(r.rating.votes)})
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-center align-top"><MetricCell value={r.site ? String(r.site.rank) : "--"} tone={strengthTone(r.site?.rank, s.medianDomainRank)} /></TableCell>
                            <TableCell className="text-center align-top"><MetricCell value={r.page ? String(r.page.rank) : "--"} tone={strengthTone(r.page?.rank, median(data.results.map((x) => x.page?.rank ?? 0)))} /></TableCell>
                            <TableCell className="text-center align-top"><MetricCell value={fmt(r.page?.referringDomains)} tone={strengthTone(r.page?.referringDomains, s.medianPageReferringDomains)} title={r.page ? `${r.page.backlinks.toLocaleString()} backlinks` : undefined} /></TableCell>
                            <TableCell className="text-center align-top"><MetricCell value={fmt(r.site?.referringDomains)} tone={strengthTone(r.site?.referringDomains, median(data.results.map((x) => x.site?.referringDomains ?? 0)))} title={r.site ? `${r.site.backlinks.toLocaleString()} backlinks` : undefined} /></TableCell>
                            <TableCell className="text-center align-top">
                              <MetricCell
                                value={r.siteTraffic ? fmt(r.siteTraffic.etv) : "--"}
                                tone={r.siteTraffic && s.medianSiteTraffic != null ? strengthTone(r.siteTraffic.etv, s.medianSiteTraffic) : "neutral"}
                                title={r.siteTraffic ? `${r.siteTraffic.keywords.toLocaleString()} ranking keywords site-wide${r.pageTraffic ? `; this page ~${r.pageTraffic.etv.toLocaleString()}/mo from ${r.pageTraffic.keywords.toLocaleString()} keywords` : ""}${r.siteTraffic.localPackEtv ? `; ~${r.siteTraffic.localPackEtv.toLocaleString()}/mo from Local Pack` : ""}` : undefined}
                              />
                            </TableCell>
                            <TableCell className="text-center align-top"><MatchCell level={r.titleMatch} /></TableCell>
                            <TableCell className="pr-6 text-center align-top"><MatchCell level={r.urlMatch} /></TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell />
                              <TableCell colSpan={8} className="pb-4 pr-6">
                                <div className="grid gap-4 md:grid-cols-2">
                                  <div>
                                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Why it ranks</div>
                                    {strengths.length === 0 ? (
                                      <p className="text-sm text-muted-foreground">No standout signals. Content relevance or engagement may be carrying it.</p>
                                    ) : (
                                      <ul className="space-y-1 text-sm">
                                        {strengths.map((x) => <li key={x.label}>+ {x.label}</li>)}
                                      </ul>
                                    )}
                                  </div>
                                  <div>
                                    <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">Where it is vulnerable</div>
                                    {weaknesses.length === 0 ? (
                                      <p className="text-sm text-muted-foreground">No obvious gaps.</p>
                                    ) : (
                                      <ul className="space-y-1 text-sm">
                                        {weaknesses.map((x) => <li key={x.label}>- {x.label}</li>)}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                                {r.description && <p className="mt-3 text-xs text-muted-foreground">Snippet: {r.description}</p>}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
              </StickyHeaderTable>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
