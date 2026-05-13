import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  ExternalLink,
  Globe,
  FileText,
  CheckCircle2,
  AlertCircle,
  ListPlus,
  Info,
  Sparkles,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useProperty } from '@/contexts/PropertyContext';
import {
  checkMeta,
  discoverSitemap,
  classifyRows,
  buildIssueGroups,
  TITLE_MAX,
  TITLE_MIN,
  META_MAX,
  META_MIN,
  type ClassifiedRow,
  type IssueGroup,
  type TitleStatus,
  type DescStatus,
} from '@/lib/meta-checker';
import {
  createTask,
  listAudits,
  type Subtask,
  type SiteAuditListItem,
} from '@/lib/site-audit';
import { MetaRewriteDialog } from './MetaRewriteDialog';
import { rewriteMeta, type MetaRewriteIssueType } from '@/lib/meta-rewrite';
import { BulkRewritesPanel, type BulkRewriteEntry } from './BulkRewritesPanel';
import { OutOfCreditsError } from '@/lib/api';

function rowToIssueType(row: ClassifiedRow): MetaRewriteIssueType | null {
  // Title issues take priority — the prompt rewrites both regardless.
  switch (row.title_status) {
    case 'missing': return 'missing_title';
    case 'too_long': return 'long_title';
    case 'too_short': return 'short_title';
    case 'duplicate': return 'duplicate_title';
    default: break;
  }
  switch (row.description_status) {
    case 'missing': return 'missing_desc';
    case 'too_long': return 'long_desc';
    case 'too_short': return 'short_desc';
    default: return null;
  }
}

type Mode = 'paste' | 'sitemap';

