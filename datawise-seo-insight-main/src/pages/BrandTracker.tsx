import { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Info, Search, Globe, TrendingUp, Eye, BarChart3 } from 'lucide-react';
import {
  fetchLlmAggregate,
  fetchLlmTopDomains,
  fetchLlmSearch,
  sumDim,
  type LlmSearchRow,
} from '@/lib/llm-mentions';
import { LlmAnswerDrawer } from '@/components/llm-mentions/LlmAnswerDrawer';
import { StatItem } from '@/components/llm-mentions/StatItem';
import { MentionsTrendChart } from '@/components/llm-mentions/MentionsTrendChart';
import { CompetitorCompare } from '@/components/llm-mentions/CompetitorCompare';
import { useDefaults } from '@/hooks/use-defaults';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { matchesAllTerms, splitFilterTerms } from '@/lib/result-filter';

type Platform = 'google' | 'chat_gpt';
type SortKey = 'recent' | 'oldest' | 'sources' | 'alpha';

function fmt(n: number | undefined): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function platformLabel(platform: string | undefined): string {
  if (platform === 'google') return 'Google AIO';
  if (platform === 'chat_gpt') return 'ChatGPT';
  return platform || 'Unknown';
}

function platformColor(platform: string | undefined): string {
  if (platform === 'google') return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200';
  if (platform === 'chat_gpt') return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200';
  return 'bg-muted text-muted-foreground';
}

// StatItem, StatAccent, and ACCENT imported from shared component

