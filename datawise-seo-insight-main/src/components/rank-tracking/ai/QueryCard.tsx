import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import {
  fetchAIAnswer, AI_ENGINE_LABELS,
  type AIEngine, type AIEngineResult, type AITrackedQuery,
} from '@/lib/ai-tracking';
import RecommendationBlock from './RecommendationBlock';

export const AI_ENGINE_SHORT_LABELS: Record<AIEngine, string> = {
  google_ai_mode: 'Google AI',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
};

export function StatusBadge({ result, label }: { result?: AIEngineResult; label?: string }) {
  const prefix = label ? `${label} · ` : '';
  if (!result) return <span className="text-xs text-muted-foreground">{prefix}--</span>;
  switch (result.status) {
    case 'cited':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100" title={result.cited_url || undefined}>
          {prefix}Cited{result.citation_position ? ` #${result.citation_position}` : ''}
        </Badge>
      );
    case 'mentioned':
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" title={result.answer_excerpt || undefined}>{prefix}Mentioned</Badge>;
    case 'absent':
      return <Badge variant="secondary" className="text-muted-foreground">{prefix}Absent</Badge>;
    case 'no_answer':
      return <Badge variant="outline" className="text-muted-foreground">{prefix}No AI answer</Badge>;
    default:
      return <Badge variant="outline" className="text-red-600 border-red-200">{prefix}Error</Badge>;
  }
}

function normalizeDomain(value: string) {
  return value.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/^www\./, '').split('/')[0].toLowerCase();
}

function isOwnDomain(citationDomain: string, projectDomain: string) {
  const c = normalizeDomain(citationDomain);
  const p = normalizeDomain(projectDomain);
  return c === p || c.endsWith(`.${p}`);
}

function pathnameOf(url: string | null) {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return null; }
}

function EngineEvidence({ engine, result, projectDomain }: { engine: AIEngine; result: AIEngineResult; projectDomain: string }) {
  const [showAll, setShowAll] = useState(false);
  const citations = result.citations || [];
  const visible = showAll ? citations : citations.slice(0, 5);
  const header = result.status === 'absent'
    ? `${AI_ENGINE_LABELS[engine]} cited instead of you`
    : `${AI_ENGINE_LABELS[engine]} citations`;
  return (
    <div className="border rounded-lg p-3">
      <p className="text-xs font-bold mb-1.5">{header}</p>
      {citations.length === 0 ? (
        <p className="text-xs text-muted-foreground">No citations in this answer</p>
      ) : (
        <ol className="list-decimal ml-4 space-y-0.5 text-xs">
          {visible.map((citation, i) => {
            const path = pathnameOf(citation.url);
            const you = isOwnDomain(citation.domain, projectDomain);
            return (
              <li key={`${citation.domain}-${i}`} className={you ? 'bg-emerald-100 rounded px-1 font-semibold' : ''}>
                {citation.domain}{you ? ' (you)' : ''}
                {path && <span className="text-muted-foreground"> {path}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {citations.length > 5 && !showAll && (
        <button type="button" className="mt-1.5 text-xs font-semibold text-[#005232]" onClick={() => setShowAll(true)}>
          Show all {citations.length}
        </button>
      )}
    </div>
  );
}

interface QueryCardProps {
  query: AITrackedQuery;
  engines: AIEngine[];
  projectDomain: string;
  onDelete: (queryId: string) => void;
}

type AnswerState = { open: boolean; loading: boolean; text?: string | null };

export default function QueryCard({ query, engines, projectDomain, onDelete }: QueryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [answers, setAnswers] = useState<Partial<Record<AIEngine, AnswerState>>>({});

  const enginesWithResults = engines.filter(e => query.engines[e]);

  const toggleAnswer = async (engine: AIEngine, checkId: number) => {
    const current = answers[engine];
    if (current && current.text !== undefined) {
      setAnswers(prev => ({ ...prev, [engine]: { ...current, open: !current.open } }));
      return;
    }
    setAnswers(prev => ({ ...prev, [engine]: { open: true, loading: true } }));
    try {
      const { answer_text } = await fetchAIAnswer(checkId);
      setAnswers(prev => ({ ...prev, [engine]: { open: true, loading: false, text: answer_text } }));
    } catch {
      setAnswers(prev => ({ ...prev, [engine]: { open: false, loading: false } }));
    }
  };

  return (
    <div className="rounded-xl border bg-card">
      <div
        role="button"
        tabIndex={0}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer"
        onClick={() => setExpanded(v => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}
      >
        <span className="font-medium text-sm">{query.query_text}</span>
        <span className="flex items-center gap-1.5 flex-wrap justify-end">
          {engines.map(engine => (
            <StatusBadge key={engine} result={query.engines[engine]} label={AI_ENGINE_SHORT_LABELS[engine]} />
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); onDelete(query.id); }}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </span>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {query.recommendation && <RecommendationBlock recommendation={query.recommendation} />}
          {enginesWithResults.length > 0 && (
            <div className="grid md:grid-cols-2 gap-3">
              {enginesWithResults.map(engine => (
                <EngineEvidence key={engine} engine={engine} result={query.engines[engine]!} projectDomain={projectDomain} />
              ))}
            </div>
          )}
          {enginesWithResults.filter(e => query.engines[e]?.check_id).map(engine => {
            const checkId = query.engines[engine]!.check_id!;
            const state = answers[engine];
            return (
              <div key={engine}>
                <button type="button" className="text-xs font-semibold text-[#005232]" onClick={() => void toggleAnswer(engine, checkId)}>
                  {state?.loading ? 'Loading answer...' : `Read ${AI_ENGINE_LABELS[engine]}'s full answer`}
                </button>
                {state?.open && !state.loading && (
                  <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground border rounded-lg p-3">
                    {state.text ?? "Answer text is not stored for checks made before today's update. It will appear after the next check."}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
