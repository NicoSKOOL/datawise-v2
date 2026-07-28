// Admin utilities for the marketing-email stack.
//
// Two jobs: trigger the Resend contact sync on demand (the daily cron would
// take days to seed the initial load), and see opt-out state without opening a
// SQL shell.
import type { Env } from '../index';
import type { AuthUser } from '../auth/google';
import { isAdmin } from './admin';
import { syncResendContacts } from '../email/resend-contacts';
import { ALL_SEGMENTS } from '../email/segments';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * POST /api/admin/email/sync-contacts
 *
 * Body (all optional): { budgetMs?: number, pageSize?: number, reset?: boolean }
 *
 * Returns `done: false` while a pass is still in flight, so this can simply be
 * called again to continue. That is how the initial ~2,000-contact load gets
 * seeded in a few minutes instead of waiting for the daily cron to walk the
 * table a slice at a time.
 */
export async function handleSyncContacts(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  if (!isAdmin(user, env)) return json({ error: 'Forbidden' }, 403);

  let body: { budgetMs?: number; pageSize?: number; reset?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Empty body is fine: run with defaults.
  }

  // Cap the budget so a stray value cannot wedge the request past the
  // platform's limits.
  const budgetMs = Math.min(Math.max(body.budgetMs ?? 20_000, 1_000), 60_000);

  try {
    const result = await syncResendContacts(env, {
      budgetMs,
      pageSize: body.pageSize,
      reset: body.reset === true,
    });
    return json({ ok: true, ...result });
  } catch (err) {
    console.error('admin sync-contacts failed:', err);
    return json({ error: 'sync_failed', message: String(err) }, 500);
  }
}

/**
 * GET /api/admin/email/suppressions
 *
 * Opt-out rate is the number that decides whether a campaign was a mistake, so
 * it should not require a SQL shell to read.
 */
export async function handleSuppressionsOverview(
  _request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  if (!isAdmin(user, env)) return json({ error: 'Forbidden' }, 403);

  const byReason = await env.DB.prepare(
    `SELECT reason, scope, COUNT(*) AS n
     FROM email_suppressions
     GROUP BY reason, scope
     ORDER BY n DESC`
  ).all<{ reason: string; scope: string; n: number }>();

  const recent = await env.DB.prepare(
    `SELECT email, scope, reason, source, created_at
     FROM email_suppressions
     ORDER BY created_at DESC
     LIMIT 50`
  ).all<Record<string, unknown>>();

  const totals = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM email_suppressions) AS suppressed,
       (SELECT COUNT(*) FROM users WHERE COALESCE(banned,0) = 0) AS active_users,
       (SELECT COUNT(*) FROM resend_contact_sync) AS synced_contacts`
  ).first<{ suppressed: number; active_users: number; synced_contacts: number }>();

  const bySegment = await env.DB.prepare(
    `SELECT segment, COUNT(*) AS n FROM resend_contact_sync GROUP BY segment`
  ).all<{ segment: string; n: number }>();

  const segmentCounts: Record<string, number> = {};
  for (const s of ALL_SEGMENTS) segmentCounts[s] = 0;
  for (const row of bySegment.results ?? []) segmentCounts[row.segment] = row.n;

  return json({
    totals,
    opt_out_rate:
      totals && totals.active_users > 0
        ? Number(((totals.suppressed / totals.active_users) * 100).toFixed(2))
        : 0,
    by_reason: byReason.results ?? [],
    synced_by_segment: segmentCounts,
    recent: recent.results ?? [],
  });
}
