import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { KanbanSquare, Sparkles } from 'lucide-react';
import {
  listPlannerKeywords,
  updatePlannerKeyword,
  deletePlannerKeyword,
  listClusters,
  createCluster,
  updateCluster,
  deleteCluster,
  setClusterPillar,
  INTENT_LABELS,
  INTENT_ORDER,
  STATUS_LABELS,
  STATUS_ORDER,
  PAGE_TYPE_BY_INTENT,
  CLUSTER_COLORS,
  type PlannerKeyword,
  type PlannerStatus,
  type PlannerIntent,
  type PlannerCluster,
  type ContentBrief,
} from '@/lib/planner';
import { FileText, Target, Users, Megaphone, ListChecks, Tag, Plus, X as XIcon, Star, Network } from 'lucide-react';
import { PlannerKanban } from '@/components/planner/PlannerKanban';
import { PlannerFilters, type PlannerFiltersState } from '@/components/planner/PlannerFilters';
import { ClusterView } from '@/components/planner/ClusterView';
import { BulkActionBar } from '@/components/planner/BulkActionBar';
import { AssignToPageDialog } from '@/components/planner/AssignToPageDialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useProperty } from '@/contexts/PropertyContext';
import { AddWebsiteDialog } from '@/components/AddWebsiteDialog';
import { importPlannerKeywordToWriter } from '@/lib/content-writer';
import { OutputLanguageSelect } from '@/components/OutputLanguageSelect';
import { getOutputLanguagePreference, type OutputLanguageCode } from '@/lib/output-language';
import { DialogFooter } from '@/components/ui/dialog';

