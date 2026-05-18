import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { TrendingUp, ExternalLink, ArrowRight, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { GSCRangeData } from '@/lib/gsc';

type Opp = GSCRangeData['opportunities'][number];

interface OpportunitiesPanelProps {
  opportunities: Opp[];
}

// Industry-ballpark organic CTR by position. Used only to ESTIMATE the prize
// (extra clicks if the page reached a realistic target position) so the list
// can be prioritised. Labelled as an estimate in the UI.
function expectedCtr(pos: number): number {
  if (pos <= 1) return 0.28;
  if (pos <= 2) return 0.15;
  if (pos <= 3) return 0.10;
  if (pos <= 4) return 0.07;
  if (pos <= 5) return 0.05;
  if (pos <= 6) return 0.04;
  if (pos <= 7) return 0.03;
  if (pos <= 8) return 0.025;
  if (pos <= 9) return 0.02;
  if (pos <= 10) return 0.018;
  if (pos <= 20) return 0.01;
  return 0.005;
}

function classify(pos: number, actualCtr: number) {
  if (pos <= 10 && actualCtr < expectedCtr(pos) * 0.6) {
    return {
      tag: 'Rewrite title & meta',
      steps: [
        'Put the exact search query near the front of the title tag.',
        'Write a benefit-led meta description that answers the query.',
        'Add a clear value or CTA so the snippet earns the click.',
      ],
    };
  }
  if (pos > 10) {
    return {
      tag: 'Push off page two',
      steps: [
        'Expand the section that targets this query with specific, useful detail.',
        'Add internal links from your stronger pages using this query as anchor text.',
        'Cover the related sub-questions so the page reads as the best answer.',
      ],
    };
  }
  return {
    tag: 'Close: refine intent',
    steps: [
      'Match the page intent tightly to what this query is asking.',
      'Add FAQ or schema so it can win rich results.',
      'Tighten the title to the query and trim anything off-topic.',
    ],
  };
}

function fixPlanPrompt(o: Opp): string {
  const where = o.page ? `My page ${o.page}` : 'One of my pages';
  return (
    `${where} ranks around position ${o.avg_position.toFixed(1)} for the query ` +
    `"${o.query}" with ${o.impressions.toLocaleString()} impressions but only ` +
    `${o.clicks.toLocaleString()} clicks recently. Give me a specific, prioritised ` +
    `plan to improve its ranking and click-through for this query.`
  );
}

export default function OpportunitiesPanel({ opportunities }: OpportunitiesPanelProps) {
  const rows = (opportunities || [])
    .filter((o) => o.avg_position >= 4 && o.avg_position <= 20 && o.impressions > 0)
    .map((o) => {
      const actualCtr = o.impressions > 0 ? o.clicks / o.impressions : 0;
      const targetPos = o.avg_position > 10 ? 8 : 3;
      const potential = Math.max(0, Math.round(o.impressions * expectedCtr(targetPos) - o.clicks));
      return { o, potential, rec: classify(o.avg_position, actualCtr) };
    })
    .sort((a, b) => b.potential - a.potential)
    .slice(0, 8);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Quick wins
        </CardTitle>
        <CardDescription>
          Ranked by estimated traffic to gain. Each row shows the page to edit, what to fix, and a one-click plan.
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
                  <th className="pb-2 font-medium">Query &amp; page</th>
                  <th className="pb-2 font-medium text-right">Pos</th>
                  <th className="pb-2 font-medium text-right">Impr.</th>
                  <th className="pb-2 font-medium text-right">
                    <span className="inline-flex items-center gap-1">
                      Est. clicks to gain
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" aria-label="How is this estimated?" className="text-muted-foreground/50 hover:text-muted-foreground">
                            <Info className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
                          Estimated extra clicks if this page reached a realistic target position, using a typical
                          click-through-by-position curve. An estimate for prioritising, not a guarantee.
                        </TooltipContent>
                      </Tooltip>
                    </span>
                  </th>
                  <th className="pb-2 font-medium">Fix</th>
                  <th className="pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ o, potential, rec }) => (
                  <tr key={o.query} className="border-t border-border/60 align-top">
                    <td className="py-2.5 pr-3 max-w-[320px]">
                      <div className="truncate font-medium" title={o.query}>{o.query}</div>
                      {o.page && (
                        <a
                          href={o.page}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary max-w-[300px]"
                          title={o.page}
                        >
                          <span className="truncate">{o.page.replace(/^https?:\/\//, '')}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      )}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{o.avg_position.toFixed(1)}</td>
                    <td className="py-2.5 text-right tabular-nums">{o.impressions.toLocaleString()}</td>
                    <td className="py-2.5 text-right tabular-nums font-semibold text-primary">
                      {potential > 0 ? `+${potential.toLocaleString()}` : '—'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full bg-secondary/60 px-2 py-0.5 text-xs font-medium hover:bg-secondary"
                          >
                            {rec.tag}
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[280px] text-xs leading-relaxed">
                          <p className="mb-1 font-semibold">How to fix</p>
                          <ul className="list-disc space-y-1 pl-4">
                            {rec.steps.map((s) => (
                              <li key={s}>{s}</li>
                            ))}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="py-2.5 text-right">
                      <Link
                        to={`/seo-assistant?q=${encodeURIComponent(fixPlanPrompt(o))}`}
                        className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-primary hover:underline"
                      >
                        Get a fix plan
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
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
