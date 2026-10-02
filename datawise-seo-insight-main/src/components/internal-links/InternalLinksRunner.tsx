import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { advanceRun, listRuns, type InternalLinkRun } from '@/lib/internal-links';

// Drives the member's active Internal Links run from the app shell, so it
// keeps going at full speed on any DataWise page, not just /internal-links.
// Each advance call does ~45s of work on the server. If DataWise is closed
// the */5 cron still finishes the run, just more slowly.
export function InternalLinksRunner() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const where = useRef(location);
  where.current = location;

  // Shared with the Internal Links page, which invalidates it when a run is
  // started, resumed or confirmed. Only polled while a run is in flight.
  const runs = useQuery({
    queryKey: ['internal-link-runs'],
    queryFn: listRuns,
    enabled: !!user,
    refetchInterval: (q) => (q.state.data?.runs.some((r) => r.status === 'running') ? 60_000 : false),
    refetchIntervalInBackground: true,
  });
  const activeId = runs.data?.runs.find((r) => r.status === 'running')?.id;

  useEffect(() => {
    if (!activeId) return;
    let stopped = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const finished = (run: InternalLinkRun) => {
      qc.invalidateQueries({ queryKey: ['internal-link-runs'] });
      const site = run.site_url.replace(/^https?:\/\/(www\.)?/, '');
      const onIt = where.current.pathname === '/internal-links' && where.current.search.includes(run.id);
      if (run.status === 'completed' && !onIt) {
        toast({
          // The member is busy elsewhere; give them time to notice it.
          duration: 60_000,
          title: `Internal links ready for ${site}`,
          description: `${run.summary?.links ?? 0} links to review.`,
          action: (
            <ToastAction altText="Open report" onClick={() => navigate(`/internal-links?run=${run.id}`)}>
              Open report
            </ToastAction>
          ),
        });
      } else if (run.status === 'failed' && !onIt) {
        toast({
          duration: 60_000,
          variant: 'destructive',
          title: `Internal links run stopped for ${site}`,
          description: run.error ?? 'Open the run to resume it.',
          action: (
            <ToastAction altText="Open run" onClick={() => navigate(`/internal-links?run=${run.id}`)}>
              Open run
            </ToastAction>
          ),
        });
      }
    };

    (async () => {
      while (!stopped) {
        try {
          const res = await advanceRun(activeId);
          if (stopped) return;
          if (res.run) qc.setQueryData(['internal-link-run', activeId], { run: res.run });
          if (!res.run) return void qc.invalidateQueries({ queryKey: ['internal-link-runs'] });
          if (res.run.status !== 'running') return finished(res.run);
          // Another tab or the cron holds the run right now.
          if (!res.advanced) await sleep(3000);
        } catch {
          await sleep(5000);
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [activeId, qc, toast, navigate]);

  return null;
}
