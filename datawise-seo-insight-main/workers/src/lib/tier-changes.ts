import type { Env } from '../index';
import { normalizeEmail } from './email-normalize';

// Roster lookup used by every grant path. Matches the exact lower-cased email
// or its canonical form (gmail dots / +tags collapsed), so a member whose
// Skool email is a provider alias of their login email still matches. Rows
// written before normalized_email existed match through the lower(email) arm.
export async function findCommunityMemberByEmail(
  db: D1Database,
  email: string,
): Promise<{ email: string } | null> {
  const lower = (email || '').trim().toLowerCase();
  if (!lower) return null;
  const normalized = normalizeEmail(lower);

  const direct = await db.prepare(
    'SELECT email FROM community_members WHERE lower(email) = ? OR normalized_email = ? LIMIT 1'
  ).bind(lower, normalized).first<{ email: string }>();
  if (direct) return direct;

  // Third arm: an admin-confirmed link from this login email to the roster
  // email of the same person, for members who joined Skool as one address and
  // signed up here as another. Resolving it HERE rather than at link time is
  // what makes the grant durable: every login re-derives it, so a later CSV
  // upload or revoke sweep cannot silently strip access.
  return await db.prepare(
    `SELECT cm.email FROM community_email_aliases a
       JOIN community_members cm
         ON lower(cm.email) = lower(a.member_email)
         OR cm.normalized_email = a.member_normalized
      WHERE lower(a.alias_email) = ? OR a.alias_normalized = ?
      LIMIT 1`
  ).bind(lower, normalized).first<{ email: string }>();
}

export async function logTierChange(
  db: D1Database,
  userId: string,
  fromTier: string,
  toTier: string,
  source: string,
): Promise<void> {
  if (fromTier === toTier) return;
  await db.prepare(
    'INSERT INTO tier_changes (user_id, from_tier, to_tier, source) VALUES (?, ?, ?, ?)'
  ).bind(userId, fromTier, toTier, source).run();
}

export async function logBulkTierChanges(
  db: D1Database,
  users: Array<{ id: string; tier: string }>,
  toTier: string,
  source: string,
): Promise<void> {
  const changed = users.filter(u => u.tier !== toTier);
  if (changed.length === 0) return;
  const BATCH_SIZE = 80;
  const stmts = changed.map(u =>
    db.prepare(
      'INSERT INTO tier_changes (user_id, from_tier, to_tier, source) VALUES (?, ?, ?, ?)'
    ).bind(u.id, u.tier, toTier, source)
  );
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await db.batch(stmts.slice(i, i + BATCH_SIZE));
  }
}

export interface CommunityUpgradeResult {
  matched: boolean;
  changed: boolean;
  preservedPro: boolean;
}

export async function upgradeUserToCommunityIfMember(
  env: Pick<Env, 'DB'>,
  userId: string,
  email: string,
  source: string,
): Promise<CommunityUpgradeResult> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    return { matched: false, changed: false, preservedPro: false };
  }

  const communityMember = await findCommunityMemberByEmail(env.DB, cleanEmail);
  if (!communityMember) {
    return { matched: false, changed: false, preservedPro: false };
  }

  const current = await env.DB.prepare(
    'SELECT subscription_tier, is_community_member FROM users WHERE id = ?'
  ).bind(userId).first<{ subscription_tier: string; is_community_member: number }>();
  if (!current) {
    return { matched: true, changed: false, preservedPro: false };
  }

  const fromTier = current.subscription_tier || 'free';
  const isCommunityMember = current.is_community_member === 1;

  if (fromTier === 'pro') {
    if (!isCommunityMember) {
      await env.DB.prepare(
        "UPDATE users SET is_community_member = 1, updated_at = datetime('now') WHERE id = ?"
      ).bind(userId).run();
    }
    return { matched: true, changed: false, preservedPro: true };
  }

  if (fromTier === 'community' && isCommunityMember) {
    return { matched: true, changed: false, preservedPro: false };
  }

  await logTierChange(env.DB, userId, fromTier, 'community', source);
  await env.DB.prepare(
    "UPDATE users SET is_community_member = 1, subscription_tier = 'community', updated_at = datetime('now') WHERE id = ?"
  ).bind(userId).run();

  return { matched: true, changed: true, preservedPro: false };
}
