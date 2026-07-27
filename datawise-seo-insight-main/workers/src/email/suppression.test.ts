import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import {
  canEmail,
  suppress,
  unsuppress,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrlFor,
} from './suppression';
import type { Env } from '../index';

const SECRET = 'test-unsubscribe-secret';

function makeEnv(d1: D1Database): Env {
  return {
    DB: d1,
    UNSUBSCRIBE_SECRET: SECRET,
    WORKER_URL: 'https://api.example.com',
  } as unknown as Env;
}

describe('canEmail', () => {
  let env: Env;
  let raw: ReturnType<typeof createTestDb>['raw'];

  beforeEach(() => {
    const db = createTestDb();
    raw = db.raw;
    env = makeEnv(db.d1);
  });

  it('allows any address with no suppression row', async () => {
    expect(await canEmail(env, 'nobody@example.com', 'marketing')).toBe(true);
    expect(await canEmail(env, 'nobody@example.com', 'transactional')).toBe(true);
  });

  it("scope 'marketing' blocks marketing but allows transactional", async () => {
    await suppress(env, 'optout@example.com', { reason: 'unsubscribe' });
    expect(await canEmail(env, 'optout@example.com', 'marketing')).toBe(false);
    expect(await canEmail(env, 'optout@example.com', 'transactional')).toBe(true);
  });

  it("scope 'all' blocks both kinds", async () => {
    await suppress(env, 'dead@example.com', { reason: 'bounce', scope: 'all' });
    expect(await canEmail(env, 'dead@example.com', 'marketing')).toBe(false);
    expect(await canEmail(env, 'dead@example.com', 'transactional')).toBe(false);
  });

  it('matches case-insensitively and ignores surrounding whitespace', async () => {
    await suppress(env, 'Mixed.Case@Example.com', { reason: 'unsubscribe' });
    expect(await canEmail(env, '  mixed.case@example.com  ', 'marketing')).toBe(false);
  });

  it('collapses gmail aliases so an opt-out cannot be bypassed', async () => {
    await suppress(env, 'foo+datawise@gmail.com', { reason: 'unsubscribe' });
    expect(await canEmail(env, 'f.o.o@googlemail.com', 'marketing')).toBe(false);
    expect(await canEmail(env, 'foo@gmail.com', 'marketing')).toBe(false);
  });

  it('stores exactly one row per canonical address', async () => {
    await suppress(env, 'dupe@example.com', { reason: 'unsubscribe' });
    await suppress(env, 'DUPE@example.com', { reason: 'complaint' });
    const count = raw.prepare('SELECT COUNT(*) AS n FROM email_suppressions').get() as { n: number };
    expect(count.n).toBe(1);
  });
});

describe('suppress scope escalation', () => {
  let env: Env;
  let raw: ReturnType<typeof createTestDb>['raw'];

  beforeEach(() => {
    const db = createTestDb();
    raw = db.raw;
    env = makeEnv(db.d1);
  });

  function scopeOf(email: string): string {
    const row = raw
      .prepare('SELECT scope FROM email_suppressions WHERE email = ?')
      .get(email) as { scope: string };
    return row.scope;
  }

  it("escalates 'marketing' to 'all'", async () => {
    await suppress(env, 'x@example.com', { reason: 'unsubscribe' });
    expect(scopeOf('x@example.com')).toBe('marketing');
    await suppress(env, 'x@example.com', { reason: 'bounce', scope: 'all' });
    expect(scopeOf('x@example.com')).toBe('all');
  });

  it("never downgrades 'all' back to 'marketing'", async () => {
    await suppress(env, 'y@example.com', { reason: 'bounce', scope: 'all' });
    await suppress(env, 'y@example.com', { reason: 'unsubscribe', scope: 'marketing' });
    expect(scopeOf('y@example.com')).toBe('all');
    // The whole point: a dead address must not start receiving resets again.
    expect(await canEmail(env, 'y@example.com', 'transactional')).toBe(false);
  });

  it('keeps an existing user_id when a later write has none', async () => {
    await suppress(env, 'z@example.com', { reason: 'unsubscribe', userId: 'user-1' });
    await suppress(env, 'z@example.com', { reason: 'complaint' });
    const row = raw
      .prepare('SELECT user_id FROM email_suppressions WHERE email = ?')
      .get('z@example.com') as { user_id: string | null };
    expect(row.user_id).toBe('user-1');
  });
});

