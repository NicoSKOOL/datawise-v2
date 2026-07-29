import { describe, it, expect } from 'vitest';
import { buildHistoricalTask } from './llm-mentions';

describe('buildHistoricalTask', () => {
  it('rejects a missing target', () => {
    expect(buildHistoricalTask({}).error).toBeTruthy();
    expect(buildHistoricalTask({ target: [] }).error).toBeTruthy();
  });

  it('rejects more than 10 targets', () => {
    const target = Array.from({ length: 11 }, () => ({ domain: 'example.com' }));
    expect(buildHistoricalTask({ target }).error).toBeTruthy();
  });

  it('applies US/English defaults and keeps the target', () => {
    const { task, error } = buildHistoricalTask({
      target: [{ domain: 'example.com', include_subdomains: true }],
    });
    expect(error).toBeUndefined();
    expect(task).toMatchObject({
      target: [{ domain: 'example.com', include_subdomains: true }],
      location_code: 2840,
      language_code: 'en',
    });
  });

  it('passes through platform and date range', () => {
    const { task } = buildHistoricalTask({
      target: [{ domain: 'example.com' }],
      platform: 'chat_gpt',
      date_from: '2025-08-01',
      date_to: '2026-07-01',
    });
    expect(task).toMatchObject({
      platform: 'chat_gpt',
      date_from: '2025-08-01',
      date_to: '2026-07-01',
    });
  });

  it('clamps date_from to the 2025-08-01 corpus start', () => {
    const { task } = buildHistoricalTask({
      target: [{ domain: 'example.com' }],
      date_from: '2024-01-01',
    });
    expect(task?.date_from).toBe('2025-08-01');
  });
});