const DEMO_PREFIX = 'demo-';
const DEMO_CLUSTER_PREFIX = 'demo-cluster-';
const isDemoId = (id: string) => id.startsWith(DEMO_PREFIX);
const genDemoId = (prefix = DEMO_PREFIX) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
const VIEW_KEY = 'planner-view';
const buildMockData = (): { keywords: PlannerKeyword[]; clusters: PlannerCluster[] } => {
  const now = new Date().toISOString();
  const localSeoClusterId = `${DEMO_CLUSTER_PREFIX}local-seo`;
  const geoClusterId = `${DEMO_CLUSTER_PREFIX}geo`;

  const clusters: PlannerCluster[] = [
    {
      id: localSeoClusterId,
      name: 'Local SEO',
      description: null,
      color: '#10b981',
      created_at: now,
      updated_at: now,
      keyword_count: 0,
    },
    {
      id: geoClusterId,
      name: 'AI Search & GEO',
      description: null,
      color: '#8b5cf6',
      created_at: now,
      updated_at: now,
      keyword_count: 0,
    },
  ];

  const base = (overrides: Partial<PlannerKeyword>): PlannerKeyword => ({
    id: `${DEMO_PREFIX}${Math.random().toString(36).slice(2, 10)}`,
    keyword: '',
    intent: 'informational',
    status: 'backlog',
    assigned_url: null,
    notes: null,
    search_volume: null,
    keyword_difficulty: null,
    cpc: null,
    competition: null,
    source: null,
    source_context: null,
    content_brief: null,
    cluster_id: null,
    is_pillar: false,
    position: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  });
  const keywords: PlannerKeyword[] = [
    // Backlog
    base({ keyword: 'best seo tools for small business', intent: 'commercial', status: 'backlog',
      search_volume: 8100, keyword_difficulty: 42, cpc: 6.2, source: 'keyword-ideas' }),
    base({ keyword: 'how to do keyword research', intent: 'informational', status: 'backlog',
      search_volume: 12100, keyword_difficulty: 55, source: 'keyword-suggestions' }),
    base({ keyword: 'seo audit tool free', intent: 'transactional', status: 'backlog',
      search_volume: 4400, keyword_difficulty: 38, cpc: 4.1, source: 'ranked-keywords' }),
    base({ keyword: 'what is keyword intent', intent: 'informational', status: 'backlog',
      search_volume: 720, keyword_difficulty: 21, source: 'related-keywords' }),
    base({ keyword: 'ahrefs vs semrush vs datawise', intent: 'commercial', status: 'backlog',
      search_volume: 590, keyword_difficulty: 35, source: 'gap-analysis:opportunities' }),
    // Local SEO cluster
    base({ keyword: 'local seo checklist 2026', intent: 'informational', status: 'assigned',
      search_volume: 2400, keyword_difficulty: 33,
      source: 'keyword-ideas',
      cluster_id: localSeoClusterId, is_pillar: true,
      source_context: { seed_keyword: 'local seo' },
      content_brief: {
        title: 'The 2026 Local SEO Checklist: 17 Steps That Actually Move Rankings',
        additional_keywords: ['local seo audit', 'gbp optimization', 'citation building', 'local pack ranking'],
        outline: '1. TL;DR + checklist\n2. GBP completeness\n3. NAP consistency\n4. On-page local signals\n5. Review velocity\n6. Local backlinks',
        meta_description: 'A step-by-step local SEO checklist updated for 2026 — covers GBP, NAP, reviews, and local link building with examples.',
        target_audience: 'Solo local business owners and in-house SEOs at multi-location SMBs',
        cta: 'Free local audit → book a 15-min call',
      } }),
    base({ keyword: 'google business profile optimization', intent: 'commercial', status: 'published',
      search_volume: 3600, keyword_difficulty: 40,
      source: 'ranked-keywords',
      cluster_id: localSeoClusterId,
      source_context: { seed_keyword: 'local seo' } }),
    base({ keyword: 'local citation building guide', intent: 'informational', status: 'backlog',
      search_volume: 1100, keyword_difficulty: 28,
      source: 'keyword-suggestions',
      cluster_id: localSeoClusterId,
      source_context: { seed_keyword: 'local seo' } }),
    base({ keyword: 'local schema markup examples', intent: 'informational', status: 'draft',
      search_volume: 480, keyword_difficulty: 19,
      source: 'keyword-ideas',
      cluster_id: localSeoClusterId,
      source_context: { seed_keyword: 'local seo' } }),
    // AI Search & GEO cluster
    base({ keyword: 'how to rank in ai overviews', intent: 'informational', status: 'indexed',
      search_volume: 1300, keyword_difficulty: 52,
      notes: 'Targeting AI Mode + ChatGPT Search', source: 'keyword-suggestions',
      cluster_id: geoClusterId, is_pillar: true,
      source_context: { seed_keyword: 'ai search' } }),
    base({ keyword: 'ai search optimization', intent: 'informational', status: 'assigned',
      search_volume: 1800, keyword_difficulty: 48,
      notes: 'Include fan-out variants + GEO answer capsules', source: 'keyword-suggestions',
      cluster_id: geoClusterId,
      source_context: { seed_keyword: 'ai search' } }),
    base({ keyword: 'fan out queries examples', intent: 'fan_out', status: 'draft',
      search_volume: 390, keyword_difficulty: 18,
      source: 'keyword-ideas',
      cluster_id: geoClusterId,
      source_context: { seed_keyword: 'ai search' } }),
    // Unclustered
    base({ keyword: 'datawise seo pricing', intent: 'transactional', status: 'draft',
      search_volume: 210, keyword_difficulty: 12,
      notes: 'Pillar: pricing page + FAQ schema', source: 'keyword-overview' }),
    base({ keyword: 'seo analytics platform', intent: 'transactional', status: 'ranking',
      search_volume: 880, keyword_difficulty: 44, cpc: 7.8,
      source: 'ranked-keywords' }),
    base({ keyword: 'geo content strategy', intent: 'navigational', status: 'ranking',
      search_volume: 260, keyword_difficulty: 19,
      source: 'related-keywords' }),
  ];

  // Populate keyword_count on clusters
  clusters.forEach((c) => {
    c.keyword_count = keywords.filter((k) => k.cluster_id === c.id).length;
  });

  return { keywords, clusters };
};

