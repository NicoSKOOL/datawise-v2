import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';

describe('phase 3 schema', () => {
  it('has dfs_serp_tasks with a run/status index', async () => {
    const { raw } = createTestDb();
    const cols = raw.prepare(`SELECT name FROM pragma_table_info('dfs_serp_tasks')`).all().map((r: any) => r.name);
    expect(cols).toEqual(expect.arrayContaining(['id','run_id','keyword','service_area_id','location_code','provider_task_id','status','posted_at','completed_at','snapshot_id']));
  });
});
