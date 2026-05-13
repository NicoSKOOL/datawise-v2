import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, StickyNote, FileText, Briefcase, Scale, BookOpen, Link as LinkIcon, Link2, HelpCircle, Star } from 'lucide-react';
import {
  INTENT_LABELS,
  PAGE_TYPE_BY_INTENT,
  type PlannerIntent,
  type PlannerKeyword,
  type PlannerCluster,
} from '@/lib/planner';

const PAGE_TYPE_ICON: Record<PlannerIntent, typeof Briefcase> = {
  transactional: Briefcase,
  commercial: Scale,
  informational: BookOpen,
  navigational: LinkIcon,
  fan_out: HelpCircle,
};

const INTENT_CLASSES: Record<PlannerIntent, string> = {
  transactional: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  commercial: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  informational: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
  navigational: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
  fan_out: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20',
};

interface PlannerCardProps {
  item: PlannerKeyword;
  cluster?: PlannerCluster | null;
  onClick: (item: PlannerKeyword) => void;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function PlannerCard({
  item, cluster, onClick, onDelete, onDragStart, onDragEnd,
  selected = false, selectionActive = false, onToggleSelect,
}: PlannerCardProps) {
  const pageType = PAGE_TYPE_BY_INTENT[item.intent];
  const PageIcon = PAGE_TYPE_ICON[item.intent];
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
        onDragStart(item.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onClick(item)}
      className={`group relative cursor-grab active:cursor-grabbing rounded-lg border bg-card p-3 shadow-sm hover:shadow-md transition-all ${
        selected ? 'ring-2 ring-primary border-primary/40' : ''
      } ${selectionActive && !selected ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        {onToggleSelect && (
          <div
            draggable={false}
            onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(item.id);
            }}
            className={`pt-0.5 transition-opacity ${
              selected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <Checkbox
              checked={selected}
              aria-label="Select keyword"
              tabIndex={-1}
            />
          </div>
        )}
        <p className="text-sm font-medium leading-tight break-words flex-1">{item.keyword}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${INTENT_CLASSES[item.intent]}`}>
          {INTENT_LABELS[item.intent]}
        </Badge>
        {item.search_volume != null && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            Vol {formatNumber(item.search_volume)}
          </Badge>
        )}
        {item.keyword_difficulty != null && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            KD {Math.round(item.keyword_difficulty)}
          </Badge>
        )}
      </div>

      <div
        className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"
        title={pageType.description}
      >
        <PageIcon className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">{pageType.label}</span>
      </div>

      {cluster && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {item.is_pillar && <Star className="h-3 w-3 flex-shrink-0 fill-amber-400 text-amber-500" />}
          <span
            className="h-2 w-2 rounded-full flex-shrink-0"
            style={{ background: cluster.color }}
          />
          <span className="truncate">{cluster.name}</span>
        </div>
      )}

      {item.assigned_url && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-primary/80" title={item.assigned_url}>
          <Link2 className="h-3 w-3 flex-shrink-0" />
          <span className="truncate font-mono">{prettyUrl(item.assigned_url)}</span>
        </div>
      )}

      {(item.notes || item.content_brief?.title) && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {item.content_brief?.title && (
            <div className="flex items-start gap-1 text-foreground/80">
              <FileText className="h-3 w-3 flex-shrink-0 mt-0.5 text-primary" />
              <span className="line-clamp-2 font-medium">{item.content_brief.title}</span>
            </div>
          )}
          {item.notes && (
            <div className="flex items-start gap-1">
              <StickyNote className="h-3 w-3 flex-shrink-0 mt-0.5" />
              <span className="line-clamp-2">{item.notes}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function prettyUrl(url: string): string {
  if (url.startsWith('/')) return url;
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}
