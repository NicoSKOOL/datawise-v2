import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Bookmark, BookmarkCheck, Plus } from 'lucide-react';
import {
  listPlannerKeywords,
  addPlannerKeyword,
  INTENT_LABELS,
  INTENT_ORDER,
  type PlannerIntent,
  type PlannerItemInput,
} from '@/lib/planner';
import { useProperty } from '@/contexts/PropertyContext';

interface AddToPlannerButtonProps {
  keyword: string;
  source: string;
  metrics?: {
    search_volume?: number | null;
    keyword_difficulty?: number | null;
    cpc?: number | null;
    competition?: number | null;
  };
  sourceContext?: unknown;
  defaultIntent?: PlannerIntent;
  /** Render as icon-only button (default) or with text label */
  variant?: 'icon' | 'inline';
}

export function AddToPlannerButton({
  keyword,
  source,
  metrics,
  sourceContext,
  defaultIntent = 'informational',
  variant = 'icon',
}: AddToPlannerButtonProps) {
  const queryClient = useQueryClient();
  const { selectedPropertyId } = useProperty();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<PlannerIntent>(defaultIntent);
  const kwKey = ['planner-keywords', selectedPropertyId] as const;

  const { data: saved = [] } = useQuery({
    queryKey: kwKey,
    queryFn: () => listPlannerKeywords(selectedPropertyId),
    enabled: Boolean(selectedPropertyId),
    staleTime: 30_000,
  });

  const normalizedKw = keyword.trim().toLowerCase();
  const isSaved = useMemo(
    () => saved.some((s) => s.keyword === normalizedKw),
    [saved, normalizedKw]
  );

  const addMutation = useMutation({
    mutationFn: (input: PlannerItemInput) => addPlannerKeyword(selectedPropertyId, input),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: kwKey });
      if (res.duplicate) {
        toast.info('Already in planner');
      } else {
        toast.success('Added to planner', {
          action: {
            label: 'View',
            onClick: () => { window.location.href = '/content-planner'; },
          },
        });
      }
      setOpen(false);
    },
    onError: () => {
      toast.error('Failed to add to planner');
    },
  });

  const handleSave = () => {
    addMutation.mutate({
      keyword: normalizedKw,
      intent,
      source,
      source_context: sourceContext,
      search_volume: metrics?.search_volume ?? null,
      keyword_difficulty: metrics?.keyword_difficulty ?? null,
      cpc: metrics?.cpc ?? null,
      competition: metrics?.competition ?? null,
    });
  };

  const Icon = isSaved ? BookmarkCheck : Bookmark;
  const disabled = !selectedPropertyId;
  const disabledTitle = 'Select a site in the sidebar to save keywords';

  return (
    <Popover open={open} onOpenChange={(v) => { if (!disabled) setOpen(v); }}>
      <PopoverTrigger asChild>
        {variant === 'icon' ? (
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${isSaved ? 'text-primary' : ''}`}
            title={disabled ? disabledTitle : isSaved ? 'Saved to planner' : 'Save to Content Planner'}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant={isSaved ? 'secondary' : 'outline'}
            size="sm"
            title={disabled ? disabledTitle : undefined}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
          >
            <Icon className="h-3.5 w-3.5 mr-1.5" />
            {isSaved ? 'In planner' : 'Save'}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Keyword</p>
            <p className="text-sm font-medium break-words">{keyword}</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Intent</label>
            <Select value={intent} onValueChange={(v) => setIntent(v as PlannerIntent)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTENT_ORDER.map((i) => (
                  <SelectItem key={i} value={i}>{INTENT_LABELS[i]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={handleSave}
            disabled={addMutation.isPending || isSaved}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {isSaved ? 'Already saved' : addMutation.isPending ? 'Saving...' : 'Save to planner'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
