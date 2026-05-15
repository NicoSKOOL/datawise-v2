import { useState, useEffect, useCallback, useRef, type Ref } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProperty } from '@/contexts/PropertyContext';
import { fetchDashboardSummary } from '@/lib/dataforseo';
import { getGSCData, getGSCSitemaps, syncGSCProperty, type GSCOverviewData, type IndexationData } from '@/lib/gsc';
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
import IndexationChart from '@/components/dashboard/IndexationChart';

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

export default function Dashboard() {
  const { user } = useAuth();
  const {
    selectedProperty,
    primaryDomain,
    connected: gscConnected,
    loading: propertyLoading,
  } = useProperty();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [gscOverview, setGscOverview] = useState<GSCOverviewData | null>(null);
  const [indexation, setIndexation] = useState<IndexationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const loadRequestRef = useRef(0);
  const selectedGscPropertyId = selectedProperty && selectedProperty.kind !== 'manual'
    ? selectedProperty.id
    : undefined;

  const loadDashboardData = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const [summaryData, gscData] = await Promise.all([
        fetchDashboardSummary(primaryDomain || undefined).catch(() => null),
        selectedGscPropertyId
          ? Promise.all([
              getGSCData(selectedGscPropertyId).catch(() => null),
              getGSCSitemaps(selectedGscPropertyId).catch(() => null),
            ])
          : Promise.resolve([null, null] as const),
      ]);

      if (requestId !== loadRequestRef.current) return;

      const [overview, indexationData] = gscData;
      setSummary(summaryData as DashboardSummary | null);
      setGscOverview(overview?.query_summary ? overview : null);
      setIndexation(indexationData);
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  }, [primaryDomain, selectedGscPropertyId]);

  useEffect(() => {
    if (propertyLoading) {
      setLoading(true);
      return;
    }
    loadDashboardData();
  }, [propertyLoading, loadDashboardData]);

  const hasSelectedGscData = Boolean(gscConnected && selectedGscPropertyId);
  const hasData = summary?.has_projects || hasSelectedGscData;

  const gscTrendData = gscOverview?.daily_trend || [];

  const handleSyncGSC = async () => {
    if (!selectedGscPropertyId || syncing) return;

    setSyncing(true);
    try {
      await syncGSCProperty(selectedGscPropertyId);
      await loadDashboardData();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your AI-powered SEO command center
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : hasData ? (
        <>
          {/* KPI Row */}
          {summary && (
            <DashboardKPICards summary={summary} gscOverview={gscOverview} />
          )}

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {hasSelectedGscData && (
              <IndexationChart
                data={indexation}
                onSync={selectedGscPropertyId ? handleSyncGSC : undefined}
                syncing={syncing}
              />
            )}
            <GSCTrendChart data={gscTrendData} />
          </div>

          {/* Top Movers */}
          {summary && (
            <TopMoversTable
              movers={summary.top_movers}
              decliners={summary.top_decliners}
            />
          )}

          {/* Compact Quick Actions */}
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
        </>
      ) : (
        <>
          {/* GSC Connection Prompt */}
          {!gscConnected && (
            <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Connect Google Search Console</CardTitle>
                <CardDescription>
                  Unlock the SEO Assistant, dashboard metrics, and personalized recommendations by connecting your GSC account.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link to="/settings">
                    Connect GSC
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickActions.map((action) => (
              <ActionCard key={action.url} action={action} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
