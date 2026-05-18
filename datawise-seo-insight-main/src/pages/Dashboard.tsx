import { useState, useEffect, useCallback, useRef, type Ref } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, RefreshCw, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProperty } from '@/contexts/PropertyContext';
import { fetchDashboardSummary } from '@/lib/dataforseo';
import { getGSCData, type GSCOverviewData, type GSCRangeDays } from '@/lib/gsc';
import type { DashboardSummary } from '@/types/rank-tracking';
import type { AnimatedIconHandle } from '@/components/icons/types';
import MessageCircleIcon from '@/components/icons/message-circle-icon';
import MagnifierIcon from '@/components/icons/magnifier-icon';
import UsersIcon from '@/components/icons/users-icon';
import EyeIcon from '@/components/icons/eye-icon';
import ChartLineIcon from '@/components/icons/chart-line-icon';
import CheckedIcon from '@/components/icons/checked-icon';
import DashboardKPICards from '@/components/dashboard/DashboardKPICards';
import TopMoversTable from '@/components/dashboard/TopMoversTable';
import GSCTrendChart from '@/components/dashboard/GSCTrendChart';
import TopPagesPanel from '@/components/dashboard/TopPagesPanel';
import OpportunitiesPanel from '@/components/dashboard/OpportunitiesPanel';
import AddWebsiteCard from '@/components/dashboard/AddWebsiteCard';

const quickActions = [
  {
    title: 'SEO Assistant',
    description: 'Chat with an AI expert about your site performance',
    iconKey: 'message' as const,
    url: '/seo-assistant',
    color: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
    badge: 'Hero Feature',
  },
  {
    title: 'Keyword Research',
    description: 'Find and analyze keywords for your content strategy',
    iconKey: 'search' as const,
    url: '/keyword-research',
    color: 'bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400',
  },
  {
    title: 'Competitor Analysis',
    description: 'Benchmark against competitors and find opportunities',
    iconKey: 'users' as const,
    url: '/competitor-analysis',
    color: 'bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400',
  },
  {
    title: 'AI Visibility',
    description: 'Monitor your presence in AI search results',
    iconKey: 'eye' as const,
    url: '/ai-visibility',
    color: 'bg-orange-50 text-orange-600 dark:bg-orange-950 dark:text-orange-400',
  },
  {
    title: 'Rank Tracking',
    description: 'Track keyword positions over time',
    iconKey: 'chart' as const,
    url: '/rank-tracking',
    color: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400',
  },
  {
    title: 'Tasks',
    description: 'View and manage your SEO action items',
    iconKey: 'checked' as const,
    url: '/tasks',
    color: 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
  },
];

function AnimatedIcon({ iconKey, iconRef }: { iconKey: string; iconRef?: Ref<AnimatedIconHandle> }) {
  const props = { ref: iconRef, size: 20, color: 'currentColor', strokeWidth: 2 };
  switch (iconKey) {
    case 'message': return <MessageCircleIcon {...props} />;
    case 'search': return <MagnifierIcon {...props} />;
    case 'users': return <UsersIcon {...props} />;
    case 'eye': return <EyeIcon {...props} />;
    case 'chart': return <ChartLineIcon {...props} />;
    case 'checked': return <CheckedIcon {...props} />;
    default: return null;
  }
}

