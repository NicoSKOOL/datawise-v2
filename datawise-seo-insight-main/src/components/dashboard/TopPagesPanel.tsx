import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, ExternalLink } from 'lucide-react';

interface TopPage {
  page: string;
  clicks: number;
  impressions: number;
  avg_position: number;
}

interface TopPagesPanelProps {
  pages: TopPage[];
}

// Page-level performance: which URLs actually earn the traffic. A different
// lens from Quick wins (query opportunities) and the trend chart (time series).
// Sourced from GSC data already in the payload; range-aware via the range block.
export default function TopPagesPanel({ pages }: TopPagesPanelProps) {
  const rows = (pages || [])
    .filter((p) => p.page && p.impressions > 0)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 8);

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Top pages
        </CardTitle>
        <CardDescription>Your best-performing pages for the selected period.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No page data yet for this period. It will appear as Search Console gathers data.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 font-medium">Page</th>
                  <th className="pb-2 font-medium text-right">Clicks</th>
                  <th className="pb-2 font-medium text-right">Impr.</th>
                  <th className="pb-2 font-medium text-right">Pos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.page} className="border-t border-border/60">
                    {/* min-w-0 + block-level flex + truncate child is the
                        canonical Tailwind pattern for clipping long URLs
                        inside a flex container. The prior inline-flex
                        anchor wouldn't respect the column max-width, so
                        long URLs overlapped the Clicks/Impr/Pos cells
                        (bugs bac2d0601e3eb50b0fb966e7ec199e54 and
                        dc9af2b28d3b32aea37bbc31fd34540c). */}
                    <td className="py-2.5 pr-3 max-w-[300px] min-w-0">
                      <a
                        href={p.page}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 min-w-0 hover:text-primary"
                        title={p.page}
                      >
                        <span className="truncate min-w-0 flex-1">{p.page.replace(/^https?:\/\//, '')}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </td>
                    <td className="py-2.5 text-right tabular-nums font-medium">{p.clicks.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums">{p.impressions.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums">{p.avg_position.toFixed(1)}</td>
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
