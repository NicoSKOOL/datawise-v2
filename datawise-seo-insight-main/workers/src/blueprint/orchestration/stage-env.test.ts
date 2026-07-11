import { describe, it, expect } from 'vitest';
import { newId, nowIso } from '../db/util';
import { parseProjectBrief, normalizeProjectBrief } from '../domain/brief';
import { V1_LIMITS } from '../contracts/limits';
import { processResearchRun } from './process-run';
import type { StageHandler } from './handlers';
import type { BlueprintStage } from '../contracts/enums';
import { fakeEnv } from './acceptance.e2e.test';

// Same sample brief used by process-run.test.ts / domain/brief.test.ts.
const SAMPLE_BRIEF_INPUT = {
  businessName: 'Aqua Plumbing',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'en',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning', priority: 'secondary' as const },
  ],
  serviceAreas: [
    { clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true, uniqueProof: ['Office on South Lamar'] },
  ],
};

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, 'org1', 'u1', 'Aqua Plumbing', 'existing_site', 'US', 'en', nowIso(), nowIso())
    .run();
  return id;
}

async function seedBriefVersion(d1: D1Database, projectId: string): Promise<string> {
  const parsed = parseProjectBrief(SAMPLE_BRIEF_INPUT);
  const normalized = await normalizeProjectBrief(parsed, V1_LIMITS);
  const id = newId('briefv');
  await d1
    .prepare(
      `INSERT INTO project_brief_versions (id, project_id, version_number, input_json, normalized_json, input_hash, created_by, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, JSON.stringify(SAMPLE_BRIEF_INPUT), JSON.stringify(normalized), normalized.inputHash, 'u1', nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string, briefVersionId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status,
         dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, ?, ?, 'queued', 0, 0, 'u1', ?)`
    )
    .bind(id, projectId, briefVersionId, 'estimate1', nowIso())
    .run();
  return id;
}

describe('StageContext provider env threading', () => {
  it('passes env into StageContext so a stage handler can read DataForSEO credentials', async () => {
    const env = fakeEnv();
    const projectId = await seedProject(env.BLUEPRINT_DB);
    const briefVersionId = await seedBriefVersion(env.BLUEPRINT_DB, projectId);
    const runId = await seedRun(env.BLUEPRINT_DB, projectId, briefVersionId);

    const overrides: Partial<Record<BlueprintStage, StageHandler>> = {
      resolve_market: async (ctx) => ({
        output: { hasEnv: typeof ctx.env?.DATAFORSEO_EMAIL === 'string' },
      }),
    };

    // Stage order per BLUEPRINT_STAGES: validate_intake runs first (no
    // override needed, it's a real handler), then resolve_market is next.
    await processResearchRun(env, runId, 'w1');
    await processResearchRun(env, runId, 'w1', overrides);

    const row = await env.BLUEPRINT_DB
      .prepare(`SELECT output_json FROM research_stage_runs WHERE run_id = ? AND stage_name = 'resolve_market'`)
      .bind(runId)
      .first<{ output_json: string }>();
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.output_json)).toEqual({ hasEnv: true });
  });
});