function TopDomainsCard({
  domain,
  platform,
  enabled,
}: {
  domain: string;
  platform: Platform;
  enabled: boolean;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['llm-top-domains', domain, platform],
    queryFn: () =>
      fetchLlmTopDomains({
        target: [{ domain, include_subdomains: true }],
        platform,
        links_scope: 'sources',
        items_list_limit: 10,
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const rawItems = data?.items || [];
  const items = rawItems.slice(0, 8).map((it) => ({
    domain: it.key,
    mentions: sumDim(it.platform, 'mentions'),
  }));
  const maxMentions = items.reduce((m, i) => Math.max(m, i.mentions), 1);
  const cleanDomain = domain.replace(/^www\./, '');

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Where LLMs cite instead of us</CardTitle>
        <CardDescription>Top domains cited in AI answers for your brand queries</CardDescription>
      </CardHeader>
      <CardContent>
        {!enabled ? (
          <p className="text-sm text-muted-foreground">Enter a domain above and click Analyze.</p>
        ) : isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data found for this domain.</p>
        ) : (
          <ul className="space-y-2 max-h-[280px] overflow-y-auto">
            {items.map((item, i) => {
              const isYou = item.domain.replace(/^www\./, '') === cleanDomain;
              const pct = Math.round((item.mentions / maxMentions) * 100);
              return (
                <li key={item.domain} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-sm font-medium truncate">{item.domain}</span>
                      {isYou && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                          you
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isYou ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">{fmt(item.mentions)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

interface AnswersTableProps {
  rows: LlmSearchRow[];
  isLoading: boolean;
  error: unknown;
  enabled: boolean;
  searchAfterToken: string | undefined;
  loadingMore: boolean;
  onLoadMore: () => void;
}

function AnswersTable({
  rows,
  isLoading,
  error,
  enabled,
  searchAfterToken,
  loadingMore,
  onLoadMore,
}: AnswersTableProps) {
  const [selected, setSelected] = useState<LlmSearchRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  const filtered = useMemo(() => {
    let result = rows;
    const terms = splitFilterTerms(search);

    if (terms.length > 0) {
      // Filter across question + answer + source titles/domains so a
      // multi-word query finds matches when one word is in the question and
      // another in the answer body. Question-only matching returned empty
      // results too often (bug 2119ccb9).
      result = result.filter((r) => {
        const haystack = [
          r.question || '',
          r.answer || '',
          ...(r.sources || []).flatMap((s) => [s.title || '', s.domain || '', s.snippet || '']),
        ].join(' \n ');
        return matchesAllTerms(haystack, terms);
      });
    }

    if (platformFilter !== 'all') {
      result = result.filter((r) => r.platform === platformFilter);
    }

    result = [...result].sort((a, b) => {
      if (sortKey === 'recent') {
        return (b.last_response_at || '').localeCompare(a.last_response_at || '');
      }
      if (sortKey === 'oldest') {
        return (a.last_response_at || '').localeCompare(b.last_response_at || '');
      }
      if (sortKey === 'sources') {
        return (b.sources?.length ?? 0) - (a.sources?.length ?? 0);
      }
      if (sortKey === 'alpha') {
        return (a.question || '').localeCompare(b.question || '');
      }
      return 0;
    });

    return result;
  }, [rows, search, platformFilter, sortKey]);

  const handleRowClick = (row: LlmSearchRow) => {
    setSelected(row);
    setDrawerOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>LLM answers mentioning you</CardTitle>
              <CardDescription className="mt-1">
                {!enabled
                  ? 'Enter a domain above and click Analyze.'
                  : isLoading
                  ? 'Loading answers...'
                  : `${rows.length} answers found${rows.length > 0 && filtered.length !== rows.length ? `, ${filtered.length} shown` : ''}`}
              </CardDescription>
            </div>
          </div>

          {enabled && !isLoading && rows.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              <Input
                placeholder="Filter (matches question, answer, sources)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm max-w-[320px]"
              />
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger className="h-8 text-sm w-[160px]">
                  <SelectValue placeholder="All platforms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  <SelectItem value="google">Google AIO</SelectItem>
                  <SelectItem value="chat_gpt">ChatGPT</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="h-8 text-sm w-[160px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Most recent</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="sources">Most sources</SelectItem>
                  <SelectItem value="alpha">Question A-Z</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {!enabled ? null : isLoading ? (
            <div className="space-y-3 p-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive p-4">{(error as Error).message}</p>
          ) : rows.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <p className="text-sm text-muted-foreground">No LLM answers found for this domain.</p>
              <p className="text-xs text-muted-foreground">
                Try a well-known domain like{' '}
                <span className="font-mono">vercel.com</span> or{' '}
                <span className="font-mono">shopify.com</span> to see an example.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No answers match your filters.</p>
          ) : (
            <>
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10 text-right pr-2">#</TableHead>
                      <TableHead>Question</TableHead>
                      <TableHead className="w-[120px]">Platform</TableHead>
                      <TableHead className="w-[80px]">Sources</TableHead>
                      <TableHead className="w-[90px]">Last seen</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row, i) => {
                      const date = row.last_response_at
                        ? new Date(row.last_response_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : null;
                      const sourceCount = row.sources?.length ?? 0;
                      return (
                        <TableRow
                          key={i}
                          onClick={() => handleRowClick(row)}
                          className="cursor-pointer hover:bg-muted/50"
                        >
                          <TableCell className="w-10 text-right text-xs text-muted-foreground pr-2">
                            {i + 1}
                          </TableCell>
                          <TableCell className="font-medium">
                            <p className="line-clamp-2 text-sm leading-snug">
                              {row.question || '(no question)'}
                            </p>
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${platformColor(row.platform)}`}
                            >
                              {platformLabel(row.platform)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {sourceCount > 0 ? (
                              <Badge variant="secondary" className="text-xs tabular-nums">
                                {sourceCount}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {date || '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {searchAfterToken && (
                <div className="flex justify-center p-4 border-t">
                  <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <LlmAnswerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={selected?.question ?? ''}
        rows={selected ? [selected] : []}
      />
    </>
  );
}

export default function BrandTracker() {
  const { defaultDomain } = useDefaults();
  const { toast } = useToast();
  // activeDomain + platform toggles persist so returning to Brand Tracker
  // restores the last analyzed domain (bug 252b2580 — "ran a few of these
  // features, then when I returned all of the data has gone"). React Query
  // refetches automatically when the queryKey rehydrates with a non-empty
  // activeDomain.
  const [activeDomain, setActiveDomain] = usePersistentState<string>('brand-tracker:active-domain', '');
  const [inputDomain, setInputDomain] = useState(activeDomain || defaultDomain || '');
  const [googleActive, setGoogleActive] = usePersistentState<boolean>('brand-tracker:google-active', true);
  const [chatgptActive, setChatgptActive] = usePersistentState<boolean>('brand-tracker:chatgpt-active', false);

  // Per-platform pagination state. Initial 100 rows come from each search
  // query; subsequent pages append into the matching extras array.
  const [googleExtra, setGoogleExtra] = useState<LlmSearchRow[]>([]);
  const [googleToken, setGoogleToken] = useState<string | undefined>(undefined);
  const [chatgptExtra, setChatgptExtra] = useState<LlmSearchRow[]>([]);
  const [chatgptToken, setChatgptToken] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const analysisEnabled = activeDomain.length > 0;
  const platforms: Platform[] = [
    ...(googleActive ? (['google'] as Platform[]) : []),
    ...(chatgptActive ? (['chat_gpt'] as Platform[]) : []),
  ];

  const googleAgg = useQuery({
    queryKey: ['llm-aggregate', activeDomain, 'google'],
    queryFn: () =>
      fetchLlmAggregate({
        target: [{ domain: activeDomain, include_subdomains: true }],
        platform: 'google',
      }),
    enabled: analysisEnabled && googleActive,
    staleTime: 5 * 60 * 1000,
  });

  const chatgptAgg = useQuery({
    queryKey: ['llm-aggregate', activeDomain, 'chat_gpt'],
    queryFn: () =>
      fetchLlmAggregate({
        target: [{ domain: activeDomain, include_subdomains: true }],
        platform: 'chat_gpt',
      }),
    enabled: analysisEnabled && chatgptActive,
    staleTime: 5 * 60 * 1000,
  });

  // Top Domains card supports a single platform today. Mirror the toggle
  // by preferring whichever single platform is active; fall back to google
  // when both are on (existing behavior — separate widget upgrade later).
  const topDomainsPlatform: Platform = chatgptActive && !googleActive ? 'chat_gpt' : 'google';

  // One search query per platform, each gated on its own toggle. DFS does
  // not accept an array of platforms on /search/live, so a single-platform
  // query is the unit we cache and paginate against. React Query keys by
  // platform so toggling is race-free.
  const googleSearch = useQuery({
    queryKey: ['llm-search', activeDomain, 'google'],
    queryFn: () =>
      fetchLlmSearch({
        target: [{ domain: activeDomain, include_subdomains: true }],
        platform: 'google',
        limit: 100,
      }),
    enabled: analysisEnabled && googleActive,
    staleTime: 60 * 1000,
  });

  const chatgptSearch = useQuery({
    queryKey: ['llm-search', activeDomain, 'chat_gpt'],
    queryFn: () =>
      fetchLlmSearch({
        target: [{ domain: activeDomain, include_subdomains: true }],
        platform: 'chat_gpt',
        limit: 100,
      }),
    enabled: analysisEnabled && chatgptActive,
    staleTime: 60 * 1000,
  });

  // Sync per-platform pagination tokens whenever a fresh first page lands.
  // useMemo here would be wrong — we need to react to data identity changes
  // exactly once each, so it lives in derived state via a passive useEffect.
  useEffect(() => {
    setGoogleExtra([]);
    setGoogleToken(googleSearch.data?.search_after_token);
  }, [googleSearch.data]);
  useEffect(() => {
    setChatgptExtra([]);
    setChatgptToken(chatgptSearch.data?.search_after_token);
  }, [chatgptSearch.data]);
  // Reset extras when switching domain so stale rows never bleed across analyses.
  useEffect(() => {
    setGoogleExtra([]);
    setGoogleToken(undefined);
    setChatgptExtra([]);
    setChatgptToken(undefined);
  }, [activeDomain]);

  const searchRows = useMemo<LlmSearchRow[]>(() => {
    const g = googleActive ? [...(googleSearch.data?.items || []), ...googleExtra] : [];
    const c = chatgptActive ? [...(chatgptSearch.data?.items || []), ...chatgptExtra] : [];
    const merged = [...g, ...c];
    // Sort by most-recent response first so the merged list reads chronologically.
    merged.sort((a, b) => (b.last_response_at || '').localeCompare(a.last_response_at || ''));
    return merged;
  }, [googleActive, chatgptActive, googleSearch.data, chatgptSearch.data, googleExtra, chatgptExtra]);

  const searchTotal = useMemo<number | undefined>(() => {
    const g = googleActive ? googleSearch.data?.total_count ?? 0 : 0;
    const c = chatgptActive ? chatgptSearch.data?.total_count ?? 0 : 0;
    const total = g + c;
    return total > 0 ? total : undefined;
  }, [googleActive, chatgptActive, googleSearch.data, chatgptSearch.data]);

  const hasMoreToken =
    (googleActive && !!googleToken) || (chatgptActive && !!chatgptToken);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const tasks: Promise<void>[] = [];
      if (googleActive && googleToken) {
        tasks.push(
          fetchLlmSearch({
            target: [{ domain: activeDomain, include_subdomains: true }],
            platform: 'google',
            limit: 100,
            search_after_token: googleToken,
          }).then((result) => {
            const newItems = result.items || [];
            setGoogleExtra((prev) => [...prev, ...newItems]);
            setGoogleToken(newItems.length === 0 ? undefined : result.search_after_token);
          }),
        );
      }
      if (chatgptActive && chatgptToken) {
        tasks.push(
          fetchLlmSearch({
            target: [{ domain: activeDomain, include_subdomains: true }],
            platform: 'chat_gpt',
            limit: 100,
            search_after_token: chatgptToken,
          }).then((result) => {
            const newItems = result.items || [];
            setChatgptExtra((prev) => [...prev, ...newItems]);
            setChatgptToken(newItems.length === 0 ? undefined : result.search_after_token);
          }),
        );
      }
      if (tasks.length === 0) return;
      await Promise.all(tasks);
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load more results. Please try again.' });
    } finally {
      setLoadingMore(false);
    }
  };

  const gMentions = sumDim(googleAgg.data?.total?.platform, 'mentions');
  const cMentions = sumDim(chatgptAgg.data?.total?.platform, 'mentions');
  const totalMentions = (googleActive ? gMentions : 0) + (chatgptActive ? cMentions : 0);

  const gImpressions = sumDim(googleAgg.data?.total?.platform, 'impressions');
  const cImpressions = sumDim(chatgptAgg.data?.total?.platform, 'impressions');
  const totalImpressions = (googleActive ? gImpressions : 0) + (chatgptActive ? cImpressions : 0);

  const gVolume = sumDim(googleAgg.data?.total?.platform, 'ai_search_volume');
  const cVolume = sumDim(chatgptAgg.data?.total?.platform, 'ai_search_volume');
  const totalVolume = (googleActive ? gVolume : 0) + (chatgptActive ? cVolume : 0);

  const sourceDomains = [
    ...(googleActive ? googleAgg.data?.total?.sources_domain || [] : []),
    ...(chatgptActive ? chatgptAgg.data?.total?.sources_domain || [] : []),
  ];
  const uniqueSourceCount = new Set(sourceDomains.map((d) => d.key)).size;

  const kpiLoading =
    (googleActive && googleAgg.isLoading) || (chatgptActive && chatgptAgg.isLoading);

  const handleAnalyze = () => {
    const cleaned = inputDomain
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
    if (cleaned) setActiveDomain(cleaned);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Brand Tracker</h2>
        <p className="text-muted-foreground text-sm">
          See how AI search engines mention and cite your brand.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="bt-domain">Domain</Label>
              <Input
                id="bt-domain"
                placeholder="e.g., vercel.com"
                value={inputDomain}
                onChange={(e) => setInputDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Platforms</Label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setGoogleActive((v) => !v)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    googleActive
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-border text-muted-foreground hover:border-muted-foreground'
                  }`}
                >
                  Google AI Overview
                </button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setChatgptActive((v) => !v)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      chatgptActive
                        ? 'bg-green-600 text-white border-green-600'
                        : 'border-border text-muted-foreground hover:border-muted-foreground'
                    }`}
                  >
                    ChatGPT
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs text-xs">
                      ChatGPT data is US + English only (DataForSEO limitation).
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>

            <Button onClick={handleAnalyze} disabled={!inputDomain.trim()} className="gap-2">
              <Search className="h-4 w-4" />
              Analyze
            </Button>
          </div>
        </CardContent>
      </Card>

      {(googleAgg.error || chatgptAgg.error) && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">
              {((googleAgg.error || chatgptAgg.error) as Error).message}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="h-full lg:col-span-1 flex flex-col">
          <CardHeader>
            <CardTitle className="text-base">Visibility overview</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex items-center justify-center">
            {!analysisEnabled ? (
              <p className="text-sm text-muted-foreground">
                Enter a domain above and click Analyze.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-x-6 gap-y-6 w-full">
                <StatItem
                  icon={BarChart3}
                  label="Total Mentions"
                  value={fmt(totalMentions)}
                  breakdown={
                    platforms.length > 1
                      ? { aio: fmt(gMentions), gpt: fmt(cMentions) }
                      : undefined
                  }
                  loading={kpiLoading}
                  accent="blue"
                  help="Total number of LLM answers where your brand or domain appears. Each mention is one prompt/answer pair where the LLM referenced your site in its sources or text."
                />
                <StatItem
                  icon={Eye}
                  label="AI Impressions"
                  value={fmt(totalImpressions)}
                  breakdown={
                    platforms.length > 1
                      ? { aio: fmt(gImpressions), gpt: fmt(cImpressions) }
                      : undefined
                  }
                  loading={kpiLoading}
                  accent="purple"
                  help="Estimated total views of LLM answers that mention you. Calculated by multiplying each mention by the underlying AI search volume of its prompt."
                />
                <StatItem
                  icon={TrendingUp}
                  label="AI Search Volume"
                  value={fmt(totalVolume)}
                  breakdown={
                    platforms.length > 1
                      ? { aio: fmt(gVolume), gpt: fmt(cVolume) }
                      : undefined
                  }
                  loading={kpiLoading}
                  accent="green"
                  help="Estimated monthly volume of AI queries on topics where you are mentioned. Higher volume means more users ask questions where the LLM might surface you."
                />
                <StatItem
                  icon={Globe}
                  label="Citing Domains"
                  value={fmt(uniqueSourceCount)}
                  loading={kpiLoading}
                  accent="orange"
                  help="Unique external domains the LLM cites as sources alongside yours. Shows which sites you are being co-cited with when answering user questions."
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 h-full">
          <TopDomainsCard
            domain={activeDomain}
            platform={topDomainsPlatform}
            enabled={analysisEnabled}
          />
        </div>
      </div>

      <MentionsTrendChart
        rows={searchRows}
        totalCount={searchTotal}
        loading={analysisEnabled && (googleSearch.isLoading || chatgptSearch.isLoading)}
        enabled={analysisEnabled}
      />

      <AnswersTable
        rows={searchRows}
        isLoading={googleSearch.isLoading || chatgptSearch.isLoading}
        error={googleSearch.error || chatgptSearch.error}
        enabled={analysisEnabled}
        searchAfterToken={hasMoreToken ? 'more' : undefined}
        loadingMore={loadingMore}
        onLoadMore={handleLoadMore}
      />

      <CompetitorCompare userDomain={activeDomain} enabled={analysisEnabled} />
    </div>
  );
}
