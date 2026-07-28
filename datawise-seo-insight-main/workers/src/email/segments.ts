// Segment computation.
//
// This is the load-bearing idea of the whole marketing-email design: segment
// membership is decided HERE, in SQL, and pushed to Resend as a precomputed
// value. Resend never evaluates a rule on our behalf. That keeps all the real
// logic (joins against subscriptions, tier_changes, activity windows) in the
// place that actually knows the answer, and means richer segments later are a
// SQL change with no vendor work.
import type { Env } from '../index';

/**
 * Segment vocabulary. Deliberately small to start.
 *
 * Order matters: membership is checked before any credits-based branch, because
 * `credits_used` is meaningless for members (their access is unlimited, so the
 * counter never advances: 557 members, only 28 with a non-zero count).
 */
export type Segment = 'member' | 'free_unconverted' | 'free_inactive' | 'churned';

export const ALL_SEGMENTS: Segment[] = ['member', 'free_unconverted', 'free_inactive', 'churned'];

/** Human-facing names, used when creating the segments in Resend. */
export const SEGMENT_LABELS: Record<Segment, string> = {
  member: 'DataWise: Community members',
  free_unconverted: 'DataWise: Free, used credits',
  free_inactive: 'DataWise: Free, never activated',
  churned: 'DataWise: Churned members',
};

export interface SegmentRow {
  user_id: string;
  email: string;
  name: string | null;
  subscription_tier: string | null;
  is_community_member: number;
  credits_used: number;
  created_at: string | null;
  ever_member: number;
}

export interface ContactSnapshot {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  segment: Segment;
  properties: Record<string, string>;
}

export function computeSegment(row: SegmentRow): Segment {
  if (row.is_community_member === 1) return 'member';
  // Not a member now, but was at some point.
  if (row.ever_member === 1) return 'churned';
  return (row.credits_used ?? 0) > 0 ? 'free_unconverted' : 'free_inactive';
}

/** "Ada Lovelace" -> { first: "Ada", last: "Lovelace" }. Resend keeps them separate. */
export function splitName(name: string | null): { firstName: string; lastName: string } {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** YYYY-MM from an ISO-ish timestamp, for cohort filtering. */
export function signupMonth(createdAt: string | null): string {
  if (!createdAt || createdAt.length < 7) return '';
  return createdAt.slice(0, 7);
}

export function toContactSnapshot(row: SegmentRow): ContactSnapshot {
  const segment = computeSegment(row);
  const { firstName, lastName } = splitName(row.name);
  return {
    userId: row.user_id,
    email: row.email,
    firstName,
    lastName,
    segment,
    // Resend contact properties accept string or number only, keys are
    // alphanumeric + underscore, max 50 chars. Send everything as a string so
    // one code path covers both.
    properties: {
      dw_segment: segment,
      dw_tier: row.is_community_member === 1 ? 'community' : (row.subscription_tier || 'free'),
      dw_signup_month: signupMonth(row.created_at),
      dw_credits_used: String(row.credits_used ?? 0),
    },
  };
}

/**
 * One page of syncable users, ordered by id so the cursor is stable.
 *
 * Excludes banned accounts and anyone suppressed: a suppressed address must not
 * sit in a Resend segment where a broadcast could reach it. Removal of
 * already-synced contacts who later become suppressed is handled separately by
 * the sync (see collectDesyncTargets).
 */
export async function fetchSegmentPage(
  env: Env,
  afterUserId: string,
  limit: number
): Promise<SegmentRow[]> {
  const res = await env.DB.prepare(
    `SELECT u.id AS user_id,
            u.email,
            u.name,
            u.subscription_tier,
            u.is_community_member,
            COALESCE(u.credits_used, 0) AS credits_used,
            u.created_at,
            CASE WHEN EXISTS (
              SELECT 1 FROM tier_changes tc
              WHERE tc.user_id = u.id
                AND (tc.to_tier = 'community' OR tc.from_tier = 'community')
            ) THEN 1 ELSE 0 END AS ever_member
     FROM users u
     WHERE u.id > ?
       AND COALESCE(u.banned, 0) = 0
       AND u.email IS NOT NULL
       AND instr(u.email, '@') > 0
       AND NOT EXISTS (
         SELECT 1 FROM email_suppressions s WHERE s.email = lower(u.email)
       )
     ORDER BY u.id
     LIMIT ?`
  )
    .bind(afterUserId, limit)
    .all<SegmentRow>();
  return res.results ?? [];
}

/**
 * Contacts we have previously synced that must now be removed from Resend:
 * they became suppressed or banned since the last pass. Leaving them in a
 * segment would put an opted-out address back in a broadcast's path.
 */
export async function collectDesyncTargets(env: Env, limit: number): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT rcs.email
     FROM resend_contact_sync rcs
     WHERE EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = rcs.email)
        OR EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = rcs.email AND COALESCE(u.banned,0) = 1)
     LIMIT ?`
  )
    .bind(limit)
    .all<{ email: string }>();
  return (res.results ?? []).map((r) => r.email);
}

/** Stable fingerprint of everything we push, so unchanged contacts cost 0 API calls. */
export function propsFingerprint(snapshot: ContactSnapshot): string {
  const keys = Object.keys(snapshot.properties).sort();
  const props = keys.map((k) => `${k}=${snapshot.properties[k]}`).join('&');
  return `${snapshot.firstName}|${snapshot.lastName}|${snapshot.segment}|${props}`;
}
