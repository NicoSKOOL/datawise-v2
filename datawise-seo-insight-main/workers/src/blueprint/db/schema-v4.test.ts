import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';

function columnNames(raw: import('better-sqlite3').Database, table: string): string[] {
  return raw.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((r: any) => r.name);
}

describe('phase 4 schema', () => {
  it('adds excluded_reason to keywords', async () => {
    const { raw } = createTestDb();
    expect(columnNames(raw, 'keywords')).toEqual(expect.arrayContaining(['excluded_reason']));
  });

  it('adds ruleset_version and score_breakdown_json to keyword_clusters', async () => {
    const { raw } = createTestDb();
    expect(columnNames(raw, 'keyword_clusters')).toEqual(
      expect.arrayContaining(['ruleset_version', 'score_breakdown_json'])
    );
  });

  it('has cluster_adjudications with the expected columns and a run/decision index', async () => {
    const { raw } = createTestDb();
    expect(columnNames(raw, 'cluster_adjudications')).toEqual(
      expect.arrayContaining([
        'id',
        'run_id',
        'case_type',
        'cluster_ids_json',
        'keyword_ids_json',
        'decision',
        'score_context_json',
        'ruleset_version',
        'created_at',
        'resolved_at',
      ])
    );
    const indexes = raw.prepare(`PRAGMA index_list('cluster_adjudications')`).all().map((r: any) => r.name);
    expect(indexes).toContain('idx_cluster_adjudications_run');
  });

  it('has parsed_competitor_pages with the expected columns, unique constraint, and run/cluster index', async () => {
    const { raw } = createTestDb();
    expect(columnNames(raw, 'parsed_competitor_pages')).toEqual(
      expect.arrayContaining([
        'id',
        'run_id',
        'cluster_id',
        'competitor_id',
        'url',
        'fetch_state',
        'js_rendered',
        'status_code',
        'headings_json',
        'topics_json',
        'text_blocks_json',
        'links_json',
        'structure_json',
        'evidence_ref_id',
        'fetched_at',
      ])
    );
    const indexes = raw.prepare(`PRAGMA index_list('parsed_competitor_pages')`).all().map((r: any) => r.name);
    expect(indexes).toContain('idx_parsed_pages_run');

    // UNIQUE(run_id, cluster_id, url) enforced.
    raw
      .prepare(
        `INSERT INTO parsed_competitor_pages (id, run_id, cluster_id, url, fetch_state, fetched_at)
         VALUES ('p1', 'run1', 'c1', 'https://a.com', 'parsed', '2026-07-14T00:00:00.000Z')`
      )
      .run();
    expect(() =>
      raw
        .prepare(
          `INSERT INTO parsed_competitor_pages (id, run_id, cluster_id, url, fetch_state, fetched_at)
           VALUES ('p2', 'run1', 'c1', 'https://a.com', 'parsed', '2026-07-14T00:00:00.000Z')`
        )
        .run()
    ).toThrow();
  });

  it('has existing_pages with the expected columns, unique constraint, and run index', async () => {
    const { raw } = createTestDb();
    expect(columnNames(raw, 'existing_pages')).toEqual(
      expect.arrayContaining([
        'id',
        'run_id',
        'url',
        'canonical_url',
        'title',
        'discovered_via',
        'http_status',
        'matched_logical_page_id',
        'match_score',
      ])
    );
    const indexes = raw.prepare(`PRAGMA index_list('existing_pages')`).all().map((r: any) => r.name);
    expect(indexes).toContain('idx_existing_pages_run');

    // UNIQUE(run_id, url) enforced.
    raw
      .prepare(`INSERT INTO existing_pages (id, run_id, url, discovered_via) VALUES ('e1', 'run1', 'https://a.com/x', 'sitemap')`)
      .run();
    expect(() =>
      raw
        .prepare(`INSERT INTO existing_pages (id, run_id, url, discovered_via) VALUES ('e2', 'run1', 'https://a.com/x', 'robots')`)
        .run()
    ).toThrow();
  });

  it('has the new keyword_clusters/cluster_keywords indexes', async () => {
    const { raw } = createTestDb();
    const clusterIndexes = raw.prepare(`PRAGMA index_list('keyword_clusters')`).all().map((r: any) => r.name);
    expect(clusterIndexes).toContain('idx_clusters_run');
    const clusterKeywordIndexes = raw.prepare(`PRAGMA index_list('cluster_keywords')`).all().map((r: any) => r.name);
    expect(clusterKeywordIndexes).toContain('idx_cluster_keywords_kw');
  });

  it('bootstraps schema_version at 4', async () => {
    const { raw } = createTestDb();
    const row = raw.prepare(`SELECT value FROM blueprint_meta WHERE key = 'schema_version'`).get() as { value: string };
    expect(row.value).toBe('4');
  });

  it('numeric version guard does not re-fire for a double-digit schema_version', () => {
    const { raw } = createTestDb();
    const guard = `UPDATE blueprint_meta SET value = '4', updated_at = datetime('now') WHERE key = 'schema_version' AND CAST(value AS INTEGER) < 4;`;
    const readVersion = () =>
      (raw.prepare(`SELECT value FROM blueprint_meta WHERE key = 'schema_version'`).get() as { value: string }).value;

    // A future double-digit version must not be clobbered back to '4'
    // ('10' < '4' is true lexicographically, false numerically -- CAST guards it).
    raw.prepare(`UPDATE blueprint_meta SET value = '10' WHERE key = 'schema_version'`).run();
    raw.exec(guard);
    expect(readVersion()).toBe('10');

    // Applying the guard when already exactly at '4' is a no-op (idempotent).
    raw.prepare(`UPDATE blueprint_meta SET value = '4' WHERE key = 'schema_version'`).run();
    raw.exec(guard);
    expect(readVersion()).toBe('4');

    // Inverse: an older version still gets bumped.
    raw.prepare(`UPDATE blueprint_meta SET value = '3' WHERE key = 'schema_version'`).run();
    raw.exec(guard);
    expect(readVersion()).toBe('4');
  });
});
