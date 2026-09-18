import type { Env } from '../index';
import { sendCreditsExhaustedEmail } from '../email/resend';

const FREE_CREDITS_LIMIT = 5;

interface CreditCheckResult {
  allowed: boolean;
  credits_used: number;
  credits_limit: number;
  unlimited: boolean;
}

export function creditCostForRoute(path: string): number {
  if (
    path.startsWith('/api/llm-mentions/') ||
    path.startsWith('/api/backlinks/')
  ) {
    return 2;
  }
  return 1;
}

export async function checkAndDeductCredit(env: Env, userId: string, cost = 1): Promise<CreditCheckResult> {
  const user = await env.DB.prepare(
    'SELECT credits_used, is_community_member, is_admin, subscription_tier, email, name, credits_exhausted_email_sent FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user) {
    return { allowed: false, credits_used: 0, credits_limit: FREE_CREDITS_LIMIT, unlimited: false };
  }

  // Admins, community members, and pro users get unlimited access.
  if (
    user.is_admin === 1 ||
    String(user.email || '').toLowerCase() === 'nico@airankingskool.com' ||
    user.is_community_member === 1 ||
    user.subscription_tier === 'pro' ||
    user.subscription_tier === 'community'
  ) {
    return { allowed: true, credits_used: user.credits_used as number, credits_limit: FREE_CREDITS_LIMIT, unlimited: true };
  }

  const activePromo = await env.DB.prepare(
    `SELECT 1
     FROM promo_redemptions
     WHERE user_id = ? AND expires_at > datetime('now')
     LIMIT 1`
  ).bind(userId).first();

  if (activePromo) {
    return { allowed: true, credits_used: user.credits_used as number, credits_limit: FREE_CREDITS_LIMIT, unlimited: true };
  }

  const creditsUsed = (user.credits_used as number) || 0;

  if (creditsUsed + cost > FREE_CREDITS_LIMIT) {
    return { allowed: false, credits_used: creditsUsed, credits_limit: FREE_CREDITS_LIMIT, unlimited: false };
  }

  // Deduct a credit
  await env.DB.prepare(
    "UPDATE users SET credits_used = credits_used + ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(cost, userId).run();

  const newCreditsUsed = creditsUsed + cost;

  // Send one-time email when the 5th (last) free credit is consumed
  if (newCreditsUsed >= FREE_CREDITS_LIMIT && !user.credits_exhausted_email_sent) {
    // Fire and forget: don't block the response
    sendCreditsExhaustedEmail(env, user.email as string, user.name as string | null)
      .then(() => {
        return env.DB.prepare(
          'UPDATE users SET credits_exhausted_email_sent = 1 WHERE id = ?'
        ).bind(userId).run();
      })
      .catch((err) => console.error('Credits exhausted email failed:', err));
  }

  return { allowed: true, credits_used: newCreditsUsed, credits_limit: FREE_CREDITS_LIMIT, unlimited: false };
}

// A free credit pays for a result, not for an attempt. Until 2026-09-18 the
// credit was deducted before the handler ran and never given back, so a
// DataForSEO error, a Worker exception or an empty result set (a Thai seed
// sent with location US / language English returns zero ideas) each burned
// one of the five free tools with nothing to show for it (bugs 973ffe0c,
// 626f52f4). Refund whenever the gated handler failed or returned nothing.
export async function refundCredit(env: Env, userId: string, cost = 1): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET credits_used = MAX(credits_used - ?, 0), updated_at = datetime('now') WHERE id = ?"
  ).bind(cost, userId).run();
}

// True when a gated response carried no usable result. Non-2xx is always a
// refund. A DataForSEO envelope (top-level `tasks`) is a refund when the task
// failed or its result has no items; any other JSON shape is the handler's
// own payload and counts as delivered.
export function shouldRefundCredit(status: number, body: unknown): boolean {
  if (status >= 400) return true;
  if (!body || typeof body !== 'object') return false;
  const tasks = (body as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return false;
  const task = tasks[0] as { status_code?: number; result?: unknown } | undefined;
  if (!task) return true;
  if (typeof task.status_code === 'number' && task.status_code !== 20000) return true;
  const result = task.result;
  if (result == null) return true;
  if (Array.isArray(result)) {
    if (result.length === 0) return true;
    const first = result[0] as { items?: unknown; items_count?: unknown } | null;
    if (first && typeof first === 'object') {
      if ('items' in first && (first.items == null || (Array.isArray(first.items) && first.items.length === 0))) return true;
      if (first.items_count === 0) return true;
    }
  }
  return false;
}
