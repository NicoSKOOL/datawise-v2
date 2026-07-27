import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { handleUnsubscribe } from './unsubscribe';
import { signUnsubscribeToken } from './suppression';
import type { Env } from '../index';

const SECRET = 'test-unsubscribe-secret';
const BASE = 'https://api.example.com/api/unsubscribe';

let env: Env;
let raw: ReturnType<typeof createTestDb>['raw'];

function seedUser(id: string, email: string) {
  raw
    .prepare('INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)')
    .run(id, `google-${id}`, email, 'Test User');
}

function seedSequence(userId: string) {
  raw
    .prepare(
      `INSERT INTO email_sequences (user_id, sequence_type, current_step, next_send_at)
       VALUES (?, 'credits_exhausted', 1, datetime('now'))`
    )
    .run(userId);
}

function suppressionRows(): Array<{ email: string; scope: string; reason: string; user_id: string | null }> {
  return raw.prepare('SELECT email, scope, reason, user_id FROM email_suppressions').all() as never;
}

function activeSequences(userId: string): number {
  const row = raw
    .prepare('SELECT COUNT(*) AS n FROM email_sequences WHERE user_id = ? AND cancelled = 0')
    .get(userId) as { n: number };
  return row.n;
}

beforeEach(() => {
  const db = createTestDb();
  raw = db.raw;
  env = {
    DB: db.d1,
    UNSUBSCRIBE_SECRET: SECRET,
    WORKER_URL: 'https://api.example.com',
  } as unknown as Env;
});

describe('GET must never mutate (link-scanner safety)', () => {
  it('renders a confirmation form for a valid signed link and writes nothing', async () => {
    seedUser('u1', 'person@example.com');
    seedSequence('u1');
    const t = await signUnsubscribeToken(SECRET, 'person@example.com');

    const res = await handleUnsubscribe(
      new Request(`${BASE}?e=person%40example.com&t=${t}`),
      env
    );
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<form method="POST"');
    expect(html).toContain('Yes, unsubscribe me');
    // The whole point of this rewrite:
    expect(suppressionRows()).toHaveLength(0);
    expect(activeSequences('u1')).toBe(1);
  });

  it('still honours legacy ?uid= links from already-delivered emails, without writing', async () => {
    seedUser('legacy-1', 'old@example.com');
    seedSequence('legacy-1');

    const res = await handleUnsubscribe(new Request(`${BASE}?uid=legacy-1`), env);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain('<form method="POST"');
    expect(html).toContain('old@example.com');
    expect(suppressionRows()).toHaveLength(0);
    expect(activeSequences('legacy-1')).toBe(1);
  });

  it('mints a working token for the legacy path so the form POST verifies', async () => {
    seedUser('legacy-2', 'old2@example.com');
    const getRes = await handleUnsubscribe(new Request(`${BASE}?uid=legacy-2`), env);
    const html = await getRes.text();

    const token = /name="t" value="([^"]+)"/.exec(html)?.[1];
    expect(token).toBeTruthy();

    const postRes = await handleUnsubscribe(
      new Request(`${BASE}?e=old2%40example.com&t=${token}`, { method: 'POST' }),
      env
    );
    expect(postRes.status).toBe(200);
    expect(suppressionRows()).toHaveLength(1);
  });

  it('rejects a tampered token with 400', async () => {
    seedUser('u2', 'person@example.com');
    const res = await handleUnsubscribe(
      new Request(`${BASE}?e=person%40example.com&t=notavalidtokenatall1234567890abc`),
      env
    );
    expect(res.status).toBe(400);
    expect(suppressionRows()).toHaveLength(0);
  });

  it('rejects a link with no parameters', async () => {
    const res = await handleUnsubscribe(new Request(BASE), env);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown legacy uid', async () => {
    const res = await handleUnsubscribe(new Request(`${BASE}?uid=does-not-exist`), env);
    expect(res.status).toBe(400);
  });
});

