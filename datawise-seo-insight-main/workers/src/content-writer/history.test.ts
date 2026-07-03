import { describe, it, expect } from 'vitest';
import { recentHistorySql } from './history';

describe('recentHistorySql', () => {
  it('takes the most recent N (DESC LIMIT) and re-sorts ascending', () => {
    const sql = recentHistorySql(100);
    expect(sql).toContain('ORDER BY created_at DESC, rowid DESC LIMIT 100');
    expect(sql.trimEnd().endsWith('ORDER BY created_at ASC, rid ASC')).toBe(true);
    expect(sql).toContain('conversation_id = ?');
  });

  it('clamps limit to a positive integer', () => {
    expect(recentHistorySql(0)).toContain('LIMIT 1');
    expect(recentHistorySql(50.9)).toContain('LIMIT 50');
  });
});
