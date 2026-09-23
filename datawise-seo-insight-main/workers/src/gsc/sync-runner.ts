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

// Properties attempted per tick. The whole point of slicing is that the
// subrequest cap is per INVOCATION, so the fix for "the run dies at ~30
// properties" is more invocations, not a longer deadline. One property costs
// ~16 subrequests in the cheap case and far more for a large property
// (agg90 at 50k rows is 100 insert batches alone), and processSiteAuditQueue
// spends from the same budget earlier in the tick, so a slice stays well
// under the cap. At the */5 cadence 10 per tick is 2,880 attempts a day,
// against a due set that stood at 2,234 on 2026-09-23.
export const GSC_SLICE_LIMIT = 10;

// A property is not re-attempted inside this window. Without it the ordering
// is deterministic, so every tick would re-attempt the same head of the queue
// and a permanently failing property (deleted in Search Console, permission
// revoked) would block every property behind it forever. With it, the head
// rotates and a broken property costs at most ~12 attempts a day.
export const GSC_ATTEMPT_COOLDOWN = '-2 hours';

// Only re-sync a property if it has not been refreshed in the last few days.
// Google Search Console data itself lags ~2-3 days, so a daily rewrite of the
// full 90-day window produced no fresher data while dominating D1 write cost.
// last_synced_at is set only on a SUCCESSFUL sync, so token-expired properties
// (which write nothing) stay eligible and are retried at ~zero cost.
// The manual "Sync" button bypasses this and force-refreshes on demand.
const STALE_AFTER = '-3 days';

export interface GSCSliceResult {
  /** Properties whose sync returned 2xx. */
  synced: number;
  /** Properties skipped because the token could not be refreshed (403). */
  skipped: number;
  failed: number;
  /** Properties dispatched, i.e. the size of the slice actually worked. */
  processed: number;
  /** Properties due and past their attempt cooldown, before the slice limit. */
  eligible: number;
  breaker_tripped: boolean;
  duration_ms: number;
}

export interface GSCSliceOptions {
  /** Max properties to attempt. */
  limit?: number;
  /** Lanes in flight. */
  concurrency?: number;
}

/**
 * Sync one slice of the GSC due set.
 *
 * Scope: enabled GSC properties whose owner has logged in within the 30-day
 * session lifetime (a currently-valid session). Properties owned by dormant
 * users are skipped: their data is NOT deleted, and a later run picks them up
 * automatically once they log in again. This avoids rewriting 90-day Search
 * Console data that nobody is currently looking at, which is the dominant
 * driver of D1 "rows written" cost. Properties whose refresh token can no
 * longer mint an access token are skipped; skipping does not delete anything.
 *
 * Runs from the every-5-minute tick, once per invocation, because the binding
 * limit is
 * the per-invocation subrequest cap and not wall-clock time: the single daily
 * run it replaces was stamping ~35 properties a night (all inside its first
 * two minutes, of an 11-minute budget) while 2,234 were due, so every active
 * user's dashboard was frozen at whatever the manual Sync button last fetched.
 */
export async function runGSCSyncSlice(
  env: Env,
  deadline: number,
  options: GSCSliceOptions = {},
  syncFn: (env: Env, userId: string, propertyId: string) => Promise<Response> = syncProperty,
): Promise<GSCSliceResult> {
  const startedAt = Date.now();
  const limit = options.limit ?? GSC_SLICE_LIMIT;
  const concurrency = options.concurrency ?? GSC_NIGHTLY_CONCURRENCY;

  // The due set is far larger than one slice, so ordering decides who gets
  // data now. orderSyncQueue owns that policy: see gsc/sync-queue.ts for why
  // never-synced properties are no longer last. This query is deliberately
  // unordered; do not add an ORDER BY here.
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
        AND (p.last_attempt_at IS NULL OR p.last_attempt_at < datetime('now', ?))
        AND EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.user_id = p.user_id
             AND s.expires_at > datetime('now')
        )`
  ).bind(STALE_AFTER, GSC_ATTEMPT_COOLDOWN).all<SyncQueueRow>();

  const eligible = props.results || [];
  const composition = describeSyncQueue(eligible);
  const rows = orderSyncQueue(eligible).slice(0, limit);

  // Stamp the whole slice as attempted BEFORE syncing any of it, in one batch.
  // Before, not after, so a slice that dies mid-flight (subrequest cap, CPU
  // limit, the 15-minute wall) cannot hand the next tick the same head; and in
  // one batch so the bookkeeping costs one subrequest instead of one per
  // property. A successful sync stamps last_synced_at on top of this.
  if (rows.length > 0) {
    await env.DB.batch(
      rows.map(p => env.DB.prepare(
        `UPDATE gsc_properties SET last_attempt_at = datetime('now') WHERE id = ?`
      ).bind(p.id))
    );
  }

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
        console.error(`GSC sync breaker tripped after ${GSC_SYNC_BREAKER_THRESHOLD} consecutive failures; halting dispatch`);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const result: GSCSliceResult = {
    synced,
    skipped,
    failed,
    processed: Math.min(next, rows.length),
    eligible: eligible.length,
    breaker_tripped: tripped,
    duration_ms: Date.now() - startedAt,
  };

  if (result.processed > 0 || tripped) {
    console.log(
      `GSC sync slice: ${synced} synced, ${skipped} skipped (token), ${failed} failed, ` +
      `${result.processed}/${rows.length} dispatched, ${eligible.length} eligible, ${result.duration_ms}ms` +
      ` [queue: ${composition.onboarding} onboarding, ${composition.expansion} expansion, ` +
      `${composition.refresh} refresh]` +
      (tripped ? ' (breaker tripped)' : '')
    );
  }

  return result;
}
