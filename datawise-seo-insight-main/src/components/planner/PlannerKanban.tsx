import { useState } from 'react';
import {
  STATUS_ORDER,
  STATUS_LABELS,
  type PlannerKeyword,
  type PlannerStatus,
  type PlannerCluster,
} from '@/lib/planner';
import { PlannerCard } from './PlannerCard';

interface PlannerKanbanProps {
  items: PlannerKeyword[];
  clusters: PlannerCluster[];
  onCardClick: (item: PlannerKeyword) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, newStatus: PlannerStatus) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function PlannerKanban({
  items, clusters, onCardClick, onDelete, onStatusChange,
  selectedIds, onToggleSelect,
}: PlannerKanbanProps) {
  const clusterMap = new Map(clusters.map((c) => [c.id, c]));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<PlannerStatus | null>(null);
  const selectionActive = (selectedIds?.size ?? 0) > 0;

  const grouped = STATUS_ORDER.reduce((acc, status) => {
    acc[status] = items.filter((i) => i.status === status);
    return acc;
  }, {} as Record<PlannerStatus, PlannerKeyword[]>);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 min-h-[60vh]">
      {STATUS_ORDER.map((status) => {
        const columnItems = grouped[status];
        const isDropTarget = hoveredColumn === status && draggingId != null;
        return (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setHoveredColumn(status);
            }}
            onDragLeave={() => {
              setHoveredColumn((prev) => (prev === status ? null : prev));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              setHoveredColumn(null);
              if (id) {
                const item = items.find((i) => i.id === id);
                if (item && item.status !== status) {
                  onStatusChange(id, status);
                }
              }
            }}
            className={`rounded-lg border bg-muted/30 p-2 flex flex-col transition-colors ${
              isDropTarget ? 'border-primary bg-primary/5' : ''
            }`}
          >
            <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {STATUS_LABELS[status]}
              </h3>
              <span className="text-xs text-muted-foreground">{columnItems.length}</span>
            </div>
            <div className="space-y-2 flex-1 overflow-y-auto">
              {columnItems.map((item) => (
                <PlannerCard
                  key={item.id}
                  item={item}
                  cluster={item.cluster_id ? clusterMap.get(item.cluster_id) : null}
                  onClick={onCardClick}
                  onDelete={onDelete}
                  onDragStart={setDraggingId}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setHoveredColumn(null);
                  }}
                  selected={selectedIds?.has(item.id) ?? false}
                  selectionActive={selectionActive}
                  onToggleSelect={onToggleSelect}
                />
              ))}
              {columnItems.length === 0 && (
                <div className="text-xs text-muted-foreground/60 text-center py-4">
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
