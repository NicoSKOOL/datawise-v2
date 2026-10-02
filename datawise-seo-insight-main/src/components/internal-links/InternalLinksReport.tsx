import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Download, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { downloadCsv } from '@/lib/planner-export';
import { csvFilename, rowsToCsv, type CsvColumn } from '@/lib/table-csv';
import {
  OUTCOME_LABELS, getReport, isLinked, setApproval,
  type Approval, type InternalLinksReport as Report, type ReportRow,
} from '@/lib/internal-links';
import { cn } from '@/lib/utils';

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
};
const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);

const CAP_OUTCOMES = ['source_full', 'too_close', 'target_full', 'duplicate_pair'];
const UNSURE_OUTCOMES = ['low_confidence', 'not_warranted', 'no_natural_anchor', 'self_link', 'api_error'];

const GROUPS: Array<{ key: string; label: string; test: (r: ReportRow) => boolean }> = [
  { key: 'linked', label: 'Linked', test: (r) => isLinked(r.o) },
  { key: 'review', label: 'Needs review', test: (r) => r.o === 'linked_review' },
  { key: 'noanchor', label: 'Kept, no anchor', test: (r) => r.o === 'no_anchor' },
  { key: 'capped', label: 'Lost to page caps', test: (r) => CAP_OUTCOMES.includes(r.o) },
  { key: 'none', label: 'Jev said none', test: (r) => r.o === 'model_said_none' },
  { key: 'unsure', label: 'Not sure enough', test: (r) => UNSURE_OUTCOMES.includes(r.o) },
  { key: 'all', label: 'Everything', test: () => true },
];

export function InternalLinksReport({ runId }: { runId: string }) {
  const { toast } = useToast();
  const q = useQuery({ queryKey: ['internal-link-report', runId], queryFn: () => getReport(runId), staleTime: Infinity });
  const [approvals, setApprovals] = useState<Record<string, Approval> | null>(null);
  const current = approvals ?? q.data?.approvals ?? {};

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading report...</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? 'Report not found'}</p>;

  const approve = async (rowId: number, value: Approval | null) => {
    const prev = current;
    const next = { ...current };
    if (value) next[rowId] = value;
    else delete next[rowId];
    setApprovals(next);
    try {
      const res = await setApproval(runId, rowId, value);
      setApprovals(res.approvals);
    } catch (err) {
      setApprovals(prev);
      toast({ variant: 'destructive', title: 'Could not save', description: (err as Error).message });
    }
  };

  return <ReportBody report={q.data.report} approvals={current} onApprove={approve} />;
}

