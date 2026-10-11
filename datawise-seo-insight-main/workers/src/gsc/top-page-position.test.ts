import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { handleGSCData, handleGSCQueries } from './sync';

// Regression for 2026-10-01 (harbourholidays.co.uk): even impression-weighted,
// a query's position blended every page that surfaced for it. "padstow
// cottages" read 13.7 while the page searchers actually see,
// /locations/padstow-holiday-cottages/, ranked 3.3, so quick wins and the
// top-3/top-10 buckets were wrong. Query rows now report the top page.

const LOC = 'https://harbourholidays.co.uk/locations/padstow-holiday-cottages/';

function makeEnv() {
  const { d1, raw } = createTestDb();
  const kv = new Map<string, string>();
  raw.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')").run();
  raw.prepare("INSERT INTO gsc_properties (id, user_id, site_url, last_synced_at) VALUES ('p1', 'u1', 'https://harbourholidays.co.uk/', '2026-10-02 10:00:00')").run();
  const insert = raw.prepare(
    'INSERT INTO gsc_search_data (property_id, date, query, page, clicks, impressions, ctr, position, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  // Real 90-day shape from prod D1: top page 3.3, homepage 26.5, two deep pages.
  for (const source of ['agg90', 'pd']) {
    const date = source === 'agg90' ? today : yesterday;
    insert.run('p1', date, 'padstow cottages', LOC, 106, 3022, 0.035, 3.3, source);
    insert.run('p1', date, 'padstow cottages', 'https://harbourholidays.co.uk/', 2, 768, 0.003, 26.5, source);
    insert.run('p1', date, 'padstow cottages', 'https://harbourholidays.co.uk/collection/luxury/', 0, 233, 0, 76.6, source);
    insert.run('p1', date, 'padstow cottages', 'https://harbourholidays.co.uk/collection/dog-friendly/', 1, 209, 0.005, 56.1, source);
  }
  // A single-page query is unaffected by the change
  insert.run('p1', today, 'trevone cottages', 'https://harbourholidays.co.uk/trevone/', 5, 400, 0.0125, 9.1, 'agg90');
  insert.run('p1', yesterday, 'trevone cottages', 'https://harbourholidays.co.uk/trevone/', 5, 400, 0.0125, 9.1, 'pd');
  const env = {
    DB: d1,
    KV: { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } },
  } as any;
  return { env };
}

const req = (path: string) => new Request(`https://datawise-api${path}`);

describe('query position is the top page position', () => {
  it('/gsc/queries reports the top page, with the blend kept as context', async () => {
    const { env } = makeEnv();
    const body = await (await handleGSCQueries(req('/gsc/queries?property_id=p1&filter=all'), env, 'u1')).json() as any;
    const row = body.rows.find((r: any) => r.query === 'padstow cottages');
    expect(row.avg_position).toBe(3.3);
    expect(row.top_page).toBe(LOC);
    expect(row.ranking_pages).toBe(4);
    // (3.3*3022 + 26.5*768 + 76.6*233 + 56.1*209) / 4232
    expect(row.all_pages_position).toBe(14.2);
    expect(row.impressions).toBe(4232);
    expect(row.clicks).toBe(109);

    const single = body.rows.find((r: any) => r.query === 'trevone cottages');
    expect(single.avg_position).toBe(9.1);
    expect(single.all_pages_position).toBe(9.1);
    expect(single.ranking_pages).toBe(1);
  });

  it('a top-3 page is not a quick win, even though the blend is 14.2', async () => {
    const { env } = makeEnv();
    const body = await (await handleGSCData(req('/gsc/data?property_id=p1&range=30'), env, 'u1')).json() as any;

    // blended 14.2 would have put padstow cottages in striking distance (11-20)
    expect(body.query_summary.top_10).toBe(2);
    expect(body.query_summary.striking_distance).toBe(0);
    expect(body.opportunities.map((o: any) => o.query)).toEqual(['trevone cottages']);
    expect(body.range.opportunities.map((o: any) => o.query)).toEqual(['trevone cottages']);
    expect(body.range.top_10).toBe(2);
    expect(body.top_queries.find((q: any) => q.query === 'padstow cottages').top_page).toBe(LOC);
  });

  it('opportunities filter on /gsc/queries uses the top page too', async () => {
    const { env } = makeEnv();
    const body = await (await handleGSCQueries(req('/gsc/queries?property_id=p1&filter=opportunities'), env, 'u1')).json() as any;
    expect(body.total).toBe(1);
    expect(body.rows.map((r: any) => r.query)).toEqual(['trevone cottages']);
  });
});
