import type { Env } from '../index';
import { sendWelcomeEmail } from '../email/resend';
import { cancelUserSequences } from '../email/sequences';
import { logTierChange, upgradeUserToCommunityIfMember } from '../lib/tier-changes';
import { startWinbackSequence } from '../email/sequences';
import { normalizeEmail } from '../lib/email-normalize';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

async function verifyBearer(request: Request, env: Env): Promise<boolean> {
  const secret = env.SKOOL_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const enc = new TextEncoder();
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(match[1])));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(secret)));
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

interface SkoolWebhookBody {
  email?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  tier?: string;
  joined_at?: string;
  skool_user_id?: string;
}

export async function handleSkoolMemberJoined(request: Request, env: Env): Promise<Response> {
  if (!(await verifyBearer(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: SkoolWebhookBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'missing_email' }, 400);
  }

  const firstName = body.first_name?.trim() || null;
  const lastName = body.last_name?.trim() || null;
  const fullName =
    body.name?.trim() ||
    [firstName, lastName].filter(Boolean).join(' ') ||
    null;
  const tier = body.tier?.trim() || 'community';
  const joinedAt = body.joined_at || new Date().toISOString();

  // 1. Upsert community_members. source='webhook' rows are durable: the admin
  // CSV upload preserves them even when the Skool export misses this email.
  // A re-fire over an existing row refreshes the profile fields but keeps the
  // row's current source.
  await env.DB.prepare(
    `INSERT INTO community_members (email, first_name, last_name, tier, joined_date, source, normalized_email)
     VALUES (?, ?, ?, ?, ?, 'webhook', ?)
     ON CONFLICT(email) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       tier = excluded.tier,
       joined_date = excluded.joined_date,
       normalized_email = excluded.normalized_email`
  ).bind(email, firstName, lastName, tier, joinedAt, normalizeEmail(email)).run();

  // 2. If a DataWise user already exists with this email (or a provider-alias
  // variant of it, e.g. gmail dots), upgrade them
  let existing = await env.DB.prepare(
    'SELECT id FROM users WHERE lower(email) = ?'
  ).bind(email).first<{ id: string }>();
  if (!existing) {
    const normalized = normalizeEmail(email);
    const { results: candidates } = await env.DB.prepare(
      'SELECT id, email FROM users'
    ).all<{ id: string; email: string }>();
    const match = (candidates || []).find(u => normalizeEmail(String(u.email || '')) === normalized);
    if (match) existing = { id: match.id };
  }

  let userUpgraded = false;
  if (existing) {
    const upgrade = await upgradeUserToCommunityIfMember(env, existing.id, email, 'skool_webhook');
    userUpgraded = upgrade.changed || upgrade.preservedPro;
    // Cancel any in-flight credit-exhausted drip sequence — they're a member now
    try {
      await cancelUserSequences(env, existing.id);
    } catch (err) {
      console.error('cancelUserSequences failed:', err);
    }
  }

  // 3. Send the welcome email via existing Resend template
  const emailSent = await sendWelcomeEmail(env, email, fullName);

  return json({
    ok: true,
    email,
    user_upgraded: userUpgraded,
    user_exists: !!existing,
    email_sent: emailSent,
  });
}

// POST /webhooks/skool-member-left
// The explicit revocation path for webhook/manual roster rows, which CSV
// uploads deliberately preserve. Wire Skool's "member left/cancelled" Zapier
// trigger here with the same Bearer secret as skool-member-joined.
export async function handleSkoolMemberLeft(request: Request, env: Env): Promise<Response> {
  if (!(await verifyBearer(request, env))) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: SkoolWebhookBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const email = (body.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'missing_email' }, 400);
  }
  const normalized = normalizeEmail(email);

  const removed = await env.DB.prepare(
    'DELETE FROM community_members WHERE lower(email) = ? OR normalized_email = ?'
  ).bind(email, normalized).run();

  // Downgrade the matching member account (never admins; pro keeps pro).
  const { results: members } = await env.DB.prepare(
    "SELECT id, email, subscription_tier, is_admin FROM users WHERE is_community_member = 1 OR subscription_tier = 'community'"
  ).all<{ id: string; email: string; subscription_tier: string | null; is_admin: number | null }>();

  let downgraded = 0;
  for (const u of members || []) {
    const uEmail = String(u.email || '').trim().toLowerCase();
    if (uEmail !== email && normalizeEmail(uEmail) !== normalized) continue;
    if (u.is_admin === 1) continue;

    if ((u.subscription_tier || 'free') === 'pro') {
      await env.DB.prepare(
        "UPDATE users SET is_community_member = 0, updated_at = datetime('now') WHERE id = ?"
      ).bind(u.id).run();
    } else {
      await logTierChange(env.DB, u.id, u.subscription_tier || 'free', 'free', 'skool_webhook_left');
      await env.DB.prepare(
        "UPDATE users SET subscription_tier = 'free', is_community_member = 0, updated_at = datetime('now') WHERE id = ?"
      ).bind(u.id).run();
      await startWinbackSequence(env, u.id);
    }
    downgraded++;
  }

  return json({
    ok: true,
    email,
    roster_rows_removed: removed.meta.changes ?? 0,
    users_downgraded: downgraded,
  });
}
