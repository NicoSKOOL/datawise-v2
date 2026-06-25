import { describe, it, expect, vi, beforeEach } from 'vitest';

// refreshGSCToken hits the network / KV; stub it so the sync path runs offline.
vi.mock('./oauth', () => ({
  refreshGSCToken: vi.fn(async () => 'fake-access-token'),
}));

import { handleGSCSync } from './sync';

// Minimal recording fake of the D1 binding. Captures every prepared SQL string
// and counts batch() calls so a test can assert whether a destructive rewrite
// happened.
function makeFakeDB(opts: { lastPdDate: string | null; agg90Stamp: string | null }) {
  const prepared: string[] = [];
  let batchCalls = 0;
  const db: any = {
    prepare(sql: string) {
      prepared.push(sql);
      const stmt: any = {
        sql,
        bind() {
          return stmt;
        },
        async first() {
          if (sql.includes('FROM gsc_properties WHERE id')) {
            return { id: 'p1', site_url: 'sc-domain:example.com' };
          }
          if (sql.includes('last_pd_date')) {
            return { last_pd_date: opts.lastPdDate, agg90_stamp: opts.agg90Stamp };
          }
          return null;
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) {
      batchCalls += 1;
      return stmts.map(() => ({ success: true }));
    },
  };
  return {
    db,
    prepared,
    deletedSomething: () => prepared.some((s) => /DELETE/i.test(s)),
    batchCalls: () => batchCalls,
  };
}

function syncRequest() {
  return new Request('https://datawise-api/gsc/sync', {
    method: 'POST',
    body: JSON.stringify({ property_id: 'p1' }),
  });
}

describe('handleGSCSync empty-response protection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT delete stored data when the GSC daily-totals fetch returns 200 with zero rows', async () => {
    // An already-synced property (has source=pd rows -> incremental path, has data).
    const fake = makeFakeDB({ lastPdDate: '2026-06-22', agg90Stamp: '2026-06-25' });

    // Every Search Analytics call returns 200 OK but an empty rows array, which
    // is exactly what Google does for a day or two after a site is re-verified.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ rows: [] }),
        text: async () => '',
      })),
    );

    const res = await handleGSCSync(syncRequest(), { DB: fake.db } as any, 'user-1');
    const body = (await res.json()) as any;

    // The bug: stored daily-total rows get DELETEd and replaced with nothing,
    // so the dashboard reads "0". The fix must skip the rewrite entirely.
    expect(fake.deletedSomething()).toBe(false);
    expect(fake.batchCalls()).toBe(0);
    expect(body.reason).toBe('empty_daily_totals');
  });

  it('still performs the rewrite when the daily-totals fetch returns rows', async () => {
    const fake = makeFakeDB({ lastPdDate: '2026-06-22', agg90Stamp: '2026-06-25' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          rows: [{ keys: ['2026-06-23'], clicks: 5, impressions: 100, ctr: 0.05, position: 4.2 }],
        }),
        text: async () => '',
      })),
    );

    const res = await handleGSCSync(syncRequest(), { DB: fake.db } as any, 'user-1');
    const body = (await res.json()) as any;

    expect(body.success).toBe(true);
    expect(fake.deletedSomething()).toBe(true);
    expect(fake.batchCalls()).toBeGreaterThan(0);
  });
});
