import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatKeywordMetricValue,
  getKeywordMetricTone,
  KEYWORD_METRIC_DEFINITIONS,
  type KeywordMetricKey,
  type KeywordMetricStats,
} from '@/lib/keyword-metrics';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const toneClasses = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  red: 'border-red-200 bg-red-50 text-red-700',
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
};

interface KeywordMetricBadgeProps {
  metric: KeywordMetricKey;
  value: unknown;
  stats?: KeywordMetricStats;
}

export function KeywordMetricBadge({ metric, value, stats }: KeywordMetricBadgeProps) {
  const tone = getKeywordMetricTone(metric, value, stats);

  return (
    <span
      className={cn(
        'inline-flex min-w-[4.25rem] justify-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums',
        toneClasses[tone],
      )}
    >
      {formatKeywordMetricValue(metric, value)}
    </span>
  );
}

interface KeywordMetricLabelProps {
  metric: KeywordMetricKey;
  labelVariant?: 'short' | 'full';
}

export function KeywordMetricLabel({ metric, labelVariant = 'full' }: KeywordMetricLabelProps) {
  const definition = KEYWORD_METRIC_DEFINITIONS[metric];
  const label = labelVariant === 'short' ? definition.shortLabel : definition.label;

  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`${definition.label} explanation`}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[240px] text-xs leading-relaxed">
          <p className="font-medium text-popover-foreground">{definition.label}</p>
          <p>{definition.description}</p>
          <p className="mt-1 text-muted-foreground">{definition.hint}</p>
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
