import type { Env } from '../index';

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

  const communityMember = await env.DB.prepare(
    'SELECT email FROM community_members WHERE lower(email) = ?'
  ).bind(cleanEmail).first();
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