function ReportBody({
  report,
  approvals,
  onApprove,
}: {
  report: Report;
  approvals: Record<string, Approval>;
  onApprove: (rowId: number, value: Approval | null) => void;
}) {
  const { summary: S, rows: R, urls: U } = report;
  const funnel = useMemo(() => {
    const picked = R.filter((r) => r.j && r.j !== 'none').length;
    const saidNone = R.filter((r) => r.o === 'model_said_none').length;
    const cleared = R.filter((r) => isLinked(r.o) || r.o === 'no_anchor' || CAP_OUTCOMES.includes(r.o)).length;
    const fit = R.filter((r) => isLinked(r.o) || r.o === 'no_anchor').length;
    const apply = R.filter((r) => r.o === 'linked_apply').length;
    const review = R.filter((r) => r.o === 'linked_review').length;
    return { picked, saidNone, cleared, fit, apply, review, linked: apply + review };
  }, [R]);
  const site = S.site.replace(/^https?:\/\/(www\.)?/, '');

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="text-sm text-muted-foreground">
          {site} · {S.pages.toLocaleString()} pages crawled · {new Date(S.generated_at).toLocaleDateString()}
        </div>
        <h2 className="text-3xl font-bold leading-tight tracking-tight md:text-4xl">
          Jev read {S.decisions.toLocaleString()} paragraphs and put{' '}
          <span className="text-primary underline decoration-primary/40 underline-offset-4">{funnel.linked.toLocaleString()} links</span> in them.
        </h2>
        <p className="max-w-3xl text-muted-foreground">
          For every paragraph, Jev picked the best of up to 4 candidate pages, or said none fit. Rules then decided
          which picks survive (confidence bars, at most {S.caps.max_new_links_per_source} new links per page and{' '}
          {S.caps.max_new_links_per_target} per target), and a writing model found anchor text that already exists in your copy.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <FunnelBox n={S.decisions} total={S.decisions} label="Paragraphs asked" sub="each with up to 4 candidates" />
        <FunnelBox n={funnel.picked} total={S.decisions} label="Jev picked a page" sub={`${funnel.saidNone.toLocaleString()} said none fit`} />
        <FunnelBox n={funnel.cleared} total={S.decisions} label="Cleared the bars" sub={`confidence ≥ ${S.thresholds.min_confidence}`} />
        <FunnelBox n={funnel.fit} total={S.decisions} label="Fit under page caps" sub={`${S.caps.max_new_links_per_source} per page, ${S.caps.max_new_links_per_target} per target`} />
        <FunnelBox n={funnel.linked} total={S.decisions} label="Had a clean anchor" sub={`${funnel.apply} high confidence, ${funnel.review} to review`} highlight />
      </div>

      <div className="text-xs text-muted-foreground">
        Model {S.jev_model} · anchors by {S.anchor_model} · cost {S.cost_usd < 0.01 ? `$${S.cost_usd.toFixed(4)}` : `$${S.cost_usd.toFixed(2)}`} ·{' '}
        {S.tokens.toLocaleString()} tokens{S.failed_pages ? ` · ${S.failed_pages} pages could not be fetched` : ''}
      </div>

      <Tabs defaultValue="decisions">
        <TabsList>
          <TabsTrigger value="decisions">Every decision</TabsTrigger>
          <TabsTrigger value="pages">Pages that gain links</TabsTrigger>
          <TabsTrigger value="orphans">Orphans and under-linked</TabsTrigger>
        </TabsList>
        <TabsContent value="decisions" className="mt-4">
          <Decisions report={report} approvals={approvals} onApprove={onApprove} />
        </TabsContent>
        <TabsContent value="pages" className="mt-4">
          <PagesTable report={report} />
        </TabsContent>
        <TabsContent value="orphans" className="mt-4">
          <Orphans report={report} />
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">
        Confidence is Jev's own probability and is not calibrated. A person should approve every link before it goes live.
        Existing inbound counts only include links in page content, not menus, headers or footers. {U.length} URLs indexed.
      </p>
    </div>
  );
}

