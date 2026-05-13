import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchActivityEvents,
  fetchActivityFeatures,
  fetchActivityFunnel,
  fetchActivityOverview,
  fetchActivityUserDetail,
  fetchActivityUsers,
  generateActivitySummary,
  type ActivityEvent,
  type ActivityFeature,
  type ActivityFunnelStep,
  type ActivityOverview,
  type ActivitySummaryResponse,
  type ActivityUser,
  type ActivityUserDetail,
} from '@/lib/admin';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Activity, AlertCircle, BarChart3, Clock3, CreditCard, Eye, Loader2,
  RefreshCw, Search, ShieldAlert, Sparkles, UserRound, Users, Bot,
} from 'lucide-react';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatNumber(value: number | string | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function featureLabel(feature: string | null | undefined): string {
  if (!feature) return 'No activity';
  return feature.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

const TOOL_FEATURES = new Set([
  'keyword_research',
  'competitor_analysis',
  'ai_visibility',
  'rank_tracking',
  'local_seo',
  'content_planner',
  'content_writer',
  'content_tools',
  'site_audit',
  'backlinks',
  'seo_assistant',
]);

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value.replace(' ', 'T')).toLocaleString();
}

function pct(part: number, total: number): string {
  if (!total) return '0.0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function outcomeVariant(outcome?: string | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (outcome === 'success') return 'default';
  if (outcome === 'blocked') return 'secondary';
  if (outcome === 'error') return 'destructive';
  return 'outline';
}

