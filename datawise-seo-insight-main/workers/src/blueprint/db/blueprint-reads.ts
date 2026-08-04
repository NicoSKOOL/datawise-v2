// Shared read loaders for the Blueprint Canvas UI wave: the latest published
// version + revision for a project, ownership resolution for a bare revision
// id, the page graph for a revision (nodes + their primary keyword metrics),
// and single-page detail (evidence composed from the cluster, SERP snapshot,
// and FAQ tables). Every later Canvas endpoint composes these instead of
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
  supportingKeywords: string[];
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

interface VersionRevisionRow {
  version_id: string;
  version_number: number;
  status: string;
  schema_version: string;
  ruleset_version: string;
  completeness: string;
  partial_reasons_json: string;
  summary_json: string;
  published_at: string | null;
  revision_id: string;
  revision_number: number;
  revision_hash: string;
}

// Loads the BlueprintLatestView-shaped metadata for a SPECIFIC revision,
// not necessarily the latest published one: the export report describes
// exactly the revision the caller asked for, even if a newer version has
// since been published. No organization join here, unlike
// loadLatestBlueprint: callers resolve and verify ownership of the
// revisionId via loadRevisionOwned first.
export async function loadVersionForRevision(d1: D1Database, revisionId: string): Promise<BlueprintLatestView> {
  const row = await d1
    .prepare(
      `SELECT bv.id AS version_id, bv.version_number, bv.status, bv.schema_version, bv.ruleset_version,
              bv.completeness, bv.partial_reasons_json, bv.summary_json, bv.published_at,
              br.id AS revision_id, br.revision_number, br.revision_hash
       FROM blueprint_revisions br
       JOIN blueprint_versions bv ON bv.id = br.blueprint_version_id
       WHERE br.id = ?`
    )
    .bind(revisionId)
    .first<VersionRevisionRow>();
  if (!row) throw new NotFoundError(`Blueprint revision not found: ${revisionId}`);

  return {
    versionId: row.version_id,
    versionNumber: row.version_number,
    status: row.status,
    schemaVersion: row.schema_version,
    rulesetVersion: row.ruleset_version,
    completeness: row.completeness,
    partialReasons: parseJsonArray(row.partial_reasons_json),
    summary: parseJsonObject(row.summary_json),
    publishedAt: row.published_at,
    revision: {
      id: row.revision_id,
      revisionNumber: row.revision_number,
      revisionHash: row.revision_hash,
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
  supporting_keywords_json: string | null;
}

// Shape of the `page_json` blob written by buildPageJson (domain/validate/publish.ts)
// at materialization time. Only the fields this module reads are declared;
// everything else in the blob (sections, warnings, overlay, ...) is ignored here.
interface PageJsonScoreComponent {
  key?: unknown;
  contribution?: unknown;
}

interface PageJsonShape {
  h1?: unknown;
  metaDescription?: unknown;
  clusterIds?: unknown;
  scoreBreakdown?: { components?: unknown } | null;
  evidenceRefs?: unknown;
}

function parsePageJson(raw: string): PageJsonShape {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PageJsonShape) : {};
  } catch {
    return {};
  }
}

function clusterIdsFrom(pageJson: PageJsonShape): string[] {
  return Array.isArray(pageJson.clusterIds) ? pageJson.clusterIds.filter((id): id is string => typeof id === 'string') : [];
}

function firedSignalsFrom(pageJson: PageJsonShape): string[] {
  const components = pageJson.scoreBreakdown?.components;
  if (!Array.isArray(components)) return [];
  return (components as PageJsonScoreComponent[])
    .filter((c): c is { key: string; contribution: number } => typeof c?.key === 'string' && typeof c?.contribution === 'number' && c.contribution > 0)
    .map((c) => c.key);
}

function evidenceRefIdsFrom(pageJson: PageJsonShape): string[] {
  return Array.isArray(pageJson.evidenceRefs) ? pageJson.evidenceRefs.filter((id): id is string => typeof id === 'string') : [];
}

// The primary cluster for a page is clusterIds[0] inside its page_json blob;
// there is no SQL-level join for that (it is JSON, not a column), so this
// pulls it out in application code rather than trying to express it in SQL.
function firstClusterId(pageJsonRaw: string): string | null {
  const clusterIds = clusterIdsFrom(parsePageJson(pageJsonRaw));
  return clusterIds.length > 0 ? clusterIds[0] : null;
}

