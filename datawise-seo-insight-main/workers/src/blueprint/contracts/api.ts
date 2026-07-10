// API contracts: request/response DTOs + error envelope.
// Copied verbatim from .superpowers/sdd/phase2-research.md §3 (API_AND_DATA_CONTRACTS.md §1, §2, §6, §14).
// Types only. No runtime code.

import type { BlueprintErrorCode, BlueprintStage, RunStatus, StageStatus, ProjectMode } from './enums';
import type { NormalizedProjectBrief } from './types';

export interface ApiSuccess<T> {
  requestId: string;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  requestId: string;
  error: {
    code: BlueprintErrorCode;
    message: string;
    retryable: boolean;
    retryAfterSeconds?: number;
    fieldErrors?: Record<string, string[]>;
    stage?: BlueprintStage;
  };
}

export interface ResearchStageView {
  stage: BlueprintStage;
  status: StageStatus;
  required: boolean;
  progressCurrent: number | null;
  progressTotal: number | null;
  attemptCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  nextRetryAt: string | null;
  message: string | null;
  safeErrorCode: BlueprintErrorCode | null;
  actualCostUsd: string;
}

export interface ResearchRunView {
  id: string;
  projectId: string;
  status: RunStatus;
  currentStage: BlueprintStage | null;
  stages: ResearchStageView[];
  startedAt: string | null;
  finishedAt: string | null;
  blueprintVersionId: string | null;
  partialReasons: string[];
  usage: ProviderUsageSummary;
}

export interface ProviderUsageEntry {
  id: string;
  runId: string;
  stage: BlueprintStage;
  provider: 'dataforseo' | 'openrouter';
  operation: string;
  endpointOrModel: string;
  providerRequestId: string | null;
  providerTaskIds: string[];
  providerGenerationId: string | null;
  cacheStatus: 'hit' | 'miss' | 'bypass';
  requestCount: number;
  returnedItemCount: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  cachedTokens: number | null;
  finishReason: string | null;
  costUsd: string;
  latencyMs: number;
  createdAt: string;
}

export interface ProviderUsageSummary {
  dataForSeoCostUsd: string;
  openRouterCostUsd: string;
  totalCostUsd: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  requestCount: number;
}

export interface ProjectView {
  id: string;
  name: string;
  mode: ProjectMode;
  brief: NormalizedProjectBrief;
  createdAt: string;
  updatedAt: string;
  latestRunId: string | null;
  latestBlueprintVersionId: string | null;
  latestBlueprintRevisionId: string | null;
  version: number;
}

export interface ResearchEstimateInput {
  fanoutEnabled?: boolean;
  maxCompetitors?: number;
  maxPages?: number;
  refreshPolicy?: 'use_cache' | 'refresh_stale' | 'force_refresh';
}

export interface ResearchEstimate {
  estimateId: string;
  expiresAt: string;
  plannedStages: Array<{
    stage: BlueprintStage;
    required: boolean;
    estimatedTasks: number;
    estimatedMinUsd: string;
    estimatedMaxUsd: string;
    cacheEligible: boolean;
  }>;
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

export interface StartResearchRunInput {
  estimateId: string;
  acceptedDataForSeoCeilingUsd: string;
  acceptedOpenRouterCeilingUsd: string;
}

export interface RetryRunInput {
  fromStage?: BlueprintStage;
  failedOnly?: boolean;
}

export type ResearchRunEvent =
  | { type: 'run.updated'; run: ResearchRunView }
  | { type: 'stage.updated'; stage: ResearchStageView }
  | { type: 'blueprint.published'; blueprintVersionId: string }
  | { type: 'heartbeat'; at: string };
