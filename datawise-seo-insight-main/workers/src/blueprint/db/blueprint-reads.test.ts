import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from './util';
import { NotFoundError } from '../domain/api-errors';
import type { Actor } from './access';
import { loadLatestBlueprint, loadRevisionOwned, loadGraph } from './blueprint-reads';

function actorFor(organizationId: string): Actor {
  return { userId: 'user1', organizationId, roles: ['owner'] };
}

async function seedProject(d1: D1Database, organizationId: string): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, organizationId, 'user1', 'Test Project', 'existing_site', 'US', 'en', nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, created_by, created_at)
       VALUES (?, ?, ?, ?, 'succeeded', ?, ?)`
    )
    .bind(id, projectId, 'brief1', 'estimate1', 'user1', nowIso())
    .run();
  return id;
}

async function seedPublishedBlueprint(
  d1: D1Database,
  projectId: string,
  runId: string
): Promise<{ versionId: string; revisionId: string }> {
  const versionId = newId('bpv');
  await d1
    .prepare(
      `INSERT INTO blueprint_versions
        (id, project_id, run_id, version_number, status, schema_version, ruleset_version,
         completeness, partial_reasons_json, summary_json, latest_revision_id, published_at, created_at)
       VALUES (?, ?, ?, 1, 'published', 'v1', 'r1', 'partial', ?, ?, NULL, ?, ?)`
    )
    .bind(versionId, projectId, runId, JSON.stringify(['collect_faq_evidence']), JSON.stringify({ pageCount: 3 }), nowIso(), nowIso())
    .run();

  const revisionId = newId('bprev');
  await d1
    .prepare(
      `INSERT INTO blueprint_revisions
        (id, blueprint_version_id, parent_revision_id, revision_number, revision_hash, created_by, created_at)
       VALUES (?, ?, NULL, 1, ?, ?, ?)`
    )
    .bind(revisionId, versionId, 'hash1', 'user1', nowIso())
    .run();

  await d1.prepare(`UPDATE blueprint_versions SET latest_revision_id = ? WHERE id = ?`).bind(revisionId, versionId).run();

  return { versionId, revisionId };
}

interface SeedPageSpec {
  logicalPageId: string;
  parentLogicalPageId?: string | null;
  pageType?: string;
  title?: string;
  slug?: string;
  primaryKeywordNormalized?: string | null;
  pageJson?: Record<string, unknown>;
}

async function seedPage(d1: D1Database, revisionId: string, spec: SeedPageSpec): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO blueprint_pages
        (row_id, blueprint_revision_id, logical_page_id, parent_logical_page_id, page_type, title, slug,
         primary_keyword_normalized, recommendation, approval, priority, confidence_label, page_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'create', 'approved', 'high', 'high', ?)`
    )
    .bind(
      newId('bppage'),
      revisionId,
      spec.logicalPageId,
      spec.parentLogicalPageId ?? null,
      spec.pageType ?? 'service',
      spec.title ?? spec.logicalPageId,
      spec.slug ?? `/${spec.logicalPageId}`,
      spec.primaryKeywordNormalized ?? null,
      JSON.stringify(spec.pageJson ?? {})
    )
    .run();
}

async function seedClusterWithKeywords(d1: D1Database, runId: string): Promise<string> {
  const clusterId = 'kcl_1';
  await d1
    .prepare(
      `INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword, search_volume, main_intent)
       VALUES ('kw_1', ?, 'drain cleaning', 'drain cleaning', 90500, 'commercial')`
    )
    .bind(runId)
    .run();

  await d1
    .prepare(
      `INSERT INTO keyword_clusters (id, run_id, label, primary_keyword_id)
       VALUES (?, ?, 'Drain Cleaning', 'kw_1')`
    )
    .bind(clusterId, runId)
    .run();

  for (const keywordId of ['kw_1', 'kw_2', 'kw_3']) {
    await d1
      .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, is_primary) VALUES (?, ?, ?)`)
      .bind(clusterId, keywordId, keywordId === 'kw_1' ? 1 : 0)
      .run();
  }

  return clusterId;
}

describe('loadLatestBlueprint', () => {
  it('returns version + latest revision', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, 'org_a');
    const runId = await seedRun(d1, projectId);
    const { versionId, revisionId } = await seedPublishedBlueprint(d1, projectId, runId);

    const view = await loadLatestBlueprint(d1, actorFor('org_a'), projectId);

    expect(view.versionId).toBe(versionId);
    expect(view.revision.id).toBe(revisionId);
    expect(view.revision.revisionNumber).toBe(1);
    expect(view.partialReasons).toEqual(['collect_faq_evidence']);
    expect(view.summary).toEqual({ pageCount: 3 });
    expect(view.completeness).toBe('partial');
  });

  it('throws NotFoundError for a project with no published version', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, 'org_a');

    await expect(loadLatestBlueprint(d1, actorFor('org_a'), projectId)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError cross-org', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, 'org_a');
    const runId = await seedRun(d1, projectId);
    await seedPublishedBlueprint(d1, projectId, runId);

    await expect(loadLatestBlueprint(d1, actorFor('org_b'), projectId)).rejects.toThrow(NotFoundError);
  });
});

describe('loadRevisionOwned', () => {
  it('resolves revision -> project ownership and 404s cross-org', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, 'org_a');
    const runId = await seedRun(d1, projectId);
    const { versionId, revisionId } = await seedPublishedBlueprint(d1, projectId, runId);

    const owned = await loadRevisionOwned(d1, actorFor('org_a'), revisionId);
    expect(owned).toEqual({ revisionId, versionId, projectId, runId });

    await expect(loadRevisionOwned(d1, actorFor('org_b'), revisionId)).rejects.toThrow(NotFoundError);
  });
});

describe('loadGraph', () => {
  it('returns nodes ordered by logical_page_id with primary keyword metrics from the first cluster', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, 'org_a');
    const runId = await seedRun(d1, projectId);
    const { revisionId } = await seedPublishedBlueprint(d1, projectId, runId);
    await seedClusterWithKeywords(d1, runId);

    await seedPage(d1, revisionId, { logicalPageId: 'home', pageType: 'home', pageJson: {} });
    await seedPage(d1, revisionId, {
      logicalPageId: 'service-drain-cleaning',
      pageJson: { clusterIds: ['kcl_1'] },
    });
    await seedPage(d1, revisionId, {
      logicalPageId: 'service-drain-cleaning-downtown',
      parentLogicalPageId: 'service-drain-cleaning',
      pageJson: {},
    });

    const nodes = await loadGraph(d1, revisionId, runId);

    expect(nodes.map((n) => n.logicalPageId)).toEqual([
      'home',
      'service-drain-cleaning',
      'service-drain-cleaning-downtown',
    ]);

    const home = nodes[0];
    expect(home.primaryKeyword).toBeNull();
    expect(home.primaryVolume).toBeNull();
    expect(home.primaryIntent).toBeNull();
    expect(home.supportingKeywordCount).toBe(0);

    const service = nodes[1];
    expect(service.primaryKeyword).toBe('drain cleaning');
    expect(service.primaryVolume).toBe(90500);
    expect(service.primaryIntent).toBe('commercial');
    expect(service.supportingKeywordCount).toBe(3);

    const child = nodes[2];
    expect(child.parentLogicalPageId).toBe('service-drain-cleaning');
    expect(child.primaryKeyword).toBeNull();
    expect(child.supportingKeywordCount).toBe(0);
  });
});
