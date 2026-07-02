import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./oauth', () => ({
  refreshGSCToken: vi.fn(async () => 'fake-access-token'),
}));

import { purgeDormantGSCData, resyncPurgedProperties, GSC_PURGE_CHUNK } from './sync';

// Recording fake of the D1 binding, in the style of sync.test.ts. Candidate
// properties are returned from the selection query; DELETE chunks report a
// configurable per-property row count so the chunk loop terminates.
function makeFakeDB(opts: { candidates: string[]; rowsPerProperty: number }) {
  const prepared: string[] = [];
  const bound: unknown[][] = [];
  const remaining = new Map(opts.candidates.map((id) => [id, opts.rowsPerProperty]));
  const db: any = {
    prepare(sql: string) {
      prepared.push(sql);
      const stmt: any = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt.args = args;
          bound.push(args);
          return stmt;
        },
        async all() {
          if (sql.includes('FROM gsc_properties p')) {
            return { results: opts.candidates.map((id) => ({ id })) };
          }
          if (sql.includes('purged_at IS NOT NULL')) {
            return { results: opts.candidates.map((id) => ({ id })) };
          }
          return { results: [] };
        },
        async run() {
          if (/^\s*DELETE FROM gsc_search_data/.test(sql)) {
            const propId = stmt.args[0] as string;
            const left = remaining.get(propId) ?? 0;
            const deleted = Math.min(left, GSC_PURGE_CHUNK);
            remaining.set(propId, left - deleted);
            return { meta: { changes: deleted } };
          }
          return { meta: { changes: 1 } };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  };
  return { db, prepared, bound, remaining };
}

describe('purgeDormantGSCData', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('selects only dormant, unpurged, previously-synced gsc properties', async () => {
    const fake = makeFakeDB({ candidates: [], rowsPerProperty: 0 });
    await purgeDormantGSCData({ DB: fake.db } as any);
    const selection = fake.prepared.find((s) => s.includes('FROM gsc_properties p'));
    expect(selection).toBeTruthy();
    expect(selection).toContain("p.kind = 'gsc'");
    expect(selection).toContain('p.purged_at IS NULL');
    expect(selection).toContain('p.last_synced_at IS NOT NULL');
    expect(selection).toContain('NOT EXISTS');
    expect(selection).toContain('FROM sessions s');
  });

  it('chunk-deletes rows then stamps purged_at and clears last_synced_at', async () => {
    // 25k rows -> 3 chunks (10k, 10k, 5k), then the property is marked purged.
    const fake = makeFakeDB({ candidates: ['prop-1'], rowsPerProperty: 25000 });
    const result = await purgeDormantGSCData({ DB: fake.db } as any);

    expect(result.properties).toBe(1);
    expect(result.rows).toBe(25000);
    expect(fake.remaining.get('prop-1')).toBe(0);

    const deletes = fake.prepared.filter((s) => /^\s*DELETE FROM gsc_search_data/.test(s));
    expect(deletes.length).toBe(3);

    const update = fake.prepared.find((s) => s.includes('SET purged_at'));
    expect(update).toBeTruthy();
    expect(update).toContain('last_synced_at = NULL');
  });

  it('never touches property rows themselves, only gsc_search_data and the marker', async () => {
    const fake = makeFakeDB({ candidates: ['prop-1'], rowsPerProperty: 100 });
    await purgeDormantGSCData({ DB: fake.db } as any);
    const destructive = fake.prepared.filter((s) => /DELETE FROM (?!gsc_search_data)/.test(s));
    expect(destructive).toEqual([]);
  });
});

describe('resyncPurgedProperties', () => {
  it('does nothing when the KV stampede lock is held', async () => {
    const fake = makeFakeDB({ candidates: ['prop-1'], rowsPerProperty: 0 });
    const kv: any = { get: vi.fn(async () => '1'), put: vi.fn() };
    await resyncPurgedProperties({ DB: fake.db, KV: kv } as any, 'user-1');
    expect(kv.put).not.toHaveBeenCalled();
    expect(fake.prepared).toEqual([]);
  });

  it('acquires the lock and queries only purged, enabled gsc properties', async () => {
    // No candidates so no sync fires; assert on the selection SQL + lock write.
    const fake = makeFakeDB({ candidates: [], rowsPerProperty: 0 });
    const kv: any = { get: vi.fn(async () => null), put: vi.fn(async () => undefined) };
    await resyncPurgedProperties({ DB: fake.db, KV: kv } as any, 'user-1');
    expect(kv.put).toHaveBeenCalledWith('gsc_resync_purged:user-1', '1', { expirationTtl: 300 });
    const selection = fake.prepared.find((s) => s.includes('purged_at IS NOT NULL'));
    expect(selection).toBeTruthy();
    expect(selection).toContain("kind = 'gsc'");
    expect(selection).toContain('is_enabled = 1');
  });
});
