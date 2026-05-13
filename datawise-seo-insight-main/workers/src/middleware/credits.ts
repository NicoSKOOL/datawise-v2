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

  const creditsUsed = (user.credits_used as number) || 0;

  if (creditsUsed + cost > FREE_CREDITS_LIMIT) {
    return { allowed: false, credits_used: creditsUsed, credits_limit: FREE_CREDITS_LIMIT, unlimited: false };
  }

  // Deduct a credit
  await env.DB.prepare(
    'UPDATE users SET credits_used = credits_used + ?, updated_at = datetime("now") WHERE id = ?'
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
