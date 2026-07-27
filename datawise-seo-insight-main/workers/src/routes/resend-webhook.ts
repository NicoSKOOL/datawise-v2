// Resend webhook receiver.
//
// Closes the loop between Resend's own opt-out state and ours: someone who
// unsubscribes from a Resend Broadcast, marks us as spam, or hard-bounces must
// also stop receiving the D1-driven sequences in src/email/sequences.ts.
// Without this, the two systems drift and a broadcast unsubscribe keeps getting
// the credits drip.
//
// Signed with Svix headers (svix-id, svix-timestamp, svix-signature).
// Verification, per https://docs.svix.com/receiving/verifying-payloads/how-manual:
//   signed content = `${svix-id}.${svix-timestamp}.${rawBody}`
//   key            = base64-decode(secret without the `whsec_` prefix)
//   signature      = base64(HMAC-SHA256(key, signed content))
//   header format  = `v1,<sig> v1,<sig>` (space-delimited, may carry several)
import type { Env } from '../index';
import { suppress, unsuppress } from '../email/suppression';
import { cancelUserSequences } from '../email/sequences';
import { normalizeEmail } from '../lib/email-normalize';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// Reject anything older (or further in the future) than this to blunt replays.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySvixSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  nowSeconds: number
): Promise<boolean> {
  if (!secret) return false;
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSeconds - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  let keyBytes: Uint8Array;
  try {
    keyBytes = base64ToBytes(secret.replace(/^whsec_/, ''));
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`)
  );
  const expected = bytesToBase64(new Uint8Array(mac));

  // The header may carry several versioned signatures; any match is enough.
  for (const part of signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    if (constantTimeEquals(expected, sig)) return true;
  }
  return false;
}

// ── Event payloads ────────────────────────────────────────────────────

interface ResendEvent {
  type?: string;
  data?: {
    email?: string;
    to?: string[] | string;
    unsubscribed?: boolean;
    bounce?: { type?: string; subType?: string };
  };
}

/**
 * Addresses this event is about. contact.* events carry `data.email`; email.*
 * events carry `data.to`, which may be an array or a bare string.
 */
function extractEmails(event: ResendEvent): string[] {
  const out: string[] = [];
  const d = event.data ?? {};
  if (typeof d.email === 'string' && d.email.includes('@')) out.push(d.email);
  if (Array.isArray(d.to)) {
    for (const t of d.to) if (typeof t === 'string' && t.includes('@')) out.push(t);
  } else if (typeof d.to === 'string' && d.to.includes('@')) {
    out.push(d.to);
  }
  return [...new Set(out.map(normalizeEmail))];
}

/** Stop any in-flight D1 drip for whoever owns this address. Best effort. */
async function cancelSequencesForEmail(env: Env, canonicalEmail: string): Promise<void> {
  const row = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?')
    .bind(canonicalEmail)
    .first<{ id: string }>();
  if (row?.id) await cancelUserSequences(env, row.id);
}

export interface WebhookResult {
  handled: boolean;
  action: 'suppressed' | 'unsuppressed' | 'ignored';
  reason?: string;
  emails: string[];
}

export async function applyResendEvent(env: Env, event: ResendEvent): Promise<WebhookResult> {
  const type = event.type ?? '';
  const emails = extractEmails(event);

  if (!emails.length) return { handled: false, action: 'ignored', reason: 'no_email', emails };

  const suppressAll = async (
    reason: 'unsubscribe' | 'complaint' | 'bounce' | 'manual',
    scope: 'marketing' | 'all'
  ): Promise<WebhookResult> => {
    for (const email of emails) {
      await suppress(env, email, { reason, scope, source: `resend:${type}` });
      await cancelSequencesForEmail(env, email);
    }
    return { handled: true, action: 'suppressed', reason, emails };
  };

  switch (type) {
    case 'contact.updated':
      if (event.data?.unsubscribed === true) {
        return suppressAll('unsubscribe', 'marketing');
      }
      if (event.data?.unsubscribed === false) {
        // Only lifts a plain unsubscribe. unsuppress() refuses to delete a
        // complaint or bounce row, so a "resubscribed" signal can never
        // resurrect an address that burned us.
        let lifted = false;
        for (const email of emails) {
          if (await unsuppress(env, email)) lifted = true;
        }
        return {
          handled: true,
          action: lifted ? 'unsuppressed' : 'ignored',
          reason: lifted ? 'resubscribed' : 'not_a_plain_unsubscribe',
          emails,
        };
      }
      return { handled: false, action: 'ignored', reason: 'no_unsubscribed_field', emails };

    case 'suppression.added':
      return suppressAll('manual', 'marketing');

    case 'email.complained':
      return suppressAll('complaint', 'marketing');

    case 'email.bounced': {
      // Only a permanent bounce means the mailbox does not exist. A temporary
      // bounce (full mailbox, greylisting) must NOT permanently kill the
      // address: that would block password resets for a transient condition.
      const bounceType = (event.data?.bounce?.type ?? '').toLowerCase();
      if (bounceType !== 'permanent') {
        return { handled: false, action: 'ignored', reason: `bounce_${bounceType || 'unknown'}`, emails };
      }
      return suppressAll('bounce', 'all');
    }

    default:
      // Unknown event types must still 200, or Resend retries them forever.
      return { handled: false, action: 'ignored', reason: 'unhandled_type', emails };
  }
}

export async function handleResendWebhook(request: Request, env: Env): Promise<Response> {
  // Read the body as raw text exactly once: the signature covers these bytes,
  // so parsing and re-stringifying would invalidate it.
  const rawBody = await request.text();

  const ok = await verifySvixSignature(
    env.RESEND_WEBHOOK_SECRET,
    {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
    rawBody,
    Math.floor(Date.now() / 1000)
  );
  if (!ok) return json({ error: 'invalid_signature' }, 401);

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  try {
    const result = await applyResendEvent(env, event);
    console.log(
      `Resend webhook ${event.type}: ${result.action} (${result.reason ?? 'ok'}) for ${result.emails.length} address(es)`
    );
    return json({ ok: true, ...result });
  } catch (err) {
    console.error('Resend webhook handler failed:', err);
    // 500 so Resend retries: a dropped suppression is a compliance problem.
    return json({ error: 'handler_failed' }, 500);
  }
}
