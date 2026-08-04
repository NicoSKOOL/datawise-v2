import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getSessionToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface EstimatePlannedStage {
  stage: string;
  required: boolean;
  estimatedTasks: number;
  estimatedMinUsd: string;
  estimatedMaxUsd: string;
  cacheEligible: boolean;
}

interface ResearchEstimate {
  estimateId: string;
  expiresAt: string;
  plannedStages: EstimatePlannedStage[];
  totals: {
    dataForSeoMinUsd: string;
    dataForSeoMaxUsd: string;
    openRouterMaxUsd: string;
    estimatedDurationSecondsMin: number;
    estimatedDurationSecondsMax: number;
  };
  limitations: string[];
  fanoutAvailability: 'enabled' | 'disabled' | 'unsupported_market';
}

interface ApiFailureBody {
  requestId: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    fieldErrors?: Record<string, string[]>;
  };
}

// Thin wrapper around a raw fetch (mirrors the auth-header pattern in
// src/lib/api.ts) used only where we need the real HTTP status and the
// structured Blueprint error envelope, not just a stringified message. The
// shared `api()` helper stringifies `errorData.error`, which for Blueprint
// routes is an object (not a string), so it can't be used to distinguish a
// 409 stale-estimate conflict from any other failure.
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

class BlueprintRequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'BlueprintRequestError';
    this.status = status;
    this.code = code;
  }
}