interface ClusterMetricsRow {
  cluster_id: string;
  decision_reason: string | null;
  semantic_cohesion: number | null;
  serp_overlap_cohesion: number | null;
  primary_keyword_id: string | null;
  display_keyword: string | null;
  search_volume: number | null;
  main_intent: string | null;
  member_count: number;
}

// One metrics query per chunk of distinct cluster ids (chunked at 90 to stay
// under D1's 100-bound-param ceiling alongside the run_id bind -- see
// db/batch.ts). Shared by loadGraph (many clusters, one call) and
// loadPageDetail (a single cluster) so the keyword_clusters + keywords join
// lives in exactly one place.
async function fetchClusterMetrics(d1: D1Database, runId: string, clusterIds: string[]): Promise<Map<string, ClusterMetricsRow>> {
  const clusterMetrics = new Map<string, ClusterMetricsRow>();
  for (const group of chunk(clusterIds, 90)) {
    if (group.length === 0) continue;
    const placeholders = group.map(() => '?').join(', ');
    const result = await d1
      .prepare(
        `SELECT kc.id AS cluster_id, kc.decision_reason, kc.semantic_cohesion, kc.serp_overlap_cohesion,
                kc.primary_keyword_id, k.display_keyword, k.search_volume, k.main_intent,
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
  return clusterMetrics;
}

function buildGraphNode(page: BlueprintPageRow, metrics: ClusterMetricsRow | undefined): BlueprintGraphNode {
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
    supportingKeywords: parseSupportingKeywords(page.supporting_keywords_json),
  };
}

// Persisted by the publish handler as a JSON array of keyword strings
// (pp-v3, spec 3.7). Absent for pre-v3 revisions and skeleton pages;
// malformed JSON degrades to an empty list rather than failing the read.
function parseSupportingKeywords(json: string | null): string[] {
  if (json === null || json === '') return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

// Two queries total regardless of page count: all pages for the revision,
// then one metrics query per chunk of distinct first-cluster ids. Pages with
// no cluster (skeleton pages like contact) get null keyword fields and a 0
// supporting-keyword count.
export async function loadGraph(d1: D1Database, revisionId: string, runId: string): Promise<BlueprintGraphNode[]> {
  const pagesResult = await d1
    .prepare(
      `SELECT row_id, logical_page_id, parent_logical_page_id, page_type, title, slug,
              primary_keyword_normalized, recommendation, approval, priority, confidence_label, page_json,
              supporting_keywords_json
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

  const clusterMetrics = await fetchClusterMetrics(d1, runId, Array.from(clusterIdSet));

  return pages.map((page) => {
    const clusterId = primaryClusterIdByPage.get(page.row_id);
    return buildGraphNode(page, clusterId ? clusterMetrics.get(clusterId) : undefined);
  });
}

// ---------------------------------------------------------------------------
// Page detail: one page's node summary plus the evidence (cluster members,
// competitor SERP positions, FAQs) that backs its placement decision.
// ---------------------------------------------------------------------------

export interface BlueprintPageDetail {
  node: BlueprintGraphNode;
  page: {
    h1: string | null;
    metaDescription: string | null;
    decisionReason: string | null;
    firedSignals: string[];
    evidenceRefIds: string[];
    clusterIds: string[];
  };
  cluster: {
    members: { keyword: string; volume: number | null; intent: string | null }[];
    totalMembers: number;
    semanticCohesion: number | null;
    serpOverlapCohesion: number | null;
  } | null;
  competitorEvidence: { domain: string; position: number; url: string }[];
  evidenceAvailable: boolean;
  faqs: { question: string; source: string | null }[];
  fanOut: { status: 'pending_phase_5' };
}

async function loadPageRow(d1: D1Database, revisionId: string, logicalPageId: string): Promise<BlueprintPageRow> {
  const row = await d1
    .prepare(
      `SELECT row_id, logical_page_id, parent_logical_page_id, page_type, title, slug,
              primary_keyword_normalized, recommendation, approval, priority, confidence_label, page_json,
              supporting_keywords_json
       FROM blueprint_pages
       WHERE blueprint_revision_id = ?
         AND logical_page_id = ?`
    )
    .bind(revisionId, logicalPageId)
    .first<BlueprintPageRow>();
  if (!row) throw new NotFoundError(`Blueprint page not found: ${logicalPageId}`);
  return row;
}

interface ClusterMemberRow {
  display_keyword: string;
  search_volume: number | null;
  main_intent: string | null;
}

// Top-30 members by volume (SQLite has no NULLS LAST, so the null check rides
// as its own ascending sort key ahead of the descending volume) plus a
// separate unbounded COUNT for totalMembers.
async function loadClusterMembers(
  d1: D1Database,
  clusterId: string
): Promise<{ members: { keyword: string; volume: number | null; intent: string | null }[]; totalMembers: number }> {
  const membersResult = await d1
    .prepare(
      `SELECT k.display_keyword, k.search_volume, k.main_intent
       FROM cluster_keywords ck
       JOIN keywords k ON k.id = ck.keyword_id
       WHERE ck.cluster_id = ?
       ORDER BY (k.search_volume IS NULL) ASC, k.search_volume DESC, k.normalized_keyword ASC
       LIMIT 30`
    )
    .bind(clusterId)
    .all<ClusterMemberRow>();

  const countRow = await d1
    .prepare(`SELECT COUNT(*) AS total FROM cluster_keywords WHERE cluster_id = ?`)
    .bind(clusterId)
    .first<{ total: number }>();

  return {
    members: membersResult.results.map((row) => ({
      keyword: row.display_keyword,
      volume: row.search_volume,
      intent: row.main_intent,
    })),
    totalMembers: countRow?.total ?? 0,
  };
}

// Mirrors the ParsedOrganicItem shape providers/dataforseo/serp.ts actually
// writes into serp_snapshots.organic_json (`rank`, not `position` or
// `rank_absolute`; see parseSerpPayload in that file).
interface OrganicItem {
  rank: number | null;
  url: string | null;
  title: string | null;
  domain: string | null;
}

// Finds the primary keyword's most recent SERP snapshot, filters its organic
// results to the run's selected competitors, and reports position (`rank`)
// ascending. Returns evidenceAvailable: false only when no snapshot exists at
// all -- a snapshot with zero matching competitor domains still counts as
// "evidence was collected", just with nothing to show.
async function loadCompetitorEvidence(
  d1: D1Database,
  runId: string,
  primaryKeywordId: string | null
): Promise<{ competitorEvidence: { domain: string; position: number; url: string }[]; evidenceAvailable: boolean }> {
  if (!primaryKeywordId) return { competitorEvidence: [], evidenceAvailable: false };

  const snapshot = await d1
    .prepare(`SELECT organic_json FROM serp_snapshots WHERE run_id = ? AND keyword_id = ? ORDER BY id ASC LIMIT 1`)
    .bind(runId, primaryKeywordId)
    .first<{ organic_json: string | null }>();
  if (!snapshot) return { competitorEvidence: [], evidenceAvailable: false };

  let organic: OrganicItem[];
  try {
    const parsed = JSON.parse(snapshot.organic_json ?? '[]');
    organic = Array.isArray(parsed) ? parsed : [];
  } catch {
    organic = [];
  }

  const competitorsResult = await d1
    .prepare(`SELECT domain FROM competitors WHERE run_id = ? AND selected = 1`)
    .bind(runId)
    .all<{ domain: string }>();
  const selectedDomains = new Set(competitorsResult.results.map((row) => row.domain));

  const competitorEvidence: { domain: string; position: number; url: string }[] = [];
  for (const item of organic) {
    if (typeof item?.domain !== 'string' || !selectedDomains.has(item.domain)) continue;
    if (typeof item.rank !== 'number' || typeof item.url !== 'string') continue;
    competitorEvidence.push({ domain: item.domain, position: item.rank, url: item.url });
  }
  competitorEvidence.sort((a, b) => a.position - b.position);

  return { competitorEvidence, evidenceAvailable: true };
}

interface FaqRow {
  id: string;
  question: string;
  source_title: string | null;
  source_url: string | null;
}

// faq_evidence has no direct keyword/query column: it links to serp_snapshots
// via serp_snapshot_id, and serp_snapshots carries keyword_id (see
// db/schema.sql). Scoping FAQs to a cluster therefore means: cluster's member
// keyword ids -> snapshots for those keywords in this run -> their FAQs.
// Chunked at 90 keyword ids to leave room for the run_id bind under D1's
// 100-bound-param ceiling; results across chunks are merged and re-sorted by
// id before the top-10 cap since per-chunk LIMITs can't be combined safely.
async function loadClusterFaqs(d1: D1Database, runId: string, clusterId: string): Promise<{ question: string; source: string | null }[]> {
  const keywordIdsResult = await d1
    .prepare(`SELECT keyword_id FROM cluster_keywords WHERE cluster_id = ?`)
    .bind(clusterId)
    .all<{ keyword_id: string }>();
  const keywordIds = keywordIdsResult.results.map((row) => row.keyword_id);
  if (keywordIds.length === 0) return [];

  const rows: FaqRow[] = [];
  for (const group of chunk(keywordIds, 90)) {
    if (group.length === 0) continue;
    const placeholders = group.map(() => '?').join(', ');
    const result = await d1
      .prepare(
        `SELECT fe.id AS id, fe.question AS question, fe.source_title AS source_title, fe.source_url AS source_url
         FROM faq_evidence fe
         JOIN serp_snapshots ss ON ss.id = fe.serp_snapshot_id
         WHERE ss.run_id = ?
           AND ss.keyword_id IN (${placeholders})`
      )
      .bind(runId, ...group)
      .all<FaqRow>();
    rows.push(...result.results);
  }

  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return rows.slice(0, 10).map((row) => ({
    question: row.question,
    source: row.source_title ?? row.source_url ?? null,
  }));
}

// Composes one page's node summary with the evidence backing its placement:
// cluster members + cohesion scores, competitor SERP positions, and FAQs.
// fanOut is always the Phase 5 placeholder status -- fan-out query generation
// does not exist yet.
export async function loadPageDetail(
  d1: D1Database,
  revisionId: string,
  runId: string,
  logicalPageId: string
): Promise<BlueprintPageDetail> {
  const pageRow = await loadPageRow(d1, revisionId, logicalPageId);
  const pageJson = parsePageJson(pageRow.page_json);
  const clusterIds = clusterIdsFrom(pageJson);
  const primaryClusterId = clusterIds.length > 0 ? clusterIds[0] : null;

  const clusterMetrics = primaryClusterId ? await fetchClusterMetrics(d1, runId, [primaryClusterId]) : new Map<string, ClusterMetricsRow>();
  const metrics = primaryClusterId ? clusterMetrics.get(primaryClusterId) : undefined;

  const node = buildGraphNode(pageRow, metrics);

  let cluster: BlueprintPageDetail['cluster'] = null;
  let competitorEvidence: BlueprintPageDetail['competitorEvidence'] = [];
  let evidenceAvailable = false;
  let faqs: BlueprintPageDetail['faqs'] = [];

  if (primaryClusterId) {
    const { members, totalMembers } = await loadClusterMembers(d1, primaryClusterId);
    cluster = {
      members,
      totalMembers,
      semanticCohesion: metrics?.semantic_cohesion ?? null,
      serpOverlapCohesion: metrics?.serp_overlap_cohesion ?? null,
    };

    const evidence = await loadCompetitorEvidence(d1, runId, metrics?.primary_keyword_id ?? null);
    competitorEvidence = evidence.competitorEvidence;
    evidenceAvailable = evidence.evidenceAvailable;

    faqs = await loadClusterFaqs(d1, runId, primaryClusterId);
  }

  return {
    node,
    page: {
      h1: typeof pageJson.h1 === 'string' ? pageJson.h1 : null,
      metaDescription: typeof pageJson.metaDescription === 'string' ? pageJson.metaDescription : null,
      decisionReason: metrics?.decision_reason ?? null,
      firedSignals: firedSignalsFrom(pageJson),
      evidenceRefIds: evidenceRefIdsFrom(pageJson),
      clusterIds,
    },
    cluster,
    competitorEvidence,
    evidenceAvailable,
    faqs,
    fanOut: { status: 'pending_phase_5' },
  };
}
