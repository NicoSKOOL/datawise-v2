import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookmarkPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/DataTable';
import { useProperty } from '@/contexts/PropertyContext';
import { bulkAddPlannerKeywords, type PlannerIntent } from '@/lib/planner';
import {
  buildPlannerItem,
  getKeywordRowKey,
  getSelectedPlannerItems,
} from '@/lib/planner-keyword-selection';
import { AddToPlannerButton } from './AddToPlannerButton';

interface KeywordPlannerDataTableProps {
  data: Record<string, unknown>[];
  title: string;
  description?: string;
  loading?: boolean;
  metricMode?: 'none' | 'keyword-research';
  source: string;
  sourceContext?: unknown;
  defaultIntent?: PlannerIntent;
}

export function KeywordPlannerDataTable({
  data,
  title,
  description,
  loading = false,
  metricMode = 'keyword-research',
  source,
  sourceContext,
  defaultIntent = 'informational',
}: KeywordPlannerDataTableProps) {
  const queryClient = useQueryClient();
  const { selectedPropertyId } = useProperty();
  const [selectedKeywordKeys, setSelectedKeywordKeys] = useState<Set<string>>(new Set());

  const rowSignature = useMemo(
    () => data.map((row, index) => getKeywordRowKey(row, index)).join('\u001f'),
    [data],
  );

  useEffect(() => {
    setSelectedKeywordKeys(new Set());
  }, [rowSignature]);

  const selectedItems = useMemo(
    () => getSelectedPlannerItems(data, selectedKeywordKeys, {
      source,
      intent: defaultIntent,
      sourceContext,
    }),
    [data, defaultIntent, selectedKeywordKeys, source, sourceContext],
  );

  const saveMutation = useMutation({
    mutationFn: () => bulkAddPlannerKeywords(selectedPropertyId, { items: selectedItems }),
    onSuccess: ({ added, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ['planner-keywords', selectedPropertyId] });
      setSelectedKeywordKeys(new Set());

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

  const saveSelectedPrimed =
    Boolean(selectedPropertyId) && selectedItems.length > 0 && !saveMutation.isPending;

  const saveSelectedButton = (
    <Button
      variant="outline"
      size="sm"
      className={`gap-2 ${
        saveSelectedPrimed
          ? 'border-primary text-primary animate-save-glow motion-reduce:animate-none'
          : ''
      }`}
      disabled={!selectedPropertyId || selectedItems.length === 0 || saveMutation.isPending}
      title={!selectedPropertyId ? 'Select a site in the sidebar to save keywords' : undefined}
      onClick={() => saveMutation.mutate()}
    >
      <BookmarkPlus className="h-4 w-4" />
      {saveMutation.isPending
        ? 'Saving...'
        : selectedItems.length > 0
        ? `Save selected (${selectedItems.length})`
        : 'Save selected'}
    </Button>
  );

  return (
    <DataTable
      data={data}
      title={title}
      description={description}
      loading={loading}
      metricMode={metricMode}
      toolbarActions={saveSelectedButton}
      getRowId={getKeywordRowKey}
      selectedRowIds={selectedKeywordKeys}
      onSelectedRowIdsChange={setSelectedKeywordKeys}
      isRowSelectable={(row, index) => Boolean(getKeywordRowKey(row, index))}
      renderRowActions={(row) => {
        const item = buildPlannerItem(row, {
          source,
          intent: defaultIntent,
          sourceContext,
        });

        if (!item) return null;

        return (
          <AddToPlannerButton
            keyword={item.keyword}
            source={source}
            sourceContext={item.source_context}
            metrics={{
              search_volume: item.search_volume,
              keyword_difficulty: item.keyword_difficulty,
              cpc: item.cpc,
              competition: item.competition,
            }}
            defaultIntent={defaultIntent}
          />
        );
      }}
    />
  );
}
