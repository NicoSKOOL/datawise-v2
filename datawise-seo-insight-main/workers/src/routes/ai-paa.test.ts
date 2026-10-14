import { describe, it, expect, vi, beforeEach } from 'vitest';

// Bug 539b2e15 (Juan): on 2026-10-08 every DataForSEO call in a PAA run failed,
// the handler swallowed each error as "no items", and the member saw
// "Success: found 0 items across 3 searches" while being charged a credit.
const dfs = { calls: [] as string[], impl: null as null | ((keyword: string) => any) };
vi.mock('../dataforseo/client', () => ({
  dataforseoRequest: async (_env: unknown, _path: string, body: any[]) => {
    const keyword = body[0].keyword as string;
    dfs.calls.push(keyword);
    return dfs.impl!(keyword);
  },
}));

import { handlePeopleAlsoAsk } from './ai';
import { shouldRefundCredit } from '../middleware/credits';

const serp = (items: unknown[]) => ({ tasks: [{ status_code: 20000, result: [{ items }] }] });
const paa = (...titles: string[]) => ({ type: 'people_also_ask', items: titles.map((title) => ({ title })) });

async function run(depth = 1) {
  const req = new Request('https://x/api/ai/people-also-ask', {
    method: 'POST',
    body: JSON.stringify({ keyword: 'dog training tips', location: '2840', language: 'en', depth }),
  });
  const res = await handlePeopleAlsoAsk(req, {} as any);
  return { res, body: await res.json() as any };
}

beforeEach(() => {
  dfs.calls = [];
  dfs.impl = null;
});

describe('handlePeopleAlsoAsk failure handling', () => {
  it('returns a 502 (refunded) when every DataForSEO call fails', async () => {
    dfs.impl = () => { throw new Error('DataForSEO API error: 500'); };
    const { res, body } = await run(2);
    expect(res.status).toBe(502);
    expect(body.error).toMatch(/not charged/i);
    expect(shouldRefundCredit(res.status, body)).toBe(true);
  });

  it('treats a non-20000 task status as a failure, not an empty SERP', async () => {
    dfs.impl = () => ({ tasks: [{ status_code: 50000, status_message: 'Internal Error.', result: null }] });
    const { res } = await run(1);
    expect(res.status).toBe(502);
  });

  it('retries a failed call once before giving up', async () => {
    let attempts = 0;
    dfs.impl = () => {
      attempts += 1;
      if (attempts === 1) throw new Error('timed out');
      return serp([paa('What is the 3-3-3 rule?', 'How do I start?')]);
    };
    const { res, body } = await run(1);
    expect(res.status).toBe(200);
    expect(attempts).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(shouldRefundCredit(res.status, body)).toBe(false);
  });

  it('keeps results when only some calls fail', async () => {
    dfs.impl = (keyword) => {
      if (keyword !== 'dog training tips') throw new Error('boom');
      return serp([paa('What is the 3-3-3 rule?')]);
    };
    const { res, body } = await run(2);
    expect(res.status).toBe(200);
    expect(body.data.map((d: any) => d.question)).toContain('What is the 3-3-3 rule?');
    expect(body.failed_calls).toBeGreaterThan(0);
  });

  it('flags a successful run with zero questions so the credit is refunded', async () => {
    dfs.impl = () => serp([{ type: 'organic', title: 'x' }]);
    const { res, body } = await run(1);
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.no_results).toBe(true);
    expect(shouldRefundCredit(res.status, body)).toBe(true);
  });
});
