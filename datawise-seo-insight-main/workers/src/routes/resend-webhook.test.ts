import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { handleResendWebhook, verifySvixSignature, applyResendEvent } from './resend-webhook';
import { canEmail } from '../email/suppression';
import type { Env } from '../index';

// A real whsec_ secret is base64 after the prefix.
const RAW_KEY = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const SECRET = `whsec_${RAW_KEY}`;

let env: Env;
let raw: ReturnType<typeof createTestDb>['raw'];

function seedUser(id: string, email: string) {
  raw
    .prepare('INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)')
    .run(id, `google-${id}`, email, 'Test User');
}

function seedDueSequence(userId: string) {
  raw
    .prepare(
      `INSERT INTO email_sequences (user_id, sequence_type, current_step, next_send_at)
       VALUES (?, 'credits_exhausted', 1, datetime('now'))`
    )
    .run(userId);
}

function activeSequences(userId: string): number {
  const row = raw
    .prepare('SELECT COUNT(*) AS n FROM email_sequences WHERE user_id = ? AND cancelled = 0')
    .get(userId) as { n: number };
  return row.n;
}

function suppressionFor(email: string): { scope: string; reason: string } | undefined {
  return raw.prepare('SELECT scope, reason FROM email_suppressions WHERE email = ?').get(email) as never;
}

/** Sign exactly the way Svix does, so the tests exercise the real path. */
async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const bin = atob(RAW_KEY);
  const keyBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) keyBytes[i] = bin.charCodeAt(i);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  );
  let out = '';
  const bytes = new Uint8Array(mac);
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return btoa(out);
}

async function post(
  event: unknown,
  opts: { skewSeconds?: number; tamperBody?: boolean; badSig?: boolean; omitHeaders?: boolean } = {}
): Promise<Response> {
  const body = JSON.stringify(event);
  const id = 'msg_2KWr3';
  const ts = String(Math.floor(Date.now() / 1000) + (opts.skewSeconds ?? 0));
  const sig = opts.badSig ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' : await sign(id, ts, body);

  const headers: Record<string, string> = opts.omitHeaders
    ? { 'Content-Type': 'application/json' }
    : {
        'Content-Type': 'application/json',
        'svix-id': id,
        'svix-timestamp': ts,
        'svix-signature': `v1,${sig}`,
      };

  return handleResendWebhook(
    new Request('https://api.example.com/webhooks/resend', {
      method: 'POST',
      headers,
      body: opts.tamperBody ? body.replace('"', '" ') : body,
    }),
    env
  );
}

beforeEach(() => {
  const db = createTestDb();
  raw = db.raw;
  env = { DB: db.d1, RESEND_WEBHOOK_SECRET: SECRET } as unknown as Env;
});

