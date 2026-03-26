import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProjectReport } from '@/types/rank-tracking';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';

interface ProjectStatsCardsProps {
  report: ProjectReport | null;
}

function DeltaBadge({ current, previous, invert = false }: { current: number | null; previous: number | null; invert?: boolean }) {
  if (current == null || previous == null || previous === 0) {
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />--</span>;
  }

  const diff = current - previous;
  if (diff === 0) {
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />0</span>;
  }

  // For position, lower is better (invert=true)
  const isGood = invert ? diff < 0 : diff > 0;
  const displayValue = invert ? Math.abs(diff) : Math.abs(diff);

  if (isGood) {
    return (
      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 inline-flex items-center gap-0.5">
        <ArrowUp className="h-3 w-3" />{displayValue}
      </span>
    );
  }

  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 inline-flex items-center gap-0.5">
      <ArrowDown className="h-3 w-3" />{displayValue}
    </span>
  );
}

export default function ProjectStatsCards({ report }: ProjectStatsCardsProps) {
  if (!report) return null;

  const { current, previous } = report;
  const top10 = current.distribution.top3 + current.distribution.top10;
  const prevTop10 = previous.distribution.top3 + previous.distribution.top10;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Tracked Keywords</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{current.total_keywords}</span>
            <DeltaBadge current={current.total_keywords} previous={previous.total_keywords} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{current.ranking_keywords} ranking</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Average Position</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{current.avg_position ?? '--'}</span>
            <DeltaBadge current={current.avg_position} previous={previous.avg_position} invert />
          </div>
          <p className="text-xs text-muted-foreground mt-1">across ranking keywords</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Top 10 Keywords</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{top10}</span>
            <DeltaBadge current={top10} previous={prevTop10} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{current.distribution.top3} in top 3</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Movement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 inline-flex items-center gap-0.5">
              <ArrowUp className="h-3 w-3" />{current.improved}
            </span>
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 inline-flex items-center gap-0.5">
              <ArrowDown className="h-3 w-3" />{current.declined}
            </span>
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5">
              <Minus className="h-3 w-3" />{current.stable}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">since last check</p>
        </CardContent>
      </Card>
    </div>
  );
}
