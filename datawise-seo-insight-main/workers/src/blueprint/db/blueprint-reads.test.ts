import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from './util';
import { NotFoundError } from '../domain/api-errors';
import type { Actor } from './access';
import { loadLatestBlueprint, loadRevisionOwned, loadGraph, loadPageDetail } from './blueprint-reads';

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

// Full cluster with 3 real keyword rows (distinct volumes, one null) so the
// page-detail members query can exercise its NULLS-last ordering, plus
// decision_reason/cohesion values loadGraph's tests never populate.
async function seedFullCluster(d1: D1Database, runId: string): Promise<string> {
  const clusterId = 'kcl_detail';
  await d1
    .prepare(
      `INSERT INTO keywords (id, run_id, display_keyword, normalized_keyword, search_volume, main_intent)
       VALUES
        ('kwd_1', ?, 'drain cleaning', 'drain cleaning', 90500, 'commercial'),
        ('kwd_2', ?, 'kw two', 'kw two', 5000, 'informational'),
        ('kwd_3', ?, 'aaa kw three', 'aaa kw three', NULL, NULL)`
    )
    .bind(runId, runId, runId)
    .run();

  await d1
    .prepare(
      `INSERT INTO keyword_clusters (id, run_id, label, primary_keyword_id, decision_reason, semantic_cohesion, serp_overlap_cohesion)
       VALUES (?, ?, 'Drain Cleaning', 'kwd_1', 'sufficient_demand; low_serp_overlap', 0.82, 0.35)`
    )
    .bind(clusterId, runId)
    .run();

  for (const keywordId of ['kwd_1', 'kwd_2', 'kwd_3']) {
    await d1
      .prepare(`INSERT INTO cluster_keywords (cluster_id, keyword_id, is_primary) VALUES (?, ?, ?)`)
      .bind(clusterId, keywordId, keywordId === 'kwd_1' ? 1 : 0)
      .run();
  }

  return clusterId;
}

