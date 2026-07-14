import { describe, it, expect } from 'vitest';
import { DEFAULT_DFS_COST_ESTIMATES, loadDfsCostEstimates, buildCallPlan, OPERATION_STAGE } from './costs';
import type { CallPlan } from './costs';
import { parseProjectBrief, normalizeProjectBrief } from '../../domain/brief';
import { V1_LIMITS } from '../../contracts/limits';
import { createTestDb } from '../../test-support/d1';
import { newId, nowIso } from '../../db/util';
import type { StageContext } from '../../orchestration/handlers';
import { STAGE_HANDLERS } from '../../orchestration/handlers';
import { BlueprintApiError } from '../../domain/api-errors';

const DFS_COST_KV_KEY = 'bp:config:dfs-cost-estimates';

async function makeBrief(opts: { withWebsite?: boolean } = {}) {
  return normalizeProjectBrief(
    parseProjectBrief({
      businessName: 'Test Co',
      category: 'Plumber',
      countryIso: 'us',
      languageCode: 'en',
      ...(opts.withWebsite ? { websiteUrl: 'https://www.testco.com' } : {}),
      services: [{ clientId: 's1', name: 'Emergency Plumbing' }],
      serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true }],
    }),
    V1_LIMITS
  );
}

function findLine(plan: CallPlan, operation: string) {
  return plan.lines.find((l) => l.operation === operation);
}

function fakeKv(store: Record<string, string> = {}) {
  const m = new Map(Object.entries(store));
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => {
      m.set(k, v);
    },
    delete: async (k: string) => {
      m.delete(k);
    },
  } as unknown as KVNamespace;
}

describe('buildCallPlan', () => {
  it('prices a 1-service/1-area greenfield brief per the catalog plan shape', async () => {
    const brief = await makeBrief();
    const plan = buildCallPlan(brief, DEFAULT_DFS_COST_ESTIMATES);

    expect(findLine(plan, 'keyword_ideas')?.tasks).toBe(1);
    expect(findLine(plan, 'keyword_suggestions')?.tasks).toBe(1);
    expect(findLine(plan, 'keywords_for_site')).toBeUndefined();
    expect(findLine(plan, 'competitor_discovery')?.tasks).toBe(1);
    expect(findLine(plan, 'ranked_keywords')?.tasks).toBe(5);
    expect(findLine(plan, 'relevant_pages')?.tasks).toBe(5);
    expect(findLine(plan, 'metric_enrichment')?.tasks).toBe(2);
    expect(findLine(plan, 'serp_task_post')?.tasks).toBe(1);

    const labsTasks = 1 + 1 + 1 + 5 + 5 + 2; // ideas + suggestions + discovery + ranked + relevant + enrichment
    const expectedTotal =
      labsTasks * DEFAULT_DFS_COST_ESTIMATES.labsTaskUsdMicro + 1 * DEFAULT_DFS_COST_ESTIMATES.serpTaskUsdMicro;
    expect(plan.totalUsdMicro).toBe(expectedTotal);
    expect(plan.lines.every((l) => l.cacheEligible)).toBe(true);
    expect(findLine(plan, 'serp_task_post')?.estimatedUsdMicro).toBe(DEFAULT_DFS_COST_ESTIMATES.serpTaskUsdMicro);
  });

  it('adds keywords_for_site for an existing_site brief with a domain', async () => {
    const brief = await makeBrief({ withWebsite: true });
    const plan = buildCallPlan(brief, DEFAULT_DFS_COST_ESTIMATES);
    expect(findLine(plan, 'keywords_for_site')?.tasks).toBe(1);
    expect(findLine(plan, 'keywords_for_site')?.estimatedUsdMicro).toBe(DEFAULT_DFS_COST_ESTIMATES.labsTaskUsdMicro);
  });

  it('caps keyword_suggestions and serp_task_post seeds at their documented ceilings', async () => {
    const brief = await normalizeProjectBrief(
      parseProjectBrief({
        businessName: 'Big Co',
        category: 'Contractor',
        countryIso: 'us',
        languageCode: 'en',
        services: Array.from({ length: 10 }, (_, i) => ({ clientId: `s${i}`, name: `Service ${i}` })),
        serviceAreas: [{ clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true }],
      }),
      V1_LIMITS
    );
    const plan = buildCallPlan(brief, DEFAULT_DFS_COST_ESTIMATES);
    // 10 services all in the primary area -> 10 service_primary_area seeds,
    // capped 8 for suggestions and 20 (no-op cap) for serp.
    expect(findLine(plan, 'keyword_suggestions')?.tasks).toBe(8);
    expect(findLine(plan, 'serp_task_post')?.tasks).toBe(10);
  });

  it('KV-overridden labs price halves the labs-only portion of the total', async () => {
    const brief = await makeBrief();
    const halved = { ...DEFAULT_DFS_COST_ESTIMATES, labsTaskUsdMicro: DEFAULT_DFS_COST_ESTIMATES.labsTaskUsdMicro / 2 };
    const defaultPlan = buildCallPlan(brief, DEFAULT_DFS_COST_ESTIMATES);
    const halvedPlan = buildCallPlan(brief, halved);

    const serpDefault = findLine(defaultPlan, 'serp_task_post')?.estimatedUsdMicro ?? 0;
    const serpHalved = findLine(halvedPlan, 'serp_task_post')?.estimatedUsdMicro ?? 0;
    expect(serpHalved).toBe(serpDefault); // serp price untouched by the labs override

    const labsTotalDefault = defaultPlan.totalUsdMicro - serpDefault;
    const labsTotalHalved = halvedPlan.totalUsdMicro - serpHalved;
    expect(labsTotalHalved).toBe(labsTotalDefault / 2);
  });
});

