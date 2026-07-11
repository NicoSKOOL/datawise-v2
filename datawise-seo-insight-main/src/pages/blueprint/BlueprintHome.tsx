import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Local mirrors of the worker's blueprint contracts (workers/src/blueprint/contracts/*).
// Frontend and worker are separate build targets, so these are copied, not imported.

type ProjectMode = 'greenfield' | 'existing_site';

type RunStatus =
  | 'draft' | 'estimating' | 'queued' | 'running' | 'partial'
  | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled';

type StageStatus =
  | 'pending' | 'queued' | 'running' | 'succeeded' | 'skipped'
  | 'partial' | 'retry_wait' | 'failed' | 'cancelled';

const NON_TERMINAL_RUN_STATUSES: RunStatus[] = ['queued', 'running', 'cancel_requested'];

interface ApiSuccess<T> {
  requestId: string;
  data: T;
}

interface ProjectView {
  id: string;
  name: string;
  mode: ProjectMode;
  createdAt: string;
  latestRunId: string | null;
}

interface ProjectListResponse {
  items: ProjectView[];
  nextCursor: string | null;
}

interface ResearchEstimate {
  estimateId: string;
}

interface ResearchStageView {
  stage: string;
  status: StageStatus;
  message: string | null;
}

interface ResearchRunView {
  id: string;
  projectId: string;
  status: RunStatus;
  currentStage: string | null;
  stages: ResearchStageView[];
  partialReasons: string[];
}

interface BlueprintHealth {
  ok: boolean;
  module: string;
  version: string;
  checks: Record<string, string>;
}

// Canned brief for the "Create sample project" button. Kept intentionally
// small: enough to exercise every stage without requiring an intake form
// (that lands in Phase 6).
const SAMPLE_BRIEF = {
  businessName: 'Aqua Plumbing (sample)',
  category: 'Plumber',
  countryIso: 'us',
  languageCode: 'en',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning' },
  ],
  serviceAreas: [
    {
      clientId: 'a1',
      city: 'Austin',
      countryIso: 'us',
      isPrimary: true,
      uniqueProof: ['South Lamar office'],
    },
  ],
};

