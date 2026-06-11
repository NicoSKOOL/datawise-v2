import { describe, it, expect } from 'vitest';
import { getTaskError, isCacheableDfsResponse } from './client';

const okResponse = {
  status_code: 20000,
  tasks_error: 0,
  tasks: [
    {
      status_code: 20000,
      status_message: 'Ok.',
      result: [{ total: {}, items: [{ key: 'coldiq' }] }],
    },
  ],
};

// DFS returns HTTP 200 with the failure inside the task (e.g. 40501 invalid
// domain). This shape was found cached in production KV on 2026-06-11.
const taskErrorResponse = {
  status_code: 20000,
  tasks_error: 1,
  tasks: [
    {
      status_code: 40501,
      status_message: "Invalid Field: ''domain' must be a valid domain.'.",
      result: null,
    },
  ],
};

const emptyTasksResponse = { status_code: 20000, tasks: [] };

describe('getTaskError', () => {
  it('returns null for a successful task', () => {
    expect(getTaskError(okResponse)).toBeNull();
  });

  it('returns the status message for a failed task', () => {
    expect(getTaskError(taskErrorResponse)).toContain('Invalid Field');
  });

  it('returns a generic message when tasks are missing', () => {
    expect(getTaskError(emptyTasksResponse)).toBe('DataForSEO returned no task');
    expect(getTaskError(null)).toBe('DataForSEO returned no task');
  });
});

describe('isCacheableDfsResponse', () => {
  it('caches successful task responses', () => {
    expect(isCacheableDfsResponse(okResponse)).toBe(true);
  });

  it('does not cache task-level failures', () => {
    expect(isCacheableDfsResponse(taskErrorResponse)).toBe(false);
  });

  it('does not cache responses with no tasks', () => {
    expect(isCacheableDfsResponse(emptyTasksResponse)).toBe(false);
    expect(isCacheableDfsResponse(null)).toBe(false);
  });
});
