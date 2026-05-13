import { useMemo, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Sparkles, X } from 'lucide-react';
import type { PlannerKeyword } from '@/lib/planner';

interface SeedSuggestionBannerProps {
  unclustered: PlannerKeyword[];
  onCreate: (seed: string, keywordIds: string[]) => void;
}

const DISMISS_KEY = 'planner-seed-dismissed';
const MIN_GROUP_SIZE = 3;

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch { return new Set(); }
}

function saveDismissed(set: Set<string>) {
  localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(set)));
}

export function SeedSuggestionBanner({ unclustered, onCreate }: SeedSuggestionBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  useEffect(() => { saveDismissed(dismissed); }, [dismissed]);

  const suggestion = useMemo(() => {
    const bySeed = new Map<string, PlannerKeyword[]>();
    for (const k of unclustered) {
      const ctx = k.source_context as { seed_keyword?: string } | null;
      const seed = ctx?.seed_keyword?.trim().toLowerCase();
      if (!seed) continue;
      if (!bySeed.has(seed)) bySeed.set(seed, []);
      bySeed.get(seed)!.push(k);
    }
    for (const [seed, keywords] of bySeed) {
      if (keywords.length >= MIN_GROUP_SIZE && !dismissed.has(seed)) {
        return { seed, keywords };
      }
    }
    return null;
  }, [unclustered, dismissed]);

  if (!suggestion) return null;

  const { seed, keywords } = suggestion;
  const displayName = seed.charAt(0).toUpperCase() + seed.slice(1);

  return (
    <div className="rounded-lg border bg-primary/5 px-4 py-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">{keywords.length} unclustered keywords</span>{' '}
          came from seed <span className="font-medium">"{displayName}"</span> — create a cluster?
        </p>
      </div>
      <Button
        size="sm"
        onClick={() => onCreate(displayName, keywords.map((k) => k.id))}
      >
        Create cluster
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-8 w-8 flex-shrink-0"
        onClick={() => setDismissed(new Set([...dismissed, seed]))}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
