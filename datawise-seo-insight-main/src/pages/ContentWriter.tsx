import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowDown, ArrowUp, ChevronDown, ChevronUp, FileText, MessageSquare, Plus, RefreshCw, Sparkles, Trash2, Loader2, CheckCircle2, Circle, Clock, Copy, Download, Upload, ExternalLink, X, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { useProperty } from '@/contexts/PropertyContext';
import {
  listWorkspaces, createWorkspace, getWorkspace, deleteWorkspace,
  getKBDoc, updateKBDoc, sendInterviewMessage, finalizeKBDoc, discoverWebsitePages,
  createPost, getPost, updatePost, deletePost, runPostStep,
  DOC_TYPES, DOC_LABELS, DOC_DESCRIPTIONS,
  POST_STATUS_ORDER, POST_STATUS_LABEL, POST_STATUS_PILL,
  resolveWorkspaceForProperty,
  type Workspace, type KBDocSummary, type PostSummary, type DocType, type DocStatus,
  type Post, type PostStatus, type PostStep, type InterviewMessage, type StepUsage, type UsageMap,
  type AutoDraftDocType, type KBAutoDraftDocument, type KBAutoDraftMetadata,
  type WebsitePageCandidate, type WebsitePagesDiscoveryResponse,
} from '@/lib/content-writer';
import {
  getKBAutoDraftTask,
  getLatestKBAutoDraftTaskForWorkspace,
  startKBAutoDraftTask,
  subscribeKBAutoDraftTasks,
} from '@/lib/kb-auto-draft-task';
import { markdownToHtml, htmlToMarkdown, copyAsRichText } from '@/lib/markdown';
import PostEditor from '@/components/content-writer/PostEditor';
import ModelBadge from '@/components/content-writer/ModelBadge';
import DraftProgressBar from '@/components/content-writer/DraftProgressBar';

function StatusBadge({ status }: { status: DocStatus }) {
  if (status === 'ready') {
    return <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Ready</Badge>;
  }
  if (status === 'in_progress') {
    return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" /> In progress</Badge>;
  }
  return <Badge variant="outline" className="gap-1"><Circle className="h-3 w-3" /> Empty</Badge>;
}

export default function ContentWriter() {
  const [params] = useSearchParams();
  const view = params.get('view') || 'workspaces';
  const wsId = params.get('workspace');
  const docType = params.get('doc') as DocType | null;
  const postId = params.get('post');

  if (view === 'interview' && wsId && docType) return <InterviewView workspaceId={wsId} docType={docType} />;
  if (view === 'post' && postId) return <PostComposerView postId={postId} />;
  if (view === 'workspace' && wsId) return <WorkspaceDetailView workspaceId={wsId} />;
  // No explicit workspace param: resolve the workspace bound to the user's
  // currently-selected property, then redirect into it. The "list of
  // workspaces" view was retired — workspace ↔ property is now 1:1.
  return <WorkspaceAutoResolveView />;
}

