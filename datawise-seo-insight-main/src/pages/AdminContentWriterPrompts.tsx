import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  FileText,
  GitBranch,
  History,
  ListChecks,
  Loader2,
  Lock,
  MousePointer2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  Shield,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchContentWriterPrompts,
  publishContentWriterPrompt,
  renderContentWriterPrompt,
  resetContentWriterPrompt,
  saveContentWriterPromptDraft,
  type ContentWriterPromptRegistryItem,
  type PromptPreviewRequest,
  type PromptPreviewResponse,
} from '@/lib/admin';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type PreviewMode = NonNullable<PromptPreviewRequest['mode']>;
type PreviewStep = NonNullable<PromptPreviewRequest['step']>;
type PreviewDocType = NonNullable<PromptPreviewRequest['doc_type']>;

interface FlowNode {
  id: string;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  w: number;
  h: number;
  icon: typeof Database;
  promptKeys: string[];
  inputs: string[];
  outputs: string[];
  accent: string;
}

interface FlowEdge {
  from: string;
  to: string;
  label: string;
}

const DOC_TYPES: PreviewDocType[] = ['sitemap', 'tone_of_voice', 'experience_notes', 'service_details', 'brand_guidelines'];
const STEPS: PreviewStep[] = ['research', 'outline', 'draft', 'review'];

const DOC_LABELS: Record<PreviewDocType, string> = {
  sitemap: 'Website Pages',
  tone_of_voice: 'Tone of Voice',
  experience_notes: 'Experience Notes',
  service_details: 'Offer Details',
  brand_guidelines: 'Brand Guidelines',
};

const FLOW_NODES: FlowNode[] = [
  {
    id: 'kb-interviews',
    title: 'KB Interviews',
    subtitle: 'Collect custom knowledge',
    x: 40,
    y: 70,
    w: 210,
    h: 128,
    icon: Database,
    promptKeys: [
      'interview.sitemap.system',
      'interview.tone_of_voice.system',
      'interview.experience_notes.system',
      'interview.service_details.system',
      'interview.brand_guidelines.system',
    ],
    inputs: ['Website URL', 'Scraped context', 'User answers'],
    outputs: ['Interview transcripts'],
    accent: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
  },
  {
    id: 'kb-finalizers',
    title: 'KB Finalizers',
    subtitle: 'Structure the transcripts',
    x: 300,
    y: 70,
    w: 210,
    h: 128,
    icon: FileText,
    promptKeys: [
      'finalize.sitemap.user',
      'finalize.tone_of_voice.user',
      'finalize.experience_notes.user',
      'finalize.service_details.user',
      'finalize.brand_guidelines.user',
    ],
    inputs: ['Crawled page evidence', 'Interview transcripts'],
    outputs: ['Ready KB docs'],
    accent: 'border-cyan-300 bg-cyan-50 text-cyan-900 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100',
  },
  {
    id: 'kb-auto-draft',
    title: 'Website KB Auto-Draft',
    subtitle: 'Draft docs from crawl',
    x: 300,
    y: 520,
    w: 230,
    h: 128,
    icon: Sparkles,
    promptKeys: [
      'discovery.sitemap.user',
      'auto_draft.tone_of_voice.user',
      'auto_draft.service_details.user',
      'auto_draft.brand_guidelines.user',
    ],
    inputs: ['Website URL', 'Crawled evidence', 'Sonar fallback'],
    outputs: ['Reviewable KB drafts'],
    accent: 'border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100',
  },
  {
    id: 'context',
    title: 'Writer Context',
    subtitle: 'Derive placeholders',
    x: 560,
    y: 70,
    w: 220,
    h: 128,
    icon: GitBranch,
    promptKeys: ['post.master.system', 'notes.kb-assembly'],
    inputs: ['Workspace', 'Brief', 'Ready KB docs'],
    outputs: ['{{business_name}}', '{{industry}}', '{{service_area}}'],
    accent: 'border-indigo-300 bg-indigo-50 text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100',
  },
  {
    id: 'research',
    title: 'Research + Source Search',
    subtitle: 'Find external support',
    x: 810,
    y: 70,
    w: 210,
    h: 128,
    icon: Search,
    promptKeys: ['post.step.research.system', 'post.step.research.user', 'notes.source-search', 'notes.ai-question-enrichment'],
    inputs: ['Brief', 'Context placeholders', 'Never-cite terms'],
    outputs: ['Structured citations', 'AI questions', 'Source metadata'],
    accent: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
  },
  {
    id: 'approval',
    title: 'Source Approval',
    subtitle: 'Human curation gate',
    x: 810,
    y: 300,
    w: 210,
    h: 128,
    icon: CheckCircle2,
    promptKeys: ['notes.source-search'],
    inputs: ['Structured citations', 'Filtered competitors'],
    outputs: ['Approved sources'],
    accent: 'border-lime-300 bg-lime-50 text-lime-900 dark:border-lime-800 dark:bg-lime-950/40 dark:text-lime-100',
  },
  {
    id: 'outline',
    title: 'Outline',
    subtitle: 'Plan sections and facts',
    x: 560,
    y: 300,
    w: 220,
    h: 128,
    icon: ListChecks,
    promptKeys: ['post.step.outline.system', 'post.step.outline.user'],
    inputs: ['Approved sources', 'AI questions', 'KB context'],
    outputs: ['Approved outline'],
    accent: 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100',
  },
  {
    id: 'draft',
    title: 'Draft',
    subtitle: 'Write the article',
    x: 300,
    y: 300,
    w: 210,
    h: 128,
    icon: Sparkles,
    promptKeys: ['post.master.system', 'post.step.draft.system', 'post.step.draft.user'],
    inputs: ['Approved outline', 'Approved sources', 'KB context'],
    outputs: ['Markdown body'],
    accent: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  },
  {
    id: 'review',
    title: 'Review',
    subtitle: 'QA the draft',
    x: 40,
    y: 300,
    w: 210,
    h: 128,
    icon: Eye,
    promptKeys: ['post.step.review.system', 'post.step.review.user'],
    inputs: ['Markdown body', 'Checklist', 'Brand rules'],
    outputs: ['Review report', 'Corrected draft if needed'],
    accent: 'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
  },
  {
    id: 'cleanup',
    title: 'Cleanup + Persist',
    subtitle: 'Repair obvious artifacts',
    x: 560,
    y: 520,
    w: 250,
    h: 128,
    icon: Settings2,
    promptKeys: ['notes.post-processing'],
    inputs: ['Draft/review output'],
    outputs: ['Saved clean content', 'Quality warnings'],
    accent: 'border-slate-300 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
  },
];

