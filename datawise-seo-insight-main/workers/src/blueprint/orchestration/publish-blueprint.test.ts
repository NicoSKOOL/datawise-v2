import { describe, it, expect } from 'vitest';
import { fakeEnv } from '../test-support/env';
import { newId, nowIso } from '../db/util';
import { publishBlueprintHandler } from './handlers';
import type { StageContext } from './handlers';
import type { BlueprintProviderEnv } from './process-run';
import type { NormalizedProjectBrief } from '../contracts/types';
import type { PlannedPage } from '../domain/page-plan/types';
import type { OverlayResult } from '../domain/validate/compose';

// Stage 19 publish_blueprint materialization tests (Phase 4 Task 20). These
// drive the real publishBlueprintHandler over a seeded page-plan.json (+ optional
// overlay.json), the same artifacts stages 15/16 write, and assert the version /
// revision / blueprint_pages rows it produces. The idempotency + lease-race path
// (reuse the winner's version/revision, re-insert pages as no-ops) is exercised
// by publishing the same run twice: sequential re-invocation hits the exact
// reuse branches a concurrent lease race hits (INSERT fails on UNIQUE -> reuse).

interface PageRow {
  row_id: string;
  logical_page_id: string;
  parent_logical_page_id: string | null;
  page_type: string;
  title: string;
  slug: string;
  primary_keyword_normalized: string | null;
  recommendation: string;
  approval: string;
  consolidate_target_logical_page_id: string | null;
  confidence_label: string | null;
  page_json: string;
}

interface VersionRow {
  id: string;
  schema_version: string;
  ruleset_version: string;
  completeness: string;
  summary_json: string;
  latest_revision_id: string | null;
}

interface RevisionRow {
  id: string;
  revision_number: number;
  revision_hash: string;
}

function plannedPage(over: Partial<PlannedPage> & { logicalId: string }): PlannedPage {
  return {
    logicalId: over.logicalId,
    pageType: over.pageType ?? 'service',
    slug: over.slug ?? over.logicalId,
    title: over.title ?? over.logicalId,
    h1: over.h1 ?? `${over.logicalId} h1`,
    parentLogicalId: over.parentLogicalId ?? null,
    primaryKeywordId: over.primaryKeywordId ?? null,
    primaryKeyword: over.primaryKeyword ?? null,
    clusterIds: over.clusterIds ?? [],
    sections: over.sections ?? [],
    metaDescription: over.metaDescription ?? null,
    recommendation: over.recommendation ?? 'create',
    consolidateTargetLogicalId: over.consolidateTargetLogicalId ?? null,
    scores: over.scores ?? { addressableVolume: null, confidence: null, scoreBreakdown: null, evidenceRefs: [] },
    warnings: over.warnings ?? [],
  };
}

// A three-page plan: a skeleton home + two dedicated service pages with distinct
// addressable volumes, so ordering (skeleton first, then volume DESC) is testable.
function samplePlan(): PlannedPage[] {
  return [
    plannedPage({ logicalId: 'svc-drain', pageType: 'service', slug: 'drain-cleaning', title: 'Drain Cleaning', h1: 'Drain Cleaning', primaryKeyword: 'drain cleaning', primaryKeywordId: 'kw2', clusterIds: ['c2'], scores: { addressableVolume: 300, confidence: 'medium', scoreBreakdown: null, evidenceRefs: ['ev2'] } }),
    plannedPage({ logicalId: 'home', pageType: 'home', slug: 'home', title: 'Home', h1: 'Home' }),
    plannedPage({ logicalId: 'svc-emergency', pageType: 'service', slug: 'emergency-plumbing', title: 'Emergency Plumbing', h1: 'Emergency Plumbing', primaryKeyword: 'emergency plumbing', primaryKeywordId: 'kw1', clusterIds: ['c1'], scores: { addressableVolume: 500, confidence: 'high', scoreBreakdown: null, evidenceRefs: ['ev1'] } }),
  ];
}

function samplePlanArtifact(pages: PlannedPage[], totalAddressableVolume: number | null): string {
  return JSON.stringify({
    pages,
    warnings: [],
    stats: {
      pageCount: pages.length, skeletonPageCount: 1, dedicatedPageCount: pages.length - 1,
      sectionCount: 0, faqCount: 0, clustersPlaced: pages.length - 1, demotedPageCount: 0,
      cannibalizedCount: 0, serviceLocationBlockedCount: 0, totalAddressableVolume, pageBudget: 30,
    },
  });
}

