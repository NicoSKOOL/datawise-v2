// Shared read loaders for the Blueprint Canvas UI wave: the latest published
// version + revision for a project, ownership resolution for a bare revision
// id, and the page graph for a revision (nodes + their primary keyword
// metrics). Every later Canvas endpoint composes these instead of
// re-deriving the same joins.
import { NotFoundError } from '../domain/api-errors';
import { chunk } from './batch';
import type { Actor } from './access';

export interface BlueprintLatestView {
  versionId: string;
  versionNumber: number;
  status: string;
  schemaVersion: string;
  rulesetVersion: string;
  completeness: string;
  partialReasons: string[];
  summary: Record<string, unknown>;
  publishedAt: string | null;
  revision: { id: string; revisionNumber: number; revisionHash: string };
}

export interface BlueprintGraphNode {
  logicalPageId: string;
  parentLogicalPageId: string | null;
  pageType: string;
  title: string;
  slug: string;
  primaryKeyword: string | null;
  primaryVolume: number | null;
  primaryIntent: string | null;
  recommendation: string;
  approval: string;
  priority: string | null;
  confidenceLabel: string | null;
  supportingKeywordCount: number;
}

interface BlueprintVersionRow {
  id: string;
  version_number: number;
  status: string;
  schema_version: string;
  ruleset_version: string;
  completeness: string;
  partial_reasons_json: string;
  summary_json: string;
  published_at: string | null;
}

