import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./oauth', () => ({
  refreshGSCToken: vi.fn(async () => 'fake-access-token'),
}));

import { purgeLongTailGSCData, GSC_PURGE_CHUNK } from './sync';

// Recording fakes in the style of purge.test.ts: DB returns candidate property
// ids; DELETE chunks report configurable per-property matching-row counts.
function makeFakes(opts: { candidates: string[]; rowsPerProperty: number; kv?: Record<string, string> }) {
  const prepared: string[] = [];
  const kvStore: Record<string, string> = { ...(opts.kv || {}) };
  const remaining = new Map(opts.candidates.map((id) => [id, opts.rowsPerProperty]));
  const db: any = {
    prepare(sql: string) {
      prepared.push(sql);
      const stmt: any = {
        sql,
        args: [] as unknown[],
        bind(...args: unknown[]) { stmt.args = args; return stmt; },
        async all() {
          if (sql.includes('FROM gsc_properties')) {
            const cursor = (stmt.args[0] as string) ?? '';
            return { results: opts.candidates.filter((id) => id > cursor).map((id) => ({ id })) };
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
          return { meta: { changes: 0 } };
        },
        async first() { return null; },
      };
      return stmt;
    },
  };
  const kv: any = {
    async get(k: string) { return kvStore[k] ?? null; },
    async put(k: string, v: string) { kvStore[k] = v; },
  };
  return { db, kv, kvStore, prepared, remaining };
}

describe('purgeLongTailGSCData', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('deletes only non-marker zero-signal rows, property by property', async () => {
    const f = makeFakes({ candidates: ['p1'], rowsPerProperty: 25000 });
    const result = await purgeLongTailGSCData({ DB: f.db, KV: f.kv } as any);

    const del = f.prepared.find((s) => /DELETE FROM gsc_search_data/.test(s))!;
    expect(del).toContain('clicks = 0');
    expect(del).toContain('impressions <= 2');
    expect(del).toContain("query != '__daily_total__'");
    expect(del).toContain("page != '__7d_query__'");
    expect(result.rows).toBe(25000);       // 3 chunks: 10k + 10k + 5k
    expect(result.properties).toBe(1);
    expect(f.remaining.get('p1')).toBe(0);
  });

  it('persists the cursor and marks done when the property list is exhausted', async () => {
    const f = makeFakes({ candidates: ['p1', 'p2'], rowsPerProperty: 100 });
    const result = await purgeLongTailGSCData({ DB: f.db, KV: f.kv } as any);
    expect(result.done).toBe(true);
    expect(f.kvStore['gsc-longtail-purge-cursor']).toBe('p2');
    expect(f.kvStore['gsc-longtail-purge-done']).toBe('1');
  });

  it('is a no-op when the done flag is set', async () => {
    const f = makeFakes({ candidates: ['p1'], rowsPerProperty: 100, kv: { 'gsc-longtail-purge-done': '1' } });
    const result = await purgeLongTailGSCData({ DB: f.db, KV: f.kv } as any);
    expect(result).toEqual({ properties: 0, rows: 0, done: true });
    expect(f.prepared.length).toBe(0);
  });

  it('is a no-op when the kill switch is set', async () => {
    const f = makeFakes({ candidates: ['p1'], rowsPerProperty: 100, kv: { 'gsc-longtail-purge-paused': '1' } });
    const result = await purgeLongTailGSCData({ DB: f.db, KV: f.kv } as any);
    expect(result).toEqual({ properties: 0, rows: 0, done: false });
    expect(f.prepared.length).toBe(0);
  });

  it('stops at the chunk budget and resumes from the cursor next run', async () => {
    // 2 properties x 30k rows = 6 chunks total; budget 4 chunks ends mid-p2.
    const f = makeFakes({ candidates: ['p1', 'p2'], rowsPerProperty: 30000 });
    const first = await purgeLongTailGSCData({ DB: f.db, KV: f.kv } as any, { maxChunks: 4 });
    expect(first.done).toBe(false);
    expect(f.kvStore['gsc-longtail-purge-cursor']).toBe('p1'); // p1 drained, p2 in progress
    const second = await purgeLongTailGSCData({ DB: f.db, KV: f.kv } as any, { maxChunks: 4 });
    expect(second.done).toBe(true);
    expect(f.remaining.get('p2')).toBe(0);
  });
});
