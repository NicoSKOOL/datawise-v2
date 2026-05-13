import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import {
  INTENT_LABELS,
  INTENT_ORDER,
  type PlannerIntent,
} from '@/lib/planner';

export interface PlannerFiltersState {
  search: string;
  intents: Set<PlannerIntent>;
  sources: Set<string>;
}

interface PlannerFiltersProps {
  state: PlannerFiltersState;
  availableSources: string[];
  onChange: (next: PlannerFiltersState) => void;
}

export function PlannerFilters({ state, availableSources, onChange }: PlannerFiltersProps) {
  const toggleIntent = (intent: PlannerIntent) => {
    const next = new Set(state.intents);
    if (next.has(intent)) next.delete(intent);
    else next.add(intent);
    onChange({ ...state, intents: next });
  };

  const toggleSource = (source: string) => {
    const next = new Set(state.sources);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    onChange({ ...state, sources: next });
  };

  const clear = () => onChange({ search: '', intents: new Set(), sources: new Set() });
  const hasActive = state.search || state.intents.size > 0 || state.sources.size > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search keywords..."
          value={state.search}
          onChange={(e) => onChange({ ...state, search: e.target.value })}
          className="max-w-xs"
        />
        {hasActive && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear filters
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-muted-foreground self-center mr-1">Intent:</span>
        {INTENT_ORDER.map((intent) => {
          const active = state.intents.has(intent);
          return (
            <Badge
              key={intent}
              variant={active ? 'default' : 'outline'}
              className="cursor-pointer select-none"
              onClick={() => toggleIntent(intent)}
            >
              {INTENT_LABELS[intent]}
            </Badge>
          );
        })}
      </div>

      {availableSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground self-center mr-1">Source:</span>
          {availableSources.map((source) => {
            const active = state.sources.has(source);
            return (
              <Badge
                key={source}
                variant={active ? 'default' : 'outline'}
                className="cursor-pointer select-none text-[11px]"
                onClick={() => toggleSource(source)}
              >
                {source}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