function ActionCard({ action }: { action: typeof quickActions[number] }) {
  const iconRef = useRef<AnimatedIconHandle>(null);

  return (
    <Link
      to={action.url}
      className="group"
      onMouseEnter={() => iconRef.current?.startAnimation()}
      onMouseLeave={() => iconRef.current?.stopAnimation()}
    >
      <Card className="h-full transition-all hover:shadow-md hover:border-primary/20">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className={`p-2.5 rounded-lg ${action.color}`}>
              <AnimatedIcon iconKey={action.iconKey} iconRef={iconRef} />
            </div>
            {action.badge && (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {action.badge}
              </span>
            )}
          </div>
          <CardTitle className="text-base mt-3">{action.title}</CardTitle>
          <CardDescription className="text-sm">{action.description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

function QuickActionsStrip() {
  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {quickActions.map((action) => (
          <Link
            key={action.url}
            to={action.url}
            className="flex items-center gap-2.5 p-3 rounded-lg bg-white shadow-[0_1px_4px_rgba(24,28,32,0.06)] hover:shadow-md transition-all text-sm font-medium"
          >
            <div className={`p-1.5 rounded-md ${action.color}`}>
              <AnimatedIcon iconKey={action.iconKey} />
            </div>
            <span className="truncate">{action.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ConnectGSCPanel({ domain }: { domain: string }) {
  const bullets = [
    'Your real clicks and impressions, trended week over week',
    'Striking-distance keywords ready for a quick push',
    'Search-visible page coverage for the site',
  ];
  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Connect Google Search Console</CardTitle>
        <CardDescription>
          {domain
            ? `Link ${domain} to Search Console to unlock your command center.`
            : 'Unlock your command center with your own Search Console data.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1.5">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <Button asChild>
          <Link to="/settings">
            Connect GSC
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

const RANGE_OPTIONS: { value: GSCRangeDays; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

function RangeSelector({
  value,
  onChange,
  refreshing,
}: {
  value: GSCRangeDays;
  onChange: (v: GSCRangeDays) => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {refreshing && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <div className="inline-flex rounded-lg border border-border bg-white p-0.5">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              value === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const {
    properties,
    selectedProperty,
    primaryDomain,
    connected: gscConnected,
    loading: propertyLoading,
  } = useProperty();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [gscOverview, setGscOverview] = useState<GSCOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<GSCRangeDays>(30);
  const loadRequestRef = useRef(0);
  const selectedGscPropertyId = selectedProperty && selectedProperty.kind !== 'manual'
    ? selectedProperty.id
    : undefined;

  const loadDashboardData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const [summaryData, overview] = await Promise.all([
        fetchDashboardSummary(primaryDomain || undefined).catch(() => null),
        selectedGscPropertyId
          ? getGSCData(selectedGscPropertyId, range).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (requestId !== loadRequestRef.current) return;

      setSummary(summaryData as DashboardSummary | null);
      setGscOverview(overview?.query_summary ? overview : null);
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [primaryDomain, selectedGscPropertyId, range]);

  useEffect(() => {
    if (propertyLoading) {
      setLoading(true);
      return;
    }
    loadDashboardData();
  }, [propertyLoading, loadDashboardData]);

  const gscTrendData = gscOverview?.daily_trend || [];

  // Tiered command center:
  //  - no website on the account  -> add-website field (Tier 0)
  //  - website but no GSC data    -> connect-GSC activation (Tier 1)
  //  - GSC data present           -> the command center (Tier 2)
  const hasAnyProperty = properties.length > 0;
  const hasGscData = Boolean(gscOverview);

  const Welcome = (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
      </h1>
      <p className="text-muted-foreground mt-1">Your AI-powered SEO command center</p>
    </div>
  );

  let body: React.ReactNode;

  if ((loading || propertyLoading) && !gscOverview) {
    body = (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  } else if (!hasAnyProperty) {
    body = (
      <>
        <AddWebsiteCard />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickActions.map((action) => (
            <ActionCard key={action.url} action={action} />
          ))}
        </div>
      </>
    );
  } else if (!hasGscData) {
    body = (
      <>
        <ConnectGSCPanel domain={primaryDomain} />
        <QuickActionsStrip />
      </>
    );
  } else {
    body = (
      <>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Performance</h2>
          <RangeSelector value={range} onChange={setRange} refreshing={loading} />
        </div>

        {summary && (
          <DashboardKPICards
            summary={summary}
            gscOverview={gscOverview}
            range={gscOverview?.range ?? null}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TopPagesPanel pages={gscOverview?.range?.top_pages ?? gscOverview?.top_pages ?? []} />
          <GSCTrendChart data={gscOverview?.range?.daily ?? gscTrendData} />
        </div>

        {gscOverview && (
          <OpportunitiesPanel
            opportunities={gscOverview.range?.opportunities ?? gscOverview.opportunities}
          />
        )}

        {summary && summary.has_projects && (
          <TopMoversTable movers={summary.top_movers} decliners={summary.top_decliners} />
        )}

        <QuickActionsStrip />
      </>
    );
  }

  return (
    <div className="space-y-8">
      {Welcome}
      {body}
    </div>
  );
}
