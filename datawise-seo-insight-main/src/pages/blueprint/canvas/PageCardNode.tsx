import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Home, Wrench, MapPin, Navigation, BookOpen, Building2, Mail, FileText, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BlueprintGraphNode } from './types';

const PAGE_TYPE_ICONS: Record<string, LucideIcon> = {
  home: Home,
  service: Wrench,
  location: MapPin,
  service_location: Navigation,
  resource: BookOpen,
  company: Building2,
  contact: Mail,
};

const RECOMMENDATION_STYLES: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-900',
  update: 'bg-amber-100 text-amber-900',
  keep: 'bg-blue-100 text-blue-900',
  consolidate: 'bg-slate-100 text-slate-900',
};

const compactVolume = new Intl.NumberFormat('en', { notation: 'compact' });

export interface PageCardNodeData extends Record<string, unknown> {
  node: BlueprintGraphNode;
  selected: boolean;
}

function PageCardNodeImpl({ data }: NodeProps) {
  const { node, selected } = data as PageCardNodeData;
  const Icon = PAGE_TYPE_ICONS[node.pageType] ?? FileText;
  const recommendationClass = RECOMMENDATION_STYLES[node.recommendation] ?? RECOMMENDATION_STYLES.keep;

  return (
    <div
      className={cn(
        'w-[200px] rounded-lg border border-border bg-card p-3 shadow-sm',
        selected && 'ring-2 ring-[#005232]'
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" title={node.title}>
            {node.title}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground" title={node.slug}>
            {node.slug}
          </div>
        </div>
      </div>
      {node.primaryKeyword && (
        <div className="mt-2 truncate text-xs text-muted-foreground" title={node.primaryKeyword}>
          {node.primaryKeyword}
          {node.primaryVolume !== null && (
            <span className="ml-1 text-foreground">{compactVolume.format(node.primaryVolume)}</span>
          )}
        </div>
      )}
      <div className="mt-2">
        <Badge className={cn('border-transparent', recommendationClass)}>{node.recommendation}</Badge>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

export const PageCardNode = memo(PageCardNodeImpl);