function sampleOverlay(): OverlayResult {
  return {
    plannedPages: [
      { logicalId: 'home', recommendation: 'keep', matchedUrl: 'https://site.com/', matchScore: 0.9 },
      { logicalId: 'svc-emergency', recommendation: 'update', matchedUrl: 'https://site.com/emergency', matchScore: 0.7 },
      // svc-drain absent -> defaults to 'create'.
    ],
    consolidations: [
      { existingUrl: 'https://site.com/old-emergency', consolidateTargetLogicalId: 'svc-emergency', matchScore: 0.4 },
    ],
  };
}

async function seedProjectAndRun(d1: D1Database): Promise<{ projectId: string; runId: string }> {
  const projectId = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, 'org1', 'u1', 'Aqua Plumbing', 'existing_site', 'US', 'en', ?, ?)`
    )
    .bind(projectId, nowIso(), nowIso())
    .run();
  const runId = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status,
         dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, 'briefv1', 'estimate1', 'running', 2000000, 0, 'u1', ?)`
    )
    .bind(runId, projectId, nowIso())
    .run();
  return { projectId, runId };
}

// Writes a completed validate_blueprint stage row so publish can read its
// warningCount for summary_json (mirrors the real pipeline order).
async function seedValidateOutput(d1: D1Database, runId: string, warningCount: number): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, required, attempt_count, output_json, finished_at)
       VALUES (?, ?, 'validate_blueprint', ?, 'succeeded', 1, 1, ?, ?)`
    )
    .bind(newId('stagerun'), runId, newId('h'), JSON.stringify({ stage: 'validate_blueprint', warningCount }), nowIso())
    .run();
}

function makeCtx(env: BlueprintProviderEnv & { BLUEPRINT_DB: D1Database }, projectId: string, runId: string): StageContext {
  return {
    env,
    d1: env.BLUEPRINT_DB,
    runId,
    projectId,
    briefVersionId: 'briefv1',
    normalizedBrief: {} as unknown as NormalizedProjectBrief,
    stage: 'publish_blueprint',
    attempt: 1,
  };
}

async function getPages(d1: D1Database, revisionId: string): Promise<PageRow[]> {
  const res = await d1
    .prepare(`SELECT * FROM blueprint_pages WHERE blueprint_revision_id = ? ORDER BY logical_page_id ASC`)
    .bind(revisionId)
    .all<PageRow>();
  return res.results;
}

describe('publishBlueprintHandler materialization', () => {
  it('materializes one blueprint_pages row per composed page with folded recommendations, consolidate targets, and page_json', async () => {
    const env = fakeEnv();
    const d1 = env.BLUEPRINT_DB;
    const { projectId, runId } = await seedProjectAndRun(d1);
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${runId}/page-plan.json`, samplePlanArtifact(samplePlan(), 800));
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${runId}/overlay.json`, JSON.stringify(sampleOverlay()));
    await seedValidateOutput(d1, runId, 2);

    const result = await publishBlueprintHandler(makeCtx(env, projectId, runId));
    expect(result.status).toBe('succeeded');
    const out = result.output as { versionId: string; revisionId: string; pageCount: number };
    expect(out.pageCount).toBe(3);

    const version = await d1.prepare(`SELECT * FROM blueprint_versions WHERE run_id = ?`).bind(runId).first<VersionRow>();
    expect(version).toBeTruthy();
    expect(version!.schema_version).toBe('p4');
    expect(version!.ruleset_version).toBe('cluster-v2+pp-v2');
    expect(version!.completeness).toBe('complete');

    const revision = await d1.prepare(`SELECT * FROM blueprint_revisions WHERE blueprint_version_id = ?`).bind(version!.id).first<RevisionRow>();
    expect(revision!.revision_number).toBe(1);
    expect(revision!.revision_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(version!.latest_revision_id).toBe(revision!.id);

    const pages = await getPages(d1, revision!.id);
    expect(pages.length).toBe(3);
    const byId = Object.fromEntries(pages.map((p) => [p.logical_page_id, p]));

    // Recommendations folded from the overlay.
    expect(byId['home'].recommendation).toBe('keep');
    expect(byId['svc-emergency'].recommendation).toBe('update');
    expect(byId['svc-drain'].recommendation).toBe('create');
    // Every page is 'proposed' on a fresh publish.
    for (const p of pages) expect(p.approval).toBe('proposed');
    // No page is recommendation 'consolidate' (consolidation is url-level), so
    // consolidate_target is null on all of them (CHECK is satisfied).
    for (const p of pages) expect(p.consolidate_target_logical_page_id).toBeNull();

    // Skeleton home has no primary keyword; dedicated pages carry theirs.
    expect(byId['home'].primary_keyword_normalized).toBeNull();
    expect(byId['svc-emergency'].primary_keyword_normalized).toBe('emergency plumbing');
    expect(byId['svc-emergency'].confidence_label).toBe('high');

    // page_json carries the full detail + a deterministic 0-based order index:
    // skeleton first (home order 0), then dedicated by volume DESC
    // (svc-emergency 500 -> order 1, svc-drain 300 -> order 2).
    expect(JSON.parse(byId['home'].page_json).order).toBe(0);
    expect(JSON.parse(byId['svc-emergency'].page_json).order).toBe(1);
    expect(JSON.parse(byId['svc-drain'].page_json).order).toBe(2);
    const emJson = JSON.parse(byId['svc-emergency'].page_json);
    expect(emJson.h1).toBe('Emergency Plumbing');
    expect(emJson.addressableVolume).toBe(500);
    expect(emJson.evidenceRefs).toEqual(['ev1']);
    expect(emJson.overlay).toEqual({ matchedUrl: 'https://site.com/emergency', matchScore: 0.7 });

    // Unique slugs + unique non-null primary keywords across the revision.
    const slugs = pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const kws = pages.map((p) => p.primary_keyword_normalized).filter((k): k is string => k !== null);
    expect(new Set(kws).size).toBe(kws.length);
  });

  it('populates summary_json with real counts (recommendation, page type, single-count demand, warnings)', async () => {
    const env = fakeEnv();
    const d1 = env.BLUEPRINT_DB;
    const { projectId, runId } = await seedProjectAndRun(d1);
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${runId}/page-plan.json`, samplePlanArtifact(samplePlan(), 800));
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${runId}/overlay.json`, JSON.stringify(sampleOverlay()));
    await seedValidateOutput(d1, runId, 2);

    await publishBlueprintHandler(makeCtx(env, projectId, runId));
    const version = await d1.prepare(`SELECT summary_json FROM blueprint_versions WHERE run_id = ?`).bind(runId).first<{ summary_json: string }>();
    const summary = JSON.parse(version!.summary_json);
    expect(summary.pageCount).toBe(3);
    expect(summary.byRecommendation).toEqual({ keep: 1, update: 1, create: 1, consolidate: 1 });
    expect(summary.byPageType).toEqual({ home: 1, service: 2 });
    expect(summary.addressableDemandTotal).toBe(800);
    expect(summary.warningCount).toBe(2);
    expect(summary.partialStages).toEqual([]);
  });

  it('defaults every page to create when no overlay artifact exists (greenfield)', async () => {
    const env = fakeEnv();
    const d1 = env.BLUEPRINT_DB;
    const { projectId, runId } = await seedProjectAndRun(d1);
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${runId}/page-plan.json`, samplePlanArtifact(samplePlan(), 800));
    // No overlay.json, no validate output row.

    const result = await publishBlueprintHandler(makeCtx(env, projectId, runId));
    const out = result.output as { revisionId: string };
    const pages = await getPages(d1, out.revisionId);
    expect(pages.length).toBe(3);
    for (const p of pages) expect(p.recommendation).toBe('create');
    const version = await d1.prepare(`SELECT summary_json FROM blueprint_versions WHERE run_id = ?`).bind(runId).first<{ summary_json: string }>();
    const summary = JSON.parse(version!.summary_json);
    expect(summary.byRecommendation).toEqual({ keep: 0, update: 0, create: 3, consolidate: 0 });
    // No validate output row -> warningCount defaults to 0.
    expect(summary.warningCount).toBe(0);
  });

  it('is idempotent under replay / lease race: publishing the same run twice yields one page set, no duplicate rows, no error', async () => {
    const env = fakeEnv();
    const d1 = env.BLUEPRINT_DB;
    const { projectId, runId } = await seedProjectAndRun(d1);
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${runId}/page-plan.json`, samplePlanArtifact(samplePlan(), 800));
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${runId}/overlay.json`, JSON.stringify(sampleOverlay()));

    const first = await publishBlueprintHandler(makeCtx(env, projectId, runId));
    const firstOut = first.output as { versionId: string; revisionId: string };
    // Second invocation hits the UNIQUE(run_id) + UNIQUE(version,revision_number)
    // reuse branches (the same path a concurrent lease-race loser takes) and the
    // INSERT OR IGNORE page writes become no-ops.
    const second = await publishBlueprintHandler(makeCtx(env, projectId, runId));
    const secondOut = second.output as { versionId: string; revisionId: string };

    expect(secondOut.versionId).toBe(firstOut.versionId);
    expect(secondOut.revisionId).toBe(firstOut.revisionId);

    const versionCount = await d1.prepare(`SELECT COUNT(*) AS n FROM blueprint_versions WHERE run_id = ?`).bind(runId).first<{ n: number }>();
    expect(versionCount!.n).toBe(1);
    const revisionCount = await d1.prepare(`SELECT COUNT(*) AS n FROM blueprint_revisions WHERE blueprint_version_id = ?`).bind(firstOut.versionId).first<{ n: number }>();
    expect(revisionCount!.n).toBe(1);
    const pages = await getPages(d1, firstOut.revisionId);
    expect(pages.length).toBe(3);
  });

  it('revision_hash reflects the page set: stable on replay, different when the plan differs', async () => {
    const env = fakeEnv();
    const d1 = env.BLUEPRINT_DB;

    // Run A with the sample plan.
    const a = await seedProjectAndRun(d1);
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${a.runId}/page-plan.json`, samplePlanArtifact(samplePlan(), 800));
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${a.runId}/overlay.json`, JSON.stringify(sampleOverlay()));
    const ra = await publishBlueprintHandler(makeCtx(env, a.projectId, a.runId));
    const hashA1 = (await d1.prepare(`SELECT revision_hash FROM blueprint_revisions WHERE id = ?`).bind((ra.output as { revisionId: string }).revisionId).first<{ revision_hash: string }>())!.revision_hash;

    // Replay run A -> same hash.
    await publishBlueprintHandler(makeCtx(env, a.projectId, a.runId));
    const hashA2 = (await d1.prepare(`SELECT revision_hash FROM blueprint_revisions WHERE blueprint_version_id = (SELECT id FROM blueprint_versions WHERE run_id = ?)`).bind(a.runId).first<{ revision_hash: string }>())!.revision_hash;
    expect(hashA2).toBe(hashA1);

    // Run B with an extra page -> a different page set -> a different hash.
    const b = await seedProjectAndRun(d1);
    const planB = [...samplePlan(), plannedPage({ logicalId: 'svc-extra', pageType: 'service', slug: 'extra', primaryKeyword: 'extra kw', clusterIds: ['c3'], scores: { addressableVolume: 100, confidence: 'low', scoreBreakdown: null, evidenceRefs: [] } })];
    await env.BLUEPRINT_ARTIFACTS.put(`runs/${b.runId}/page-plan.json`, samplePlanArtifact(planB, 900));
    const rb = await publishBlueprintHandler(makeCtx(env, b.projectId, b.runId));
    const hashB = (await d1.prepare(`SELECT revision_hash FROM blueprint_revisions WHERE id = ?`).bind((rb.output as { revisionId: string }).revisionId).first<{ revision_hash: string }>())!.revision_hash;
    expect(hashB).not.toBe(hashA1);
  });

  it('throws internal_error when the page-plan artifact is missing (never publishes an empty blueprint silently)', async () => {
    const env = fakeEnv();
    const d1 = env.BLUEPRINT_DB;
    const { projectId, runId } = await seedProjectAndRun(d1);
    // No page-plan.json written.
    await expect(publishBlueprintHandler(makeCtx(env, projectId, runId))).rejects.toThrow();
    const versionCount = await d1.prepare(`SELECT COUNT(*) AS n FROM blueprint_versions WHERE run_id = ?`).bind(runId).first<{ n: number }>();
    expect(versionCount!.n).toBe(0);
  });
});