async function blueprintApi<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  });

  if (!response.ok) {
    const fallback: ApiFailureBody = {
      requestId: '',
      error: { code: 'unknown', message: `API error: ${response.status}`, retryable: false },
    };
    const body = ((await response.json().catch(() => fallback)) as ApiFailureBody) ?? fallback;
    throw new BlueprintRequestError(
      response.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? `API error: ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

// Client-side ceiling validation. The worker accepts any non-negative USD
// string, but until billing exists we cap what the admin preview can submit
// so nobody fat-fingers a large DataForSEO spend.
const MAX_CEILING_USD = 10;

function validateCeiling(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return 'Enter a valid amount, e.g. 2.00';
  }
  const value = Number(trimmed);
  if (!(value > 0)) {
    return 'Ceiling must be greater than 0';
  }
  if (value > MAX_CEILING_USD) {
    return `Ceiling cannot exceed $${MAX_CEILING_USD.toFixed(2)} (temporary client-side cap)`;
  }
  return null;
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
  const navigate = useNavigate();

  const [creatingSample, setCreatingSample] = useState(false);
  const [startingRunFor, setStartingRunFor] = useState<Record<string, boolean>>({});
  const [activeRuns, setActiveRuns] = useState<Record<string, ResearchRunView>>({});
  const [fetchingEstimateFor, setFetchingEstimateFor] = useState<Record<string, boolean>>({});
  const [estimatesByProject, setEstimatesByProject] = useState<Record<string, ResearchEstimate>>({});
  const [ceilingByProject, setCeilingByProject] = useState<Record<string, string>>({});
  const [ceilingErrorByProject, setCeilingErrorByProject] = useState<Record<string, string | null>>({});
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

  async function handleGetEstimate(projectId: string) {
    setFetchingEstimateFor((prev) => ({ ...prev, [projectId]: true }));
    try {
      const estimateResponse = await blueprintApi<ApiSuccess<ResearchEstimate>>(
        `/api/blueprint/v1/projects/${projectId}/research-estimates`,
        { method: 'POST', body: {} }
      );
      setEstimatesByProject((prev) => ({ ...prev, [projectId]: estimateResponse.data }));
      setCeilingByProject((prev) => ({ ...prev, [projectId]: prev[projectId] ?? '2.00' }));
      setCeilingErrorByProject((prev) => ({ ...prev, [projectId]: null }));
    } catch (err) {
      toast({
        title: 'Could not fetch research estimate',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setFetchingEstimateFor((prev) => ({ ...prev, [projectId]: false }));
    }
  }

  function handleCeilingChange(projectId: string, value: string) {
    setCeilingByProject((prev) => ({ ...prev, [projectId]: value }));
    setCeilingErrorByProject((prev) => ({ ...prev, [projectId]: null }));
  }

  async function handleStartRun(projectId: string) {
    const estimate = estimatesByProject[projectId];
    if (!estimate) return;

    const rawCeiling = ceilingByProject[projectId] ?? '2.00';
    const validationError = validateCeiling(rawCeiling);
    if (validationError) {
      setCeilingErrorByProject((prev) => ({ ...prev, [projectId]: validationError }));
      return;
    }

    setStartingRunFor((prev) => ({ ...prev, [projectId]: true }));
    try {
      const runResponse = await blueprintApi<ApiSuccess<ResearchRunView>>(
        `/api/blueprint/v1/projects/${projectId}/research-runs`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': crypto.randomUUID() },
          body: {
            estimateId: estimate.estimateId,
            acceptedDataForSeoCeilingUsd: rawCeiling.trim(),
            // Accept the estimate's own OpenRouter ceiling (cents, billed to the
            // member's BYOK key). Hardcoding '0.00' predates the
            // adjudicate_clusters stage and silently starved it: every case was
            // capped at zero LLM calls because the run could reserve nothing.
            acceptedOpenRouterCeilingUsd: estimate.totals.openRouterMaxUsd ?? '0.00',
          },
        }
      );

      setActiveRuns((prev) => ({ ...prev, [projectId]: runResponse.data }));
      // The estimate is single-use in spirit: once a run starts, clear it so
      // the admin fetches a fresh one for the next run on this project.
      setEstimatesByProject((prev) => {
        const updated = { ...prev };
        delete updated[projectId];
        return updated;
      });
    } catch (err) {
      if (err instanceof BlueprintRequestError && err.status === 409) {
        toast({
          title: 'Estimate is no longer current',
          description:
            'The project brief changed (or this request already ran) since this estimate was created. Fetch a fresh estimate and try again.',
          variant: 'destructive',
        });
        setEstimatesByProject((prev) => {
          const updated = { ...prev };
          delete updated[projectId];
          return updated;
        });
      } else {
        toast({
          title: 'Could not start research run',
          description: (err as Error).message,
          variant: 'destructive',
        });
      }
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
        Research, clustering, and page planning are live. A finished run publishes a full
        site blueprint: open it with View blueprint. US fan-out evidence lands in a later
        phase, so runs finish as partial. Every run spends real DataForSEO budget, so get
        an estimate and set a ceiling before starting.
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
            const isFetchingEstimate = fetchingEstimateFor[project.id] ?? false;
            const isRunNonTerminal = activeRun
              ? NON_TERMINAL_RUN_STATUSES.includes(activeRun.status)
              : false;
            const estimate = estimatesByProject[project.id];
            const ceiling = ceilingByProject[project.id] ?? '2.00';
            const ceilingError = ceilingErrorByProject[project.id] ?? null;

            // Stage data (activeRun) only exists in this component's state once a
            // run has been started or polled this session; a fresh page load has
            // none of it. When it's missing we can't confirm publish_blueprint
            // succeeded, so show the button anyway and let the canvas page's
            // empty state handle a project that isn't actually published yet.
            // Never hide the only path to the canvas behind that loading race.
            const stagesKnown = !!activeRun;
            const publishSucceeded =
              activeRun?.stages.some(
                (stage) => stage.stage === 'publish_blueprint' && stage.status === 'succeeded'
              ) ?? false;
            const showViewBlueprint = project.latestRunId !== null && (!stagesKnown || publishSucceeded);

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
                  <div className="flex items-center gap-2">
                    {showViewBlueprint && (
                      <Button size="sm" onClick={() => navigate(`/blueprint/${project.id}`)}>
                        View blueprint
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleGetEstimate(project.id)}
                      disabled={isFetchingEstimate || isStarting || isRunNonTerminal}
                    >
                      {isFetchingEstimate && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {estimate ? 'Refresh estimate' : 'Get estimate'}
                    </Button>
                  </div>
                </div>

                {estimate && !isRunNonTerminal && (
                  <div className="mt-3 rounded-md border bg-muted/30 p-4 space-y-3 text-sm">
                    <div>
                      <p className="font-medium">Research estimate</p>
                      <p className="text-xs text-muted-foreground">
                        Expires {new Date(estimate.expiresAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="pr-4 pb-1 font-medium">Stage</th>
                            <th className="pr-4 pb-1 font-medium">Tasks</th>
                            <th className="pr-4 pb-1 font-medium">Est. cost (USD)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {estimate.plannedStages.map((stage) => (
                            <tr key={stage.stage} className="border-t">
                              <td className="pr-4 py-1">
                                {formatStageLabel(stage.stage)}
                                {!stage.required && ' (optional)'}
                              </td>
                              <td className="pr-4 py-1">{stage.estimatedTasks}</td>
                              <td className="pr-4 py-1">
                                ${stage.estimatedMinUsd}&ndash;${stage.estimatedMaxUsd}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <p>
                      Total DataForSEO: ${estimate.totals.dataForSeoMinUsd}&ndash;$
                      {estimate.totals.dataForSeoMaxUsd} &middot; OpenRouter: up to $
                      {estimate.totals.openRouterMaxUsd} (billed to your own OpenRouter key)
                    </p>

                    {estimate.limitations.length > 0 && (
                      <div>
                        <p className="font-medium">Limitations</p>
                        <ul className="list-disc list-inside text-muted-foreground">
                          {estimate.limitations.map((limitation) => (
                            <li key={limitation}>{limitation}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap items-end gap-4 border-t pt-3">
                      <div className="space-y-1">
                        <Label htmlFor={`ceiling-${project.id}`} className="text-xs">
                          DataForSEO ceiling (USD)
                        </Label>
                        <Input
                          id={`ceiling-${project.id}`}
                          value={ceiling}
                          onChange={(e) => handleCeilingChange(project.id, e.target.value)}
                          className="h-8 w-28"
                          disabled={isStarting}
                        />
                        {ceilingError && (
                          <p className="text-xs text-destructive">{ceilingError}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-medium">OpenRouter ceiling (USD)</p>
                        <p className="flex h-8 items-center text-sm text-muted-foreground">
                          $0.00 (fixed for this phase)
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleStartRun(project.id)}
                        disabled={isStarting || isRunNonTerminal}
                      >
                        {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Start research run
                      </Button>
                    </div>
                  </div>
                )}

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
