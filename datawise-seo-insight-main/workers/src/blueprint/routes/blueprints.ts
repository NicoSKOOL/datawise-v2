// Read-only Blueprint Canvas UI endpoints: the latest published version for
// a project, the page graph for a revision, single-page detail, and the
// full html/csv export. Every handler is thin, ownership resolution and
// data assembly both live in db/blueprint-reads.ts; errors propagate to
// router.ts's failFrom.
import type { Actor } from '../db/access';
import type { BlueprintQueueEnv } from '../orchestration/process-run';
import {
  loadLatestBlueprint,
  loadRevisionOwned,
  loadGraph,
  loadPageDetail,
  loadVersionForRevision,
  type BlueprintGraphNode,
} from '../db/blueprint-reads';
import { ok } from './envelope';
import { chunk } from '../db/batch';
import { BlueprintApiError, NotFoundError } from '../domain/api-errors';
import { buildBlueprintCsv, type CsvPageRow } from '../exports/report-csv';
import { renderBlueprintReportHtml, type BlueprintReportFacts } from '../exports/report-html';

export async function getLatestBlueprint(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const view = await loadLatestBlueprint(env.BLUEPRINT_DB, actor, params.id);
  return ok(view);
}

export async function getBlueprintGraph(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const { revisionId, runId } = await loadRevisionOwned(env.BLUEPRINT_DB, actor, params.id);
  const nodes = await loadGraph(env.BLUEPRINT_DB, revisionId, runId);
  return ok({ revisionId, nodes });
}

export async function getBlueprintPage(
  _request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const { revisionId, runId } = await loadRevisionOwned(env.BLUEPRINT_DB, actor, params.id);
  const detail = await loadPageDetail(env.BLUEPRINT_DB, revisionId, runId, params.pageId);
  return ok(detail);
}

// ---------------------------------------------------------------------------
// Export: the same revision rendered as a standalone html report or a flat
// csv of the page table, for a human to download and share outside the app.
// ---------------------------------------------------------------------------

const EXPORT_FORMATS = new Set(['html', 'csv']);

interface PageJsonRow {
  logical_page_id: string;
  page_json: string;
}

function firstClusterIdFromPageJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    const clusterIds = parsed && typeof parsed === 'object' && Array.isArray(parsed.clusterIds) ? parsed.clusterIds : [];
    return typeof clusterIds[0] === 'string' ? clusterIds[0] : null;
  } catch {
    return null;
  }
}

// Lighter-weight decision-reason lookup for the csv export: avoids calling
// loadPageDetail (full evidence composition -- cluster members, competitor
// SERP, FAQs) for every page just to read one column. Mirrors the
// clusterIds[0] convention documented in db/blueprint-reads.ts's
// firstClusterId, chunked at 90 cluster ids to stay under D1's
// 100-bound-param ceiling alongside the run_id bind (see db/batch.ts).
async function loadDecisionReasonsByPage(
  d1: D1Database,
  revisionId: string,
  runId: string
): Promise<Map<string, string | null>> {
  const pagesResult = await d1
    .prepare(`SELECT logical_page_id, page_json FROM blueprint_pages WHERE blueprint_revision_id = ?`)
    .bind(revisionId)
    .all<PageJsonRow>();

  const clusterIdByPage = new Map<string, string>();
  const clusterIdSet = new Set<string>();
  for (const row of pagesResult.results) {
    const clusterId = firstClusterIdFromPageJson(row.page_json);
    if (clusterId) {
      clusterIdByPage.set(row.logical_page_id, clusterId);
      clusterIdSet.add(clusterId);
    }
  }

  const decisionReasonByCluster = new Map<string, string | null>();
  for (const group of chunk(Array.from(clusterIdSet), 90)) {
    if (group.length === 0) continue;
    const placeholders = group.map(() => '?').join(', ');
    const result = await d1
      .prepare(`SELECT id, decision_reason FROM keyword_clusters WHERE run_id = ? AND id IN (${placeholders})`)
      .bind(runId, ...group)
      .all<{ id: string; decision_reason: string | null }>();
    for (const row of result.results) {
      decisionReasonByCluster.set(row.id, row.decision_reason);
    }
  }

  const decisionReasonByPage = new Map<string, string | null>();
  for (const [pageId, clusterId] of clusterIdByPage) {
    decisionReasonByPage.set(pageId, decisionReasonByCluster.get(clusterId) ?? null);
  }
  return decisionReasonByPage;
}

function buildCsvRows(nodes: BlueprintGraphNode[], decisionReasonByPage: Map<string, string | null>): CsvPageRow[] {
  const slugByPageId = new Map(nodes.map((node) => [node.logicalPageId, node.slug]));
  return nodes.map((node) => ({
    ...node,
    parentSlug: node.parentLogicalPageId ? slugByPageId.get(node.parentLogicalPageId) ?? null : null,
    decisionReason: decisionReasonByPage.get(node.logicalPageId) ?? null,
  }));
}

export async function exportBlueprint(
  request: Request,
  env: BlueprintQueueEnv,
  actor: Actor,
  params: Record<string, string>
): Promise<Response> {
  const format = new URL(request.url).searchParams.get('format') ?? 'html';
  if (!EXPORT_FORMATS.has(format)) {
    throw new BlueprintApiError('invalid_input', `Unsupported export format: ${format}`);
  }

  const { revisionId, projectId, runId } = await loadRevisionOwned(env.BLUEPRINT_DB, actor, params.id);
  const nodes = await loadGraph(env.BLUEPRINT_DB, revisionId, runId);

  if (format === 'csv') {
    const decisionReasonByPage = await loadDecisionReasonsByPage(env.BLUEPRINT_DB, revisionId, runId);
    const rows = buildCsvRows(nodes, decisionReasonByPage);
    const csv = buildBlueprintCsv(rows);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="blueprint-${projectId}.csv"`,
      },
    });
  }

  const projectRow = await env.BLUEPRINT_DB
    .prepare('SELECT name FROM projects WHERE id = ?')
    .bind(projectId)
    .first<{ name: string }>();
  if (!projectRow) throw new NotFoundError(`Project not found: ${projectId}`);

  const latest = await loadVersionForRevision(env.BLUEPRINT_DB, revisionId);

  // Sequential, not parallel: 30-150 local D1 reads, matching the brief.
  const detailByPageId = new Map<string, Awaited<ReturnType<typeof loadPageDetail>>>();
  for (const node of nodes) {
    const detail = await loadPageDetail(env.BLUEPRINT_DB, revisionId, runId, node.logicalPageId);
    detailByPageId.set(node.logicalPageId, detail);
  }

  const facts: BlueprintReportFacts = {
    projectName: projectRow.name,
    generatedAt: new Date().toISOString(),
    latest,
    nodes,
    detailByPageId,
  };

  const html = renderBlueprintReportHtml(facts);
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
