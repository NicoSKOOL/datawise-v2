import { describe, it, expect } from 'vitest';
import { DataForSeoQuotaError } from '../../../dataforseo/client';
import { BlueprintApiError } from '../../domain/api-errors';
import {
  isSuccessfulDataForSeoTask,
  parseDfsResponse,
  mapDfsFailure,
  safeErrorMessage,
} from './envelope';

describe('isSuccessfulDataForSeoTask', () => {
  it('is true for the whole 20000-29999 success band, false for 40xxx/50xxx and missing tasks', () => {
    expect(isSuccessfulDataForSeoTask({ status_code: 20000 })).toBe(true);
    // 20100 "Task Created." is task_post's real async-acceptance code (Task
    // 13's SERP task_post/task_get flow): this must count as successful or
    // every real task_post batch would look like an all-tasks-failed
    // response and the wrapper would throw instead of returning task ids.
    expect(isSuccessfulDataForSeoTask({ status_code: 20100 })).toBe(true);
    expect(isSuccessfulDataForSeoTask({ status_code: 40501 })).toBe(false);
    expect(isSuccessfulDataForSeoTask({ status_code: 50000 })).toBe(false);
    expect(isSuccessfulDataForSeoTask(null)).toBe(false);
    expect(isSuccessfulDataForSeoTask(undefined)).toBe(false);
  });
});

describe('parseDfsResponse', () => {
  it('parses a missing tasks array as empty results with no throw', () => {
    const parsed = parseDfsResponse({});
    expect(parsed.items).toEqual([]);
    expect(parsed.results).toEqual([]);
    expect(parsed.tasks).toEqual([]);
    expect(parsed.failedTasks).toEqual([]);
    expect(parsed.totalCostUsd).toBe(0);
  });

  it('never throws on null result/items within a task', () => {
    const response = {
      tasks: [
        { id: 't1', status_code: 20000, status_message: 'Ok.', cost: 0.01, result: null },
        { id: 't2', status_code: 20000, status_message: 'Ok.', cost: 0.02, result: [{ items: null }] },
      ],
    };
    expect(() => parseDfsResponse(response)).not.toThrow();
    const parsed = parseDfsResponse(response);
    expect(parsed.items).toEqual([]);
    expect(parsed.results).toEqual([{ items: null }]);
  });

  it('puts an HTTP-200-with-failed-task into failedTasks and still sums its cost', () => {
    const response = {
      tasks: [
        { id: 't1', status_code: 20000, status_message: 'Ok.', cost: 0.01, result: [{ items: [{ a: 1 }] }] },
        { id: 't2', status_code: 40501, status_message: 'Invalid Field.', cost: 0.005, result: null },
      ],
    };
    const parsed = parseDfsResponse(response);
    expect(parsed.items).toEqual([{ a: 1 }]);
    expect(parsed.failedTasks).toHaveLength(1);
    expect(parsed.failedTasks[0]).toEqual({
      taskId: 't2',
      statusCode: 40501,
      statusMessage: 'Invalid Field.',
      costUsd: 0.005,
      resultCount: 0,
    });
    expect(parsed.totalCostUsd).toBeCloseTo(0.015);
  });
});

describe('mapDfsFailure', () => {
  it('maps DataForSeoQuotaError to provider_quota_exhausted', () => {
    const mapped = mapDfsFailure(new DataForSeoQuotaError('daily limit reached for user x@y.com'));
    expect(mapped).toBeInstanceOf(BlueprintApiError);
    expect(mapped.code).toBe('provider_quota_exhausted');
    expect(mapped.message).toBe(safeErrorMessage('provider_quota_exhausted'));
  });

  it('maps a "too many requests" message to provider_rate_limited', () => {
    const mapped = mapDfsFailure(new Error('too many requests, slow down'));
    expect(mapped.code).toBe('provider_rate_limited');
  });

  it('maps DFS status_code 40202 to provider_rate_limited', () => {
    const mapped = mapDfsFailure(new Error('Task failed: 40202 Too Many Simultaneous Requests.'));
    expect(mapped.code).toBe('provider_rate_limited');
  });

  it('maps an AbortError/timeout to provider_timeout', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    expect(mapDfsFailure(abortErr).code).toBe('provider_timeout');
    expect(mapDfsFailure(new Error('request timed out')).code).toBe('provider_timeout');
  });

  it('maps anything else to provider_invalid_response', () => {
    expect(mapDfsFailure(new Error('unexpected shape')).code).toBe('provider_invalid_response');
    expect(mapDfsFailure('a plain string').code).toBe('provider_invalid_response');
  });

  it('never leaks the raw provider message onto the BlueprintApiError', () => {
    const mapped = mapDfsFailure(new DataForSeoQuotaError('quota for account ops@client.com exhausted'));
    expect(mapped.message).not.toContain('ops@client.com');
  });
});

describe('safeErrorMessage', () => {
  it('returns a fixed string per code with no interpolation', () => {
    const msg = safeErrorMessage('provider_rate_limited');
    expect(msg).toBe(
      'The research provider rate-limited this request. It will be retried automatically.'
    );
    expect(msg).not.toMatch(/\$\{|%s|%d/);
  });

  it('returns a fallback string for a code with no dedicated message', () => {
    expect(safeErrorMessage('invalid_input')).toBe('The research step failed.');
  });
});
