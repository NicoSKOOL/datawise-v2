import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../test-support/d1';
import { handleGSCData, handleGSCQueries } from './sync';
import { buildGSCContextDebug } from '../chat/handler';

// Regression for the 2026-09-16 report: a brand query ranking #1 on the home
// page (thousands of impressions) that also surfaces dozens of deep pages at
// position 20-60 (a handful of impressions each) showed position 20.1 in
// DataWise while Search Console showed 1.9. Every position and CTR aggregate
// over gsc_search_data must be impression-weighted, like Search Console's own.

function makeEnv() {
  const { d1, raw } = createTestDb();
  const kv = new Map<string, string>();
  raw.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')").run();
  raw.prepare("INSERT INTO gsc_properties (id, user_id, site_url, last_synced_at) VALUES ('p1', 'u1', 'https://harbourholidays.co.uk/', '2026-09-16 14:49:13')").run();
  const insert = raw.prepare(
    'INSERT INTO gsc_search_data (property_id, date, query, page, clicks, impressions, ctr, position, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  // "harbour holidays": home page #1 with 7000 impressions, five deep pages at
  // position 60 with 1 impression each. Plain AVG = 50.2, weighted = 1.04.
  insert.run('p1', today, 'harbour holidays', 'https://harbourholidays.co.uk/', 2900, 7000, 2900 / 7000, 1, 'agg90');
  for (let i = 0; i < 5; i++) {
    insert.run('p1', today, 'harbour holidays', `https://harbourholidays.co.uk/deep/${i}/`, 0, 1, 0, 60, 'agg90');
  }
  // A second query that is a genuine striking-distance opportunity only when
  // weighted: 12 at 500 impressions, 2 at 1 impression -> weighted 12.0,
  // plain AVG 7.0 (which would wrongly drop it from the 11-20 band).
  insert.run('p1', today, 'padstow cottages', 'https://harbourholidays.co.uk/locations/padstow/', 20, 500, 0.04, 12, 'agg90');
  insert.run('p1', today, 'padstow cottages', 'https://harbourholidays.co.uk/', 0, 1, 0, 2, 'agg90');
  // Daily totals: a high-impression day at position 2 and a near-empty day at
  // position 40. Weighted 2.04, plain AVG 21.
  insert.run('p1', daysAgo(1), '__daily_total__', null, 500, 10_000, 0.05, 2, 'gsc');
  insert.run('p1', daysAgo(2), '__daily_total__', null, 0, 10, 0, 40, 'gsc');
  // Per-day rows so the range block has data (same shape as agg90).
  insert.run('p1', daysAgo(1), 'harbour holidays', 'https://harbourholidays.co.uk/', 100, 1000, 0.1, 1, 'pd');
  insert.run('p1', daysAgo(1), 'harbour holidays', 'https://harbourholidays.co.uk/deep/0/', 0, 1, 0, 60, 'pd');

  const env = {
    DB: d1,
    KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } },
  } as any;
  return { env, raw };
}

const req = (path: string) => new Request(`https://datawise-api${path}`);

describe('GSC position aggregates are impression-weighted', () => {
  it('/gsc/queries reports the Search Console position, not a per-page mean', async () => {
    const { env } = makeEnv();
    const res = await handleGSCQueries(req('/gsc/queries?property_id=p1&filter=all'), env, 'u1');
    const body = await res.json() as any;
    const brand = body.rows.find((r: any) => r.query === 'harbour holidays');
    expect(brand.avg_position).toBe(1);
    expect(brand.impressions).toBe(7005);
    // CTR is clicks / impressions over the group, not a mean of per-row CTRs.
    expect(brand.avg_ctr).toBeCloseTo(2900 / 7005, 4);
  });

  it('/gsc/queries?filter=opportunities keeps a weighted striking-distance query', async () => {
    const { env } = makeEnv();
    const res = await handleGSCQueries(req('/gsc/queries?property_id=p1&filter=opportunities'), env, 'u1');
    const body = await res.json() as any;
    expect(body.rows.map((r: any) => r.query)).toEqual(['padstow cottages']);
    expect(body.rows[0].avg_position).toBe(12);
  });

  it('/gsc/data summaries, query rollup, top queries and top pages are weighted', async () => {
    const { env } = makeEnv();
    const res = await handleGSCData(req('/gsc/data?property_id=p1&range=7'), env, 'u1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Period summaries over daily totals weight each day by its impressions.
    expect(body.summary.last_90_days.avg_position).toBe(2);
    expect(body.range.avg_position).toBe(2);

    const brand = body.top_queries.find((r: any) => r.query === 'harbour holidays');
    expect(brand.avg_position).toBe(1);
    const home = body.top_pages.find((r: any) => r.page === 'https://harbourholidays.co.uk/');
    expect(home.avg_position).toBeCloseTo((1 * 7000 + 2 * 1) / 7001, 1);

    // Rollup: both queries counted; site-wide position weighted by impressions
    // (7005 at 1.0, 501 at 12.0 -> 1.7), brand query in top 3, opportunity in 11-20.
    expect(body.query_summary.total_queries).toBe(2);
    expect(body.query_summary.avg_position).toBe(1.7);
    expect(body.query_summary.top_3).toBe(1);
    expect(body.query_summary.striking_distance).toBe(1);
    expect(body.opportunities.map((r: any) => r.query)).toEqual(['padstow cottages']);
  });

  it('SEO Assistant context shows the weighted position too', async () => {
    const { env } = makeEnv();
    const ctx = await buildGSCContextDebug(env, 'u1', 'p1');
    expect(ctx).toContain('| Last 90 days | 500 | 10010 | 2 |');
    // Top-queries table row for the brand query: position 1, not 50.2.
    expect(ctx).toMatch(/harbour holidays \| 3000 \| 8006 \| 37\.5% \| 1 \|/);
  });

  it('no unweighted AVG(position) or AVG(ctr) remains over gsc_search_data', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const rel of ['sync.ts', '../chat/handler.ts']) {
      const src = readFileSync(join(here, rel), 'utf8');
      expect(src, rel).not.toMatch(/AVG\((?:\w+\.)?position\)/);
      expect(src, rel).not.toMatch(/AVG\((?:\w+\.)?ctr\)/);
    }
  });
});
