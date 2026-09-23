import { describe, it, expect, vi } from 'vitest';

vi.mock('./oauth', () => ({
  refreshGSCToken: vi.fn(async () => 'fake-access-token'),
}));

import {
  runGSCSyncSlice,
  GSC_NIGHTLY_CONCURRENCY,
  GSC_SYNC_BREAKER_THRESHOLD,
  GSC_SLICE_LIMIT,
  GSC_ATTEMPT_COOLDOWN,
} from './sync-runner';

interface DueRow { id: string; user_id: string; last_synced_at?: string | null; user_has_synced?: number }

function makeEnvWithDue(rows: DueRow[]) {
  const calls = {
    selectSql: '',
    selectBinds: [] as unknown[],
    batches: [] as Array<Array<{ sql: string; binds: unknown[] }>>,
  };
  const db: any = {
    prepare(sql: string) {
      const stmt: any = {
        sql,
        binds: [] as unknown[],
        bind(...args: unknown[]) { stmt.binds = args; return stmt; },
        async all() {
          calls.selectSql = sql;
          calls.selectBinds = stmt.binds;
          return {
            results: rows.map((r) => ({
              last_synced_at: null,
              user_has_synced: 0,
              ...r,
            })),
          };
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ sql: string; binds: unknown[] }>) {
      calls.batches.push(stmts.map((s) => ({ sql: s.sql, binds: s.binds })));
      return [];
    },
  };
  return { env: { DB: db } as any, calls };
}

const okResponse = () => new Response('{}', { status: 200 });
const unlimited = { limit: 1000 };

describe('runGSCSyncSlice worker pool', () => {
  it('processes every due property when the deadline and limit allow', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, unlimited, async (_e, _u, id) => {
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
    await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, unlimited, async () => {
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
    await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, unlimited, async (_e, _u, id) => {
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
    await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() - 1, unlimited, async (_e, _u, id) => {
      seen.push(id);
      return okResponse();
    });
    expect(seen.length).toBe(0);
  });

  it('counts failures without dying', async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    const result = await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, unlimited, async (_e, _u, id) => {
      seen.push(id);
      if (id === 'p2') throw new Error('boom');
      if (id === 'p3') return new Response('{}', { status: 500 });
      return okResponse();
    });
    expect(seen.length).toBe(6); // rejection and 500 do not stop the pool
    expect(result.failed).toBe(2);
    expect(result.synced).toBe(4);
  });

  it('trips the breaker after consecutive failures and stops dispatching new work', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    const result = await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, unlimited, async (_e, _u, id) => {
      seen.push(id);
      return new Response('{}', { status: 500 });
    });
    // The pool stops after roughly GSC_SYNC_BREAKER_THRESHOLD + concurrency
    // attempts: the in-flight lanes that already claimed work before the
    // breaker tripped are allowed to finish, but no lane claims new work.
    expect(seen.length).toBeGreaterThanOrEqual(GSC_SYNC_BREAKER_THRESHOLD);
    expect(seen.length).toBeLessThanOrEqual(GSC_SYNC_BREAKER_THRESHOLD + GSC_NIGHTLY_CONCURRENCY);
    expect(seen.length).toBeLessThan(40);
    expect(result.breaker_tripped).toBe(true);
  });

  it('does not trip when failures are not consecutive', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    let callCount = 0;
    await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, unlimited, async (_e, _u, id) => {
      seen.push(id);
      const n = callCount++;
      if (n < 4) return new Response('{}', { status: 500 });
      return okResponse();
    });
    expect(seen.length).toBe(40); // 4 failures reset by a success never reach the threshold
  });
});

