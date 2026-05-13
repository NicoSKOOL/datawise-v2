import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Info, X, Plus, Users } from 'lucide-react';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { fetchLlmCrossAggregate, sumDim, type LlmMentionTarget } from '@/lib/llm-mentions';

type Platform = 'google' | 'chat_gpt';

interface CompetitorCompareProps {
  userDomain: string;
  enabled: boolean;
}

interface CompareRow {
  name: string;
  domain: string;
  mentions: number;
  aiVolume: number;
  impressions: number;
  isYou: boolean;
}

const MAX_COMPETITORS = 5;
const YOU_COLOR = '#2563eb';
const OTHER_COLOR = '#94a3b8';

function cleanDomainInput(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase();
}

function shortKey(domain: string): string {
  const parts = domain.split('.');
  return parts[0] || domain;
}

function fmt(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function CompetitorCompare({ userDomain, enabled }: CompetitorCompareProps) {
  const [draft, setDraft] = useState('');
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [platform, setPlatform] = useState<Platform>('google');
  const [activeCompetitors, setActiveCompetitors] = useState<string[]>([]);

  const addCompetitor = () => {
    const cleaned = cleanDomainInput(draft);
    if (!cleaned) return;
    if (cleaned === userDomain.replace(/^www\./, '')) {
      setDraft('');
      return;
    }
    if (competitors.includes(cleaned)) {
      setDraft('');
      return;
    }
    if (competitors.length >= MAX_COMPETITORS) return;
    setCompetitors([...competitors, cleaned]);
    setDraft('');
  };

  const removeCompetitor = (domain: string) => {
    setCompetitors(competitors.filter((c) => c !== domain));
  };

  const runCompare = () => {
    if (!userDomain || competitors.length === 0) return;
    setActiveCompetitors([...competitors]);
  };

  const queryDomains = useMemo(
    () => (activeCompetitors.length > 0 ? [userDomain, ...activeCompetitors] : []),
    [userDomain, activeCompetitors]
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['llm-cross-aggregate', userDomain, platform, activeCompetitors.join(',')],
    queryFn: () => {
      const targets = queryDomains.map((d) => ({
        aggregation_key: shortKey(d),
        target: [{ domain: d, include_subdomains: true }] as LlmMentionTarget[],
      }));
      return fetchLlmCrossAggregate({ targets, platform });
    },
    enabled: queryDomains.length >= 2,
    staleTime: 5 * 60 * 1000,
  });

  const rows: CompareRow[] = useMemo(() => {
    if (!data?.items) return [];
    const userKey = shortKey(userDomain);
    return queryDomains
      .map((dom, idx) => {
        const key = shortKey(dom);
        const item = data.items!.find((it) => it.key === key);
        if (!item) return null;
        return {
          name: idx === 0 ? `${dom} (you)` : dom,
          domain: dom,
          mentions: sumDim(item.platform, 'mentions'),
          aiVolume: sumDim(item.platform, 'ai_search_volume'),
          impressions: sumDim(item.platform, 'impressions'),
          isYou: key === userKey,
        } satisfies CompareRow;
      })
      .filter((x): x is CompareRow => x !== null)
      .sort((a, b) => b.mentions - a.mentions);
  }, [data, queryDomains, userDomain]);

  const totalMentions = rows.reduce((s, r) => s + r.mentions, 0);
  const userRow = rows.find((r) => r.isYou);
  const userSovPct =
    totalMentions > 0 && userRow ? Math.round((userRow.mentions / totalMentions) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-2">
          <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="flex-1">
            <CardTitle className="text-base flex items-center gap-1.5">
              Compare to competitors
              <UiTooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  See how your LLM mention share stacks up against competitor domains. Runs a single
                  DataForSEO cross_aggregated_metrics call covering every domain at once.
                </TooltipContent>
              </UiTooltip>
            </CardTitle>
            <CardDescription>
              Add up to {MAX_COMPETITORS} competitor domains to benchmark your share of voice in AI
              answers.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!enabled ? (
          <p className="text-sm text-muted-foreground">Analyze a domain first to compare.</p>
        ) : (
          <>
            {/* Platform toggle */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Platform:</span>
              <button
                onClick={() => setPlatform('google')}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  platform === 'google'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                Google AIO
              </button>
              <button
                onClick={() => setPlatform('chat_gpt')}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  platform === 'chat_gpt'
                    ? 'bg-green-600 text-white border-green-600'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                ChatGPT
              </button>
            </div>

            {/* Competitor input */}
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="e.g., netlify.com"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCompetitor();
                  }
                }}
                className="h-9 text-sm max-w-[260px]"
                disabled={competitors.length >= MAX_COMPETITORS}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addCompetitor}
                disabled={!draft.trim() || competitors.length >= MAX_COMPETITORS}
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={runCompare}
                disabled={competitors.length === 0}
              >
                Compare
              </Button>
              <span className="text-xs text-muted-foreground">
                {competitors.length}/{MAX_COMPETITORS}
              </span>
            </div>

            {competitors.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {competitors.map((c) => (
                  <Badge key={c} variant="secondary" className="gap-1 pr-1">
                    {c}
                    <button
                      onClick={() => removeCompetitor(c)}
                      className="hover:bg-background/50 rounded"
                      aria-label={`Remove ${c}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Results */}
            {error ? (
              <p className="text-sm text-destructive">{(error as Error).message}</p>
            ) : isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : activeCompetitors.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Add competitor domains above and click Compare to see the breakdown.
                </p>
              </div>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comparison data returned.</p>
            ) : (
              <div className="space-y-4">
                {/* Share of voice summary */}
                {userRow && (
                  <div className="flex items-center gap-3 rounded-lg bg-muted/30 px-4 py-3">
                    <div className="flex-1">
                      <p className="text-xs text-muted-foreground">Your share of voice</p>
                      <p className="text-2xl font-bold tabular-nums">{userSovPct}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Your mentions</p>
                      <p className="text-lg font-semibold tabular-nums">{fmt(userRow.mentions)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Pool total</p>
                      <p className="text-lg font-semibold tabular-nums">{fmt(totalMentions)}</p>
                    </div>
                  </div>
                )}

                {/* Bar chart */}
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={rows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="domain"
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={fmt}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string) => [fmt(value), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="mentions" name="Mentions" radius={[4, 4, 0, 0]}>
                      {rows.map((r) => (
                        <Cell key={r.domain} fill={r.isYou ? YOU_COLOR : OTHER_COLOR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                {/* Details table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="text-left py-2 font-medium">Domain</th>
                        <th className="text-right py-2 font-medium">Mentions</th>
                        <th className="text-right py-2 font-medium">AI Volume</th>
                        <th className="text-right py-2 font-medium">Impressions</th>
                        <th className="text-right py-2 font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const sov = totalMentions > 0 ? (r.mentions / totalMentions) * 100 : 0;
                        return (
                          <tr key={r.domain} className="border-b last:border-0">
                            <td className="py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{r.domain}</span>
                                {r.isYou && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                    you
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="py-2 text-right tabular-nums">{fmt(r.mentions)}</td>
                            <td className="py-2 text-right tabular-nums">{fmt(r.aiVolume)}</td>
                            <td className="py-2 text-right tabular-nums">{fmt(r.impressions)}</td>
                            <td className="py-2 text-right tabular-nums">{sov.toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
