import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useProperty } from '@/contexts/PropertyContext';
import { bulkAddPlannerKeywords, type PlannerItemInput } from '@/lib/planner';

interface BulkSaveToPlannerButtonProps {
  items: PlannerItemInput[];
  onSaved?: () => void;
  className?: string;
}

export function BulkSaveToPlannerButton({
  items,
  onSaved,
  className,
}: BulkSaveToPlannerButtonProps) {
  const queryClient = useQueryClient();
  const { selectedPropertyId } = useProperty();

  const saveMutation = useMutation({
    mutationFn: () => bulkAddPlannerKeywords(selectedPropertyId, { items }),
    onSuccess: ({ added, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ['planner-keywords', selectedPropertyId] });
      onSaved?.();

      if (added > 0) {
        toast.success(`Saved ${added} ${added === 1 ? 'keyword' : 'keywords'} to planner`, {
          description: skipped > 0 ? `${skipped} already existed or could not be saved.` : undefined,
          action: {
            label: 'View',
            onClick: () => { window.location.href = '/content-planner'; },
          },
        });
      } else {
        toast.info('Selected keywords are already in planner');
      }
    },
    onError: () => {
      toast.error('Failed to save selected keywords');
    },
  });

  const primed =
    Boolean(selectedPropertyId) && items.length > 0 && !saveMutation.isPending;

  return (
    <Button
      variant="outline"
      size="sm"
      className={`gap-2 ${className || ''} ${
        primed
          ? 'border-primary text-primary animate-save-glow motion-reduce:animate-none'
          : ''
      }`}
      disabled={!selectedPropertyId || items.length === 0 || saveMutation.isPending}
      title={!selectedPropertyId ? 'Select a site in the sidebar to save keywords' : undefined}
      onClick={() => saveMutation.mutate()}
    >
      <BookmarkPlus className="h-4 w-4" />
      {saveMutation.isPending
        ? 'Saving...'
        : items.length > 0
        ? `Save to planner (${items.length})`
        : 'Save to planner'}
    </Button>
  );
}
