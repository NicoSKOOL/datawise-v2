import { Fragment, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Download, ExternalLink, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { downloadCsv } from '@/lib/planner-export';
import { csvFilename, rowsToCsv, type CsvColumn } from '@/lib/table-csv';
import {
  getReport, setApproval,
  type Approval, type InternalLinksReport as Report, type ReportRow,
} from '@/lib/internal-links';
import { cn } from '@/lib/utils';

// One table, three tabs by how certain Jev is. Colors validated for
// colour-blind separation and contrast (dataviz validate_palette, 2026-10-02).
type Bucket = 'sure' | 'review' | 'unsure';
const BUCKETS: Record<Bucket, { name: string; note: string; color: string }> = {
  sure: { name: 'Sure', note: 'Add these as they are', color: '#1f8a5b' },
  review: { name: 'Needs review', note: 'Read the paragraph first', color: '#c8901e' },
  unsure: { name: 'Not sure', note: 'Possible link, write your own keyword', color: '#6a7fc0' },
};
const ORDER: Bucket[] = ['sure', 'review', 'unsure'];
// "Not sure" = Jev leaned towards a page but stayed under the 70% bar. Below
// 50% it is closer to a guess than a suggestion, so those are left out.
const UNSURE_FLOOR = 0.5;
const PAGE = 30;

const STAGE: Record<string, string> = {
  learning: 'is still learning the topic',
  comparing: 'is comparing options',
  ready: 'is ready to act',
};

interface Item {
  row: ReportRow;
  bucket: Bucket;
  src: string;
  srcTitle: string;
  tgt: string;
  tgtTitle: string;
  inbound: number;
  why: string[];
}

const pathOf = (url: string) => {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return url;
  }
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

function bucketOf(r: ReportRow): Bucket | null {
  if (r.o === 'linked_apply') return 'sure';
  if (r.o === 'linked_review') return 'review';
  if (r.o === 'low_confidence' && r.j && r.j !== 'none' && (r.c ?? 0) >= UNSURE_FLOOR) return 'unsure';
  return null;
}

function buildItems(report: Report): Item[] {
  const U = report.urls;
  const minConf = report.summary.thresholds.min_confidence;
  const auto = report.summary.thresholds.auto_approve_confidence;
  const items: Item[] = [];
  for (const r of report.rows) {
    const bucket = bucketOf(r);
    if (!bucket) continue;
    const pick = r.k[Number(r.j) - 1];
    if (!pick) continue;
    const conf = r.c ?? 0;
    const why = [`Jev is ${pct(conf)} sure this is the page a reader wants next, out of ${r.k.length} candidates.`];
    if (STAGE[r.r]) why.push(`The reader of this paragraph ${STAGE[r.r]}, and the linked page goes deeper on that topic.`);
    if (pick[3] <= 1) {
      why.push(`The linked page has only ${pick[3]} link${pick[3] === 1 ? '' : 's'} pointing to it from your content, so it needs the help.`);
    }
    if (bucket === 'review') {
      why.push(r.rr
        ? "The keyword doesn't share a topic word with the linked page, so read it once before adding."
        : `Confidence is below the ${pct(auto)} bar for adding without a check.`);
    }
    if (bucket === 'unsure') {
      const runner = r.k.filter((k) => k !== pick).sort((a, b) => b[1] - a[1])[0];
      why.push(`It is under the ${pct(minConf)} bar, so no keyword was picked.${runner ? ` Runner-up: ${pathOf(U[runner[0]][0])} at ${pct(runner[1])}.` : ''}`);
    }
    items.push({
      row: r,
      bucket,
      src: U[r.s][0],
      srcTitle: U[r.s][1],
      tgt: U[pick[0]][0],
      tgtTitle: U[pick[0]][1],
      inbound: pick[3],
      why,
    });
  }
  return items.sort((a, b) => (b.row.c ?? 0) - (a.row.c ?? 0));
}

export function InternalLinksReport({ runId }: { runId: string }) {
  const { toast } = useToast();
  const q = useQuery({ queryKey: ['internal-link-report', runId], queryFn: () => getReport(runId), staleTime: Infinity });
  const [approvals, setApprovals] = useState<Record<string, Approval> | null>(null);
  const current = approvals ?? q.data?.approvals ?? {};

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading report...</p>;
  if (q.error || !q.data) return <p className="text-sm text-destructive">{(q.error as Error)?.message ?? 'Report not found'}</p>;

  const toggleAdded = async (rowId: number) => {
    const prev = current;
    const value: Approval | null = current[rowId] === 'added' ? null : 'added';
    const next = { ...current };
    if (value) next[rowId] = value;
    else delete next[rowId];
    setApprovals(next);
    try {
      setApprovals((await setApproval(runId, rowId, value)).approvals);
    } catch (err) {
      setApprovals(prev);
      toast({ variant: 'destructive', title: 'Could not save', description: (err as Error).message });
    }
  };

  return <ReportTable report={q.data.report} approvals={current} onToggleAdded={toggleAdded} />;
}

function ReportTable({
  report,
  approvals,
  onToggleAdded,
}: {
  report: Report;
  approvals: Record<string, Approval>;
  onToggleAdded: (rowId: number) => void;
}) {
  const { toast } = useToast();
  const S = report.summary;
  const items = useMemo(() => buildItems(report), [report]);
  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { sure: 0, review: 0, unsure: 0 };
    for (const i of items) c[i.bucket]++;
    return c;
  }, [items]);
  const [tab, setTab] = useState<Bucket>('sure');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const switchTab = (b: Bucket) => {
    setTab(b);
    setOpen(null);
    setLimit(PAGE);
  };

  const list = useMemo(() => {
    const ql = query.trim().toLowerCase();
    return items.filter(
      (i) =>
        i.bucket === tab &&
        (!ql || `${i.row.a} ${i.src} ${i.tgt} ${i.tgtTitle} ${i.srcTitle}`.toLowerCase().includes(ql))
    );
  }, [items, tab, query]);
  const addedHere = list.filter((i) => approvals[i.row.i] === 'added').length;
  const site = S.site.replace(/^https?:\/\/(www\.)?/, '');

  const copyLink = (i: Item) => {
    navigator.clipboard?.writeText(`<a href="${pathOf(i.tgt)}">${i.row.a}</a>`);
    toast({ title: 'Link HTML copied' });
  };

  const exportCsv = () => {
    const cols: CsvColumn<Item>[] = [
      { label: 'Certainty', value: (i) => BUCKETS[i.bucket].name },
      { label: 'Page', value: (i) => i.src },
      { label: 'Paragraph #', value: (i) => i.row.p + 1 },
      { label: 'Keyword', value: (i) => i.row.a },
      { label: 'Recommended link', value: (i) => i.tgt },
      { label: 'Jev confidence', value: (i) => pct(i.row.c ?? 0) },
      { label: 'Added', value: (i) => (approvals[i.row.i] === 'added' ? 'yes' : '') },
      { label: 'Why', value: (i) => i.why.join(' ') },
      { label: 'Paragraph', value: (i) => i.row.t },
    ];
    downloadCsv(csvFilename('internal-links', site, BUCKETS[tab].name), rowsToCsv(cols, list));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <h2 className="font-headline text-2xl font-extrabold tracking-tight">Internal links for {site}</h2>
          <p className="mt-1 text-muted-foreground">
            Jev read {S.decisions.toLocaleString()} paragraphs across {S.pages.toLocaleString()} pages and suggested
            where to link. Cost ${S.cost_usd.toFixed(2)}.
          </p>
        </div>
        <CertaintyDonut counts={counts} onSelect={switchTab} />
      </div>

      <div role="tablist" className="grid grid-cols-1 gap-1.5 rounded-xl bg-muted/70 p-1.5 md:grid-cols-3">
        {ORDER.map((b) => {
          const active = tab === b;
          return (
            <button
              key={b}
              role="tab"
              aria-selected={active}
              onClick={() => switchTab(b)}
              className={cn(
                'grid grid-cols-[auto_1fr] items-center gap-x-2.5 rounded-lg px-4 py-3 text-left transition-colors',
                active ? 'bg-background shadow-sm' : 'hover:bg-background/50'
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: BUCKETS[b].color }} />
              <span className="flex items-center justify-between font-headline text-[15px] font-bold">
                {BUCKETS[b].name}
                <span className={cn('font-body text-sm font-semibold tabular-nums', !active && 'text-muted-foreground')}
                  style={active ? { color: BUCKETS[b].color } : undefined}>
                  {counts[b].toLocaleString()}
                </span>
              </span>
              <span className="col-start-2 text-xs text-muted-foreground">{BUCKETS[b].note}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Search keyword, page or link"
            className="bg-background pl-8"
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">
          {list.length.toLocaleString()} shown, {addedHere} added
        </span>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!list.length}>
          <Download className="mr-1.5 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-background">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-left text-xs font-semibold text-muted-foreground">
              <th className="w-9 px-3 py-2.5" />
              <th className="px-4 py-2.5">Page</th>
              <th className="px-4 py-2.5">Keyword</th>
              <th className="hidden px-4 py-2.5 md:table-cell">Recommended link</th>
              <th className="px-4 py-2.5">Jev</th>
              <th className="w-[72px] px-4 py-2.5">Added</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((i) => {
              const isOpen = open === i.row.i;
              const added = approvals[i.row.i] === 'added';
              const color = BUCKETS[i.bucket].color;
              return (
                <Fragment key={i.row.i}>
                  <tr
                    tabIndex={0}
                    onClick={() => setOpen(isOpen ? null : i.row.i)}
                    onKeyDown={(e) => e.key === 'Enter' && setOpen(isOpen ? null : i.row.i)}
                    className={cn(
                      'cursor-pointer border-b transition-colors',
                      isOpen ? 'border-transparent bg-accent' : 'hover:bg-muted/30'
                    )}
                  >
                    <td className="px-3 py-3 text-muted-foreground">
                      <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} />
                    </td>
                    <td className={cn('max-w-[280px] px-4 py-3', added && 'opacity-50')}>
                      <div className="truncate font-semibold">{i.srcTitle || pathOf(i.src)}</div>
                      <div className="truncate text-xs text-muted-foreground">{pathOf(i.src)}</div>
                    </td>
                    <td className={cn('px-4 py-3', added && 'opacity-50')}>
                      {i.row.a ? (
                        <span className="inline-block max-w-[240px] truncate rounded-md bg-accent px-2.5 py-1 align-middle font-semibold text-primary">
                          {i.row.a}
                        </span>
                      ) : (
                        <span className="inline-block rounded-md bg-muted px-2.5 py-1 italic text-muted-foreground">none picked</span>
                      )}
                    </td>
                    <td className="hidden max-w-[300px] px-4 py-3 md:table-cell">
                      <div className="truncate">{i.tgtTitle || pathOf(i.tgt)}</div>
                      <div className="truncate text-xs text-muted-foreground">{pathOf(i.tgt)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 whitespace-nowrap font-semibold tabular-nums">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: pct(i.row.c ?? 0), background: color }} />
                        </div>
                        {pct(i.row.c ?? 0)}
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={added}
                        onChange={() => onToggleAdded(i.row.i)}
                        aria-label="Mark as added to the page"
                        className="h-[17px] w-[17px] cursor-pointer accent-primary"
                      />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b bg-accent">
                      <td colSpan={6} className="px-4 pb-5">
                        <ExpandedRow item={i} color={color} onCopy={() => copyLink(i)} report={report} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  {query ? 'Nothing matches that search.' : 'Jev has no suggestions in this group.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {list.length > limit && (
        <div className="flex justify-center">
          <Button variant="ghost" className="text-primary" onClick={() => setLimit((l) => l + PAGE)}>
            Show {Math.min(PAGE, list.length - limit)} more
          </Button>
        </div>
      )}
    </div>
  );
}

function ExpandedRow({ item: i, color, onCopy, report }: { item: Item; color: string; onCopy: () => void; report: Report }) {
  const U = report.urls;
  const at = i.row.a ? i.row.t.indexOf(i.row.a) : -1;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-xl border border-primary/15 bg-background p-5">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Paragraph {i.row.p + 1} on {pathOf(i.src)}
        </div>
        <p className="text-[15.5px] leading-7">
          {at >= 0 ? (
            <>
              {i.row.t.slice(0, at)}
              <mark className="rounded bg-accent px-0.5 font-semibold text-primary shadow-[inset_0_-2px_0_hsl(var(--primary))]">
                {i.row.a}
              </mark>
              {i.row.t.slice(at + i.row.a.length)}
            </>
          ) : (
            i.row.t
          )}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={i.src} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open page
            </a>
          </Button>
          {i.row.a && (
            <Button size="sm" onClick={onCopy}>
              Copy link HTML
            </Button>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-primary/15 bg-background p-5">
        <div className="mb-2 text-xs font-medium text-muted-foreground">Why</div>
        <ul className="m-0 list-none space-y-1.5 p-0 text-sm">
          {i.why.map((w) => (
            <li key={w} className="flex gap-2.5">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
              {w}
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-1 text-xs text-muted-foreground">
          {[...i.row.k].sort((a, b) => b[1] - a[1]).map((k) => {
            const url = U[k[0]][0];
            const chosen = url === i.tgt;
            return (
              <div key={k[0]} className={cn('flex justify-between gap-3', chosen && 'font-semibold text-foreground')}>
                <span className="truncate">{pathOf(url)}</span>
                <span className="tabular-nums">{pct(k[1])}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Small donut of the three groups. Click a slice to open that tab.
function CertaintyDonut({ counts, onSelect }: { counts: Record<Bucket, number>; onSelect: (b: Bucket) => void }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const sum = ORDER.reduce((s, b) => s + counts[b], 0);
  if (!sum) return null;

  const R = 34, r = 21, cx = 40, cy = 40, gap = 0.035;
  const pt = (rad: number, a: number) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
  let a0 = -Math.PI / 2;
  const slices = ORDER.filter((b) => counts[b] > 0).map((b) => {
    const sweep = (counts[b] / sum) * Math.PI * 2;
    // A single non-empty group draws as a full ring.
    const full = sweep >= Math.PI * 2 - 1e-6;
    const s0 = a0 + (full ? 0 : gap / 2);
    const s1 = a0 + sweep - (full ? 0.0001 : gap / 2);
    a0 += sweep;
    const big = s1 - s0 > Math.PI ? 1 : 0;
    const d = `M ${pt(R, s0)} A ${R} ${R} 0 ${big} 1 ${pt(R, s1)} L ${pt(r, s1)} A ${r} ${r} 0 ${big} 0 ${pt(r, s0)} Z`;
    return { b, d, label: `${BUCKETS[b].name}: ${counts[b].toLocaleString()} (${Math.round((counts[b] / sum) * 100)}%)` };
  });

  return (
    <figure ref={box} className="relative m-0 flex items-center gap-3.5" aria-label="Share of suggestions by certainty">
      <svg width="80" height="80" viewBox="0 0 80 80" className="group">
        {slices.map((s) => (
          <path
            key={s.b}
            d={s.d}
            fill={BUCKETS[s.b].color}
            tabIndex={0}
            role="button"
            aria-label={s.label}
            className="cursor-pointer outline-none transition-opacity group-hover:opacity-55 hover:!opacity-100 focus:!opacity-100"
            onClick={() => onSelect(s.b)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(s.b)}
            onMouseMove={(e) => {
              const rect = box.current!.getBoundingClientRect();
              setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: s.label });
            }}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      <ul className="m-0 grid list-none gap-0.5 p-0 text-xs text-muted-foreground">
        {ORDER.map((b) => (
          <li key={b} className="grid grid-cols-[9px_auto_36px] items-center gap-2">
            <i className="h-[9px] w-[9px] rounded-sm" style={{ background: BUCKETS[b].color }} />
            {BUCKETS[b].name}
            <b className="text-right font-semibold tabular-nums text-foreground">{Math.round((counts[b] / sum) * 100)}%</b>
          </li>
        ))}
      </ul>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[115%] whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs text-background"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </figure>
  );
}
