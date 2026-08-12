import { describe, it, expect, vi } from 'vitest';

vi.mock('./oauth', () => ({
  refreshGSCToken: vi.fn(async () => 'fake-access-token'),
}));

import { runDailyGSCSync, GSC_NIGHTLY_CONCURRENCY, GSC_SYNC_BREAKER_THRESHOLD } from './sync-runner';

function makeEnvWithDue(rows: Array<{ id: string; user_id: string }>) {
  const db: any = {
    prepare(sql: string) {
      const stmt: any = {
        bind() { return stmt; },
        async all() {
          return {
            results: rows.map((r) => ({ ...r, last_synced_at: null, user_has_synced: 0 })),
          };
        },
      };
      return stmt;
    },
  };
  return { DB: db } as any;
}

const okResponse = () => new Response('{}', { status: 200 });

describe('runDailyGSCSync worker pool', () => {
  it('processes every due property when the deadline allows', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    await runDailyGSCSync(makeEnvWithDue(rows), Date.now() + 60_000, async (_e, _u, id) => {
      seen.push(id);
      return okResponse();
    });
    expect(seen.length).toBe(30);
    expect(new Set(seen).size).toBe(30); // no property synced twice
  });

  it('runs at most GSC_NIGHTLY_CONCURRENCY syncs in flight', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    let inFlight = 0;
    let peak = 0;
    await runDailyGSCSync(makeEnvWithDue(rows), Date.now() + 60_000, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return okResponse();
    });
    expect(peak).toBe(GSC_NIGHTLY_CONCURRENCY);
  });

  it('one slow property does not block the others (no batch barrier)', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const finished: string[] = [];
    await runDailyGSCSync(makeEnvWithDue(rows), Date.now() + 60_000, async (_e, _u, id) => {
      await new Promise((r) => setTimeout(r, id === 'p0' ? 100 : 1));
      finished.push(id);
      return okResponse();
    });
    // With the old batch-of-4 barrier p0 would gate p4..p19; in a pool the
    // fast properties all finish while p0 is still running.
    expect(finished[finished.length - 1]).toBe('p0');
    expect(finished.length).toBe(20);
  });

  it('starts no new sync after the deadline passes', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    await runDailyGSCSync(makeEnvWithDue(rows), Date.now() - 1, async (_e, _u, id) => {
      seen.push(id);
      return okResponse();
    });
    expect(seen.length).toBe(0);
  });

  it('counts failures without dying', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    await runDailyGSCSync(makeEnvWithDue(rows), Date.now() + 60_000, async (_e, _u, id) => {
      seen.push(id);
      if (id === 'p2') throw new Error('boom');
      if (id === 'p3') return new Response('{}', { status: 500 });
      return okResponse();
    });
    expect(seen.length).toBe(6); // rejection and 500 do not stop the pool
  });

  it('trips the breaker after consecutive failures and stops dispatching new work', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    await runDailyGSCSync(makeEnvWithDue(rows), Date.now() + 60_000, async (_e, _u, id) => {
      seen.push(id);
      return new Response('{}', { status: 500 });
    });
    // The pool stops after roughly GSC_SYNC_BREAKER_THRESHOLD + concurrency
    // attempts: the in-flight lanes that already claimed work before the
    // breaker tripped are allowed to finish, but no lane claims new work.
    expect(seen.length).toBeGreaterThanOrEqual(GSC_SYNC_BREAKER_THRESHOLD);
    expect(seen.length).toBeLessThanOrEqual(GSC_SYNC_BREAKER_THRESHOLD + GSC_NIGHTLY_CONCURRENCY);
    expect(seen.length).toBeLessThan(40);
  });

  it('does not trip when failures are not consecutive', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    let callCount = 0;
    await runDailyGSCSync(makeEnvWithDue(rows), Date.now() + 60_000, async (_e, _u, id) => {
      seen.push(id);
      const n = callCount++;
      if (n < 4) return new Response('{}', { status: 500 });
      return okResponse();
    });
    expect(seen.length).toBe(40); // 4 failures reset by a success never reach the threshold
  });
});
