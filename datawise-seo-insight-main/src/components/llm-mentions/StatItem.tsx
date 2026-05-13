import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Info } from 'lucide-react';

export type StatAccent = 'blue' | 'purple' | 'green' | 'orange';

export const ACCENT: Record<StatAccent, { ring: string; bg: string; text: string; bar: string }> = {
  blue: {
    ring: 'ring-blue-500/20',
    bg: 'bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    bar: 'before:bg-blue-500',
  },
  purple: {
    ring: 'ring-purple-500/20',
    bg: 'bg-purple-500/10',
    text: 'text-purple-600 dark:text-purple-400',
    bar: 'before:bg-purple-500',
  },
  green: {
    ring: 'ring-emerald-500/20',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-600 dark:text-emerald-400',
    bar: 'before:bg-emerald-500',
  },
  orange: {
    ring: 'ring-orange-500/20',
    bg: 'bg-orange-500/10',
    text: 'text-orange-600 dark:text-orange-400',
    bar: 'before:bg-orange-500',
  },
};

export function StatItem({
  icon: Icon,
  label,
  value,
  subtitle,
  breakdown,
  loading,
  accent,
  help,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
  breakdown?: { aio?: string; gpt?: string };
  loading: boolean;
  accent: StatAccent;
  help: string;
}) {
  const a = ACCENT[accent];
  const showBreakdown = breakdown && (breakdown.aio !== undefined || breakdown.gpt !== undefined);

  return (
    <div className="flex flex-col items-center justify-center text-center px-3 py-4 rounded-lg transition-colors hover:bg-muted/30">
      <div className="flex items-center justify-center gap-2 mb-3">
        <div className={`inline-flex items-center justify-center w-6 h-6 rounded ${a.bg} ${a.text}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help hover:text-muted-foreground transition-colors" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
            {help}
          </TooltipContent>
        </Tooltip>
      </div>

      {loading ? (
        <Skeleton className="h-10 w-32" />
      ) : (
        <div className="text-4xl font-bold tracking-tight leading-none">{value}</div>
      )}

      {subtitle && !loading && (
        <p className="text-[11px] text-muted-foreground mt-1.5 max-w-[160px] truncate">{subtitle}</p>
      )}

      {showBreakdown && !loading && (
        <div className="flex items-center justify-center gap-3 mt-3">
          {breakdown?.aio !== undefined && (
            <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="font-medium text-foreground/70">{breakdown.aio}</span>
              <span className="text-muted-foreground/70">AIO</span>
            </div>
          )}
          {breakdown?.gpt !== undefined && (
            <div className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="font-medium text-foreground/70">{breakdown.gpt}</span>
              <span className="text-muted-foreground/70">GPT</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
