import { useState } from 'react';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  MoreHorizontal, Star, Pencil, Trash2, Palette, FileText, Link2, Link2Off, TrendingUp,
  Copy, Download, ListPlus,
} from 'lucide-react';
import {
  CLUSTER_COLORS, STATUS_LABELS, INTENT_LABELS,
  type PlannerCluster, type PlannerKeyword, type PlannerStatus,
} from '@/lib/planner';
import { copyText } from '@/lib/clipboard';
import { keywordsToCsv, keywordsToList, downloadCsv, slugify } from '@/lib/planner-export';

interface ClusterCardProps {
  cluster: PlannerCluster | null; // null = unclustered bucket
  keywords: PlannerKeyword[];
  onCardClick: (item: PlannerKeyword) => void;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onSetPillar: (clusterId: string, keywordId: string) => void;
  onAssignKeyword: (keywordId: string, clusterId: string | null) => void;
  isDragTarget: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (keywordId: string) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const STATUS_CLASS: Record<PlannerStatus, string> = {
  backlog: 'bg-muted text-muted-foreground',
  assigned: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  draft: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  published: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  indexed: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  ranking: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
};

export function ClusterCard({
  cluster, keywords, onCardClick, onRename, onRecolor, onDelete,
  onSetPillar, onAssignKeyword, isDragTarget, onDragEnter, onDragLeave, onDrop,
  selectedIds, onToggleSelect,
}: ClusterCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(cluster?.name || '');
  const selectionActive = (selectedIds?.size ?? 0) > 0;

  const exportName = cluster ? cluster.name : 'unclustered';
  const exportItems = keywords;
  const handleCopyList = async () => {
    const ok = await copyText(keywordsToList(exportItems));
    if (ok) toast.success(`Copied ${exportItems.length} keyword${exportItems.length === 1 ? '' : 's'}`);
    else toast.error('Copy failed — check clipboard permissions');
  };
  const handleCopyCsv = async () => {
    const ok = await copyText(keywordsToCsv(exportItems, cluster ? [cluster] : []));
    if (ok) toast.success('Copied as CSV');
    else toast.error('Copy failed — check clipboard permissions');
  };
  const handleDownloadCsv = () => {
    downloadCsv(`${slugify(exportName)}-keywords.csv`, keywordsToCsv(exportItems, cluster ? [cluster] : []));
  };
  const handleSelectAll = () => {
    if (!onToggleSelect) return;
    const allSelected = keywords.every((k) => selectedIds?.has(k.id));
    keywords.forEach((k) => {
      const isSel = selectedIds?.has(k.id) ?? false;
      if (allSelected ? isSel : !isSel) onToggleSelect(k.id);
    });
  };

  const color = cluster?.color || '#6b7280';
  const isUnclustered = !cluster;

  const pillar = keywords.find((k) => k.is_pillar);
  const supporting = keywords.filter((k) => !k.is_pillar);

  const statusRollup = (() => {
    const counts: Partial<Record<PlannerStatus, number>> = {};
    keywords.forEach((k) => { counts[k.status] = (counts[k.status] || 0) + 1; });
    return Object.entries(counts)
      .filter(([, n]) => n)
      .map(([s, n]) => `${n} ${STATUS_LABELS[s as PlannerStatus].toLowerCase()}`)
      .join(' · ');
  })();

  const totalVolume = keywords.reduce((sum, k) => sum + (k.search_volume || 0), 0);
  const avgKd = (() => {
    const kds = keywords.map((k) => k.keyword_difficulty).filter((v): v is number => v != null);
    if (!kds.length) return null;
    return Math.round(kds.reduce((a, b) => a + b, 0) / kds.length);
  })();

  const commitRename = () => {
    if (!cluster) return;
    const next = nameDraft.trim();
    if (next && next !== cluster.name) onRename(cluster.id, next);
    setRenaming(false);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragEnter(); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain');
        if (id) onDrop(id);
      }}
      className={`rounded-lg border bg-card overflow-hidden transition-colors ${
        isDragTarget ? 'ring-2 ring-primary' : ''
      }`}
    >
      {/* Color strip */}
      <div className="h-1" style={{ background: color }} />

