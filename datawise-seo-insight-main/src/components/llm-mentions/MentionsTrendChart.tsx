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
import type { LlmSearchRow } from '@/lib/llm-mentions';

interface MentionsTrendChartProps {
  rows: LlmSearchRow[];
  totalCount?: number;
  loading: boolean;
  enabled: boolean;
}

interface BucketRow {
  month: string;
  label: string;
  newMentions: number;
  aiVolume: number;
}

function monthKey(iso: string | undefined): string | null {
  if (!iso || iso.length < 7) return null;
  return iso.slice(0, 7);
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function buildBuckets(rows: LlmSearchRow[]): BucketRow[] {
  if (!rows.length) return [];
  const buckets = new Map<string, { newMentions: number; aiVolume: number }>();

  for (const row of rows) {
    const key = monthKey(row.first_response_at);
    if (key) {
      const entry = buckets.get(key) ?? { newMentions: 0, aiVolume: 0 };
      entry.newMentions += 1;
      buckets.set(key, entry);
    }

    const monthly = row.monthly_searches ?? [];
    for (const ms of monthly) {
      if (!ms?.year || !ms?.month) continue;
      const k = `${ms.year}-${String(ms.month).padStart(2, '0')}`;
      const entry = buckets.get(k) ?? { newMentions: 0, aiVolume: 0 };
      entry.aiVolume += Number(ms.search_volume ?? ms.ai_search_volume ?? 0);
      buckets.set(k, entry);
    }
  }

  const sortedKeys = Array.from(buckets.keys()).sort();
  if (!sortedKeys.length) return [];

  // Fill gaps so the line is continuous.
  const filled: BucketRow[] = [];
  const [firstY, firstM] = sortedKeys[0].split('-').map(Number);
  const [lastY, lastM] = sortedKeys[sortedKeys.length - 1].split('-').map(Number);
  let y = firstY;
  let m = firstM;
  while (y < lastY || (y === lastY && m <= lastM)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    const entry = buckets.get(k) ?? { newMentions: 0, aiVolume: 0 };
    filled.push({
      month: k,
      label: formatMonthLabel(k),
      newMentions: entry.newMentions,
      aiVolume: entry.aiVolume,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return filled;
}

function fmtCompact(n: number): string {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function MentionsTrendChart({
  rows,
  totalCount,
  loading,
  enabled,
}: MentionsTrendChartProps) {
  const buckets = useMemo(() => buildBuckets(rows), [rows]);
  const sampleNote =
    totalCount && rows.length < totalCount
      ? `Sampled ${rows.length} of ${totalCount} mentions`
      : rows.length
      ? `${rows.length} mentions analyzed`
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
                  New mentions are counted by when DataForSEO first saw each prompt mention your
                  brand. AI search volume sums the monthly volume of every mentioning prompt.
                </TooltipContent>
              </UiTooltip>
            </CardTitle>
            <CardDescription>{sampleNote || 'When your brand started surfacing in AI answers'}</CardDescription>
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
                dataKey="newMentions"
                name="New mentions"
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
