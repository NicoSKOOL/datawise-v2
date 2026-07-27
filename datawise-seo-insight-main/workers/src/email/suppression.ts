// Global email opt-out gate.
//
// Every send path except password reset must pass through canEmail() before
// touching the Resend API. Three sources write here: our own unsubscribe
// endpoint, Resend webhooks (Phase 2), and admin action.
//
// Addresses are stored in canonical form (src/lib/email-normalize.ts), matching
// banned_emails: "+tags" and gmail dots collapse, so an opt-out cannot be
// bypassed by mailing an alias of the same inbox.
import type { Env } from '../index';
import { normalizeEmail } from '../lib/email-normalize';

export type EmailKind = 'transactional' | 'marketing';
export type SuppressionScope = 'marketing' | 'all';
export type SuppressionReason = 'unsubscribe' | 'complaint' | 'bounce' | 'manual';

export interface SuppressOptions {
  scope?: SuppressionScope;
  reason: SuppressionReason;
  source?: string;
  userId?: string | null;
}

/**
 * The single gate every send path must pass through.
 *
 * 'transactional' (password reset, welcome, invite) stays allowed for someone
 * who opted out of marketing: they explicitly asked for that specific email.
 * scope 'all' blocks everything, since it only gets set on a permanent bounce
 * where the mailbox does not exist and sending is pointless.
 */
export async function canEmail(env: Env, email: string, kind: EmailKind): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT scope FROM email_suppressions WHERE email = ?'
  )
    .bind(normalizeEmail(email))
    .first<{ scope: string }>();

  if (!row) return true;
  if (row.scope === 'all') return false;
  return kind === 'transactional';
}

/**
 * Record an opt-out. Scope can escalate from 'marketing' to 'all' but never
 * silently downgrade: re-suppressing a dead address must not quietly re-enable
 * password resets to it.
 */
export async function suppress(env: Env, email: string, opts: SuppressOptions): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO email_suppressions (email, scope, reason, source, user_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       scope = CASE
         WHEN excluded.scope = 'all' OR email_suppressions.scope = 'all' THEN 'all'
         ELSE excluded.scope
       END,
       reason = excluded.reason,
       source = excluded.source,
       user_id = COALESCE(excluded.user_id, email_suppressions.user_id)`
  )
    .bind(
      normalizeEmail(email),
      opts.scope ?? 'marketing',
      opts.reason,
      opts.source ?? null,
      opts.userId ?? null
    )
    .run();
}

/**
 * Remove an opt-out. Only ever call this for a row whose reason is
 * 'unsubscribe': a bounce or spam complaint must never be resurrected by a
 * later "resubscribed" signal. Returns true when a row was actually removed.
 */
export async function unsuppress(env: Env, email: string): Promise<boolean> {
  const res = await env.DB.prepare(
    "DELETE FROM email_suppressions WHERE email = ? AND reason = 'unsubscribe'"
  )
    .bind(normalizeEmail(email))
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

// ── Unsubscribe link signing ──────────────────────────────────────────
//
// The unsubscribe URL is public and unauthenticated, so it carries an HMAC over
// the canonical address. Without it, anyone could unsubscribe an arbitrary
// address by editing the query string.

const enc = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
    .slice(0, 32);
}

export function signUnsubscribeToken(secret: string, email: string): Promise<string> {
  return hmac(secret, normalizeEmail(email));
}

export async function verifyUnsubscribeToken(
  secret: string,
  email: string,
  token: string
): Promise<boolean> {
  if (!secret || !token) return false;
  const expected = await signUnsubscribeToken(secret, email);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Full unsubscribe URL for a recipient, safe to embed in an email.
 *
 * `userId` is optional and NOT security-critical: the HMAC covers the address
 * only. It lets the handler cancel that user's in-flight sequences immediately
 * instead of waiting for the next cron tick to notice the suppression, and it
 * is re-verified against the address before being trusted.
 */
export async function unsubscribeUrlFor(
  env: Env,
  email: string,
  userId?: string | null
): Promise<string> {
  const canonical = normalizeEmail(email);
  const t = await signUnsubscribeToken(env.UNSUBSCRIBE_SECRET, canonical);
  const uid = userId ? `&uid=${encodeURIComponent(userId)}` : '';
  return `${env.WORKER_URL}/api/unsubscribe?e=${encodeURIComponent(canonical)}&t=${t}${uid}`;
}
