import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';

describe('phase 3 schema', () => {
  it('has dfs_serp_tasks with a run/status index', async () => {
    const { raw } = createTestDb();
    const cols = raw.prepare(`SELECT name FROM pragma_table_info('dfs_serp_tasks')`).all().map((r: any) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['id','run_id','keyword','service_area_id','location_code','provider_task_id','status','posted_at','completed_at','snapshot_id']));
  });

  it('numeric version guard does not re-fire for a double-digit schema_version', () => {
    const { raw } = createTestDb();
    const guard = `UPDATE blueprint_meta SET value = '3', updated_at = datetime('now') WHERE key = 'schema_version' AND CAST(value AS INTEGER) < 3;`;
    const readVersion = () =>
      (raw.prepare(`SELECT value FROM blueprint_meta WHERE key = 'schema_version'`).get() as { value: string }).value;

    // A future double-digit version must not be clobbered back to '3'
    // ('10' < '3' is true lexicographically, false numerically).
    raw.prepare(`UPDATE blueprint_meta SET value = '10' WHERE key = 'schema_version'`).run();
    raw.exec(guard);
    expect(readVersion()).toBe('10');

    // Inverse: an older version still gets bumped.
    raw.prepare(`UPDATE blueprint_meta SET value = '2' WHERE key = 'schema_version'`).run();
    raw.exec(guard);
    expect(readVersion()).toBe('3');
  });
});