describe('OPERATION_STAGE (buildCallPlan exhaustiveness)', () => {
  it('assigns a stage to every operation buildCallPlan can produce, across brief shapes', async () => {
    const briefs = [await makeBrief(), await makeBrief({ withWebsite: true })];
    for (const brief of briefs) {
      const plan = buildCallPlan(brief, DEFAULT_DFS_COST_ESTIMATES);
      for (const line of plan.lines) {
        // A missing OPERATION_STAGE entry makes this undefined at runtime even
        // though CallPlanLine.stage is typed as the non-optional BlueprintStage:
        // this assertion is what actually catches a new operation that forgot
        // to register a stage, not the type checker.
        expect(OPERATION_STAGE[line.operation]).toBeDefined();
        expect(line.stage).toBe(OPERATION_STAGE[line.operation]);
      }
    }
  });

  it('maps metric_enrichment to collect_keyword_evidence, not normalize_keyword_universe', () => {
    // enrichMissingMetrics (keywords.ts) runs inside collectKeywordEvidenceHandler
    // (orchestration/research-handlers.ts), which is registered under the
    // collect_keyword_evidence stage (orchestration/handlers.ts). It never runs
    // as part of normalize_keyword_universe.
    expect(OPERATION_STAGE.metric_enrichment).toBe('collect_keyword_evidence');
  });
});

describe('loadDfsCostEstimates', () => {
  it('returns the defaults when no KV override exists', async () => {
    const costs = await loadDfsCostEstimates(fakeKv());
    expect(costs).toEqual(DEFAULT_DFS_COST_ESTIMATES);
  });

  it('overrides one field from KV JSON and falls back to the default for the other', async () => {
    const kv = fakeKv({ [DFS_COST_KV_KEY]: JSON.stringify({ labsTaskUsdMicro: 25_000 }) });
    const costs = await loadDfsCostEstimates(kv);
    expect(costs).toEqual({ labsTaskUsdMicro: 25_000, serpTaskUsdMicro: DEFAULT_DFS_COST_ESTIMATES.serpTaskUsdMicro });
  });

  it('overrides both fields when both are present', async () => {
    const kv = fakeKv({ [DFS_COST_KV_KEY]: JSON.stringify({ labsTaskUsdMicro: 1, serpTaskUsdMicro: 2 }) });
    const costs = await loadDfsCostEstimates(kv);
    expect(costs).toEqual({ labsTaskUsdMicro: 1, serpTaskUsdMicro: 2 });
  });

  it('falls back to defaults on invalid JSON', async () => {
    const kv = fakeKv({ [DFS_COST_KV_KEY]: 'not json{' });
    const costs = await loadDfsCostEstimates(kv);
    expect(costs).toEqual(DEFAULT_DFS_COST_ESTIMATES);
  });

  it('falls back to defaults per-field when a field has the wrong type', async () => {
    const kv = fakeKv({ [DFS_COST_KV_KEY]: JSON.stringify({ labsTaskUsdMicro: 'a lot', serpTaskUsdMicro: 3 }) });
    const costs = await loadDfsCostEstimates(kv);
    expect(costs).toEqual({ labsTaskUsdMicro: DEFAULT_DFS_COST_ESTIMATES.labsTaskUsdMicro, serpTaskUsdMicro: 3 });
  });
});

describe('plan_research handler (fail-fast budget gate)', () => {
  async function buildCtx(dataforseoBudgetUsdMicro: number) {
    const { d1 } = createTestDb();
    const projectId = newId('proj');
    await d1
      .prepare(
        `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(projectId, 'org1', 'user1', 'Test Co', 'greenfield', 'US', 'en', nowIso(), nowIso())
      .run();

    const brief = await makeBrief();
    const briefVersionId = newId('briefv');
    await d1
      .prepare(
        `INSERT INTO project_brief_versions (id, project_id, version_number, input_json, normalized_json, input_hash, created_by, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
      )
      .bind(briefVersionId, projectId, '{}', JSON.stringify(brief), brief.inputHash, 'user1', nowIso())
      .run();

    const runId = newId('run');
    await d1
      .prepare(
        `INSERT INTO research_runs
          (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
         VALUES (?, ?, ?, ?, 'queued', ?, 0, 'user1', ?)`
      )
      .bind(runId, projectId, briefVersionId, 'estimate1', dataforseoBudgetUsdMicro, nowIso())
      .run();

    const ctx: StageContext = {
      env: { KV: fakeKv() } as any,
      d1,
      runId,
      projectId,
      briefVersionId,
      normalizedBrief: brief,
      stage: 'plan_research',
      attempt: 1,
    };
    return ctx;
  }

  it('passes and returns the plan when the budget covers the estimate', async () => {
    const ctx = await buildCtx(2_000_000);
    const result = await STAGE_HANDLERS.plan_research(ctx);
    expect((result.output as any).stage).toBe('plan_research');
    const plan = (result.output as any).plan as CallPlan;
    expect(plan.totalUsdMicro).toBeGreaterThan(0);
    expect(plan.lines.length).toBeGreaterThan(0);
  });

  it('throws budget_exceeded when the plan exceeds the run budget', async () => {
    const ctx = await buildCtx(100_000);
    await expect(STAGE_HANDLERS.plan_research(ctx)).rejects.toBeInstanceOf(BlueprintApiError);
    await expect(STAGE_HANDLERS.plan_research(ctx)).rejects.toMatchObject({ code: 'budget_exceeded' });
  });
});
