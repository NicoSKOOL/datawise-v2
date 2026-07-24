import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';

function columnNames(raw: import('better-sqlite3').Database, table: string): string[] {
  return raw.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r: any) => r.name);
}

describe('phase 4b schema (v5)', () => {
  it('adds supporting_keywords_json to blueprint_pages', () => {
    const { raw } = createTestDb();
    expect(columnNames(raw, 'blueprint_pages')).toEqual(
      expect.arrayContaining(['supporting_keywords_json'])
    );
  });

  it('adds resolved_by to cluster_adjudications', () => {
    const { raw } = createTestDb();
    expect(columnNames(raw, 'cluster_adjudications')).toEqual(expect.arrayContaining(['resolved_by']));
  });

  it('accepts variant_fold as a cluster_adjudications case_type and still rejects unknown types', () => {
    const { raw } = createTestDb();
    raw.pragma('foreign_keys = OFF');
    const insert = (id: string, caseType: string) =>
      raw
        .prepare(
          `INSERT INTO cluster_adjudications
             (id, run_id, case_type, cluster_ids_json, keyword_ids_json, score_context_json, ruleset_version, created_at)
           VALUES (?, 'run1', ?, '[]', '[]', '{}', 'cluster-v3', '2026-07-24T00:00:00.000Z')`
        )
        .run(id, caseType);
    expect(() => insert('a1', 'variant_fold')).not.toThrow();
    expect(() => insert('a2', 'merge')).not.toThrow();
    expect(() => insert('a3', 'bogus')).toThrow();
  });

  it('constrains resolved_by to rules, llm, or null', () => {
    const { raw } = createTestDb();
    raw.pragma('foreign_keys = OFF');
    const insert = (id: string, resolvedBy: string | null) =>
      raw
        .prepare(
          `INSERT INTO cluster_adjudications
             (id, run_id, case_type, cluster_ids_json, keyword_ids_json, score_context_json, ruleset_version, created_at, resolved_by)
           VALUES (?, 'run1', 'merge', '[]', '[]', '{}', 'cluster-v3', '2026-07-24T00:00:00.000Z', ?)`
        )
        .run(id, resolvedBy);
    expect(() => insert('r1', 'rules')).not.toThrow();
    expect(() => insert('r2', 'llm')).not.toThrow();
    expect(() => insert('r3', null)).not.toThrow();
    expect(() => insert('r4', 'human')).toThrow();
  });

  it('accepts out_of_area as keywords.excluded_reason', () => {
    const { raw } = createTestDb();
    raw.pragma('foreign_keys = OFF');
    expect(() =>
      raw
        .prepare(
          `INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword, excluded_reason)
           VALUES ('k1', 'run1', 'dallas plumber', 'dallas plumber', 'out_of_area')`
        )
        .run()
    ).not.toThrow();
  });

  it('bootstraps schema_version at 5', () => {
    const { raw } = createTestDb();
    const row = raw.prepare(`SELECT value FROM blueprint_meta WHERE key = 'schema_version'`).get() as {
      value: string;
    };
    expect(row.value).toBe('5');
  });

  it('numeric version guard does not re-fire for a double-digit schema_version', () => {
    const { raw } = createTestDb();
    const guard = `UPDATE blueprint_meta SET value = '5', updated_at = datetime('now') WHERE key = 'schema_version' AND CAST(value AS INTEGER) < 5;`;
    const readVersion = () =>
      (raw.prepare(`SELECT value FROM blueprint_meta WHERE key = 'schema_version'`).get() as { value: string })
        .value;

    // A future double-digit version must not be clobbered back to '5'
    // ('10' < '5' is true lexicographically, false numerically -- CAST guards it).
    raw.prepare(`UPDATE blueprint_meta SET value = '10' WHERE key = 'schema_version'`).run();
    raw.exec(guard);
    expect(readVersion()).toBe('10');

    // Applying the guard when already exactly at '5' is a no-op (idempotent).
    raw.prepare(`UPDATE blueprint_meta SET value = '5' WHERE key = 'schema_version'`).run();
    raw.exec(guard);
    expect(readVersion()).toBe('5');

    // Inverse: an older version still gets bumped.
    raw.prepare(`UPDATE blueprint_meta SET value = '4' WHERE key = 'schema_version'`).run();
    raw.exec(guard);
    expect(readVersion()).toBe('5');
  });
});
