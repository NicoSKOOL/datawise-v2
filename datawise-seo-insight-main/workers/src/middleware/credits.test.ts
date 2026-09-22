import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { checkAndDeductCredit, refundCredit, shouldRefundCredit } from './credits';

// Free credits: 5 per user, deducted before the gated handler runs. The refund
// path gives one back when the handler failed or returned nothing (bugs
// 973ffe0c "out of credits" after empty searches, 626f52f4 Thai keyword ideas).

const dfs = (task: unknown) => ({ version: '0.1', status_code: 20000, tasks: [task] });

describe('shouldRefundCredit', () => {
  it('refunds any non-2xx response', () => {
    expect(shouldRefundCredit(500, { error: 'boom' })).toBe(true);
    expect(shouldRefundCredit(404, null)).toBe(true);
  });

  it('refunds a DataForSEO task that failed or has no result', () => {
    expect(shouldRefundCredit(200, dfs({ status_code: 40501, result: null }))).toBe(true);
    expect(shouldRefundCredit(200, dfs({ status_code: 20000, result: null }))).toBe(true);
    expect(shouldRefundCredit(200, dfs({ status_code: 20000, result: [] }))).toBe(true);
    expect(shouldRefundCredit(200, { tasks: [] })).toBe(true);
  });

  it('refunds a DataForSEO result with zero items (the Thai keyword_ideas case)', () => {
    expect(shouldRefundCredit(200, dfs({ status_code: 20000, result: [{ items_count: 0, items: [] }] }))).toBe(true);
    expect(shouldRefundCredit(200, dfs({ status_code: 20000, result: [{ items: null }] }))).toBe(true);
  });

  it('keeps the credit when DataForSEO returned items', () => {
    expect(shouldRefundCredit(200, dfs({ status_code: 20000, result: [{ items_count: 2, items: [{}, {}] }] }))).toBe(false);
  });

  it('keeps the credit for non-DataForSEO payloads that are not errors', () => {
    expect(shouldRefundCredit(200, { analysis: 'text', keywords: [] })).toBe(false);
    expect(shouldRefundCredit(200, 'plain')).toBe(false);
  });
});

describe('refundCredit', () => {
  it('gives the deducted credit back and never goes below zero', async () => {
    const { d1, raw } = createTestDb();
    raw.prepare("INSERT INTO users (id, email, credits_used) VALUES ('u1', 'u1@example.com', 4)").run();
    const env = { DB: d1 } as any;

    const gate = await checkAndDeductCredit(env, 'u1', 1);
    expect(gate).toMatchObject({ allowed: true, credits_used: 5, unlimited: false });
    expect(raw.prepare("SELECT credits_used FROM users WHERE id = 'u1'").get()).toEqual({ credits_used: 5 });

    await refundCredit(env, 'u1', 1);
    expect(raw.prepare("SELECT credits_used FROM users WHERE id = 'u1'").get()).toEqual({ credits_used: 4 });

    // The 6th attempt is still allowed after a refund of the 5th.
    const again = await checkAndDeductCredit(env, 'u1', 1);
    expect(again.allowed).toBe(true);

    raw.prepare("UPDATE users SET credits_used = 0 WHERE id = 'u1'").run();
    await refundCredit(env, 'u1', 2);
    expect(raw.prepare("SELECT credits_used FROM users WHERE id = 'u1'").get()).toEqual({ credits_used: 0 });
  });
});
