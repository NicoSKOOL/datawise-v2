import type { BlueprintErrorCode, BlueprintStage } from '../contracts/enums';

export interface BlueprintApiErrorOptions {
  retryable?: boolean;
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string[]>;
  stage?: BlueprintStage;
}

export class BlueprintApiError extends Error {
  constructor(
    public code: BlueprintErrorCode,
    message: string,
    public options?: BlueprintApiErrorOptions
  ) {
    super(message);
    this.name = 'BlueprintApiError';
  }
}

// Account-wide (as opposed to one-call) DataForSEO conditions: a per-run budget
// ceiling, an exhausted provider quota, or a rate-limit wall. Whichever call
// hits one of these first, every other paid call the run would make this attempt
// is guaranteed to hit the same wall, so these must NOT be swallowed by a
// per-call/per-stage try-catch: they are rethrown so the stage lands in
// retry_wait/fail with the true code rather than quietly reporting 'partial'.
// Shared by collect_competitor_evidence (per-competitor loop) and
// overlay_existing_site (labs fallback) so both classify identically.
export function isAccountWideProviderError(err: unknown): boolean {
  return (
    err instanceof BlueprintApiError &&
    (err.code === 'provider_quota_exhausted' ||
      err.code === 'provider_rate_limited' ||
      err.code === 'budget_exceeded')
  );
}

// Thrown by the actor/access layer for missing, cross-tenant, or soft-deleted
// resources. Always maps to a 404 so we never leak existence of another
// organization's data (invisible-404 rule).
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// §18 error -> HTTP mapping, verbatim from phase2-research.md.
export function httpStatusFor(code: BlueprintErrorCode): number {
  switch (code) {
    case 'invalid_input':
      return 400;
    case 'unsupported_market':
      return 422;
    case 'provider_auth_failed':
      return 503;
    case 'provider_quota_exhausted':
      return 503;
    // Table lists 429/503; 429 (rate limited, retry-after) is the more
    // specific and actionable status for this code.
    case 'provider_rate_limited':
      return 429;
    case 'provider_unavailable':
      return 503;
    case 'provider_timeout':
      return 504;
    case 'provider_invalid_response':
      return 502;
    case 'budget_exceeded':
      return 409;
    case 'ai_schema_invalid':
      return 502;
    case 'ai_evidence_reference_invalid':
      return 502;
    // Table lists 200/partial: fallback succeeded with a declared warning,
    // not a hard failure, so the response ships as 200 with a warning.
    case 'site_fetch_blocked':
      return 200;
    case 'site_fetch_unsafe':
      return 422;
    case 'stage_conflict':
      return 409;
    case 'run_cancelled':
      return 409;
    case 'internal_error':
      return 500;
    default: {
      const exhaustive: never = code;
      throw new Error(`Unmapped BlueprintErrorCode: ${exhaustive}`);
    }
  }
}
