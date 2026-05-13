import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchTrafficAnalytics,
  fetchSignupAnalytics,
  type TrafficAnalytics,
  type SignupAnalytics,
} from '@/lib/admin';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { AlertCircle, BarChart3, Loader2, RefreshCw, Users, Globe, MousePointerClick } from 'lucide-react';

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function refHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Collapse the (utm_source, referrer) pairs into a single human-readable
// "source" label, preferring UTM if present, then referrer host, else "direct".
function labelFor(row: { utm_source: string | null; referrer: string | null }): string {
  if (row.utm_source) return row.utm_source;
  const host = refHost(row.referrer);
  if (host) return host;
  return 'direct';
}

interface AggregatedSource {
  source: string;
  signups: number;
  paid: number;
}

function aggregateSignups(rows: SignupAnalytics['by_source']): AggregatedSource[] {
  const map = new Map<string, AggregatedSource>();
  for (const row of rows) {
    const key = labelFor(row);
    const existing = map.get(key) ?? { source: key, signups: 0, paid: 0 };
    existing.signups += row.signups;
    existing.paid += row.paid;
    map.set(key, existing);
  }
  return Array.from(map.values()).sort((a, b) => b.signups - a.signups);
}

export default function AdminAnalytics() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [from, setFrom] = useState(daysAgoISO(30));
  const [to, setTo] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [traffic, setTraffic] = useState<TrafficAnalytics | null>(null);
  const [signups, setSignups] = useState<SignupAnalytics | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s] = await Promise.all([
        fetchTrafficAnalytics(from, to),
        fetchSignupAnalytics(from, to),
      ]);
      setTraffic(t);
      setSignups(s);
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to load analytics',
        description: (err as Error).message,
      });
    } finally {
      setLoading(false);
    }
  }, [from, to, toast]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const aggregatedSignupSources = useMemo(
    () => (signups ? aggregateSignups(signups.by_source) : []),
    [signups],
  );

  const trafficTotal = traffic?.totals.sessions ?? 0;
  const signupTotal = signups?.totals.total_signups ?? 0;

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-7 w-7" />
            Analytics
          </h1>
          <p className="text-muted-foreground">
            Where traffic and signups are coming from. Self-hosted, privacy-respecting (no IPs, no third parties).
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
            <Input
              id="from"
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              value={to}
              min={from}
              max={todayISO()}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Button
                key={d}
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFrom(daysAgoISO(d));
                  setTo(todayISO());
                }}
              >
                Last {d}d
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard
          icon={<MousePointerClick className="h-5 w-5" />}
          label="Sessions"
          value={traffic?.totals.sessions ?? 0}
          sublabel={`${traffic?.totals.pageviews ?? 0} pageviews`}
        />
        <SummaryCard
          icon={<Users className="h-5 w-5" />}
          label="New signups"
          value={signupTotal}
          sublabel={`${signups?.totals.paid_signups ?? 0} paid · ${signups?.totals.unattributed ?? 0} unattributed`}
        />
        <SummaryCard
          icon={<Globe className="h-5 w-5" />}
          label="Conversion"
          value={
            trafficTotal && signupTotal
              ? `${((signupTotal / trafficTotal) * 100).toFixed(1)}%`
              : '—'
          }
          sublabel="Signups per session"
        />
      </div>

      <Card>
        <CardContent className="space-y-4 py-6">
          <div>
            <h2 className="text-xl font-semibold">Traffic sources</h2>
            <p className="text-sm text-muted-foreground">
              Top sources by sessions in the selected range. Source = UTM tag, falling back to referring domain, then "direct".
            </p>
          </div>
          <SourceTable
            loading={loading}
            rows={traffic?.sources ?? []}
            total={trafficTotal}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 py-6">
          <div>
            <h2 className="text-xl font-semibold">Signup sources</h2>
            <p className="text-sm text-muted-foreground">
              New users grouped by their first-touch UTM tag or referring domain at signup.
            </p>
          </div>
          <SignupSourceTable
            loading={loading}
            rows={aggregatedSignupSources}
            total={signupTotal}
          />
        </CardContent>
      </Card>

      {signups && signups.by_campaign.length > 0 && (
        <Card>
          <CardContent className="space-y-4 py-6">
            <h2 className="text-xl font-semibold">Top campaigns</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Signups</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Conv.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signups.by_campaign.map((c) => (
                  <TableRow key={c.campaign}>
                    <TableCell className="font-medium">{c.campaign}</TableCell>
                    <TableCell className="text-right">{c.signups}</TableCell>
                    <TableCell className="text-right">{c.paid}</TableCell>
                    <TableCell className="text-right">
                      {c.signups ? `${((c.paid / c.signups) * 100).toFixed(1)}%` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {traffic && traffic.top_paths.length > 0 && (
        <Card>
          <CardContent className="space-y-4 py-6">
            <h2 className="text-xl font-semibold">Top landing paths</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Path</TableHead>
                  <TableHead className="text-right">Pageviews</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {traffic.top_paths.map((p) => (
                  <TableRow key={p.path}>
                    <TableCell className="font-mono text-xs">{p.path}</TableCell>
                    <TableCell className="text-right">{p.pageviews}</TableCell>
                    <TableCell className="text-right">{p.sessions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {signups && signups.recent_signups.length > 0 && (
        <Card>
          <CardContent className="space-y-4 py-6">
            <h2 className="text-xl font-semibold">Recent signups</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Promo</TableHead>
                  <TableHead>Referrer</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Signed up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signups.recent_signups.map((u) => (
                  <TableRow key={u.email + u.created_at}>
                    <TableCell>
                      <div className="font-medium">{u.name || u.email}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>{u.signup_utm_source || '—'}</TableCell>
                    <TableCell>{u.signup_utm_campaign || '—'}</TableCell>
                    <TableCell>{u.signup_promo_code || '—'}</TableCell>
                    <TableCell className="max-w-[260px] truncate" title={u.signup_referrer || ''}>
                      {refHost(u.signup_referrer) || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.subscription_tier === 'free' ? 'secondary' : 'default'}>
                        {u.subscription_tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(u.created_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryCard({
  icon, label, value, sublabel,
}: { icon: React.ReactNode; label: string; value: number | string; sublabel?: string }) {
  return (
    <Card>
      <CardContent className="space-y-2 py-6">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-3xl font-bold">{value}</div>
        {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
      </CardContent>
    </Card>
  );
}

function SourceTable({
  loading, rows, total,
}: {
  loading: boolean;
  rows: TrafficAnalytics['sources'];
  total: number;
}) {
  if (loading && rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">No traffic in this range yet.</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Sessions</TableHead>
          <TableHead className="text-right">Pageviews</TableHead>
          <TableHead className="text-right">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.source}>
            <TableCell className="font-medium">{r.source}</TableCell>
            <TableCell className="text-right">{r.sessions}</TableCell>
            <TableCell className="text-right">{r.pageviews}</TableCell>
            <TableCell className="text-right">
              {total ? `${((r.sessions / total) * 100).toFixed(1)}%` : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SignupSourceTable({
  loading, rows, total,
}: { loading: boolean; rows: AggregatedSource[]; total: number }) {
  if (loading && rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">No signups in this range yet.</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Signups</TableHead>
          <TableHead className="text-right">Paid</TableHead>
          <TableHead className="text-right">Conv.</TableHead>
          <TableHead className="text-right">Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.source}>
            <TableCell className="font-medium">{r.source}</TableCell>
            <TableCell className="text-right">{r.signups}</TableCell>
            <TableCell className="text-right">{r.paid}</TableCell>
            <TableCell className="text-right">
              {r.signups ? `${((r.paid / r.signups) * 100).toFixed(1)}%` : '—'}
            </TableCell>
            <TableCell className="text-right">
              {total ? `${((r.signups / total) * 100).toFixed(1)}%` : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
