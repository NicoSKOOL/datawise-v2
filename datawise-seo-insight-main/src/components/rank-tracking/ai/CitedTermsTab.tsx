import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchLlmSearch, type LlmSearchRow, type LlmSource } from '@/lib/llm-mentions';

interface CitedTermsTabProps {
  domain: string;
  trackedQueryTexts: Set<string>;
  onTrack: (text: string) => Promise<void>;
}

function normalizeDomain(value: string) {
  return value.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/^www\./, '').split('/')[0].toLowerCase();
}

function ownPagePath(sources: LlmSource[] | undefined, domain: string): string {
  if (!sources?.length) return '-';
  const target = normalizeDomain(domain);
  for (const source of sources) {
    const sourceDomain = source.domain ? normalizeDomain(source.domain) : source.url ? normalizeDomain(source.url) : '';
    if (!sourceDomain || (sourceDomain !== target && !sourceDomain.endsWith(`.${target}`))) continue;
    if (source.url) {
      try { return new URL(source.url).pathname; } catch { return source.url; }
    }
    return '/';
  }
  return '-';
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function CitedTermsTab({ domain, trackedQueryTexts, onTrack }: CitedTermsTabProps) {
  const [rows, setRows] = useState<LlmSearchRow[] | null>(null);
  const [error, setError] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchLlmSearch({ target: [{ domain, include_subdomains: true }], limit: 50 });
        if (!cancelled) setRows(result.items || []);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [domain]);

  const sorted = useMemo(
    () => (rows || [])
      .filter(row => row.question)
      .sort((a, b) => (b.ai_search_volume ?? 0) - (a.ai_search_volume ?? 0)),
    [rows],
  );

  if (error) return <p className="text-sm text-muted-foreground">Could not load AI citation data.</p>;
  if (rows === null) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map(i => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  }
  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No AI answers citing {domain} found in the database yet.</p>;
  }

  const visible = showAll ? sorted : sorted.slice(0, 10);

  const track = async (question: string) => {
    setPending(question);
    try { await onTrack(question); } finally { setPending(null); }
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-secondary/50 text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">AI query</th>
              <th className="px-4 py-2 font-medium">Platform</th>
              <th className="px-4 py-2 font-medium">AI volume</th>
              <th className="px-4 py-2 font-medium">Your page</th>
              <th className="px-4 py-2 w-24" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const question = row.question!;
              const tracked = trackedQueryTexts.has(question.trim().toLowerCase());
              return (
                <tr key={`${question}-${i}`} className="border-b last:border-0">
                  <td className="px-4 py-2">{question}</td>
                  <td className="px-4 py-2">{capitalize(row.platform || row.model_name || '-')}</td>
                  <td className="px-4 py-2 tabular-nums">{row.ai_search_volume?.toLocaleString() ?? '-'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{ownPagePath(row.sources, domain)}</td>
                  <td className="px-4 py-2 text-right">
                    {tracked ? (
                      <Button size="sm" variant="secondary" disabled>Tracked</Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={pending === question} onClick={() => void track(question)}>
                        {pending === question ? 'Adding...' : '+ Track'}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > 10 && !showAll && (
        <button type="button" className="text-xs font-semibold text-[#005232]" onClick={() => setShowAll(true)}>
          Show all {sorted.length}
        </button>
      )}
    </div>
  );
}