const TITLE_STATUS_COPY: Record<TitleStatus, { label: string; tone: string }> = {
  ok: { label: 'OK', tone: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  missing: { label: 'Missing', tone: 'bg-red-500/10 text-red-600 border-red-500/30' },
  too_long: { label: `> ${TITLE_MAX}`, tone: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  too_short: { label: `< ${TITLE_MIN}`, tone: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  duplicate: { label: 'Duplicate', tone: 'bg-violet-500/10 text-violet-600 border-violet-500/30' },
};

const DESC_STATUS_COPY: Record<DescStatus, { label: string; tone: string }> = {
  ok: { label: 'OK', tone: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  missing: { label: 'Missing', tone: 'bg-red-500/10 text-red-600 border-red-500/30' },
  too_long: { label: `> ${META_MAX}`, tone: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  too_short: { label: `< ${META_MIN}`, tone: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
};

function shortPath(u: string): string {
  try {
    const parsed = new URL(u);
    return parsed.pathname + (parsed.search || '');
  } catch {
    return u;
  }
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
}

export function MetaChecker() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { selectedPropertyId, selectedProperty } = useProperty();

  const [mode, setMode] = useState<Mode>('paste');
  const [pasteText, setPasteText] = useState('');
  const [sitemapDomain, setSitemapDomain] = useState('');
  const [sitemapUrls, setSitemapUrls] = useState<string[]>([]);
  const [sitemapSelected, setSitemapSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ClassifiedRow[] | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [targetAuditId, setTargetAuditId] = useState<string>('none');
  const [rewriteRow, setRewriteRow] = useState<ClassifiedRow | null>(null);
  const [bulkRewrites, setBulkRewrites] = useState<BulkRewriteEntry[] | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkAcceptingAll, setBulkAcceptingAll] = useState(false);
  const [bulkAcceptingUrls, setBulkAcceptingUrls] = useState<Set<string>>(new Set());

  const auditsQuery = useQuery({
    queryKey: ['site-audits'],
    queryFn: listAudits,
    staleTime: 30_000,
  });

  // Show all audits in the dropdown so the user can pick any relevant one.
  // Domain is visible next to each entry; users can pick across sites if they
  // want a cross-site organization (rare but supported).
  const audits: SiteAuditListItem[] = useMemo(
    () => auditsQuery.data || [],
    [auditsQuery.data]
  );

  const sitemapMut = useMutation({
    mutationFn: (domain: string) => discoverSitemap(domain),
    onSuccess: (data) => {
      const urls = data.pages.map((p) => p.url);
      setSitemapUrls(urls);
      // Pre-select the first 50 by default.
      setSitemapSelected(new Set(urls.slice(0, 50)));
      if (urls.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No sitemap found',
          description: 'Check /robots.txt or enter URLs manually.',
        });
      }
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Sitemap error', description: err.message }),
  });

  const checkMut = useMutation({
    mutationFn: (urls: string[]) => checkMeta(urls),
    onSuccess: (data) => {
      const classified = classifyRows(data.rows);
      setResults(classified);
      // Pre-select every row with an issue — that's almost always what the
      // user wants to fix.
      setSelectedRows(new Set(classified.filter((r) => r.has_issue).map((r) => r.url)));
    },
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Check failed', description: err.message }),
  });

  // Keep the target-audit default synced: if there's exactly one audit for this
  // property, pre-select it; otherwise leave "none".
  useEffect(() => {
    if (targetAuditId !== 'none') return;
    if (audits.length === 1) setTargetAuditId(audits[0].id);
  }, [audits, targetAuditId]);

  const createMut = useMutation({
    mutationFn: createTask,
    onError: (err: Error) =>
      toast({ variant: 'destructive', title: 'Failed to create task', description: err.message }),
  });

  const urlsForCheck = useMemo(() => {
    if (mode === 'paste') {
      return pasteText
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return Array.from(sitemapSelected);
  }, [mode, pasteText, sitemapSelected]);

  const issueGroups: IssueGroup[] = useMemo(() => {
    if (!results) return [];
    // Only consider rows the user has ticked. If no selection at all, fall
    // back to every problem row so the UI stays useful.
    const pool = selectedRows.size > 0
      ? results.filter((r) => selectedRows.has(r.url))
      : results;
    return buildIssueGroups(pool);
  }, [results, selectedRows]);

  function toggleRow(url: string) {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function selectAllResults(onlyIssues: boolean) {
    if (!results) return;
    setSelectedRows(
      new Set(results.filter((r) => (onlyIssues ? r.has_issue : true)).map((r) => r.url))
    );
  }

  function clearSelectedRows() {
    setSelectedRows(new Set());
  }

  const summary = useMemo(() => {
    if (!results) return null;
    const issues = results.filter((r) => r.has_issue).length;
    return { total: results.length, issues, ok: results.length - issues };
  }, [results]);

  function runCheck() {
    if (urlsForCheck.length === 0) {
      toast({ variant: 'destructive', title: 'No URLs to check' });
      return;
    }
    if (urlsForCheck.length > 100) {
      toast({
        variant: 'destructive',
        title: 'Too many URLs',
        description: 'Max 100 per run. Select fewer.',
      });
      return;
    }
    setResults(null);
    checkMut.mutate(urlsForCheck);
  }

  function toggleSitemapUrl(u: string) {
    setSitemapSelected((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });
  }

  function selectAllSitemap(limitTo100 = true) {
    const target = limitTo100 ? sitemapUrls.slice(0, 100) : sitemapUrls;
    setSitemapSelected(new Set(target));
  }

  async function sendGroupToBoard(group: IssueGroup) {
    if (!selectedPropertyId) {
      toast({
        variant: 'destructive',
        title: 'Select a website first',
        description: 'Pick a property from the sidebar selector to create tasks.',
      });
      return;
    }
    const subtasks: Subtask[] = group.rows.map((r, idx) => {
      const len =
        group.key.includes('title') ? r.title_length ?? 0 : r.description_length ?? 0;
      const lengthSuffix = len ? ` — ${len} chars` : ' — missing';
      return {
        id: `${group.key}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
        text: `${shortPath(r.url)}${lengthSuffix}`,
        url: r.url,
        done: false,
      };
    });
    await createMut.mutateAsync({
      property_id: selectedPropertyId,
      audit_id: targetAuditId !== 'none' ? targetAuditId : null,
      title: group.title,
      how_to_fix: group.how_to_fix,
      category: 'Meta',
      priority: group.priority,
      status: 'todo',
      subtasks,
    });
    toast({ title: 'Task created', description: `${group.rows.length} URLs as subtasks` });
    qc.invalidateQueries({ queryKey: ['tasks'] });
  }

  // Build the list of selected rows that have a fixable issue.
  const selectedFixableRows = useMemo(() => {
    if (!results) return [] as ClassifiedRow[];
    return results.filter((r) => selectedRows.has(r.url) && r.has_issue && !r.error);
  }, [results, selectedRows]);

  async function runBulkRewrite() {
    if (selectedFixableRows.length === 0) {
      toast({ variant: 'destructive', title: 'Nothing selected to rewrite' });
      return;
    }
    // Initialize entries.
    const initial: BulkRewriteEntry[] = selectedFixableRows.map((r) => ({
      url: r.url,
      current_title: r.title,
      current_description: r.description,
      status: 'pending',
    }));
    setBulkRewrites(initial);
    setBulkRunning(true);

    // Concurrency 3, with early-exit on out-of-credits.
    const queue = [...selectedFixableRows];
    let stopped = false;

    const worker = async () => {
      while (!stopped) {
        const row = queue.shift();
        if (!row) return;
        const issueType = rowToIssueType(row);
        if (!issueType) {
          setBulkRewrites((prev) => prev?.map((e) => e.url === row.url
            ? { ...e, status: 'error', error: 'No matching issue' }
            : e) ?? null);
          continue;
        }
        setBulkRewrites((prev) => prev?.map((e) => e.url === row.url ? { ...e, status: 'running' } : e) ?? null);
        try {
          const result = await rewriteMeta({
            url: row.url,
            current_title: row.title,
            current_description: row.description,
            issue_type: issueType,
          });
          setBulkRewrites((prev) => prev?.map((e) => e.url === row.url
            ? { ...e, status: 'done', result }
            : e) ?? null);
        } catch (err) {
          if (err instanceof OutOfCreditsError) {
            stopped = true;
            // Mark remaining pending rows as out-of-credits.
            setBulkRewrites((prev) => prev?.map((e) => e.status === 'pending' || e.url === row.url
              ? { ...e, status: 'error', error: 'Out of credits' }
              : e) ?? null);
            return;
          }
          const msg = err instanceof Error ? err.message : 'Rewrite failed';
          setBulkRewrites((prev) => prev?.map((e) => e.url === row.url
            ? { ...e, status: 'error', error: msg === 'NO_LLM_KEY' ? 'Add your LLM API key in Settings.' : msg }
            : e) ?? null);
        }
      }
    };

    await Promise.all([worker(), worker(), worker()]);
    setBulkRunning(false);
    if (stopped) {
      toast({
        variant: 'destructive',
        title: 'Out of credits',
        description: 'Some rewrites were skipped — upgrade or wait for credit refresh.',
      });
    }
  }

  async function acceptRewriteToBoard(entry: BulkRewriteEntry): Promise<void> {
    if (!selectedPropertyId) {
      toast({
        variant: 'destructive',
        title: 'Select a website first',
        description: 'Pick a property from the sidebar selector to create tasks.',
      });
      return;
    }
    if (!entry.result) return;
    setBulkAcceptingUrls((prev) => { const n = new Set(prev); n.add(entry.url); return n; });
    try {
      await createMut.mutateAsync({
        property_id: selectedPropertyId,
        audit_id: targetAuditId !== 'none' ? targetAuditId : null,
        title: `Rewrite meta on ${shortPath(entry.url)}`,
        category: 'Meta',
        priority: 'medium',
        status: 'todo',
        url: entry.url,
        how_to_fix:
          `Replace the current title and meta description on ${entry.url} with the AI-generated copy below.\n\n` +
          `New title (${entry.result.title_length} chars):\n${entry.result.title}\n\n` +
          `New meta description (${entry.result.description_length} chars):\n${entry.result.description}` +
          (entry.result.reasoning ? `\n\nReasoning: ${entry.result.reasoning}` : ''),
        subtasks: [
          { id: `t-${Math.random().toString(36).slice(2, 8)}`, text: `Apply new title: ${entry.result.title}`, url: entry.url, done: false },
          { id: `d-${Math.random().toString(36).slice(2, 8)}`, text: `Apply new meta description: ${entry.result.description}`, url: entry.url, done: false },
        ],
      });
      setBulkRewrites((prev) => prev?.map((e) => e.url === entry.url ? { ...e, sent_to_board: true } : e) ?? null);
    } finally {
      setBulkAcceptingUrls((prev) => { const n = new Set(prev); n.delete(entry.url); return n; });
    }
    qc.invalidateQueries({ queryKey: ['tasks'] });
  }

  async function acceptAllRewrites() {
    if (!bulkRewrites) return;
    setBulkAcceptingAll(true);
    try {
      for (const entry of bulkRewrites) {
        if (entry.status !== 'done' || entry.sent_to_board) continue;
        // Sequential to avoid D1 write contention (matches existing pattern).
        // eslint-disable-next-line no-await-in-loop
        await acceptRewriteToBoard(entry);
      }
      toast({ title: 'Sent to board', description: 'All ready rewrites are tracked as tasks.' });
    } finally {
      setBulkAcceptingAll(false);
    }
  }

  async function sendAllToBoard() {
    if (!selectedPropertyId) {
      toast({
        variant: 'destructive',
        title: 'Select a website first',
        description: 'Pick a property from the sidebar selector to create tasks.',
      });
      return;
    }
    for (const g of issueGroups) {
      // Sequential to avoid D1 write contention.
      // eslint-disable-next-line no-await-in-loop
      await sendGroupToBoard(g);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Meta Checker</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Check title tags and meta descriptions across any list of URLs. Flag pages over 60
          characters (titles) or 160 characters (meta descriptions), missing tags, or duplicate
          titles, then push fixes to the action board as tasks with URL subtasks.
        </p>
      </div>

      {/* Input */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">URLs to check</CardTitle>
            <Badge variant="outline" className="text-[10px]">
              Max 100 per run
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('paste')}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                mode === 'paste'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Paste URLs
            </button>
            <button
              type="button"
              onClick={() => setMode('sitemap')}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                mode === 'sitemap'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              From sitemap.xml
            </button>
          </div>

          {mode === 'paste' ? (
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'https://example.com/\nhttps://example.com/about\nhttps://example.com/services'}
              rows={8}
              className="font-mono text-xs"
            />
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={sitemapDomain}
                  onChange={(e) => setSitemapDomain(e.target.value)}
                  placeholder="example.com"
                  className="flex-1"
                />
                <Button
                  onClick={() => sitemapMut.mutate(sitemapDomain)}
                  disabled={!sitemapDomain.trim() || sitemapMut.isPending}
                >
                  {sitemapMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Load sitemap'
                  )}
                </Button>
              </div>

              {sitemapUrls.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {sitemapSelected.size} of {sitemapUrls.length} selected
                      {sitemapUrls.length > 100 && ' (capped at 100 per run)'}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => selectAllSitemap(true)}
                        className="underline hover:text-foreground"
                      >
                        Select first 100
                      </button>
                      <button
                        type="button"
                        onClick={() => setSitemapSelected(new Set())}
                        className="underline hover:text-foreground"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="border rounded-md max-h-72 overflow-y-auto divide-y divide-border/40">
                    {sitemapUrls.map((u) => (
                      <label
                        key={u}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/40 cursor-pointer"
                      >
                        <Checkbox
                          checked={sitemapSelected.has(u)}
                          onCheckedChange={() => toggleSitemapUrl(u)}
                        />
                        <span className="truncate font-mono">{shortPath(u)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Info className="h-3 w-3" />
              JavaScript SPAs (React/Vue without SSR) may show as "missing" — we read the raw HTML.
            </span>
            <Button
              onClick={runCheck}
              disabled={checkMut.isPending || urlsForCheck.length === 0}
              className="gap-2"
            >
              {checkMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking {urlsForCheck.length}…
                </>
              ) : (
                <>Check {urlsForCheck.length || ''} URLs</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {summary && (
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Results</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary.issues} of {summary.total} pages have issues · {selectedRows.size} selected
                  {selectedProperty ? ` · ${hostOf(selectedProperty.site_url)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedFixableRows.length > 0 && (
                  <Button
                    onClick={runBulkRewrite}
                    disabled={bulkRunning}
                    variant="outline"
                    className="gap-2"
                  >
                    {bulkRunning ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    Rewrite {selectedFixableRows.length} with AI
                    <span className="text-[10px] text-muted-foreground font-normal">
                      ({selectedFixableRows.length} {selectedFixableRows.length === 1 ? 'credit' : 'credits'})
                    </span>
                  </Button>
                )}
                {issueGroups.length > 0 && (
                  <Button
                    onClick={sendAllToBoard}
                    disabled={!selectedPropertyId || createMut.isPending}
                    className="gap-2"
                  >
                    <ListPlus className="h-4 w-4" />
                    Create {issueGroups.length} action {issueGroups.length === 1 ? 'card' : 'cards'}
                  </Button>
                )}
              </div>
            </div>

            {/* Audit + bulk-select controls */}
            <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Attach to audit:</span>
                <Select
                  value={targetAuditId}
                  onValueChange={setTargetAuditId}
                  disabled={auditsQuery.isLoading}
                >
                  <SelectTrigger className="h-8 min-w-[280px] text-xs">
                    <SelectValue
                      placeholder={auditsQuery.isLoading ? 'Loading audits…' : 'Select an audit'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No audit (standalone tasks)</SelectItem>
                    {audits.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.domain} · {new Date(a.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!auditsQuery.isLoading && audits.length === 0 && (
                  <span className="text-[11px] text-muted-foreground italic">
                    No audits yet — run one from the Audits tab.
                  </span>
                )}
                {!auditsQuery.isLoading && audits.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {audits.length} audit{audits.length === 1 ? '' : 's'} available
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Select:</span>
                <button
                  type="button"
                  onClick={() => selectAllResults(true)}
                  className="underline hover:text-foreground"
                >
                  All with issues
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  onClick={() => selectAllResults(false)}
                  className="underline hover:text-foreground"
                >
                  All rows
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  type="button"
                  onClick={clearSelectedRows}
                  className="underline hover:text-foreground"
                >
                  None
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Per-group cards (filtered to selected rows) */}
            {issueGroups.length > 0 ? (
              <div className="space-y-2">
                {issueGroups.map((g) => (
                  <div
                    key={g.key}
                    className="flex items-center justify-between gap-3 p-3 rounded-md border bg-muted/20"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{g.title}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {g.rows.length} {g.rows.length === 1 ? 'URL' : 'URLs'} · priority: {g.priority}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => sendGroupToBoard(g)}
                      disabled={!selectedPropertyId || createMut.isPending}
                    >
                      Send to board
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              selectedRows.size > 0 && (
                <div className="text-xs text-muted-foreground italic">
                  No issues in selected rows.
                </div>
              )
            )}

            {/* Bulk AI rewrite results */}
            {bulkRewrites && bulkRewrites.length > 0 && (
              <BulkRewritesPanel
                entries={bulkRewrites}
                onAcceptOne={acceptRewriteToBoard}
                onAcceptAll={acceptAllRewrites}
                onDismiss={() => setBulkRewrites(null)}
                acceptingAll={bulkAcceptingAll}
                acceptingUrls={bulkAcceptingUrls}
                hasBoardTarget={!!selectedPropertyId}
              />
            )}

            {/* Results table */}
            <div className="border rounded-md overflow-hidden">
              <div className="grid grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto] gap-2 px-3 py-2 border-b bg-muted/30 text-[10px] font-medium uppercase tracking-wider text-muted-foreground items-center">
                <span className="w-4" />
                <span>URL</span>
                <span>Title</span>
                <span>Meta description</span>
                <span className="w-20 text-right">AI rewrite</span>
              </div>
              <div className="divide-y divide-border/40">
                {results?.map((r) => (
                  <ResultRow
                    key={r.url}
                    row={r}
                    selected={selectedRows.has(r.url)}
                    onToggle={() => toggleRow(r.url)}
                    onRewrite={() => setRewriteRow(r)}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {rewriteRow && (() => {
        const issueType = rowToIssueType(rewriteRow);
        if (!issueType) return null;
        return (
          <MetaRewriteDialog
            open={!!rewriteRow}
            onOpenChange={(o) => { if (!o) setRewriteRow(null); }}
            url={rewriteRow.url}
            currentTitle={rewriteRow.title}
            currentDescription={rewriteRow.description}
            issueType={issueType}
            auditId={targetAuditId !== 'none' ? targetAuditId : null}
          />
        );
      })()}
    </div>
  );
}

function ResultRow({
  row,
  selected,
  onToggle,
  onRewrite,
}: {
  row: ClassifiedRow;
  selected: boolean;
  onToggle: () => void;
  onRewrite: () => void;
}) {
  const titleCopy = TITLE_STATUS_COPY[row.title_status];
  const descCopy = DESC_STATUS_COPY[row.description_status];

  return (
    <div className="grid grid-cols-[auto_minmax(0,2fr)_minmax(0,2fr)_minmax(0,2fr)_auto] gap-2 px-3 py-2.5 text-xs items-start hover:bg-muted/20">
      <Checkbox
        checked={selected}
        onCheckedChange={onToggle}
        className="mt-0.5"
        aria-label={`Select ${row.url}`}
      />
      <a
        href={row.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline truncate min-w-0"
        title={row.url}
      >
        <ExternalLink className="h-3 w-3 flex-shrink-0" />
        <span className="truncate font-mono">{shortPath(row.url)}</span>
      </a>

      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${titleCopy.tone}`}
          >
            {row.title_status === 'ok' ? (
              <CheckCircle2 className="h-3 w-3 mr-0.5" />
            ) : (
              <AlertCircle className="h-3 w-3 mr-0.5" />
            )}
            {titleCopy.label}
          </span>
          {row.title_length != null && row.title_length > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {row.title_length} chars
            </span>
          )}
        </div>
        <div
          className={`truncate text-xs ${
            row.title_status === 'missing' ? 'italic text-muted-foreground' : ''
          }`}
          title={row.title || ''}
        >
          {row.title || (row.error ? `(${row.error})` : '(none)')}
        </div>
      </div>

      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${descCopy.tone}`}
          >
            {row.description_status === 'ok' ? (
              <CheckCircle2 className="h-3 w-3 mr-0.5" />
            ) : (
              <AlertCircle className="h-3 w-3 mr-0.5" />
            )}
            {descCopy.label}
          </span>
          {row.description_length != null && row.description_length > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {row.description_length} chars
            </span>
          )}
        </div>
        <div
          className={`truncate text-xs ${
            row.description_status === 'missing' ? 'italic text-muted-foreground' : ''
          }`}
          title={row.description || ''}
        >
          {row.description || '(none)'}
        </div>
      </div>

      <div className="w-20 flex justify-end">
        {row.has_issue && !row.error && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px]"
            onClick={onRewrite}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            Rewrite
          </Button>
        )}
      </div>
    </div>
  );
}
