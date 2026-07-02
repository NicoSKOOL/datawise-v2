import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  fetchAIAnswer,
  AI_ENGINE_LABELS, AI_ENGINE_SHORT_LABELS, AI_ENGINE_COLORS, AI_ENGINE_ORDER, AI_OUTCOME_COLORS,
  type AIEngine, type AIEngineResult, type AITrackedQuery,
} from '@/lib/ai-tracking';

interface AnswerStatusMatrixProps {
  queries: AITrackedQuery[];
  engines: AIEngine[];
  projectDomain: string;
  maxQueries: number;
  quickAddOptions: string[];
  onAdd: (texts: string[]) => Promise<void>;
  onDelete: (queryId: string) => void;
}

function normalizeDomain(value: string) {
  return value.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/^www\./, '').split('/')[0].toLowerCase();
}

function isOwnDomain(citationDomain: string, projectDomain: string) {
  const c = normalizeDomain(citationDomain);
  const p = normalizeDomain(projectDomain);
  return c === p || c.endsWith(`.${p}`);
}

// One matrix cell: solid green with the citation position, soft green for a
// mention, near-white for absent. Statuses read without color via the label.
function Cell({ result }: { result?: AIEngineResult }) {
  const base = 'flex h-10 items-center justify-center rounded-lg text-xs font-bold';
  if (!result) return <div className={`${base} border border-dashed border-border text-muted-foreground/60`} title="Not checked yet">·</div>;
  switch (result.status) {
    case 'cited':
      return (
        <div className={`${base} text-white`} style={{ background: AI_OUTCOME_COLORS.cited }} title={result.cited_url || 'Cited'}>
          {result.citation_position ? `#${result.citation_position}` : 'Cited'}
        </div>
      );
    case 'mentioned':
      return <div className={`${base} text-[#0F4A28]`} style={{ background: AI_OUTCOME_COLORS.mentioned }} title={result.answer_excerpt || 'Mentioned, not linked'}>Ment.</div>;
    case 'absent':
      return <div className={`${base} border border-border text-muted-foreground/70`} style={{ background: AI_OUTCOME_COLORS.absent }}>-</div>;
    case 'no_answer':
      return <div className={`${base} border border-border text-muted-foreground/70`} style={{ background: AI_OUTCOME_COLORS.absent }} title="The engine returned no usable answer">n/a</div>;
    default:
      return <div className={`${base} border border-red-200 bg-red-50 text-red-500`} title="Check failed; it will retry on the next run">err</div>;
  }
}

const PRIORITY_PILL: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#F9EDE0', fg: '#C97A1E' },
  medium: { bg: '#FAF3DF', fg: '#A67A12' },
  low: { bg: '#F1F4F2', fg: '#5A6968' },
};

const STATUS_META: Record<string, { text: string; fg: string }> = {
  cited: { text: 'Cited', fg: '#166337' },
  mentioned: { text: 'Mentioned', fg: '#3A7A55' },
  absent: { text: 'Absent', fg: '#7E8C8A' },
  no_answer: { text: 'No answer', fg: '#7E8C8A' },
  error: { text: 'Error', fg: '#DC2626' },
};

type AnswerState = { open: boolean; loading: boolean; text?: string | null };