describe('loadPageDetail', () => {
  it('composes node + fired signals + cluster members + competitor evidence + faqs', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, 'org_a');
    const runId = await seedRun(d1, projectId);
    const { revisionId } = await seedPublishedBlueprint(d1, projectId, runId);
    await seedFullCluster(d1, runId);

    await seedPage(d1, revisionId, {
      logicalPageId: 'service-drain-cleaning',
      pageJson: {
        h1: 'Drain Cleaning Services',
        metaDescription: 'Fast, licensed drain cleaning.',
        clusterIds: ['kcl_detail'],
        scoreBreakdown: {
          total: 0.82,
          components: [
            { key: 'sufficient_demand', weight: 0.3, rawValue: 1, contribution: 0.3 },
            { key: 'low_serp_overlap', weight: 0.2, rawValue: 1, contribution: 0.2 },
            { key: 'distinct_intent', weight: 0.1, rawValue: 0, contribution: 0 },
          ],
        },
        evidenceRefs: ['ev_1', 'ev_2'],
      },
    });

    const snapshotId = 'serpsnap_detail';
    await d1
      .prepare(
        `INSERT INTO serp_snapshots (id, run_id, keyword_id, location_code, language_code, checked_at, organic_json)
         VALUES (?, ?, 'kwd_1', 2840, 'en', '2026-07-16T00:00:00.000Z', ?)`
      )
      .bind(
        snapshotId,
        runId,
        JSON.stringify([
          { rank: 1, url: 'https://competitor-a.com/drain-cleaning', title: 'A', domain: 'competitor-a.com' },
          { rank: 2, url: 'https://random-blog.com/post', title: 'Blog', domain: 'random-blog.com' },
          { rank: 3, url: 'https://competitor-b.com/services', title: 'B', domain: 'competitor-b.com' },
        ])
      )
      .run();

    await d1
      .prepare(
        `INSERT INTO competitors (id, run_id, domain, source, selected)
         VALUES ('comp_a', ?, 'competitor-a.com', 'dataforseo', 1), ('comp_b', ?, 'competitor-b.com', 'dataforseo', 1)`
      )
      .bind(runId, runId)
      .run();

    await d1
      .prepare(
        `INSERT INTO faq_evidence (id, run_id, serp_snapshot_id, question, answer_text, source_title, source_url, paa_depth)
         VALUES
          ('faq_1', ?, ?, 'How much does drain cleaning cost?', 'It depends.', 'Cost Guide', 'https://example.com/cost', 1),
          ('faq_2', ?, ?, 'How often should drains be cleaned?', 'Annually.', NULL, 'https://example.com/freq', 1)`
      )
      .bind(runId, snapshotId, runId, snapshotId)
      .run();

    const detail = await loadPageDetail(d1, revisionId, runId, 'service-drain-cleaning');

    expect(detail.node.logicalPageId).toBe('service-drain-cleaning');
    expect(detail.node.primaryKeyword).toBe('drain cleaning');
    expect(detail.node.primaryVolume).toBe(90500);
    expect(detail.node.supportingKeywordCount).toBe(3);

    expect(detail.page.h1).toBe('Drain Cleaning Services');
    expect(detail.page.metaDescription).toBe('Fast, licensed drain cleaning.');
    expect(detail.page.decisionReason).toBe('sufficient_demand; low_serp_overlap');
    expect(detail.page.firedSignals).toEqual(['sufficient_demand', 'low_serp_overlap']);
    expect(detail.page.evidenceRefIds).toEqual(['ev_1', 'ev_2']);
    expect(detail.page.clusterIds).toEqual(['kcl_detail']);

    expect(detail.cluster).not.toBeNull();
    expect(detail.cluster?.members).toEqual([
      { keyword: 'drain cleaning', volume: 90500, intent: 'commercial' },
      { keyword: 'kw two', volume: 5000, intent: 'informational' },
      { keyword: 'aaa kw three', volume: null, intent: null },
    ]);
    expect(detail.cluster?.totalMembers).toBe(3);
    expect(detail.cluster?.semanticCohesion).toBe(0.82);
    expect(detail.cluster?.serpOverlapCohesion).toBe(0.35);

    expect(detail.evidenceAvailable).toBe(true);
    expect(detail.competitorEvidence).toEqual([
      { domain: 'competitor-a.com', position: 1, url: 'https://competitor-a.com/drain-cleaning' },
      { domain: 'competitor-b.com', position: 3, url: 'https://competitor-b.com/services' },
    ]);

    expect(detail.faqs).toHaveLength(2);
    expect(detail.faqs).toEqual(
      expect.arrayContaining([
        { question: 'How much does drain cleaning cost?', source: 'Cost Guide' },
        { question: 'How often should drains be cleaned?', source: 'https://example.com/freq' },
      ])
    );

    expect(detail.fanOut).toEqual({ status: 'pending_phase_5' });
  });

  it('reports evidenceAvailable false with empty evidence arrays when no SERP snapshot exists', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, 'org_a');
    const runId = await seedRun(d1, projectId);
    const { revisionId } = await seedPublishedBlueprint(d1, projectId, runId);
    await seedFullCluster(d1, runId);

    await seedPage(d1, revisionId, {
      logicalPageId: 'service-drain-cleaning',
      pageJson: { clusterIds: ['kcl_detail'] },
    });

    const detail = await loadPageDetail(d1, revisionId, runId, 'service-drain-cleaning');

    expect(detail.evidenceAvailable).toBe(false);
    expect(detail.competitorEvidence).toEqual([]);
    expect(detail.faqs).toEqual([]);
    expect(detail.cluster).not.toBeNull();
    expect(detail.cluster?.totalMembers).toBe(3);
  });

  it('throws NotFoundError for an unknown logicalPageId', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1, 'org_a');
    const runId = await seedRun(d1, projectId);
    const { revisionId } = await seedPublishedBlueprint(d1, projectId, runId);

    await expect(loadPageDetail(d1, revisionId, runId, 'does-not-exist')).rejects.toThrow(NotFoundError);
  });
});
