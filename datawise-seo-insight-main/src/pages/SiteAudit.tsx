import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  ClipboardCheck,
  Loader2,
  Plus,
  ArrowLeft,
  ListTodo,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Sparkles,
  Zap,
  Target,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import {
  createAudit,
  listAudits,
  getAudit,
  listActionItems,
  listPropertyTasks,
  deleteAudit,
  type SiteAuditListItem,
  type Category,
  type AuditFinding,
  type Severity,
  type SiteAudit,
  type CrawledPageSummary,
} from '@/lib/site-audit';
import { ExportMenu } from '@/components/export/ExportMenu';
import { buildSiteAuditReport } from '@/lib/export/adapters/siteAudit';
import { ActionKanban } from '@/components/site-audit/ActionKanban';
import { CategorySection } from '@/components/site-audit/CategorySection';
import { SEODashboard } from '@/components/site-audit/SEODashboard';
import { SiteAuditErrorBoundary } from '@/components/site-audit/ErrorBoundary';
import { MetaChecker } from '@/components/site-audit/MetaChecker';
import DotLottieLoader from '@/components/DotLottieLoader';
import { useProperty } from '@/contexts/PropertyContext';
import { sanitizeDomain } from '@/lib/utils';

const CATEGORY_ORDER: Category[] = [
  'performance',
  'seo',
  'accessibility',
  'best_practices',
  'meta',
  'images',
  'technical',
  'content',
];

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

function cleanDomain(siteUrl: string): string {
  return siteUrl.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/\/+$/, '');
}

function formatDate(s: string): string {
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString();
}

const DETAIL_VIEWS = new Set(['audit', 'overview', 'findings', 'board']);
const ACCESS_ISSUE_CODES = new Set([
  'forbidden_robots',
  'forbidden_meta_tag',
  'forbidden_http_header',
  'invalid_page_status_code',
  'site_unreachable',
  'too_many_redirects',
  'unknown_zero_page_crawl',
]);

function diagnosticMessage(audit: Pick<SiteAuditListItem, 'crawl_diagnostics' | 'error_message'>): string | null {
  return audit.crawl_diagnostics?.user_message || audit.error_message || null;
}

function isAccessIssue(audit: Pick<SiteAuditListItem, 'crawl_diagnostics' | 'status'>): boolean {
  return audit.status === 'failed' && ACCESS_ISSUE_CODES.has(audit.crawl_diagnostics?.reason_code || '');
}

export default function SiteAudit() {
  return (
    <SiteAuditErrorBoundary>
      <SiteAuditInner />
    </SiteAuditErrorBoundary>
  );
}

function SiteAuditInner() {
  const [params, setParams] = useSearchParams();
  const id = params.get('id');
  const tab = params.get('tab');
  const view = params.get('view') || (id ? 'audit' : 'list');

  if (tab === 'meta-checker' && !id) {
    return <MetaChecker />;
  }
  if (id && DETAIL_VIEWS.has(view)) {
    return <AuditDetailView auditId={id} view={view} onBack={() => setParams({})} />;
  }
  return <AuditListView />;
}

