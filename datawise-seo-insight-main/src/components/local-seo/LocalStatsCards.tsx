import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import type { LocalProjectReport } from '@/types/local-seo';

interface LocalStatsCardsProps {
  report: LocalProjectReport | null;
}

function DeltaBadge({ current, previous, invert = false }: { current: number | null; previous: number | null; invert?: boolean }) {
  if (current == null || previous == null || previous === 0) {
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />--</span>;
  }
  const diff = current - previous;
  if (diff === 0) {
    return <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />0</span>;
  }
  const isGood = invert ? diff < 0 : diff > 0;
  if (isGood) {
    return (
      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 inline-flex items-center gap-0.5">
        <ArrowUp className="h-3 w-3" />{Math.abs(diff)}
      </span>
    );
  }
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 inline-flex items-center gap-0.5">
      <ArrowDown className="h-3 w-3" />{Math.abs(diff)}
    </span>
  );
}

export default function LocalStatsCards({ report }: LocalStatsCardsProps) {
  if (!report) return null;

  const { current, previous } = report;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Tracked Keywords</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{current.total_keywords}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{current.in_pack} in local pack</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Avg Pack Position</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{current.avg_pack_position ?? '--'}</span>
            <DeltaBadge current={current.avg_pack_position} previous={previous.avg_pack_position} invert />
          </div>
          <p className="text-xs text-muted-foreground mt-1">in Google Maps</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Top 3 Keywords</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{current.distribution.top3}</span>
            <DeltaBadge current={current.distribution.top3} previous={previous.distribution.top3} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">in local pack top 3</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground">Rating</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{current.avg_rating ?? '--'}</span>
            <DeltaBadge current={current.avg_rating} previous={previous.avg_rating} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">avg from checks</p>
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