export default function AdminActivity() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<ActivityOverview | null>(null);
  const [features, setFeatures] = useState<ActivityFeature[]>([]);
  const [users, setUsers] = useState<ActivityUser[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [funnel, setFunnel] = useState<ActivityFunnelStep[]>([]);
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState('all');
  const [sort, setSort] = useState('last_active');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<ActivityUserDetail | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [llmSummary, setLlmSummary] = useState<ActivitySummaryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewData, featureData, userData, funnelData, eventData] = await Promise.all([
        fetchActivityOverview(from, to),
        fetchActivityFeatures(from, to),
        fetchActivityUsers({ from, to, query, tier, sort }),
        fetchActivityFunnel(from, to),
        fetchActivityEvents({ from, to, limit: 60 }),
      ]);
      setOverview(overviewData);
      setFeatures(featureData.features);
      setUsers(userData.users);
      setFunnel(funnelData.steps);
      setEvents(eventData.events);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to load activity',
        description: (err as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, [from, to, query, tier, sort, toast]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  useEffect(() => {
    setLlmSummary(null);
  }, [from, to]);

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUser(null);
      return;
    }
    setLoadingUser(true);
    fetchActivityUserDetail(selectedUserId, from, to)
      .then(setSelectedUser)
      .catch((err) => {
        toast({
          variant: 'destructive',
          title: 'Failed to load user detail',
          description: (err as Error).message,
        });
      })
      .finally(() => setLoadingUser(false));
  }, [selectedUserId, from, to, toast]);

  const totals = overview?.totals;
  const totalFailures = (totals?.blocked_events ?? 0) + (totals?.error_events ?? 0);
  const toolFeatures = useMemo(
    () => features.filter((feature) => TOOL_FEATURES.has(feature.feature)),
    [features],
  );
  const maxFeatureEvents = useMemo(
    () => Math.max(1, ...toolFeatures.map((f) => Number(f.events || 0))),
    [toolFeatures],
  );
  const mostUsedTool = useMemo(
    () => [...toolFeatures].sort((a, b) => Number(b.events || 0) - Number(a.events || 0))[0] ?? null,
    [toolFeatures],
  );
  const broadestTool = useMemo(
    () => [...toolFeatures].sort((a, b) => Number(b.active_users || 0) - Number(a.active_users || 0))[0] ?? null,
    [toolFeatures],
  );

  const auditEvents = useMemo(
    () => events.filter((event) => event.event_category && event.event_category !== 'product'),
    [events],
  );

  const generateSummary = async () => {
    setSummaryLoading(true);
    try {
      const result = await generateActivitySummary(from, to);
      setLlmSummary(result);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to generate LLM summary',
        description: (err as Error).message,
      });
    } finally {
      setSummaryLoading(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="container mx-auto py-12">
        <Card>
          <CardContent className="flex items-center gap-3 py-8">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p>You do not have access to this page.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 py-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Activity className="h-7 w-7" />
            User Activity
          </h1>
          <p className="text-muted-foreground">
            Product usage, user timelines, credit activity, and admin/security logs.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Refresh</span>
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          <div className="space-y-1">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((days) => (
              <Button
                key={days}
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom(daysAgoISO(days));
                  setTo(todayISO());
                }}
              >
                Last {days}d
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <SummaryCard icon={<Users className="h-5 w-5" />} label="Active users" value={totals?.active_users ?? 0} sublabel={`${formatNumber(totals?.new_users)} new users`} />
        <SummaryCard icon={<Sparkles className="h-5 w-5" />} label="Events" value={totals?.total_events ?? 0} sublabel={`${formatNumber(totals?.success_events)} successful`} />
        <SummaryCard icon={<CreditCard className="h-5 w-5" />} label="Credits used" value={totals?.credits_used ?? 0} sublabel="Successful gated runs" />
        <SummaryCard icon={<ShieldAlert className="h-5 w-5" />} label="Blocked/error" value={totalFailures} sublabel={pct(totalFailures, totals?.total_events ?? 0)} />
        <SummaryCard icon={<Clock3 className="h-5 w-5" />} label="Avg latency" value={`${formatNumber(totals?.avg_duration_ms)}ms`} sublabel="Worker handler time" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ToolHighlight
          icon={<BarChart3 className="h-5 w-5" />}
          label="Most used tool"
          value={mostUsedTool ? featureLabel(mostUsedTool.feature) : 'No tool usage'}
          sublabel={mostUsedTool ? `${formatNumber(mostUsedTool.events)} runs in selected range` : 'Run a product tool to populate this.'}
        />
        <ToolHighlight
          icon={<Users className="h-5 w-5" />}
          label="Broadest tool reach"
          value={broadestTool ? featureLabel(broadestTool.feature) : 'No tool usage'}
          sublabel={broadestTool ? `${formatNumber(broadestTool.active_users)} active users used it` : 'Counts unique users per tool.'}
        />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Decision datasets to add next</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm text-muted-foreground">
            <DatasetItem label="Source to activation" detail="Signup source, first connected site, first tool run." />
            <DatasetItem label="Retention cohorts" detail="D1, D7, D30 return rates by signup week." />
            <DatasetItem label="Tool quality" detail="Success, errors, empty results, blocked credits." />
            <DatasetItem label="Cost by feature" detail="Credits, DFS calls, LLM tokens, latency." />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Bot className="h-5 w-5" />
              LLM usage analysis
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Generates an aggregate-only readout of usage trends, friction, and decisions for the selected range.
            </p>
          </div>
          <Button onClick={generateSummary} disabled={summaryLoading}>
            {summaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span className="ml-2">{llmSummary ? 'Regenerate' : 'Generate analysis'}</span>
          </Button>
        </CardHeader>
        <CardContent>
          {llmSummary ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-4 text-sm leading-6">
                <ReactMarkdown skipHtml>{llmSummary.summary}</ReactMarkdown>
              </div>
              <div className="text-xs text-muted-foreground">
                Generated {formatDate(llmSummary.generated_at)} · {formatNumber(llmSummary.usage.input_tokens + llmSummary.usage.output_tokens)} tokens · {llmSummary.model_source}
              </div>
              {llmSummary.fallback_reason ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Local fallback used: {llmSummary.fallback_reason}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              Click generate to ask the configured LLM for a short product-analytics summary. Only aggregate counts are sent.
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="events">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Activation funnel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading && funnel.length === 0 ? (
                  <LoadingRow />
                ) : funnel.length === 0 ? (
                  <EmptyRow label="No funnel data yet." />
                ) : (
                  funnel.map((step) => (
                    <div key={step.key} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">{step.label}</span>
                        <span className="text-sm text-muted-foreground">{formatNumber(step.users)} users · {step.rate.toFixed(1)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, step.rate))}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl">Tool adoption</CardTitle>
              </CardHeader>
              <CardContent>
                <FeatureTable rows={toolFeatures} maxEvents={maxFeatureEvents} loading={loading} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Recent failures and blocks</CardTitle>
            </CardHeader>
            <CardContent>
              <EventTable events={overview?.recent_failures ?? []} loading={loading} compact />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-4 py-4">
              <div className="min-w-[260px] flex-1 space-y-1">
                <Label htmlFor="activity-search">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="activity-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Email or name"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Tier</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tiers</SelectItem>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="community">Community</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Sort</Label>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="last_active">Last active</SelectItem>
                    <SelectItem value="events">Events</SelectItem>
                    <SelectItem value="credits">Credits</SelectItem>
                    <SelectItem value="created">Created</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-6">
              <UserTable users={users} loading={loading} onSelect={setSelectedUserId} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Admin and security audit log</CardTitle>
            </CardHeader>
            <CardContent>
              <EventTable events={auditEvents} loading={loading} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Recent product activity</CardTitle>
            </CardHeader>
            <CardContent>
              <EventTable events={events} loading={loading} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedUserId} onOpenChange={(open) => { if (!open) setSelectedUserId(null); }}>
        <DialogContent className="max-h-[86vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User activity detail</DialogTitle>
          </DialogHeader>
          {loadingUser || !selectedUser ? (
            <LoadingRow />
          ) : (
            <UserDetail detail={selectedUser} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  icon, label, value, sublabel,
}: { icon: ReactNode; label: string; value: number | string; sublabel: string }) {
  return (
    <Card>
      <CardContent className="space-y-2 py-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-3xl font-bold">{typeof value === 'number' ? formatNumber(value) : value}</div>
        <div className="text-xs text-muted-foreground">{sublabel}</div>
      </CardContent>
    </Card>
  );
}

function ToolHighlight({
  icon, label, value, sublabel,
}: { icon: ReactNode; label: string; value: string; sublabel: string }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-6">
        <div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div>
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 truncate text-2xl font-bold">{value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DatasetItem({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex gap-2">
      <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
      <span><span className="font-medium text-foreground">{label}:</span> {detail}</span>
    </div>
  );
}

function FeatureTable({ rows, maxEvents, loading }: { rows: ActivityFeature[]; maxEvents: number; loading: boolean }) {
  if (loading && rows.length === 0) return <LoadingRow />;
  if (rows.length === 0) return <EmptyRow label="No tool activity in this range yet." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Feature</TableHead>
          <TableHead className="text-right">Users</TableHead>
          <TableHead className="text-right">Events</TableHead>
          <TableHead className="text-right">Credits</TableHead>
          <TableHead className="text-right">Fail rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const failures = Number(row.blocked_events || 0) + Number(row.error_events || 0);
          const events = Number(row.events || 0);
          return (
            <TableRow key={row.feature}>
              <TableCell>
                <div className="space-y-1">
                  <div className="font-medium">{featureLabel(row.feature)}</div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.max(4, (events / maxEvents) * 100)}%` }} />
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-right">{formatNumber(row.active_users)}</TableCell>
              <TableCell className="text-right">{formatNumber(row.events)}</TableCell>
              <TableCell className="text-right">{formatNumber(row.credits_used)}</TableCell>
              <TableCell className="text-right">{pct(failures, events)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function UserTable({ users, loading, onSelect }: { users: ActivityUser[]; loading: boolean; onSelect: (id: string) => void }) {
  if (loading && users.length === 0) return <LoadingRow />;
  if (users.length === 0) return <EmptyRow label="No users matched this range and filter." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Tier</TableHead>
          <TableHead>Top feature</TableHead>
          <TableHead className="text-right">Active days</TableHead>
          <TableHead className="text-right">Events</TableHead>
          <TableHead className="text-right">Credits</TableHead>
          <TableHead>Last active</TableHead>
          <TableHead className="text-right">Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell>
              <div className="font-medium">{user.name || user.email}</div>
              <div className="text-xs text-muted-foreground">{user.email}</div>
            </TableCell>
            <TableCell>
              <Badge variant={user.subscription_tier === 'free' ? 'secondary' : 'default'}>
                {user.subscription_tier}
              </Badge>
            </TableCell>
            <TableCell>{featureLabel(user.top_feature)}</TableCell>
            <TableCell className="text-right">{formatNumber(user.active_days)}</TableCell>
            <TableCell className="text-right">{formatNumber(user.total_events)}</TableCell>
            <TableCell className="text-right">{formatNumber(user.credits_used)}</TableCell>
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(user.last_active)}</TableCell>
            <TableCell className="text-right">
              <Button variant="ghost" size="sm" onClick={() => onSelect(user.id)}>
                <Eye className="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EventTable({ events, loading, compact = false }: { events: ActivityEvent[]; loading: boolean; compact?: boolean }) {
  if (loading && events.length === 0) return <LoadingRow />;
  if (events.length === 0) return <EmptyRow label="No events in this range yet." />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          {!compact && <TableHead>User</TableHead>}
          <TableHead>Feature</TableHead>
          <TableHead>Status</TableHead>
          {!compact && <TableHead className="text-right">Credits</TableHead>}
          <TableHead>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event, index) => (
          <TableRow key={event.id || `${event.event_name}-${event.created_at}-${index}`}>
            <TableCell>
              <div className="font-medium">{event.event_name}</div>
              <div className="text-xs text-muted-foreground">{event.route || event.error_code || '-'}</div>
            </TableCell>
            {!compact && (
              <TableCell>
                <div>{event.name || event.email || '-'}</div>
                {event.email && <div className="text-xs text-muted-foreground">{event.email}</div>}
              </TableCell>
            )}
            <TableCell>{featureLabel(event.feature)}</TableCell>
            <TableCell>
              <Badge variant={outcomeVariant(event.outcome)}>{event.outcome || event.status_code || '-'}</Badge>
            </TableCell>
            {!compact && <TableCell className="text-right">{formatNumber(event.credit_cost || 0)}</TableCell>}
            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatDate(event.created_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function UserDetail({ detail }: { detail: ActivityUserDetail }) {
  const user = detail.user;
  const summary = detail.summary || {};
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <UserRound className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <div className="font-semibold">{user.name || user.email}</div>
            <div className="text-sm text-muted-foreground">{user.email}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={user.subscription_tier === 'free' ? 'secondary' : 'default'}>{user.subscription_tier}</Badge>
          {user.is_admin === 1 && <Badge variant="outline">Admin</Badge>}
          {user.is_community_member === 1 && <Badge variant="outline">Community</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <MiniMetric label="Events" value={summary.total_events ?? 0} />
        <MiniMetric label="Active days" value={summary.active_days ?? 0} />
        <MiniMetric label="Credits" value={summary.credits_used ?? 0} />
        <MiniMetric label="Failures" value={(summary.blocked_events ?? 0) + (summary.error_events ?? 0)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Feature mix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.features.length === 0 ? (
              <EmptyRow label="No feature events." />
            ) : detail.features.map((feature) => (
              <div key={feature.feature} className="flex items-center justify-between gap-3 text-sm">
                <span>{featureLabel(feature.feature)}</span>
                <span className="text-muted-foreground">{formatNumber(feature.events)} events</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <EventTable events={detail.events} loading={false} compact />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{formatNumber(value)}</div>
    </div>
  );
}

function LoadingRow() {
  return <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>;
}

function EmptyRow({ label }: { label: string }) {
  return <div className="py-6 text-center text-sm text-muted-foreground">{label}</div>;
}