export default function ContentPlanner() {
  const queryClient = useQueryClient();
  const { selectedPropertyId, selectedProperty, loading: propertyLoading } = useProperty();
  const [addWebsiteOpen, setAddWebsiteOpen] = useState(false);
  const kwKey = ['planner-keywords', selectedPropertyId] as const;
  const clusterKey = ['planner-clusters', selectedPropertyId] as const;

  const { data: items = [], isLoading } = useQuery({
    queryKey: kwKey,
    queryFn: () => listPlannerKeywords(selectedPropertyId),
    enabled: Boolean(selectedPropertyId),
    retry: false,
  });
  const { data: clusters = [] } = useQuery({
    queryKey: clusterKey,
    queryFn: () => listClusters(selectedPropertyId),
    enabled: Boolean(selectedPropertyId),
    retry: false,
  });

  const [view, setView] = useState<'kanban' | 'clusters'>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
    return saved === 'clusters' ? 'clusters' : 'kanban';
  });
  const setViewPersisted = (v: 'kanban' | 'clusters') => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch {}
  };

  const loadDemoData = () => {
    const { keywords, clusters: demoClusters } = buildMockData();
    queryClient.setQueryData<PlannerKeyword[]>(kwKey, keywords);
    queryClient.setQueryData<PlannerCluster[]>(clusterKey, demoClusters);
    toast.success('Demo data loaded — drag, edit, and delete freely. Reload to clear.');
  };

  const [filters, setFilters] = useState<PlannerFiltersState>({
    search: '',
    intents: new Set(),
    sources: new Set(),
  });
  const [editing, setEditing] = useState<PlannerKeyword | null>(null);

  // Pending Backlog→Draft import. When the user drags a card into the Draft
  // column we stage the keyword here and open a small dialog so they can
  // pick the output language for the new Content Writer post. Confirming
  // creates the writer post in the chosen language; cancelling leaves the
  // planner status change in place but creates no writer post.
  const [pendingImport, setPendingImport] = useState<{
    keyword: string;
    topic: string;
    notes?: string;
  } | null>(null);
  const [importLanguage, setImportLanguage] = useState<OutputLanguageCode>(() => getOutputLanguagePreference());

  // Multi-select state for bulk actions. IDs only; rendering filters them out
  // naturally if a keyword is removed or no longer matches active filters.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // Distinct URLs already in use, for the assign dialog's autocomplete.
  const knownUrls = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.assigned_url && set.add(i.assigned_url));
    return Array.from(set).sort();
  }, [items]);

  // Bulk patch a set of keywords with the same partial update.
  // Single optimistic write to the cache, fan-out HTTP PATCHes in parallel,
  // then one invalidation at the end. Avoids the cancel/invalidate thrash
  // that would happen if we fanned out N copies of `updateMutation.mutate`.
  const bulkPatch = async (
    ids: string[],
    patch: Parameters<typeof updatePlannerKeyword>[1],
  ): Promise<{ ok: number; failed: number }> => {
    if (ids.length === 0) return { ok: 0, failed: 0 };
    const idSet = new Set(ids);
    const prev = queryClient.getQueryData<PlannerKeyword[]>(kwKey);
    queryClient.setQueryData<PlannerKeyword[]>(kwKey, (old = []) =>
      old.map((k) => (idSet.has(k.id) ? ({ ...k, ...patch } as PlannerKeyword) : k)),
    );

    const results = await Promise.allSettled(
      ids.map((id) => (isDemoId(id) ? Promise.resolve() : updatePlannerKeyword(id, patch))),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    const ok = results.length - failed;

    if (failed > 0 && prev) {
      queryClient.setQueryData(kwKey, prev);
      toast.error(`${failed} of ${ids.length} updates failed — reverted`);
    } else if (ids.some((id) => !isDemoId(id))) {
      queryClient.invalidateQueries({ queryKey: kwKey });
    }
    return { ok, failed };
  };

  const bulkAssignUrl = async (url: string | null) => {
    const ids = Array.from(selectedIds);
    const { ok, failed } = await bulkPatch(ids, { assigned_url: url });
    if (failed === 0 && ok > 0) {
      toast.success(
        url
          ? `Assigned ${ok} keyword${ok === 1 ? '' : 's'} to ${url}`
          : `Cleared assignment on ${ok} keyword${ok === 1 ? '' : 's'}`,
      );
    }
    clearSelection();
  };

  const bulkSetStatus = async (status: PlannerStatus) => {
    const ids = Array.from(selectedIds);
    const { ok, failed } = await bulkPatch(ids, { status });
    if (failed === 0 && ok > 0) {
      toast.success(`Moved ${ok} keyword${ok === 1 ? '' : 's'} to ${STATUS_LABELS[status]}`);
    }
    clearSelection();
  };

  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );

  const availableSources = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.source && set.add(i.source));
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return items.filter((item) => {
      if (q && !item.keyword.toLowerCase().includes(q)) return false;
      if (filters.intents.size > 0 && !filters.intents.has(item.intent)) return false;
      if (filters.sources.size > 0 && (!item.source || !filters.sources.has(item.source))) return false;
      return true;
    });
  }, [items, filters]);

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updatePlannerKeyword>[1] }) =>
      isDemoId(id) ? Promise.resolve({ success: true as const }) : updatePlannerKeyword(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: kwKey });
      const prev = queryClient.getQueryData<PlannerKeyword[]>(kwKey);
      queryClient.setQueryData<PlannerKeyword[]>(kwKey, (old = []) =>
        old.map((item) => (item.id === id ? { ...item, ...patch } as PlannerKeyword : item))
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(kwKey, ctx.prev);
      toast.error('Failed to update keyword');
    },
    onSettled: (_data, _err, vars) => {
      if (!isDemoId(vars.id)) {
        queryClient.invalidateQueries({ queryKey: kwKey });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      isDemoId(id) ? Promise.resolve({ success: true as const }) : deletePlannerKeyword(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: kwKey });
      const prev = queryClient.getQueryData<PlannerKeyword[]>(kwKey);
      queryClient.setQueryData<PlannerKeyword[]>(kwKey, (old = []) =>
        old.filter((item) => item.id !== id)
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(kwKey, ctx.prev);
      toast.error('Failed to delete keyword');
    },
    onSuccess: () => {
      toast.success('Keyword removed');
    },
  });

  // Cluster helpers (demo-aware, optimistic)
  const assignKeywordToCluster = (keywordId: string, clusterId: string | null) => {
    updateMutation.mutate({
      id: keywordId,
      patch: { cluster_id: clusterId, ...(clusterId == null ? { is_pillar: false } : {}) },
    });
  };

  const createClusterHandler = async (input: { name: string; color: string }, assignKeywordIds: string[] = []) => {
    const isDemoMode = (items[0]?.id && isDemoId(items[0].id)) || clusters.some((c) => c.id.startsWith(DEMO_CLUSTER_PREFIX));
    let newCluster: PlannerCluster;
    if (isDemoMode) {
      newCluster = {
        id: genDemoId(DEMO_CLUSTER_PREFIX),
        name: input.name,
        description: null,
        color: input.color,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        keyword_count: assignKeywordIds.length,
      };
      queryClient.setQueryData<PlannerCluster[]>(clusterKey, (old = []) => [newCluster, ...old]);
    } else {
      try {
        newCluster = await createCluster(selectedPropertyId, { name: input.name, color: input.color });
        queryClient.setQueryData<PlannerCluster[]>(clusterKey, (old = []) => [newCluster, ...old]);
      } catch {
        toast.error('Failed to create cluster');
        return;
      }
    }
    // Assign provided keywords
    assignKeywordIds.forEach((kid) => assignKeywordToCluster(kid, newCluster.id));
    toast.success(`Cluster "${input.name}" created`);
  };

  const renameClusterHandler = (id: string, name: string) => {
    queryClient.setQueryData<PlannerCluster[]>(clusterKey, (old = []) =>
      old.map((c) => (c.id === id ? { ...c, name } : c))
    );
    if (!id.startsWith(DEMO_CLUSTER_PREFIX)) {
      updateCluster(id, { name }).catch(() => toast.error('Failed to rename cluster'));
    }
  };

  const recolorClusterHandler = (id: string, color: string) => {
    queryClient.setQueryData<PlannerCluster[]>(clusterKey, (old = []) =>
      old.map((c) => (c.id === id ? { ...c, color } : c))
    );
    if (!id.startsWith(DEMO_CLUSTER_PREFIX)) {
      updateCluster(id, { color }).catch(() => toast.error('Failed to update color'));
    }
  };

  const deleteClusterHandler = (id: string) => {
    queryClient.setQueryData<PlannerCluster[]>(clusterKey, (old = []) =>
      old.filter((c) => c.id !== id)
    );
    // Unassign member keywords in the cache (server FK does this automatically)
    queryClient.setQueryData<PlannerKeyword[]>(kwKey, (old = []) =>
      old.map((k) => (k.cluster_id === id ? { ...k, cluster_id: null, is_pillar: false } : k))
    );
    if (!id.startsWith(DEMO_CLUSTER_PREFIX)) {
      deleteCluster(id).catch(() => toast.error('Failed to delete cluster'));
    }
    toast.success('Cluster removed');
  };

  const setPillarHandler = (clusterId: string, keywordId: string) => {
    queryClient.setQueryData<PlannerKeyword[]>(kwKey, (old = []) =>
      old.map((k) => {
        if (k.cluster_id !== clusterId) return k;
        return { ...k, is_pillar: k.id === keywordId };
      })
    );
    if (!clusterId.startsWith(DEMO_CLUSTER_PREFIX)) {
      setClusterPillar(clusterId, keywordId).catch(() => toast.error('Failed to set pillar'));
    }
  };

  if (!propertyLoading && !selectedPropertyId) {
    return (
      <div className="p-6">
        <div className="max-w-xl mx-auto mt-16 rounded-lg border bg-card p-8 text-center space-y-3">
          <KanbanSquare className="h-8 w-8 text-primary mx-auto" />
          <h1 className="text-xl font-semibold">Select a site to start planning</h1>
          <p className="text-sm text-muted-foreground">
            The Content Planner keeps a separate plan for each site. Pick a site from the sidebar dropdown, or add a website you want to research (it doesn&apos;t need to exist yet).
          </p>
          <Button variant="outline" size="sm" onClick={() => setAddWebsiteOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add a website
          </Button>
        </div>
        <AddWebsiteDialog open={addWebsiteOpen} onOpenChange={setAddWebsiteOpen} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <KanbanSquare className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Content Planner</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Save keywords from any research page, tag them by intent, and track them through your content lifecycle.
            {selectedProperty && (
              <> Planning for <span className="font-medium text-foreground">{selectedProperty.site_url.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/\/+$/, '')}</span>.</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {items.length > 0 && (
            <div className="text-sm text-muted-foreground">
              {filtered.length} of {items.length} keywords
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setAddWebsiteOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add a website
          </Button>
          <Button variant="outline" size="sm" onClick={loadDemoData}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Load demo data
          </Button>
        </div>
      </div>
      <AddWebsiteDialog open={addWebsiteOpen} onOpenChange={setAddWebsiteOpen} />

      <div className="flex items-center justify-between gap-3">
        <Tabs value={view} onValueChange={(v) => setViewPersisted(v as 'kanban' | 'clusters')}>
          <TabsList>
            <TabsTrigger value="kanban" className="gap-1.5">
              <KanbanSquare className="h-3.5 w-3.5" /> Kanban
            </TabsTrigger>
            <TabsTrigger value="clusters" className="gap-1.5">
              <Network className="h-3.5 w-3.5" /> Clusters
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {view === 'kanban' && (
          <PlannerFilters
            state={filters}
            availableSources={availableSources}
            onChange={setFilters}
          />
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading...</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed py-16 text-center">
          <KanbanSquare className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium">Your planner is empty</p>
          <p className="text-xs text-muted-foreground mt-1">
            Head to Keyword Research or Competitor Analysis and click the bookmark icon on any keyword.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={loadDemoData}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Load demo data to preview
          </Button>
        </div>
      ) : view === 'kanban' ? (
        <PlannerKanban
          items={filtered}
          clusters={clusters}
          onCardClick={setEditing}
          onDelete={(id) => deleteMutation.mutate(id)}
          onStatusChange={(id, status) => {
            const prev = items.find((i) => i.id === id);
            updateMutation.mutate({ id, patch: { status } });
            // When a keyword enters the Draft column, mirror it into the
            // Content Writer as an empty post so the user can start writing.
            // Skipped for demo data (in-memory only) and when transitioning
            // sideways (e.g. draft → draft would be a no-op anyway).
            //
            // We stage the import and open a tiny dialog so the user can
            // choose the output language for the new writer post before we
            // create it. The default is their last-used language.
            if (status === 'draft' && prev && prev.status !== 'draft' && !isDemoId(id)) {
              setImportLanguage(getOutputLanguagePreference());
              setPendingImport({
                keyword: prev.keyword,
                topic: prev.keyword,
                notes: prev.notes || undefined,
              });
            }
          }}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
        />
      ) : (
        <ClusterView
          clusters={clusters}
          items={items}
          onCardClick={setEditing}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onCreateCluster={(input) => createClusterHandler(input)}
          onRenameCluster={renameClusterHandler}
          onRecolorCluster={recolorClusterHandler}
          onDeleteCluster={deleteClusterHandler}
          onSetPillar={setPillarHandler}
          onAssignKeyword={assignKeywordToCluster}
          onBulkCreateFromSeed={(seed, keywordIds) => {
            const color = CLUSTER_COLORS[clusters.length % CLUSTER_COLORS.length];
            createClusterHandler({ name: seed, color }, keywordIds);
          }}
        />
      )}

      <BulkActionBar
        selectedItems={selectedItems}
        onClear={clearSelection}
        onAssign={() => setAssignOpen(true)}
        onSetStatus={bulkSetStatus}
      />
      <AssignToPageDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        count={selectedItems.length}
        knownUrls={knownUrls}
        onSubmit={async (url) => {
          await bulkAssignUrl(url);
          setAssignOpen(false);
        }}
      />

      <EditDialog
        item={editing}
        items={items}
        clusters={clusters}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          if (!editing) return;
          updateMutation.mutate({ id: editing.id, patch });
          setEditing(null);
        }}
        onDelete={() => {
          if (!editing) return;
          deleteMutation.mutate(editing.id);
          setEditing(null);
        }}
        onCreateCluster={(name) => {
          if (!editing) return;
          const color = CLUSTER_COLORS[clusters.length % CLUSTER_COLORS.length];
          createClusterHandler({ name, color }, [editing.id]);
        }}
      />

      {/* Backlog → Draft: pick output language before creating the writer post. */}
      <Dialog
        open={!!pendingImport}
        onOpenChange={(open) => { if (!open) setPendingImport(null); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send to Content Writer</DialogTitle>
            <DialogDescription>
              A new draft will be created for <strong>{pendingImport?.keyword}</strong>. Pick the output language for the writer; you can change it later from the post.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <OutputLanguageSelect
              value={importLanguage}
              onValueChange={setImportLanguage}
              id="planner-import-language"
              label="Output language"
              description="Applies to every step: research, outline, draft, review."
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingImport(null)}>
              Skip
            </Button>
            <Button
              onClick={() => {
                if (!pendingImport) return;
                const staged = pendingImport;
                setPendingImport(null);
                importPlannerKeywordToWriter({
                  propertyId: selectedPropertyId,
                  keyword: staged.keyword,
                  topic: staged.topic,
                  notes: staged.notes,
                  language: importLanguage,
                }).then((res) => {
                  if (res.created) {
                    toast.success('Added to Content Writer drafts', {
                      action: {
                        label: 'Open',
                        onClick: () => {
                          window.location.href = `/content-writer?view=post&post=${res.postId}&workspace=${res.workspaceId}`;
                        },
                      },
                    });
                  } else if (res.reason === 'duplicate') {
                    toast.info('Already in Content Writer drafts', {
                      action: {
                        label: 'Open',
                        onClick: () => {
                          window.location.href = `/content-writer?view=post&post=${res.postId}&workspace=${res.workspaceId}`;
                        },
                      },
                    });
                  } else if (res.reason === 'no_property') {
                    toast.info('Connect a website first to auto-import drafts.', {
                      action: {
                        label: 'Connect',
                        onClick: () => { window.location.href = '/settings#properties'; },
                      },
                    });
                  }
                }).catch(() => {
                  // Don't block the planner update on a writer-side failure.
                });
              }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface EditDialogProps {
  item: PlannerKeyword | null;
  items: PlannerKeyword[];
  clusters: PlannerCluster[];
  onClose: () => void;
  onSave: (patch: Partial<Pick<PlannerKeyword, 'intent' | 'status' | 'assigned_url' | 'notes' | 'content_brief' | 'cluster_id' | 'is_pillar'>>) => void;
  onDelete: () => void;
  onCreateCluster: (name: string) => void;
}

function EditDialog({ item, items, clusters, onClose, onSave, onDelete, onCreateCluster }: EditDialogProps) {
  const [intent, setIntent] = useState<PlannerIntent>('informational');
  const [status, setStatus] = useState<PlannerStatus>('backlog');
  const [clusterId, setClusterId] = useState<string | null>(null);
  const [isPillar, setIsPillar] = useState(false);
  const [newClusterName, setNewClusterName] = useState('');
  const [creatingCluster, setCreatingCluster] = useState(false);
  const [notes, setNotes] = useState('');
  const [title, setTitle] = useState('');
  const [additionalKeywords, setAdditionalKeywords] = useState<string[]>([]);
  const [kwInput, setKwInput] = useState('');
  const [outline, setOutline] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [cta, setCta] = useState('');

  useMemoSync(item, (i) => {
    setIntent(i.intent);
    setStatus(i.status);
    setClusterId(i.cluster_id);
    setIsPillar(i.is_pillar);
    setCreatingCluster(false);
    setNewClusterName('');
    setNotes(i.notes || '');
    const brief: ContentBrief = i.content_brief || {};
    setTitle(brief.title || '');
    setAdditionalKeywords(brief.additional_keywords || []);
    setKwInput('');
    setOutline(brief.outline || '');
    setMetaDescription(brief.meta_description || '');
    setTargetAudience(brief.target_audience || '');
    setCta(brief.cta || '');
  });

  const commitKeyword = () => {
    const v = kwInput.trim();
    if (!v) return;
    if (!additionalKeywords.includes(v)) {
      setAdditionalKeywords([...additionalKeywords, v]);
    }
    setKwInput('');
  };

  const removeKeyword = (kw: string) => {
    setAdditionalKeywords(additionalKeywords.filter((k) => k !== kw));
  };

  const metaLen = metaDescription.length;
  const titleLen = title.length;

  const save = () => {
    const brief: ContentBrief = {
      title: title.trim() || undefined,
      additional_keywords: additionalKeywords.length ? additionalKeywords : undefined,
      outline: outline.trim() || undefined,
      meta_description: metaDescription.trim() || undefined,
      target_audience: targetAudience.trim() || undefined,
      cta: cta.trim() || undefined,
    };
    const hasBrief = Object.values(brief).some((v) => v !== undefined);
    onSave({
      intent,
      status,
      cluster_id: clusterId,
      is_pillar: !!clusterId && isPillar,
      notes: notes.trim() || null,
      content_brief: hasBrief ? brief : null,
    });
  };

  const siblings = useMemo(() => {
    if (!clusterId || !item) return [];
    return items.filter((k) => k.cluster_id === clusterId && k.id !== item.id);
  }, [items, clusterId, item]);

  const activeCluster = clusters.find((c) => c.id === clusterId) || null;

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        {item && (
          <>
            <DialogHeader className="px-6 pt-6 pb-4 border-b bg-muted/30">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-lg break-words pr-6">{item.keyword}</DialogTitle>
                  <DialogDescription className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    {item.source && <Badge variant="outline" className="text-[10px]">{item.source}</Badge>}
                    {item.search_volume != null && (
                      <Badge variant="outline" className="text-[10px]">Vol {item.search_volume.toLocaleString()}</Badge>
                    )}
                    {item.keyword_difficulty != null && (
                      <Badge variant="outline" className="text-[10px]">KD {Math.round(item.keyword_difficulty)}</Badge>
                    )}
                    {item.cpc != null && (
                      <Badge variant="outline" className="text-[10px]">CPC ${item.cpc.toFixed(2)}</Badge>
                    )}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <ScrollArea className="max-h-[65vh]">
              <div className="px-6 py-5 space-y-6">
                {/* Meta: intent + status */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Intent</Label>
                    <Select value={intent} onValueChange={(v) => setIntent(v as PlannerIntent)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INTENT_ORDER.map((i) => (
                          <SelectItem key={i} value={i}>{INTENT_LABELS[i]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select value={status} onValueChange={(v) => setStatus(v as PlannerStatus)}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_ORDER.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/30 px-3 py-2 flex items-start gap-2.5">
                  <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Recommended page type</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {PAGE_TYPE_BY_INTENT[intent].label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {PAGE_TYPE_BY_INTENT[intent].description}
                    </p>
                  </div>
                </div>

                {/* Cluster assignment */}
                <div className="rounded-md border bg-muted/20 px-3 py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Network className="h-3.5 w-3.5 text-primary" />
                    <Label className="text-xs">Cluster</Label>
                    {activeCluster && (
                      <span
                        className="h-2 w-2 rounded-full ml-auto"
                        style={{ background: activeCluster.color }}
                      />
                    )}
                  </div>

                  {creatingCluster ? (
                    <div className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={newClusterName}
                        onChange={(e) => setNewClusterName(e.target.value)}
                        placeholder="New cluster name"
                        className="h-8"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newClusterName.trim()) {
                            onCreateCluster(newClusterName.trim());
                            setCreatingCluster(false);
                            setNewClusterName('');
                          }
                          if (e.key === 'Escape') setCreatingCluster(false);
                        }}
                      />
                      <Button
                        size="sm"
                        onClick={() => {
                          if (!newClusterName.trim()) return;
                          onCreateCluster(newClusterName.trim());
                          setCreatingCluster(false);
                          setNewClusterName('');
                        }}
                      >
                        Create
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCreatingCluster(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Select
                        value={clusterId ?? '__none__'}
                        onValueChange={(v) => {
                          if (v === '__new__') setCreatingCluster(true);
                          else setClusterId(v === '__none__' ? null : v);
                        }}
                      >
                        <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No cluster</SelectItem>
                          {clusters.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              <span className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                                {c.name}
                              </span>
                            </SelectItem>
                          ))}
                          <SelectItem value="__new__">
                            <span className="flex items-center gap-2 text-primary">
                              <Plus className="h-3 w-3" /> New cluster...
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {clusterId && (
                        <Button
                          size="sm"
                          variant={isPillar ? 'default' : 'outline'}
                          onClick={() => setIsPillar(!isPillar)}
                        >
                          <Star className={`h-3.5 w-3.5 mr-1 ${isPillar ? 'fill-current' : ''}`} />
                          {isPillar ? 'Pillar' : 'Make pillar'}
                        </Button>
                      )}
                    </div>
                  )}

                  {clusterId && siblings.length > 0 && (
                    <div className="space-y-1 pt-2 border-t">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Other posts in this cluster ({siblings.length})
                        </p>
                        {(() => {
                          const sibVol = siblings.reduce((s, k) => s + (k.search_volume || 0), 0);
                          return sibVol > 0 ? (
                            <p className="text-[10px] text-muted-foreground">
                              {sibVol >= 1000 ? `${(sibVol / 1000).toFixed(1)}K` : sibVol}/mo combined
                            </p>
                          ) : null;
                        })()}
                      </div>
                      <div className="space-y-0.5">
                        {siblings.slice(0, 5).map((k) => (
                          <div key={k.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            {k.is_pillar && <Star className="h-3 w-3 fill-amber-400 text-amber-500 flex-shrink-0" />}
                            <span className="truncate flex-1">{k.keyword}</span>
                            {k.search_volume != null && (
                              <span className="text-[10px] tabular-nums">
                                {k.search_volume >= 1000 ? `${(k.search_volume / 1000).toFixed(1)}K` : k.search_volume}/mo
                              </span>
                            )}
                            <span className="text-[10px]">{STATUS_LABELS[k.status]}</span>
                          </div>
                        ))}
                        {siblings.length > 5 && (
                          <p className="text-[10px] text-muted-foreground/60">
                            +{siblings.length - 5} more
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t pt-5 space-y-5">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Content brief</h3>
                    <span className="text-[10px] text-muted-foreground">Everything you need to write the post</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Megaphone className="h-3 w-3" /> Blog title
                      </Label>
                      <span className={`text-[10px] ${titleLen > 60 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {titleLen}/60
                      </span>
                    </div>
                    <Input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., The 2026 Local SEO Checklist: 17 Steps That Move Rankings"
                      className="h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <Tag className="h-3 w-3" /> Additional keywords to target
                    </Label>
                    <div className="flex items-center gap-1.5 flex-wrap p-2 border rounded-md bg-background min-h-9">
                      {additionalKeywords.map((kw) => (
                        <Badge key={kw} variant="secondary" className="text-xs gap-1 pr-1">
                          {kw}
                          <button
                            type="button"
                            onClick={() => removeKeyword(kw)}
                            className="hover:text-destructive rounded-sm"
                          >
                            <XIcon className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      <input
                        value={kwInput}
                        onChange={(e) => setKwInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            commitKeyword();
                          } else if (e.key === 'Backspace' && !kwInput && additionalKeywords.length) {
                            setAdditionalKeywords(additionalKeywords.slice(0, -1));
                          }
                        }}
                        onBlur={commitKeyword}
                        placeholder={additionalKeywords.length ? '' : 'Type and press Enter'}
                        className="flex-1 min-w-[120px] bg-transparent outline-none text-xs"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Secondary keywords, LSI terms, fan-out variants. Press Enter or comma to add.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs flex items-center gap-1.5">
                      <ListChecks className="h-3 w-3" /> Outline
                    </Label>
                    <Textarea
                      value={outline}
                      onChange={(e) => setOutline(e.target.value)}
                      placeholder={"1. TL;DR answer capsule\n2. Section headings\n3. Key points per section\n4. FAQ block"}
                      rows={5}
                      className="text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Target className="h-3 w-3" /> Meta description
                      </Label>
                      <span className={`text-[10px] ${metaLen > 160 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {metaLen}/160
                      </span>
                    </div>
                    <Textarea
                      value={metaDescription}
                      onChange={(e) => setMetaDescription(e.target.value)}
                      placeholder="The snippet that shows on SERPs — include the primary keyword and a clear benefit."
                      rows={2}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Users className="h-3 w-3" /> Target audience
                      </Label>
                      <Input
                        value={targetAudience}
                        onChange={(e) => setTargetAudience(e.target.value)}
                        placeholder="Solo local SMB owners"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5">
                        <Megaphone className="h-3 w-3" /> CTA
                      </Label>
                      <Input
                        value={cta}
                        onChange={(e) => setCta(e.target.value)}
                        placeholder="Book a free 15-min audit"
                        className="h-9"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-5">
                  <Label className="text-xs">Internal notes</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anything else — angle, competing posts to beat, internal links..."
                    rows={3}
                    className="mt-1.5"
                  />
                </div>
              </div>
            </ScrollArea>

            <div className="flex justify-between gap-2 px-6 py-4 border-t bg-muted/30">
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
              >
                Delete
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={save}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Save brief
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useRef } from 'react';
function useMemoSync<T>(value: T | null, fn: (v: T) => void) {
  const lastId = useRef<unknown>(null);
  useEffect(() => {
    if (!value) return;
    const id = (value as unknown as { id?: unknown }).id;
    if (id !== lastId.current) {
      lastId.current = id;
      fn(value);
    }
  }, [value, fn]);
}
