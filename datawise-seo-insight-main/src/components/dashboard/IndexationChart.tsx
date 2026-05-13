import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { IndexationData } from '@/lib/gsc';

interface IndexationChartProps {
  data: IndexationData | null;
  onSync?: () => void;
  syncing?: boolean;
}

const COLORS = { visible: '#22c55e', sitemapOnly: '#a1a1aa' };

function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
      <AlertCircle className="h-5 w-5 text-muted-foreground/70" />
      <p className="max-w-sm">{message}</p>
      {action}
    </div>
  );
}

export default function IndexationChart({ data, onSync, syncing = false }: IndexationChartProps) {
  const title = 'Search-visible pages';

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState message="Sync your Search Console data to compare sitemap URLs with pages that have appeared in GSC Search Analytics." />
        </CardContent>
      </Card>
    );
  }

  if (data.status === 'needs_sync') {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            message={data.message}
            action={onSync ? (
              <Button size="sm" onClick={onSync} disabled={syncing} className="gap-1.5">
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync Search Console data'}
              </Button>
            ) : null}
          />
        </CardContent>
      </Card>
    );
  }

  if (data.status === 'manual_property' || data.status === 'no_page_data' || data.status === 'sitemap_unavailable') {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState message={data.message} />
        </CardContent>
      </Card>
    );
  }

  const searchVisiblePages = data.search_visible_pages ?? data.indexed;
  const chartData = [
    { name: 'Search-visible', value: searchVisiblePages },
    { name: 'Sitemap-only', value: data.not_indexed },
  ].filter(d => d.value > 0);

  const sitemapOnlyPct = data.total > 0
    ? Math.round((data.not_indexed / data.total) * 1000) / 10
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.name === 'Search-visible' ? COLORS.visible : COLORS.sitemapOnly}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [`${value.toLocaleString()} pages`, name]}
              contentStyle={{ borderRadius: '8px', fontSize: '12px', border: '1px solid #e5e7eb' }}
            />
            <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-3xl font-bold">
              {data.indexed_pct}%
            </text>
            <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs">
              visible
            </text>
          </PieChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap justify-center gap-4 mt-2">
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS.visible }} />
            <span className="text-muted-foreground">Search-visible</span>
            <span className="font-medium">{searchVisiblePages.toLocaleString()}</span>
            <span className="text-muted-foreground">({data.indexed_pct}%)</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS.sitemapOnly }} />
            <span className="text-muted-foreground">Sitemap-only</span>
            <span className="font-medium">{data.not_indexed.toLocaleString()}</span>
            <span className="text-muted-foreground">({sitemapOnlyPct}%)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