describe('POST performs the opt-out', () => {
  it('suppresses and cancels in-flight sequences', async () => {
    seedUser('u3', 'person@example.com');
    seedSequence('u3');
    const t = await signUnsubscribeToken(SECRET, 'person@example.com');

    const res = await handleUnsubscribe(
      new Request(`${BASE}?e=person%40example.com&t=${t}&uid=u3`, { method: 'POST' }),
      env
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You're unsubscribed");

    const rows = suppressionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'person@example.com',
      scope: 'marketing',
      reason: 'unsubscribe',
      user_id: 'u3',
    });
    expect(activeSequences('u3')).toBe(0);
  });

  it('accepts an RFC 8058 one-click POST (params in query, body is List-Unsubscribe=One-Click)', async () => {
    seedUser('u4', 'oneclick@example.com');
    const t = await signUnsubscribeToken(SECRET, 'oneclick@example.com');

    const res = await handleUnsubscribe(
      new Request(`${BASE}?e=oneclick%40example.com&t=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
      env
    );

    expect(res.status).toBe(200);
    expect(suppressionRows()).toHaveLength(1);
  });

  it('accepts the browser form POST (params in body)', async () => {
    seedUser('u5', 'formpost@example.com');
    const t = await signUnsubscribeToken(SECRET, 'formpost@example.com');

    const res = await handleUnsubscribe(
      new Request(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ e: 'formpost@example.com', t, uid: 'u5' }).toString(),
      }),
      env
    );

    expect(res.status).toBe(200);
    expect(suppressionRows()).toHaveLength(1);
    expect(suppressionRows()[0].user_id).toBe('u5');
  });

  it('writes nothing when the token is tampered', async () => {
    seedUser('u6', 'person@example.com');
    seedSequence('u6');

    const res = await handleUnsubscribe(
      new Request(`${BASE}?e=person%40example.com&t=0000000000000000000000000000000`, {
        method: 'POST',
      }),
      env
    );

    expect(res.status).toBe(400);
    expect(suppressionRows()).toHaveLength(0);
    expect(activeSequences('u6')).toBe(1);
  });

  it('ignores a uid that does not belong to the signed address', async () => {
    seedUser('victim', 'victim@example.com');
    seedUser('attacker', 'attacker@example.com');
    seedSequence('victim');
    const t = await signUnsubscribeToken(SECRET, 'attacker@example.com');

    // Attacker signs their own address but passes the victim's uid, trying to
    // get the victim's sequences cancelled.
    const res = await handleUnsubscribe(
      new Request(`${BASE}?e=attacker%40example.com&t=${t}&uid=victim`, { method: 'POST' }),
      env
    );

    expect(res.status).toBe(200);
    expect(suppressionRows()[0].email).toBe('attacker@example.com');
    expect(suppressionRows()[0].user_id).toBe('attacker');
    expect(activeSequences('victim')).toBe(1);
  });

  it('is idempotent', async () => {
    seedUser('u7', 'twice@example.com');
    const t = await signUnsubscribeToken(SECRET, 'twice@example.com');
    const req = () =>
      handleUnsubscribe(
        new Request(`${BASE}?e=twice%40example.com&t=${t}`, { method: 'POST' }),
        env
      );

    expect((await req()).status).toBe(200);
    expect((await req()).status).toBe(200);
    expect(suppressionRows()).toHaveLength(1);
  });

  it('suppresses via a gmail alias and blocks the canonical inbox', async () => {
    seedUser('u8', 'Alias.User+dw@gmail.com');
    const t = await signUnsubscribeToken(SECRET, 'aliasuser@gmail.com');

    const res = await handleUnsubscribe(
      new Request(`${BASE}?e=aliasuser%40gmail.com&t=${t}&uid=u8`, { method: 'POST' }),
      env
    );

    expect(res.status).toBe(200);
    const rows = suppressionRows();
    expect(rows[0].email).toBe('aliasuser@gmail.com');
    // uid resolution must survive canonicalization of the stored address.
    expect(rows[0].user_id).toBe('u8');
  });
});