interface BlueprintRevisionRow {
  id: string;
  revision_number: number;
  revision_hash: string;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Ownership: joins up to projects.organization_id and requires
// deleted_at IS NULL, same invisible-404 rule assertRunAccess uses (see
// db/access.ts) -- missing, cross-tenant, and soft-deleted projects are all
// indistinguishable NotFoundError to the caller.
export async function loadLatestBlueprint(
  d1: D1Database,
  actor: Actor,
  projectId: string
): Promise<BlueprintLatestView> {
  const versionRow = await d1
    .prepare(
      `SELECT bv.id, bv.version_number, bv.status, bv.schema_version, bv.ruleset_version,
              bv.completeness, bv.partial_reasons_json, bv.summary_json, bv.published_at
       FROM blueprint_versions bv
       JOIN projects p ON p.id = bv.project_id
       WHERE bv.project_id = ?
         AND p.organization_id = ?
         AND p.deleted_at IS NULL
         AND bv.status = 'published'
       ORDER BY bv.version_number DESC
       LIMIT 1`
    )
    .bind(projectId, actor.organizationId)
    .first<BlueprintVersionRow>();
  if (!versionRow) throw new NotFoundError(`Published blueprint not found for project: ${projectId}`);

  const revisionRow = await d1
    .prepare(
      `SELECT id, revision_number, revision_hash
       FROM blueprint_revisions
       WHERE blueprint_version_id = ?
       ORDER BY revision_number DESC
       LIMIT 1`
    )
    .bind(versionRow.id)
    .first<BlueprintRevisionRow>();
  if (!revisionRow) throw new NotFoundError(`Blueprint revision not found for version: ${versionRow.id}`);

  return {
    versionId: versionRow.id,
    versionNumber: versionRow.version_number,
    status: versionRow.status,
    schemaVersion: versionRow.schema_version,
    rulesetVersion: versionRow.ruleset_version,
    completeness: versionRow.completeness,
    partialReasons: parseJsonArray(versionRow.partial_reasons_json),
    summary: parseJsonObject(versionRow.summary_json),
    publishedAt: versionRow.published_at,
    revision: {
      id: revisionRow.id,
      revisionNumber: revisionRow.revision_number,
      revisionHash: revisionRow.revision_hash,
    },
  };
}

interface RevisionOwnedRow {
  revision_id: string;
  version_id: string;
  project_id: string;
  run_id: string;
}

// Resolves a bare revision id to its owning version/project/run, applying the
// same organization + soft-delete guard as loadLatestBlueprint so a
// revision id from another organization 404s rather than leaking existence.
export async function loadRevisionOwned(
  d1: D1Database,
  actor: Actor,
  revisionId: string
): Promise<{ revisionId: string; versionId: string; projectId: string; runId: string }> {
  const row = await d1
    .prepare(
      `SELECT br.id AS revision_id, bv.id AS version_id, bv.project_id AS project_id, bv.run_id AS run_id
       FROM blueprint_revisions br
       JOIN blueprint_versions bv ON bv.id = br.blueprint_version_id
       JOIN projects p ON p.id = bv.project_id
       WHERE br.id = ?
         AND p.organization_id = ?
         AND p.deleted_at IS NULL`
    )
    .bind(revisionId, actor.organizationId)
    .first<RevisionOwnedRow>();
  if (!row) throw new NotFoundError(`Blueprint revision not found: ${revisionId}`);

  return {
    revisionId: row.revision_id,
    versionId: row.version_id,
    projectId: row.project_id,
    runId: row.run_id,
  };
}

interface BlueprintPageRow {
  row_id: string;
  logical_page_id: string;
  parent_logical_page_id: string | null;
  page_type: string;
  title: string;
  slug: string;
  primary_keyword_normalized: string | null;
  recommendation: string;
  approval: string;
  priority: string | null;
  confidence_label: string | null;
  page_json: string;
}

interface ClusterMetricsRow {
  cluster_id: string;
  display_keyword: string | null;
  search_volume: number | null;
  main_intent: string | null;
  member_count: number;
}

// The primary cluster for a page is clusterIds[0] inside its page_json blob;
// there is no SQL-level join for that (it is JSON, not a column), so this
// pulls it out in application code rather than trying to express it in SQL.
function firstClusterId(pageJsonRaw: string): string | null {
  try {
    const parsed = JSON.parse(pageJsonRaw) as { clusterIds?: unknown };
    const clusterIds = parsed?.clusterIds;
    if (Array.isArray(clusterIds) && clusterIds.length > 0 && typeof clusterIds[0] === 'string') {
      return clusterIds[0];
    }
    return null;
  } catch {
    return null;
  }
}

// Two queries total regardless of page count: all pages for the revision,
// then one metrics query per chunk of distinct first-cluster ids (chunked at
// 90 to stay under D1's 100-bound-param ceiling alongside the run_id bind --
// see db/batch.ts). Pages with no cluster (skeleton pages like contact) get
// null keyword fields and a 0 supporting-keyword count.
export async function loadGraph(d1: D1Database, revisionId: string, runId: string): Promise<BlueprintGraphNode[]> {
  const pagesResult = await d1
    .prepare(
      `SELECT row_id, logical_page_id, parent_logical_page_id, page_type, title, slug,
              primary_keyword_normalized, recommendation, approval, priority, confidence_label, page_json
       FROM blueprint_pages
       WHERE blueprint_revision_id = ?
       ORDER BY logical_page_id ASC`
    )
    .bind(revisionId)
    .all<BlueprintPageRow>();
  const pages = pagesResult.results;

  const primaryClusterIdByPage = new Map<string, string>();
  const clusterIdSet = new Set<string>();
  for (const page of pages) {
    const clusterId = firstClusterId(page.page_json);
    if (clusterId) {
      primaryClusterIdByPage.set(page.row_id, clusterId);
      clusterIdSet.add(clusterId);
    }
  }

  const clusterMetrics = new Map<string, ClusterMetricsRow>();
  for (const group of chunk(Array.from(clusterIdSet), 90)) {
    if (group.length === 0) continue;
    const placeholders = group.map(() => '?').join(', ');
    const result = await d1
      .prepare(
        `SELECT kc.id AS cluster_id, k.display_keyword, k.search_volume, k.main_intent,
                (SELECT COUNT(*) FROM cluster_keywords ck2 WHERE ck2.cluster_id = kc.id) AS member_count
         FROM keyword_clusters kc
         LEFT JOIN keywords k ON k.id = kc.primary_keyword_id
         WHERE kc.run_id = ?
           AND kc.id IN (${placeholders})
         ORDER BY kc.id ASC`
      )
      .bind(runId, ...group)
      .all<ClusterMetricsRow>();
    for (const row of result.results) {
      clusterMetrics.set(row.cluster_id, row);
    }
  }

  return pages.map((page) => {
    const clusterId = primaryClusterIdByPage.get(page.row_id);
    const metrics = clusterId ? clusterMetrics.get(clusterId) : undefined;
    return {
      logicalPageId: page.logical_page_id,
      parentLogicalPageId: page.parent_logical_page_id,
      pageType: page.page_type,
      title: page.title,
      slug: page.slug,
      primaryKeyword: metrics ? metrics.display_keyword ?? page.primary_keyword_normalized : null,
      primaryVolume: metrics ? metrics.search_volume ?? null : null,
      primaryIntent: metrics ? metrics.main_intent ?? null : null,
      recommendation: page.recommendation,
      approval: page.approval,
      priority: page.priority,
      confidenceLabel: page.confidence_label,
      supportingKeywordCount: metrics ? metrics.member_count : 0,
    };
  });
}
