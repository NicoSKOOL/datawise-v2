import { describe, it, expect } from 'vitest';
import { BlueprintApiError, NotFoundError, httpStatusFor } from './api-errors';
import type { BlueprintErrorCode } from '../contracts/enums';

describe('httpStatusFor', () => {
  it('maps every BlueprintErrorCode to the §18 table status', () => {
    const table: Record<BlueprintErrorCode, number> = {
      invalid_input: 400,
      unsupported_market: 422,
      provider_auth_failed: 503,
      provider_quota_exhausted: 503,
      provider_rate_limited: 429,
      provider_unavailable: 503,
      provider_timeout: 504,
      provider_invalid_response: 502,
      budget_exceeded: 409,
      ai_schema_invalid: 502,
      ai_evidence_reference_invalid: 502,
      site_fetch_blocked: 200,
      site_fetch_unsafe: 422,
      stage_conflict: 409,
      run_cancelled: 409,
      internal_error: 500,
    };
    for (const [code, status] of Object.entries(table)) {
      expect(httpStatusFor(code as BlueprintErrorCode)).toBe(status);
    }
  });
});

describe('BlueprintApiError', () => {
  it('carries code, message, and optional retry/field/stage metadata', () => {
    const err = new BlueprintApiError('budget_exceeded', 'over ceiling', {
      retryable: false,
      fieldErrors: { acceptedDataForSeoCeilingUsd: ['too low'] },
      stage: 'plan_research',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('budget_exceeded');
    expect(err.message).toBe('over ceiling');
    expect(err.options?.retryable).toBe(false);
    expect(err.options?.fieldErrors).toEqual({ acceptedDataForSeoCeilingUsd: ['too low'] });
    expect(err.options?.stage).toBe('plan_research');
  });

  it('works with no options supplied', () => {
    const err = new BlueprintApiError('internal_error', 'boom');
    expect(err.options).toBeUndefined();
  });
});

describe('NotFoundError', () => {
  it('is a plain Error subclass usable for invisible-404 semantics', () => {
    const err = new NotFoundError('project not found');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('project not found');
  });
});
