import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  emptyKeywordFilterState,
  isKeywordFilterActive,
  type KeywordFilterState,
} from '@/lib/keyword-filters';

export interface KeywordFilterBarProps {
  state: KeywordFilterState;
  onChange: (next: KeywordFilterState) => void;
  totalCount: number;
  filteredCount: number;
  /** When provided, renders intent toggle chips (e.g. ['Commercial', 'Informational', 'Navigational']). */
  intentOptions?: string[];
  /** When provided, renders the "Exclude brand keywords" checkbox (e.g. "nike.com"). */
  brandLabel?: string;
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function KeywordFilterBar({
  state,
  onChange,
  totalCount,
  filteredCount,
  intentOptions,
  brandLabel,
}: KeywordFilterBarProps) {
  const active = isKeywordFilterActive(state);

  const set = (patch: Partial<KeywordFilterState>) =>
    onChange({ ...state, ...patch });

  const toggleIntent = (intent: string) => {
    const has = state.intents.includes(intent);
    set({
      intents: has
        ? state.intents.filter((i) => i !== intent)
        : [...state.intents, intent],
    });
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Filter className="h-4 w-4" />
            Filters
            {active && (
              <span className="text-muted-foreground font-normal">
                showing {filteredCount.toLocaleString()} of{' '}
                {totalCount.toLocaleString()} keywords
              </span>
            )}
          </div>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => onChange(emptyKeywordFilterState)}
            >
              <X className="h-4 w-4" />
              Clear filters
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <Label htmlFor="kwf-include" className="text-xs">
              Include words (comma separated)
            </Label>
            <Input
              id="kwf-include"
              placeholder="e.g. how, what, why"
              value={state.includeTerms}
              onChange={(e) => set({ includeTerms: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="kwf-exclude" className="text-xs">
              Exclude words (comma separated)
            </Label>
            <Input
              id="kwf-exclude"
              placeholder="e.g. free, jobs"
              value={state.excludeTerms}
              onChange={(e) => set({ excludeTerms: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="kwf-min-vol" className="text-xs">
                Min volume
              </Label>
              <Input
                id="kwf-min-vol"
                type="number"
                min={0}
                placeholder="0"
                value={state.minVolume ?? ''}
                onChange={(e) => set({ minVolume: numberOrNull(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="kwf-max-vol" className="text-xs">
                Max volume
              </Label>
              <Input
                id="kwf-max-vol"
                type="number"
                min={0}
                placeholder="any"
                value={state.maxVolume ?? ''}
                onChange={(e) => set({ maxVolume: numberOrNull(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="kwf-min-words" className="text-xs">
                Min words
              </Label>
              <Input
                id="kwf-min-words"
                type="number"
                min={1}
                placeholder="1"
                value={state.minWordCount ?? ''}
                onChange={(e) =>
                  set({ minWordCount: numberOrNull(e.target.value) })
                }
              />
            </div>
            <div>
              <Label htmlFor="kwf-max-words" className="text-xs">
                Max words
              </Label>
              <Input
                id="kwf-max-words"
                type="number"
                min={1}
                placeholder="any"
                value={state.maxWordCount ?? ''}
                onChange={(e) =>
                  set({ maxWordCount: numberOrNull(e.target.value) })
                }
              />
            </div>
          </div>

          {intentOptions && intentOptions.length > 0 && (
            <div>
              <Label className="text-xs">Intent</Label>
              <div className="flex flex-wrap gap-1.5 pt-1.5">
                {intentOptions.map((intent) => (
                  <Button
                    key={intent}
                    type="button"
                    size="sm"
                    variant={
                      state.intents.includes(intent) ? 'default' : 'outline'
                    }
                    onClick={() => toggleIntent(intent)}
                  >
                    {intent}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {brandLabel && (
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={state.excludeBrand}
                  onCheckedChange={(checked) =>
                    set({ excludeBrand: checked === true })
                  }
                />
                Exclude brand keywords ({brandLabel})
              </label>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