describe('unsuppress', () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv(createTestDb().d1);
  });

  it('removes a plain unsubscribe', async () => {
    await suppress(env, 'a@example.com', { reason: 'unsubscribe' });
    expect(await unsuppress(env, 'a@example.com')).toBe(true);
    expect(await canEmail(env, 'a@example.com', 'marketing')).toBe(true);
  });

  it('refuses to resurrect a spam complaint', async () => {
    await suppress(env, 'b@example.com', { reason: 'complaint' });
    expect(await unsuppress(env, 'b@example.com')).toBe(false);
    expect(await canEmail(env, 'b@example.com', 'marketing')).toBe(false);
  });

  it('refuses to resurrect a hard bounce', async () => {
    await suppress(env, 'c@example.com', { reason: 'bounce', scope: 'all' });
    expect(await unsuppress(env, 'c@example.com')).toBe(false);
    expect(await canEmail(env, 'c@example.com', 'transactional')).toBe(false);
  });
});

describe('unsubscribe tokens', () => {
  it('round-trips a signature', async () => {
    const t = await signUnsubscribeToken(SECRET, 'user@example.com');
    expect(await verifyUnsubscribeToken(SECRET, 'user@example.com', t)).toBe(true);
  });

  it('rejects a tampered token', async () => {
    const t = await signUnsubscribeToken(SECRET, 'user@example.com');
    const tampered = (t[0] === 'A' ? 'B' : 'A') + t.slice(1);
    expect(await verifyUnsubscribeToken(SECRET, 'user@example.com', tampered)).toBe(false);
  });

  it('rejects a token signed for a different address', async () => {
    const t = await signUnsubscribeToken(SECRET, 'victim@example.com');
    expect(await verifyUnsubscribeToken(SECRET, 'attacker@example.com', t)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const t = await signUnsubscribeToken('other-secret', 'user@example.com');
    expect(await verifyUnsubscribeToken(SECRET, 'user@example.com', t)).toBe(false);
  });

  it('rejects empty or missing tokens without throwing', async () => {
    expect(await verifyUnsubscribeToken(SECRET, 'user@example.com', '')).toBe(false);
    expect(await verifyUnsubscribeToken('', 'user@example.com', 'abc')).toBe(false);
  });

  it('does not throw on a length mismatch', async () => {
    expect(await verifyUnsubscribeToken(SECRET, 'user@example.com', 'short')).toBe(false);
  });

  it('verifies a token minted for an alias of the same inbox', async () => {
    // The URL carries the canonical address, so aliases converge on one token.
    const t = await signUnsubscribeToken(SECRET, 'foo+tag@gmail.com');
    expect(await verifyUnsubscribeToken(SECRET, 'f.oo@gmail.com', t)).toBe(true);
  });

  it('builds a URL containing the canonical address and a valid token', async () => {
    const env = makeEnv(createTestDb().d1);
    const url = await unsubscribeUrlFor(env, 'Foo+tag@Gmail.com');
    expect(url).toContain('https://api.example.com/api/unsubscribe?e=');
    expect(url).toContain(encodeURIComponent('foo@gmail.com'));

    const parsed = new URL(url);
    const e = parsed.searchParams.get('e')!;
    const t = parsed.searchParams.get('t')!;
    expect(await verifyUnsubscribeToken(SECRET, e, t)).toBe(true);
  });
});
