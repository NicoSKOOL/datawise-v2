import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useBlueprintPage } from './hooks';
import { recommendationClassName } from './badges';

const compactVolume = new Intl.NumberFormat('en', { notation: 'compact' });

const SUPPORTING_KEYWORDS_PREVIEW = 12;

const FIRED_SIGNAL_COPY: Record<string, string> = {
  distinct_intent: 'Searchers want something different here than on the parent page',
  low_serp_overlap: 'Google shows different results for this query',
  competitor_dedicated_pages: 'Competitors have a dedicated page for this',
  unique_conversion: 'Has its own conversion action',
  sufficient_demand: 'Enough monthly search demand',
  unique_local_proof: 'Real local presence in this area',
};

function firedSignalCopy(signal: string): string {
  return FIRED_SIGNAL_COPY[signal] ?? signal;
}

export function PageDetailPanel(props: { revisionId: string; pageId: string | null; onClose: () => void }) {
  const { revisionId, pageId, onClose } = props;
  const { toast } = useToast();
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const { data, isLoading, isError, error } = useBlueprintPage(revisionId, pageId);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setShowAllKeywords(false);
      onClose();
    }
  }

  async function handleCopySlug(slug: string) {
    try {
      await navigator.clipboard.writeText(slug);
      toast({ title: 'Slug copied' });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  }

  // pp-v3 revisions persist the page's authoritative supporting keyword list
  // (union across owner + folded clusters, minus the primary). Older revisions
  // predate it, so fall back to the primary cluster's raw members.
  const supportingFromPlan = data?.node.supportingKeywords ?? [];
  const members = supportingFromPlan.length > 0
    ? supportingFromPlan.map((keyword) => ({ keyword, volume: null as number | null }))
    : data?.cluster?.members ?? [];
  const visibleMembers = showAllKeywords ? members : members.slice(0, SUPPORTING_KEYWORDS_PREVIEW);
  const hiddenCount = members.length - visibleMembers.length;
  const totalMembers = supportingFromPlan.length > 0
    ? supportingFromPlan.length
    : data?.cluster?.totalMembers ?? members.length;

  return (
    <Sheet open={pageId !== null} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {isLoading && (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {isError && !isLoading && (
          <div className="mt-4 text-sm text-destructive">
            {error instanceof Error ? error.message : 'Failed to load page detail.'}
          </div>
        )}

        {data && !isLoading && (
          <div className="flex flex-col gap-6 pb-6">
            <SheetHeader className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <SheetTitle className="text-left">{data.node.title}</SheetTitle>
                <Badge className={cn('border-transparent shrink-0', recommendationClassName(data.node.recommendation))}>
                  {data.node.recommendation}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-xs text-muted-foreground" title={data.node.slug}>
                  {data.node.slug}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleCopySlug(data.node.slug)}
                >
                  <Copy className="h-3 w-3" />
                  <span className="sr-only">Copy slug</span>
                </Button>
              </div>
            </SheetHeader>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Primary keyword</h3>
              {data.node.primaryKeyword ? (
                <div className="text-sm">
                  <div className="font-bold">{data.node.primaryKeyword}</div>
                  <div className="text-muted-foreground">
                    {data.node.primaryVolume !== null ? `${compactVolume.format(data.node.primaryVolume)} / mo` : 'No volume data'}
                    {data.node.primaryIntent ? ` · ${data.node.primaryIntent}` : ''}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No primary keyword assigned.</div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Supporting keywords</h3>
              {members.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {visibleMembers.map((member, index) => (
                      <Badge key={`${member.keyword}-${index}`} variant="secondary" className="font-normal">
                        {member.keyword}
                      </Badge>
                    ))}
                    {!showAllKeywords && hiddenCount > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => setShowAllKeywords(true)}
                      >
                        +{hiddenCount} more
                      </Button>
                    )}
                  </div>
                  {totalMembers > members.length && (
                    <div className="text-xs text-muted-foreground">
                      (showing {members.length} of {totalMembers})
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No supporting keywords in this cluster.</div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Why this page exists</h3>
              {data.page.decisionReason && (
                <div className="mb-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-950">
                  {data.page.decisionReason}
                </div>
              )}
              {data.page.firedSignals.length > 0 ? (
                <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {data.page.firedSignals.map((signal) => (
                    <li key={signal}>{firedSignalCopy(signal)}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-muted-foreground">No signals recorded for this decision.</div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Competitor evidence</h3>
              {data.evidenceAvailable ? (
                data.competitorEvidence.length > 0 ? (
                  <ul className="space-y-1.5 text-sm">
                    {data.competitorEvidence.map((row, index) => (
                      <li key={`${row.domain}-${index}`} className="flex items-center justify-between gap-2">
                        <span className="truncate" title={row.domain}>
                          {row.domain}
                        </span>
                        <span className="shrink-0 text-muted-foreground">#{row.position}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-muted-foreground">No competitor pages found for this query.</div>
                )
              ) : (
                <div className="text-sm text-muted-foreground">Live SERP evidence was not collected for this query.</div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">FAQs</h3>
              {data.faqs.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {data.faqs.map((faq, index) => (
                    <li key={index}>
                      <div className="font-medium">{faq.question}</div>
                      {faq.source && <div className="text-xs text-muted-foreground">{faq.source}</div>}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-muted-foreground">No FAQs captured for this page.</div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">Fan-out queries</h3>
              <div className="text-sm text-muted-foreground">Coming with Phase 5</div>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
