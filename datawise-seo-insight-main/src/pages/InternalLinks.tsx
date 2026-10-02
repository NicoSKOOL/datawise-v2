import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Circle, ExternalLink, KeyRound, Loader2, Network, Play, RotateCcw, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { getLLMConfig } from '@/lib/chat';
import {
  confirmRun, deleteRun, getRun, listRuns, resumeRun, startRun,
  type InternalLinkRun, type RunStage,
} from '@/lib/internal-links';
import { InternalLinksReport } from '@/components/internal-links/InternalLinksReport';

const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const when = (iso: string) => new Date(iso.endsWith('Z') || iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleString();

export default function InternalLinks() {
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('run', id);
    else next.delete('run');
    setParams(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Internal Links</h1>
        <p className="text-muted-foreground">
          Jev reads every paragraph on your site and decides which of your pages a reader needs next.
        </p>
      </div>
      {runId ? <RunView id={runId} onBack={() => open(null)} /> : <Home onOpen={open} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Home({ onOpen }: { onOpen: (id: string) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [site, setSite] = useState('');
  const hasKey = !!getLLMConfig();
  const runs = useQuery({ queryKey: ['internal-link-runs'], queryFn: listRuns });

  const start = useMutation({
    mutationFn: () => startRun(site),
    onSuccess: ({ run, truncated }) => {
      qc.invalidateQueries({ queryKey: ['internal-link-runs'] });
      if (truncated) {
        toast({ title: 'Large site', description: `Analysing the first ${run.total} pages from the sitemap.` });
      }
      onOpen(run.id);
    },
    onError: (err: Error) => {
      toast({
        variant: 'destructive',
        title: 'Could not start',
        description:
          err.message === 'no_llm_key'
            ? 'Save your OpenRouter API key in Settings first. Jev runs on your own key.'
            : err.message,
      });
    },
  });

  const active = runs.data?.runs.find((r) => r.status === 'running' || r.status === 'awaiting_confirmation');

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-6 space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ['1', 'Crawl', 'We read your sitemap and pull every paragraph that could hold a link.'],
              ['2', 'Decide', 'For each paragraph, Jev picks the best of 4 candidate pages, or none.'],
              ['3', 'Place', 'Rules cap links per page, then anchor text is taken verbatim from your copy.'],
            ].map(([n, title, text]) => (
              <div key={n} className="flex gap-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {n}
                </div>
                <div>
                  <div className="font-medium">{title}</div>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              </div>
            ))}
          </div>

          {!hasKey && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Jev runs on your own OpenRouter key, so you need to add one first.{' '}
                <Link to="/settings" className="font-medium underline">Add your key in Settings</Link>. A 150-page
                site usually costs well under $1.
              </div>
            </div>
          )}

          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (site.trim()) start.mutate();
            }}
          >
            <Input
              placeholder="yourwebsite.com"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className="sm:max-w-md"
              disabled={start.isPending}
            />
            <Button type="submit" disabled={!site.trim() || start.isPending || !hasKey || !!active}>
              {start.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {start.isPending ? 'Reading sitemap...' : 'Find link opportunities'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Up to 300 pages per run. Runs take 5 to 15 minutes. Jev calls and anchor writing are billed to your
            OpenRouter key; you will be asked before any run that would cost more than $3.
            {active && ' You already have a run in progress below.'}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Your runs</h2>
        {runs.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {runs.data && runs.data.runs.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <Network className="h-8 w-8" />
              <p>No runs yet. Enter your site above to get your first internal linking plan.</p>
            </CardContent>
          </Card>
        )}
        {runs.data?.runs.map((r) => <RunRow key={r.id} run={r} onOpen={() => onOpen(r.id)} />)}
      </div>
    </div>
  );
}

function StatusBadge({ run }: { run: InternalLinkRun }) {
  if (run.status === 'completed') return <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Ready</Badge>;
  if (run.status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  if (run.status === 'awaiting_confirmation') return <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Needs your OK</Badge>;
  return <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Running</Badge>;
}

function RunRow({ run, onOpen }: { run: InternalLinkRun; onOpen: () => void }) {
  return (
    <Card className="cursor-pointer transition-colors hover:border-primary/40" onClick={onOpen}>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{host(run.site_url)}</div>
          <div className="text-xs text-muted-foreground">{when(run.created_at)}</div>
        </div>
        {run.summary && (
          <div className="flex gap-6 text-sm">
            <Stat label="pages" value={run.summary.pages} />
            <Stat label="links" value={run.summary.links} strong />
            <Stat label="to review" value={run.summary.review} />
          </div>
        )}
        <div className="text-sm text-muted-foreground">{usd(run.cost_usd)}</div>
        <StatusBadge run={run} />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="text-center">
      <div className={strong ? 'font-semibold text-primary' : 'font-medium'}>{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RunView({ id, onBack }: { id: string; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // Each poll also advances the run on the server, so keep it frequent.
  const q = useQuery({
    queryKey: ['internal-link-run', id],
    queryFn: () => getRun(id),
    refetchInterval: (query) => (query.state.data?.run.status === 'running' ? 3000 : false),
    // Keep polling in a background tab: polls are what advance the run, and
    // the staging preview Worker has no cron to pick up the slack.
    refetchIntervalInBackground: true,
  });
  const refresh = (run: InternalLinkRun) => {
    qc.setQueryData(['internal-link-run', id], { run });
    qc.invalidateQueries({ queryKey: ['internal-link-runs'] });
  };
  const onErr = (err: Error) => toast({ variant: 'destructive', title: 'Something went wrong', description: err.message });
  const confirm = useMutation({ mutationFn: () => confirmRun(id), onSuccess: ({ run }) => refresh(run), onError: onErr });
  const resume = useMutation({ mutationFn: () => resumeRun(id), onSuccess: ({ run }) => refresh(run), onError: onErr });
  const remove = useMutation({
    mutationFn: () => deleteRun(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['internal-link-runs'] });
      onBack();
    },
    onError: onErr,
  });

  const run = q.data?.run;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="mr-1 h-4 w-4" /> All runs
        </Button>
        {run && (
          <div className="flex items-center gap-2">
            <a href={run.site_url} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground hover:underline">
              {host(run.site_url)} <ExternalLink className="inline h-3 w-3" />
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (window.confirm('Delete this run and its report?')) remove.mutate();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}
      {q.error && <p className="text-sm text-destructive">{(q.error as Error).message}</p>}
      {run && run.status === 'completed' && <InternalLinksReport runId={run.id} />}
      {run && run.status !== 'completed' && (
        <Card>
          <CardContent className="space-y-6 p-6">
            {run.status === 'awaiting_confirmation' && (
              <div className="space-y-3 rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="font-medium">This run would cost about {usd(run.estimated_cost_usd ?? 0)} on your OpenRouter key.</div>
                <p className="text-sm">
                  That is above the {usd(run.max_cost_usd)} limit, so we paused before asking Jev anything. Jev will judge{' '}
                  {run.total.toLocaleString()} paragraphs.
                </p>
                <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                  {confirm.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Continue the run
                </Button>
              </div>
            )}
            {run.status === 'failed' && (
              <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" /> The run stopped
                </div>
                <p className="text-sm">{run.error}</p>
                <Button variant="outline" onClick={() => resume.mutate()} disabled={resume.isPending}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Resume from where it stopped
                </Button>
              </div>
            )}
            <Stages run={run} />
            {run.status === 'running' && (
              <p className="text-xs text-muted-foreground">
                Spent so far: {usd(run.cost_usd)}. You can leave this page; the run keeps going in the background and
                finishes faster while this page is open.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const STAGES: Array<{ key: RunStage; label: string }> = [
  { key: 'crawl', label: 'Crawling pages' },
  { key: 'shortlist', label: 'Shortlisting candidate pages for each paragraph' },
  { key: 'score', label: 'Jev deciding which page each reader needs next' },
  { key: 'allocate', label: 'Applying link caps' },
  { key: 'anchors', label: 'Finding anchor text in your copy' },
  { key: 'report', label: 'Building your report' },
];

function Stages({ run }: { run: InternalLinkRun }) {
  const current = STAGES.findIndex((s) => s.key === run.stage);
  const p = run.progress;
  const detail = (key: RunStage): [number, number] | null => {
    if (key === 'crawl') return [p.pages_done ?? 0, p.pages_total ?? run.total];
    if (key === run.stage && run.total > 0) return [run.cursor, run.total];
    return null;
  };
  const note = (key: RunStage, i: number): string | null => {
    if (key === 'crawl' && i < current) {
      return `${(p.pages_done ?? 0) - (p.pages_failed ?? 0)} pages read, ${(p.passages ?? 0).toLocaleString()} paragraphs${p.pages_failed ? `, ${p.pages_failed} pages failed` : ''}`;
    }
    if (key === 'shortlist' && i < current) return `${(p.candidates ?? 0).toLocaleString()} paragraphs have candidate pages`;
    if (key === 'score' && i < current) return `${(p.judged ?? 0).toLocaleString()} decisions${p.api_errors ? `, ${p.api_errors} API errors` : ''}`;
    if (key === 'allocate' && i < current) return `${p.allocated ?? 0} links allocated`;
    if (key === 'anchors' && i < current) return `${p.anchored ?? 0} clean anchors found`;
    return null;
  };

  return (
    <ol className="space-y-4">
      {STAGES.map((s, i) => {
        const done = i < current || run.stage === 'done';
        const active = i === current && run.stage !== 'done';
        const d = active ? detail(s.key) : null;
        const n = note(s.key, i);
        return (
          <li key={s.key} className="flex gap-3">
            <div className="pt-0.5">
              {done ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : active && run.status === 'running' ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : (
                <Circle className={`h-5 w-5 ${active ? 'text-amber-500' : 'text-muted-foreground/40'}`} />
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <div className={done || active ? 'font-medium' : 'text-muted-foreground'}>{s.label}</div>
              {n && <div className="text-sm text-muted-foreground">{n}</div>}
              {d && (
                <div className="flex items-center gap-3">
                  <Progress value={d[1] ? (d[0] / d[1]) * 100 : 0} className="h-2 max-w-md" />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {d[0].toLocaleString()} / {d[1].toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
