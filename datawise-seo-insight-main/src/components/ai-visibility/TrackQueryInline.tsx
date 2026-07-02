import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CalendarClock } from 'lucide-react';
import { useProperty } from '@/contexts/PropertyContext';
import TrackQueryDialog from './TrackQueryDialog';

// Bridge from a one-off instant check to the persistent tracker: "this
// answer was interesting, watch it every week." Renders as a quiet row
// under the check results.
export default function TrackQueryInline({ query }: { query: string }) {
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const { primaryDomain } = useProperty();

  if (!query.trim()) return null;

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-dashed px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4 flex-shrink-0" />
          <span>One-off checks are not saved. Track "{query.trim()}" weekly to build a trend in your Performance report.</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setPendingQuery(query)}>
          Track weekly
        </Button>
      </div>

      <TrackQueryDialog
        query={pendingQuery}
        onOpenChange={(open) => { if (!open) setPendingQuery(null); }}
        defaultDomain={primaryDomain || undefined}
      />
    </>
  );
}