function formatStageLabel(stage: string): string {
  return stage
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function stageBadgeClasses(status: StageStatus): string {
  switch (status) {
    case 'running':
    case 'retry_wait':
      return 'border-transparent bg-blue-100 text-blue-800';
    case 'succeeded':
      return 'border-transparent bg-green-100 text-green-800';
    case 'skipped':
    case 'partial':
      return 'border-transparent bg-amber-100 text-amber-800';
    case 'failed':
      return 'border-transparent bg-red-100 text-red-800';
    case 'cancelled':
      return 'border-transparent bg-gray-200 text-gray-600';
    case 'pending':
    case 'queued':
    default:
      return 'border-transparent bg-gray-100 text-gray-700';
  }
}

function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'estimating':
      return 'Estimating';
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'partial':
      return 'Finished with gaps (partial)';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'cancel_requested':
      return 'Cancel requested';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

function RunProgressPanel({ run }: { run: ResearchRunView }) {
  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        {NON_TERMINAL_RUN_STATUSES.includes(run.status) && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        <p className="text-sm font-medium">
          Run status: {runStatusLabel(run.status)}
          {run.currentStage && NON_TERMINAL_RUN_STATUSES.includes(run.status)
            ? ` (currently: ${formatStageLabel(run.currentStage)})`
            : ''}
        </p>
      </div>

      {run.partialReasons.length > 0 && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
          <p className="font-medium">Partial reasons:</p>
          <ul className="list-disc list-inside">
            {run.partialReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {run.stages.map((stage) => (
          <Badge
            key={stage.stage}
            variant="outline"
            className={cn('font-normal', stageBadgeClasses(stage.status))}
            title={stage.message ?? undefined}
          >
            {formatStageLabel(stage.stage)}: {stage.status}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function BlueprintHome() {
  const queryClient = useQueryClient();

  const [creatingSample, setCreatingSample] = useState(false);
  const [startingRunFor, setStartingRunFor] = useState<Record<string, boolean>>({});
  const [activeRuns, setActiveRuns] = useState<Record<string, ResearchRunView>>({});
  const activeRunsRef = useRef(activeRuns);
  // Track consecutive failures per runId to avoid toast spam: only show on
  // first failure, stop polling after 3 consecutive failures.
  const failureCountsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    activeRunsRef.current = activeRuns;
  }, [activeRuns]);

  const {
    data: projectsData,
    isLoading: projectsLoading,
    error: projectsError,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: ['blueprint-projects'],
    queryFn: () => api<ApiSuccess<ProjectListResponse>>('/api/blueprint/v1/projects'),
  });

  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
  } = useQuery({
    queryKey: ['blueprint-health'],
    queryFn: () => api<BlueprintHealth>('/api/blueprint/v1/health'),
  });

  // Poll every 3 seconds for any run that is still queued, running, or
  // cancel-requested. Runs that reach a terminal status (partial, succeeded,
  // failed, cancelled) simply stop being included in the poll batch; the
  // interval itself is cleared once on unmount.
  useEffect(() => {
    const interval = setInterval(async () => {
      const current = activeRunsRef.current;
      const toPoll = Object.entries(current).filter(([, run]) =>
        NON_TERMINAL_RUN_STATUSES.includes(run.status)
      );
      if (toPoll.length === 0) return;

      await Promise.all(
        toPoll.map(async ([projectId, run]) => {
          try {
            const response = await api<ApiSuccess<ResearchRunView>>(
              `/api/blueprint/v1/research-runs/${run.id}`
            );
            setActiveRuns((prev) => ({ ...prev, [projectId]: response.data }));
            // Reset failure count on success
            failureCountsRef.current[run.id] = 0;
          } catch (err) {
            const currentCount = failureCountsRef.current[run.id] ?? 0;
            const newCount = currentCount + 1;
            failureCountsRef.current[run.id] = newCount;

            // Show toast only on first failure (0 to 1 transition)
            if (currentCount === 0) {
              toast({
                title: 'Run status check failed',
                description: (err as Error).message,
                variant: 'destructive',
              });
            }

            // Stop polling after 3 consecutive failures
            if (newCount >= 3) {
              setActiveRuns((prev) => {
                const updated = { ...prev };
                delete updated[projectId];
                return updated;
              });
              const shortId = run.id.slice(0, 8);
              toast({
                title: 'Stopped polling run ' + shortId,
                description: 'After repeated errors. Reload the page to resume.',
                variant: 'destructive',
              });
            }
          }
        })
      );
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  async function handleCreateSample() {
    setCreatingSample(true);
    try {
      await api('/api/blueprint/v1/projects', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: SAMPLE_BRIEF,
      });
      toast({ title: 'Sample project created' });
      await queryClient.invalidateQueries({ queryKey: ['blueprint-projects'] });
      refetchProjects();
    } catch (err) {
      toast({
        title: 'Could not create sample project',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setCreatingSample(false);
    }
  }

  async function handleRunResearch(projectId: string) {
    setStartingRunFor((prev) => ({ ...prev, [projectId]: true }));
    try {
      const estimateResponse = await api<ApiSuccess<ResearchEstimate>>(
        `/api/blueprint/v1/projects/${projectId}/research-estimates`,
        { method: 'POST', body: {} }
      );

      const runResponse = await api<ApiSuccess<ResearchRunView>>(
        `/api/blueprint/v1/projects/${projectId}/research-runs`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: {
            estimateId: estimateResponse.data.estimateId,
            acceptedDataForSeoCeilingUsd: '0.00',
            acceptedOpenRouterCeilingUsd: '0.00',
          },
        }
      );

      setActiveRuns((prev) => ({ ...prev, [projectId]: runResponse.data }));
    } catch (err) {
      toast({
        title: 'Could not start research run',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setStartingRunFor((prev) => ({ ...prev, [projectId]: false }));
    }
  }

  const projects = projectsData?.data.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Blueprint</h1>
      <p className="text-muted-foreground">
        Website architecture planner (admin preview). Turns a business brief into an
        evidence-backed site structure.
      </p>
      <p className="text-sm text-muted-foreground">
        Stub pipeline: research stages are placeholders until Phase 3; runs finish as
        partial with the fan-out stage skipped.
      </p>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Projects</CardTitle>
            <CardDescription>Admin preview projects for exercising the Blueprint pipeline.</CardDescription>
          </div>
          <Button onClick={handleCreateSample} disabled={creatingSample}>
            {creatingSample && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create sample project
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {projectsLoading && <p className="text-sm">Loading projects...</p>}
          {projectsError && (
            <p className="text-sm text-destructive">
              Could not load projects: {(projectsError as Error).message}
            </p>
          )}
          {!projectsLoading && !projectsError && projects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No projects yet. Use "Create sample project" to get started.
            </p>
          )}
          {projects.map((project) => {
            const activeRun = activeRuns[project.id];
            const isStarting = startingRunFor[project.id] ?? false;
            const isRunNonTerminal = activeRun
              ? NON_TERMINAL_RUN_STATUSES.includes(activeRun.status)
              : false;

            return (
              <div key={project.id} className="rounded-md border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{project.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Mode: {project.mode} &middot; Created:{' '}
                      {new Date(project.createdAt).toLocaleString()} &middot; Latest run:{' '}
                      {project.latestRunId ?? 'none'}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleRunResearch(project.id)}
                    disabled={isStarting || isRunNonTerminal}
                  >
                    {(isStarting || isRunNonTerminal) && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Run research (no provider costs yet)
                  </Button>
                </div>
                {activeRun && <RunProgressPanel run={activeRun} />}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backend health</CardTitle>
          <CardDescription>Admin preview: raw status of the Blueprint worker module.</CardDescription>
        </CardHeader>
        <CardContent>
          {healthLoading && <p className="text-sm">Checking Blueprint backend...</p>}
          {healthError && (
            <p className="text-sm text-destructive">
              Backend check failed: {(healthError as Error).message}
            </p>
          )}
          {health && (
            <div className="rounded-md border p-4 text-sm space-y-1">
              <p className="font-medium">Backend status: {health.ok ? 'healthy' : 'degraded'}</p>
              {Object.entries(health.checks).map(([name, status]) => (
                <p key={name}>
                  {name}: {status}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