describe('runGSCSyncSlice slicing', () => {
  it('attempts at most `limit` properties however many are due', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    const result = await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, { limit: 10 }, async (_e, _u, id) => {
      seen.push(id);
      return okResponse();
    });
    expect(seen.length).toBe(10);
    expect(result.processed).toBe(10);
    // The rest of the backlog is still reported, so a starved queue is visible.
    expect(result.eligible).toBe(200);
  });

  it('defaults to GSC_SLICE_LIMIT', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const seen: string[] = [];
    await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, {}, async (_e, _u, id) => {
      seen.push(id);
      return okResponse();
    });
    expect(seen.length).toBe(GSC_SLICE_LIMIT);
  });

  it('keeps the ordering policy: onboarding before refresh, inside the slice', async () => {
    // Two refresh rows (already synced) ahead of two onboarding rows in the
    // raw result set; the slice must still take the onboarding ones first.
    const rows: DueRow[] = [
      { id: 'stale1', user_id: 'u1', last_synced_at: '2026-09-01 00:00:00', user_has_synced: 1 },
      { id: 'stale2', user_id: 'u1', last_synced_at: '2026-09-02 00:00:00', user_has_synced: 1 },
      { id: 'new1', user_id: 'u2', last_synced_at: null, user_has_synced: 0 },
      { id: 'new2', user_id: 'u3', last_synced_at: null, user_has_synced: 0 },
    ];
    const seen: string[] = [];
    await runGSCSyncSlice(makeEnvWithDue(rows).env, Date.now() + 60_000, { limit: 2, concurrency: 1 }, async (_e, _u, id) => {
      seen.push(id);
      return okResponse();
    });
    expect(seen).toEqual(['new1', 'new2']);
  });
});

describe('runGSCSyncSlice attempt bookkeeping', () => {
  it('stamps last_attempt_at for the slice, in one batch, before syncing', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, user_id: `u${i}` }));
    const { env, calls } = makeEnvWithDue(rows);
    let batchesWhenFirstSyncRan = -1;
    await runGSCSyncSlice(env, Date.now() + 60_000, { limit: 3 }, async () => {
      if (batchesWhenFirstSyncRan < 0) batchesWhenFirstSyncRan = calls.batches.length;
      return okResponse();
    });
    // One batch, holding exactly the sliced properties, already written by the
    // time the first sync runs.
    expect(calls.batches.length).toBe(1);
    expect(batchesWhenFirstSyncRan).toBe(1);
    const batch = calls.batches[0];
    expect(batch.length).toBe(3);
    expect(batch.every((s) => /UPDATE gsc_properties SET last_attempt_at/.test(s.sql))).toBe(true);
    expect(batch.map((s) => s.binds[0])).toEqual(['p0', 'p1', 'p2']);
  });

  it('stamps nothing when no property is due', async () => {
    const { env, calls } = makeEnvWithDue([]);
    const result = await runGSCSyncSlice(env, Date.now() + 60_000, {}, async () => okResponse());
    expect(calls.batches.length).toBe(0);
    expect(result.processed).toBe(0);
    expect(result.eligible).toBe(0);
  });

  it('leaves out owners whose refresh token can no longer mint an access token', async () => {
    const { env, calls } = makeEnvWithDue([{ id: 'p0', user_id: 'u0' }]);
    await runGSCSyncSlice(env, Date.now() + 60_000, {}, async () => okResponse());
    // They cannot sync until they reconnect, they are already shown the
    // Reconnect Google banner, and attempting them spends a slot in every
    // slice: 104 of 106 onboarding properties on 2026-09-23.
    expect(calls.selectSql).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM gsc_connections c\s+WHERE c\.user_id = p\.user_id\s+AND c\.refresh_failed_at IS NOT NULL\s*\)/
    );
  });

  it('filters the due set by the attempt cooldown', async () => {
    const { env, calls } = makeEnvWithDue([{ id: 'p0', user_id: 'u0' }]);
    await runGSCSyncSlice(env, Date.now() + 60_000, {}, async () => okResponse());
    expect(calls.selectSql).toMatch(/last_attempt_at IS NULL OR p\.last_attempt_at < datetime\('now', \?\)/);
    expect(calls.selectBinds).toEqual(['-3 days', GSC_ATTEMPT_COOLDOWN]);
  });
});
