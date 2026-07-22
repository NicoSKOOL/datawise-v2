import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import type { StageContext } from './handlers';
import { STAGE_HANDLERS } from './handlers';
import { validateBlueprintHandler, type ValidateBlueprintOutput } from './page-plan-handlers';
import { stageMeta } from './stages';
import { BlueprintValidationError } from '../domain/errors';
import { BlueprintApiError } from '../domain/api-errors';
import type { NormalizedProjectBrief } from '../contracts/types';
import type { PlannedPage } from '../domain/page-plan/types';

// ---------- seeds ----------

async function seedProject(d1: D1Database, mode: 'existing_site' | 'greenfield' = 'existing_site'): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, 'org1', 'u1', 'Test', ?, 'US', 'en', ?, ?)`
    )
    .bind(id, mode, nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, 'brief1', 'est1', 'running', 100000000, 0, 'u1', ?)`
    )
    .bind(id, projectId, nowIso())
    .run();
  return id;
}

// Seeds a terminal stage row so loadGapStageNames sees an upstream gap.
async function seedGapStage(d1: D1Database, runId: string, stage: string, status: 'skipped' | 'partial', required = 0): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO research_stage_runs (id, run_id, stage_name, stage_input_hash, status, required, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(newId('rsr'), runId, stage, `h-${newId('h')}`, status, required, nowIso())
    .run();
}

function plannedPage(overrides: Partial<PlannedPage> & { logicalId: string }): PlannedPage {
  return {
    logicalId: overrides.logicalId,
    pageType: overrides.pageType ?? 'service',
    slug: overrides.slug ?? overrides.logicalId,
    title: overrides.title ?? overrides.logicalId,
    h1: overrides.h1 ?? overrides.logicalId,
    parentLogicalId: overrides.parentLogicalId ?? null,
    primaryKeywordId: overrides.primaryKeywordId ?? null,
    primaryKeyword: overrides.primaryKeyword ?? null,
    clusterIds: overrides.clusterIds ?? [],
    sections: overrides.sections ?? [],
    metaDescription: overrides.metaDescription ?? null,
    recommendation: overrides.recommendation ?? 'create',
    consolidateTargetLogicalId: overrides.consolidateTargetLogicalId ?? null,
    scores: overrides.scores ?? { addressableVolume: null, confidence: null, scoreBreakdown: null, evidenceRefs: ['ev1'] },
    warnings: overrides.warnings ?? [],
  };
}

function pagePlanArtifact(pages: PlannedPage[], extra: { warnings?: any[]; pageBudget?: number; totalAddressableVolume?: number | null } = {}): string {
  return JSON.stringify({
    rulesetVersion: 'pp-v2',
    pages,
    placements: [],
    warnings: extra.warnings ?? [],
    stats: {
      pageCount: pages.length,
      skeletonPageCount: 0,
      dedicatedPageCount: 0,
      sectionCount: 0,
      faqCount: 0,
      clustersPlaced: 0,
      demotedPageCount: 0,
      cannibalizedCount: 0,
      serviceLocationBlockedCount: 0,
      totalAddressableVolume: extra.totalAddressableVolume ?? 1234,
      pageBudget: extra.pageBudget ?? 30,
    },
  });
}

function brief(overrides: Partial<NormalizedProjectBrief> = {}): NormalizedProjectBrief {
  return {
    mode: 'existing_site',
    businessName: 'Acme Plumbing',
    normalizedBusinessName: 'acme plumbing',
    category: 'plumber',
    websiteDomain: 'acme.com',
    websiteUrl: 'https://acme.com',
    countryIso: 'US',
    languageCode: 'en',
    services: [],
    serviceAreas: [],
    targetCustomers: [],
    differentiators: [],
    excludedDomains: [],
    excludedTopics: [],
    knownCompetitorDomains: [],
    goals: [],
    maxRecommendedPages: 30,
    enableUsFanout: false,
    inputHash: 'hash1',
    ...overrides,
  } as NormalizedProjectBrief;
}

function buildCtx(
  d1: D1Database,
  projectId: string,
  runId: string,
  normalizedBrief: NormalizedProjectBrief
): { ctx: StageContext; artifacts: Map<string, string> } {
  const kv = new Map<string, string>();
  const artifacts = new Map<string, string>();
  const env = {
    BLUEPRINT_DB: d1,
    KV: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      delete: async (k: string) => void kv.delete(k),
    } as unknown as KVNamespace,
    BLUEPRINT_ARTIFACTS: {
      put: async (k: string, v: string) => void artifacts.set(k, v),
      get: async (k: string) => (artifacts.has(k) ? { text: async () => artifacts.get(k)! } : null),
    } as unknown as R2Bucket,
    DATAFORSEO_EMAIL: 'test@example.com',
    DATAFORSEO_PASSWORD: 'test-password',
  };
  const ctx = {
    env: env as any,
    d1,
    runId,
    projectId,
    briefVersionId: 'brief1',
    normalizedBrief,
    stage: 'validate_blueprint',
    attempt: 1,
  } as StageContext;
  return { ctx, artifacts };
}

