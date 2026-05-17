import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TRAFFIC_METRIC_DEFINITIONS, type TrafficMetricKey } from '@/lib/traffic-metrics';

interface TrafficMetricLabelProps {
  metric: TrafficMetricKey;
  labelVariant?: 'short' | 'full';
}

export function TrafficMetricLabel({ metric, labelVariant = 'full' }: TrafficMetricLabelProps) {
  const definition = TRAFFIC_METRIC_DEFINITIONS[metric];
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
        <TooltipContent className="max-w-[260px] text-xs leading-relaxed">
          <p className="font-medium text-popover-foreground">{definition.label}</p>
          <p>{definition.description}</p>
          <p className="mt-1 text-muted-foreground">{definition.hint}</p>
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