// ========== LIST VIEW ==========
function AuditListView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { properties, selectedPropertyId } = useProperty();
  const [, setParams] = useSearchParams();

  const defaultDomain = useMemo(() => {
    const prop = properties.find((p) => p.id === selectedPropertyId);
    return prop ? cleanDomain(prop.site_url) : '';
  }, [properties, selectedPropertyId]);

  const [domain, setDomain] = useState('');
  useEffect(() => {
    if (!domain && defaultDomain) setDomain(defaultDomain);
  }, [defaultDomain, domain]);

  const audits = useQuery({
    queryKey: ['site-audits'],
    queryFn: listAudits,
    refetchInterval: (q) => {
      const data = q.state.data as SiteAuditListItem[] | undefined;
      return data?.some((a) => a.status === 'running' || a.status === 'analyzing' || a.status === 'pending')
        ? 3000
        : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: createAudit,
    onSuccess: (audit) => {
      qc.invalidateQueries({ queryKey: ['site-audits'] });
      setParams({ view: 'audit', id: audit.id });
    },
    onError: (err: Error) => {
      toast({
        title: 'Could not start audit',
        description: err.message || 'Please try again in a moment.',
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAudit,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['site-audits'] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6" />
          Site Audit
        </h1>
        <p className="text-muted-foreground">
          Day 1 of the 7-Day Plan. Drop in your domain. We run a full Lighthouse audit and turn every failing check into an action card you can work through all week.
        </p>
      </div>

      {/* New audit card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start a new audit</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const cleaned = sanitizeDomain(domain);
              if (!cleaned) return;
              if (cleaned !== domain) setDomain(cleaned);
              createMutation.mutate(cleaned);
            }}
          >
            <Input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onBlur={(e) => setDomain(sanitizeDomain(e.target.value))}
              placeholder="yourdomain.com"
              className="flex-1"
              disabled={createMutation.isPending}
            />
            <Button type="submit" disabled={createMutation.isPending || !domain.trim()}>
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Run audit
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2">
            Runs in the background via DataForSEO OnPage. Most audits finish in a few minutes; protected or staging URLs may need crawler access first. Uses 1 credit.
          </p>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Your audits</h2>
        {audits.isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {audits.data && audits.data.length === 0 && (
          <div className="rounded-lg border-2 border-dashed p-10 text-center text-sm text-muted-foreground">
            No audits yet. Start one above to kick off your 7-day plan.
          </div>
        )}
        <div className="space-y-2">
          {(audits.data || []).map((a) => (
            <AuditRow
              key={a.id}
              audit={a}
              onOpen={() => setParams({ view: 'audit', id: a.id })}
              onDelete={() => deleteMutation.mutate(a.id)}
              onRetry={() => createMutation.mutate(a.domain)}
              isRetrying={createMutation.isPending}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AuditRow({
  audit,
  onOpen,
  onDelete,
  onRetry,
  isRetrying,
}: {
  audit: SiteAuditListItem;
  onOpen: () => void;
  onDelete: () => void;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  const progress =
    audit.total_items > 0 ? Math.round((audit.done_items / audit.total_items) * 100) : 0;
  const message = diagnosticMessage(audit);
  return (
    <Card className="hover:border-primary/50 transition-colors cursor-pointer" onClick={onOpen}>
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{audit.domain}</p>
            <StatusBadge status={audit.status} accessIssue={isAccessIssue(audit)} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{formatDate(audit.created_at)}</p>
          {audit.status === 'failed' && message && (
            <p className="text-xs text-red-600 mt-1 line-clamp-2">{message}</p>
          )}
        </div>

        {audit.status === 'completed' && (
          <div className="flex items-center gap-4 flex-shrink-0">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Score</p>
              <p className="text-lg font-semibold">{audit.score ?? '—'}</p>
            </div>
            <div className="w-32 hidden sm:block">
              <p className="text-xs text-muted-foreground mb-1">
                {audit.done_items}/{audit.total_items} done
              </p>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        )}

        {audit.status === 'failed' && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1 flex-shrink-0"
            disabled={isRetrying}
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
          >
            {isRetrying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Retry
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Delete this audit? This cannot be undone.')) onDelete();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, accessIssue = false }: { status: string; accessIssue?: boolean }) {
  if (status === 'completed') {
    return (
      <Badge variant="outline" className="border-green-500/40 text-green-600">
        Completed
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="border-red-500/40 text-red-600">
        {accessIssue ? 'Needs access' : 'Failed'}
      </Badge>
    );
  }
  if (status === 'running' || status === 'pending' || status === 'analyzing') {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-600">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        {status === 'pending' ? 'Queued' : status === 'analyzing' ? 'Analyzing' : 'Crawling'}
      </Badge>
    );
  }
  return <Badge variant="outline">{status}</Badge>;
}

// ========== DETAIL VIEW ==========
function AuditDetailView({
  auditId,
  view,
  onBack,
}: {
  auditId: string;
  view: string;
  onBack: () => void;
}) {
  const [, setParams] = useSearchParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { selectedPropertyId } = useProperty();

  const auditQuery = useQuery({
    queryKey: ['site-audit', auditId],
    queryFn: () => getAudit(auditId),
    refetchInterval: (q) => {
      const d = q.state.data as { audit: SiteAudit } | undefined;
      const status = d?.audit.status;
      return status === 'running' || status === 'pending' || status === 'analyzing' ? 3000 : false;
    },
  });

  const audit = auditQuery.data?.audit;
  const findings = useMemo(() => auditQuery.data?.findings || [], [auditQuery.data]);
  const crawledPages = audit?.seo_analysis?.crawled_pages || [];
  const retryMutation = useMutation({
    mutationFn: createAudit,
    onSuccess: (newAudit) => {
      qc.invalidateQueries({ queryKey: ['site-audits'] });
      setParams({ view: 'audit', id: newAudit.id });
    },
    onError: (err: Error) => {
      toast({
        title: 'Could not restart audit',
        description: err.message || 'Please try again in a moment.',
        variant: 'destructive',
      });
    },
  });

  // Drive the Action Board tab count using the same query the kanban uses,
  // so manual tasks are included.
  const itemsQuery = useQuery({
    queryKey: selectedPropertyId
      ? ['tasks', 'property', selectedPropertyId, auditId]
      : ['tasks', 'audit', auditId],
    queryFn: () =>
      selectedPropertyId ? listPropertyTasks(selectedPropertyId, auditId) : listActionItems(auditId),
    enabled: audit?.status === 'completed',
  });


  // Filter state
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all');
  const [filterCategory, setFilterCategory] = useState<Category | 'all'>('all');
  const [onlyQuickWins, setOnlyQuickWins] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // By default hide 'advanced' findings from the Full Report tab — they're
  // too technical for beginners. The "Show advanced" toggle surfaces them.
  const visibleFindings = useMemo(
    () => findings.filter((f) => showAdvanced || f.evidence?.impact !== 'advanced'),
    [findings, showAdvanced]
  );
  const advancedCount = useMemo(
    () => findings.filter((f) => f.evidence?.impact === 'advanced').length,
    [findings]
  );

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of visibleFindings) counts[f.severity]++;
    return counts;
  }, [visibleFindings]);

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<Category, number>> = {};
    for (const f of visibleFindings) counts[f.category] = (counts[f.category] || 0) + 1;
    return counts;
  }, [visibleFindings]);

  const quickWinsCount = useMemo(
    () => visibleFindings.filter((f) => f.evidence?.impact === 'quick_win').length,
    [visibleFindings]
  );

  const filteredFindings = useMemo(() => {
    return visibleFindings.filter((f) => {
      if (filterSeverity !== 'all' && f.severity !== filterSeverity) return false;
      if (filterCategory !== 'all' && f.category !== filterCategory) return false;
      if (onlyQuickWins && f.evidence?.impact !== 'quick_win') return false;
      return true;
    });
  }, [visibleFindings, filterSeverity, filterCategory, onlyQuickWins]);

  const findingsByCategory = useMemo(() => {
    const grouped: Partial<Record<Category, AuditFinding[]>> = {};
    for (const f of filteredFindings) {
      if (!grouped[f.category]) grouped[f.category] = [];
      grouped[f.category]!.push(f);
    }
    return grouped;
  }, [filteredFindings]);

  const criticalFindings = useMemo(
    () => visibleFindings.filter((f) => f.severity === 'critical').slice(0, 6),
    [visibleFindings]
  );

  const categoryScore = (cat: Category): number | null => {
    if (!audit) return null;
    if (cat === 'performance') return audit.perf_score;
    if (cat === 'seo') return audit.seo_score;
    if (cat === 'accessibility') return audit.a11y_score;
    if (cat === 'best_practices') return audit.best_practices_score;
    return null;
  };

  if (auditQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading audit…</div>;
  }
  if (!audit) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <p className="text-sm text-muted-foreground">Audit not found.</p>
      </div>
    );
  }

  const isRunning =
    audit.status === 'running' || audit.status === 'pending' || audit.status === 'analyzing';

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> All audits
      </Button>

      {/* PAGE TITLE */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight truncate">{audit.domain}</h1>
            <a
              href={audit.start_url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-primary"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <StatusBadge status={audit.status} accessIssue={isAccessIssue(audit)} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">{formatDate(audit.created_at)}</p>
        </div>

        <div className="flex items-start gap-4 flex-wrap">
          {audit.status === 'completed' && (
            <div className="flex gap-4 flex-wrap">
              <MiniScoreBlock label="Performance" score={audit.perf_score} />
              <MiniScoreBlock label="SEO" score={audit.seo_score} />
              <MiniScoreBlock label="Accessibility" score={audit.a11y_score} />
              <MiniScoreBlock label="Best Practices" score={audit.best_practices_score} />
            </div>
          )}
          <ExportMenu
            surface="site-audit"
            identifier={audit.domain}
            buildPayload={() => buildSiteAuditReport({ audit, findings })}
            disabled={audit.status !== 'completed'}
          />
        </div>
      </div>

      {/* RUNNING STATE */}
      {isRunning && (
        <Card>
          <CardContent className="p-8">
            <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
              <DotLottieLoader size={112} className="flex-shrink-0" />
              <div className="max-w-2xl">
                <p className="font-medium">
                  {audit.status === 'pending'
                    ? 'Queued for crawling...'
                    : audit.status === 'analyzing'
                      ? 'Analyzing crawl data...'
                      : 'Crawling site...'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  DataForSEO is crawling in the background. You can leave this page open or come back later.
                </p>
                {audit.pages_crawled > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    {audit.pages_crawled} page{audit.pages_crawled === 1 ? '' : 's'} crawled so far.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* FAILED STATE */}
      {audit.status === 'failed' && (
        <Card className="border-red-500/40">
          <CardContent className="p-6 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{isAccessIssue(audit) ? 'Needs crawler access' : 'Audit failed'}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {diagnosticMessage(audit) || 'Something went wrong. Try running another audit.'}
              </p>
              {audit.crawl_diagnostics?.extended_crawl_status && (
                <p className="text-xs text-muted-foreground mt-2">
                  DataForSEO status: {audit.crawl_diagnostics.extended_crawl_status}
                </p>
              )}
            </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 flex-shrink-0"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate(audit.domain)}
            >
              {retryMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* COMPLETED STATE */}
      {audit.status === 'completed' && (
        <>
          <Tabs defaultValue={view === 'board' ? 'board' : view === 'findings' ? 'findings' : 'overview'}>
            <TabsList>
              <TabsTrigger
                value="overview"
                onClick={() => setParams({ view: 'audit', id: auditId })}
              >
                <Sparkles className="h-4 w-4 mr-1" />
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="findings"
                onClick={() => setParams({ view: 'findings', id: auditId })}
              >
                Full Report ({findings.filter((f) => f.evidence?.impact !== 'advanced').length})
              </TabsTrigger>
              <TabsTrigger
                value="board"
                onClick={() => setParams({ view: 'board', id: auditId })}
              >
                <ListTodo className="h-4 w-4 mr-1" />
                Action Board ({itemsQuery.data?.length || 0})
              </TabsTrigger>
            </TabsList>

            {/* ========== OVERVIEW TAB: new dashboard ========== */}
            <TabsContent value="overview" className="mt-6">
              {audit.seo_analysis ? (
                <SEODashboard seo={audit.seo_analysis} ai={audit.ai_analysis} />
              ) : (
                <Card>
                  <CardContent className="p-8 text-center text-sm text-muted-foreground">
                    This audit was run before the new dashboard was released. Run a fresh audit to see the full report.
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="findings" className="mt-4 space-y-6">
              {crawledPages.length > 0 && (
                <CrawledPagesReport pages={crawledPages} reportedCount={audit.pages_crawled} />
              )}

              {findings.length === 0 && (
                <div className="rounded-lg border-2 border-dashed p-10 text-center text-sm text-muted-foreground">
                  No issues found. Your site is in great shape!
                </div>
              )}

              {/* Critical Issues Strip */}
              {criticalFindings.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="h-4 w-4 text-red-600" />
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-red-600">
                      Fix these first
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {criticalFindings.length} critical issue{criticalFindings.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
                    {criticalFindings.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => {
                          const el = document.getElementById(`finding-${f.id}`);
                          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="flex-shrink-0 w-[280px] snap-start rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-left hover:border-red-500/60 hover:bg-red-500/10 transition-all"
                      >
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <Zap className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                          {f.evidence?.display_value && (
                            <span className="font-mono tabular-nums text-sm font-semibold text-red-600">
                              {f.evidence.display_value}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold line-clamp-2 leading-snug mb-2">
                          {f.title}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-red-600 font-medium">
                          Jump to fix <ArrowRight className="h-3 w-3" />
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Filter bar */}
              {findings.length > 0 && (
                <div className="sticky top-0 z-10 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-b">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Severity pills */}
                    <FilterPill
                      active={filterSeverity === 'all'}
                      onClick={() => setFilterSeverity('all')}
                      count={findings.length}
                    >
                      All
                    </FilterPill>
                    {SEVERITY_ORDER.map((sev) =>
                      severityCounts[sev] > 0 ? (
                        <FilterPill
                          key={sev}
                          active={filterSeverity === sev}
                          onClick={() =>
                            setFilterSeverity(filterSeverity === sev ? 'all' : sev)
                          }
                          count={severityCounts[sev]}
                          severity={sev}
                        >
                          {sev[0].toUpperCase() + sev.slice(1)}
                        </FilterPill>
                      ) : null
                    )}

                    <span className="w-px h-5 bg-border mx-1" />

                    {/* Quick wins toggle */}
                    {quickWinsCount > 0 && (
                      <FilterPill
                        active={onlyQuickWins}
                        onClick={() => setOnlyQuickWins(!onlyQuickWins)}
                        count={quickWinsCount}
                        icon={<Zap className="h-3 w-3" />}
                      >
                        Quick wins
                      </FilterPill>
                    )}

                    {/* Category filter */}
                    {filterCategory !== 'all' && (
                      <FilterPill
                        active
                        onClick={() => setFilterCategory('all')}
                        count={categoryCounts[filterCategory]}
                      >
                        {filterCategory.replace('_', ' ')} ✕
                      </FilterPill>
                    )}

                    {/* Spacer + advanced toggle + result count */}
                    <div className="flex-1" />
                    {advancedCount > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showAdvanced ? 'Hide' : 'Show'} {advancedCount} technical item
                        {advancedCount === 1 ? '' : 's'}
                      </button>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {filteredFindings.length} of {visibleFindings.length}
                    </span>
                  </div>
                </div>
              )}

              {/* Category sections */}
              {filteredFindings.length === 0 && findings.length > 0 && (
                <div className="rounded-lg border-2 border-dashed p-10 text-center text-sm text-muted-foreground">
                  No findings match your filters. <button onClick={() => { setFilterSeverity('all'); setFilterCategory('all'); setOnlyQuickWins(false); }} className="text-primary hover:underline">Clear filters</button>
                </div>
              )}

              <div className="space-y-6">
                {CATEGORY_ORDER.filter((cat) => (findingsByCategory[cat]?.length ?? 0) > 0).map(
                  (cat) => (
                    <CategorySection
                      key={cat}
                      category={cat}
                      findings={findingsByCategory[cat]!}
                      categoryScore={categoryScore(cat)}
                    />
                  )
                )}
              </div>
            </TabsContent>

            <TabsContent value="board" className="mt-4">
              <ActionKanban auditId={auditId} propertyId={selectedPropertyId || null} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function formatLoadTime(ms: number | null): string {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname === '/' ? parsed.hostname : `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function pageStatusClass(page: CrawledPageSummary): string {
  if (page.status_code != null && page.status_code >= 400) {
    return 'border-red-500/30 text-red-600 bg-red-500/5';
  }
  if (page.issue_count > 0) {
    return 'border-amber-500/30 text-amber-700 bg-amber-500/5';
  }
  return 'border-green-500/30 text-green-600 bg-green-500/5';
}

function pageStatusLabel(page: CrawledPageSummary): string {
  if (page.status_code != null && page.status_code >= 400) return `${page.status_code}`;
  if (page.issue_count > 0) return `${page.issue_count} issue${page.issue_count === 1 ? '' : 's'}`;
  return 'OK';
}

function fieldStatusLabel(status: string, okLabel: string): string {
  if (status === 'ok') return okLabel;
  return status.replace('_', ' ');
}

function CrawledPagesReport({
  pages,
  reportedCount,
}: {
  pages: CrawledPageSummary[];
  reportedCount: number;
}) {
  const total = Math.max(reportedCount || 0, pages.length);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Crawled pages</h3>
          <p className="text-xs text-muted-foreground">
            Showing {pages.length} returned page{pages.length === 1 ? '' : 's'}
            {total > pages.length ? ` from ${total} crawled` : ''}.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Page</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Title</th>
              <th className="px-4 py-3 text-left font-medium">Description</th>
              <th className="px-4 py-3 text-left font-medium">H1</th>
              <th className="px-4 py-3 text-right font-medium">Load</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {pages.map((page) => (
              <tr key={page.url} className="align-top">
                <td className="px-4 py-3">
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex max-w-[260px] items-center gap-1.5 text-primary hover:underline"
                    title={page.url}
                  >
                    <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{formatPath(page.url)}</span>
                  </a>
                  {page.is_homepage && (
                    <div className="mt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Homepage
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className={pageStatusClass(page)}>
                    {pageStatusLabel(page)}
                  </Badge>
                  {page.status_code != null && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      HTTP {page.status_code}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-[220px] truncate" title={page.title || ''}>
                    {page.title || 'Missing'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {fieldStatusLabel(page.title_status, `${page.title_length} chars`)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="max-w-[240px] truncate" title={page.description || ''}>
                    {page.description || 'Missing'}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {fieldStatusLabel(page.description_status, `${page.description_length} chars`)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div>{page.h1_count}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {fieldStatusLabel(page.h1_status, 'ok')}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">
                  {formatLoadTime(page.load_ms)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ========== MINI SCORE BLOCK (header) ==========
function MiniScoreBlock({ label, score }: { label: string; score: number | null }) {
  const value = score ?? 0;
  const color =
    value >= 90 ? 'text-green-600' : value >= 70 ? 'text-green-500' : value >= 50 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold tabular-nums leading-tight ${color}`}>
        {score == null ? '—' : score}
      </div>
    </div>
  );
}

// ========== FILTER PILL ==========
const SEVERITY_PILL_COLORS: Record<Severity, { active: string; inactive: string }> = {
  critical: {
    active: 'bg-red-500 text-white border-red-500',
    inactive: 'text-red-600 border-red-500/30 hover:bg-red-500/10',
  },
  high: {
    active: 'bg-orange-500 text-white border-orange-500',
    inactive: 'text-orange-600 border-orange-500/30 hover:bg-orange-500/10',
  },
  medium: {
    active: 'bg-amber-500 text-white border-amber-500',
    inactive: 'text-amber-600 border-amber-500/30 hover:bg-amber-500/10',
  },
  low: {
    active: 'bg-blue-500 text-white border-blue-500',
    inactive: 'text-blue-600 border-blue-500/30 hover:bg-blue-500/10',
  },
};

function FilterPill({
  active,
  onClick,
  count,
  severity,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  severity?: Severity;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const severityClass = severity ? SEVERITY_PILL_COLORS[severity] : null;
  const className = severityClass
    ? active
      ? severityClass.active
      : `bg-background ${severityClass.inactive}`
    : active
      ? 'bg-primary text-primary-foreground border-primary'
      : 'bg-background text-foreground border-border hover:bg-muted';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${className}`}
    >
      {icon}
      {children}
      {count != null && <span className="tabular-nums opacity-80">{count}</span>}
    </button>
  );
}
