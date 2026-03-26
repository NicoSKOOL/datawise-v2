import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import {
  fetchRankProjects, createRankProject, deleteRankProject,
  fetchProjectKeywords, addProjectKeywords, deleteTrackedKeyword,
  checkProjectRankings, fetchKeywordHistory, fetchProjectReport,
} from '@/lib/dataforseo';
import {
  getGSCProperties, getGSCData, syncGSCProperty, getGSCQueries,
  type GSCProperty, type GSCOverviewData, type GSCQueryFilter, type GSCQuerySort, type GSCResultRow,
} from '@/lib/gsc';
import {
  fetchLocalProjects, createLocalProject, deleteLocalProject,
  fetchLocalKeywords, addLocalKeywords, checkLocalRankings, fetchLocalReport,
  fetchGBPProfile,
} from '@/lib/local-seo';
import { Input } from '@/components/ui/input';
import { RefreshCw, Link2, Sparkles, Activity, Search, ArrowLeft, MapPin, LayoutGrid, List } from 'lucide-react';
import GSCQueryTable from '@/components/rank-tracking/GSCQueryTable';

import type { Project, TrackedKeyword, HistoryEntry, ProjectReport } from '@/types/rank-tracking';
import type { LocalProject, LocalTrackedKeyword, LocalProjectReport, GBPProfile } from '@/types/local-seo';
import ProjectDetailHeader from '@/components/rank-tracking/ProjectDetailHeader';
import AddKeywordsDialog from '@/components/rank-tracking/AddKeywordsDialog';
import ProjectStatsCards from '@/components/rank-tracking/ProjectStatsCards';
import KeywordTable from '@/components/rank-tracking/KeywordTable';
import KeywordHistoryDialog from '@/components/rank-tracking/KeywordHistoryDialog';
import ProjectListView from '@/components/rank-tracking/ProjectListView';
import RankDistributionChart from '@/components/rank-tracking/RankDistributionChart';
import RankTrendChart from '@/components/rank-tracking/RankTrendChart';
import PeriodSelector from '@/components/rank-tracking/PeriodSelector';
import CompetitorComparison from '@/components/rank-tracking/CompetitorComparison';
import LocalProjectListView from '@/components/local-seo/LocalProjectListView';
import LocalStatsCards from '@/components/local-seo/LocalStatsCards';
import LocalRankTable from '@/components/local-seo/LocalRankTable';
import LocalRankGrid from '@/components/local-seo/LocalRankGrid';
import LocalAddKeywordsDialog from '@/components/local-seo/LocalAddKeywordsDialog';
import GBPProfileCard from '@/components/local-seo/GBPProfileCard';
import ReviewsSection from '@/components/local-seo/ReviewsSection';
import LocalCompetitorGrid from '@/components/local-seo/LocalCompetitorGrid';
import GeoGridPanel from '@/components/local-seo/GeoGridPanel';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function RankTracking() {
  const [activeTab, setActiveTab] = useState<'gsc' | 'tracked' | 'local'>('gsc');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [keywords, setKeywords] = useState<TrackedKeyword[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingKeywords, setLoadingKeywords] = useState(false);
  const [checking, setChecking] = useState(false);
  const [addKeywordsOpen, setAddKeywordsOpen] = useState(false);
  const [historyKeyword, setHistoryKeyword] = useState<TrackedKeyword | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [gscConnected, setGscConnected] = useState(false);
  const [gscProperties, setGscProperties] = useState<GSCProperty[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState('');
  const [loadingGSCProperties, setLoadingGSCProperties] = useState(true);
  const [loadingGSCOverview, setLoadingGSCOverview] = useState(false);
  const [syncingPropertyId, setSyncingPropertyId] = useState<string | null>(null);
  const [gscOverview, setGscOverview] = useState<GSCOverviewData | null>(null);
  const [selectedCard, setSelectedCard] = useState<GSCQueryFilter | null>(null);
  const [filteredRows, setFilteredRows] = useState<GSCResultRow[]>([]);
  const [filteredMode, setFilteredMode] = useState<'queries' | 'pages'>('queries');
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [filteredOffset, setFilteredOffset] = useState(0);
  const [loadingFiltered, setLoadingFiltered] = useState(false);
  const [querySearch, setQuerySearch] = useState('');
  const [querySort, setQuerySort] = useState<{ column: GSCQuerySort; order: 'asc' | 'desc' }>({ column: 'clicks', order: 'desc' });
  const [trackedGSCKeywords, setTrackedGSCKeywords] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<ProjectReport | null>(null);
  const [reportPeriod, setReportPeriod] = useState(30);
  const [loadingReport, setLoadingReport] = useState(false);
  // Local SEO state
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([]);
  const [loadingLocalProjects, setLoadingLocalProjects] = useState(true);
  const [selectedLocalProject, setSelectedLocalProject] = useState<LocalProject | null>(null);
  const [localKeywords, setLocalKeywords] = useState<LocalTrackedKeyword[]>([]);
  const [loadingLocalKeywords, setLoadingLocalKeywords] = useState(false);
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [localReport, setLocalReport] = useState<LocalProjectReport | null>(null);
  const [loadingLocalReport, setLoadingLocalReport] = useState(false);
  const [localReportPeriod, setLocalReportPeriod] = useState(30);
  const [localAddKeywordsOpen, setLocalAddKeywordsOpen] = useState(false);
  const [localViewMode, setLocalViewMode] = useState<'table' | 'grid'>('table');
  const [localCategory, setLocalCategory] = useState<string | null>(null);
  const [localCity, setLocalCity] = useState<string | null>(null);
  const [localGBPProfile, setLocalGBPProfile] = useState<GBPProfile | null>(null);
  const { toast } = useToast();

  const availableProperties = gscProperties.filter((property) => property.is_enabled !== 0);
  const selectableProperties = availableProperties.length > 0 ? availableProperties : gscProperties;

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const data = await fetchRankProjects() as Project[];
      setProjects(data);
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setLoadingProjects(false);
    }
  }, [toast]);

  const loadKeywords = useCallback(async (projectId: string) => {
    setLoadingKeywords(true);
    try {
      const data = await fetchProjectKeywords(projectId) as TrackedKeyword[];
      setKeywords(data);
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setLoadingKeywords(false);
    }
  }, [toast]);

  const loadGSCProperties = useCallback(async () => {
    setLoadingGSCProperties(true);
    try {
      const data = await getGSCProperties();
      const properties = data.properties || [];
      const enabledProperties = properties.filter((property) => property.is_enabled !== 0);
      const nextSelectableProperties = enabledProperties.length > 0 ? enabledProperties : properties;
      const nextPropertyId = nextSelectableProperties[0]?.id || '';

      setGscConnected(data.connected);
      setGscProperties(properties);
      setSelectedPropertyId((current) => {
        if (current && nextSelectableProperties.some((property) => property.id === current)) return current;
        return nextPropertyId;
      });
    } catch {
      setGscConnected(false);
      setGscProperties([]);
      setSelectedPropertyId('');
    } finally {
      setLoadingGSCProperties(false);
      setLoadingGSCOverview(false);
    }
  }, []);

  const loadGSCOverview = useCallback(async (propertyId: string) => {
    if (!propertyId) {
      setGscOverview(null);
      return;
    }

    setLoadingGSCOverview(true);
    try {
      const data = await getGSCData(propertyId);
      if (!data?.query_summary) {
        setGscOverview(null);
      } else {
        setGscOverview(data);
      }
    } catch {
      setGscOverview(null);
    } finally {
      setLoadingGSCOverview(false);
    }
  }, []);

  const loadFilteredQueries = useCallback(async (append = false) => {
    if (!selectedPropertyId || !selectedCard) return;
    setLoadingFiltered(true);
    try {
      const nextOffset = append ? filteredOffset + 100 : 0;
      const data = await getGSCQueries(
        selectedPropertyId,
        selectedCard,
        querySearch,
        querySort.column,
        querySort.order,
        100,
        nextOffset,
      );
      setFilteredRows(append ? (prev) => [...prev, ...data.rows] : data.rows);
      setFilteredMode(data.mode);
      setFilteredTotal(data.total);
      setFilteredOffset(nextOffset);
    } catch (err) {
      console.error('GSC queries fetch failed:', err);
    } finally {
      setLoadingFiltered(false);
    }
  }, [selectedPropertyId, selectedCard, querySearch, querySort, filteredOffset]);

  // Fetch filtered queries when card, search, or sort changes
  useEffect(() => {
    if (selectedCard) {
      loadFilteredQueries(false);
    }
  }, [selectedCard, querySearch, querySort, loadFilteredQueries]);

  // Reset filter state when property changes
  useEffect(() => {
    setSelectedCard(null);
    setFilteredRows([]);
    setQuerySearch('');
    setTrackedGSCKeywords(new Set());
  }, [selectedPropertyId]);

  const loadLocalProjects = useCallback(async () => {
    setLoadingLocalProjects(true);
    try {
      const data = await fetchLocalProjects();
      setLocalProjects(data);
    } catch {
      setLocalProjects([]);
    } finally {
      setLoadingLocalProjects(false);
    }
  }, []);

  const loadLocalKeywords = useCallback(async (projectId: string) => {
    setLoadingLocalKeywords(true);
    try {
      const data = await fetchLocalKeywords(projectId);
      setLocalKeywords(data);
    } catch {
      setLocalKeywords([]);
    } finally {
      setLoadingLocalKeywords(false);
    }
  }, []);

  const loadLocalReport = useCallback(async (projectId: string, period: number) => {
    setLoadingLocalReport(true);
    try {
      const data = await fetchLocalReport(projectId, period);
      setLocalReport(data);
    } catch {
      setLocalReport(null);
    } finally {
      setLoadingLocalReport(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    loadLocalProjects();
    loadGSCProperties();
  }, [loadProjects, loadLocalProjects, loadGSCProperties]);

  const loadReport = useCallback(async (projectId: string, period: number) => {
    setLoadingReport(true);
    try {
      const data = await fetchProjectReport(projectId, period) as ProjectReport;
      setReport(data);
    } catch {
      setReport(null);
    } finally {
      setLoadingReport(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadKeywords(selectedProject.id);
      loadReport(selectedProject.id, reportPeriod);
    }
  }, [selectedProject, loadKeywords, loadReport, reportPeriod]);

  useEffect(() => {
    if (selectedPropertyId) {
      loadGSCOverview(selectedPropertyId);
    } else {
      setGscOverview(null);
    }
  }, [selectedPropertyId, loadGSCOverview]);

  const handleCreateProject = async (name: string, domain: string, locationCode?: number) => {
    try {
      const project = await createRankProject({ name, domain, location_code: locationCode }) as Project;
      setProjects((prev) => [project, ...prev]);
      toast({ title: 'Project created', description: `Tracking ${project.domain}` });
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteRankProject(projectId);
      setProjects((prev) => prev.filter((project) => project.id !== projectId));
      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
        setKeywords([]);
      }
      toast({ title: 'Project deleted' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleAddKeywords = async (keywordList: string[], locationCode: number, languageCode: string) => {
    if (!selectedProject) return;
    try {
      const result = await addProjectKeywords(selectedProject.id, {
        keywords: keywordList,
        location_code: locationCode,
        language_code: languageCode,
      }) as { added: number; skipped: number };

      toast({ title: 'Keywords added', description: `Added ${result.added}, skipped ${result.skipped} duplicates` });
      setAddKeywordsOpen(false);
      loadKeywords(selectedProject.id);
      loadProjects();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleDeleteKeyword = async (keywordId: string) => {
    try {
      await deleteTrackedKeyword(keywordId);
      setKeywords((prev) => prev.filter((keyword) => keyword.id !== keywordId));
      toast({ title: 'Keyword removed' });
      if (selectedProject) loadProjects();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleCheckRankings = async () => {
    if (!selectedProject) return;
    setChecking(true);
    try {
      const result = await checkProjectRankings(selectedProject.id) as { checked: number; found: number; not_ranking: number };
      toast({
        title: 'Rankings checked',
        description: `${result.found} found in Google, ${result.not_ranking} not found in the top results`,
      });
      loadKeywords(selectedProject.id);
      loadReport(selectedProject.id, reportPeriod);
    } catch (err: unknown) {
      toast({ title: 'Error checking rankings', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setChecking(false);
    }
  };

  const handleViewHistory = async (keyword: TrackedKeyword) => {
    setHistoryKeyword(keyword);
    setLoadingHistory(true);
    try {
      const data = await fetchKeywordHistory(keyword.id) as { keyword: { id: string; keyword: string }; history: HistoryEntry[] };
      setHistory(data.history);
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleSyncProperty = async () => {
    if (!selectedPropertyId) return;

    setSyncingPropertyId(selectedPropertyId);
    try {
      const result = await syncGSCProperty(selectedPropertyId);
      toast({ title: 'GSC sync complete', description: `Synced ${result.rows_synced} rows from ${result.property}` });
      await loadGSCProperties();
      await loadGSCOverview(selectedPropertyId);
    } catch (err: unknown) {
      toast({
        title: 'Sync failed',
        description: getErrorMessage(err),
        variant: 'destructive',
      });
    } finally {
      setSyncingPropertyId(null);
    }
  };

  useEffect(() => {
    if (selectedLocalProject) {
      loadLocalKeywords(selectedLocalProject.id);
      loadLocalReport(selectedLocalProject.id, localReportPeriod);
    } else {
      setLocalCategory(null);
      setLocalCity(null);
      setLocalGBPProfile(null);
    }
  }, [selectedLocalProject, loadLocalKeywords, loadLocalReport, localReportPeriod]);

  // Fetch GBP profile using project's location_code
  useEffect(() => {
    if (!selectedLocalProject) return;
    const placeId = selectedLocalProject.place_id;
    const businessName = selectedLocalProject.business_name;
    if (!placeId && !businessName) return;

    const locCode = selectedLocalProject.location_code || localKeywords[0]?.location_code;
    fetchGBPProfile({
      place_id: placeId || undefined,
      business_name: businessName || undefined,
      location_code: locCode || undefined,
    })
      .then((profile) => {
        setLocalGBPProfile(profile);
        setLocalCategory(profile.category || null);
        if (profile.address) {
          const parts = profile.address.split(',').map(s => s.trim());
          if (parts.length >= 2) {
            const cityPart = parts[1].replace(/\s+[A-Z]{2}\s+\S+/g, '').trim();
            setLocalCity(cityPart || parts[1]);
          }
        }
      })
      .catch(() => {
        setLocalGBPProfile(null);
        setLocalCategory(null);
        setLocalCity(null);
      });
  }, [selectedLocalProject, localKeywords]);

  const handleCreateLocalProject = async (params: {
    name: string;
    business_name: string;
    place_id?: string;
    cid?: string;
    domain?: string;
    location_code?: number;
  }) => {
    try {
      const project = await createLocalProject(params);
      setLocalProjects((prev) => [project, ...prev]);
      toast({ title: 'Local project created', description: `Tracking ${params.business_name}` });
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleDeleteLocalProject = async (projectId: string) => {
    try {
      await deleteLocalProject(projectId);
      setLocalProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (selectedLocalProject?.id === projectId) {
        setSelectedLocalProject(null);
        setLocalKeywords([]);
      }
      toast({ title: 'Local project deleted' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleAddLocalKeywords = async (keywordList: string[], locationCode: number, languageCode: string) => {
    if (!selectedLocalProject) return;
    try {
      const result = await addLocalKeywords(selectedLocalProject.id, {
        keywords: keywordList,
        location_code: locationCode,
        language_code: languageCode,
      });
      toast({ title: 'Keywords added', description: `Added ${result.added}, skipped ${result.skipped} duplicates` });
      setLocalAddKeywordsOpen(false);
      loadLocalKeywords(selectedLocalProject.id);
      loadLocalProjects();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleDeleteLocalKeyword = async (keywordId: string) => {
    try {
      await deleteTrackedKeyword(keywordId);
      setLocalKeywords((prev) => prev.filter((kw) => kw.id !== keywordId));
      toast({ title: 'Keyword removed' });
      if (selectedLocalProject) loadLocalProjects();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const handleCheckLocalRankings = async () => {
    if (!selectedLocalProject) return;
    setCheckingLocal(true);
    try {
      const result = await checkLocalRankings(selectedLocalProject.id);
      toast({
        title: 'Local rankings checked',
        description: `${result.found} found in local pack, ${result.not_in_pack} not found`,
      });
      loadLocalKeywords(selectedLocalProject.id);
      loadLocalReport(selectedLocalProject.id, localReportPeriod);
    } catch (err: unknown) {
      toast({ title: 'Error checking rankings', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setCheckingLocal(false);
    }
  };

  const handleTrackKeywordFromGSC = async (keyword: string, projectId: string, position?: number) => {
    try {
      const targetProject = projects.find((project) => project.id === projectId);
      const result = await addProjectKeywords(projectId, {
        keywords: [keyword],
        location_code: targetProject?.location_code || undefined,
        initial_positions: position != null ? { [keyword]: Math.round(position) } : undefined,
      }) as { added: number; skipped: number };

      toast({
        title: result.added > 0 ? 'Keyword added' : 'Already tracked',
        description: result.added > 0
          ? `Added "${keyword}" to ${targetProject?.name || 'your project'}.`
          : `"${keyword}" is already in ${targetProject?.name || 'that project'}.`,
      });
      setTrackedGSCKeywords(prev => new Set(prev).add(keyword));
      loadProjects();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const sortedTopQueries = useMemo(() => {
    if (!gscOverview?.top_queries) return [];
    const rows = gscOverview.top_queries.map(q => ({
      query: q.query,
      clicks: q.clicks,
      impressions: q.impressions,
      avg_position: q.avg_position,
      avg_ctr: q.avg_ctr,
    }));
    const { column, order } = querySort;
    rows.sort((a, b) => {
      const aVal = a[column as keyof typeof a] ?? 0;
      const bVal = b[column as keyof typeof b] ?? 0;
      return order === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return rows;
  }, [gscOverview?.top_queries, querySort]);

  // Local project detail view
  if (selectedLocalProject) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => { setSelectedLocalProject(null); setLocalKeywords([]); loadLocalProjects(); }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-xl font-semibold">{selectedLocalProject.name}</h2>
              {selectedLocalProject.business_name && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {selectedLocalProject.business_name}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setLocalAddKeywordsOpen(true)}>
              Add Keywords
            </Button>
            <Button onClick={handleCheckLocalRankings} disabled={checkingLocal}>
              <RefreshCw className={`h-4 w-4 mr-2 ${checkingLocal ? 'animate-spin' : ''}`} />
              {checkingLocal ? 'Checking...' : 'Check Local Rankings'}
            </Button>
          </div>
        </div>

        <LocalAddKeywordsDialog
          open={localAddKeywordsOpen}
          onOpenChange={setLocalAddKeywordsOpen}
          onAdd={handleAddLocalKeywords}
          category={localCategory}
          city={localCity}
          gbpProfile={localGBPProfile}
        />

        <PeriodSelector value={localReportPeriod} onChange={setLocalReportPeriod} />

        <LocalStatsCards report={localReport} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">Local Pack Keywords</CardTitle>
                <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                  <Button
                    variant={localViewMode === 'table' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setLocalViewMode('table')}
                  >
                    <List className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant={localViewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setLocalViewMode('grid')}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className={localViewMode === 'table' ? 'p-0' : 'pt-0'}>
                {localViewMode === 'table' ? (
                  <LocalRankTable
                    keywords={localKeywords}
                    loading={loadingLocalKeywords}
                    onDelete={handleDeleteLocalKeyword}
                    onAddKeywords={() => setLocalAddKeywordsOpen(true)}
                  />
                ) : (
                  <LocalRankGrid
                    keywords={localKeywords}
                    loading={loadingLocalKeywords}
                    onAddKeywords={() => setLocalAddKeywordsOpen(true)}
                  />
                )}
              </CardContent>
            </Card>
          </div>
          <GBPProfileCard placeId={selectedLocalProject.place_id} businessName={selectedLocalProject.business_name} locationCode={selectedLocalProject.location_code || localKeywords[0]?.location_code} />
        </div>

        <GeoGridPanel
          projectId={selectedLocalProject.id}
          businessName={selectedLocalProject.business_name}
          keywords={localKeywords}
        />

        <ReviewsSection placeId={selectedLocalProject.place_id} cid={selectedLocalProject.cid} businessName={selectedLocalProject.business_name} />

        <LocalCompetitorGrid
          locationCode={localKeywords[0]?.location_code}
          businessPlaceId={selectedLocalProject.place_id}
        />
      </div>
    );
  }

  if (selectedProject) {
    return (
      <div className="space-y-6">
        <ProjectDetailHeader
          project={selectedProject}
          checking={checking}
          keywordCount={keywords.length}
          onBack={() => { setSelectedProject(null); setKeywords([]); loadProjects(); }}
          onAddKeywords={() => setAddKeywordsOpen(true)}
          onCheckRankings={handleCheckRankings}
        />

        <AddKeywordsDialog
          open={addKeywordsOpen}
          onOpenChange={setAddKeywordsOpen}
          onAdd={handleAddKeywords}
        />

        <PeriodSelector value={reportPeriod} onChange={setReportPeriod} />

        <ProjectStatsCards report={report} />

        {report && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RankDistributionChart
              distribution={report.current.distribution}
              rankingCount={report.current.ranking_keywords}
            />
            <RankTrendChart trend={report.trend} />
          </div>
        )}

        <KeywordTable
          keywords={keywords}
          loading={loadingKeywords}
          onViewHistory={handleViewHistory}
          onDelete={handleDeleteKeyword}
          onAddKeywords={() => setAddKeywordsOpen(true)}
        />

        <KeywordHistoryDialog
          keyword={historyKeyword}
          history={history}
          loading={loadingHistory}
          onClose={() => setHistoryKeyword(null)}
        />

        <CompetitorComparison domain={selectedProject.domain} />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-headline font-extrabold tracking-tight">Rank Tracking</h1>
        <p className="text-xs text-muted-foreground mt-1 uppercase tracking-widest font-semibold">
          GSC visibility and exact SERP monitoring
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'gsc' | 'tracked' | 'local')} className="w-full">
        <TabsList>
          <TabsTrigger value="gsc">Site Rankings (GSC)</TabsTrigger>
          <TabsTrigger value="tracked">Tracked Keywords</TabsTrigger>
          <TabsTrigger value="local">Local Pack</TabsTrigger>
        </TabsList>

        <TabsContent value="gsc" className="mt-8 space-y-8">
          <div className="flex items-start gap-3 bg-secondary rounded-xl px-5 py-4">
            <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              GSC tells you how the whole site is performing across real queries. Tracked keywords let you monitor exact positions for the terms you choose.
            </p>
          </div>

          {loadingGSCProperties ? (
            <div className="flex justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !gscConnected ? (
            <Card>
              <CardHeader>
                <CardTitle>Connect Google Search Console</CardTitle>
                <CardDescription>Site-wide ranking metrics depend on synced GSC data.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Once connected and synced, this tab will show how many queries your site ranks for, average position, and page-one opportunities.
                </p>
                <Button asChild>
                  <Link to="/settings">
                    <Link2 className="h-4 w-4 mr-2" />
                    Open Settings
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="bg-white rounded-xl p-6 shadow-[0_1px_4px_rgba(24,28,32,0.06)]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_auto] lg:items-end">
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Property</Label>
                        <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select property" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectableProperties.map((property) => (
                              <SelectItem key={property.id} value={property.id}>
                                {property.site_url.replace(/^(sc-domain:|https?:\/\/)/, '')}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleSyncProperty} disabled={!selectedPropertyId || syncingPropertyId === selectedPropertyId}>
                        <RefreshCw className={`h-4 w-4 mr-2 ${syncingPropertyId === selectedPropertyId ? 'animate-spin' : ''}`} />
                        {syncingPropertyId === selectedPropertyId ? 'Syncing...' : 'Sync GSC Data'}
                      </Button>
                    </div>
                  </div>
              </div>

              {loadingGSCOverview ? (
                <div className="flex justify-center py-12">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : !gscOverview ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground">
                      No synced GSC ranking data is available yet for this property. Run a sync to populate the overview.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Hero Metrics Row */}
                  <section className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    {([
                      { key: 'all' as const, title: 'Total Keywords', value: gscOverview.query_summary.total_queries.toLocaleString(), accent: false },
                      { key: null, title: 'Avg. Position', value: String(gscOverview.query_summary.avg_position ?? '--'), accent: false },
                      { key: 'top10' as const, title: 'Organic Clicks', value: `${((gscOverview.summary.last_30_days.total_clicks || 0) / 1000).toFixed(1)}k`, accent: false },
                      { key: 'page2' as const, title: 'Visibility Score', value: gscOverview.query_summary.striking_distance.toLocaleString(), accent: true },
                    ]).map((card) => {
                      const isClickable = card.key !== null;
                      const isActive = selectedCard === card.key && isClickable;
                      return (
                        <div
                          key={card.title}
                          className={[
                            'bg-white p-6 rounded-xl space-y-2 transition-all',
                            isActive ? 'border-l-4 border-l-primary shadow-md' : 'shadow-[0_1px_4px_rgba(24,28,32,0.06)]',
                            isClickable ? 'cursor-pointer hover:shadow-md' : '',
                          ].join(' ')}
                          onClick={() => {
                            if (!isClickable) return;
                            setSelectedCard((prev) => prev === card.key ? null : card.key);
                            setFilteredOffset(0);
                            setFilteredRows([]);
                          }}
                        >
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{card.title}</p>
                          <div className="flex items-baseline gap-2">
                            <h2 className={`text-4xl font-headline font-extrabold tracking-tight ${card.accent ? 'text-primary' : ''}`}>{card.value}</h2>
                          </div>
                        </div>
                      );
                    })}
                  </section>

                  {/* Distribution + Opportunity Row */}
                  <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Distribution Widget */}
                    <div className="bg-white p-6 rounded-xl shadow-[0_1px_4px_rgba(24,28,32,0.06)]">
                      <h3 className="font-headline font-bold text-sm mb-4 uppercase tracking-widest text-muted-foreground">Distribution</h3>
                      <div className="space-y-4">
                        {[
                          { label: 'Top 3', count: gscOverview.query_summary.top_3, pct: Math.round((gscOverview.query_summary.top_3 / Math.max(gscOverview.query_summary.total_queries, 1)) * 100), variant: 'bg-primary' },
                          { label: 'Top 10', count: gscOverview.query_summary.top_10, pct: Math.round((gscOverview.query_summary.top_10 / Math.max(gscOverview.query_summary.total_queries, 1)) * 100), variant: 'bg-primary/60' },
                          { label: 'Top 100', count: gscOverview.query_summary.total_queries, pct: 100, variant: 'bg-muted-foreground/30' },
                        ].map((tier) => (
                          <div key={tier.label} className="space-y-1.5">
                            <div className="flex justify-between text-xs font-bold">
                              <span>{tier.label}</span>
                              <span>{tier.count.toLocaleString()}</span>
                            </div>
                            <div className="w-full bg-muted h-2 rounded-full overflow-hidden">
                              <div className={`${tier.variant} h-full rounded-full transition-all`} style={{ width: `${tier.pct}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Growth Opportunity Card */}
                    {gscOverview.opportunities.length > 0 && (
                      <div className="bg-primary text-white p-6 rounded-xl shadow-lg shadow-primary/20 relative overflow-hidden">
                        <div className="relative z-10">
                          <h3 className="font-headline font-bold text-lg mb-2">Growth Opportunity</h3>
                          <p className="text-sm opacity-80 mb-6">
                            You have {gscOverview.query_summary.striking_distance} queries on page 2. Optimizing these could significantly increase organic traffic.
                          </p>
                          <button
                            className="w-full py-3 bg-white text-primary font-bold rounded-lg text-sm hover:bg-opacity-90 transition-all"
                            onClick={() => {
                              setSelectedCard((prev) => prev === 'page2' ? null : 'page2');
                              setFilteredOffset(0);
                              setFilteredRows([]);
                            }}
                          >
                            View Opportunities
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Quick Stats */}
                    <div className="bg-white p-6 rounded-xl shadow-[0_1px_4px_rgba(24,28,32,0.06)] space-y-4">
                      <h3 className="font-headline font-bold text-sm uppercase tracking-widest text-muted-foreground">30-Day Summary</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between items-baseline">
                          <span className="text-sm text-muted-foreground">Total Clicks</span>
                          <span className="font-headline font-extrabold text-lg">{(gscOverview.summary.last_30_days.total_clicks || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-sm text-muted-foreground">Total Impressions</span>
                          <span className="font-headline font-extrabold text-lg">{(gscOverview.summary.last_30_days.total_impressions || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-baseline">
                          <span className="text-sm text-muted-foreground">Avg. Position</span>
                          <span className="font-headline font-extrabold text-lg">{gscOverview.summary.last_30_days.avg_position ?? '--'}</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Keyword Movement Table */}
                  <section className="bg-white rounded-xl shadow-[0_1px_4px_rgba(24,28,32,0.06)] overflow-hidden">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-8 py-5 bg-secondary/50">
                      <h3 className="font-headline font-extrabold text-xl">
                        {selectedCard === 'all' && 'All Ranking Queries'}
                        {selectedCard === 'top10' && 'Top 10 Queries by Traffic'}
                        {selectedCard === 'page2' && 'Page 2 Opportunities'}
                        {selectedCard === 'opportunities' && 'Striking Distance'}
                        {!selectedCard && 'Keyword Movement'}
                      </h3>
                      <div className="flex items-center gap-3">
                        {selectedCard && selectedCard !== 'top10' && (
                          <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
                            <Input
                              placeholder={selectedCard === 'page2' ? 'Search pages...' : 'Filter keywords...'}
                              className="pl-9 h-8 text-xs bg-white border border-border/50 rounded-lg focus-visible:ring-primary"
                              value={querySearch}
                              onChange={(e) => {
                                setQuerySearch(e.target.value);
                                setFilteredOffset(0);
                                setFilteredRows([]);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div>
                      {selectedCard ? (
                        <GSCQueryTable
                          rows={filteredRows}
                          mode={filteredMode}
                          loading={loadingFiltered}
                          sort={querySort}
                          onSort={(col) => {
                            setQuerySort((prev) => ({
                              column: col,
                              order: prev.column === col && prev.order === 'desc' ? 'asc' : 'desc',
                            }));
                            setFilteredOffset(0);
                            setFilteredRows([]);
                          }}
                          onTrack={handleTrackKeywordFromGSC}
                          projects={projects}
                          total={filteredTotal}
                          offset={filteredOffset}
                          limit={100}
                          onLoadMore={() => loadFilteredQueries(true)}
                          trackedKeywords={trackedGSCKeywords}
                        />
                      ) : (
                        <GSCQueryTable
                          rows={sortedTopQueries}
                          mode="queries"
                          loading={false}
                          sort={querySort}
                          onSort={(col) => {
                            setQuerySort((prev) => ({
                              column: col,
                              order: prev.column === col && prev.order === 'desc' ? 'asc' : 'desc',
                            }));
                          }}
                          onTrack={handleTrackKeywordFromGSC}
                          projects={projects}
                          total={sortedTopQueries.length}
                          offset={0}
                          limit={sortedTopQueries.length}
                          onLoadMore={() => {}}
                          trackedKeywords={trackedGSCKeywords}
                        />
                      )}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="tracked" className="mt-6 space-y-6">
          <ProjectListView
            projects={projects}
            loading={loadingProjects}
            onSelect={setSelectedProject}
            onDelete={handleDeleteProject}
            onCreate={handleCreateProject}
          />
        </TabsContent>

        <TabsContent value="local" className="mt-6 space-y-6">
          <LocalProjectListView
            projects={localProjects}
            loading={loadingLocalProjects}
            onSelect={setSelectedLocalProject}
            onDelete={handleDeleteLocalProject}
            onCreate={handleCreateLocalProject}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
