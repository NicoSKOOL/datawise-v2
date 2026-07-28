import { describe, it, expect } from 'vitest';
import { createTestDb } from '../../test-support/d1';
import { fakeLLMProvider } from '../../test-support/env';
import { newId, nowIso } from '../../db/util';
import type { StageContext } from '../../orchestration/handlers';
import { blueprintOpenRouterCall } from './call';
import { OPENROUTER_ADJUDICATION_CALL_USD_MICRO } from '../dataforseo/costs';

async function seedRun(d1: D1Database, budgetMicro: number): Promise<string> {
  const now = nowIso();
  const projectId = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, 'org1', 'u1', 'test', 'greenfield', 'US', 'en', ?, ?)`
    )
    .bind(projectId, now, now)
    .run();
  const runId = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status,
         dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, 'bv', 'est', 'running', 0, ?, 'u1', ?)`
    )
    .bind(runId, projectId, budgetMicro, now)
    .run();
  return runId;
}

function ctxFor(d1: D1Database, runId: string, llm: unknown): StageContext {
  return {
    env: { BLUEPRINT_DB: d1, BLUEPRINT_LLM: llm } as any,
    d1,
    runId,
    projectId: 'proj',
    briefVersionId: 'bv',
    normalizedBrief: {} as any,
    stage: 'adjudicate_clusters',
    attempt: 1,
  };
}

const SPEC = {
  model: 'deepseek/deepseek-v4-flash',
  operation: 'cluster_adjudication',
  scopeId: 'b0',
  estimateUsdMicro: OPENROUTER_ADJUDICATION_CALL_USD_MICRO,
  startTokens: 1500,
  ceilingTokens: 6000,
  label: 'blueprint/test',
  responseFormat: 'json' as const,
  temperature: 0,
};

describe('blueprintOpenRouterCall', () => {
  it('refuses to call (and reserves nothing) when no member BYOK key was resolved', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1, 1_000_000);
    // No BLUEPRINT_LLM seam and no spec.apiKey: the only remaining way to reach
    // OpenRouter would be a platform-managed key, which this module must never
    // spend on a member's behalf.
    const ctx = ctxFor(d1, runId, undefined);

    await expect(
      blueprintOpenRouterCall(ctx, { ...SPEC, messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow(/BYOK required/);

    const usage = await d1
      .prepare(`SELECT COUNT(*) AS n FROM provider_usage WHERE run_id = ?`)
      .bind(runId)
      .first<{ n: number }>();
    expect(usage?.n).toBe(0);
    const run = await d1
      .prepare(`SELECT openrouter_reserved_usd_micro AS reserved FROM research_runs WHERE id = ?`)
      .bind(runId)
      .first<{ reserved: number }>();
    expect(run?.reserved).toBe(0);
  });

  it('reserves, calls, reconciles, and writes a provider_usage row tagged openrouter', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1, 1_000_000);
    const llm = fakeLLMProvider(() => ({ text: '{"verdicts":[]}' }));

    const res = await blueprintOpenRouterCall(ctxFor(d1, runId, llm), {
      ...SPEC,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.text).toBe('{"verdicts":[]}');
    expect(res.costUsdMicro).toBe(OPENROUTER_ADJUDICATION_CALL_USD_MICRO);

    const usage = await d1
      .prepare(`SELECT provider, operation, endpoint_or_model, cost_usd_micro FROM provider_usage WHERE run_id = ?`)
      .bind(runId)
      .first<{ provider: string; operation: string; endpoint_or_model: string; cost_usd_micro: number }>();
    expect(usage?.provider).toBe('openrouter');
    expect(usage?.operation).toBe('cluster_adjudication');
    expect(usage?.endpoint_or_model).toBe('deepseek/deepseek-v4-flash');
    expect(usage?.cost_usd_micro).toBe(OPENROUTER_ADJUDICATION_CALL_USD_MICRO);

    // Reservation reconciled: reserved back to 0, actual charged.
    const run = await d1
      .prepare(`SELECT openrouter_reserved_usd_micro AS reserved, openrouter_actual_usd_micro AS actual FROM research_runs WHERE id = ?`)
      .bind(runId)
      .first<{ reserved: number; actual: number }>();
    expect(run?.reserved).toBe(0);
    expect(run?.actual).toBe(OPENROUTER_ADJUDICATION_CALL_USD_MICRO);
  });

  it('releases the reservation and writes no usage row when the provider throws', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1, 1_000_000);
    const llm = fakeLLMProvider(() => {
      throw new Error('provider exploded');
    });

    await expect(
      blueprintOpenRouterCall(ctxFor(d1, runId, llm), { ...SPEC, messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toThrow('provider exploded');

    const usage = await d1
      .prepare(`SELECT COUNT(*) AS n FROM provider_usage WHERE run_id = ?`)
      .bind(runId)
      .first<{ n: number }>();
    expect(usage?.n).toBe(0);

    const run = await d1
      .prepare(`SELECT openrouter_reserved_usd_micro AS reserved, openrouter_actual_usd_micro AS actual FROM research_runs WHERE id = ?`)
      .bind(runId)
      .first<{ reserved: number; actual: number }>();
    expect(run?.reserved).toBe(0);
    expect(run?.actual).toBe(0);
  });

  it('throws budget_exceeded when the openrouter ceiling cannot cover the reservation', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1, 0); // zero openrouter budget
    const llm = fakeLLMProvider(() => ({ text: '{"verdicts":[]}' }));

    await expect(
      blueprintOpenRouterCall(ctxFor(d1, runId, llm), { ...SPEC, messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
  });
});
