import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from '../db/util';
import { loadStageOutput } from './stage-io';

async function seedProject(d1: D1Database): Promise<string> {
  const id = newId('proj');
  await d1
    .prepare(
      `INSERT INTO projects
        (id, organization_id, owner_user_id, name, mode, country_iso, language_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, 'org1', 'user1', 'Test Project', 'greenfield', 'US', 'en', nowIso(), nowIso())
    .run();
  return id;
}

async function seedRun(d1: D1Database, projectId: string): Promise<string> {
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, 'brief1', 'estimate1', 'running', 0, 0, 'user1', nowIso())
    .run();
  return id;
}

async function seedStageRun(
  d1: D1Database,
  runId: string,
  overrides: { stageName: string; status: string; outputJson: string | null; finishedAt?: string | null }
): Promise<void> {
  await d1
    .prepare(
      `INSERT INTO research_stage_runs
        (id, run_id, stage_name, stage_input_hash, status, required, output_json, finished_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .bind(
      newId('stagerun'),
      runId,
      overrides.stageName,
      `hash-${overrides.stageName}`,
      overrides.status,
      overrides.outputJson,
      overrides.finishedAt ?? nowIso()
    )
    .run();
}

describe('loadStageOutput', () => {
  it('round-trips the parsed output of a succeeded stage row', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedStageRun(d1, runId, {
      stageName: 'resolve_market',
      status: 'succeeded',
      outputJson: JSON.stringify({ labsLocationCode: 2840 }),
    });

    const output = await loadStageOutput<{ labsLocationCode: number }>(d1, runId, 'resolve_market');
    expect(output).toEqual({ labsLocationCode: 2840 });
  });

  it('returns the output of a partial stage row too', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedStageRun(d1, runId, {
      stageName: 'resolve_market',
      status: 'partial',
      outputJson: JSON.stringify({ labsLocationCode: 2840, unresolvedAreaIds: ['a1'] }),
    });

    const output = await loadStageOutput<{ labsLocationCode: number }>(d1, runId, 'resolve_market');
    expect(output).toEqual({ labsLocationCode: 2840, unresolvedAreaIds: ['a1'] });
  });

  it('returns null when no row exists for the stage', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);

    const output = await loadStageOutput(d1, runId, 'resolve_market');
    expect(output).toBeNull();
  });

  it('returns null for a non-terminal-success status (e.g. failed)', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    await seedStageRun(d1, runId, {
      stageName: 'resolve_market',
      status: 'failed',
      outputJson: null,
    });

    const output = await loadStageOutput(d1, runId, 'resolve_market');
    expect(output).toBeNull();
  });

  it('scopes by run_id: a matching stage row on a different run is not returned', async () => {
    const { d1 } = createTestDb();
    const projectId = await seedProject(d1);
    const runId = await seedRun(d1, projectId);
    const otherRunId = await seedRun(d1, projectId);
    await seedStageRun(d1, otherRunId, {
      stageName: 'resolve_market',
      status: 'succeeded',
      outputJson: JSON.stringify({ labsLocationCode: 999 }),
    });

    const output = await loadStageOutput(d1, runId, 'resolve_market');
    expect(output).toBeNull();
  });
});
