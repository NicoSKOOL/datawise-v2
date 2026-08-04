import { describe, it, expect } from 'vitest';
import { createTestDb } from './d1';
import { newId, nowIso, usdToMicro, microToUsd } from '../db/util';

describe('test D1 adapter', () => {
  it('applies the schema and supports prepare/bind/first/all/run', async () => {
    const { d1 } = createTestDb();
    const meta = await d1.prepare("SELECT value FROM blueprint_meta WHERE key = 'schema_version'").first<{ value: string }>();
    expect(meta?.value).toBe('5');
    const id = newId('proj');
    await d1
      .prepare('INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, 'org1', 'u1', 'Test', 'greenfield', 'US', 'en', nowIso(), nowIso())
      .run();
    const rows = await d1.prepare('SELECT id FROM projects WHERE organization_id = ?').bind('org1').all<{ id: string }>();
    expect(rows.results.map((r) => r.id)).toEqual([id]);
  });
  it('run() reports changes for conditional updates (CAS support)', async () => {
    const { d1 } = createTestDb();
    const miss = await d1.prepare("UPDATE blueprint_meta SET value = '3' WHERE key = 'nope'").run();
    expect(miss.meta.changes).toBe(0);
  });
  it('batch() is atomic', async () => {
    const { d1 } = createTestDb();
    await expect(
      d1.batch([
        d1.prepare("INSERT INTO blueprint_meta (key, value) VALUES ('a', '1')"),
        d1.prepare("INSERT INTO blueprint_meta (key, value) VALUES ('a', '1')"),
      ])
    ).rejects.toThrow();
    const row = await d1.prepare("SELECT value FROM blueprint_meta WHERE key = 'a'").first();
    expect(row).toBeNull();
  });
  it('money helpers round-trip without floats', () => {
    expect(usdToMicro('2.50')).toBe(2_500_000);
    expect(usdToMicro('0.000001')).toBe(1);
    expect(microToUsd(2_500_000)).toBe('2.50');
    expect(microToUsd(0)).toBe('0.00');
  });
});