// Per-engine proof column inside an expanded row: status, the mention excerpt
// when there is one, the answer's citation list, and the full-answer toggle.
function EngineDetail({ engine, result, projectDomain }: { engine: AIEngine; result?: AIEngineResult; projectDomain: string }) {
  const [answer, setAnswer] = useState<AnswerState>({ open: false, loading: false });
  const [showAll, setShowAll] = useState(false);

  const toggleAnswer = async () => {
    if (!result?.check_id) return;
    if (answer.text !== undefined) { setAnswer(a => ({ ...a, open: !a.open })); return; }
    setAnswer({ open: true, loading: true });
    try {
      const { answer_text } = await fetchAIAnswer(result.check_id);
      setAnswer({ open: true, loading: false, text: answer_text });
    } catch {
      setAnswer({ open: false, loading: false });
    }
  };

  const meta = result ? STATUS_META[result.status] : null;
  const citations = result?.citations || [];
  const visible = showAll ? citations : citations.slice(0, 5);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-1.5 text-xs font-bold">
        <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: AI_ENGINE_COLORS[engine] }} />
        {AI_ENGINE_SHORT_LABELS[engine]}
        {meta && (
          <span className="font-semibold" style={{ color: meta.fg }}>
            · {result!.status === 'cited' && result!.citation_position ? `Cited · #${result!.citation_position}` : meta.text}
          </span>
        )}
        {!result && <span className="font-semibold text-muted-foreground">· not checked yet</span>}
      </div>

      {result?.answer_excerpt && (
        <div className="rounded-lg border bg-card px-3 py-2 text-xs italic leading-relaxed text-foreground/80">{result.answer_excerpt}</div>
      )}

      {result && (
        <>
          <div className="text-[11px] font-semibold text-muted-foreground">
            {citations.length === 0 ? 'No sources cited in this answer' : result.status === 'absent' ? 'Cited instead of you' : 'Sources this answer cited'}
          </div>
          {citations.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {visible.map((cite, i) => {
                const you = isOwnDomain(cite.domain, projectDomain);
                return (
                  <span
                    key={`${cite.domain}-${i}`}
                    title={cite.url || cite.domain}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${you ? 'border-[#A9D9B9] bg-[#E9F3EC] text-[#166337]' : 'border-border bg-card text-muted-foreground'}`}
                  >
                    {cite.position} · {cite.domain}{you ? ' (you)' : ''}
                  </span>
                );
              })}
              {citations.length > 5 && !showAll && (
                <button type="button" className="text-[11px] font-semibold text-[#166337]" onClick={() => setShowAll(true)}>
                  +{citations.length - 5} more
                </button>
              )}
            </div>
          )}
          {result.check_id && (
            <button type="button" className="self-start text-[11px] font-semibold text-[#1F7A43] hover:text-[#166337]" onClick={() => void toggleAnswer()}>
              {answer.loading ? 'Loading answer…' : answer.open ? 'Hide full answer' : 'View full answer →'}
            </button>
          )}
          {answer.open && !answer.loading && (
            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-card p-3 text-xs text-muted-foreground">
              {answer.text ?? 'Answer text is not stored for checks made before this feature shipped. It will appear after the next check.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The v2 "Answer Status Matrix": query rows by engine columns, each cell the
// latest classification, a 0-100 score per row, and expandable proof.
export default function AnswerStatusMatrix({
  queries, engines, projectDomain, maxQueries, quickAddOptions, onAdd, onDelete,
}: AnswerStatusMatrixProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newQuery, setNewQuery] = useState('');
  const orderedEngines = AI_ENGINE_ORDER.filter(e => engines.includes(e));
  const atCap = queries.length >= maxQueries;

  const gridCols = { gridTemplateColumns: `minmax(0,1fr) repeat(${orderedEngines.length}, 88px) 56px` };

  const rows = useMemo(() => queries.map(query => {
    let cited = 0;
    let mentioned = 0;
    let total = 0;
    for (const engine of orderedEngines) {
      const result = query.engines[engine];
      if (!result || result.status === 'error') continue;
      total += 1;
      if (result.status === 'cited') cited += 1;
      if (result.status === 'mentioned') mentioned += 1;
    }
    const score = total > 0 ? Math.round((100 * (cited + 0.5 * mentioned)) / total) : null;
    return { query, score };
  }), [queries, orderedEngines]);

  const submit = async () => {
    if (!newQuery.trim()) return;
    await onAdd([newQuery]);
    setNewQuery('');
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Answer status matrix</div>
            <p className="mt-0.5 text-xs text-muted-foreground">Every tracked query on every engine, latest check. Click a row for proof.</p>
          </div>
          <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ background: AI_OUTCOME_COLORS.cited }} />Cited</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded" style={{ background: AI_OUTCOME_COLORS.mentioned }} />Mentioned</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-border" style={{ background: AI_OUTCOME_COLORS.absent }} />Absent</span>
          </div>
        </div>

        {queries.length > 0 && (
          <div className="grid items-end gap-2 px-1" style={gridCols}>
            <div />
            {orderedEngines.map(engine => (
              <div key={engine} className="flex flex-col items-center gap-1 text-[11px] font-bold">
                <span className="h-2 w-2 rounded-full" style={{ background: AI_ENGINE_COLORS[engine] }} />
                {AI_ENGINE_SHORT_LABELS[engine]}
              </div>
            ))}
            <div className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Score</div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {rows.map(({ query, score }) => {
            const isOpen = expandedId === query.id;
            return (
              <div key={query.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedId(isOpen ? null : query.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isOpen ? null : query.id); } }}
                  className={`grid cursor-pointer items-center gap-2 rounded-lg p-1 transition-colors hover:bg-secondary/50 ${isOpen ? 'bg-secondary/50' : ''}`}
                  style={gridCols}
                >
                  <div className="flex min-w-0 items-center gap-2 pl-1">
                    <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <span className="truncate text-[13px] font-semibold">{query.query_text}</span>
                    <span className="flex-shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{query.source}</span>
                  </div>
                  {orderedEngines.map(engine => <Cell key={engine} result={query.engines[engine]} />)}
                  <div
                    className="text-center text-sm font-extrabold tabular-nums"
                    style={{ color: score === null ? '#AAB5B3' : score >= 50 ? '#1F7A43' : score > 0 ? '#4E9E6F' : '#AAB5B3' }}
                  >
                    {score === null ? '·' : score}
                  </div>
                </div>

                {isOpen && (
                  <div className="mx-1 mt-1 flex flex-col gap-4 rounded-xl bg-secondary/40 p-4">
                    <div className="grid gap-5 md:grid-cols-3">
                      {orderedEngines.map(engine => (
                        <EngineDetail key={engine} engine={engine} result={query.engines[engine]} projectDomain={projectDomain} />
                      ))}
                    </div>
                    <div className="flex items-start gap-2.5 border-t pt-3">
                      {query.recommendation ? (
                        <>
                          <span
                            className="mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                            style={{ background: PRIORITY_PILL[query.recommendation.priority].bg, color: PRIORITY_PILL[query.recommendation.priority].fg }}
                          >
                            {query.recommendation.priority}
                          </span>
                          <p className="text-xs leading-relaxed text-foreground/80">
                            <b>{query.recommendation.title}</b>: {query.recommendation.body}
                          </p>
                        </>
                      ) : <span />}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 flex-shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
                        onClick={(e) => { e.stopPropagation(); onDelete(query.id); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Stop tracking
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {queries.length === 0 && (
            <p className="px-1 py-3 text-sm text-muted-foreground">
              Add up to {maxQueries} queries, phrased the way customers ask AI assistants. Your first check runs automatically as soon as you add them.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{queries.length} of {maxQueries} used</span>
            {!atCap && (
              <div className="ml-auto flex w-full max-w-xl gap-2">
                <Input
                  className="h-9"
                  value={newQuery}
                  onChange={(e) => setNewQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                  placeholder='Add a query, e.g. "best rank tracking tool for small agencies"'
                />
                <Button variant="secondary" className="h-9" onClick={() => void submit()} disabled={!newQuery.trim()}>
                  <Plus className="mr-1 h-4 w-4" /> Add
                </Button>
              </div>
            )}
          </div>
          {!atCap && quickAddOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">From tracked keywords:</span>
              {quickAddOptions.map(kw => (
                <button
                  key={kw}
                  type="button"
                  onClick={() => void onAdd([kw])}
                  className="rounded-full border bg-secondary/50 px-2 py-0.5 text-xs transition-colors hover:bg-secondary"
                >
                  + {kw}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
