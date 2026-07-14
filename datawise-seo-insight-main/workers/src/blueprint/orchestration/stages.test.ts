import { describe, it, expect } from 'vitest';
import { stageMeta } from './stages';

describe('stageMeta', () => {
  it('gives validate_serps_and_questions a 12-attempt / 30s-backoff override', () => {
    const meta = stageMeta('validate_serps_and_questions');
    expect(meta.maxAttempts).toBe(12);
    expect(meta.retryBackoffMs).toBe(30_000);
    expect(meta.required).toBe(false);
  });

  it('leaves every other stage without a per-stage override (generic MAX_ATTEMPTS/RETRY_BACKOFF_MS apply)', () => {
    expect(stageMeta('resolve_market').maxAttempts).toBeUndefined();
    expect(stageMeta('resolve_market').retryBackoffMs).toBeUndefined();
    expect(stageMeta('collect_keyword_evidence').maxAttempts).toBeUndefined();
    expect(stageMeta('publish_blueprint').maxAttempts).toBeUndefined();
  });

  it('throws for an unknown stage', () => {
    expect(() => stageMeta('not_a_real_stage' as any)).toThrow();
  });
});
