import type { Env } from '../index';
import { syncProperty } from './sync';
import { orderSyncQueue, describeSyncQueue, type SyncQueueRow } from './sync-queue';

// 8 lanes: median sync is ~11s but the tail reaches 3+ minutes, and the old
// fixed batches of 4 stalled every lane on the slowest member. Google's Search
// Console API quota (1,200 QPM per user) is nowhere near binding at 8.
export const GSC_NIGHTLY_CONCURRENCY = 8;

// Every GSC fetch page and every D1 statement/batch counts against the
// Worker's per-invocation subrequest cap. At 8 lanes for up to 11 minutes a
// nightly run can approach that cap; once it is exhausted every remaining
// syncFn call fails instantly, and a sync interrupted between its delete
// batch and its inserts strands that property with partial data. A run of
// consecutive failures is the signal that the cap (or GSC/D1 itself) is
// exhausted, not isolated per-property errors, so stop dispatching new work
// instead of churning through hundreds of guaranteed failures.
export const GSC_SYNC_BREAKER_THRESHOLD = 5;

// Daily GSC re-sync over enabled properties whose owner has logged in within
// the 30-day session lifetime (a currently-valid session). Properties owned by
// dormant users are skipped: their data is NOT deleted, and the next daily run
// picks them up automatically once they log in again. This avoids rewriting
// 90-day Search Console data that nobody is currently looking at, which is the
// dominant driver of D1 "rows written" cost.
// Skips properties whose refresh token can no longer mint an access token
// (user must reconnect); skipping does not delete the property.
// Processes with a shared-index worker pool to stay within Worker CPU limits.
export async function runDailyGSCSync(
  env: Env,
  deadline: number,
  syncFn: (env: Env, userId: string, propertyId: string) => Promise<Response> = syncProperty,
): Promise<void> {
  const startedAt = Date.now();
  // Only re-sync a property if it has not been refreshed in the last few days.
  // Google Search Console data itself lags ~2-3 days, so a daily rewrite of the
  // full 90-day window produced no fresher data while dominating D1 write cost.
  // last_synced_at is set only on a SUCCESSFUL sync, so token-expired properties
  // (which write nothing) stay eligible and are retried each day at ~zero cost.
  // The manual "Sync" button bypasses this and force-refreshes on demand.
  const STALE_AFTER = "-3 days";
  // The due set is far larger than one cron window can sync, so ordering
  // decides who gets data tonight. orderSyncQueue owns that policy: see
  // gsc/sync-queue.ts for why never-synced properties are no longer last.
  // This query is deliberately unordered; do not add an ORDER BY here.
  // user_has_synced tells the ordering whether the owner currently sees any
  // data at all. kind='gsc' excludes manual/bwt rows that can never GSC-sync
  // but were occupying sync slots.
  const props = await env.DB.prepare(
    `SELECT p.id, p.user_id, p.last_synced_at,
            EXISTS (
              SELECT 1 FROM gsc_properties q
               WHERE q.user_id = p.user_id
                 AND q.kind = 'gsc'
                 AND q.is_enabled = 1
                 AND q.last_synced_at IS NOT NULL
            ) AS user_has_synced
       FROM gsc_properties p
      WHERE p.is_enabled = 1
        AND p.kind = 'gsc'
        AND (p.last_synced_at IS NULL OR p.last_synced_at < datetime('now', ?))
        AND EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.user_id = p.user_id
             AND s.expires_at > datetime('now')
        )`
  ).bind(STALE_AFTER).all<SyncQueueRow>();

  const due = props.results || [];
  const composition = describeSyncQueue(due);
  const rows = orderSyncQueue(due);

  let synced = 0, skipped = 0, failed = 0;
  let next = 0;
  let consecutiveFailures = 0;
  let tripped = false;
  // Shared-index pool: each lane pulls the next property the moment it
  // finishes its current one, so a 3-minute straggler occupies one lane
  // instead of stalling a whole batch. The deadline is absolute (computed by
  // the caller from the scheduled-tick start), so time spent in the site-audit
  // queue before us no longer comes out of an unaccounted budget.
  const worker = async (): Promise<void> => {
    while (Date.now() < deadline && !tripped) {
      const idx = next++;
      if (idx >= rows.length) return;
      const p = rows[idx];
      try {
        const res = await syncFn(env, p.user_id, p.id);
        if (res.ok) { synced++; consecutiveFailures = 0; }
        else if (res.status === 403) { skipped++; consecutiveFailures = 0; }
        else { failed++; consecutiveFailures++; }
      } catch (err) {
        failed++;
        consecutiveFailures++;
        console.error('cron syncProperty rejected:', err);
      }
      if (!tripped && consecutiveFailures >= GSC_SYNC_BREAKER_THRESHOLD) {
        tripped = true;
        console.error(`GSC nightly sync breaker tripped after ${GSC_SYNC_BREAKER_THRESHOLD} consecutive failures; halting dispatch`);
      }
    }
  };
  await Promise.all(Array.from({ length: GSC_NIGHTLY_CONCURRENCY }, () => worker()));

  const processed = Math.min(next, rows.length);
  console.log(
    `GSC daily sync done (active + due-for-refresh scope): ${synced} synced, ${skipped} skipped (token), ` +
    `${failed} failed, ${processed}/${rows.length} due properties processed, ${Date.now() - startedAt}ms` +
    ` [queue: ${composition.onboarding} onboarding, ${composition.expansion} expansion, ` +
    `${composition.refresh} refresh]` +
    (processed < rows.length ? ` (time budget reached, ${rows.length - processed} roll to next run)` : '') +
    (tripped ? ` (breaker tripped)` : '')
  );
}
