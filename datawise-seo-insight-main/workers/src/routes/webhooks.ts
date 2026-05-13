import type { Env } from '../index';
import { sendWelcomeEmail } from '../email/resend';
import { cancelUserSequences } from '../email/sequences';
import { upgradeUserToCommunityIfMember } from '../lib/tier-changes';

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

  // 1. Upsert community_members (source of truth for paid membership)
  await env.DB.prepare(
    `INSERT OR REPLACE INTO community_members (email, first_name, last_name, tier, joined_date)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(email, firstName, lastName, tier, joinedAt).run();

  // 2. If a DataWise user already exists with this email, upgrade them
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE lower(email) = ?'
  ).bind(email).first<{ id: string }>();

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