describe('Svix signature verification', () => {
  const now = 1_700_000_000;

  it('accepts a correctly signed payload', async () => {
    const body = '{"type":"contact.updated"}';
    const sig = await sign('msg_1', String(now), body);
    expect(
      await verifySvixSignature(
        SECRET,
        { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` },
        body,
        now
      )
    ).toBe(true);
  });

  it('accepts when the header carries several signatures and one matches', async () => {
    const body = '{"type":"contact.updated"}';
    const sig = await sign('msg_1', String(now), body);
    expect(
      await verifySvixSignature(
        SECRET,
        { id: 'msg_1', timestamp: String(now), signature: `v1,AAAA= v1,${sig}` },
        body,
        now
      )
    ).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const body = '{"type":"contact.updated"}';
    const sig = await sign('msg_1', String(now), body);
    expect(
      await verifySvixSignature(
        SECRET,
        { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` },
        body + ' ',
        now
      )
    ).toBe(false);
  });

  it('rejects a stale timestamp (replay)', async () => {
    const stale = now - 10 * 60;
    const body = '{"type":"contact.updated"}';
    const sig = await sign('msg_1', String(stale), body);
    expect(
      await verifySvixSignature(
        SECRET,
        { id: 'msg_1', timestamp: String(stale), signature: `v1,${sig}` },
        body,
        now
      )
    ).toBe(false);
  });

  it('rejects a timestamp far in the future', async () => {
    const future = now + 10 * 60;
    const body = '{"type":"contact.updated"}';
    const sig = await sign('msg_1', String(future), body);
    expect(
      await verifySvixSignature(
        SECRET,
        { id: 'msg_1', timestamp: String(future), signature: `v1,${sig}` },
        body,
        now
      )
    ).toBe(false);
  });

  it('rejects missing headers, an unknown version, and an empty secret', async () => {
    const body = '{}';
    const sig = await sign('msg_1', String(now), body);
    expect(await verifySvixSignature(SECRET, { id: null, timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: null, signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: String(now), signature: null }, body, now)).toBe(false);
    expect(await verifySvixSignature(SECRET, { id: 'msg_1', timestamp: String(now), signature: `v2,${sig}` }, body, now)).toBe(false);
    expect(await verifySvixSignature('', { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(false);
  });

  it('rejects a non-numeric timestamp', async () => {
    expect(
      await verifySvixSignature(SECRET, { id: 'a', timestamp: 'not-a-number', signature: 'v1,x' }, '{}', now)
    ).toBe(false);
  });
});

describe('handleResendWebhook transport', () => {
  it('401s an unsigned request and writes nothing', async () => {
    const res = await post({ type: 'email.complained', data: { to: ['x@example.com'] } }, { omitHeaders: true });
    expect(res.status).toBe(401);
    expect(suppressionFor('x@example.com')).toBeUndefined();
  });

  it('401s a bad signature and writes nothing', async () => {
    const res = await post({ type: 'email.complained', data: { to: ['x@example.com'] } }, { badSig: true });
    expect(res.status).toBe(401);
    expect(suppressionFor('x@example.com')).toBeUndefined();
  });

  it('401s when the body was altered in transit', async () => {
    const res = await post({ type: 'email.complained', data: { to: ['x@example.com'] } }, { tamperBody: true });
    expect(res.status).toBe(401);
  });

  it('200s an unknown event type so Resend stops retrying', async () => {
    const res = await post({ type: 'email.opened', data: { to: ['x@example.com'] } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: 'ignored', reason: 'unhandled_type' });
  });

  it('200s an event with no address', async () => {
    const res = await post({ type: 'email.complained', data: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: 'ignored', reason: 'no_email' });
  });
});

describe('event mapping', () => {
  it('contact.updated with unsubscribed=true suppresses marketing and cancels the drip', async () => {
    seedUser('u1', 'gone@example.com');
    seedDueSequence('u1');

    const res = await post({
      type: 'contact.updated',
      data: { email: 'gone@example.com', unsubscribed: true },
    });

    expect(res.status).toBe(200);
    expect(suppressionFor('gone@example.com')).toMatchObject({ scope: 'marketing', reason: 'unsubscribe' });
    expect(activeSequences('u1')).toBe(0);
    expect(await canEmail(env, 'gone@example.com', 'marketing')).toBe(false);
    expect(await canEmail(env, 'gone@example.com', 'transactional')).toBe(true);
  });

  it('contact.updated with unsubscribed=false lifts a plain unsubscribe', async () => {
    await post({ type: 'contact.updated', data: { email: 'back@example.com', unsubscribed: true } });
    expect(await canEmail(env, 'back@example.com', 'marketing')).toBe(false);

    const res = await post({
      type: 'contact.updated',
      data: { email: 'back@example.com', unsubscribed: false },
    });

    expect(await res.json()).toMatchObject({ action: 'unsuppressed' });
    expect(await canEmail(env, 'back@example.com', 'marketing')).toBe(true);
  });

  it('contact.updated with unsubscribed=false never resurrects a complaint', async () => {
    await post({ type: 'email.complained', data: { to: ['angry@example.com'] } });

    const res = await post({
      type: 'contact.updated',
      data: { email: 'angry@example.com', unsubscribed: false },
    });

    expect(await res.json()).toMatchObject({ action: 'ignored', reason: 'not_a_plain_unsubscribe' });
    expect(await canEmail(env, 'angry@example.com', 'marketing')).toBe(false);
  });

  it('email.complained suppresses marketing but leaves password resets working', async () => {
    const res = await post({ type: 'email.complained', data: { to: ['spam@example.com'] } });
    expect(res.status).toBe(200);
    expect(suppressionFor('spam@example.com')).toMatchObject({ scope: 'marketing', reason: 'complaint' });
    expect(await canEmail(env, 'spam@example.com', 'transactional')).toBe(true);
  });

  it('suppression.added suppresses marketing', async () => {
    await post({ type: 'suppression.added', data: { email: 'sup@example.com' } });
    expect(suppressionFor('sup@example.com')).toMatchObject({ scope: 'marketing', reason: 'manual' });
  });

  it('a Permanent bounce blocks everything', async () => {
    await post({
      type: 'email.bounced',
      data: { to: ['dead@example.com'], bounce: { type: 'Permanent', subType: 'Suppressed' } },
    });

    expect(suppressionFor('dead@example.com')).toMatchObject({ scope: 'all', reason: 'bounce' });
    expect(await canEmail(env, 'dead@example.com', 'transactional')).toBe(false);
  });

  it('a Temporary bounce is ignored entirely', async () => {
    // A full mailbox must not permanently kill password resets.
    const res = await post({
      type: 'email.bounced',
      data: { to: ['full@example.com'], bounce: { type: 'Temporary', subType: 'MailboxFull' } },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ action: 'ignored', reason: 'bounce_temporary' });
    expect(suppressionFor('full@example.com')).toBeUndefined();
    expect(await canEmail(env, 'full@example.com', 'marketing')).toBe(true);
  });

  it('a bounce with no type is ignored rather than assumed permanent', async () => {
    const res = await post({ type: 'email.bounced', data: { to: ['mystery@example.com'] } });
    expect(await res.json()).toMatchObject({ action: 'ignored', reason: 'bounce_unknown' });
    expect(suppressionFor('mystery@example.com')).toBeUndefined();
  });

  it('handles multiple recipients on one event', async () => {
    await post({ type: 'email.complained', data: { to: ['a@example.com', 'b@example.com'] } });
    expect(suppressionFor('a@example.com')).toBeTruthy();
    expect(suppressionFor('b@example.com')).toBeTruthy();
  });

  it('canonicalizes the address, so a gmail alias suppresses the real inbox', async () => {
    seedUser('u2', 'Sam.Smith+dw@gmail.com');
    seedDueSequence('u2');

    await post({ type: 'contact.updated', data: { email: 'Sam.Smith+dw@gmail.com', unsubscribed: true } });

    expect(suppressionFor('samsmith@gmail.com')).toBeTruthy();
    expect(await canEmail(env, 'samsmith@gmail.com', 'marketing')).toBe(false);
  });

  it('a complaint escalating to a permanent bounce ends up scope=all', async () => {
    await post({ type: 'email.complained', data: { to: ['both@example.com'] } });
    await post({
      type: 'email.bounced',
      data: { to: ['both@example.com'], bounce: { type: 'Permanent' } },
    });
    expect(suppressionFor('both@example.com')).toMatchObject({ scope: 'all' });
  });

  it('is idempotent across redelivery', async () => {
    const event = { type: 'email.complained', data: { to: ['dupe@example.com'] } };
    await post(event);
    await post(event);
    const n = raw.prepare('SELECT COUNT(*) AS n FROM email_suppressions').get() as { n: number };
    expect(n.n).toBe(1);
  });
});

describe('applyResendEvent tolerates odd payloads', () => {
  it('accepts a bare string in data.to', async () => {
    const r = await applyResendEvent(env, {
      type: 'email.complained',
      data: { to: 'string@example.com' },
    });
    expect(r.action).toBe('suppressed');
  });

  it('ignores a missing data object', async () => {
    const r = await applyResendEvent(env, { type: 'email.complained' });
    expect(r.action).toBe('ignored');
  });

  it('ignores a missing type', async () => {
    const r = await applyResendEvent(env, { data: { email: 'x@example.com' } });
    expect(r.action).toBe('ignored');
  });
});