      {/* Header */}
      <div className="px-4 py-3 border-b flex items-start justify-between gap-2 bg-muted/20">
        <div className="flex-1 min-w-0">
          {renaming && cluster ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setNameDraft(cluster.name); setRenaming(false); }
              }}
              className="h-7 text-sm font-semibold"
            />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
              <h3 className="text-sm font-semibold truncate">
                {isUnclustered ? 'Unclustered' : cluster.name}
              </h3>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                {keywords.length} kw
              </Badge>
              {totalVolume > 0 && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0 gap-1">
                  <TrendingUp className="h-2.5 w-2.5" />
                  {formatVolume(totalVolume)}/mo
                </Badge>
              )}
              {avgKd != null && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                  KD ~{avgKd}
                </Badge>
              )}
            </div>
          )}
          {statusRollup && (
            <p className="text-[11px] text-muted-foreground mt-1 truncate">{statusRollup}</p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {cluster && (
              <>
                <DropdownMenuItem onClick={() => { setNameDraft(cluster.name); setRenaming(true); }}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                </DropdownMenuItem>
                <div className="px-2 py-1.5">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1 flex items-center gap-1">
                    <Palette className="h-3 w-3" /> Color
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {CLUSTER_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => onRecolor(cluster.id, c)}
                        className="h-5 w-5 rounded-full border-2 hover:scale-110 transition-transform"
                        style={{ background: c, borderColor: cluster.color === c ? 'black' : 'transparent' }}
                        aria-label={`Set color ${c}`}
                      />
                    ))}
                  </div>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            {onToggleSelect && keywords.length > 0 && (
              <DropdownMenuItem onClick={handleSelectAll}>
                <ListPlus className="h-3.5 w-3.5 mr-2" />
                {keywords.every((k) => selectedIds?.has(k.id)) ? 'Deselect all' : 'Select all'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleCopyList} disabled={keywords.length === 0}>
              <Copy className="h-3.5 w-3.5 mr-2" /> Copy keywords (list)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyCsv} disabled={keywords.length === 0}>
              <Copy className="h-3.5 w-3.5 mr-2" /> Copy as CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleDownloadCsv} disabled={keywords.length === 0}>
              <Download className="h-3.5 w-3.5 mr-2" /> Download CSV
            </DropdownMenuItem>
            {cluster && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                  onClick={() => onDelete(cluster.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete cluster
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Keywords */}
      <div className="p-2 space-y-1 min-h-[60px]">
        {keywords.length === 0 && (
          <div className="text-xs text-muted-foreground/60 text-center py-4">
            Drop keywords here
          </div>
        )}

        {pillar && cluster && (
          <KeywordRow
            item={pillar}
            isPillar
            clusterColor={color}
            onClick={() => onCardClick(pillar)}
            onSetPillar={() => {}}
            onUnassign={() => onAssignKeyword(pillar.id, null)}
            selected={selectedIds?.has(pillar.id) ?? false}
            selectionActive={selectionActive}
            onToggleSelect={onToggleSelect}
          />
        )}

        {supporting.map((k) => (
          <KeywordRow
            key={k.id}
            item={k}
            isPillar={false}
            clusterColor={color}
            showPillarAction={!!cluster}
            onClick={() => onCardClick(k)}
            onSetPillar={() => cluster && onSetPillar(cluster.id, k.id)}
            onUnassign={() => onAssignKeyword(k.id, null)}
            selected={selectedIds?.has(k.id) ?? false}
            selectionActive={selectionActive}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </div>
    </div>
  );
}

function KeywordRow({
  item, isPillar, clusterColor, showPillarAction = false, onClick, onSetPillar, onUnassign,
  selected = false, selectionActive = false, onToggleSelect,
}: {
  item: PlannerKeyword;
  isPillar: boolean;
  clusterColor: string;
  showPillarAction?: boolean;
  onClick: () => void;
  onSetPillar: () => void;
  onUnassign: () => void;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
      }}
      onClick={onClick}
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/40 cursor-grab active:cursor-grabbing text-sm transition-colors ${
        selected ? 'bg-primary/5 ring-1 ring-primary/30' : ''
      } ${selectionActive && !selected ? 'opacity-60' : ''}`}
    >
      {onToggleSelect && (
        <div
          draggable={false}
          onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id); }}
          className={`transition-opacity ${selected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <Checkbox checked={selected} aria-label="Select keyword" tabIndex={-1} />
        </div>
      )}
      {isPillar ? (
        <Star className="h-3.5 w-3.5 flex-shrink-0 fill-amber-400 text-amber-500" />
      ) : showPillarAction ? (
        <button
          onClick={(e) => { e.stopPropagation(); onSetPillar(); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          title="Make pillar"
        >
          <Star className="h-3.5 w-3.5 text-muted-foreground hover:text-amber-500" />
        </button>
      ) : (
        <span className="h-3.5 w-3.5 flex-shrink-0" />
      )}
      <span className="flex-1 truncate">{item.keyword}</span>
      {item.assigned_url && (
        <span title={item.assigned_url} className="flex-shrink-0">
          <Link2 className="h-3 w-3 text-primary/70" aria-label={`Assigned to ${item.assigned_url}`} />
        </span>
      )}
      {item.content_brief?.title && (
        <FileText className="h-3 w-3 flex-shrink-0 text-primary/60" aria-label="Has brief" />
      )}
      {item.search_volume != null && (
        <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
          {formatVolume(item.search_volume)}/mo
        </span>
      )}
      {item.keyword_difficulty != null && (
        <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0 hidden md:inline">
          KD {Math.round(item.keyword_difficulty)}
        </span>
      )}
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 hidden sm:inline-flex">
        {INTENT_LABELS[item.intent]}
      </Badge>
      <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_CLASS[item.status]}`}>
        {STATUS_LABELS[item.status]}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onUnassign(); }}
        className="opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove from cluster"
      >
        <Link2Off className="h-3 w-3 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );
}
