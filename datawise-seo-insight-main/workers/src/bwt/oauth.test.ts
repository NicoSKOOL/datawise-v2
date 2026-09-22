import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { handleBWTDisconnect, syncBWTProperties } from './oauth';
import type { Env } from '../index';

// Bing Phase 1A (2026-09-22): the Bing site sync flipped matching Search
// Console rows to kind='bwt', and Disconnect deleted every kind='bwt' row,
// cascading to the user's Google search data and planner work. These tests
// run against the real schema with foreign keys on.

function setup() {
  const { d1, raw } = createTestDb();
  raw.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')").run();
  raw.prepare(`INSERT INTO bwt_connections (id, user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at)
               VALUES ('c1', 'u1', 'a', 'r', '2099-01-01')`).run();
  const env = { DB: d1 } as unknown as Env;
  const addProperty = (id: string, url: string, kind: string, synced: boolean) =>
    raw.prepare('INSERT INTO gsc_properties (id, user_id, site_url, kind, last_synced_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'u1', url, kind, synced ? '2026-09-01T00:00:00Z' : null);
  const count = (sql: string) => (raw.prepare(sql).get() as { n: number }).n;
  return { env, raw, addProperty, count };
}

afterEach(() => vi.unstubAllGlobals());

describe('handleBWTDisconnect', () => {
  it('keeps a flipped Search Console property and all of its data', async () => {
    const { env, raw, addProperty, count } = setup();
    addProperty('flipped', 'https://example.com/', 'bwt', true);
    raw.prepare("INSERT INTO gsc_search_data (property_id, date, query, clicks, impressions) VALUES ('flipped', '2026-09-01', '__daily_total__', 5, 50)").run();
    raw.prepare("INSERT INTO planner_keywords (id, user_id, property_id, keyword) VALUES ('k1', 'u1', 'flipped', 'plumber')").run();

    await handleBWTDisconnect(env, 'u1');

    expect(count("SELECT COUNT(*) n FROM gsc_properties WHERE id = 'flipped'")).toBe(1);
    expect(count('SELECT COUNT(*) n FROM gsc_search_data')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM planner_keywords')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM bwt_connections')).toBe(0);
  });

  it('keeps a never-synced Bing row the user picked for planner work', async () => {
    const { env, raw, addProperty, count } = setup();
    addProperty('picked', 'https://picked.com/', 'bwt', false);
    raw.prepare("INSERT INTO planner_keywords (id, user_id, property_id, keyword) VALUES ('k2', 'u1', 'picked', 'roofer')").run();

    await handleBWTDisconnect(env, 'u1');

    expect(count("SELECT COUNT(*) n FROM gsc_properties WHERE id = 'picked'")).toBe(1);
    expect(count('SELECT COUNT(*) n FROM planner_keywords')).toBe(1);
  });

  it('removes empty Bing rows and never touches Search Console rows', async () => {
    const { env, addProperty, count } = setup();
    addProperty('empty-bwt', 'https://empty.com/', 'bwt', false);
    addProperty('gsc', 'sc-domain:empty.com', 'gsc', false);

    await handleBWTDisconnect(env, 'u1');

    expect(count("SELECT COUNT(*) n FROM gsc_properties WHERE id = 'empty-bwt'")).toBe(0);
    expect(count("SELECT COUNT(*) n FROM gsc_properties WHERE id = 'gsc'")).toBe(1);
  });
});

describe('syncBWTProperties', () => {
  it('does not flip a Search Console property whose URL matches the Bing site', async () => {
    const { env, raw, addProperty } = setup();
    addProperty('gsc', 'https://example.com/', 'gsc', true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ d: [{ Url: 'https://example.com/' }] }))));

    await syncBWTProperties(env, 'u1', 'token');

    const row = raw.prepare("SELECT kind FROM gsc_properties WHERE id = 'gsc'").get() as { kind: string };
    expect(row.kind).toBe('gsc');
    expect((raw.prepare('SELECT COUNT(*) n FROM gsc_properties').get() as { n: number }).n).toBe(1);
  });

  it('still records a Bing-only site', async () => {
    const { env, raw } = setup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ d: [{ Url: 'https://bing-only.com/' }] }))));

    await syncBWTProperties(env, 'u1', 'token');

    const row = raw.prepare("SELECT kind FROM gsc_properties WHERE site_url = 'https://bing-only.com/'").get() as { kind: string };
    expect(row.kind).toBe('bwt');
  });
});
