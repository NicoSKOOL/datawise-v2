import { describe, it, expect } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { newId, nowIso } from './util';
import {
  reserveProviderBudget,
  reconcileProviderBudget,
  releaseProviderBudget,
  assertRunWithinBudget,
} from './budget';

async function seedProject(d1: D1Database) {
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

async function seedRun(
  d1: D1Database,
  overrides: Partial<{ dataforseoBudgetUsdMicro: number; openrouterBudgetUsdMicro: number }> = {}
) {
  const projectId = await seedProject(d1);
  const id = newId('run');
  await d1
    .prepare(
      `INSERT INTO research_runs
        (id, project_id, brief_version_id, estimate_id, status, dataforseo_budget_usd_micro, openrouter_budget_usd_micro, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      projectId,
      'brief1',
      'estimate1',
      'running',
      overrides.dataforseoBudgetUsdMicro ?? 1_000_000,
      overrides.openrouterBudgetUsdMicro ?? 1_000_000,
      'user1',
      nowIso()
    )
    .run();
  return id;
}

async function getRun(d1: D1Database, runId: string) {
  return d1
    .prepare(
      `SELECT dataforseo_reserved_usd_micro, dataforseo_actual_usd_micro,
              openrouter_reserved_usd_micro, openrouter_actual_usd_micro
       FROM research_runs WHERE id = ?`
    )
    .bind(runId)
    .first<{
      dataforseo_reserved_usd_micro: number;
      dataforseo_actual_usd_micro: number;
      openrouter_reserved_usd_micro: number;
      openrouter_actual_usd_micro: number;
    }>();
}

async function countReservations(d1: D1Database, runId: string, provider: string) {
  const row = await d1
    .prepare('SELECT COUNT(*) as count FROM provider_budget_reservations WHERE run_id = ? AND provider = ?')
    .bind(runId, provider)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe('reserveProviderBudget', () => {
  it('(a) reserving under the ceiling succeeds and increments the run reserved total', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const result = await reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-1');
    expect(result.reservationId).toBeTruthy();

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(600_000);

    const reservation = await d1
      .prepare('SELECT status, estimated_cost_usd_micro FROM provider_budget_reservations WHERE id = ?')
      .bind(result.reservationId)
      .first<{ status: string; estimated_cost_usd_micro: number }>();
    expect(reservation?.status).toBe('reserved');
    expect(reservation?.estimated_cost_usd_micro).toBe(600_000);
  });

  it('(b) a second reservation that would cross the ceiling throws budget_exceeded, leaving reserved unchanged with no row left behind', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    await reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-1');

    await expect(reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-2')).rejects.toMatchObject({
      code: 'budget_exceeded',
    });

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(600_000);
    expect(await countReservations(d1, runId, 'dataforseo')).toBe(1);
  });

  it('(e) a duplicate operationKey for the same run+provider returns the existing reservation id instead of double-reserving', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);

    const first = await reserveProviderBudget(d1, runId, 'dataforseo', 100_000, 'op-1');
    const second = await reserveProviderBudget(d1, runId, 'dataforseo', 100_000, 'op-1');

    expect(second.reservationId).toBe(first.reservationId);

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(100_000);
    expect(await countReservations(d1, runId, 'dataforseo')).toBe(1);
  });
});

describe('reconcileProviderBudget', () => {
  it('(c) moves reserved to actual at the reconciled cost and marks the reservation reconciled', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    const { reservationId } = await reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-1');

    await reconcileProviderBudget(d1, reservationId, 550_000);

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(550_000);

    const reservation = await d1
      .prepare('SELECT status, actual_cost_usd_micro, reconciled_at FROM provider_budget_reservations WHERE id = ?')
      .bind(reservationId)
      .first<{ status: string; actual_cost_usd_micro: number; reconciled_at: string | null }>();
    expect(reservation?.status).toBe('reconciled');
    expect(reservation?.actual_cost_usd_micro).toBe(550_000);
    expect(reservation?.reconciled_at).toBeTruthy();
  });
});

describe('releaseProviderBudget', () => {
  it('(d) returns the reserved amount to the run without touching actual', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    const { reservationId } = await reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-1');

    await releaseProviderBudget(d1, reservationId);

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(0);

    const reservation = await d1
      .prepare('SELECT status FROM provider_budget_reservations WHERE id = ?')
      .bind(reservationId)
      .first<{ status: string }>();
    expect(reservation?.status).toBe('released');
  });
});

describe('reconcile/release status guard', () => {
  it('double release throws stage_conflict and run reserved stays 0, not negative', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    const { reservationId } = await reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-1');

    await releaseProviderBudget(d1, reservationId);
    await expect(releaseProviderBudget(d1, reservationId)).rejects.toMatchObject({
      code: 'stage_conflict',
    });

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
  });

  it('double reconcile throws stage_conflict and run actual is counted once', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    const { reservationId } = await reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-1');

    await reconcileProviderBudget(d1, reservationId, 550_000);
    await expect(reconcileProviderBudget(d1, reservationId, 550_000)).rejects.toMatchObject({
      code: 'stage_conflict',
    });

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(550_000);
  });

  it('release after reconcile throws stage_conflict', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1);
    const { reservationId } = await reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-1');

    await reconcileProviderBudget(d1, reservationId, 550_000);

    await expect(releaseProviderBudget(d1, reservationId)).rejects.toMatchObject({
      code: 'stage_conflict',
    });

    const run = await getRun(d1, runId);
    expect(run?.dataforseo_reserved_usd_micro).toBe(0);
    expect(run?.dataforseo_actual_usd_micro).toBe(550_000);
  });

  it('after a double-release attempt, a new reservation cannot exceed the remaining true ceiling', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1, { dataforseoBudgetUsdMicro: 1_000_000 });
    const { reservationId } = await reserveProviderBudget(d1, runId, 'dataforseo', 600_000, 'op-1');

    await releaseProviderBudget(d1, reservationId);
    await expect(releaseProviderBudget(d1, reservationId)).rejects.toMatchObject({
      code: 'stage_conflict',
    });

    // reserved is back to 0 after the single successful release, so a fresh
    // reservation up to the full budget should succeed...
    await reserveProviderBudget(d1, runId, 'dataforseo', 1_000_000, 'op-2');

    // ...and one more dollar of reservation must still be rejected by the
    // ceiling guard. If the double-release had double-decremented reserved
    // (going negative), this next reservation would wrongly succeed.
    await expect(reserveProviderBudget(d1, runId, 'dataforseo', 1, 'op-3')).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });
});

describe('assertRunWithinBudget', () => {
  it('(f) throws budget_exceeded once actual cost reaches the budget, and not before', async () => {
    const { d1 } = createTestDb();
    const runId = await seedRun(d1, { dataforseoBudgetUsdMicro: 500_000 });

    await expect(assertRunWithinBudget(d1, runId, 'dataforseo')).resolves.toBeUndefined();

    const { reservationId } = await reserveProviderBudget(d1, runId, 'dataforseo', 500_000, 'op-1');
    await reconcileProviderBudget(d1, reservationId, 500_000);

    await expect(assertRunWithinBudget(d1, runId, 'dataforseo')).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });
});
