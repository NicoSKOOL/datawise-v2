import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Trophy, Target, Sparkles, Check, MapPin } from 'lucide-react';
import { runLocalKeywordDiscovery, type LocalDiscoveredKeyword, type LocalKeywordDiscovery } from '@/lib/local-seo';

interface LocalKeywordDiscoveryPanelProps {
  projectId: string;
  locationCode: number;
  languageCode?: string;
  onAdd: (keywords: string[], locationCode: number, languageCode: string) => Promise<void>;
  onOpenManual: () => void;
}

type Bucket = 'ranking' | 'close' | 'expansion';

const BUCKETS: { key: Bucket; title: string; subtitle: string; Icon: typeof Trophy; iconClass: string }[] = [
  { key: 'ranking', title: "You're already ranking", subtitle: 'In the Local Pack (positions 1–3). Track these to monitor what already works.', Icon: Trophy, iconClass: 'text-green-600' },
  { key: 'close', title: "You're close", subtitle: 'Showing in Maps at positions 4–20. A few wins away from the Local Pack.', Icon: Target, iconClass: 'text-amber-600' },
  { key: 'expansion', title: 'Expansion ideas', subtitle: 'High-intent local searches you don\'t show up for yet.', Icon: Sparkles, iconClass: 'text-primary' },
];

export default function LocalKeywordDiscoveryPanel({
  projectId, locationCode, languageCode = 'en', onAdd, onOpenManual,
}: LocalKeywordDiscoveryPanelProps) {
  const [data, setData] = useState<LocalKeywordDiscovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    runLocalKeywordDiscovery(projectId)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        // Pre-select everything we're already ranking for — easy wins.
        const preselect = new Set<string>();
        for (const k of result.ranking) preselect.add(k.keyword);
        setSelected(preselect);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not run keyword discovery.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  const toggle = (kw: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw);
      else next.add(kw);
      return next;
    });
  };

  const toggleBucket = (items: LocalDiscoveredKeyword[]) => {
    const allSelected = items.every((k) => selected.has(k.keyword));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of items) {
        if (allSelected) next.delete(k.keyword);
        else next.add(k.keyword);
      }
      return next;
    });
  };

  const handleAdd = async () => {
    const keywords = Array.from(selected);
    if (keywords.length === 0) return;
    setAdding(true);
    try {
      await onAdd(keywords, locationCode, languageCode);
      setSelected(new Set());
    } finally {
      setAdding(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 flex flex-col items-center justify-center text-center gap-3 min-h-[260px]">
        <RefreshCw className="h-5 w-5 animate-spin text-primary" />
        <div>
          <p className="text-sm font-medium">Finding the keywords this business already ranks for…</p>
          <p className="text-xs text-muted-foreground mt-1">Checking the Local Pack across ~25 candidates. This takes a few seconds.</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 text-center text-muted-foreground space-y-2">
        <p className="text-sm">{error || 'No data returned.'}</p>
        <Button variant="outline" size="sm" onClick={onOpenManual}>Add keywords manually</Button>
      </div>
    );
  }

  const total = data.ranking.length + data.close.length + data.expansion.length;
  if (total === 0) {
    return (
      <div className="p-6 text-center text-muted-foreground space-y-2">
        <p className="text-sm">No suggestions surfaced for this business yet.</p>
        <Button variant="outline" size="sm" onClick={onOpenManual}>Add keywords manually</Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {(data.category || data.city) && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {data.category && <span className="capitalize">{data.category}</span>}
          {data.city && <span>· {data.city}</span>}
          <span className="ml-auto">{total} candidates checked</span>
        </div>
      )}

      {BUCKETS.map(({ key, title, subtitle, Icon, iconClass }) => {
        const items = data[key];
        if (items.length === 0) return null;
        const allSelected = items.every((k) => selected.has(k.keyword));
        return (
          <div key={key} className="border rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} />
                <div>
                  <p className="text-sm font-semibold flex items-center gap-2">
                    {title}
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{items.length}</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{subtitle}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => toggleBucket(items)}
                className="text-[11px] font-medium text-primary hover:underline shrink-0 mt-0.5"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="space-y-0.5">
              {items.map((kw) => {
                const isSelected = selected.has(kw.keyword);
                return (
                  <button
                    key={kw.keyword}
                    type="button"
                    onClick={() => toggle(kw.keyword)}
                    className={`w-full flex items-center justify-between py-1.5 px-2 rounded text-sm transition-colors ${
                      isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`h-4 w-4 rounded border flex items-center justify-center text-xs shrink-0 ${
                        isSelected ? 'bg-primary border-primary text-white' : 'border-border'
                      }`}>
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="truncate text-left">{kw.keyword}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0 ml-2">
                      {kw.rank != null && (
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${kw.rank <= 3 ? 'border-green-500/40 text-green-700' : 'border-amber-500/40 text-amber-700'}`}
                        >
                          #{kw.rank}
                        </Badge>
                      )}
                      {kw.search_volume != null && kw.search_volume > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {kw.search_volume.toLocaleString()}/mo
                        </Badge>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={onOpenManual}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Or add custom keywords
        </button>
        <Button onClick={handleAdd} disabled={adding || selected.size === 0}>
          {adding ? 'Adding...' : selected.size > 0 ? `Track ${selected.size} keyword${selected.size === 1 ? '' : 's'}` : 'Track keywords'}
        </Button>
      </div>
    </div>
  );
}
