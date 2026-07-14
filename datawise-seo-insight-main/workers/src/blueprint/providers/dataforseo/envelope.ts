import { DataForSeoQuotaError } from '../../../dataforseo/client';
import { BlueprintApiError } from '../../domain/api-errors';
import type { BlueprintErrorCode } from '../../contracts/enums';

// DataForSEO's HTTP layer returns 200 for almost everything; the real
// success/failure signal lives per-task inside the body as status_code.
// Every code in the 20000-29999 band is a DataForSEO SUCCESS code (20000
// "Ok." for synchronous "live" calls, 20100 "Task Created." for async
// task_post acceptance, etc.) -- 40xxx/50xxx are the failure bands. The
// existing (non-blueprint) dataforseo/on-page.ts task_post/poll flow already
// treats `status_code < 20000 || status_code >= 30000` as the real
// success/failure boundary; this range check matches that established,
// production-proven convention rather than the narrower `=== 20000` this
// function used before Task 13 (SERP task_post/task_get is the first
// blueprint adapter that posts an async task and therefore the first to see
// a genuine non-20000 success code -- 20100 -- flow through this parser).
// Partial per-task failures alongside otherwise-successful tasks in the same
// response must still be surfaced without throwing away the tasks that did
// work.
export interface DfsTaskMeta {
  taskId: string | null;
  statusCode: number;
  statusMessage: string;
  costUsd: number;
  resultCount: number;
}

export function isSuccessfulDataForSeoTask(task: any): boolean {
  return !!task && typeof task.status_code === 'number' && task.status_code >= 20000 && task.status_code < 30000;
}

export interface ParsedDfsResponse {
  items: any[];
  results: any[];
  tasks: DfsTaskMeta[];
  failedTasks: DfsTaskMeta[];
  totalCostUsd: number;
}

export function parseDfsResponse(response: any): ParsedDfsResponse {
  const rawTasks: any[] = Array.isArray(response?.tasks) ? response.tasks : [];
  const meta = (t: any): DfsTaskMeta => ({
    taskId: typeof t?.id === 'string' ? t.id : null,
    statusCode: typeof t?.status_code === 'number' ? t.status_code : 0,
    statusMessage: typeof t?.status_message === 'string' ? t.status_message : '',
    costUsd: typeof t?.cost === 'number' ? t.cost : 0,
    resultCount: Array.isArray(t?.result) ? t.result.length : 0,
  });
  const successful = rawTasks.filter(isSuccessfulDataForSeoTask);
  const results = successful.flatMap((t) => t.result ?? []);
  const items = results.flatMap((r: any) => r?.items ?? []);
  return {
    items,
    results,
    tasks: rawTasks.map(meta),
    failedTasks: rawTasks.filter((t) => !isSuccessfulDataForSeoTask(t)).map(meta),
    totalCostUsd: rawTasks.reduce((s, t) => s + (typeof t?.cost === 'number' ? t.cost : 0), 0),
  };
}

// Fixed taxonomy of user-facing messages. Never interpolate provider text
// (raw DFS bodies can contain account emails, internal URLs, etc.) into
// these: that is the whole point of routing every stage failure through
// this function instead of `err.message`.
const SAFE_MESSAGES: Record<string, string> = {
  provider_quota_exhausted: 'The research provider daily quota is exhausted. The run will resume when quota is available.',
  provider_rate_limited: 'The research provider rate-limited this request. It will be retried automatically.',
  provider_timeout: 'The research provider timed out. It will be retried automatically.',
  provider_invalid_response: 'The research provider returned an unexpected response.',
  budget_exceeded: 'This run reached its approved research budget ceiling.',
};

export function safeErrorMessage(code: BlueprintErrorCode): string {
  return SAFE_MESSAGES[code] ?? 'The research step failed.';
}

export function mapDfsFailure(input: unknown): BlueprintApiError {
  if (input instanceof DataForSeoQuotaError) {
    return new BlueprintApiError('provider_quota_exhausted', safeErrorMessage('provider_quota_exhausted'));
  }
  const msg = input instanceof Error ? input.message : String(input);
  if (/abort|timed? ?out/i.test(msg)) {
    return new BlueprintApiError('provider_timeout', safeErrorMessage('provider_timeout'));
  }
  if (/rate.?limit|too many (requests|simultaneous)|40202/i.test(msg)) {
    return new BlueprintApiError('provider_rate_limited', safeErrorMessage('provider_rate_limited'));
  }
  return new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
}
