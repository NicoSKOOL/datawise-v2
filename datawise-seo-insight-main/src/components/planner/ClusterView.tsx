import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import {
  CLUSTER_COLORS,
  type PlannerCluster, type PlannerKeyword,
} from '@/lib/planner';
import { ClusterCard } from './ClusterCard';
import { SeedSuggestionBanner } from './SeedSuggestionBanner';

interface ClusterViewProps {
  clusters: PlannerCluster[];
  items: PlannerKeyword[];
  onCardClick: (item: PlannerKeyword) => void;
  onCreateCluster: (input: { name: string; color: string }) => void;
  onRenameCluster: (id: string, name: string) => void;
  onRecolorCluster: (id: string, color: string) => void;
  onDeleteCluster: (id: string) => void;
  onSetPillar: (clusterId: string, keywordId: string) => void;
  onAssignKeyword: (keywordId: string, clusterId: string | null) => void;
  onBulkCreateFromSeed: (seed: string, keywordIds: string[]) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function ClusterView({
  clusters, items, onCardClick, onCreateCluster, onRenameCluster, onRecolorCluster,
  onDeleteCluster, onSetPillar, onAssignKeyword, onBulkCreateFromSeed,
  selectedIds, onToggleSelect,
}: ClusterViewProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const byCluster = new Map<string | null, PlannerKeyword[]>();
    byCluster.set(null, []);
    clusters.forEach((c) => byCluster.set(c.id, []));
    items.forEach((k) => {
      const key = k.cluster_id && byCluster.has(k.cluster_id) ? k.cluster_id : null;
      byCluster.get(key)!.push(k);
    });
    return byCluster;
  }, [clusters, items]);

  const unclustered = grouped.get(null) || [];

  return (
    <div className="space-y-4">
      <SeedSuggestionBanner
        unclustered={unclustered}
        onCreate={onBulkCreateFromSeed}
      />

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {clusters.length} cluster{clusters.length === 1 ? '' : 's'} · {items.length} keyword{items.length === 1 ? '' : 's'}
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> New cluster
        </Button>
      </div>

      <div className="space-y-3">
        {/* Unclustered bucket always at top */}
        {unclustered.length > 0 && (
          <ClusterCard
            cluster={null}
            keywords={unclustered}
            onCardClick={onCardClick}
            onRename={() => {}}
            onRecolor={() => {}}
            onDelete={() => {}}
            onSetPillar={() => {}}
            onAssignKeyword={onAssignKeyword}
            isDragTarget={dragTarget === '__unclustered__'}
            onDragEnter={() => setDragTarget('__unclustered__')}
            onDragLeave={() => setDragTarget((t) => (t === '__unclustered__' ? null : t))}
            onDrop={(keywordId) => {
              onAssignKeyword(keywordId, null);
              setDragTarget(null);
            }}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
          />
        )}

        {clusters.map((c) => (
          <ClusterCard
            key={c.id}
            cluster={c}
            keywords={grouped.get(c.id) || []}
            onCardClick={onCardClick}
            onRename={onRenameCluster}
            onRecolor={onRecolorCluster}
            onDelete={onDeleteCluster}
            onSetPillar={onSetPillar}
            onAssignKeyword={onAssignKeyword}
            isDragTarget={dragTarget === c.id}
            onDragEnter={() => setDragTarget(c.id)}
            onDragLeave={() => setDragTarget((t) => (t === c.id ? null : t))}
            onDrop={(keywordId) => {
              onAssignKeyword(keywordId, c.id);
              setDragTarget(null);
            }}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
          />
        ))}

        {clusters.length === 0 && unclustered.length === 0 && (
          <div className="rounded-lg border-2 border-dashed py-12 text-center text-sm text-muted-foreground">
            No keywords yet.
          </div>
        )}

        {clusters.length === 0 && unclustered.length > 0 && (
          <div className="rounded-lg border-2 border-dashed py-8 text-center">
            <p className="text-sm text-muted-foreground">No clusters yet.</p>
            <Button size="sm" variant="link" onClick={() => setCreateOpen(true)}>
              Create your first cluster
            </Button>
          </div>
        )}
      </div>

      <CreateClusterDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(input) => {
          onCreateCluster(input);
          setCreateOpen(false);
        }}
      />
    </div>
  );
}

function CreateClusterDialog({
  open, onOpenChange, onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (input: { name: string; color: string }) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(CLUSTER_COLORS[0]);

  const submit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), color });
    setName('');
    setColor(CLUSTER_COLORS[0]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New cluster</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Local SEO"
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Color</Label>
            <div className="flex flex-wrap gap-2">
              {CLUSTER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full border-2 hover:scale-110 transition-transform"
                  style={{ background: c, borderColor: color === c ? 'hsl(var(--foreground))' : 'transparent' }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!name.trim()}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
