import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTabParam } from '@/hooks/use-tab-param';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import {
  Search,
  Link2,
  TrendingUp,
  Globe,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  X,
  Plus,
  CheckCircle2,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MapPin,
} from 'lucide-react';
import {
  fetchBacklinksSummary,
  fetchBacklinksTimeseries,
  fetchBacklinksList,
  fetchReferringDomains,
  fetchAnchors,
  fetchBacklinksCompetitors,
  cleanBacklinksDomain,
  type BacklinksTimeseriesRow,
  type BacklinkItem,
  type AnchorItem,
  type ReferringDomainItem,
} from '@/lib/backlinks';
import { useDefaults } from '@/hooks/use-defaults';
import { Link as RouterLink } from 'react-router-dom';

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || n === 0) return '0';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pctScore(value: number | undefined): { label: string; color: string } {
  const v = value ?? 0;
  if (v >= 70) return { label: 'High', color: 'text-rose-600' };
  if (v >= 40) return { label: 'Medium', color: 'text-amber-600' };
  if (v > 0) return { label: 'Low', color: 'text-emerald-600' };
  return { label: 'None', color: 'text-muted-foreground' };
}

type SortDir = 'asc' | 'desc';
interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

function SortableHeader<K extends string>({
  label,
  sortKey,
  help,
  align = 'left',
  sort,
  onSort,
}: {
  label: string;
  sortKey: K;
  help: string;
  align?: 'left' | 'right';
  sort: SortState<K>;
  onSort: (key: K) => void;
}) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === 'desc' ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={`group inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide transition-colors hover:text-foreground ${
            active ? 'text-foreground' : 'text-muted-foreground'
          } ${align === 'right' ? 'w-full justify-end' : ''}`}
        >
          <span>{label}</span>
          <Icon className={`h-3 w-3 ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-80'}`} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {help}
      </TooltipContent>
    </Tooltip>
  );
}

interface TotalsRow {
  domain: string;
  shortName: string;
  refDomains: number;
  backlinks: number;
  isYou: boolean;
}