// Landing view at /content-writer with no params. Reads the selected
// property from PropertyContext, asks the worker to find-or-create the
// matching workspace, then redirects to its workspace view. Re-resolves
// when the property changes so switching the top-bar dropdown also swaps
// the writer surface.
function WorkspaceAutoResolveView() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { selectedPropertyId, properties, loading: propLoading } = useProperty();
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (propLoading) return;
    if (!selectedPropertyId) return;
    let cancelled = false;
    setResolving(true);
    resolveWorkspaceForProperty(selectedPropertyId)
      .then((res) => {
        if (cancelled) return;
        navigate(`/content-writer?view=workspace&workspace=${res.workspace.id}`, { replace: true });
      })
      .catch((err) => {
        if (cancelled) return;
        toast({ title: 'Could not open workspace', description: (err as Error).message, variant: 'destructive' });
        setResolving(false);
      });
    return () => { cancelled = true; };
  }, [selectedPropertyId, propLoading, navigate, toast]);

  if (propLoading || resolving) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No property connected → guide the user to connect one. Strict 1:1
  // means the Content Writer cannot operate without a property attached.
  if (!selectedPropertyId) {
    return (
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Content Writer</h1>
          <p className="mt-1 text-muted-foreground">
            One workspace per connected website. Each workspace holds a private knowledge base and the blog posts you generate from it.
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">{properties.length === 0 ? 'No website connected yet' : 'Select a website to continue'}</p>
              <p className="text-sm text-muted-foreground">
                {properties.length === 0
                  ? 'Connect a Google Search Console property to start a Content Writer workspace.'
                  : 'Pick a property from the website dropdown at the top of the app.'}
              </p>
            </div>
            {properties.length === 0 && (
              <Button className="mt-2 gap-2" onClick={() => navigate('/settings#properties')}>
                <Plus className="h-4 w-4" /> Connect a website
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // selectedPropertyId is set but resolution hasn't kicked in yet (transient).
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspaces list
// ---------------------------------------------------------------------------

function WorkspacesListView() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { properties, selectedProperty } = useProperty();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [propertyId, setPropertyId] = useState<string>('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await listWorkspaces();
      setWorkspaces(res.workspaces);
    } catch (err) {
      toast({ title: 'Failed to load', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setName(selectedProperty ? `${cleanDomain(selectedProperty.site_url)} writer` : '');
    setWebsiteUrl(selectedProperty ? toHttpsUrl(selectedProperty.site_url) : '');
    setPropertyId(selectedProperty?.id || '');
    setCreateOpen(true);
  }

  async function submitCreate() {
    if (!name.trim()) {
      toast({ title: 'Name required', variant: 'destructive' });
      return;
    }
    setCreating(true);
    try {
      const res = await createWorkspace({
        name: name.trim(),
        website_url: websiteUrl.trim() || undefined,
        property_id: propertyId || null,
      });
      setCreateOpen(false);
      navigate(`/content-writer?view=workspace&workspace=${res.workspace.id}`);
    } catch (err) {
      toast({ title: 'Could not create workspace', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Content Writer</h1>
          <p className="mt-1 text-muted-foreground">
            Build a private knowledge base for your business, then generate blog posts that follow your brand rules and use your real expertise.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ModelBadge />
          <Button onClick={openCreate} className="gap-2"><Plus className="h-4 w-4" /> New workspace</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : workspaces.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">No writer workspaces yet</p>
              <p className="text-sm text-muted-foreground">Each workspace holds one brand's knowledge base and generated blog posts.</p>
            </div>
            <Button onClick={openCreate} className="mt-2 gap-2"><Plus className="h-4 w-4" /> Create your first workspace</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((w) => (
            <Card key={w.id} className="cursor-pointer transition-colors hover:border-primary/50" onClick={() => navigate(`/content-writer?view=workspace&workspace=${w.id}`)}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {w.name}
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </CardTitle>
                <CardDescription className="line-clamp-1">{w.website_url || w.property_url || 'No site URL'}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Updated {new Date(w.updated_at).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New writer workspace</DialogTitle>
            <DialogDescription>One workspace per brand. Tied to a connected GSC property when possible.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cw-name">Workspace name</Label>
              <Input id="cw-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Plumbing writer" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cw-url">Website URL</Label>
              <Input id="cw-url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" />
            </div>
            {properties.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="cw-prop">GSC property (optional)</Label>
                <select
                  id="cw-prop"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={propertyId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPropertyId(id);
                    const p = properties.find((pp) => pp.id === id);
                    if (p && !websiteUrl) setWebsiteUrl(toHttpsUrl(p.site_url));
                  }}
                >
                  <option value="">No property</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{cleanDomain(p.site_url)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function cleanDomain(siteUrl: string): string {
  return siteUrl.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/\/+$/, '');
}
function toHttpsUrl(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return `https://${siteUrl.slice('sc-domain:'.length)}`;
  return siteUrl;
}

function serializeWebsitePages(candidates: WebsitePageCandidate[]): string {
  const rows = candidates
    .filter((candidate) => candidate.url.trim())
    .map((candidate, index) => {
      const h2s = (candidate.h2 || []).slice(0, 5).join('; ');
      const h1s = (candidate.h1 || []).slice(0, 3).join('; ');
      return [
        `## ${index + 1}. ${candidate.title || candidate.url}`,
        `URL: ${candidate.url}`,
        `Page type: ${candidate.page_type || 'important site page'}`,
        `Description: ${candidate.description || candidate.meta_description || candidate.snippet || 'Important site page.'}`,
        `Link-worthy from blog posts: ${candidate.link_worthy}`,
        `Source/confidence: ${candidate.source.replace(/_/g, ' ')} / ${candidate.confidence}`,
        h1s ? `Primary H1: ${h1s}` : '',
        h2s ? `Helpful headings: ${h2s}` : '',
      ].filter(Boolean).join('\n');
    });
  return [
    '# Website Pages Knowledge Base',
    'Use this document to choose accurate internal links and understand what each important site page covers. Do not invent URLs that are not listed here.',
    ...rows,
  ].join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Workspace detail
// ---------------------------------------------------------------------------

function WorkspaceDetailView({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { selectedPropertyId, loading: propLoading } = useProperty();
  const [data, setData] = useState<{ workspace: Workspace; kb_docs: KBDocSummary[]; posts: PostSummary[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [newPostOpen, setNewPostOpen] = useState(false);
  // null = show all statuses; otherwise filter to that single status.
  const [statusFilter, setStatusFilter] = useState<PostStatus | null>(null);

  async function load() {
    setLoading(true);
    try {
      setData(await getWorkspace(workspaceId));
    } catch (err) {
      toast({ title: 'Failed to load workspace', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [workspaceId]);

  // If the user switches the website dropdown to a different property than
  // the one this workspace is bound to, kick them back to the auto-resolve
  // landing so the writer rebinds to the right property's workspace.
  useEffect(() => {
    if (propLoading) return;
    if (!data?.workspace) return;
    const workspaceProp = data.workspace.property_id;
    if (selectedPropertyId && workspaceProp && selectedPropertyId !== workspaceProp) {
      navigate('/content-writer', { replace: true });
    }
  }, [selectedPropertyId, propLoading, data?.workspace, navigate]);

  async function handleDelete() {
    if (!confirm('Delete this workspace? All KB docs and posts will be removed.')) return;
    try {
      await deleteWorkspace(workspaceId);
      navigate('/content-writer');
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as Error).message, variant: 'destructive' });
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!data) return null;
  const { workspace, kb_docs, posts } = data;

  const readyCount = kb_docs.filter((d) => d.status === 'ready').length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 gap-1 px-2" onClick={() => navigate('/content-writer')}>
            <ArrowLeft className="h-4 w-4" /> All workspaces
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">{workspace.name}</h1>
          {workspace.website_url && <p className="mt-1 text-sm text-muted-foreground">{workspace.website_url}</p>}
        </div>
        <div className="flex items-center gap-3">
          <ModelBadge />
          <Button variant="ghost" size="sm" onClick={handleDelete} className="gap-1 text-destructive">
            <Trash2 className="h-4 w-4" /> Delete workspace
          </Button>
        </div>
      </div>

      <KnowledgeBaseSection
        workspaceId={workspaceId}
        workspace={workspace}
        kbDocs={kb_docs}
        onChanged={load}
      />

      <Separator />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Blog posts</h2>
          <Button
            onClick={() => setNewPostOpen(true)}
            disabled={readyCount === 0}
            className="gap-1"
            title={readyCount === 0 ? 'Finalize at least one KB doc first' : ''}
          >
            <Plus className="h-4 w-4" /> New post
          </Button>
        </div>
        {readyCount < 5 && (
          <p className="text-sm text-muted-foreground">
            For best results, finalize all 5 KB docs before drafting. You can still draft now: missing docs will be flagged for the writer.
          </p>
        )}
        {posts.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No posts yet.</CardContent></Card>
        ) : (
          <>
            {/* Status filter chips. Counts come from the unfiltered list so
                they don't change when the user narrows the view. */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter(null)}
                className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                  statusFilter === null
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted'
                }`}
              >
                All <span className="ml-1 text-muted-foreground/70">{posts.length}</span>
              </button>
              {POST_STATUS_ORDER.map((s) => {
                const count = posts.filter((p) => p.status === s).length;
                const active = statusFilter === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(active ? null : s)}
                    className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                      active ? POST_STATUS_PILL[s] : 'border-transparent text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {POST_STATUS_LABEL[s]} <span className="ml-1 opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            {(() => {
              const filtered = statusFilter ? posts.filter((p) => p.status === statusFilter) : posts;
              if (filtered.length === 0) {
                return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No posts in {POST_STATUS_LABEL[statusFilter as PostStatus]}.</CardContent></Card>;
              }
              return (
                <div className="space-y-2">
                  {filtered.map((p) => (
                    <Card
                      key={p.id}
                      className="cursor-pointer transition-colors hover:border-primary/50"
                      onClick={() => navigate(`/content-writer?view=post&post=${p.id}&workspace=${workspaceId}`)}
                    >
                      <CardContent className="flex items-center justify-between py-4">
                        <div>
                          <p className="font-medium">{p.title || p.topic}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.target_keyword ? `${p.target_keyword} • ` : ''}
                            Updated {new Date(p.updated_at).toLocaleString()}
                          </p>
                        </div>
                        <Badge variant="outline" className={POST_STATUS_PILL[p.status]}>
                          {POST_STATUS_LABEL[p.status]}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </section>

      <NewPostDialog
        open={newPostOpen}
        onOpenChange={setNewPostOpen}
        workspaceId={workspaceId}
        onCreated={(id) => navigate(`/content-writer?view=post&post=${id}&workspace=${workspaceId}`)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Knowledge base section (collapsible, per-card upload)
// ---------------------------------------------------------------------------

function KnowledgeBaseSection({ workspaceId, workspace, kbDocs, onChanged }: {
  workspaceId: string;
  workspace: Workspace;
  kbDocs: KBDocSummary[];
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const kbByType = new Map(kbDocs.map((d) => [d.doc_type, d]));
  const readyCount = kbDocs.filter((d) => d.status === 'ready').length;
  const allReady = readyCount === DOC_TYPES.length;
  const [generatedDrafts, setGeneratedDrafts] = useState<Partial<Record<AutoDraftDocType, string>>>({});
  // Default-collapse once everything is ready; user can still expand.
  const [open, setOpen] = useState(!allReady);
  // Re-evaluate the default when readyCount transitions to/from 5.
  useEffect(() => { setOpen(!allReady); }, [allReady]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-3">
      <div className="flex items-center justify-between">
        <CollapsibleTrigger className="group flex items-center gap-2 text-left">
          <h2 className="text-lg font-semibold">Knowledge base</h2>
          <span className="text-sm text-muted-foreground">{readyCount} of {DOC_TYPES.length} ready</span>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </CollapsibleTrigger>
        {!open && (
          <div className="flex flex-wrap items-center gap-1.5">
            {DOC_TYPES.map((dt) => {
              const status = kbByType.get(dt)?.status || 'empty';
              return <KBStatusPill key={dt} label={DOC_LABELS[dt]} status={status} onClick={() => setOpen(true)} />;
            })}
          </div>
        )}
      </div>

      <CollapsibleContent>
        <KBSetupChecklist kbDocs={kbDocs} generatedDrafts={generatedDrafts} />
        <KBAutoDraftWizard
          workspaceId={workspaceId}
          workspace={workspace}
          onChanged={onChanged}
          onDraftsChanged={setGeneratedDrafts}
        />
        <div className="grid gap-3 md:grid-cols-2">
          {DOC_TYPES.map((dt) => {
            const doc = kbByType.get(dt);
            const status = doc?.status || 'empty';
            return (
              <KBDocCard
                key={dt}
                docType={dt}
                status={status}
                workspaceId={workspaceId}
                hasGeneratedDraft={dt !== 'experience_notes' && !!generatedDrafts[dt as AutoDraftDocType]}
                onUploaded={() => { onChanged(); toast({ title: `${DOC_LABELS[dt]} updated` }); }}
                onOpenInterview={() => navigate(`/content-writer?view=interview&workspace=${workspaceId}&doc=${dt}`)}
              />
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const KB_SETUP_STEPS: Array<{ docType: DocType; title: string; description: string }> = [
  { docType: 'sitemap', title: 'Website Pages', description: 'Start with the URL so DataWise understands the important pages.' },
  { docType: 'tone_of_voice', title: 'Tone of Voice', description: 'Confirm how the business sounds before drafting blogs.' },
  { docType: 'service_details', title: 'Offer Details', description: 'Confirm services, features, products, pricing rules, and scope.' },
  { docType: 'brand_guidelines', title: 'Brand Guidelines', description: 'Confirm hard rules, claims, formatting, and competitor handling.' },
  { docType: 'experience_notes', title: 'Experience Notes', description: 'Finish with real stories, opinions, credentials, and examples.' },
];

function kbDocStatus(kbDocs: KBDocSummary[], docType: DocType): DocStatus {
  return kbDocs.find((doc) => doc.doc_type === docType)?.status || 'empty';
}

function kbSetupTone(docType: DocType) {
  const tones: Record<DocType, { card: string; dot: string; readyBadge: string; draftBadge: string; active: string }> = {
    sitemap: {
      card: 'border-sky-200/70 bg-sky-50/40',
      dot: 'bg-sky-500 text-white',
      readyBadge: 'border-sky-200 bg-sky-100 text-sky-800',
      draftBadge: 'border-sky-200 bg-sky-50 text-sky-700',
      active: 'border-sky-500 ring-1 ring-sky-200',
    },
    tone_of_voice: {
      card: 'border-cyan-200/70 bg-cyan-50/40',
      dot: 'bg-cyan-500 text-white',
      readyBadge: 'border-cyan-200 bg-cyan-100 text-cyan-800',
      draftBadge: 'border-cyan-200 bg-cyan-50 text-cyan-700',
      active: 'border-cyan-500 ring-1 ring-cyan-200',
    },
    service_details: {
      card: 'border-violet-200/70 bg-violet-50/40',
      dot: 'bg-violet-500 text-white',
      readyBadge: 'border-violet-200 bg-violet-100 text-violet-800',
      draftBadge: 'border-violet-200 bg-violet-50 text-violet-700',
      active: 'border-violet-500 ring-1 ring-violet-200',
    },
    brand_guidelines: {
      card: 'border-amber-200/70 bg-amber-50/40',
      dot: 'bg-amber-500 text-white',
      readyBadge: 'border-amber-200 bg-amber-100 text-amber-900',
      draftBadge: 'border-amber-200 bg-amber-50 text-amber-800',
      active: 'border-amber-500 ring-1 ring-amber-200',
    },
    experience_notes: {
      card: 'border-rose-200/70 bg-rose-50/40',
      dot: 'bg-rose-500 text-white',
      readyBadge: 'border-rose-200 bg-rose-100 text-rose-800',
      draftBadge: 'border-rose-200 bg-rose-50 text-rose-700',
      active: 'border-rose-500 ring-1 ring-rose-200',
    },
  };
  return tones[docType];
}

function KBSetupChecklist({ kbDocs, generatedDrafts = {}, activeDocType, compact = false }: {
  kbDocs: KBDocSummary[];
  generatedDrafts?: Partial<Record<AutoDraftDocType, string>>;
  activeDocType?: DocType;
  compact?: boolean;
}) {
  const missingBeforeExperience = KB_SETUP_STEPS
    .filter((step) => step.docType !== 'experience_notes')
    .filter((step) => kbDocStatus(kbDocs, step.docType) !== 'ready')
    .map((step) => step.title);
  const experienceReady = missingBeforeExperience.length === 0;

  return (
    <div className={compact ? 'mb-0 rounded-lg border bg-muted/20 p-3' : 'mb-4 rounded-xl border bg-muted/20 p-4'}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Knowledge base setup flow</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Experience Notes works best after the website, tone, offers, and brand rules are ready.
          </p>
        </div>
        <Badge variant={experienceReady ? 'default' : 'secondary'}>
          {experienceReady ? 'Ready for Experience Notes' : `${missingBeforeExperience.length} missing before Experience Notes`}
        </Badge>
      </div>
      <div className={compact ? 'grid gap-2 md:grid-cols-5' : 'grid gap-2 lg:grid-cols-5'}>
        {KB_SETUP_STEPS.map((step, index) => {
          const tone = kbSetupTone(step.docType);
          const status = kbDocStatus(kbDocs, step.docType);
          const hasGeneratedDraft = step.docType !== 'experience_notes' && !!generatedDrafts[step.docType as AutoDraftDocType];
          const isActive = activeDocType === step.docType;
          const ready = status === 'ready';
          const statusLabel = ready
            ? 'Ready'
            : hasGeneratedDraft
              ? 'Draft to save'
              : status === 'in_progress'
                ? 'In progress'
                : 'Missing';

          return (
            <div
              key={step.docType}
              className={`rounded-lg border p-3 ${tone.card} ${isActive ? tone.active : ''}`}
            >
              <div className="flex items-start gap-2">
                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] ${
                  ready || isActive ? tone.dot : 'bg-background text-muted-foreground ring-1 ring-border'
                }`}>
                  {ready ? <CheckCircle2 className="h-3 w-3" /> : index + 1}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{step.title}</p>
                  {!compact ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{step.description}</p> : null}
                  <Badge
                    variant="outline"
                    className={`mt-2 ${ready ? tone.readyBadge : hasGeneratedDraft ? tone.draftBadge : 'bg-background/70 text-muted-foreground'}`}
                  >
                    {statusLabel}
                  </Badge>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!experienceReady ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Missing before Experience Notes: {missingBeforeExperience.join(', ')}. You can still interview, but the AI may need to ask broader setup questions.
        </p>
      ) : null}
    </div>
  );
}

const AUTO_DRAFT_DOC_TYPES: AutoDraftDocType[] = ['sitemap', 'tone_of_voice', 'service_details', 'brand_guidelines'];

function DotLottieLoader({ label }: { label: string }) {
  useEffect(() => {
    const id = 'dotlottie-wc-script';
    if (document.getElementById(id)) return;
    const script = document.createElement('script');
    script.id = id;
    script.src = 'https://unpkg.com/@lottiefiles/dotlottie-wc@0.9.10/dist/dotlottie-wc.js';
    script.type = 'module';
    document.head.appendChild(script);
  }, []);

  return (
    <div
      className="mt-4 flex items-center gap-4 rounded-lg border bg-muted/40 p-4"
      aria-live="polite"
      aria-busy="true"
    >
      {createElement('dotlottie-wc', {
        src: 'https://lottie.host/0ce1de99-bd37-4b00-9cac-94145c4fc2b7/hZ5xaHutQ0.lottie',
        style: { width: 96, height: 96, flex: '0 0 auto' },
        autoplay: true,
        loop: true,
      } as any)}
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">This usually takes about a minute.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          In the meantime, go do something useful. Or go outside for a minute. Pat a dog, or a cat, but preferably a dog.
        </p>
      </div>
    </div>
  );
}

function KBAutoDraftWizard({ workspaceId, workspace, onChanged, onDraftsChanged }: {
  workspaceId: string;
  workspace: Workspace;
  onChanged: () => void;
  onDraftsChanged: (drafts: Partial<Record<AutoDraftDocType, string>>) => void;
}) {
  const { toast } = useToast();
  const latestTask = getLatestKBAutoDraftTaskForWorkspace(workspaceId);
  const initialWebsiteUrl = latestTask?.websiteUrl || workspace.website_url || workspace.property_url || '';
  const [websiteUrl, setWebsiteUrl] = useState(initialWebsiteUrl);
  const [taskState, setTaskState] = useState(() => getKBAutoDraftTask(workspaceId, initialWebsiteUrl));
  const [saving, setSaving] = useState<AutoDraftDocType | 'all' | null>(null);
  const [activeDoc, setActiveDoc] = useState<AutoDraftDocType>('sitemap');
  const [documents, setDocuments] = useState<Partial<Record<AutoDraftDocType, KBAutoDraftDocument>>>({});
  const [metadata, setMetadata] = useState<KBAutoDraftMetadata | null>(null);
  const [candidates, setCandidates] = useState<WebsitePageCandidate[]>([]);
  const mountedAtRef = useRef(Date.now());
  const appliedTaskRef = useRef<string | null>(null);
  const reportedErrorRef = useRef<string | null>(null);
  const generating = taskState.status === 'running';

  useEffect(() => {
    const syncTask = () => setTaskState(getKBAutoDraftTask(workspaceId, websiteUrl));
    syncTask();
    return subscribeKBAutoDraftTasks(syncTask);
  }, [workspaceId, websiteUrl]);

  useEffect(() => {
    if (taskState.status === 'success' && taskState.response) {
      const applicationKey = `${taskState.key}:${taskState.completedAt || 'complete'}`;
      if (appliedTaskRef.current === applicationKey) return;
      appliedTaskRef.current = applicationKey;

      const res = taskState.response;
      setDocuments(res.documents);
      setMetadata(res.metadata);
      setCandidates(res.evidence.candidates || []);
      onDraftsChanged(Object.fromEntries(AUTO_DRAFT_DOC_TYPES.map((docType) => [docType, res.documents[docType]?.content || ''])) as Partial<Record<AutoDraftDocType, string>>);
      if ((taskState.completedAt || 0) >= mountedAtRef.current) {
        toast({ title: 'Knowledge base drafts generated', description: 'Review each draft before saving it to the writer.' });
      }
    }

    if (taskState.status === 'error' && taskState.error) {
      const errorKey = `${taskState.key}:${taskState.completedAt || 'error'}`;
      if (reportedErrorRef.current === errorKey) return;
      reportedErrorRef.current = errorKey;
      if ((taskState.completedAt || 0) >= mountedAtRef.current) {
        toast({ title: 'Auto-draft failed', description: taskState.error, variant: 'destructive' });
      }
    }
  }, [taskState, onDraftsChanged, toast]);

  function generate() {
    if (!websiteUrl.trim()) {
      toast({ title: 'Website URL required', variant: 'destructive' });
      return;
    }
    const task = startKBAutoDraftTask(workspaceId, websiteUrl.trim());
    setTaskState(task);
  }

  function updateDocument(docType: AutoDraftDocType, content: string) {
    setDocuments((current) => ({
      ...current,
      [docType]: current[docType]
        ? { ...current[docType]!, content, saved: false }
        : {
            doc_type: docType,
            label: DOC_LABELS[docType],
            content,
            confidence_warnings: [],
            source_page_urls: [],
            model: null,
            saved: false,
          },
    }));
    onDraftsChanged({ ...Object.fromEntries(Object.entries(documents).map(([key, doc]) => [key, doc?.content || ''])), [docType]: content } as Partial<Record<AutoDraftDocType, string>>);
  }

  function updateCandidate(index: number, patch: Partial<WebsitePageCandidate>) {
    setCandidates((current) => current.map((candidate, i) => i === index ? { ...candidate, ...patch } : candidate));
  }

  function removeCandidate(index: number) {
    setCandidates((current) => current.filter((_, i) => i !== index));
  }

  function contentForSave(docType: AutoDraftDocType): string {
    if (docType === 'sitemap' && candidates.length) return serializeWebsitePages(candidates);
    return documents[docType]?.content || '';
  }

  async function saveDoc(docType: AutoDraftDocType) {
    const content = contentForSave(docType);
    if (!content.trim()) {
      toast({ title: 'No draft to save', variant: 'destructive' });
      return;
    }
    setSaving(docType);
    try {
      await updateKBDoc(workspaceId, docType, { content, status: 'ready' });
      setDocuments((current) => ({
        ...current,
        [docType]: current[docType] ? { ...current[docType]!, content, saved: true } : current[docType],
      }));
      toast({ title: `${DOC_LABELS[docType]} saved`, description: 'This document is now active for blog generation.' });
      onChanged();
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  }

  async function saveAll() {
    const ready = AUTO_DRAFT_DOC_TYPES.filter((docType) => contentForSave(docType).trim());
    if (!ready.length) {
      toast({ title: 'No generated drafts to save', variant: 'destructive' });
      return;
    }
    setSaving('all');
    try {
      for (const docType of ready) {
        await updateKBDoc(workspaceId, docType, { content: contentForSave(docType), status: 'ready' });
      }
      setDocuments((current) => {
        const next = { ...current };
        for (const docType of ready) {
          if (next[docType]) next[docType] = { ...next[docType]!, content: contentForSave(docType), saved: true };
        }
        return next;
      });
      toast({ title: 'Reviewed drafts saved', description: `${ready.length} KB documents are now active for blog generation.` });
      onChanged();
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(null);
    }
  }

  const hasDrafts = AUTO_DRAFT_DOC_TYPES.some((docType) => !!documents[docType]?.content);

  return (
    <div className="mb-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Generate knowledge base from website</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Crawl the site once, then review inactive drafts for Website Pages, Tone, Offer Details, and Brand Rules.
          </p>
        </div>
        {hasDrafts && (
          <Button size="sm" onClick={saveAll} disabled={!!saving} className="gap-1">
            {saving === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save all reviewed
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="kb-auto-draft-url">Website URL</Label>
          <Input
            id="kb-auto-draft-url"
            value={websiteUrl}
            onChange={(event) => setWebsiteUrl(event.target.value)}
            placeholder="https://example.com"
          />
        </div>
        <Button onClick={generate} disabled={generating || !websiteUrl.trim()} className="gap-1">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? 'Generating' : 'Generate drafts'}
        </Button>
      </div>

      {generating && (
        <DotLottieLoader label="Generating knowledge base drafts" />
      )}

      {taskState.status === 'error' && taskState.error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">Knowledge base generation failed</p>
          <p className="mt-1 text-xs">{taskState.error}</p>
        </div>
      ) : null}

      {metadata && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">{metadata.final_candidate_count} pages</Badge>
          <Badge variant="outline">{metadata.sitemap_urls.length} sitemaps</Badge>
          <Badge variant={metadata.sonar_fallback_used ? 'default' : 'secondary'}>
            {metadata.sonar_fallback_used ? 'Sonar fallback used' : 'Crawler first'}
          </Badge>
          {metadata.site_archetype ? <Badge variant="outline">{metadata.site_archetype}</Badge> : null}
          <Badge variant="secondary">DeepSeek drafts</Badge>
          {metadata.duration_ms ? (
            <Badge variant="outline">{Math.round(metadata.duration_ms / 1000)}s total</Badge>
          ) : null}
          <Badge variant="outline">Not active until saved</Badge>
        </div>
      )}

      {hasDrafts && (
        <Tabs value={activeDoc} onValueChange={(value) => setActiveDoc(value as AutoDraftDocType)} className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            {AUTO_DRAFT_DOC_TYPES.map((docType) => (
              <TabsTrigger key={docType} value={docType} className="text-xs">
                {DOC_LABELS[docType].replace(' Guidelines', ' Rules')}
              </TabsTrigger>
            ))}
          </TabsList>

          {AUTO_DRAFT_DOC_TYPES.map((docType) => {
            const doc = documents[docType];
            return (
              <TabsContent key={docType} value={docType} className="mt-4 space-y-3">
                {doc?.confidence_warnings?.length ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    {doc.confidence_warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                ) : null}

                {docType === 'sitemap' && candidates.length ? (
                  <div className="max-h-[360px] space-y-2 overflow-auto rounded-lg border p-3">
                    {candidates.map((candidate, index) => (
                      <div key={`${candidate.url}-${index}`} className="grid gap-2 rounded-md border bg-background p-3 md:grid-cols-[minmax(0,1fr)_140px_120px_auto]">
                        <div className="min-w-0 space-y-1">
                          <Input
                            value={candidate.title}
                            onChange={(event) => updateCandidate(index, { title: event.target.value })}
                            className="h-8 text-sm font-medium"
                          />
                          <p className="truncate text-[11px] text-muted-foreground">{candidate.url}</p>
                          <Input
                            value={candidate.description}
                            onChange={(event) => updateCandidate(index, { description: event.target.value })}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Page type</Label>
                          <Input
                            value={candidate.page_type}
                            onChange={(event) => updateCandidate(index, { page_type: event.target.value })}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Link-worthy</Label>
                          <select
                            value={candidate.link_worthy}
                            onChange={(event) => updateCandidate(index, { link_worthy: event.target.value as WebsitePageCandidate['link_worthy'] })}
                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value="yes">Yes</option>
                            <option value="sometimes">Sometimes</option>
                            <option value="no">No</option>
                          </select>
                        </div>
                        <Button variant="ghost" size="sm" className="self-end text-destructive" onClick={() => removeCandidate(index)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Textarea
                    value={doc?.content || ''}
                    onChange={(event) => updateDocument(docType, event.target.value)}
                    rows={18}
                    className="font-mono text-xs"
                  />
                )}

                {docType === 'sitemap' && candidates.length ? (
                  <p className="text-xs text-muted-foreground">
                    Saving Website Pages uses the reviewed page table above. Open the dedicated Website Pages view for a larger editor.
                  </p>
                ) : null}

                {doc?.source_page_urls?.length ? (
                  <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                    <p className="mb-1 font-medium text-foreground">Source pages</p>
                    <div className="flex flex-wrap gap-1.5">
                      {doc.source_page_urls.slice(0, 8).map((url) => (
                        <Badge key={url} variant="outline" className="max-w-[260px] truncate font-normal">{url}</Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {doc?.saved ? 'Saved and active.' : 'Generated draft. Not active until saved.'}
                  </p>
                  <Button size="sm" onClick={() => saveDoc(docType)} disabled={!!saving || !contentForSave(docType).trim()} className="gap-1">
                    {saving === docType ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Save this document
                  </Button>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}

function KBStatusPill({ label, status, onClick }: { label: string; status: DocStatus; onClick: () => void }) {
  const dot = status === 'ready'
    ? 'bg-emerald-500'
    : status === 'in_progress'
      ? 'bg-amber-500'
      : 'bg-muted-foreground/40';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      title={`${label}: ${status}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </button>
  );
}

function KBDocCard({ docType, status, workspaceId, hasGeneratedDraft, onUploaded, onOpenInterview }: {
  docType: DocType;
  status: DocStatus;
  workspaceId: string;
  hasGeneratedDraft?: boolean;
  onUploaded: () => void;
  onOpenInterview: () => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    if (file.size > 1_000_000) {
      toast({ title: 'File too large', description: 'Keep KB documents under 1 MB.', variant: 'destructive' });
      return;
    }
    const text = await file.text();
    if (!text.trim()) {
      toast({ title: 'Empty file', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      await updateKBDoc(workspaceId, docType, { content: text, status: 'ready' });
      onUploaded();
    } catch (err) {
      toast({ title: 'Upload failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      ref={dropRef}
      className={dragOver ? 'border-primary bg-primary/5 transition-colors' : 'transition-colors'}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{DOC_LABELS[docType]}</CardTitle>
            <CardDescription className="mt-1 text-xs">{DOC_DESCRIPTIONS[docType]}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusBadge status={status} />
            {hasGeneratedDraft && status !== 'ready' ? <Badge variant="secondary">Draft generated</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button variant="default" size="sm" className="gap-1" onClick={onOpenInterview}>
          {docType === 'sitemap' ? <Sparkles className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
          {docType === 'sitemap'
            ? (status === 'empty' ? 'Generate from URL' : 'Review pages')
            : (status === 'empty' ? 'Start interview' : 'Continue')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload .txt
        </Button>
        <span className="text-xs text-muted-foreground">or drop a file here</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// New post dialog
// ---------------------------------------------------------------------------

function NewPostDialog({ open, onOpenChange, workspaceId, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  onCreated: (postId: string) => void;
}) {
  const { toast } = useToast();
  const [topic, setTopic] = useState('');
  const [keyword, setKeyword] = useState('');
  const [secondary, setSecondary] = useState('');
  const [takeaway, setTakeaway] = useState('');
  const [notes, setNotes] = useState('');
  const [includeTables, setIncludeTables] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!topic.trim()) {
      toast({ title: 'Topic required', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const res = await createPost(workspaceId, {
        topic: topic.trim(),
        target_keyword: keyword.trim() || undefined,
        secondary_keywords: secondary.trim() || undefined,
        takeaway: takeaway.trim() || undefined,
        notes: notes.trim() || undefined,
        include_tables: includeTables,
      });
      setTopic(''); setKeyword(''); setSecondary(''); setTakeaway(''); setNotes(''); setIncludeTables(true);
      onOpenChange(false);
      onCreated(res.post.id);
    } catch (err) {
      toast({ title: 'Could not create post', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New blog post</DialogTitle>
          <DialogDescription>This is the brief. The writer will run Research → Outline → Draft → Review using your KB.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="np-topic">Topic *</Label>
            <Input id="np-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="How often should you service your boiler?" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-kw">Target keyword</Label>
            <Input id="np-kw" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="boiler service frequency" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-sec">Secondary keywords</Label>
            <Input id="np-sec" value={secondary} onChange={(e) => setSecondary(e.target.value)} placeholder="boiler maintenance, annual service" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-take">Main takeaway</Label>
            <Textarea id="np-take" value={takeaway} onChange={(e) => setTakeaway(e.target.value)} rows={2} placeholder="The reader should book an annual service before winter." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-notes">Inline notes (optional)</Label>
            <Textarea id="np-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="A story, a stat, a customer question that comes up a lot..." />
          </div>
          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="np-tables"
              checked={includeTables}
              onCheckedChange={(v) => setIncludeTables(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="np-tables" className="cursor-pointer text-sm font-normal">
              Allow tables in the post
              <p className="mt-0.5 text-xs text-muted-foreground">
                The writer will use markdown tables for comparisons or grids when they're clearer than prose. Off if your CMS doesn't render tables well.
              </p>
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Interview chat view
// ---------------------------------------------------------------------------

function InterviewView({ workspaceId, docType }: { workspaceId: string; docType: DocType }) {
  if (docType === 'sitemap') {
    return <WebsitePagesDiscoveryView workspaceId={workspaceId} />;
  }
  return <ManualInterviewView workspaceId={workspaceId} docType={docType} />;
}

const EXPERIENCE_PROGRESS_SCALE = [
  { answers: 0, percent: 0, label: 'Not started' },
  { answers: 1, percent: 25, label: 'Light context' },
  { answers: 2, percent: 45, label: 'Getting useful' },
  { answers: 3, percent: 60, label: 'Good foundation' },
  { answers: 4, percent: 75, label: 'Strong detail' },
  { answers: 5, percent: 85, label: 'Very useful' },
  { answers: 6, percent: 90, label: 'Excellent enough to draft' },
] as const;

function isMeaningfulExperienceAnswer(message: InterviewMessage): boolean {
  if (message.role !== 'user') return false;
  const clean = message.content
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return false;
  if (/^(let'?s begin|lets begin|start|begin|go|ok|okay|yes|sure|ready)$/.test(clean)) return false;
  if (clean.split(' ').length <= 2 && !/(experienced|operator|early|stage)/.test(clean)) return false;
  return true;
}

function getExperienceProgress(messages: InterviewMessage[]) {
  const answerCount = messages.filter(isMeaningfulExperienceAnswer).length;
  const step = [...EXPERIENCE_PROGRESS_SCALE].reverse().find((item) => answerCount >= item.answers) || EXPERIENCE_PROGRESS_SCALE[0];
  return {
    answerCount,
    percent: step.percent,
    label: step.label,
  };
}

function experienceProgressTone(percent: number, complete: boolean) {
  if (complete) {
    return {
      stroke: '#16a34a',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      panel: 'border-emerald-200/70 bg-emerald-50/30',
    };
  }
  if (percent >= 85) {
    return {
      stroke: '#16a34a',
      badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      panel: 'border-emerald-200/70 bg-emerald-50/30',
    };
  }
  if (percent >= 60) {
    return {
      stroke: '#eab308',
      badge: 'border-yellow-200 bg-yellow-50 text-yellow-800',
      panel: 'border-yellow-200/70 bg-yellow-50/30',
    };
  }
  if (percent >= 25) {
    return {
      stroke: '#f59e0b',
      badge: 'border-amber-200 bg-amber-50 text-amber-800',
      panel: 'border-amber-200/70 bg-amber-50/30',
    };
  }
  if (percent > 0) {
    return {
      stroke: '#ef4444',
      badge: 'border-red-200 bg-red-50 text-red-700',
      panel: 'border-red-200/70 bg-red-50/30',
    };
  }
  return {
    stroke: '#ef4444',
    badge: 'border-red-200 bg-red-50 text-red-700',
    panel: 'border-red-200/70 bg-red-50/30',
  };
}

function ExperienceProgressRing({ percent, label, complete }: { percent: number; label: string; complete: boolean }) {
  const tone = experienceProgressTone(percent, complete);
  const size = 78;
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div
      className="relative flex h-[78px] w-[78px] shrink-0 items-center justify-center"
      role="progressbar"
      aria-label="Experience Notes detail progress"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      title={label}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeOpacity={0.12}
          strokeWidth={8}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={tone.stroke}
          strokeWidth={8}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 500ms ease-out, stroke 200ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-semibold tabular-nums" style={{ color: tone.stroke }}>{percent}%</span>
      </div>
    </div>
  );
}

function ExperienceProgressPanel({ progress, complete = false }: { progress: ReturnType<typeof getExperienceProgress>; complete?: boolean }) {
  const percent = complete ? 100 : progress.percent;
  const label = complete ? 'Document created' : progress.label;
  const tone = experienceProgressTone(percent, complete);
  return (
    <div className={`rounded-lg border p-3 shadow-sm ${tone.panel}`}>
      <div className="flex items-center gap-3">
        <ExperienceProgressRing percent={percent} label={label} complete={complete} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Experience detail</p>
            <Badge variant="outline" className={tone.badge}>{label}</Badge>
            <Badge variant="outline" className="bg-background/70">{progress.answerCount} answers</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {complete
              ? 'Your Experience Notes document is ready.'
              : 'More real answers make the writer more specific.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function ManualInterviewView({ workspaceId, docType }: { workspaceId: string; docType: DocType }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const isExperienceNotes = docType === 'experience_notes';
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [docContent, setDocContent] = useState('');
  const [docStatus, setDocStatus] = useState<DocStatus>('empty');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [input, setInput] = useState('');
  const [editingRaw, setEditingRaw] = useState(false);
  const [rawDraft, setRawDraft] = useState('');
  const [workspaceContext, setWorkspaceContext] = useState<{ kb_docs: KBDocSummary[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [res, workspaceRes] = await Promise.all([
        getKBDoc(workspaceId, docType),
        getWorkspace(workspaceId),
      ]);
      setMessages(res.messages || []);
      setDocContent(res.doc?.content || '');
      setDocStatus(res.doc?.status || 'empty');
      setWorkspaceContext({ kb_docs: workspaceRes.kb_docs || [] });
    } catch (err) {
      toast({ title: 'Failed to load', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [workspaceId, docType]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, sending]);

  async function send(overrideMessage?: string) {
    const message = (overrideMessage ?? input).trim();
    if (!message || sending) return;
    if (overrideMessage === undefined) setInput('');
    setSending(true);
    const optimistic: InterviewMessage = { role: 'user', content: message, created_at: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    try {
      const res = await sendInterviewMessage(workspaceId, docType, message);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, created_at: new Date().toISOString() }]);
      setDocStatus('in_progress');
    } catch (err) {
      toast({ title: 'Send failed', description: (err as Error).message, variant: 'destructive' });
      // roll back optimistic message
      setMessages((m) => m.slice(0, -1));
      if (overrideMessage === undefined) setInput(message);
    } finally {
      setSending(false);
    }
  }

  async function finalize() {
    if (finalizing) return;
    const experienceProgress = getExperienceProgress(messages);
    if (isExperienceNotes ? experienceProgress.answerCount < 2 : messages.length < 2) {
      toast({
        title: isExperienceNotes ? 'Add a little more first' : 'Run the interview first',
        description: isExperienceNotes
          ? 'Answer at least a couple of questions first so the document has something useful to work with.'
          : 'Answer a few questions before finalizing.',
        variant: 'destructive',
      });
      return;
    }
    setFinalizing(true);
    try {
      const res = await finalizeKBDoc(workspaceId, docType);
      setDocContent(res.content);
      setDocStatus('ready');
      toast({ title: 'Document finalized', description: 'Ready to use in blog post generation.' });
      load();
    } catch (err) {
      toast({ title: 'Finalize failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setFinalizing(false);
    }
  }

  async function saveRaw() {
    try {
      await updateKBDoc(workspaceId, docType, { content: rawDraft, status: rawDraft.trim() ? 'ready' : 'empty' });
      setDocContent(rawDraft);
      setDocStatus(rawDraft.trim() ? 'ready' : 'empty');
      setEditingRaw(false);
      toast({ title: 'Saved' });
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error).message, variant: 'destructive' });
    }
  }

  const experienceProgress = getExperienceProgress(messages);
  const emptyInterviewMessage = isExperienceNotes
    ? 'Say "let\'s begin" and I will use the saved business context to ask experience-specific questions.'
    : 'Ask me anything to start, or just say "let\'s begin" and I\'ll lead the interview.';
  const finishLabel = isExperienceNotes ? 'Finish Experience Notes chat' : 'Finalize document';

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate(`/content-writer?view=workspace&workspace=${workspaceId}`)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h2 className="font-semibold">{DOC_LABELS[docType]}</h2>
            <p className="text-xs text-muted-foreground">{DOC_DESCRIPTIONS[docType]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={docStatus} />
          <Button variant="outline" size="sm" onClick={() => { setRawDraft(docContent); setEditingRaw(true); }}>
            Edit raw
          </Button>
          <Button onClick={finalize} disabled={finalizing} className="gap-1">
            {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {finishLabel}
          </Button>
        </div>
      </div>

      {isExperienceNotes && workspaceContext ? (
        <div className="space-y-3 border-b bg-background px-6 py-3">
          <KBSetupChecklist
            kbDocs={workspaceContext.kb_docs}
            activeDocType="experience_notes"
            compact
          />
          <ExperienceProgressPanel progress={experienceProgress} complete={docStatus === 'ready'} />
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : messages.length === 0 ? (
              // Empty-state needs an explicit Start button. The hint text
              // alone ("Say 'let\'s begin'") left users staring at a chat
              // box that suggested questions would appear but never did
              // (bug 44aba545 — "I can't see a way to kick off the
              // questions"). The button sends the same kickoff message
              // so the AI takes the first turn.
              <Card>
                <CardContent className="space-y-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">{emptyInterviewMessage}</p>
                  <Button onClick={() => send("Let's begin")} disabled={sending} className="gap-2">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Start interview
                  </Button>
                </CardContent>
              </Card>
            ) : (
              messages.map((m, i) => {
                const isUser = m.role === 'user';
                return (
                <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] break-words rounded-lg px-4 py-3 text-sm shadow-sm ${
                    isUser
                      ? 'border border-[#004028] bg-[#005232] text-white'
                      : 'border bg-muted/40 text-foreground'
                  }`}>
                    <div
                      className={`prose prose-sm max-w-none [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 ${
                        isUser
                          ? 'prose-invert [&_*]:text-white [&_a]:font-medium [&_a]:text-white [&_a]:underline [&_code]:rounded [&_code]:bg-white/15 [&_code]:px-1 [&_code]:py-0.5 [&_strong]:text-white'
                          : 'dark:prose-invert'
                      }`}
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(m.content) }}
                    />
                  </div>
                </div>
                );
              })
            )}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="inline h-4 w-4 animate-spin" /> Thinking...
                </div>
              </div>
            )}
          </div>
          <div className="border-t bg-background p-4">
            {isExperienceNotes && experienceProgress.answerCount >= 2 && docStatus !== 'ready' ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-primary/5 p-3">
                <div>
                  <p className="text-sm font-medium">Ready to turn this into Experience Notes?</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    You can finish now and DataWise will create the document from what you have answered so far.
                  </p>
                </div>
                <Button size="sm" onClick={finalize} disabled={finalizing} className="gap-1">
                  {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Create Experience Notes
                </Button>
              </div>
            ) : null}
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder="Type your answer... (Enter to send, Shift+Enter for new line)"
                className="resize-none"
                disabled={sending}
              />
              <Button onClick={() => send()} disabled={sending || !input.trim()}>Send</Button>
            </div>
          </div>
        </div>

        {docContent && (
          <div className="hidden w-[420px] flex-col border-l bg-muted/20 lg:flex">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Finalized document</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={async () => {
                  await navigator.clipboard.writeText(docContent);
                  toast({ title: 'Copied' });
                }}
              >
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed">{docContent}</pre>
          </div>
        )}
      </div>

      <Dialog open={editingRaw} onOpenChange={setEditingRaw}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit {DOC_LABELS[docType]}</DialogTitle>
            <DialogDescription>Tweak the finalized document directly. Saving will mark it ready.</DialogDescription>
          </DialogHeader>
          <Textarea value={rawDraft} onChange={(e) => setRawDraft(e.target.value)} rows={20} className="font-mono text-xs" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRaw(false)}>Cancel</Button>
            <Button onClick={saveRaw}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WebsitePagesDiscoveryView({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docStatus, setDocStatus] = useState<DocStatus>('empty');
  const [candidates, setCandidates] = useState<WebsitePageCandidate[]>([]);
  const [draftContent, setDraftContent] = useState('');
  const [metadata, setMetadata] = useState<WebsitePagesDiscoveryResponse['metadata'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualMode, setManualMode] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [workspaceRes, docRes] = await Promise.all([
        getWorkspace(workspaceId),
        getKBDoc(workspaceId, 'sitemap'),
      ]);
      setWorkspace(workspaceRes.workspace);
      setWebsiteUrl(workspaceRes.workspace.website_url || workspaceRes.workspace.property_url || '');
      setDocContent(docRes.doc?.content || '');
      setDocStatus(docRes.doc?.status || 'empty');
    } catch (err) {
      toast({ title: 'Failed to load Website Pages', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [workspaceId]);

  if (manualMode) {
    return <ManualInterviewView workspaceId={workspaceId} docType="sitemap" />;
  }

  async function runDiscovery() {
    setDiscovering(true);
    try {
      const res = await discoverWebsitePages(workspaceId, websiteUrl.trim() || undefined);
      setCandidates(res.candidates);
      setDraftContent(res.draft_content);
      setMetadata(res.metadata);
      toast({
        title: 'Pages discovered',
        description: `${res.candidates.length} candidates ready for review${res.metadata.sonar_fallback_used ? ' using Sonar fallback' : ''}.`,
      });
    } catch (err) {
      toast({ title: 'Discovery failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDiscovering(false);
    }
  }

  function updateCandidate(index: number, patch: Partial<WebsitePageCandidate>) {
    setCandidates((current) => current.map((candidate, i) => i === index ? { ...candidate, ...patch } : candidate));
  }

  function removeCandidate(index: number) {
    setCandidates((current) => current.filter((_, i) => i !== index));
  }

  function currentDocument() {
    return candidates.length ? serializeWebsitePages(candidates) : draftContent || docContent;
  }

  async function saveReviewed() {
    const content = currentDocument();
    if (!content.trim()) {
      toast({ title: 'Nothing to save', description: 'Run discovery or paste Website Pages content first.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await updateKBDoc(workspaceId, 'sitemap', { content, status: 'ready' });
      setDocContent(content);
      setDocStatus('ready');
      toast({ title: 'Website Pages saved', description: 'The copywriter can now use these approved internal pages.' });
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  const previewContent = currentDocument();

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate(`/content-writer?view=workspace&workspace=${workspaceId}`)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h2 className="font-semibold">Website Pages</h2>
            <p className="text-xs text-muted-foreground">Discover important site pages, review them, then save the approved KB document.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={docStatus} />
          <Button variant="outline" size="sm" onClick={() => setManualMode(true)}>
            Manual interview
          </Button>
          <Button onClick={saveReviewed} disabled={saving || !previewContent.trim()} className="gap-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save approved pages
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 overflow-auto p-6">
            <div className="mb-4 rounded-lg border bg-card p-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="website-discovery-url">Website URL</Label>
                  <Input
                    id="website-discovery-url"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder={workspace?.website_url || 'https://example.com'}
                  />
                </div>
                <Button onClick={runDiscovery} disabled={discovering || !websiteUrl.trim()} className="gap-1">
                  {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Discover pages
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                The backend checks robots.txt and sitemaps first, crawls high-value internal links, then uses Sonar Pro only if deterministic discovery is weak.
              </p>
              {metadata && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{metadata.final_candidate_count} candidates</Badge>
                  <Badge variant="outline">{metadata.sitemap_urls.length} sitemaps</Badge>
                  <Badge variant={metadata.sonar_fallback_used ? 'default' : 'secondary'}>
                    {metadata.sonar_fallback_used ? 'Sonar fallback used' : 'Crawler only'}
                  </Badge>
                  {metadata.site_archetype ? <Badge variant="outline">{metadata.site_archetype}</Badge> : null}
                  {metadata.summarizer_model && <Badge variant="secondary">Drafted by {metadata.summarizer_model}</Badge>}
                </div>
              )}
            </div>

            {candidates.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">No discovered pages yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Run discovery from the website URL. Existing ready content is still shown in the preview.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {candidates.map((candidate, index) => (
                  <div key={`${candidate.url}-${index}`} className="rounded-lg border bg-card p-4">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            value={candidate.title}
                            onChange={(e) => updateCandidate(index, { title: e.target.value })}
                            className="h-8 max-w-xl font-medium"
                          />
                          <Badge variant="outline">{candidate.source.replace(/_/g, ' ')}</Badge>
                          <Badge variant={candidate.confidence === 'high' ? 'default' : 'secondary'}>{candidate.confidence}</Badge>
                        </div>
                        <a href={candidate.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground">
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{candidate.url}</span>
                        </a>
                      </div>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeCandidate(index)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[160px_160px_minmax(0,1fr)]">
                      <div className="space-y-1">
                        <Label className="text-xs">Page type</Label>
                        <Input
                          value={candidate.page_type}
                          onChange={(e) => updateCandidate(index, { page_type: e.target.value })}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Link-worthy from blog?</Label>
                        <select
                          value={candidate.link_worthy}
                          onChange={(e) => updateCandidate(index, { link_worthy: e.target.value as WebsitePageCandidate['link_worthy'] })}
                          className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value="yes">Yes</option>
                          <option value="sometimes">Sometimes</option>
                          <option value="no">No</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">One-line description</Label>
                        <Input
                          value={candidate.description}
                          onChange={(e) => updateCandidate(index, { description: e.target.value })}
                          className="h-8"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <aside className="hidden min-h-0 border-l bg-muted/20 lg:flex lg:flex-col">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Website Pages document</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={async () => {
                  await navigator.clipboard.writeText(previewContent);
                  toast({ title: 'Copied' });
                }}
                disabled={!previewContent.trim()}
              >
                <Copy className="h-3 w-3" /> Copy
              </Button>
            </div>
            <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 text-xs leading-relaxed">
              {previewContent || 'Run discovery to generate the Website Pages KB document.'}
            </pre>
          </aside>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post composer
// ---------------------------------------------------------------------------

function PostComposerView({ postId }: { postId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const workspaceId = params.get('workspace') || '';
  const { toast } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyStep, setBusyStep] = useState<PostStep | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [reviewReport, setReviewReport] = useState<string | null>(null);
  const [usageOverride, setUsageOverride] = useState<UsageMap | null>(null);
  // null until the first render computes a default from the post's state
  // (defaultTab below). After that, controlled by clicks + step completion.
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [liveMd, setLiveMd] = useState<string>('');
  const lastSentRef = useRef<{ html: string; md: string }>({ html: '', md: '' });

  async function load() {
    setLoading(true);
    try {
      const res = await getPost(postId);
      setPost(res.post);
    } catch (err) {
      toast({ title: 'Failed to load', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [postId]);
  // When the user navigates to a different post, drop any tab they had
  // selected on the previous one so the new post falls back to its
  // computed defaultTab (editor if drafted, outline if outlined, etc.).
  useEffect(() => { setActiveTab(null); }, [postId]);

  const initialHtml = useMemo(() => {
    if (!post) return '';
    if (post.body_html) return post.body_html;
    if (post.body_md) return markdownToHtml(post.body_md);
    return '';
  }, [post?.id, post?.body_md, post?.body_html]);

  // Map a pipeline step to the tab that displays its output, so clicking
  // the same step twice (or clicking on a step that's already been run)
  // can navigate to the result instead of regenerating it. Review keeps
  // its own tab; the rest map onto the existing Sources / Outline / Editor.
  const STEP_TO_TAB: Record<PostStep, string> = {
    research: 'sources',
    outline: 'outline',
    draft: 'editor',
    review: 'review',
  };

  async function runStep(step: PostStep, options: { force?: boolean } = {}) {
    if (!post) return;
    // If the step's output already exists, treat the click as navigation,
    // not regeneration. Spending tokens to redo work the user can already
    // see is the wrong default. A forced run comes from the deliberate
    // colored refresh button inside the step tab.
    const alreadyHas =
      (step === 'research' && !!post.sources_json) ||
      (step === 'outline' && !!post.outline_json) ||
      (step === 'draft' && (!!post.body_md || !!post.body_html));
    if (alreadyHas && !options.force) {
      setActiveTab(STEP_TO_TAB[step]);
      return;
    }
    setBusyStep(step);
    try {
      const res = await runPostStep(post.id, step);
      const qualityWarnings = res.quality_warnings || [];
      if (step === 'review') {
        setReviewReport(res.text);
      } else {
        setReviewReport(null);
        await load();
      }
      if (res.usage_all) setUsageOverride(res.usage_all);
      // Surface the freshly generated output by jumping to its tab.
      setActiveTab(STEP_TO_TAB[step]);
      // The worker flags the response as truncated when the model hit its
      // max_tokens limit. Surface that prominently so the user knows the
      // draft is incomplete instead of silently shipping a half post.
      const isTruncated = res.truncated === true;
      if (isTruncated) {
        toast({
          title: `${cap(step)} was cut off`,
          description: [
            'The model hit its output limit. Re-run the step or shorten the brief; the draft you see is incomplete.',
            ...qualityWarnings,
          ].join(' '),
          variant: 'destructive',
        });
      } else if (qualityWarnings.length) {
        toast({
          title: `${cap(step)} complete with cleanup`,
          description: qualityWarnings.join(' '),
        });
      } else {
        toast({
          title: `${cap(step)} complete`,
          description: options.force && (step === 'research' || step === 'outline')
            ? 'Downstream steps were reset so they can use the new output.'
            : undefined,
        });
      }
    } catch (err) {
      const errMsg = (err as Error)?.message || '';
      const isNetworkDrop =
        err instanceof TypeError ||
        /failed to fetch|networkerror|load failed|network request failed/i.test(errMsg);

      // The outline/draft worker calls can run for 60-120s when the model is
      // slow. Intermediaries (Cloudflare edge, corporate proxies, dropped
      // wifi) sometimes close the long-lived connection while the worker
      // keeps running and persists the result. When that happens the
      // browser sees a TypeError ("Failed to fetch") even though the step
      // succeeded server-side. Refetch the post and recover silently if the
      // output is already there (bug 0ac02a93).
      if (isNetworkDrop && (step === 'outline' || step === 'draft' || step === 'research')) {
        try {
          await new Promise((r) => setTimeout(r, 8000));
          const fresh = await getPost(post.id);
          const persisted =
            (step === 'research' && !!fresh.post.sources_json) ||
            (step === 'outline' && !!fresh.post.outline_json) ||
            (step === 'draft' && (!!fresh.post.body_md || !!fresh.post.body_html));
          if (persisted) {
            setPost(fresh.post);
            setActiveTab(STEP_TO_TAB[step]);
            toast({
              title: `${cap(step)} complete`,
              description: 'The connection dropped while the model was running, but your output was saved.',
            });
            return;
          }
        } catch { /* fall through to the friendlier error below */ }
        toast({
          title: `${cap(step)} timed out`,
          description: `The connection to the server dropped before ${step === 'research' ? 'research' : step === 'outline' ? 'the outline' : 'the draft'} finished. This usually clears up on a retry; click ${cap(step)} again.`,
          variant: 'destructive',
        });
        return;
      }

      toast({ title: `${cap(step)} failed`, description: errMsg, variant: 'destructive' });
    } finally {
      setBusyStep(null);
    }
  }

  async function handleEditorChange(html: string, md: string) {
    if (!post) return;
    setLiveMd(md);
    if (lastSentRef.current.html === html && lastSentRef.current.md === md) return;
    lastSentRef.current = { html, md };
    try {
      await updatePost(post.id, { body_html: html, body_md: md });
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      // surface only loud errors
      console.warn('autosave failed', err);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this post?')) return;
    try {
      await deletePost(postId);
      navigate(`/content-writer?view=workspace&workspace=${workspaceId}`);
    } catch (err) {
      toast({ title: 'Delete failed', description: (err as Error).message, variant: 'destructive' });
    }
  }

  if (loading || !post) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const brief = post.brief_json ? JSON.parse(post.brief_json) : {};
  const sources = post.sources_json ? safeJsonText(post.sources_json) : '';
  const outline = post.outline_json ? safeJsonText(post.outline_json) : '';
  const hasDraft = !!(post.body_md || post.body_html);
  const defaultTab = hasDraft ? 'editor' : outline ? 'outline' : 'sources';

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1 px-2" onClick={() => navigate(`/content-writer?view=workspace&workspace=${workspaceId}`)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{post.title || post.topic}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
              <Badge variant="secondary" className="font-medium capitalize">{post.status}</Badge>
              {post.target_keyword && (
                <>
                  <span className="text-muted-foreground/40">|</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="text-muted-foreground/70">Target</span>
                    <span className="font-medium text-foreground">{post.target_keyword}</span>
                  </span>
                </>
              )}
              <span className="text-muted-foreground/40">|</span>
              <PostMetaInline
                bodyMd={liveMd || post.body_md || ''}
                bodyHtml={post.body_html || ''}
                usage={usageOverride || (post.usage_json ? safeParse<UsageMap>(post.usage_json) : null)}
              />
              {savedAt && (
                <>
                  <span className="text-muted-foreground/40">|</span>
                  <span>Saved {savedAt}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ModelBadge />
          <Button
            variant="outline" size="sm" className="gap-1"
            onClick={async () => {
              const md = post.body_md || htmlToMarkdown(post.body_html || '');
              const ok = await copyAsRichText(md);
              toast({ title: ok ? 'Copied' : 'Copy failed', variant: ok ? 'default' : 'destructive' });
            }}
          ><Copy className="h-4 w-4" /> Copy</Button>
          <Button
            variant="outline" size="sm" className="gap-1"
            onClick={() => {
              const md = post.body_md || htmlToMarkdown(post.body_html || '');
              const blob = new Blob([md], { type: 'text/markdown' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `${(post.title || 'post').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          ><Download className="h-4 w-4" /> Download .md</Button>
          <Button variant="ghost" size="sm" onClick={handleDelete} className="gap-1 text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-[280px] flex-col gap-4 overflow-y-auto border-r p-4 lg:flex">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Brief</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs">
              {brief.topic && <p><span className="font-medium">Topic:</span> {brief.topic}</p>}
              {brief.target_keyword && <p><span className="font-medium">Keyword:</span> {brief.target_keyword}</p>}
              {brief.secondary_keywords && <p><span className="font-medium">Secondary:</span> {brief.secondary_keywords}</p>}
              {brief.takeaway && <p><span className="font-medium">Takeaway:</span> {brief.takeaway}</p>}
              {brief.notes && <p><span className="font-medium">Notes:</span> {brief.notes}</p>}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pipeline</p>
            {(() => {
              // Compute which step is the "next available" action so we can
              // glow it. The glow advances down the pipeline as the user
              // completes each step. Review intentionally does not glow —
              // it's an optional QA pass, not the natural happy-path exit.
              const nextStep: PostStep | null = !sources
                ? 'research'
                : !outline
                  ? 'outline'
                  : !post.body_md
                    ? 'draft'
                    : null;
              return (
                <>
                  <StepButton label="1. Research sources" step="research" busy={busyStep} run={runStep} highlight={nextStep === 'research'} />
                  <StepButton label="2. Outline" step="outline" busy={busyStep} run={runStep} disabled={!sources} highlight={nextStep === 'outline'} />
                  <StepButton label="3. Draft full post" step="draft" busy={busyStep} run={runStep} disabled={!outline} highlight={nextStep === 'draft'} />
                </>
              );
            })()}
            {busyStep ? (
              <div className="pt-1">
                <DraftProgressBar step={busyStep} active={true} />
              </div>
            ) : null}
            <Button variant="ghost" size="sm" className="w-full gap-1" onClick={load}>
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
          </div>
        </aside>

        <div className="flex flex-1 flex-col overflow-hidden">
          <Tabs
            value={activeTab ?? defaultTab}
            onValueChange={setActiveTab}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <TabsList className="mx-6 mt-4 self-start">
              <TabsTrigger value="sources">
                Sources {sources && <Badge variant="secondary" className="ml-2 px-1.5">{countItems(sources)}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="outline" disabled={!sources}>Outline</TabsTrigger>
              <TabsTrigger value="editor">Editor</TabsTrigger>
              {reviewReport && <TabsTrigger value="review">Review</TabsTrigger>}
            </TabsList>

            <TabsContent value="sources" className="flex-1 overflow-y-auto p-6 mt-0 data-[state=inactive]:hidden">
              <SourcesPanel
                postId={post.id}
                sourcesJson={post.sources_json}
                busy={busyStep}
                onSaved={load}
                onRerun={() => runStep('research', { force: true })}
                onContinue={() => runStep('outline')}
              />
            </TabsContent>

            <TabsContent value="outline" className="flex-1 overflow-y-auto p-6 mt-0 data-[state=inactive]:hidden">
              <OutlinePanel
                postId={post.id}
                outlineJson={post.outline_json}
                busy={busyStep}
                onSaved={load}
                onRerun={() => runStep('outline', { force: true })}
                onContinue={() => runStep('draft')}
              />
            </TabsContent>

            <TabsContent value="editor" className="flex-1 overflow-y-auto p-6 mt-0 data-[state=inactive]:hidden">
              {outline ? (
                <div className="mb-3 flex justify-end">
                  <StepRefreshButton
                    step="draft"
                    label={hasDraft ? 'Refresh draft' : 'Run draft'}
                    busy={busyStep}
                    onClick={() => runStep('draft', { force: true })}
                  />
                </div>
              ) : null}
              <PostEditor
                initialHtml={initialHtml}
                onChange={handleEditorChange}
                placeholder="Run the pipeline on the left to generate a draft, or start writing here."
              />
            </TabsContent>

            {reviewReport && (
              <TabsContent value="review" className="flex-1 overflow-y-auto p-6 mt-0 data-[state=inactive]:hidden">
                <Card>
                  <CardHeader><CardTitle className="text-base">Review report</CardTitle></CardHeader>
                  <CardContent>
                    <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: markdownToHtml(reviewReport) }} />
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sources panel (parses LLM output into checkable items)
// ---------------------------------------------------------------------------

interface SourceItem {
  id: string;
  label: string;
  url: string | null;
  summary: string;
  raw: string;
  approved: boolean;
}

interface CitationItem {
  url: string;
  title?: string;
  snippet?: string;
}

interface AiQuestionContext {
  source: 'chatgpt_fanout' | 'people_also_ask' | 'none';
  seed: string;
  questions: string[];
}

interface SourceSearchMetadata {
  model?: string;
  structured_citation_count?: number;
  ai_question_source?: string;
  ai_question_count?: number;
  excluded_terms?: string[];
  filtered_source_count?: number;
  generated_at?: string;
  [key: string]: unknown;
}

interface SourcesPayload {
  text: string;
  items?: SourceItem[];
  // Populated when the research step ran on a search-grounded model
  // (Perplexity Sonar Pro). These are canonical URLs returned by the
  // provider, independent of whatever the LLM wrote in `text`.
  citations?: CitationItem[];
  // The model that produced this research (e.g. "perplexity/sonar-pro").
  // Used by the UI to show a small badge so the user knows the sources
  // came from real search rather than the LLM's training data.
  model?: string;
  ai_questions?: AiQuestionContext;
  source_search?: SourceSearchMetadata;
}

// Merge structured Sonar citations into the parsed-from-text items list.
// Dedupes by URL so we don't show the same source twice if the LLM also
// linked it in its prose. Sonar items are pushed to the front since they're
// the authoritative web-search list.
function mergeCitationItems(parsed: SourceItem[], citations: CitationItem[]): SourceItem[] {
  if (!citations.length) return parsed;
  const seen = new Set<string>();
  const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase();
  const out: SourceItem[] = [];
  citations.forEach((c, idx) => {
    if (!c.url) return;
    const key = norm(c.url);
    if (seen.has(key)) return;
    seen.add(key);
    let label = c.title;
    if (!label) {
      try { label = new URL(c.url).hostname.replace(/^www\./, ''); } catch { label = c.url; }
    }
    out.push({
      id: `c${idx}`,
      label,
      url: c.url,
      summary: c.snippet || '',
      raw: c.title ? `${c.title} — ${c.url}` : c.url,
      approved: true,
    });
  });
  for (const item of parsed) {
    const key = item.url ? norm(item.url) : `__noUrl_${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parseSources(md: string): SourceItem[] {
  if (!md) return [];
  const out: SourceItem[] = [];
  let buffer: string[] = [];
  let counter = 0;
  const flush = () => {
    if (!buffer.length) return;
    const block = buffer.join(' ').trim();
    buffer = [];
    if (!block) return;
    const linkMatch = block.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    const bareUrl = block.match(/(https?:\/\/[^\s)\]]+)/);
    const url = linkMatch?.[2] || bareUrl?.[1] || null;
    let label = linkMatch?.[1];
    if (!label) {
      const bold = block.match(/\*\*([^*]+)\*\*/);
      label = bold?.[1];
    }
    if (!label && url) {
      try { label = new URL(url).hostname.replace(/^www\./, ''); } catch { label = url; }
    }
    if (!label) label = block.slice(0, 60);
    // Summary: anything after a colon or em-dash separator
    const sepMatch = block.match(/[:—]\s*(.+)$/);
    const summary = sepMatch ? sepMatch[1].replace(/\*\*/g, '').trim() : '';
    out.push({
      id: `s${counter++}`,
      label: label.replace(/\*\*/g, '').trim(),
      url,
      summary,
      raw: block,
      approved: true,
    });
  };
  for (const line of md.split('\n')) {
    const trimmed = line.trimStart();
    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flush();
      buffer.push(trimmed.replace(/^[-*]\s+|^\d+\.\s+/, ''));
    } else if (trimmed && buffer.length) {
      // continuation line of the current item
      buffer.push(trimmed);
    }
  }
  flush();
  return out;
}

function serializeSources(items: SourceItem[]): string {
  // Re-emit only approved items as a clean markdown bullet list. The worker's
  // outline step reads this `text` field, so unchecking removes a source from
  // downstream prompts.
  return items
    .filter((it) => it.approved)
    .map((it) => {
      if (it.url) return `- [${it.label}](${it.url})${it.summary ? `: ${it.summary}` : ''}`;
      return `- ${it.raw}`;
    })
    .join('\n');
}

function countItems(md: string): number {
  return (md.match(/^\s*[-*]\s+/gm) || []).length;
}

function SourcesPanel({ postId, sourcesJson, busy, onSaved, onRerun, onContinue }: {
  postId: string;
  sourcesJson: string | null;
  busy: PostStep | null;
  onSaved: () => void;
  onRerun: () => void;
  onContinue: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<SourceItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [researchModel, setResearchModel] = useState<string | undefined>(undefined);
  const [aiQuestions, setAiQuestions] = useState<AiQuestionContext | undefined>(undefined);
  const [sourceSearch, setSourceSearch] = useState<SourceSearchMetadata | undefined>(undefined);

  useEffect(() => {
    if (!sourcesJson) {
      setItems([]);
      setResearchModel(undefined);
      setAiQuestions(undefined);
      setSourceSearch(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(sourcesJson) as SourcesPayload;
      setResearchModel(parsed.model);
      setAiQuestions(parsed.ai_questions);
      setSourceSearch(parsed.source_search);
      if (parsed.items?.length) {
        // Already-saved curated list takes precedence — user has approved/edited it.
        setItems(parsed.items);
      } else if (parsed.citations && parsed.citations.length) {
        // When Sonar returned structured citations, those URLs are the
        // authoritative source list. Don't merge with the LLM's prose —
        // the prose was leaking stats/questions/etc. into the panel.
        setItems(mergeCitationItems([], parsed.citations));
      } else {
        // Legacy / fallback: only the older posts produced before we wired
        // citations through. Parse from prose as a last resort.
        setItems(parseSources(parsed.text || ''));
      }
    } catch {
      setItems([]);
      setResearchModel(undefined);
      setAiQuestions(undefined);
      setSourceSearch(undefined);
    }
    setDirty(false);
  }, [sourcesJson]);

  function toggle(id: string) {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, approved: !it.approved } : it));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const payload: SourcesPayload = {
        text: serializeSources(items),
        items,
        model: researchModel,
        ai_questions: aiQuestions,
        source_search: sourceSearch,
      };
      await updatePost(postId, { sources_json: JSON.stringify(payload) });
      setDirty(false);
      onSaved();
      toast({ title: 'Saved', description: `${items.filter((i) => i.approved).length} sources approved.` });
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (!items.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div>
            <h3 className="text-base font-semibold text-foreground">Research sources</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              No sources yet. Run research here or from the pipeline.
            </p>
          </div>
          <StepRefreshButton
            step="research"
            label="Run source research"
            busy={busy}
            onClick={onRerun}
          />
        </CardContent>
      </Card>
    );
  }

  const approvedCount = items.filter((i) => i.approved).length;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Approve sources</h3>
            {researchModel ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                via {researchModel}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {approvedCount} of {items.length} selected. Uncheck anything you don't want the writer to cite.
          </p>
          {aiQuestions?.questions?.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {aiQuestions.source === 'chatgpt_fanout' ? 'ChatGPT fan-out' : 'People Also Ask'} context captured:
              {' '}{aiQuestions.questions.length} question{aiQuestions.questions.length === 1 ? '' : 's'} for the outline.
            </p>
          ) : null}
          {sourceSearch ? (
            <div className="mt-1 space-y-1 text-xs text-muted-foreground">
              <p>
                Search metadata:{' '}
                {[
                  typeof sourceSearch.structured_citation_count === 'number' ? `${sourceSearch.structured_citation_count} structured citation${sourceSearch.structured_citation_count === 1 ? '' : 's'}` : null,
                  typeof sourceSearch.filtered_source_count === 'number' ? `${sourceSearch.filtered_source_count} filtered` : null,
                  typeof sourceSearch.ai_question_count === 'number' ? `${sourceSearch.ai_question_count} AI question${sourceSearch.ai_question_count === 1 ? '' : 's'}` : null,
                  sourceSearch.ai_question_source ? `questions from ${sourceSearch.ai_question_source}` : null,
                ].filter(Boolean).join(' · ') || 'captured'}
              </p>
              {sourceSearch.excluded_terms?.length ? (
                <p>Never-cite filters: {sourceSearch.excluded_terms.join(', ')}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <StepRefreshButton
            step="research"
            label="Refresh research"
            busy={busy}
            onClick={onRerun}
          />
          <Button
            variant="ghost" size="sm"
            onClick={() => { setItems((prev) => prev.map((it) => ({ ...it, approved: true }))); setDirty(true); }}
          >Select all</Button>
          <Button
            variant="ghost" size="sm"
            onClick={() => { setItems((prev) => prev.map((it) => ({ ...it, approved: false }))); setDirty(true); }}
          >Clear</Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Save selection
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {items.map((it) => (
          <Card
            key={it.id}
            className={`cursor-pointer transition-colors ${it.approved ? 'border-primary/30 bg-primary/5' : 'opacity-60'}`}
            onClick={() => toggle(it.id)}
          >
            <CardContent className="flex items-start gap-3 py-3">
              <Checkbox
                checked={it.approved}
                onCheckedChange={() => toggle(it.id)}
                onClick={(e) => e.stopPropagation()}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium leading-tight">{it.label}</p>
                  {it.url && (
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      <ExternalLink className="h-3 w-3" /> open
                    </a>
                  )}
                </div>
                {it.summary && <p className="mt-1 text-sm text-muted-foreground">{it.summary}</p>}
                {it.url && <p className="mt-1 truncate text-xs text-muted-foreground/70">{it.url}</p>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          onClick={onContinue}
          disabled={!!busy || dirty || approvedCount === 0}
          className="gap-1"
          title={dirty ? 'Save your selection first' : approvedCount === 0 ? 'Approve at least one source' : ''}
        >
          {busy === 'outline' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Continue to outline
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outline panel: structured editor for sections (title, type, notes)
// ---------------------------------------------------------------------------

type SectionType = 'capsule' | 'narrative' | 'table';

interface OutlineSection {
  id: string;
  title: string;
  type: SectionType;
  notes: string;
}

interface OutlineSettings {
  include_tldr: boolean;
  include_tables: boolean;
  include_faq: boolean;
  capsule_pct: number; // 0, 25, 50, 70, 100
}

const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  include_tldr: true,
  include_tables: true,
  include_faq: true,
  capsule_pct: 65,
};

interface OutlinePayload {
  text: string;
  sections?: OutlineSection[];
  // Free-form preamble (e.g., proposed title, intro notes) emitted by the LLM
  // before the first H2. Preserved on round-trip so we don't lose its content.
  preamble?: string;
  // Per-outline overrides for the draft step. Override the brief's defaults.
  settings?: OutlineSettings;
}

// Group labels older prompts encouraged the LLM to emit at the top of the
// outline (e.g. `1. **TL;DR block**`, `## H2s and H3s`). They aren't real
// sections — they're index headers — so we treat them as preamble noise
// instead of letting them become section #1 / #2 in the editor.
const OUTLINE_GROUP_LABELS = /^(tl[;:]?dr( block)?|h2s?( and h3s?)?|h3s?|sections?|body|introduction|outline)$/i;

function parseOutline(md: string): { sections: OutlineSection[]; preamble: string } {
  const sections: OutlineSection[] = [];
  const lines = (md || '').split('\n');
  let current: OutlineSection | null = null;
  let counter = 0;
  const preamble: string[] = [];
  const flush = () => { if (current) sections.push(current); current = null; };

  for (const raw of lines) {
    const line = raw;
    const trimmed = line.trim();
    if (!trimmed) {
      if (current) current.notes += current.notes ? '\n' : '';
      continue;
    }
    // Section heading patterns (in priority order). We accept several shapes
    // because LLMs vary: clean H2, "### H2: title", bold "**H2:** title",
    // bare "H2: title", numbered/bulleted bold lists.
    const h2 = trimmed.match(/^##\s+(.+)$/);
    const h3LabelledH2 = trimmed.match(/^#{2,4}\s*H2[:\s]+(.+)$/i);
    const boldLabelledH2 = trimmed.match(/^\*\*H2[:\s]*\*\*[:\s]*(.+)$/i);
    const bareLabelledH2 = trimmed.match(/^H2[:\s]+(.+)$/i);
    const numbered = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*(.*)$/);
    const bulletBold = trimmed.match(/^[-*]\s+\*\*(.+?)\*\*(.*)$/);

    let titleRaw: string | null = null;
    if (h2) titleRaw = h2[1];
    else if (h3LabelledH2) titleRaw = h3LabelledH2[1];
    else if (boldLabelledH2) titleRaw = boldLabelledH2[1];
    else if (bareLabelledH2) titleRaw = bareLabelledH2[1];
    else if (numbered) titleRaw = numbered[1] + (numbered[2] || '');
    else if (bulletBold) titleRaw = bulletBold[1] + (bulletBold[2] || '');

    // Drop noise: bare group labels ("TL;DR block", "H2s and H3s") aren't
    // real sections. Treat them as preamble so they don't pollute the list.
    if (titleRaw !== null) {
      const stripped = titleRaw
        .replace(/\[(CAPSULE|TABLE|H3)\]/gi, '')
        .replace(/\*\*/g, '')
        .replace(/^[:\s]+|[:\s]+$/g, '')
        .trim();
      if (OUTLINE_GROUP_LABELS.test(stripped)) {
        // Skip — don't open a new section, don't append as note.
        continue;
      }
    }

    if (titleRaw !== null) {
      flush();
      let type: SectionType = 'narrative';
      if (/\[CAPSULE\]/i.test(titleRaw)) type = 'capsule';
      else if (/\[TABLE\]/i.test(titleRaw)) type = 'table';
      const cleanTitle = titleRaw
        .replace(/\[(CAPSULE|TABLE|H3)\]/gi, '')
        .replace(/\*\*/g, '')
        .replace(/^[:\s]+|[:\s]+$/g, '')
        .trim();
      current = { id: `o${counter++}`, title: cleanTitle, type, notes: '' };
    } else if (current) {
      const note = trimmed.replace(/^[-*]\s*/, '').replace(/^Notes?:\s*/i, '');
      current.notes = current.notes ? `${current.notes}\n${note}` : note;
    } else {
      preamble.push(trimmed);
    }
  }
  flush();
  return { sections, preamble: preamble.join('\n').trim() };
}

function serializeOutline(sections: OutlineSection[], preamble?: string): string {
  const out: string[] = [];
  if (preamble && preamble.trim()) {
    out.push(preamble.trim(), '');
  }
  for (const s of sections) {
    const marker = s.type === 'capsule' ? ' [CAPSULE]' : s.type === 'table' ? ' [TABLE]' : '';
    out.push(`## ${s.title.trim()}${marker}`);
    if (s.notes && s.notes.trim()) {
      const noteLines = s.notes.trim().split('\n').map((l) => l.trim()).filter(Boolean);
      for (const nl of noteLines) {
        out.push(nl.startsWith('- ') ? nl : `- ${nl}`);
      }
    }
    out.push('');
  }
  return out.join('\n').trim();
}

function OutlinePanel({ postId, outlineJson, busy, onSaved, onRerun, onContinue }: {
  postId: string;
  outlineJson: string | null;
  busy: PostStep | null;
  onSaved: () => void;
  onRerun: () => void;
  onContinue: () => void;
}) {
  const { toast } = useToast();
  const [sections, setSections] = useState<OutlineSection[]>([]);
  const [preamble, setPreamble] = useState('');
  const [settings, setSettings] = useState<OutlineSettings>(DEFAULT_OUTLINE_SETTINGS);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!outlineJson) { setSections([]); setPreamble(''); setSettings(DEFAULT_OUTLINE_SETTINGS); setDirty(false); return; }
    try {
      const parsed = JSON.parse(outlineJson) as OutlinePayload;
      if (parsed.sections?.length) {
        setSections(parsed.sections);
        setPreamble(parsed.preamble || '');
      } else {
        const p = parseOutline(parsed.text || '');
        setSections(p.sections);
        setPreamble(p.preamble);
      }
      setSettings({ ...DEFAULT_OUTLINE_SETTINGS, ...(parsed.settings || {}) });
      setDirty(false);
    } catch {
      setSections([]);
      setPreamble('');
      setSettings(DEFAULT_OUTLINE_SETTINGS);
    }
  }, [outlineJson]);

  function updateSetting<K extends keyof OutlineSettings>(key: K, value: OutlineSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function update(id: string, patch: Partial<OutlineSection>) {
    setSections((prev) => prev.map((s) => s.id === id ? { ...s, ...patch } : s));
    setDirty(true);
  }
  function move(id: string, dir: -1 | 1) {
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const swap = idx + dir;
      if (swap < 0 || swap >= prev.length) return prev;
      const copy = prev.slice();
      [copy[idx], copy[swap]] = [copy[swap], copy[idx]];
      return copy;
    });
    setDirty(true);
  }
  function remove(id: string) {
    setSections((prev) => prev.filter((s) => s.id !== id));
    setDirty(true);
  }
  function addSection(type: SectionType = 'capsule') {
    setSections((prev) => [
      ...prev,
      { id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: 'New section', type, notes: '' },
    ]);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const payload: OutlinePayload = {
        text: serializeOutline(sections, preamble),
        sections,
        preamble,
        settings,
      };
      await updatePost(postId, { outline_json: JSON.stringify(payload) });
      setDirty(false);
      onSaved();
      toast({ title: 'Outline saved' });
    } catch (err) {
      toast({ title: 'Save failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  if (!outlineJson) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div>
            <h3 className="text-base font-semibold text-foreground">Outline</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              No outline yet. Approve sources, then run the outline step.
            </p>
          </div>
          <StepRefreshButton
            step="outline"
            label="Run outline"
            busy={busy}
            onClick={onRerun}
          />
        </CardContent>
      </Card>
    );
  }

  const tableCount = sections.filter((s) => s.type === 'table').length;
  const capsuleCount = sections.filter((s) => s.type === 'capsule').length;
  const capsulePct = sections.length ? Math.round((capsuleCount / sections.length) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">Outline</h3>
          <p className="text-sm text-muted-foreground">
            {sections.length} sections · {capsuleCount} capsule ({capsulePct}%) · {tableCount} table
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StepRefreshButton
            step="outline"
            label="Refresh outline"
            busy={busy}
            onClick={onRerun}
          />
          <Button variant="ghost" size="sm" onClick={() => addSection('capsule')} className="gap-1">
            <Plus className="h-4 w-4" /> Add section
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Save outline
          </Button>
        </div>
      </div>

      <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-1.5 shadow-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs">
              <Switch
                id="tldr-switch"
                checked={settings.include_tldr}
                onCheckedChange={(v) => updateSetting('include_tldr', v)}
                className="data-[state=checked]:!bg-sky-500 data-[state=unchecked]:!bg-sky-100"
              />
              <label htmlFor="tldr-switch" className="cursor-pointer font-medium text-sky-900">TL;DR</label>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[220px] text-xs">
            Adds a short "Too long; didn't read" summary block at the top of the post for quick scanning.
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-xs">
              <Switch
                id="tables-switch"
                checked={settings.include_tables}
                onCheckedChange={(v) => updateSetting('include_tables', v)}
                className="data-[state=checked]:!bg-violet-500 data-[state=unchecked]:!bg-violet-100"
              />
              <label htmlFor="tables-switch" className="cursor-pointer font-medium text-violet-900">Tables</label>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[220px] text-xs">
            Lets the writer use comparison tables where they fit (pricing, feature matrices, pros/cons).
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs">
              <Switch
                id="faq-switch"
                checked={settings.include_faq}
                onCheckedChange={(v) => updateSetting('include_faq', v)}
                className="data-[state=checked]:!bg-amber-500 data-[state=unchecked]:!bg-amber-100"
              />
              <label htmlFor="faq-switch" className="cursor-pointer font-medium text-amber-900">FAQ</label>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[240px] text-xs">
            Adds a five-question FAQ at the end of the post covering questions the body didn't answer (great for AI Overviews and PAA).
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex w-[210px] items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs">
              <span className="font-medium text-emerald-900">Capsule</span>
              <Slider
                value={[settings.capsule_pct]}
                min={0}
                max={100}
                step={5}
                onValueChange={(v) => updateSetting('capsule_pct', v[0] ?? 0)}
                className="flex-1"
                trackClassName="bg-emerald-100"
                rangeClassName="bg-emerald-500"
                thumbClassName="border-emerald-500"
              />
              <span className="w-9 text-right text-xs font-semibold tabular-nums text-emerald-900">
                {settings.capsule_pct}%
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs">
            Percentage of H2 sections written as answer capsules (direct one-paragraph answer up top, supporting detail below). Higher = more AI-overview friendly.
          </TooltipContent>
        </Tooltip>
      </div>

      {preamble && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs uppercase tracking-wide text-muted-foreground">Title / preamble</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              value={preamble}
              onChange={(e) => { setPreamble(e.target.value); setDirty(true); }}
              rows={2}
              className="text-sm"
            />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {sections.map((s, i) => (
          <Card key={s.id} className={s.type === 'table' ? 'border-amber-500/40' : s.type === 'capsule' ? 'border-primary/30' : ''}>
            <CardContent className="space-y-2 py-3">
              <div className="flex items-start gap-2">
                <span className="mt-2 text-xs font-mono text-muted-foreground">{i + 1}.</span>
                <Input
                  value={s.title}
                  onChange={(e) => update(s.id, { title: e.target.value })}
                  className="flex-1 font-medium"
                  placeholder="Section heading (H2)"
                />
                <select
                  value={s.type}
                  onChange={(e) => update(s.id, { type: e.target.value as SectionType })}
                  className="h-9 rounded-md border bg-background px-2 text-xs"
                  title="Section format"
                >
                  <option value="capsule">Capsule (Q&A)</option>
                  <option value="narrative">Narrative</option>
                  <option value="table">Table</option>
                </select>
                <div className="flex items-center">
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => move(s.id, -1)} disabled={i === 0} title="Move up">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0" onClick={() => move(s.id, 1)} disabled={i === sections.length - 1} title="Move down">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-destructive" onClick={() => remove(s.id)} title="Remove">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <Textarea
                value={s.notes}
                onChange={(e) => update(s.id, { notes: e.target.value })}
                rows={2}
                placeholder={s.type === 'table' ? 'What columns and rows? Which sources fill them?' : 'What does this section cover? Which source backs each claim?'}
                className="text-sm"
              />
              {s.type === 'table' && (
                <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
                  <Table2 className="h-3 w-3" /> Renders as a markdown table in the draft.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
        {sections.length === 0 && (
          <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">No sections. Click "Add section" to start.</CardContent></Card>
        )}
      </div>

      <div className="flex justify-between border-t pt-4">
        <Button variant="ghost" onClick={() => addSection('capsule')} className="gap-1">
          <Plus className="h-4 w-4" /> Add another section
        </Button>
        <Button
          onClick={onContinue}
          disabled={!!busy || dirty || sections.length === 0}
          className="gap-1"
          title={dirty ? 'Save your edits first' : sections.length === 0 ? 'Add at least one section' : ''}
        >
          {busy === 'draft' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Continue to draft
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor footer: live word count + approximate draft cost
// ---------------------------------------------------------------------------

// Approximate USD prices per 1M tokens. Sources: provider pricing pages and
// openrouter.ai/models as of 2026-04. Update as new models ship. Lookup is
// substring-based (`model.includes(key)`) so an OpenRouter ID like
// "deepseek/deepseek-v4-pro" matches the bare key "deepseek-v4-pro". Unknown
// models still fall back to null and we just show the token count.
const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  // OpenRouter — Perplexity (research)
  'perplexity/sonar-pro': { in: 3, out: 15 },
  'perplexity/sonar-reasoning-pro': { in: 2, out: 8 },
  'perplexity/sonar': { in: 1, out: 1 },
  // OpenRouter — DeepSeek (writer). Order matters: more specific keys first
  // because lookup is substring-based and otherwise "v3.2" would shadow
  // "v3.2-exp".
  'deepseek/deepseek-v4-pro': { in: 0.435, out: 0.87 },
  'deepseek/deepseek-v4-flash': { in: 0.14, out: 0.28 },
  'deepseek/deepseek-v3.2-exp': { in: 0.27, out: 0.41 },
  'deepseek/deepseek-v3.2': { in: 0.252, out: 0.378 },
  // OpenRouter — Moonshot Kimi
  'moonshotai/kimi-k2.6': { in: 0.7448, out: 4.655 },
  'moonshotai/kimi-k2.5': { in: 0.65, out: 2.6 },
  'moonshotai/kimi-k2-thinking': { in: 0.6, out: 2.5 },
  'moonshotai/kimi-k2': { in: 0.57, out: 2.3 },
  // OpenRouter — MiniMax
  'minimax/minimax-m2.7': { in: 0.3, out: 1.2 },
  'minimax/minimax-m2.5': { in: 0.15, out: 1.15 },
  'minimax/minimax-m2': { in: 0.255, out: 1.0 },
  // OpenRouter — others on the Settings list
  'qwen/qwen3-235b-a22b-2507': { in: 0.07, out: 0.10 },
  'openai/gpt-5.3-chat': { in: 1.75, out: 14 },
  'openai/gpt-4.1-nano': { in: 0.10, out: 0.40 },
  'openai/gpt-5-nano': { in: 0.05, out: 0.40 },
  // Anthropic (direct)
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-7': { in: 15, out: 75 },
  'claude-haiku-4-5-20251001': { in: 0.8, out: 4 },
  // OpenAI (direct)
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  // Google
  'gemini-2.0-flash': { in: 0.075, out: 0.3 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
};

function estimateCost(usage: StepUsage | null): { usd: number | null; key: string | null } {
  if (!usage) return { usd: null, key: null };
  const model = usage.model || '';
  // Try exact match, then prefix match (e.g., openrouter prefixes)
  let price = MODEL_PRICING[model];
  if (!price) {
    const key = Object.keys(MODEL_PRICING).find((k) => model.includes(k));
    if (key) price = MODEL_PRICING[key];
  }
  if (!price) return { usd: null, key: model || null };
  const usd = (usage.input_tokens / 1_000_000) * price.in + (usage.output_tokens / 1_000_000) * price.out;
  return { usd, key: model };
}

function countWordsFromMarkdown(s: string): number {
  if (!s) return 0;
  // Strip markdown link URLs and basic markup so word count reflects readable text.
  const cleaned = s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(' ').length;
}

function countWordsFromHtml(s: string): number {
  if (!s) return 0;
  // Strip tags and decode the most common entities, then split on whitespace.
  // Robust enough for editor output; we don't need a full DOMParser here.
  const cleaned = s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(' ').length;
}

// Prefer markdown when available (cleaner signal: no editor wrappers,
// captions, etc.); fall back to HTML so legacy posts and freshly-loaded
// drafts whose md hasn't round-tripped through the editor yet still count.
function countWords(bodyMd: string, bodyHtml: string): number {
  const fromMd = countWordsFromMarkdown(bodyMd);
  if (fromMd > 0) return fromMd;
  return countWordsFromHtml(bodyHtml);
}

function PostMetaInline({ bodyMd, bodyHtml, usage }: { bodyMd: string; bodyHtml: string; usage: UsageMap | null }) {
  const words = countWords(bodyMd, bodyHtml);
  const minutes = Math.max(1, Math.round(words / 230));
  const breakdown: { step: PostStep; usd: number | null; tokens: number; model: string | null }[] = [];
  let total = 0;
  let anyUnknown = false;
  if (usage) {
    for (const step of ['research', 'outline', 'draft', 'review'] as PostStep[]) {
      const u = usage[step];
      if (!u) continue;
      const c = estimateCost(u);
      if (c.usd !== null) total += c.usd; else anyUnknown = true;
      breakdown.push({
        step,
        usd: c.usd,
        tokens: (u.input_tokens || 0) + (u.output_tokens || 0),
        model: u.model || null,
      });
    }
  }
  const totalLabel = breakdown.length === 0
    ? null
    : (anyUnknown && total === 0)
      ? 'unknown model'
      : `$${total < 0.01 ? total.toFixed(4) : total.toFixed(3)}${anyUnknown ? '+' : ''}`;
  const tooltip = breakdown
    .map((b) => `${cap(b.step)}: ${b.usd !== null ? '$' + (b.usd < 0.01 ? b.usd.toFixed(4) : b.usd.toFixed(3)) : '?'} (${b.tokens.toLocaleString()} tok${b.model ? ' · ' + b.model : ''})`)
    .join(' | ');
  return (
    <>
      <span><strong className="text-foreground">{words.toLocaleString()}</strong> words · ~{minutes} min read</span>
      {totalLabel && (
        <span title={tooltip}>
          Cost: <strong className="text-foreground">{totalLabel}</strong>
          <span className="ml-1 text-muted-foreground/70">({breakdown.map((b) => b.step[0].toUpperCase()).join('+')})</span>
        </span>
      )}
    </>
  );
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

const STEP_REFRESH_STYLES: Record<PostStep, string> = {
  research: 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 hover:text-sky-900 dark:border-sky-500/40 dark:bg-sky-950/30 dark:text-sky-200 dark:hover:bg-sky-950/50',
  outline: 'border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 hover:text-violet-900 dark:border-violet-500/40 dark:bg-violet-950/30 dark:text-violet-200 dark:hover:bg-violet-950/50',
  draft: 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50',
  review: 'border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 hover:text-rose-900 dark:border-rose-500/40 dark:bg-rose-950/30 dark:text-rose-200 dark:hover:bg-rose-950/50',
};

function StepRefreshButton({ step, label, busy, onClick }: {
  step: PostStep;
  label: string;
  busy: PostStep | null;
  onClick: () => void;
}) {
  const isBusy = busy === step;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={`gap-1.5 shadow-sm ${STEP_REFRESH_STYLES[step]}`}
      disabled={!!busy}
      onClick={onClick}
      title={busy && !isBusy ? 'Wait for the current step to finish' : undefined}
    >
      {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
      {isBusy ? `Refreshing ${step}` : label}
    </Button>
  );
}

function StepButton({ label, step, busy, run, disabled, highlight }: {
  label: string;
  step: PostStep;
  busy: PostStep | null;
  run: (s: PostStep) => void;
  disabled?: boolean;
  // When true, render the button with a soft green glow + breathing
  // animation. Used to indicate the next action in the pipeline so a
  // user landing on a fresh post knows where to click.
  highlight?: boolean;
}) {
  const isBusy = busy === step;
  // Don't glow while another step is running (visual noise) or when this
  // step itself is busy. Once highlighted is consumed, the parent will
  // recompute and the next step picks up the glow.
  const showGlow = highlight && !busy && !disabled;
  return (
    <Button
      variant="outline"
      size="sm"
      className={`w-full justify-start gap-2 ${showGlow ? 'cw-glow-next' : ''}`}
      disabled={!!busy || disabled}
      onClick={() => run(step)}
      title={disabled ? 'Run the previous step first' : ''}
    >
      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      {label}
    </Button>
  );
}

function safeJsonText(s: string): string {
  try { return (JSON.parse(s) as { text?: string }).text || ''; } catch { return ''; }
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