// A small valid two-page plan (root + one factual child with evidence).
function validPlan(): PlannedPage[] {
  return [
    plannedPage({ logicalId: 'home', pageType: 'home', slug: 'home', parentLogicalId: null, scores: { addressableVolume: null, confidence: null, scoreBreakdown: null, evidenceRefs: [] } }),
    plannedPage({ logicalId: 'svc_drain', pageType: 'service', slug: 'drain-cleaning', parentLogicalId: 'home', primaryKeyword: 'drain cleaning', clusterIds: ['c1'] }),
  ];
}

// ---------- registration ----------

describe('validate_blueprint registration', () => {
  it('is wired into STAGE_HANDLERS (stub replaced) and IS a required stage', () => {
    expect(STAGE_HANDLERS.validate_blueprint).toBe(validateBlueprintHandler);
    expect(stageMeta('validate_blueprint').required).toBe(true);
  });
});

// ---------- handler ----------

describe('validateBlueprintHandler', () => {
  it('succeeds on a valid plan, folding overlay recommendations into byRecommendation', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    artifacts.set(`runs/${runId}/page-plan.json`, pagePlanArtifact(validPlan(), { totalAddressableVolume: 4321 }));
    artifacts.set(
      `runs/${runId}/overlay.json`,
      JSON.stringify({
        rulesetVersion: 'pp-v2',
        plannedPages: [
          { logicalId: 'home', recommendation: 'create', matchedUrl: null, matchScore: null },
          { logicalId: 'svc_drain', recommendation: 'keep', matchedUrl: 'https://acme.com/drain-cleaning', matchScore: 0.9 },
        ],
        consolidations: [{ existingUrl: 'https://acme.com/old-drain', consolidateTargetLogicalId: 'svc_drain', matchScore: 0.5 }],
      })
    );

    const { output, status } = (await validateBlueprintHandler(ctx)) as { output: ValidateBlueprintOutput; status: string };
    expect(status).toBe('succeeded');
    expect(output.blockingCount).toBe(0);
    expect(output.pageCount).toBe(2);
    expect(output.byRecommendation).toEqual({ keep: 1, update: 0, create: 1, consolidate: 1 });
    expect(output.addressableDemandTotal).toBe(4321);
    expect(output.rulesetVersion).toBe('pp-v2');
    expect(output.warnings).toEqual([]);
  });

  it('throws BlueprintValidationError (permanent) on a blocking violation, so an invalid blueprint never publishes', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief());
    // Two active pages share a slug -> validateBlueprintGraph duplicate_slug (blocking).
    const pages = [
      plannedPage({ logicalId: 'home', pageType: 'home', slug: 'dup', parentLogicalId: null, scores: { addressableVolume: null, confidence: null, scoreBreakdown: null, evidenceRefs: [] } }),
      plannedPage({ logicalId: 'svc', slug: 'dup', parentLogicalId: 'home', primaryKeyword: 'k' }),
    ];
    artifacts.set(`runs/${runId}/page-plan.json`, pagePlanArtifact(pages));

    const err = await validateBlueprintHandler(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintValidationError);
    expect((err as BlueprintValidationError).code).toBe('invalid_input');
    expect((err as BlueprintValidationError).fieldErrors[0].message).toContain('graph_duplicate_slug');
  });

  it('handles an absent overlay: existing-site brief -> all create + overlay_absent warning', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief({ mode: 'existing_site' }));
    artifacts.set(`runs/${runId}/page-plan.json`, pagePlanArtifact(validPlan()));
    // No overlay.json written.

    const { output, status } = (await validateBlueprintHandler(ctx)) as { output: ValidateBlueprintOutput; status: string };
    expect(status).toBe('succeeded');
    expect(output.byRecommendation).toEqual({ keep: 0, update: 0, create: 2, consolidate: 0 });
    expect(output.warnings.some((w) => w.code === 'overlay_absent')).toBe(true);
  });

  it('discloses upstream partial/skipped stages as warnings', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedGapStage(d1, runId, 'collect_us_fanout', 'skipped', 0);
    await seedGapStage(d1, runId, 'overlay_existing_site', 'partial', 0);
    const { ctx, artifacts } = buildCtx(d1, projectId, runId, brief({ mode: 'greenfield', websiteUrl: null, websiteDomain: null }));
    artifacts.set(`runs/${runId}/page-plan.json`, pagePlanArtifact(validPlan()));

    const { output } = (await validateBlueprintHandler(ctx)) as { output: ValidateBlueprintOutput };
    const disclosed = output.warnings.filter((w) => w.code === 'upstream_partial').map((w) => w.subject);
    expect(disclosed).toEqual(['collect_us_fanout', 'overlay_existing_site']);
  });

  it('surfaces a missing page-plan artifact as an internal_error (broken precondition), not a validation error', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const { ctx } = buildCtx(d1, projectId, runId, brief());
    // No page-plan.json written.
    const err = await validateBlueprintHandler(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(BlueprintApiError);
    expect((err as BlueprintApiError).code).toBe('internal_error');
  });
});
