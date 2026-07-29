import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Info } from 'lucide-react';
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { mergeHistoricalSeries, type LlmHistoricalItem } from '@/lib/llm-historical';

interface MentionsTrendChartProps {
  googleItems?: LlmHistoricalItem[] | null;
  chatgptItems?: LlmHistoricalItem[] | null;
  loading: boolean;
  enabled: boolean;
}

function fmtCompact(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function MentionsTrendChart({
  googleItems,
  chatgptItems,
  loading,
  enabled,
}: MentionsTrendChartProps) {
  const buckets = useMemo(
    () => mergeHistoricalSeries([googleItems, chatgptItems]),
    [googleItems, chatgptItems]
  );
  const totalMentions = useMemo(
    () => buckets.reduce((sum, b) => sum + b.mentions, 0),
    [buckets]
  );
  const sampleNote = buckets.length
    ? `${fmtCompact(totalMentions)} mentions across ${buckets.length} months`
    : '';

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-1.5">
              Mentions over time
              <UiTooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  Monthly totals from DataForSEO, available from August 2025 onward. Mentions counts
                  every prompt that mentioned your brand that month. AI search volume sums the
                  monthly volume of those prompts. ChatGPT coverage is US and English only.
                </TooltipContent>
              </UiTooltip>
            </CardTitle>
            <CardDescription>{sampleNote || 'How often your brand surfaces in AI answers'}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!enabled ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            Enter a domain above and click Analyze.
          </div>
        ) : loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : buckets.length === 0 ? (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            Not enough time-series data to draw a trend.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={buckets} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={fmtCompact}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={fmtCompact}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) => [fmtCompact(value), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="mentions"
                name="Mentions"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="aiVolume"
                name="AI search volume"
                stroke="#16a34a"
                strokeWidth={2}
                dot={false}
                strokeDasharray="4 3"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