function FunnelBox({ n, total, label, sub, highlight }: { n: number; total: number; label: string; sub: string; highlight?: boolean }) {
  return (
    <Card className={cn(highlight && 'border-primary/50 bg-primary/5')}>
      <CardContent className="space-y-1 p-4">
        <div className={cn('text-2xl font-bold tabular-nums', highlight && 'text-primary')}>{n.toLocaleString()}</div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
        <div className="mt-2 h-1 rounded-full bg-muted">
          <div
            className={cn('h-1 rounded-full transition-all duration-700', highlight ? 'bg-primary' : 'bg-foreground/30')}
            style={{ width: `${total ? Math.max(2, (n / total) * 100) : 0}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function Decisions({
  report,
  approvals,
  onApprove,
}: {
  report: Report;
  approvals: Record<string, Approval>;
  onApprove: (rowId: number, value: Approval | null) => void;
}) {
  const { rows: R, urls: U, summary: S } = report;
  const [group, setGroup] = useState('linked');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState('any');
  const [sort, setSort] = useState('conf');
  const [minConf, setMinConf] = useState(0);
  const [shown, setShown] = useState(40);

  const filtered = useMemo(() => {
    const g = GROUPS.find((x) => x.key === group)!.test;
    const ql = query.trim().toLowerCase();
    const out = R.filter(
      (r) =>
        g(r) &&
        (stage === 'any' || r.r === stage) &&
        (r.c ?? 0) >= minConf &&
        (!ql ||
          r.t.toLowerCase().includes(ql) ||
          U[r.s][0].toLowerCase().includes(ql) ||
          r.a.toLowerCase().includes(ql) ||
          r.k.some((k) => U[k[0]][0].toLowerCase().includes(ql) || U[k[0]][1].toLowerCase().includes(ql)))
    );
    if (sort === 'conf') out.sort((a, b) => (b.c ?? 0) - (a.c ?? 0));
    if (sort === 'page') out.sort((a, b) => U[a.s][0].localeCompare(U[b.s][0]) || a.p - b.p);
    if (sort === 'close') {
      const t = S.thresholds.min_confidence;
      out.sort((a, b) => Math.abs((a.c ?? 0) - t) - Math.abs((b.c ?? 0) - t));
    }
    return out;
  }, [R, U, S, group, query, stage, sort, minConf]);

  const linkedTotal = R.filter((r) => isLinked(r.o)).length;
  const keep = R.filter((r) => isLinked(r.o) && (r.c ?? 0) >= minConf).length;

  const target = (r: ReportRow) => (r.j && r.j !== 'none' ? r.k[Number(r.j) - 1] : undefined);
  const decisionColumns: CsvColumn<ReportRow>[] = [
    { label: 'Decision', value: (r) => r.i },
    { label: 'Outcome', value: (r) => OUTCOME_LABELS[r.o] },
    { label: 'Source URL', value: (r) => U[r.s][0] },
    { label: 'Paragraph #', value: (r) => r.p + 1 },
    { label: 'Anchor', value: (r) => r.a },
    { label: 'Jev pick URL', value: (r) => (target(r) ? U[target(r)![0]][0] : '') },
    { label: 'Confidence', value: (r) => r.c?.toFixed(2) ?? '' },
    { label: 'P(none)', value: (r) => r.n.toFixed(2) },
    { label: 'Link warranted', value: (r) => r.w?.toFixed(2) ?? '' },
    { label: 'Anchor available', value: (r) => r.v?.toFixed(2) ?? '' },
    { label: 'Reader stage', value: (r) => r.r },
    { label: 'Promotional', value: (r) => r.m?.toFixed(2) ?? '' },
    { label: 'Approval', value: (r) => approvals[r.i] ?? '' },
    { label: 'Paragraph', value: (r) => r.t },
  ];
  const linkColumns: CsvColumn<ReportRow>[] = [
    { label: 'Source URL', value: (r) => U[r.s][0] },
    { label: 'Paragraph #', value: (r) => r.p + 1 },
    { label: 'Anchor text', value: (r) => r.a },
    { label: 'Link to', value: (r) => U[target(r)![0]][0] },
    { label: 'Confidence', value: (r) => r.c?.toFixed(2) ?? '' },
    { label: 'Status', value: (r) => (r.o === 'linked_apply' ? 'apply' : 'review') },
    { label: 'Approval', value: (r) => approvals[r.i] ?? '' },
    {
      label: 'Paragraph with link',
      value: (r) => r.t.replace(r.a, `[${r.a}](${U[target(r)![0]][0]})`),
    },
  ];
  const domain = S.site.replace(/^https?:\/\//, '');
  const exportView = () => downloadCsv(csvFilename('jev-decisions', domain), rowsToCsv(decisionColumns, filtered));
  const exportApproved = () => {
    const links = R.filter((r) => isLinked(r.o) && approvals[r.i] !== 'rejected');
    const approved = links.filter((r) => approvals[r.i] === 'approved');
    downloadCsv(csvFilename('internal-links', domain), rowsToCsv(linkColumns, approved.length ? approved : links));
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-1 space-y-3 bg-background/95 px-1 py-2 backdrop-blur">
        <div className="flex flex-wrap gap-2">
          {GROUPS.map((g) => {
            const count = R.filter(g.test).length;
            return (
              <button
                key={g.key}
                onClick={() => {
                  setGroup(g.key);
                  setShown(40);
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  group === g.key ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/50'
                )}
              >
                {g.label} <span className="ml-1 opacity-70 tabular-nums">{count.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(40);
              }}
              placeholder="Search paragraphs, pages, anchors"
              className="pl-8"
            />
          </div>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any reader stage</SelectItem>
              <SelectItem value="learning">Learning</SelectItem>
              <SelectItem value="comparing">Comparing</SelectItem>
              <SelectItem value="ready">Ready to act</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="conf">Most confident first</SelectItem>
              <SelectItem value="page">By page</SelectItem>
              <SelectItem value="close">Closest calls first</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex w-full max-w-xs items-center gap-3">
            <span className="whitespace-nowrap text-sm">Min confidence {minConf.toFixed(2)}</span>
            <Slider value={[minConf]} min={0} max={1} step={0.01} onValueChange={([v]) => setMinConf(v)} />
          </div>
          {minConf > 0 && (
            <span className="text-sm text-muted-foreground">
              Raising the bar to {minConf.toFixed(2)} would keep <b className="text-foreground">{keep} of {linkedTotal}</b> links. No new API calls needed.
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{filtered.length.toLocaleString()} decisions</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportView}><Download className="mr-1.5 h-4 w-4" />This view</Button>
          <Button size="sm" onClick={exportApproved}><Download className="mr-1.5 h-4 w-4" />Approved links</Button>
        </div>
      </div>

      <div className="space-y-3">
        {filtered.slice(0, shown).map((r) => (
          <DecisionCard key={r.i} row={r} report={report} approval={approvals[r.i]} onApprove={onApprove} />
        ))}
        {filtered.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches these filters.</p>}
        {shown < filtered.length && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setShown((s) => s + 40)}>Show 40 more</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function OutcomePill({ o }: { o: ReportRow['o'] }) {
  const tone =
    o === 'linked_apply'
      ? 'bg-primary/10 text-primary'
      : o === 'linked_review'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
        : o === 'model_said_none'
          ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
          : 'bg-muted text-muted-foreground';
  return <span className={cn('whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', tone)}>{OUTCOME_LABELS[o]}</span>;
}

function DecisionCard({
  row: r,
  report,
  approval,
  onApprove,
}: {
  row: ReportRow;
  report: Report;
  approval?: Approval;
  onApprove: (rowId: number, value: Approval | null) => void;
}) {
  const U = report.urls;
  const linked = isLinked(r.o);
  const pick = r.j && r.j !== 'none' ? r.k[Number(r.j) - 1] : undefined;
  const at = linked && r.a ? r.t.indexOf(r.a) : -1;

  return (
    <Card
      className={cn(
        'overflow-hidden',
        linked && (r.o === 'linked_apply' ? 'border-l-[3px] border-l-primary' : 'border-l-[3px] border-l-amber-500'),
        !linked && 'opacity-75',
        approval === 'rejected' && 'opacity-50'
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-4 py-2 text-sm">
        <div className="min-w-0 truncate">
          <a href={U[r.s][0]} target="_blank" rel="noreferrer" className="font-medium hover:underline">{pathOf(U[r.s][0])}</a>
          <span className="text-muted-foreground"> · paragraph {r.p + 1}</span>
        </div>
        <OutcomePill o={r.o} />
      </div>
      <CardContent className="grid gap-5 p-4 md:grid-cols-[1.3fr_1fr]">
        <p className="font-serif text-[15px] leading-relaxed">
          {at >= 0 ? (
            <>
              {r.t.slice(0, at)}
              <a
                href={pick ? U[pick[0]][0] : undefined}
                target="_blank"
                rel="noreferrer"
                className="rounded bg-primary/15 px-0.5 font-medium text-primary underline decoration-primary/50 underline-offset-2"
              >
                {r.a}
              </a>
              {r.t.slice(at + r.a.length)}
            </>
          ) : (
            r.t
          )}
        </p>
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Which page should this reader go to next?</div>
          {r.k.map((k, i) => {
            const chosen = r.j === String(i + 1);
            return (
              <div key={i} className="space-y-0.5">
                <div className="flex justify-between gap-2 text-sm">
                  <a href={U[k[0]][0]} target="_blank" rel="noreferrer" className={cn('truncate hover:underline', chosen && 'font-semibold')} title={U[k[0]][1]}>
                    {pathOf(U[k[0]][0])}
                  </a>
                  <span className="tabular-nums text-muted-foreground">{pct(k[1])}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div
                    className={cn('h-1.5 rounded-full', chosen ? (linked ? 'bg-primary' : 'bg-foreground/50') : 'bg-foreground/20')}
                    style={{ width: `${Math.max(1, k[1] * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
          <div className="space-y-0.5">
            <div className={cn('flex justify-between text-sm', r.j === 'none' && 'font-semibold')}>
              <span>None of these</span>
              <span className="tabular-nums text-muted-foreground">{pct(r.n)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-rose-400/70" style={{ width: `${Math.max(1, r.n * 100)}%` }} />
            </div>
          </div>
        </div>
      </CardContent>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>Confidence <b className="text-foreground">{pct(r.c)}</b></span>
          <span>Link warranted <b className="text-foreground">{pct(r.w)}</b></span>
          <span>Anchor available <b className="text-foreground">{pct(r.v)}</b></span>
          <span>Reader <b className="text-foreground">{r.r || '-'}</b></span>
          <span>Promotional <b className="text-foreground">{pct(r.m)}</b></span>
          {r.rr && <span className="text-amber-700 dark:text-amber-300">{r.rr}</span>}
        </div>
        {linked && (
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant={approval === 'approved' ? 'default' : 'outline'}
              className="h-7"
              onClick={() => onApprove(r.i, approval === 'approved' ? null : 'approved')}
            >
              <Check className="mr-1 h-3.5 w-3.5" />Approve
            </Button>
            <Button
              size="sm"
              variant={approval === 'rejected' ? 'destructive' : 'outline'}
              className="h-7"
              onClick={() => onApprove(r.i, approval === 'rejected' ? null : 'rejected')}
            >
              <X className="mr-1 h-3.5 w-3.5" />Reject
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

type SortKey = 'new' | 'inbound' | 'after';

function PagesTable({ report }: { report: Report }) {
  const U = report.urls;
  const [sort, setSort] = useState<SortKey>('new');
  const rows = useMemo(() => {
    const val = (p: Report['pages'][number]) => (sort === 'new' ? p.new_links : sort === 'inbound' ? p.inbound : p.inbound + p.new_links);
    return [...report.pages].sort((a, b) => val(b) - val(a) || a.inbound - b.inbound);
  }, [report.pages, sort]);
  const head = (key: SortKey, label: string) => (
    <TableHead className="cursor-pointer text-right" onClick={() => setSort(key)}>
      {label}{sort === key ? ' ↓' : ''}
    </TableHead>
  );
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Page</TableHead>
            {head('inbound', 'Inbound now')}
            {head('new', 'New from this plan')}
            {head('after', 'After')}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.u} className={cn(p.inbound <= 1 && 'border-l-[3px] border-l-rose-400')}>
              <TableCell className="max-w-[420px]">
                <a href={U[p.u][0]} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">{pathOf(U[p.u][0])}</a>
                <div className="truncate text-xs text-muted-foreground">{U[p.u][1]}</div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{p.inbound}</TableCell>
              <TableCell className="text-right tabular-nums">
                {p.new_links ? <span className="font-semibold text-primary">+{p.new_links}</span> : <span className="text-muted-foreground">0</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{p.inbound + p.new_links}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function Orphans({ report }: { report: Report }) {
  const U = report.urls;
  const weak = report.pages.filter((p) => p.inbound <= 1).sort((a, b) => a.inbound - b.inbound || b.new_links - a.new_links);
  const fixed = weak.filter((p) => p.new_links > 0).length;
  const orphans = weak.filter((p) => p.inbound === 0).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{orphans}</div><div className="text-sm text-muted-foreground">orphan pages (no in-content links)</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{weak.length - orphans}</div><div className="text-sm text-muted-foreground">pages with only 1 inbound link</div></CardContent></Card>
        <Card className="border-primary/50 bg-primary/5"><CardContent className="p-4"><div className="text-2xl font-bold text-primary">{fixed}</div><div className="text-sm text-muted-foreground">of them gain links from this plan</div></CardContent></Card>
      </div>
      {weak.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Every page already has at least 2 in-content links pointing to it.</p>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Page</TableHead>
                <TableHead className="text-right">Inbound now</TableHead>
                <TableHead className="text-right">New from this plan</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {weak.map((p) => (
                <TableRow key={p.u}>
                  <TableCell className="max-w-[420px]">
                    <a href={U[p.u][0]} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">{pathOf(U[p.u][0])}</a>
                    <div className="truncate text-xs text-muted-foreground">{U[p.u][1]}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.inbound}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.new_links ? <span className="font-semibold text-primary">+{p.new_links}</span> : 0}</TableCell>
                  <TableCell>
                    {p.new_links > 0 ? (
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">Fixed by this plan</span>
                    ) : (
                      <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">
                        {p.passages === 0 ? 'No paragraphs found on page' : 'Still needs links'}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        "Still needs links" pages had no paragraph elsewhere on the site that Jev judged a good fit. Consider writing a
        sentence that introduces them from a related page, or check whether they should be in the sitemap at all.
      </p>
    </div>
  );
}
