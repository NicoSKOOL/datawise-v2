import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import type { GSCOverviewData } from '@/lib/gsc';

interface OpportunitiesPanelProps {
  opportunities: GSCOverviewData['opportunities'];
}

// Queries already earning impressions but stuck just off page one. The single
// most actionable thing on the dashboard: small on-page pushes here convert to
// fast traffic. Sourced entirely from GSC data already in the payload.
export default function OpportunitiesPanel({ opportunities }: OpportunitiesPanelProps) {
  const rows = (opportunities || [])
    .filter((o) => o.avg_position >= 4 && o.avg_position <= 20 && o.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Quick wins
        </CardTitle>
        <CardDescription>
          Queries on the edge of page one. Small on-page pushes here turn into fast traffic.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No striking-distance queries yet. As Search Console gathers more data, near-page-one
            opportunities will show up here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 font-medium">Query</th>
                  <th className="pb-2 font-medium text-right">Position</th>
                  <th className="pb-2 font-medium text-right">Impressions</th>
                  <th className="pb-2 font-medium text-right">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.query} className="border-t border-border/60">
                    <td className="py-2 pr-3 max-w-[280px] truncate" title={o.query}>{o.query}</td>
                    <td className="py-2 text-right tabular-nums">{o.avg_position.toFixed(1)}</td>
                    <td className="py-2 text-right tabular-nums">{o.impressions.toLocaleString()}</td>
                    <td className="py-2 text-right tabular-nums">{o.clicks.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
