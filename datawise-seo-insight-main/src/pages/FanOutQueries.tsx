import { useEffect, useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, Info, Search, Hash, TrendingUp, BarChart3, Zap } from 'lucide-react';
import {
  fetchLlmSearch,
  fetchLlmKeywordVolume,
  type LlmSearchRow,
  type LlmMonthlySearch,
} from '@/lib/llm-mentions';
import { LlmAnswerDrawer } from '@/components/llm-mentions/LlmAnswerDrawer';
import { StatItem } from '@/components/llm-mentions/StatItem';
import { downloadCSV } from '@/lib/csvUtils';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';
import { useDefaults } from '@/hooks/use-defaults';
import { AddToPlannerButton } from '@/components/planner/AddToPlannerButton';
import { BulkSaveToPlannerButton } from '@/components/planner/BulkSaveToPlannerButton';
import { normalizePlannerKeyword } from '@/lib/planner-keyword-selection';
import type { PlannerItemInput } from '@/lib/planner';

type Platform = 'google' | 'chat_gpt';
type SortKey = 'volume-desc' | 'volume-asc' | 'sources-desc' | 'alpha';
type TypeFilter = 'all' | 'question' | 'fanout';

function fmt(n: number | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface FanOutRow {
  query: string;
  ai_search_volume: number;
  trend: LlmMonthlySearch[];
  platform: string;
  source_count: number;
  type: 'Fan-out' | 'Question';
}

function Sparkline({ data }: { data: LlmMonthlySearch[] }) {
  if (!data || data.length === 0) return <span className="text-muted-foreground text-xs">--</span>;
  const vals = data.map((d) => d.ai_search_volume);
  const allZero = vals.every((v) => v === 0);
  if (allZero) return <span className="text-muted-foreground text-xs">--</span>;

  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const width = 100;
  const height = 28;
  const step = width / (vals.length - 1 || 1);

  const points = vals
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(' ');

  const first = vals[0];
  const last = vals[vals.length - 1];
  const colorClass =
    last > first
      ? 'text-emerald-500'
      : last < first
      ? 'text-rose-500'
      : 'text-muted-foreground';

  const polygonPoints =
    points +
    ` ${(vals.length - 1) * step},${height} 0,${height}`;

  return (
    <svg width={width} height={height} className={`overflow-visible ${colorClass}`}>
      <polygon
        points={polygonPoints}
        fill="currentColor"
        fillOpacity="0.15"
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export default function FanOutQueries() {
  const { defaultLocation, defaultLanguage } = useDefaults();
  const [seed, setSeed] = useState('');
  // Fan-out queries are only populated on ChatGPT rows. Google AI Overview does
  // not expose fan_out_queries[] in the DFS LLM Mentions index.
  const [platform, setPlatform] = useState<Platform>('chat_gpt');
  const [location, setLocation] = useState(defaultLocation);
  const [language, setLanguage] = useState(defaultLanguage);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [rows, setRows] = useState<FanOutRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastSearched, setLastSearched] = useState('');

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState('');
  const [drawerRows, setDrawerRows] = useState<LlmSearchRow[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Table controls
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('volume-desc');
  const [selectedQueryKeys, setSelectedQueryKeys] = useState<Set<string>>(new Set());

  // DFS LLM Mentions: ChatGPT data is indexed US + English only. Any other
  // location/language combo returns zero rows. Force US/EN when platform is
  // chat_gpt regardless of the user's saved defaults.
  const effectiveLocation = platform === 'chat_gpt' ? 2840 : parseInt(location);
  const effectiveLanguage = platform === 'chat_gpt' ? 'en' : language;

  const handleExplore = async () => {
    // DFS is case-sensitive on `partial_match` — lowercase before sending.
    // Also strip leading/trailing whitespace and collapse internal runs.
    const cleanSeed = seed.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!cleanSeed) return;

    // DFS silently returns zero rows for very short tokens. Warn early.
    if (cleanSeed.length < 3) {
      setError(`"${cleanSeed}" is too short. Try at least 3 characters — e.g., "seo" or "ai search".`);
      return;
    }

    setLoading(true);
    setEnriching(false);
    setRows([]);
    setError(null);
    setLastSearched(cleanSeed);

    let deduped: Array<[string, { raw: string; sourceCount: number; type: 'Fan-out' | 'Question' }]> = [];

    try {
      // Step 1 (fast, ~1-5s): fetch the matching prompts. Each returned row
      // has a `fan_out_queries[]` field (ChatGPT only) that we explode into
      // individual discovered queries. `search_scope: ["fan_out_queries"]` as
      // a filter returns nothing in practice, so we don't use it.
      const searchResult = await fetchLlmSearch({
        target: [
          {
            keyword: cleanSeed,
            match_type: 'partial_match',
          },
        ],
        platform,
        location_code: effectiveLocation,
        language_code: effectiveLanguage,
        limit: 100,
      });

      const searchRows = searchResult.items || [];

      const seen = new Map<string, { raw: string; sourceCount: number; type: 'Fan-out' | 'Question' }>();

      for (const row of searchRows) {
        const q = row.question?.trim();
        if (q) {
          const key = q.toLowerCase();
          if (!seen.has(key)) seen.set(key, { raw: q, sourceCount: 1, type: 'Question' });
          else seen.get(key)!.sourceCount++;
        }

        for (const fq of row.fan_out_queries || []) {
          const f = fq.trim();
          if (!f) continue;
          const key = f.toLowerCase();
          if (!seen.has(key)) seen.set(key, { raw: f, sourceCount: 1, type: 'Fan-out' });
          else seen.get(key)!.sourceCount++;
        }
      }

      deduped = Array.from(seen.entries()).slice(0, 300);

      // Render immediately with zero-volume so the user sees results in ~1-5s,
      // sorted by source count as a reasonable default until volumes arrive.
      const initialRows: FanOutRow[] = deduped
        .map(([, v]) => ({
          query: v.raw,
          ai_search_volume: 0,
          trend: [],
          platform: platform === 'google' ? 'Google AIO' : 'ChatGPT',
          source_count: v.sourceCount,
          type: v.type,
        }))
        .sort((a, b) => b.source_count - a.source_count);
      setRows(initialRows);
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
      return;
    } finally {
      setLoading(false);
    }

    // Step 2 (slow, ~15-25s): enrich with AI search volume in the background.
    // Non-blocking — the user is already looking at rows while this runs.
    if (deduped.length === 0) return;

    setEnriching(true);
    try {
      const keywords = deduped.map(([, v]) => v.raw).slice(0, 1000);
      const volResult = await fetchLlmKeywordVolume({
        keywords,
        location_code: effectiveLocation,
        language_code: effectiveLanguage,
      });
      const volumeMap = new Map<string, { volume: number; trend: LlmMonthlySearch[] }>();
      for (const item of volResult.items || []) {
        volumeMap.set(item.keyword.toLowerCase(), {
          volume: item.ai_search_volume,
          trend: item.ai_monthly_searches || [],
        });
      }

      setRows((prev) => {
        const updated = prev.map((r) => {
          const vol = volumeMap.get(r.query.toLowerCase());
          return vol
            ? { ...r, ai_search_volume: vol.volume, trend: vol.trend }
            : r;
        });
        // Now re-sort by volume since we have real numbers
        updated.sort((a, b) => b.ai_search_volume - a.ai_search_volume);
        return updated;
      });
    } catch {
      // Volume enrichment is best-effort — leave rows with source_count sort
    } finally {
      setEnriching(false);
    }
  };

  const handleRowClick = useCallback(async (row: FanOutRow) => {
    setDrawerQuery(row.query);
    setDrawerRows([]);
    setDrawerLoading(true);
    setDrawerError(null);
    setDrawerOpen(true);

    try {
      const result = await fetchLlmSearch({
        target: [{ keyword: row.query, search_scope: ['question'], match_type: 'partial_match' }],
        platform,
        location_code: platform === 'chat_gpt' ? 2840 : parseInt(location),
        language_code: platform === 'chat_gpt' ? 'en' : language,
        limit: 5,
      });
      setDrawerRows(result.items || []);
    } catch (e) {
      setDrawerError((e as Error).message);
    } finally {
      setDrawerLoading(false);
    }
  }, [platform, location, language]);

  const handleExport = () => {
    const exportRows = rows.map((r) => ({
      query: r.query,
      ai_search_volume: r.ai_search_volume,
      platform: r.platform,
      source_count: r.source_count,
      type: r.type,
    }));
    downloadCSV(exportRows, `fan-out-queries-${seed}`);
  };

  // KPI derived values
  const withVolume = rows.filter((r) => r.ai_search_volume > 0);
  const totalVolume = rows.reduce((s, r) => s + r.ai_search_volume, 0);
  const topRow = rows[0];

  // Filtered + sorted table rows
  const displayRows = useMemo(() => {
    let result = rows;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.query.toLowerCase().includes(q));
    }

    if (typeFilter === 'question') {
      result = result.filter((r) => r.type === 'Question');
    } else if (typeFilter === 'fanout') {
      result = result.filter((r) => r.type === 'Fan-out');
    }

    result = [...result].sort((a, b) => {
      if (sortKey === 'volume-desc') return b.ai_search_volume - a.ai_search_volume;
      if (sortKey === 'volume-asc') return a.ai_search_volume - b.ai_search_volume;
      if (sortKey === 'sources-desc') return b.source_count - a.source_count;
      if (sortKey === 'alpha') return a.query.localeCompare(b.query);
      return 0;
    });

    return result;
  }, [rows, search, typeFilter, sortKey]);

  const rowSignature = useMemo(
    () => rows.map((row) => normalizePlannerKeyword(row.query)).join('\u001f'),
    [rows],
  );

  useEffect(() => {
    setSelectedQueryKeys(new Set());
  }, [rowSignature]);

  const visibleQueryKeys = useMemo(
    () => displayRows.map((row) => normalizePlannerKeyword(row.query)).filter(Boolean),
    [displayRows],
  );
  const allVisibleSelected = visibleQueryKeys.length > 0
    && visibleQueryKeys.every((key) => selectedQueryKeys.has(key));
  const someVisibleSelected = !allVisibleSelected
    && visibleQueryKeys.some((key) => selectedQueryKeys.has(key));

  const selectedPlannerItems = useMemo<PlannerItemInput[]>(() => {
    const seen = new Set<string>();
    return displayRows.flatMap((row) => {
      const keywordKey = normalizePlannerKeyword(row.query);
      if (!keywordKey || !selectedQueryKeys.has(keywordKey) || seen.has(keywordKey)) return [];
      seen.add(keywordKey);

      return [{
        keyword: keywordKey,
        intent: row.type === 'Fan-out' ? 'fan_out' : 'informational',
        source: 'fan-out-queries',
        search_volume: row.ai_search_volume || null,
        source_context: {
          seed_keyword: seed,
          platform: row.platform,
          type: row.type,
          source_count: row.source_count,
          result: row,
        },
      }];
    });
  }, [displayRows, seed, selectedQueryKeys]);

  const toggleQuerySelection = (keywordKey: string, checked: boolean) => {
    setSelectedQueryKeys((current) => {
      const next = new Set(current);
      if (!keywordKey) return next;
      if (checked) next.add(keywordKey);
      else next.delete(keywordKey);
      return next;
    });
  };

  const hasResults = rows.length > 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Fan-out Queries</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[320px] text-xs leading-relaxed">
                Fan-out queries are the follow-up questions LLMs internally generate from your seed keyword to answer a user's query. They reveal the real sub-topics AI models associate with your topic.
              </TooltipContent>
            </Tooltip>
          </div>
          <p className="text-muted-foreground text-sm">
            Discover the questions AI models generate around a topic and their search volume.
          </p>
        </div>
      </div>

      {/* Explore card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Explore a topic
          </CardTitle>
          <CardDescription>Enter a seed keyword to discover AI-generated follow-up queries.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Seed + platform always visible */}
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="fo-seed">Seed keyword</Label>
              <Input
                id="fo-seed"
                placeholder="e.g., seo analytics"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExplore()}
              />
            </div>

            <div className="space-y-1.5 min-w-[180px]">
              <div className="flex items-center gap-1">
                <Label htmlFor="fo-platform">Platform</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-xs leading-relaxed">
                    Fan-out queries are only populated by ChatGPT. Google AI Overview does not expose internal sub-query expansion in the DataForSEO index. ChatGPT data is US + English only.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger id="fo-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat_gpt">ChatGPT (recommended)</SelectItem>
                  <SelectItem value="google">Google AI Overview (no fan-out)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {platform === 'chat_gpt' && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/50 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                ChatGPT data in DataForSEO is indexed for <strong>United States + English only</strong>.
                Your location and language settings below will be ignored for this query.
                Switch to "Google AI Overview" if you need results for a different market (though
                fan-out queries won't be populated).
              </span>
            </div>
          )}

          {/* Advanced: location + language collapsed */}
          <details className="group">
            <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none list-none flex items-center gap-1">
              <span className="border border-border rounded px-1.5 py-0.5 text-[11px] font-medium group-open:hidden">Advanced</span>
              <span className="border border-border rounded px-1.5 py-0.5 text-[11px] font-medium hidden group-open:inline">Hide advanced</span>
            </summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              <div className="space-y-1.5">
                <Label htmlFor="fo-location">Location</Label>
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger id="fo-location">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {locationOptions.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fo-language">Language</Label>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="fo-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </details>

          <div className="flex justify-start">
            <Button onClick={handleExplore} disabled={loading || !seed.trim()} className="gap-2">
              {loading ? 'Exploring...' : 'Explore'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* KPI strip */}
      {hasResults && (
        <Card>
          <CardContent className="pt-4 pb-2">
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-border">
              <StatItem
                icon={Hash}
                label="Total Queries"
                value={String(rows.length)}
                loading={false}
                accent="blue"
                help="Total fan-out queries and related questions discovered from your seed keyword."
              />
              <StatItem
                icon={Zap}
                label="With AI Volume"
                value={`${withVolume.length}`}
                subtitle={rows.length > 0 ? `${Math.round((withVolume.length / rows.length) * 100)}% of total` : undefined}
                loading={false}
                accent="green"
                help="Queries that have measurable monthly AI search volume. These are proven topics users are asking LLMs about."
              />
              <StatItem
                icon={TrendingUp}
                label="Total Volume"
                value={fmt(totalVolume)}
                loading={false}
                accent="purple"
                help="Combined monthly AI search volume across all discovered queries."
              />
              <StatItem
                icon={BarChart3}
                label="Top Query Volume"
                value={topRow ? fmt(topRow.ai_search_volume) : '0'}
                subtitle={topRow ? topRow.query.slice(0, 40) : undefined}
                loading={false}
                accent="orange"
                help="The single highest-volume query from your discovery. Targeting this with content has the most AI visibility upside."
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results table */}
      {(loading || hasResults) && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  Fan-out Queries
                  {enriching && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 text-[10px] font-medium px-2 py-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                      Loading volume data...
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="mt-0.5">
                  {loading
                    ? 'Discovering queries...'
                    : enriching
                    ? `${rows.length} queries found. Enriching with AI search volume (about 20 seconds)...`
                    : `${rows.length} queries discovered from "${seed}"${displayRows.length !== rows.length ? `, ${displayRows.length} shown` : ''}`}
                </CardDescription>
              </div>
            </div>

            {hasResults && !loading && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Input
                  placeholder="Search queries..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 text-sm max-w-[220px]"
                />
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
                  <SelectTrigger className="h-8 text-sm w-[150px]">
                    <SelectValue placeholder="All types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="question">Questions only</SelectItem>
                    <SelectItem value="fanout">Fan-out only</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger className="h-8 text-sm w-[160px]">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="volume-desc">Highest volume</SelectItem>
                    <SelectItem value="volume-asc">Lowest volume</SelectItem>
                    <SelectItem value="sources-desc">Most sources</SelectItem>
                    <SelectItem value="alpha">Query A-Z</SelectItem>
                  </SelectContent>
                </Select>
                <BulkSaveToPlannerButton
                  items={selectedPlannerItems}
                  onSaved={() => setSelectedQueryKeys(new Set())}
                  className="ml-auto h-8"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  className="gap-2 h-8"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </Button>
              </div>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-10 w-full rounded bg-muted animate-pulse" />
                ))}
              </div>
            ) : displayRows.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">No queries match your filters.</p>
            ) : (
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Select all visible queries"
                          checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
                          disabled={visibleQueryKeys.length === 0}
                          onCheckedChange={(checked) => {
                            setSelectedQueryKeys((current) => {
                              const next = new Set(current);
                              if (checked === true) {
                                visibleQueryKeys.forEach((key) => next.add(key));
                              } else {
                                visibleQueryKeys.forEach((key) => next.delete(key));
                              }
                              return next;
                            });
                          }}
                        />
                      </TableHead>
                      <TableHead className="w-10 text-right pr-2">#</TableHead>
                      <TableHead>Query</TableHead>
                      <TableHead className="w-[110px]">
                        <div className="flex items-center gap-1">
                          Type
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-3 w-3 text-muted-foreground/60 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
                              <strong>Fan-out:</strong> A sub-query the LLM generated internally while answering a broader question. Reveals topics the model associates with your seed.
                              <br /><br />
                              <strong>Question:</strong> A user-facing question whose LLM answer cited or mentioned this topic. Represents real user search intent.
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TableHead>
                      <TableHead className="w-[100px] text-right">AI Volume</TableHead>
                      <TableHead className="w-[120px]">Trend</TableHead>
                      <TableHead className="w-[80px]">Sources</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayRows.map((row, i) => (
                      <TableRow
                        key={`${normalizePlannerKeyword(row.query)}-${i}`}
                        onClick={() => handleRowClick(row)}
                        className="cursor-pointer hover:bg-muted/50"
                      >
                        <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select ${row.query}`}
                            checked={selectedQueryKeys.has(normalizePlannerKeyword(row.query))}
                            disabled={!normalizePlannerKeyword(row.query)}
                            onCheckedChange={(checked) => {
                              toggleQuerySelection(normalizePlannerKeyword(row.query), checked === true);
                            }}
                          />
                        </TableCell>
                        <TableCell className="w-10 text-right text-xs text-muted-foreground pr-2">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-medium">
                          <p className="line-clamp-2 text-sm leading-snug">{row.query}</p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={row.type === 'Fan-out' ? 'secondary' : 'outline'}
                            className="text-[11px]"
                          >
                            {row.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {row.ai_search_volume > 0 ? fmt(row.ai_search_volume) : (
                            <span className="text-muted-foreground text-xs">--</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Sparkline data={row.trend} />
                        </TableCell>
                        <TableCell>
                          {row.source_count > 0 ? (
                            <Badge variant="secondary" className="text-xs tabular-nums">
                              {row.source_count}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="w-12 text-right">
                          <AddToPlannerButton
                            keyword={row.query}
                            source="fan-out-queries"
                            sourceContext={{
                              seed_keyword: seed,
                              platform: row.platform,
                              type: row.type,
                              source_count: row.source_count,
                            }}
                            metrics={{ search_volume: row.ai_search_volume || null }}
                            defaultIntent={row.type === 'Fan-out' ? 'fan_out' : 'informational'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && rows.length === 0 && !error && (
        <Card>
          <CardContent className="pt-6 text-center space-y-2">
            {lastSearched ? (
              <>
                <p className="text-sm font-medium">
                  No queries found for <span className="font-mono">"{lastSearched}"</span>
                </p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  DataForSEO indexes exact phrase matches, so rare or multi-word seeds often
                  return nothing. Try a broader single word or a more common phrase — for
                  example <span className="font-mono">seo</span>,{' '}
                  <span className="font-mono">ai search</span>, or{' '}
                  <span className="font-mono">local seo</span>.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter a seed keyword above and click Explore to discover AI-generated queries.
                </p>
                <p className="text-xs text-muted-foreground">
                  Try <span className="font-mono">seo analytics</span> or{' '}
                  <span className="font-mono">email marketing</span> to see examples.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Drill drawer */}
      <LlmAnswerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={drawerQuery}
        subtitle="Top 5 LLM answers for this query"
        rows={drawerRows}
        loading={drawerLoading}
        error={drawerError}
      />
    </div>
  );
}
