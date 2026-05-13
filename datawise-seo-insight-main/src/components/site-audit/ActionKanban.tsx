import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Circle,
  Clock,
  GripVertical,
  Plus,
  Calendar as CalendarIcon,
  Link2,
  ListChecks,
  Paperclip,
} from 'lucide-react';
import {
  listActionItems,
  listPropertyTasks,
  updateActionItem,
  type ActionItem,
  type ActionStatus,
  type Priority,
  parseSubtasks,
  parseAttachments,
} from '@/lib/site-audit';
import { TaskDetailDialog } from './TaskDetailDialog';

const COLUMNS: { id: ActionStatus; label: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [
  { id: 'todo', label: 'Todo', icon: Circle, color: 'text-muted-foreground' },
  { id: 'in_progress', label: 'In Progress', icon: Clock, color: 'text-amber-600' },
  { id: 'done', label: 'Done', icon: CheckCircle2, color: 'text-green-600' },
];

const PRIORITY_COLOR: Record<Priority, string> = {
  high: 'bg-red-500/10 text-red-600 border-red-500/30',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  low: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
};

interface Props {
  auditId: string;
  propertyId?: string | null;
}

export function ActionKanban({ auditId, propertyId }: Props) {
  const qc = useQueryClient();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<
    | { kind: 'create'; propertyId: string }
    | { kind: 'edit'; item: ActionItem }
    | null
  >(null);

  // Unified query: if a property is selected, fetch property-scoped tasks
  // (includes manual + audit items); otherwise fall back to legacy
  // audit-only list so the page keeps working without a property context.
  const queryKey = propertyId
    ? (['tasks', 'property', propertyId, auditId] as const)
    : (['tasks', 'audit', auditId] as const);

  const itemsQuery = useQuery({
    queryKey,
    queryFn: () =>
      propertyId ? listPropertyTasks(propertyId, auditId) : listActionItems(auditId),
    enabled: !!auditId,
  });
  const items = itemsQuery.data || [];

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateActionItem>[1] }) =>
      updateActionItem(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<ActionItem[]>([...queryKey]);
      qc.setQueryData<ActionItem[]>([...queryKey], (old) =>
        (old || []).map((item) => (item.id === id ? { ...item, ...(patch as Partial<ActionItem>) } : item))
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData([...queryKey], ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => i.category && set.add(i.category as string));
    return ['all', ...Array.from(set)];
  }, [items]);

  const visibleItems = useMemo(
    () => (filterCategory === 'all' ? items : items.filter((i) => i.category === filterCategory)),
    [items, filterCategory]
  );

  const byColumn = useMemo(() => {
    const grouped: Record<ActionStatus, ActionItem[]> = { todo: [], in_progress: [], done: [] };
    for (const item of visibleItems) grouped[item.status].push(item);
    for (const key of Object.keys(grouped) as ActionStatus[]) {
      grouped[key].sort((a, b) => a.position - b.position);
    }
    return grouped;
  }, [visibleItems]);

  function handleDrop(column: ActionStatus) {
    if (!draggedId) return;
    const item = items.find((i) => i.id === draggedId);
    if (!item || item.status === column) {
      setDraggedId(null);
      return;
    }
    patchMutation.mutate({ id: draggedId, patch: { status: column } });
    setDraggedId(null);
  }

  function openCreate() {
    if (!propertyId) return;
    setDialogMode({ kind: 'create', propertyId });
    setDialogOpen(true);
  }

  function openEdit(item: ActionItem) {
    setDialogMode({ kind: 'edit', item });
    setDialogOpen(true);
  }

  const counts = {
    todo: byColumn.todo.length,
    in_progress: byColumn.in_progress.length,
    done: byColumn.done.length,
  };
  const total = counts.todo + counts.in_progress + counts.done;
  const progress = total > 0 ? Math.round((counts.done / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg border bg-card">
        <div>
          <p className="text-sm font-medium">
            {counts.done} / {total} action items complete
          </p>
          <div className="mt-1 h-2 w-48 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Filter:</span>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-2 py-1 text-xs rounded-md capitalize transition-colors ${
                filterCategory === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {cat}
            </button>
          ))}
          <Button
            size="sm"
            onClick={openCreate}
            disabled={!propertyId}
            title={!propertyId ? 'Select a property to add manual tasks' : 'Add a task'}
            className="gap-1 ml-2"
          >
            <Plus className="h-3.5 w-3.5" /> Add task
          </Button>
        </div>
      </div>

      {/* Board */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const Icon = col.icon;
          const columnItems = byColumn[col.id];
          return (
            <div
              key={col.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}
              className="flex flex-col rounded-lg border bg-muted/30 min-h-[400px]"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${col.color}`} />
                  <span className="font-medium text-sm">{col.label}</span>
                </div>
                <Badge variant="secondary">{columnItems.length}</Badge>
              </div>
              <div className="flex-1 p-3 space-y-2 overflow-y-auto">
                {columnItems.length === 0 && (
                  <div className="text-center text-xs text-muted-foreground py-10">
                    {col.id === 'todo' ? 'Nothing to do — nice work!' : 'Empty'}
                  </div>
                )}
                {columnItems.map((item) => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    onDragStart={() => setDraggedId(item.id)}
                    onDragEnd={() => setDraggedId(null)}
                    onStatusChange={(status) =>
                      patchMutation.mutate({ id: item.id, patch: { status } })
                    }
                    onOpen={() => openEdit(item)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <TaskDetailDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        queryKey={queryKey}
      />
    </div>
  );
}

interface CardProps {
  item: ActionItem;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStatusChange: (s: ActionStatus) => void;
  onOpen: () => void;
}

function KanbanCard({ item, onDragStart, onDragEnd, onStatusChange, onOpen }: CardProps) {
  const subtasks = parseSubtasks(item);
  const attachments = parseAttachments(item);
  const doneSubs = subtasks.filter((s) => s.done).length;

  const dueLabel = useMemo(() => formatDue(item.due_date), [item.due_date]);

  return (
    <Card
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 mt-0.5" />
          <button
            onClick={onOpen}
            className="flex-1 min-w-0 space-y-1.5 text-left"
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide rounded border ${PRIORITY_COLOR[item.priority]}`}>
                {item.priority}
              </span>
              {item.category && (
                <Badge variant="outline" className="text-[10px] capitalize">{item.category}</Badge>
              )}
              {item.source === 'manual' && (
                <Badge variant="secondary" className="text-[10px]">Manual</Badge>
              )}
            </div>
            <p className="text-sm font-medium leading-snug">{item.title}</p>
            {(item.url || dueLabel || subtasks.length > 0 || attachments.length > 0) && (
              <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                {item.url && (
                  <span className="inline-flex items-center gap-1 truncate max-w-[140px]">
                    <Link2 className="h-3 w-3" /> <span className="truncate">{shortUrl(item.url)}</span>
                  </span>
                )}
                {dueLabel && (
                  <span className={`inline-flex items-center gap-1 ${dueLabel.overdue ? 'text-red-600' : ''}`}>
                    <CalendarIcon className="h-3 w-3" /> {dueLabel.text}
                  </span>
                )}
                {subtasks.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <ListChecks className="h-3 w-3" /> {doneSubs}/{subtasks.length}
                  </span>
                )}
                {attachments.length > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Paperclip className="h-3 w-3" /> {attachments.length}
                  </span>
                )}
              </div>
            )}
          </button>
        </div>

        {/* Quick status actions */}
        <div className="flex items-center gap-1 pt-1 border-t">
          {item.status !== 'todo' && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onStatusChange('todo')}>
              Todo
            </Button>
          )}
          {item.status !== 'in_progress' && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onStatusChange('in_progress')}>
              Start
            </Button>
          )}
          {item.status !== 'done' && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onStatusChange('done')}>
              Done
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs ml-auto text-muted-foreground"
            onClick={onOpen}
          >
            Open
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function shortUrl(u: string) {
  try {
    const parsed = new URL(u);
    return parsed.hostname.replace(/^www\./, '') + parsed.pathname;
  } catch {
    return u;
  }
}

function formatDue(due: string | null): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const d = new Date(due + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diff === 0) return { text: 'Today', overdue: false };
  if (diff === 1) return { text: 'Tomorrow', overdue: false };
  if (diff > 1 && diff <= 7) return { text: `In ${diff}d`, overdue: false };
  if (diff < 0) return { text: `${Math.abs(diff)}d overdue`, overdue: true };
  return { text: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), overdue: false };
}