function MiniComparisonChart({
  title,
  subtitle,
  rows,
  metricKey,
}: {
  title: string;
  subtitle: string;
  rows: TotalsRow[];
  metricKey: 'refDomains' | 'backlinks';
}) {
  return (
    <div>
      <div className="mb-1">
        <p className="text-xs font-semibold">{title}</p>
        <p className="text-[10px] text-muted-foreground">{subtitle}</p>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart
          data={rows}
          margin={{ top: 6, right: 8, left: -16, bottom: 0 }}
          barCategoryGap="30%"
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="shortName"
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
            tickFormatter={(v: number) => {
              if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
              if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
              return String(v);
            }}
          />
          <RTooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 6,
              fontSize: 11,
            }}
            formatter={(value: number) => [
              value.toLocaleString(),
              metricKey === 'refDomains' ? 'Ref. domains' : 'Backlinks',
            ]}
          />
          <Bar dataKey={metricKey} radius={[4, 4, 0, 0]} maxBarSize={48}>
            {rows.map((r) => (
              <Cell key={r.domain} fill={r.isYou ? '#2563eb' : '#94a3b8'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Generic value-extracting comparator. Strings compare case-insensitively,
// numbers by magnitude, nulls always sink to the bottom regardless of dir.
function compareBy<T>(a: T, b: T, get: (r: T) => number | string | null | undefined, dir: SortDir): number {
  const av = get(a);
  const bv = get(b);
  const aNull = av === null || av === undefined || av === '';
  const bNull = bv === null || bv === undefined || bv === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let cmp = 0;
  if (typeof av === 'number' && typeof bv === 'number') {
    cmp = av - bv;
  } else {
    cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
  }
  return dir === 'asc' ? cmp : -cmp;
}

// ---------- Overview tab ----------

function OverviewTab({ target }: { target: string }) {
  const summary = useQuery({
    queryKey: ['bl-summary', target],
    queryFn: () => fetchBacklinksSummary({ target, include_subdomains: true }),
    enabled: !!target,
    staleTime: 5 * 60 * 1000,
  });

  const timeseries = useQuery({
    queryKey: ['bl-timeseries', target],
    queryFn: () =>
      fetchBacklinksTimeseries({
        target,
        group_range: 'month',
        include_subdomains: true,
      }),
    enabled: !!target,
    staleTime: 5 * 60 * 1000,
  });

  const data = summary.data;
  const spam = data?.backlinks_spam_score;
  const spamScore = pctScore(spam);

  const trendRows = useMemo(() => {
    const items: BacklinksTimeseriesRow[] = timeseries.data?.items || [];
    return items
      .map((r) => {
        const year = r.year ?? (r.date ? Number(r.date.slice(0, 4)) : undefined);
        const month = r.month ?? (r.date ? Number(r.date.slice(5, 7)) : undefined);
        if (!year || !month) return null;
        const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
        });
        return {
          label,
          newBacklinks: Number(r.new_backlinks ?? 0),
          lostBacklinks: -Math.abs(Number(r.lost_backlinks ?? 0)),
          newRefDomains: Number(r.new_referring_domains ?? 0),
          lostRefDomains: -Math.abs(Number(r.lost_referring_domains ?? 0)),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [timeseries.data]);

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={<Link2 className="h-4 w-4" />}
          label="Backlinks"
          value={fmt(data?.backlinks)}
          loading={summary.isLoading}
          accent="blue"
        />
        <KpiCard
          icon={<Globe className="h-4 w-4" />}
          label="Referring domains"
          value={fmt(data?.referring_domains)}
          loading={summary.isLoading}
          accent="purple"
        />
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Domain rank"
          value={String(data?.rank ?? '—')}
          loading={summary.isLoading}
          accent="green"
        />
        <KpiCard
          icon={<ShieldAlert className="h-4 w-4" />}
          label="Spam score"
          value={spam !== undefined ? `${spam}` : '—'}
          subtitle={spamScore.label}
          subtitleClass={spamScore.color}
          loading={summary.isLoading}
          accent="orange"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Broken backlinks"
          value={fmt(data?.broken_backlinks)}
          loading={summary.isLoading}
          accent="rose"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Main domains"
          value={fmt(data?.referring_main_domains)}
          loading={summary.isLoading}
          accent="teal"
        />
      </div>

      {summary.error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{(summary.error as Error).message}</p>
          </CardContent>
        </Card>
      )}

      {/* Backlinks trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New vs lost — monthly</CardTitle>
          <CardDescription>
            Backlink velocity over time. Positive bars are newly acquired, negative are lost.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeseries.isLoading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : trendRows.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
              No timeseries data yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={trendRows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={fmt} />
                <RTooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [fmt(Math.abs(value)), name]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="newBacklinks" name="New backlinks" stackId="bl" fill="#16a34a" />
                <Bar dataKey="lostBacklinks" name="Lost backlinks" stackId="bl" fill="#e11d48" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Referring link types breakdown */}
      {data?.referring_links_types && Object.keys(data.referring_links_types).length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BreakdownCard
            title="Link types"
            description="How competitors and partners link to you"
            values={data.referring_links_types}
          />
          <BreakdownCard
            title="Attributes"
            description="dofollow / nofollow / sponsored / UGC split"
            values={data.referring_links_attributes || {}}
          />
        </div>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  subtitle,
  subtitleClass,
  loading,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  subtitleClass?: string;
  loading: boolean;
  accent: 'blue' | 'purple' | 'green' | 'orange' | 'rose' | 'teal';
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    teal: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  };
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded ${colors[accent]}`}>
            {icon}
          </span>
          <span className="truncate">{label}</span>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            {subtitle && (
              <p className={`text-[11px] font-medium mt-0.5 ${subtitleClass || 'text-muted-foreground'}`}>
                {subtitle}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BreakdownCard({
  title,
  description,
  values,
}: {
  title: string;
  description: string;
  values: Record<string, number>;
}) {
  const entries = Object.entries(values)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 8);
  const total = entries.reduce((s, [, v]) => s + Number(v), 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map(([k, v]) => {
              const pct = total > 0 ? Math.round((Number(v) / total) * 100) : 0;
              return (
                <li key={k}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {fmt(Number(v))} · {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary/70 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
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

// ---------- Backlinks list tab ----------

type BacklinksSortKey = 'source' | 'anchor' | 'rank' | 'lastSeen';

function BacklinksListTab({ target }: { target: string }) {
  const [dofollow, setDofollow] = useState<'all' | 'dofollow' | 'nofollow'>('all');
  const [mode, setMode] = useState<'as_is' | 'one_per_domain'>('one_per_domain');
  const [sort, setSort] = useState<SortState<BacklinksSortKey>>({ key: 'rank', dir: 'desc' });

  const toggleSort = (key: BacklinksSortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
    );
  };

  const filters = useMemo(() => {
    if (dofollow === 'dofollow') return [['dofollow', '=', true]];
    if (dofollow === 'nofollow') return [['dofollow', '=', false]];
    return undefined;
  }, [dofollow]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['bl-list', target, mode, dofollow],
    queryFn: () =>
      fetchBacklinksList({
        target,
        limit: 100,
        mode,
        filters,
        order_by: ['domain_from_rank,desc'],
        backlinks_status_type: 'live',
        include_subdomains: true,
      }),
    enabled: !!target,
    staleTime: 5 * 60 * 1000,
  });

  const rawItems: BacklinkItem[] = data?.items || [];

  const items = useMemo(() => {
    const getters: Record<BacklinksSortKey, (r: BacklinkItem) => number | string | null | undefined> = {
      source: (r) => r.domain_from,
      anchor: (r) => r.anchor,
      rank: (r) => r.domain_from_rank ?? 0,
      lastSeen: (r) => (r.last_seen ? new Date(r.last_seen).getTime() : 0),
    };
    return [...rawItems].sort((a, b) => compareBy(a, b, getters[sort.key], sort.dir));
  }, [rawItems, sort]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Live backlinks</CardTitle>
            <CardDescription>
              {data?.total_count
                ? `${fmt(items.length)} of ${fmt(data.total_count)} shown. Click any column header to sort.`
                : 'Strongest inbound links by domain authority.'}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
              <SelectTrigger className="h-8 text-xs w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one_per_domain">One per domain</SelectItem>
                <SelectItem value="as_is">All backlinks</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dofollow} onValueChange={(v) => setDofollow(v as typeof dofollow)}>
              <SelectTrigger className="h-8 text-xs w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All links</SelectItem>
                <SelectItem value="dofollow">Dofollow only</SelectItem>
                <SelectItem value="nofollow">Nofollow only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{(error as Error).message}</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">
            No backlinks returned with these filters.
          </p>
        ) : (
          <div className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-right">#</TableHead>
                  <TableHead>
                    <SortableHeader
                      label="Source"
                      sortKey="source"
                      sort={sort}
                      onSort={toggleSort}
                      help="The external page that contains a link pointing to your domain. Sorted alphabetically by domain."
                    />
                  </TableHead>
                  <TableHead>
                    <SortableHeader
                      label="Anchor"
                      sortKey="anchor"
                      sort={sort}
                      onSort={toggleSort}
                      help="The visible text of the link. Branded anchors are healthy; exact-match keyword anchors in bulk can look manipulative to search engines."
                    />
                  </TableHead>
                  <TableHead className="w-[80px] text-right">
                    <SortableHeader
                      label="Rank"
                      sortKey="rank"
                      align="right"
                      sort={sort}
                      onSort={toggleSort}
                      help="DataForSEO Domain Rank (0-1000) of the linking site — their own estimate of authority. Higher is better."
                    />
                  </TableHead>
                  <TableHead className="w-[90px] text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground cursor-help">
                          Attrs
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-xs">
                        Link attributes: dofollow passes ranking signal, nofollow does not. Broken means the destination page returns an error.
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-[90px] text-right">
                    <SortableHeader
                      label="Seen"
                      sortKey="lastSeen"
                      align="right"
                      sort={sort}
                      onSort={toggleSort}
                      help="Last time DataForSEO crawled the source page and confirmed the link is still live."
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, i) => {
                  const attrs: string[] = [];
                  if (it.dofollow) attrs.push('dofollow');
                  else attrs.push('nofollow');
                  if (it.is_broken) attrs.push('broken');
                  const lastSeen = it.last_seen
                    ? new Date(it.last_seen).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: '2-digit',
                      })
                    : '—';
                  return (
                    <TableRow key={`${it.url_from}-${i}`}>
                      <TableCell className="text-xs text-muted-foreground text-right">
                        {i + 1}
                      </TableCell>
                      <TableCell className="max-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm truncate">
                              {it.domain_from || '—'}
                            </span>
                            {it.url_from && (
                              <a
                                href={it.url_from}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label="Open source"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          {it.page_from_title && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {it.page_from_title}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-0">
                        <p className="text-xs truncate">
                          {it.anchor?.trim() || <span className="text-muted-foreground italic">(empty)</span>}
                        </p>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {it.domain_from_rank ?? '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end flex-wrap">
                          {attrs.map((a) => (
                            <Badge
                              key={a}
                              variant={a === 'broken' ? 'destructive' : a === 'dofollow' ? 'default' : 'secondary'}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {a}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {lastSeen}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Referring domains tab ----------

type RefDomainsSortKey = 'domain' | 'rank' | 'backlinks' | 'refPages' | 'spam' | 'firstSeen';

function ReferringDomainsTab({ target }: { target: string }) {
  const [sort, setSort] = useState<SortState<RefDomainsSortKey>>({ key: 'rank', dir: 'desc' });
  const toggleSort = (key: RefDomainsSortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
    );
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['bl-ref-domains', target],
    queryFn: () =>
      fetchReferringDomains({
        target,
        limit: 100,
        order_by: ['rank,desc'],
        include_subdomains: true,
      }),
    enabled: !!target,
    staleTime: 5 * 60 * 1000,
  });

  const rawItems = data?.items || [];
  const items = useMemo(() => {
    const getters: Record<RefDomainsSortKey, (r: typeof rawItems[number]) => number | string | null | undefined> = {
      domain: (r) => r.domain,
      rank: (r) => r.rank ?? 0,
      backlinks: (r) => r.backlinks ?? 0,
      refPages: (r) => r.referring_pages ?? 0,
      spam: (r) => r.backlinks_spam_score ?? 0,
      firstSeen: (r) => (r.first_seen ? new Date(r.first_seen).getTime() : 0),
    };
    return [...rawItems].sort((a, b) => compareBy(a, b, getters[sort.key], sort.dir));
  }, [rawItems, sort]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Referring domains</CardTitle>
        <CardDescription>
          {data?.total_count
            ? `${fmt(items.length)} of ${fmt(data.total_count)} unique domains linking to you. Click any column header to sort.`
            : 'Unique domains linking to you.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 space-y-3">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="p-4 text-sm text-destructive">{(error as Error).message}</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">No referring domains yet.</p>
        ) : (
          <div className="max-h-[640px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 text-right">#</TableHead>
                  <TableHead>
                    <SortableHeader
                      label="Domain"
                      sortKey="domain"
                      sort={sort}
                      onSort={toggleSort}
                      help="The unique external domain that links to your site at least once. Click to sort alphabetically."
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      label="Rank"
                      sortKey="rank"
                      align="right"
                      sort={sort}
                      onSort={toggleSort}
                      help="DataForSEO Domain Rank (0-1000) of the linking site. Higher means more authoritative and valuable as a source."
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      label="Backlinks"
                      sortKey="backlinks"
                      align="right"
                      sort={sort}
                      onSort={toggleSort}
                      help="Total number of individual links from this domain pointing to your site. A domain can have many pages, each with its own link."
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      label="Ref. pages"
                      sortKey="refPages"
                      align="right"
                      sort={sort}
                      onSort={toggleSort}
                      help="Number of distinct pages on this domain that contain at least one link to your site."
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      label="Spam"
                      sortKey="spam"
                      align="right"
                      sort={sort}
                      onSort={toggleSort}
                      help="DataForSEO spam score (0-100). Low is clean, high suggests a toxic source. Anything above 70 is worth reviewing."
                    />
                  </TableHead>
                  <TableHead className="text-right">
                    <SortableHeader
                      label="First seen"
                      sortKey="firstSeen"
                      align="right"
                      sort={sort}
                      onSort={toggleSort}
                      help="The earliest date DataForSEO discovered any link from this domain to your site."
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it, i) => {
                  const first = it.first_seen
                    ? new Date(it.first_seen).toLocaleDateString('en-US', {
                        month: 'short',
                        year: 'numeric',
                      })
                    : '—';
                  const spam = it.backlinks_spam_score ?? 0;
                  const spamInfo = pctScore(spam);
                  return (
                    <TableRow key={`${it.domain}-${i}`}>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {i + 1}
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-1.5">
                          {it.domain || '—'}
                          {it.domain && (
                            <a
                              href={`https://${it.domain}`}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {it.rank ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmt(it.backlinks)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {fmt(it.referring_pages)}
                      </TableCell>
                      <TableCell className={`text-right text-xs font-medium ${spamInfo.color}`}>
                        {spam}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {first}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Anchors tab ----------

type AnchorCategory = 'branded' | 'exact' | 'url' | 'generic' | 'other';

function categorizeAnchor(anchor: string | undefined, target: string): AnchorCategory {
  if (!anchor) return 'other';
  const a = anchor.toLowerCase().trim();
  if (!a) return 'other';
  if (/^https?:\/\//.test(a) || /\.[a-z]{2,}\b/.test(a)) return 'url';
  if (/^(click here|read more|learn more|more|here|this|link|website|visit|site)$/.test(a))
    return 'generic';
  const brandRoot = target.split('.')[0].toLowerCase();
  if (brandRoot && a.includes(brandRoot)) return 'branded';
  if (a.split(' ').length <= 4) return 'exact';
  return 'other';
}

const CATEGORY_COLORS: Record<AnchorCategory, string> = {
  branded: '#2563eb',
  exact: '#16a34a',
  url: '#8b5cf6',
  generic: '#94a3b8',
  other: '#f59e0b',
};

function AnchorsTab({ target }: { target: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['bl-anchors', target],
    queryFn: () =>
      fetchAnchors({
        target,
        limit: 100,
        internal_list_limit: 5,
        include_subdomains: true,
      }),
    enabled: !!target,
    staleTime: 5 * 60 * 1000,
  });

  const items: AnchorItem[] = data?.items || [];

  const { rows, chart } = useMemo(() => {
    const enriched = items.map((it) => ({
      ...it,
      category: categorizeAnchor(it.anchor, target),
    }));
    const counts: Record<AnchorCategory, number> = {
      branded: 0,
      exact: 0,
      url: 0,
      generic: 0,
      other: 0,
    };
    for (const it of enriched) {
      counts[it.category] += Number(it.backlinks || 0);
    }
    const chart = (Object.keys(counts) as AnchorCategory[])
      .map((k) => ({ name: k, value: counts[k] }))
      .filter((x) => x.value > 0);
    return { rows: enriched, chart };
  }, [items, target]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Anchor text mix</CardTitle>
          <CardDescription>
            Classified client-side into branded / exact / URL / generic. Healthy profiles skew
            branded and URL.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-[240px] w-full" />
          ) : chart.length === 0 ? (
            <p className="text-sm text-muted-foreground">No anchor data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chart} layout="vertical" margin={{ top: 6, right: 24, left: 24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={fmt} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                  width={72}
                />
                <RTooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => fmt(value)}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {chart.map((c) => (
                    <Cell key={c.name} fill={CATEGORY_COLORS[c.name as AnchorCategory]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top anchor texts</CardTitle>
          <CardDescription>Ordered by backlink count.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{(error as Error).message}</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">No anchors returned.</p>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-right">#</TableHead>
                    <TableHead>Anchor</TableHead>
                    <TableHead className="w-[110px]">Category</TableHead>
                    <TableHead className="text-right">Backlinks</TableHead>
                    <TableHead className="text-right">Ref. domains</TableHead>
                    <TableHead className="text-right">Spam</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows
                    .slice()
                    .sort((a, b) => Number(b.backlinks || 0) - Number(a.backlinks || 0))
                    .map((it, i) => {
                      const spamInfo = pctScore(it.backlinks_spam_score);
                      return (
                        <TableRow key={`${it.anchor}-${i}`}>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {i + 1}
                          </TableCell>
                          <TableCell className="max-w-0">
                            <p className="text-sm truncate">
                              {it.anchor?.trim() || (
                                <span className="italic text-muted-foreground">(empty)</span>
                              )}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5 py-0 capitalize"
                              style={{ backgroundColor: `${CATEGORY_COLORS[it.category]}20`, color: CATEGORY_COLORS[it.category] }}
                            >
                              {it.category}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {fmt(it.backlinks)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {fmt(it.referring_domains)}
                          </TableCell>
                          <TableCell className={`text-right text-xs font-medium ${spamInfo.color}`}>
                            {it.backlinks_spam_score ?? 0}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Competitor gap tab ----------

type GapSortKey = 'domain' | 'rank' | 'matches' | 'backlinks' | 'spam';

interface GapRow {
  linkingDomain: string;
  maxRank: number;
  totalBacklinks: number;
  matches: number;
  matchedCompetitors: string[];
  spam: number;
}

function normalizeDom(d: string | undefined): string {
  return (d || '').toLowerCase().replace(/^www\./, '');
}

function CompetitorGapTab({ target }: { target: string }) {
  const [draft, setDraft] = useState('');
  const [competitors, setCompetitors] = useState<string[]>([]);
  const [runKey, setRunKey] = useState(0);
  const [activeCompetitors, setActiveCompetitors] = useState<string[]>([]);
  const [minRank, setMinRank] = useState<number>(0);
  const [excludeSpam, setExcludeSpam] = useState<boolean>(true);
  const [sort, setSort] = useState<SortState<GapSortKey>>({ key: 'rank', dir: 'desc' });

  const toggleSort = (key: GapSortKey) => {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
    );
  };

  const addCompetitor = () => {
    const cleaned = cleanBacklinksDomain(draft);
    if (!cleaned) return;
    if (cleaned === target) {
      setDraft('');
      return;
    }
    if (competitors.includes(cleaned) || competitors.length >= 5) {
      setDraft('');
      return;
    }
    setCompetitors([...competitors, cleaned]);
    setDraft('');
  };

  const handleRun = () => {
    if (competitors.length === 0) return;
    setActiveCompetitors([...competitors]);
    setRunKey((k) => k + 1);
  };

  // Auto-suggest competitors when the tab has no custom list yet
  const suggest = useQuery({
    queryKey: ['bl-competitors-suggest', target],
    queryFn: () =>
      fetchBacklinksCompetitors({
        target,
        limit: 10,
        exclude_large_domains: true,
        include_subdomains: true,
      }),
    enabled: !!target && competitors.length === 0,
    staleTime: 30 * 60 * 1000,
  });

  // Parallel fetch: user + each competitor's top 1000 referring domains by rank.
  // Set-diff client-side: any competitor domain the user does NOT have = gap.
  const domainsToFetch = runKey > 0 ? [target, ...activeCompetitors] : [];

  const queries = useQueries({
    queries: domainsToFetch.map((d) => ({
      queryKey: ['bl-ref-domains-gap', d, runKey],
      queryFn: () =>
        fetchReferringDomains({
          target: d,
          limit: 1000,
          order_by: ['rank,desc'],
          include_subdomains: true,
        }),
      staleTime: 15 * 60 * 1000,
      enabled: runKey > 0,
    })),
  });

  const gapLoading = queries.some((q) => q.isLoading);
  const gapError = queries.find((q) => q.error)?.error as Error | undefined;
  const allLoaded = queries.length > 0 && queries.every((q) => q.data);

  const gapRows: GapRow[] = useMemo(() => {
    if (!allLoaded) return [];

    const [userQuery, ...compQueries] = queries;
    const userDomains = new Set<string>();
    for (const it of userQuery?.data?.items || []) {
      const d = normalizeDom(it.domain);
      if (d) userDomains.add(d);
    }

    // Aggregate: per unique linking domain, record which competitors link to it
    const bucket = new Map<string, GapRow>();
    compQueries.forEach((q, idx) => {
      const compDom = activeCompetitors[idx];
      const items: ReferringDomainItem[] = q.data?.items || [];
      for (const it of items) {
        const d = normalizeDom(it.domain);
        if (!d || userDomains.has(d)) continue;
        const existing = bucket.get(d);
        if (existing) {
          existing.maxRank = Math.max(existing.maxRank, Number(it.rank || 0));
          existing.totalBacklinks += Number(it.backlinks || 0);
          existing.spam = Math.max(existing.spam, Number(it.backlinks_spam_score || 0));
          if (!existing.matchedCompetitors.includes(compDom)) {
            existing.matchedCompetitors.push(compDom);
            existing.matches = existing.matchedCompetitors.length;
          }
        } else {
          bucket.set(d, {
            linkingDomain: d,
            maxRank: Number(it.rank || 0),
            totalBacklinks: Number(it.backlinks || 0),
            matches: 1,
            matchedCompetitors: [compDom],
            spam: Number(it.backlinks_spam_score || 0),
          });
        }
      }
    });

    return Array.from(bucket.values());
  }, [queries, allLoaded, activeCompetitors]);

  const filteredRows = useMemo(() => {
    const rows = gapRows.filter((r) => {
      if (r.maxRank < minRank) return false;
      if (excludeSpam && r.spam >= 70) return false;
      return true;
    });
    const getters: Record<GapSortKey, (r: GapRow) => number | string> = {
      domain: (r) => r.linkingDomain,
      rank: (r) => r.maxRank,
      matches: (r) => r.matches,
      backlinks: (r) => r.totalBacklinks,
      spam: (r) => r.spam,
    };
    return [...rows].sort((a, b) => compareBy(a, b, getters[sort.key], sort.dir));
  }, [gapRows, minRank, excludeSpam, sort]);

  // Totals per player for the "who has more" bar chart
  const totalsRows = useMemo(() => {
    if (!allLoaded) return [];
    return queries.map((q, idx) => {
      const domain = domainsToFetch[idx];
      const items: ReferringDomainItem[] = q.data?.items || [];
      const refDomains = q.data?.total_count ?? items.length;
      const totalBacklinks = items.reduce((s, it) => s + Number(it.backlinks || 0), 0);
      return {
        domain,
        shortName: domain.split('.')[0],
        refDomains: Number(refDomains),
        backlinks: totalBacklinks,
        isYou: idx === 0,
      };
    });
  }, [queries, allLoaded, domainsToFetch]);

  // Cumulative growth over time, bucketed by first_seen month.
  // For each player, count how many of their CURRENT referring domains had
  // been acquired up to month M — a proxy for growth trajectory.
  const growthRows = useMemo(() => {
    if (!allLoaded) return [];

    // Per-player monthly delta of newly-acquired ref domains
    const perPlayerDeltas: Array<Map<string, number>> = queries.map((q) => {
      const map = new Map<string, number>();
      const items: ReferringDomainItem[] = q.data?.items || [];
      for (const it of items) {
        const ts = it.first_seen;
        if (!ts || ts.length < 7) continue;
        const key = ts.slice(0, 7); // YYYY-MM
        map.set(key, (map.get(key) || 0) + 1);
      }
      return map;
    });

    // Union of all months across all players
    const monthSet = new Set<string>();
    for (const m of perPlayerDeltas) for (const k of m.keys()) monthSet.add(k);
    const months = Array.from(monthSet).sort();
    if (months.length === 0) return [];

    // Fill gaps so the timeline is continuous month-by-month
    const filled: string[] = [];
    const [firstY, firstM] = months[0].split('-').map(Number);
    const [lastY, lastM] = months[months.length - 1].split('-').map(Number);
    let y = firstY;
    let m = firstM;
    while (y < lastY || (y === lastY && m <= lastM)) {
      filled.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }

    // Running sum per player
    const running: number[] = domainsToFetch.map(() => 0);
    return filled.map((month) => {
      const [yy, mm] = month.split('-').map(Number);
      const label = new Date(Date.UTC(yy, mm - 1, 1)).toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
      });
      const row: Record<string, string | number> = { month, label };
      domainsToFetch.forEach((d, idx) => {
        running[idx] += perPlayerDeltas[idx].get(month) || 0;
        row[d] = running[idx];
      });
      return row;
    });
  }, [queries, allLoaded, domainsToFetch]);

  const suggestedRows = suggest.data?.items || [];
  const creditCost = (competitors.length + 1) * 2;

  // Palette: user always first (brand blue), competitors cycle through colors
  const playerColors = ['#2563eb', '#f97316', '#16a34a', '#a855f7', '#ef4444', '#06b6d4'];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Link-gap analysis</CardTitle>
          <CardDescription>
            Add up to 5 competitor domains. We fetch each competitor's top referring domains and
            subtract the ones that already link to you — what's left are real link-building
            prospects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="e.g., competitor.com"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCompetitor();
                }
              }}
              className="h-9 text-sm max-w-[260px]"
              disabled={competitors.length >= 5}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addCompetitor}
              disabled={!draft.trim() || competitors.length >= 5}
              className="gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleRun}
              disabled={competitors.length === 0}
            >
              Find gaps
            </Button>
            <span className="text-xs text-muted-foreground">
              {competitors.length}/5 · ~{creditCost} credits
            </span>
          </div>

          {competitors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {competitors.map((c) => (
                <Badge key={c} variant="secondary" className="gap-1 pr-1">
                  {c}
                  <button
                    onClick={() => setCompetitors(competitors.filter((x) => x !== c))}
                    className="hover:bg-background/50 rounded"
                    aria-label={`Remove ${c}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {competitors.length < 5 && suggestedRows.length > 0 && (
            <div className="rounded-lg border border-dashed p-4 space-y-2">
              <p className="text-xs font-medium">Suggested competitors (click to add):</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestedRows
                  .filter((c) => c.target && !competitors.includes(c.target))
                  .slice(0, 8)
                  .map((c) => (
                    <button
                      key={c.target}
                      onClick={() => {
                        if (c.target && !competitors.includes(c.target) && competitors.length < 5) {
                          setCompetitors([...competitors, c.target]);
                        }
                      }}
                      className="text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
                    >
                      {c.target}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {runKey > 0 && activeCompetitors.length > 0 && allLoaded && totalsRows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Backlink profile comparison</CardTitle>
              <CardDescription>Your site (blue) vs each competitor (grey).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <MiniComparisonChart
                  title="Referring domains"
                  subtitle="Unique sites that link in"
                  rows={totalsRows}
                  metricKey="refDomains"
                />
                <MiniComparisonChart
                  title="Total backlinks"
                  subtitle="All individual links"
                  rows={totalsRows}
                  metricKey="backlinks"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-1.5">
                Growth trajectory
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-muted-foreground cursor-help">
                      <ArrowUpDown className="h-3 w-3 rotate-90" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    Derived from the first_seen date of every current referring domain, bucketed by
                    month. Shows how each site's link profile grew to its current state. A flattening
                    curve means acquisition has slowed; steep curves mean active growth.
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
              <CardDescription>Cumulative referring domains by month acquired.</CardDescription>
            </CardHeader>
            <CardContent>
              {growthRows.length === 0 ? (
                <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
                  Not enough timestamp data.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={growthRows} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      stroke="hsl(var(--muted-foreground))"
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      tickFormatter={fmt}
                    />
                    <RTooltip
                      contentStyle={{
                        background: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      formatter={(value: number, name: string) => [fmt(value), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {domainsToFetch.map((d, idx) => (
                      <Line
                        key={d}
                        type="monotone"
                        dataKey={d}
                        name={idx === 0 ? `${d} (you)` : d}
                        stroke={playerColors[idx % playerColors.length]}
                        strokeWidth={idx === 0 ? 2.5 : 2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {runKey > 0 && activeCompetitors.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">
                  Domains linking to your competitors that don't link to you
                </CardTitle>
                <CardDescription>
                  {gapLoading
                    ? 'Fetching referring domains in parallel...'
                    : allLoaded
                    ? `${fmt(filteredRows.length)} of ${fmt(gapRows.length)} outreach targets — sites already willing to link to someone in your space.`
                    : '—'}
                </CardDescription>
              </div>
              {allLoaded && (
                <div className="flex flex-wrap gap-2 items-center">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Min rank</span>
                    <Select
                      value={String(minRank)}
                      onValueChange={(v) => setMinRank(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-xs w-[90px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Any</SelectItem>
                        <SelectItem value="100">100+</SelectItem>
                        <SelectItem value="300">300+</SelectItem>
                        <SelectItem value="500">500+</SelectItem>
                        <SelectItem value="700">700+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExcludeSpam((v) => !v)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      excludeSpam ? 'bg-muted border-foreground/20' : 'border-border text-muted-foreground'
                    }`}
                  >
                    {excludeSpam ? '✓ Hide spammy' : 'Show all'}
                  </button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {gapLoading ? (
              <div className="p-4 space-y-3">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : gapError ? (
              <p className="p-4 text-sm text-destructive">{gapError.message}</p>
            ) : filteredRows.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground text-center">
                {gapRows.length === 0
                  ? 'No link-gap prospects found. Either your competitors share no unique referring domains, or you already have links from all of them.'
                  : 'All prospects were filtered out. Lower the min rank or toggle "Show all".'}
              </p>
            ) : (
              <div className="max-h-[640px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8 text-right">#</TableHead>
                      <TableHead>
                        <SortableHeader
                          label="Prospect domain"
                          sortKey="domain"
                          sort={sort}
                          onSort={toggleSort}
                          help="A domain that links to at least one of your competitors but has no known link to you. These are direct link-building opportunities."
                        />
                      </TableHead>
                      <TableHead>Linked by</TableHead>
                      <TableHead className="text-right">
                        <SortableHeader
                          label="Best rank"
                          sortKey="rank"
                          align="right"
                          sort={sort}
                          onSort={toggleSort}
                          help="Highest DataForSEO Domain Rank the prospect has across your competitors' link profiles. Higher means a more authoritative source worth pursuing."
                        />
                      </TableHead>
                      <TableHead className="text-right">
                        <SortableHeader
                          label="Matches"
                          sortKey="matches"
                          align="right"
                          sort={sort}
                          onSort={toggleSort}
                          help="How many of your selected competitors this prospect already links to. 2+ matches means it's a repeat pattern and likely worth outreach."
                        />
                      </TableHead>
                      <TableHead className="text-right">
                        <SortableHeader
                          label="Backlinks"
                          sortKey="backlinks"
                          align="right"
                          sort={sort}
                          onSort={toggleSort}
                          help="Total number of links this prospect sends to your competitors combined. More links usually indicates a deeper content integration."
                        />
                      </TableHead>
                      <TableHead className="text-right">
                        <SortableHeader
                          label="Spam"
                          sortKey="spam"
                          align="right"
                          sort={sort}
                          onSort={toggleSort}
                          help="DataForSEO spam score (0-100). Low is clean, 70+ is toxic — skip those entirely."
                        />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map((row, i) => {
                      const spamInfo = pctScore(row.spam);
                      return (
                        <TableRow key={`${row.linkingDomain}-${i}`}>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {i + 1}
                          </TableCell>
                          <TableCell className="font-medium text-sm max-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate">{row.linkingDomain}</span>
                              <a
                                href={`https://${row.linkingDomain}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-muted-foreground hover:text-foreground shrink-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {row.matchedCompetitors.map((c) => (
                                <Badge
                                  key={c}
                                  variant="secondary"
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  {c.split('.')[0]}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {row.maxRank || '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {row.matches} / {activeCompetitors.length}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {fmt(row.totalBacklinks)}
                          </TableCell>
                          <TableCell className={`text-right text-xs font-medium ${spamInfo.color}`}>
                            {row.spam || 0}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------- Page shell ----------

export default function Backlinks() {
  const { defaultDomain } = useDefaults();
  const [searchParams] = useSearchParams();
  const initialDomain = searchParams.get('domain') || defaultDomain || '';
  const [inputDomain, setInputDomain] = useState(initialDomain);
  const [activeTarget, setActiveTarget] = useState(initialDomain);
  const [tab, setTab] = useTabParam('overview');

  useEffect(() => {
    if (defaultDomain) {
      setInputDomain(defaultDomain);
      setActiveTarget(defaultDomain);
    }
  }, [defaultDomain]);

  const handleAnalyze = () => {
    const cleaned = cleanBacklinksDomain(inputDomain);
    if (cleaned) setActiveTarget(cleaned);
  };

  const enabled = !!activeTarget;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Backlinks</h1>
        <p className="text-muted-foreground">
          Full backlink profile, referring domain quality, anchor mix, and competitor link gaps.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="bl-domain">Domain</Label>
              <Input
                id="bl-domain"
                placeholder="e.g., ahrefs.com"
                value={inputDomain}
                onChange={(e) => setInputDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
              />
            </div>
            <Button onClick={handleAnalyze} disabled={!inputDomain.trim()} className="gap-2">
              <Search className="h-4 w-4" />
              Analyze
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="backlinks">Backlinks</TabsTrigger>
          <TabsTrigger value="referring">Referring domains</TabsTrigger>
          <TabsTrigger value="anchors">Anchors</TabsTrigger>
          <TabsTrigger value="gap">Competitor gap</TabsTrigger>
          <TabsTrigger value="citations">Local citations</TabsTrigger>
        </TabsList>

        <TabsContent value="citations" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" /> Local citations live in your Local SEO project
              </CardTitle>
              <CardDescription>
                Citations are local-SEO assets, not backlinks. We moved the checklist to where it belongs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Open a Local SEO project to see the citation checklist with your business NAP pre-filled,
                country auto-detected, and per-site progress tracked across devices.
              </p>
              <Button asChild>
                <RouterLink to="/rank-tracking?tab=local">Go to Local SEO →</RouterLink>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {!enabled && tab !== 'citations' ? (
          <Card className="mt-6 border-dashed">
            <CardContent className="pt-12 pb-12 text-center">
              <p className="text-sm text-muted-foreground">
                Enter any domain above and click Analyze to populate this tab.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <TabsContent value="overview" className="mt-6">
              <OverviewTab target={activeTarget} />
            </TabsContent>
            <TabsContent value="backlinks" className="mt-6">
              <BacklinksListTab target={activeTarget} />
            </TabsContent>
            <TabsContent value="referring" className="mt-6">
              <ReferringDomainsTab target={activeTarget} />
            </TabsContent>
            <TabsContent value="anchors" className="mt-6">
              <AnchorsTab target={activeTarget} />
            </TabsContent>
            <TabsContent value="gap" className="mt-6">
              <CompetitorGapTab target={activeTarget} />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