const FLOW_EDGES: FlowEdge[] = [
  { from: 'kb-interviews', to: 'kb-finalizers', label: 'transcripts' },
  { from: 'context', to: 'kb-auto-draft', label: 'website evidence' },
  { from: 'kb-auto-draft', to: 'kb-finalizers', label: 'reviewed drafts' },
  { from: 'kb-finalizers', to: 'context', label: 'ready KB docs' },
  { from: 'context', to: 'research', label: 'placeholders + exclusions' },
  { from: 'research', to: 'approval', label: 'source candidates' },
  { from: 'approval', to: 'outline', label: 'approved sources' },
  { from: 'context', to: 'outline', label: 'custom knowledge' },
  { from: 'outline', to: 'draft', label: 'approved outline' },
  { from: 'context', to: 'draft', label: 'writer identity' },
  { from: 'draft', to: 'review', label: 'markdown body' },
  { from: 'review', to: 'cleanup', label: 'checked output' },
];

function promptEditorText(prompt: ContentWriterPromptRegistryItem | null): string {
  if (!prompt) return '';
  return prompt.config?.draft_text ?? prompt.effective.text ?? prompt.defaultText;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function promptStatus(prompt: ContentWriterPromptRegistryItem) {
  if (!prompt.editable) return { label: 'Read-only', variant: 'outline' as const, icon: Lock };
  if (prompt.effective.source === 'published') return { label: `Published v${prompt.effective.publishedVersion}`, variant: 'default' as const, icon: CheckCircle2 };
  return { label: 'Code default', variant: 'secondary' as const, icon: FileText };
}

function inferPreviewTarget(promptKey: string): Pick<PromptPreviewRequest, 'mode' | 'step' | 'doc_type'> {
  if (promptKey === 'discovery.sitemap.user') return { mode: 'website_pages_discovery', doc_type: 'sitemap' };
  const autoDraft = promptKey.match(/^auto_draft\.([^.]+)\.user$/);
  if (autoDraft && DOC_TYPES.includes(autoDraft[1] as PreviewDocType)) return { mode: 'kb_auto_draft', doc_type: autoDraft[1] as PreviewDocType };

  const interview = promptKey.match(/^interview\.([^.]+)\.system$/);
  if (interview && DOC_TYPES.includes(interview[1] as PreviewDocType)) return { mode: 'interview', doc_type: interview[1] as PreviewDocType };

  const finalize = promptKey.match(/^finalize\.([^.]+)\.user$/);
  if (finalize && DOC_TYPES.includes(finalize[1] as PreviewDocType)) return { mode: 'finalize', doc_type: finalize[1] as PreviewDocType };

  const step = promptKey.match(/^post\.step\.([^.]+)\./);
  if (step && STEPS.includes(step[1] as PreviewStep)) return { mode: 'post_step', step: step[1] as PreviewStep };

  if (promptKey.includes('source-search') || promptKey.includes('ai-question')) return { mode: 'post_step', step: 'research' };
  if (promptKey.includes('post-processing')) return { mode: 'post_step', step: 'review' };
  return { mode: 'post_step', step: 'draft' };
}

function nodeForPrompt(promptKey: string): FlowNode | undefined {
  return FLOW_NODES.find((node) => node.promptKeys.includes(promptKey));
}

function labelStep(step: PreviewStep): string {
  return step.charAt(0).toUpperCase() + step.slice(1);
}

export default function AdminContentWriterPrompts() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();

  const [prompts, setPrompts] = useState<ContentWriterPromptRegistryItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState('context');
  const [selectedKey, setSelectedKey] = useState('post.master.system');
  const [draftText, setDraftText] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PromptPreviewResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'template' | 'resolved' | 'render' | 'history'>('template');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('post_step');
  const [previewStep, setPreviewStep] = useState<PreviewStep>('draft');
  const [previewDocType, setPreviewDocType] = useState<PreviewDocType>('sitemap');
  const [previewPostId, setPreviewPostId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchContentWriterPrompts();
      setPrompts(data.prompts);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Failed to load writer prompts', description: (err as Error).message });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const promptMap = useMemo(() => new Map(prompts.map((prompt) => [prompt.key, prompt])), [prompts]);
  const selectedNode = FLOW_NODES.find((node) => node.id === selectedNodeId) || FLOW_NODES[0];
  const selectedPrompt = promptMap.get(selectedKey) || null;
  const nodePrompts = selectedNode.promptKeys
    .map((key) => promptMap.get(key))
    .filter((prompt): prompt is ContentWriterPromptRegistryItem => !!prompt);

  const filteredPrompts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return prompts.filter((prompt) => [
      prompt.key,
      prompt.label,
      prompt.description,
      ...(prompt.placeholders || []),
    ].some((value) => value.toLowerCase().includes(needle))).slice(0, 8);
  }, [prompts, query]);

  useEffect(() => {
    setDraftText(promptEditorText(selectedPrompt));
  }, [selectedPrompt?.key, selectedPrompt?.config?.draft_text, selectedPrompt?.effective.text]);

  function selectNode(nodeId: string) {
    const node = FLOW_NODES.find((item) => item.id === nodeId);
    if (!node) return;
    setSelectedNodeId(node.id);
    if (!node.promptKeys.includes(selectedKey)) selectPrompt(node.promptKeys[0]);
  }

  function selectPrompt(promptKey: string) {
    setSelectedKey(promptKey);
    const owner = nodeForPrompt(promptKey);
    if (owner) setSelectedNodeId(owner.id);
    const inferred = inferPreviewTarget(promptKey);
    if (inferred.mode) setPreviewMode(inferred.mode);
    if (inferred.step) setPreviewStep(inferred.step);
    if (inferred.doc_type) setPreviewDocType(inferred.doc_type);
  }

  const loadedDraftText = promptEditorText(selectedPrompt);
  const draftDirty = !!selectedPrompt?.editable && draftText !== loadedDraftText;
  const canPublish = !!selectedPrompt?.editable && !!draftText.trim() && !saving;

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Copy failed', description: (err as Error).message });
    }
  }

  async function persistDraft(prompt = selectedPrompt) {
    if (!prompt?.editable) return;
    await saveContentWriterPromptDraft(prompt.key, draftText);
  }

  async function saveDraft() {
    if (!selectedPrompt?.editable) return;
    setSaving(true);
    try {
      await persistDraft();
      await load();
      toast({ title: 'Draft saved', description: 'Published generation is unchanged until you publish.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Save failed', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function publishDraft() {
    if (!selectedPrompt?.editable) return;
    setSaving(true);
    try {
      await persistDraft();
      const res = await publishContentWriterPrompt(selectedPrompt.key);
      await load();
      toast({ title: `Published v${res.version}`, description: 'New writer runs will use this prompt.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Publish failed', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function resetPrompt() {
    if (!selectedPrompt?.editable) return;
    const ok = confirm('Reset this prompt to the code default? Draft and published override will be cleared.');
    if (!ok) return;
    setSaving(true);
    try {
      await resetContentWriterPrompt(selectedPrompt.key);
      await load();
      toast({ title: 'Prompt reset', description: 'The code default is effective again.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Reset failed', description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function renderPreview(next?: Partial<PromptPreviewRequest>, tab: 'resolved' | 'render' = 'render') {
    setPreviewLoading(true);
    setActiveTab(tab);
    try {
      const mode = (next?.mode || previewMode) as PreviewMode;
      const req: PromptPreviewRequest = {
        mode,
        step: mode === 'post_step' ? ((next?.step || previewStep) as PreviewStep) : undefined,
        doc_type: mode === 'post_step' ? undefined : mode === 'website_pages_discovery' ? 'sitemap' : ((next?.doc_type || previewDocType) as PreviewDocType),
        post_id: previewPostId.trim() || undefined,
      };
      const res = await renderContentWriterPrompt(req);
      setPreview(res);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Preview failed', description: (err as Error).message });
    } finally {
      setPreviewLoading(false);
    }
  }

  const resolvedText = useMemo(() => {
    if (!preview || !selectedPrompt) return '';
    if (selectedPrompt.key.startsWith('post.step.') && selectedPrompt.key.endsWith('.user')) {
      return preview.messages.find((message) => message.role === 'user')?.content || '';
    }
    if (selectedPrompt.key.startsWith('finalize.')) {
      return preview.messages.find((message) => message.role === 'user')?.content || '';
    }
    if (selectedPrompt.key === 'discovery.sitemap.user') {
      return preview.messages.find((message) => message.role === 'user')?.content || '';
    }
    if (selectedPrompt.key.startsWith('auto_draft.')) {
      return preview.messages.find((message) => message.role === 'user')?.content || '';
    }
    if (selectedPrompt.key.startsWith('interview.')) {
      return preview.messages.find((message) => message.role === 'system')?.content || '';
    }
    if (selectedPrompt.key === 'post.master.system' || selectedPrompt.key.endsWith('.system')) {
      return preview.messages.find((message) => message.role === 'system')?.content || '';
    }
    return selectedPrompt.effective.text;
  }, [preview, selectedPrompt]);

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
    <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-background">
      <header className="border-b px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Shield className="h-6 w-6" />
              Content Writer Prompt Graph
            </h1>
            <p className="text-sm text-muted-foreground">
              Follow how knowledge, placeholders, sources, outlines, draft text, and cleanup move through the writer.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find prompt or placeholder" className="pl-9" />
              {filteredPrompts.length ? (
                <div className="absolute right-0 top-11 z-30 w-[420px] rounded-lg border bg-popover p-2 shadow-lg">
                  {filteredPrompts.map((prompt) => (
                    <button
                      key={prompt.key}
                      type="button"
                      onClick={() => { selectPrompt(prompt.key); setQuery(''); }}
                      className="block w-full rounded-md px-3 py-2 text-left hover:bg-muted"
                    >
                      <span className="block text-sm font-medium">{prompt.label}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{prompt.key}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Refresh</span>
            </Button>
            <Button onClick={() => renderPreview(inferPreviewTarget(selectedKey), 'render')} disabled={previewLoading || !selectedPrompt} className="gap-1">
              {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Render selected
            </Button>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading prompt graph...
        </div>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden 2xl:grid-cols-[minmax(820px,1fr)_520px]">
          <section className="min-h-0 overflow-auto border-r bg-muted/20">
            <PromptGraph selectedNodeId={selectedNodeId} onSelectNode={selectNode} promptMap={promptMap} />
          </section>

          <aside className="flex min-h-0 flex-col overflow-hidden bg-background">
            <div className="shrink-0 border-b p-3">
              <div className="flex items-start gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${selectedNode.accent}`}>
                  <selectedNode.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="truncate font-semibold">{selectedNode.title}</h2>
                    <Badge variant="outline" className="shrink-0">{nodePrompts.length} prompt{nodePrompts.length === 1 ? '' : 's'}</Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{selectedNode.subtitle}</p>
                </div>
              </div>

              <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground">
                <p className="truncate"><span className="font-medium text-foreground">In:</span> {selectedNode.inputs.join(', ')}</p>
                <p className="truncate"><span className="font-medium text-foreground">Out:</span> {selectedNode.outputs.join(', ')}</p>
              </div>

              <div className="mt-3 space-y-1.5">
                <Label htmlFor="node-prompt-select">Prompt in this step</Label>
                <Select value={selectedKey} onValueChange={selectPrompt}>
                  <SelectTrigger id="node-prompt-select" className="h-9">
                    <SelectValue placeholder="Select a prompt" />
                  </SelectTrigger>
                  <SelectContent>
                    {nodePrompts.map((prompt) => (
                      <SelectItem key={prompt.key} value={prompt.key}>
                        {prompt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPrompt ? (
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{selectedPrompt.key}</p>
                ) : null}
              </div>
            </div>

            {selectedPrompt ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="shrink-0 border-b p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="truncate text-base font-semibold">{selectedPrompt.label}</h3>
                        {(() => {
                          const status = promptStatus(selectedPrompt);
                          const StatusIcon = status.icon;
                          return (
                            <Badge variant={status.variant} className="shrink-0 gap-1">
                              <StatusIcon className="h-3 w-3" />
                              {status.label}
                            </Badge>
                          );
                        })()}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{selectedPrompt.description}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" onClick={saveDraft} disabled={!selectedPrompt.editable || saving || !draftDirty} className="gap-1">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save
                      </Button>
                      <Button size="sm" onClick={publishDraft} disabled={!canPublish} className="gap-1">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Publish
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-nowrap gap-2 overflow-x-auto pb-1">
                    {(selectedPrompt.placeholders || []).slice(0, 8).map((placeholder) => (
                      <Badge key={placeholder} variant="outline" className="shrink-0 font-mono text-[10px]">
                        {`{{${placeholder}}}`}
                      </Badge>
                    ))}
                    {(selectedPrompt.placeholders || []).length > 8 ? (
                      <Badge variant="secondary" className="shrink-0">+{(selectedPrompt.placeholders || []).length - 8}</Badge>
                    ) : null}
                    {draftDirty ? <Badge variant="secondary" className="shrink-0">Unsaved changes</Badge> : null}
                  </div>
                </div>

                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="flex min-h-0 flex-1 flex-col">
                  <div className="shrink-0 border-b px-3 py-2">
                    <TabsList className="grid w-full grid-cols-4">
                      <TabsTrigger value="template">Template</TabsTrigger>
                      <TabsTrigger value="resolved">Resolved</TabsTrigger>
                      <TabsTrigger value="render">Run view</TabsTrigger>
                      <TabsTrigger value="history">History</TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="template" className="min-h-0 flex-1 overflow-hidden p-3 data-[state=inactive]:hidden">
                    <div className="flex h-full min-h-0 flex-col rounded-lg border">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                        <span>Draft: {selectedPrompt.config?.draft_text ? formatDate(selectedPrompt.config.updated_at) : 'none'}</span>
                        <span>Published: {formatDate(selectedPrompt.config?.published_at)}</span>
                        <span>{draftText.length.toLocaleString()} chars</span>
                      </div>
                      <Textarea
                        value={draftText}
                        onChange={(event) => setDraftText(event.target.value)}
                        disabled={!selectedPrompt.editable}
                        className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-xs leading-relaxed focus-visible:ring-0"
                      />
                      <div className="flex flex-wrap justify-between gap-2 border-t px-4 py-2">
                        <Button variant="ghost" size="sm" onClick={() => copyText(selectedPrompt.effective.text, 'Effective prompt')} className="gap-1">
                          <Copy className="h-4 w-4" />
                          Copy effective
                        </Button>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setDraftText(selectedPrompt.defaultText)} disabled={!selectedPrompt.editable || saving}>
                            Load default
                          </Button>
                          <Button variant="ghost" size="sm" onClick={resetPrompt} disabled={!selectedPrompt.editable || saving} className="gap-1 text-destructive">
                            <RotateCcw className="h-4 w-4" />
                            Reset
                          </Button>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="resolved" className="min-h-0 flex-1 overflow-hidden p-3 data-[state=inactive]:hidden">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground">Resolved preview uses the same server renderer as generation.</p>
                      <Button variant="outline" size="sm" onClick={() => renderPreview(inferPreviewTarget(selectedKey), 'resolved')} disabled={previewLoading} className="gap-1">
                        {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MousePointer2 className="h-4 w-4" />}
                        Resolve selected
                      </Button>
                    </div>
                    <PromptTextPanel
                      label={resolvedText ? 'resolved output' : 'effective template'}
                      text={resolvedText || selectedPrompt.effective.text}
                      onCopy={() => copyText(resolvedText || selectedPrompt.effective.text, 'Resolved prompt')}
                    />
                  </TabsContent>

                  <TabsContent value="render" className="min-h-0 flex-1 overflow-hidden p-3 data-[state=inactive]:hidden">
                    <div className="flex h-full min-h-0 flex-col gap-3">
                      <RenderControls
                        mode={previewMode}
                        step={previewStep}
                        docType={previewDocType}
                        postId={previewPostId}
                        loading={previewLoading}
                        onMode={setPreviewMode}
                        onStep={setPreviewStep}
                        onDocType={setPreviewDocType}
                        onPostId={setPreviewPostId}
                        onRender={() => renderPreview(undefined, 'render')}
                      />
                      {preview ? (
                        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
                          <PromptTextPanel
                            label="system"
                            text={preview.messages.find((message) => message.role === 'system')?.content || ''}
                            onCopy={() => copyText(preview.messages.find((message) => message.role === 'system')?.content || '', 'System message')}
                          />
                          <PromptTextPanel
                            label="user"
                            text={preview.messages.find((message) => message.role === 'user')?.content || ''}
                            onCopy={() => copyText(preview.messages.find((message) => message.role === 'user')?.content || '', 'User message')}
                          />
                          <div className="lg:col-span-2 grid min-h-[260px] gap-3 lg:grid-cols-2">
                            <ContextPanel preview={preview} />
                            <PromptTextPanel
                              label="metadata"
                              text={JSON.stringify(preview.metadata, null, 2)}
                              onCopy={() => copyText(JSON.stringify(preview.metadata, null, 2), 'Preview metadata')}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                          Render a node or selected prompt to inspect final system/user messages and placeholder context.
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto p-3 data-[state=inactive]:hidden">
                    {selectedPrompt.versions.length ? (
                      <div className="space-y-3">
                        {selectedPrompt.versions.map((version) => (
                          <section key={version.id} className="rounded-lg border">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
                              <div className="flex items-center gap-2">
                                <Badge>v{version.version}</Badge>
                                <span className="text-xs text-muted-foreground">Published {formatDate(version.published_at)}</span>
                              </div>
                              <Button variant="ghost" size="sm" className="gap-1" onClick={() => copyText(version.prompt_text, `Version ${version.version}`)}>
                                <Copy className="h-4 w-4" />
                                Copy
                              </Button>
                            </div>
                            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed">
                              {version.prompt_text}
                            </pre>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                        No published versions yet.
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            ) : null}
          </aside>
        </main>
      )}
    </div>
  );
}

function PromptGraph({ selectedNodeId, onSelectNode, promptMap }: {
  selectedNodeId: string;
  onSelectNode: (nodeId: string) => void;
  promptMap: Map<string, ContentWriterPromptRegistryItem>;
}) {
  return (
    <div className="min-w-[1060px] p-4">
      <div
        className="relative h-[720px] overflow-hidden rounded-xl border bg-background shadow-sm"
        style={{
          backgroundImage: 'radial-gradient(circle, hsl(var(--muted-foreground) / 0.18) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1060 720">
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="hsl(var(--muted-foreground))" opacity="0.65" />
            </marker>
          </defs>
          {FLOW_EDGES.map((edge) => {
            const from = FLOW_NODES.find((node) => node.id === edge.from)!;
            const to = FLOW_NODES.find((node) => node.id === edge.to)!;
            const start = { x: from.x + from.w, y: from.y + from.h / 2 };
            const end = { x: to.x, y: to.y + to.h / 2 };
            if (from.x > to.x) {
              start.x = from.x;
              end.x = to.x + to.w;
            }
            const midX = (start.x + end.x) / 2;
            const d = `M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`;
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <path d={d} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1.5" strokeDasharray="5 6" opacity="0.55" markerEnd="url(#arrow)" />
                <text x={midX} y={(start.y + end.y) / 2 - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {edge.label}
                </text>
              </g>
            );
          })}
        </svg>

        {FLOW_NODES.map((node) => {
          const Icon = node.icon;
          const active = node.id === selectedNodeId;
          const promptCount = node.promptKeys.filter((key) => promptMap.has(key)).length;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              className={`absolute rounded-xl border p-4 text-left shadow-sm transition-all ${node.accent} ${
                active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:-translate-y-0.5 hover:shadow-md'
              }`}
              style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
            >
              <span className="mb-3 flex items-center justify-between gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-background/70">
                  <Icon className="h-4 w-4" />
                </span>
                <Badge variant="outline" className="bg-background/70">{promptCount} prompt{promptCount === 1 ? '' : 's'}</Badge>
              </span>
              <span className="block text-base font-semibold">{node.title}</span>
              <span className="mt-1 block text-xs opacity-80">{node.subtitle}</span>
              <span className="mt-3 block truncate text-[11px] opacity-75">{node.outputs.join(' -> ')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RenderControls(props: {
  mode: PreviewMode;
  step: PreviewStep;
  docType: PreviewDocType;
  postId: string;
  loading: boolean;
  onMode: (value: PreviewMode) => void;
  onStep: (value: PreviewStep) => void;
  onDocType: (value: PreviewDocType) => void;
  onPostId: (value: string) => void;
  onRender: () => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="grid gap-3 lg:grid-cols-[140px_140px_190px_1fr_auto]">
        <div className="space-y-1.5">
          <Label>Mode</Label>
          <Select value={props.mode} onValueChange={(value) => props.onMode(value as PreviewMode)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="post_step">Post step</SelectItem>
              <SelectItem value="interview">KB interview</SelectItem>
              <SelectItem value="finalize">KB finalizer</SelectItem>
              <SelectItem value="website_pages_discovery">Website discovery</SelectItem>
              <SelectItem value="kb_auto_draft">KB auto-draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Step</Label>
          <Select value={props.step} onValueChange={(value) => props.onStep(value as PreviewStep)} disabled={props.mode !== 'post_step'}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STEPS.map((step) => <SelectItem key={step} value={step}>{labelStep(step)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>KB doc</Label>
          <Select value={props.docType} onValueChange={(value) => props.onDocType(value as PreviewDocType)} disabled={props.mode === 'post_step' || props.mode === 'website_pages_discovery'}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map((docType) => <SelectItem key={docType} value={docType}>{DOC_LABELS[docType]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="preview-post-id">Post ID</Label>
          <Input id="preview-post-id" value={props.postId} onChange={(event) => props.onPostId(event.target.value)} placeholder="Optional real post ID" />
        </div>
        <div className="flex items-end">
          <Button onClick={props.onRender} disabled={props.loading} className="gap-1">
            {props.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            Render
          </Button>
        </div>
      </div>
    </div>
  );
}

function ContextPanel({ preview }: { preview: PromptPreviewResponse }) {
  const entries = Object.entries(preview.context || {});
  return (
    <section className="flex min-h-0 flex-col rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <Badge variant="outline">context</Badge>
        <span className="text-xs text-muted-foreground">{entries.length} values</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {preview.placeholder_warnings?.length ? (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {preview.placeholder_warnings.map((warning) => <p key={warning}>{warning}</p>)}
          </div>
        ) : null}
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div key={key} className="rounded-md bg-muted/60 p-2">
              <p className="font-mono text-[11px] text-muted-foreground">{`{{${key}}}`}</p>
              <p className="mt-1 line-clamp-3 text-xs">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PromptTextPanel({ label, text, onCopy }: { label: string; text: string; onCopy: () => void }) {
  return (
    <section className="flex min-h-0 flex-col rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <Badge variant={label === 'system' ? 'default' : label === 'user' ? 'secondary' : 'outline'}>{label}</Badge>
        <Button variant="ghost" size="sm" className="gap-1" onClick={onCopy}>
          <Copy className="h-4 w-4" />
          Copy
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed">
        {text}
      </pre>
    </section>
  );
}
