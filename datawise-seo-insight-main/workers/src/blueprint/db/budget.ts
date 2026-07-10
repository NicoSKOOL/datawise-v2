import { newId, nowIso } from './util';
import { BlueprintApiError } from '../domain/api-errors';

export type BudgetProvider = 'dataforseo' | 'openrouter';

interface ReservationRow {
  id: string;
  run_id: string;
  provider: BudgetProvider;
  estimated_cost_usd_micro: number;
  status: 'reserved' | 'reconciled' | 'released';
}

function columnPrefix(provider: BudgetProvider): 'dataforseo' | 'openrouter' {
  return provider === 'dataforseo' ? 'dataforseo' : 'openrouter';
}

// The conditional UPDATE is the atomic ceiling guard: two racing reservations
// against the same run/provider cannot both pass, because the WHERE clause
// re-checks reserved+actual+estimated against the budget inside the same
// UPDATE that performs the increment. Only one wins the row; the loser sees
// meta.changes === 0 and never touches the run's reserved total.
export async function reserveProviderBudget(
  d1: D1Database,
  runId: string,
  provider: BudgetProvider,
  estimatedUsdMicro: number,
  operationKey: string
): Promise<{ reservationId: string }> {
  const col = columnPrefix(provider);
  const upd = await d1
    .prepare(
      `UPDATE research_runs SET ${col}_reserved_usd_micro = ${col}_reserved_usd_micro + ?
       WHERE id = ? AND ${col}_reserved_usd_micro + ${col}_actual_usd_micro + ? <= ${col}_budget_usd_micro`
    )
    .bind(estimatedUsdMicro, runId, estimatedUsdMicro)
    .run();
  if (upd.meta.changes === 0) {
    throw new BlueprintApiError('budget_exceeded', `${provider} budget ceiling would be exceeded`);
  }

  const reservationId = newId('resv');
  try {
    await d1
      .prepare(
        `INSERT INTO provider_budget_reservations
          (id, run_id, provider, operation_key, status, estimated_cost_usd_micro, actual_cost_usd_micro, created_at, reconciled_at)
         VALUES (?, ?, ?, ?, 'reserved', ?, NULL, ?, NULL)`
      )
      .bind(reservationId, runId, provider, operationKey, estimatedUsdMicro, nowIso())
      .run();
    return { reservationId };
  } catch (err) {
    // UNIQUE(run_id, provider, operation_key) collision: this is a retry of
    // an operation we already reserved for. Compensate the speculative
    // increment made by the guard above and hand back the existing row's id
    // so the caller's reservation is idempotent under retries.
    await d1
      .prepare(`UPDATE research_runs SET ${col}_reserved_usd_micro = ${col}_reserved_usd_micro - ? WHERE id = ?`)
      .bind(estimatedUsdMicro, runId)
      .run();

    const existing = await d1
      .prepare(
        `SELECT id FROM provider_budget_reservations WHERE run_id = ? AND provider = ? AND operation_key = ?`
      )
      .bind(runId, provider, operationKey)
      .first<{ id: string }>();

    if (!existing) throw err;
    return { reservationId: existing.id };
  }
}

async function loadReservation(d1: D1Database, reservationId: string): Promise<ReservationRow> {
  const row = await d1
    .prepare(
      `SELECT id, run_id, provider, estimated_cost_usd_micro, status
       FROM provider_budget_reservations WHERE id = ?`
    )
    .bind(reservationId)
    .first<ReservationRow>();
  if (!row) throw new Error(`provider budget reservation not found: ${reservationId}`);
  return row;
}

export async function reconcileProviderBudget(
  d1: D1Database,
  reservationId: string,
  actualUsdMicro: number
): Promise<void> {
  const reservation = await loadReservation(d1, reservationId);
  const col = columnPrefix(reservation.provider);

  await d1.batch([
    d1
      .prepare(
        `UPDATE research_runs
         SET ${col}_reserved_usd_micro = ${col}_reserved_usd_micro - ?,
             ${col}_actual_usd_micro = ${col}_actual_usd_micro + ?
         WHERE id = ?`
      )
      .bind(reservation.estimated_cost_usd_micro, actualUsdMicro, reservation.run_id),
    d1
      .prepare(
        `UPDATE provider_budget_reservations
         SET status = 'reconciled', actual_cost_usd_micro = ?, reconciled_at = ?
         WHERE id = ?`
      )
      .bind(actualUsdMicro, nowIso(), reservationId),
  ]);
}

export async function releaseProviderBudget(d1: D1Database, reservationId: string): Promise<void> {
  const reservation = await loadReservation(d1, reservationId);
  const col = columnPrefix(reservation.provider);

  await d1.batch([
    d1
      .prepare(`UPDATE research_runs SET ${col}_reserved_usd_micro = ${col}_reserved_usd_micro - ? WHERE id = ?`)
      .bind(reservation.estimated_cost_usd_micro, reservation.run_id),
    d1.prepare(`UPDATE provider_budget_reservations SET status = 'released' WHERE id = ?`).bind(reservationId),
  ]);
}

export async function assertRunWithinBudget(
  d1: D1Database,
  runId: string,
  provider: BudgetProvider
): Promise<void> {
  const col = columnPrefix(provider);
  const row = await d1
    .prepare(
      `SELECT ${col}_actual_usd_micro AS actual, ${col}_budget_usd_micro AS budget
       FROM research_runs WHERE id = ?`
    )
    .bind(runId)
    .first<{ actual: number; budget: number }>();
  if (!row) throw new Error(`research run not found: ${runId}`);
  if (row.actual >= row.budget) {
    throw new BlueprintApiError('budget_exceeded', `${provider} budget exhausted for run ${runId}`);
  }
}
