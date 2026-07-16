import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useLatestBlueprint, useBlueprintGraph } from './canvas/hooks';
import { PageMap } from './canvas/PageMap';
import { PageTable } from './canvas/PageTable';
import { PageDetailPanel } from './canvas/PageDetailPanel';
import { ExportMenu } from './canvas/ExportMenu';

// Local mirror of the worker's BlueprintSummary contract
// (workers/src/blueprint/db/blueprint-reads.ts). BlueprintLatestView types
// `summary` as Record<string, unknown> since the shape can grow across
// schema versions; this is the subset the canvas stats strip reads today.
interface BlueprintSummary {
  pageCount?: number;
  byRecommendation?: { keep?: number; update?: number; create?: number; consolidate?: number };
  byPageType?: Record<string, number>;
  addressableDemandTotal?: number | null;
  warningCount?: number;
  partialStages?: string[];
}

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact' });

const RECOMMENDATION_ORDER: { key: keyof NonNullable<BlueprintSummary['byRecommendation']>; label: string }[] = [
  { key: 'create', label: 'Create' },
  { key: 'update', label: 'Update' },
  { key: 'keep', label: 'Keep' },
  { key: 'consolidate', label: 'Consolidate' },
];

function StatChip(props: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="text-lg font-semibold">{props.value}</div>
    </div>
  );
}

function CenteredSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function BlueprintCanvas() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'table'>('map');

  const { data: latest, isLoading, isError, error, refetch } = useLatestBlueprint(projectId ?? '');
  const revisionId = latest?.revision.id;
  const { data: graph, isLoading: graphLoading } = useBlueprintGraph(revisionId);

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The worker's NotFoundError branch is the only backend error whose message
  // reaches this component as the exact string 'Not Found' (see api.ts). That
  // is the real "no blueprint published yet" case. Any other error message is
  // a genuine backend failure and must not be shown as the empty state, since
  // that copy could prompt an admin to kick off a redundant paid run.
  const isNotFound = isError && error instanceof Error && error.message === 'Not Found';

  if (isError && !isNotFound) {
    return (
      <div className="p-6">
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle>Could not load the blueprint</CardTitle>
            <CardDescription>
              Something went wrong while loading this project's blueprint. The run itself is not affected.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button onClick={() => refetch()}>Retry</Button>
            <Button asChild variant="outline">
              <Link to="/blueprint">Back to projects</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isNotFound || !latest) {
    return (
      <div className="p-6">
        <Card className="mx-auto max-w-lg">
          <CardHeader>
            <CardTitle>No blueprint yet</CardTitle>
            <CardDescription>
              No blueprint published yet for this project. Run the research pipeline first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/blueprint">Back to projects</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const nodes = graph?.nodes ?? [];
  const summary = latest.summary as BlueprintSummary | undefined;

  const otherPartialReasons = latest.partialReasons.filter((reason) => reason !== 'collect_us_fanout');
  const hasFanoutGap = latest.partialReasons.includes('collect_us_fanout');
  let completenessLabel: string;
  if (latest.partialReasons.length === 0) {
    completenessLabel = 'Complete';
  } else if (hasFanoutGap) {
    completenessLabel =
      otherPartialReasons.length > 0
        ? `Partial: US fan-out pending, ${otherPartialReasons.join(', ')}`
        : 'Partial: US fan-out pending';
  } else {
    completenessLabel = `Partial: ${latest.partialReasons.join(', ')}`;
  }
  const isComplete = latest.partialReasons.length === 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/blueprint">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to projects</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Blueprint</h1>
            <p className="text-sm text-muted-foreground">
              Version {latest.versionNumber} &middot; Revision {latest.revision.revisionNumber}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              'border-transparent',
              isComplete ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            )}
            title={completenessLabel}
          >
            {completenessLabel}
          </Badge>
          <ExportMenu revisionId={latest.revision.id} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <StatChip label="Recommended pages" value={nodes.length} />
        {summary?.byRecommendation &&
          RECOMMENDATION_ORDER.map(({ key, label }) => (
            <StatChip key={key} label={label} value={summary.byRecommendation?.[key] ?? 0} />
          ))}
        {summary?.addressableDemandTotal !== undefined && summary?.addressableDemandTotal !== null && (
          <StatChip
            label="Addressable monthly searches"
            value={compactNumber.format(summary.addressableDemandTotal)}
          />
        )}
      </div>

      <Tabs value={view} onValueChange={(value) => setView(value as 'map' | 'table')}>
        <TabsList>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>
        <TabsContent value="map" className="mt-4">
          <div className="h-[calc(100vh-280px)] min-h-[480px] rounded-md border">
            {graphLoading ? (
              <CenteredSpinner />
            ) : (
              <PageMap nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </div>
        </TabsContent>
        <TabsContent value="table" className="mt-4">
          <div className="h-[calc(100vh-280px)] min-h-[480px]">
            {graphLoading ? (
              <CenteredSpinner />
            ) : (
              <PageTable nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </div>
        </TabsContent>
      </Tabs>

      <PageDetailPanel
        revisionId={latest.revision.id}
        pageId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
