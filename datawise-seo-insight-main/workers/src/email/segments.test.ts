import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import {
  computeSegment,
  splitName,
  signupMonth,
  toContactSnapshot,
  propsFingerprint,
  fetchSegmentPage,
  collectDesyncTargets,
  type SegmentRow,
} from './segments';
import { suppress } from './suppression';
import type { Env } from '../index';

function row(over: Partial<SegmentRow> = {}): SegmentRow {
  return {
    user_id: 'u1',
    email: 'a@example.com',
    name: 'Ada Lovelace',
    subscription_tier: 'free',
    is_community_member: 0,
    credits_used: 0,
    created_at: '2026-07-15 10:00:00',
    ever_member: 0,
    ...over,
  };
}

describe('computeSegment', () => {
  it('classifies a current community member', () => {
    expect(computeSegment(row({ is_community_member: 1 }))).toBe('member');
  });

  it('classifies a free user who has used credits', () => {
    expect(computeSegment(row({ credits_used: 3 }))).toBe('free_unconverted');
  });

  it('classifies a free user who never activated', () => {
    expect(computeSegment(row({ credits_used: 0 }))).toBe('free_inactive');
  });

  it('classifies a former member as churned', () => {
    expect(computeSegment(row({ ever_member: 1, credits_used: 5 }))).toBe('churned');
  });

  it('checks membership before credits', () => {
    // Members have unlimited access so credits_used never advances: in prod
    // only 28 of 557 members have a non-zero count. Branching on credits first
    // would misfile the other 529 as free_inactive.
    expect(computeSegment(row({ is_community_member: 1, credits_used: 0 }))).toBe('member');
  });

  it('prefers current membership over churn history', () => {
    expect(computeSegment(row({ is_community_member: 1, ever_member: 1 }))).toBe('member');
  });
});

describe('property derivation', () => {
  it('splits names into first and last', () => {
    expect(splitName('Ada Lovelace')).toEqual({ firstName: 'Ada', lastName: 'Lovelace' });
    expect(splitName('Ada')).toEqual({ firstName: 'Ada', lastName: '' });
    expect(splitName('  Mary  Anne   Evans ')).toEqual({ firstName: 'Mary', lastName: 'Anne Evans' });
    expect(splitName(null)).toEqual({ firstName: '', lastName: '' });
  });

  it('derives a YYYY-MM cohort', () => {
    expect(signupMonth('2026-07-15 10:00:00')).toBe('2026-07');
    expect(signupMonth(null)).toBe('');
    expect(signupMonth('bad')).toBe('');
  });

  it('emits every property as a string, since Resend accepts string or number only', () => {
    const snap = toContactSnapshot(row({ credits_used: 7 }));
    for (const v of Object.values(snap.properties)) expect(typeof v).toBe('string');
    expect(snap.properties.dw_credits_used).toBe('7');
    expect(snap.properties.dw_segment).toBe('free_unconverted');
    expect(snap.properties.dw_signup_month).toBe('2026-07');
  });

  it('reports members as tier community even if the column disagrees', () => {
    const snap = toContactSnapshot(row({ is_community_member: 1, subscription_tier: 'free' }));
    expect(snap.properties.dw_tier).toBe('community');
  });

  it('uses only keys Resend permits (alphanumeric + underscore, <= 50 chars)', () => {
    const snap = toContactSnapshot(row());
    for (const k of Object.keys(snap.properties)) {
      expect(k).toMatch(/^[A-Za-z0-9_]{1,50}$/);
    }
  });
});

describe('propsFingerprint', () => {
  it('is stable across identical input', () => {
    expect(propsFingerprint(toContactSnapshot(row()))).toBe(
      propsFingerprint(toContactSnapshot(row()))
    );
  });

  it('changes when the segment changes', () => {
    const a = propsFingerprint(toContactSnapshot(row({ credits_used: 0 })));
    const b = propsFingerprint(toContactSnapshot(row({ credits_used: 1 })));
    expect(a).not.toBe(b);
  });

  it('changes when the name changes', () => {
    const a = propsFingerprint(toContactSnapshot(row({ name: 'Ada Lovelace' })));
    const b = propsFingerprint(toContactSnapshot(row({ name: 'Ada L' })));
    expect(a).not.toBe(b);
  });
});

describe('fetchSegmentPage', () => {
  let env: Env;
  let raw: ReturnType<typeof createTestDb>['raw'];

  function seed(id: string, email: string, over: Record<string, unknown> = {}) {
    raw
      .prepare(
        `INSERT INTO users (id, google_id, email, name, subscription_tier, is_community_member, credits_used, banned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id, `g-${id}`, email, (over.name as string) ?? 'Test User',
        (over.tier as string) ?? 'free',
        (over.member as number) ?? 0,
        (over.credits as number) ?? 0,
        (over.banned as number) ?? 0
      );
  }

  beforeEach(() => {
    const db = createTestDb();
    raw = db.raw;
    env = { DB: db.d1 } as unknown as Env;
  });

  it('returns users ordered by id and honours the cursor', async () => {
    seed('a1', 'a@example.com');
    seed('b2', 'b@example.com');
    seed('c3', 'c@example.com');

    const first = await fetchSegmentPage(env, '', 2);
    expect(first.map((r) => r.user_id)).toEqual(['a1', 'b2']);

    const next = await fetchSegmentPage(env, 'b2', 2);
    expect(next.map((r) => r.user_id)).toEqual(['c3']);
  });

  it('excludes banned users', async () => {
    seed('a1', 'a@example.com');
    seed('b2', 'banned@example.com', { banned: 1 });
    const rows = await fetchSegmentPage(env, '', 10);
    expect(rows.map((r) => r.email)).toEqual(['a@example.com']);
  });

  it('excludes suppressed users, so an opt-out never enters a segment', async () => {
    seed('a1', 'a@example.com');
    seed('b2', 'optout@example.com');
    await suppress(env, 'optout@example.com', { reason: 'unsubscribe' });

    const rows = await fetchSegmentPage(env, '', 10);
    expect(rows.map((r) => r.email)).toEqual(['a@example.com']);
  });

  it('excludes a user suppressed under a gmail alias of their address', async () => {
    seed('a1', 'sam.smith+dw@gmail.com');
    await suppress(env, 'samsmith@gmail.com', { reason: 'complaint' });
    // users.email is stored raw; the suppression row is canonical. The query
    // compares lower(email), so this alias case is NOT caught here and is
    // instead handled by canEmail() at send time plus collectDesyncTargets.
    const rows = await fetchSegmentPage(env, '', 10);
    expect(rows).toHaveLength(1);
  });

  it('skips rows with no usable address', async () => {
    seed('a1', 'a@example.com');
    raw.prepare("INSERT INTO users (id, google_id, email) VALUES ('b2','g-b2','notanemail')").run();
    const rows = await fetchSegmentPage(env, '', 10);
    expect(rows.map((r) => r.email)).toEqual(['a@example.com']);
  });

  it('marks a former member as churned via tier_changes', async () => {
    seed('a1', 'churn@example.com');
    raw
      .prepare(
        `INSERT INTO tier_changes (user_id, from_tier, to_tier, source)
         VALUES ('a1', 'community', 'free', 'test')`
      )
      .run();
    const rows = await fetchSegmentPage(env, '', 10);
    expect(computeSegment(rows[0])).toBe('churned');
  });
});

describe('collectDesyncTargets', () => {
  let env: Env;
  let raw: ReturnType<typeof createTestDb>['raw'];

  beforeEach(() => {
    const db = createTestDb();
    raw = db.raw;
    env = { DB: db.d1 } as unknown as Env;
  });

  it('finds previously-synced contacts who are now suppressed', async () => {
    raw
      .prepare("INSERT INTO resend_contact_sync (email, user_id, segment, props_hash) VALUES (?,?,?,?)")
      .run('gone@example.com', 'u1', 'free_inactive', 'h1');
    raw
      .prepare("INSERT INTO resend_contact_sync (email, user_id, segment, props_hash) VALUES (?,?,?,?)")
      .run('stays@example.com', 'u2', 'member', 'h2');
    await suppress(env, 'gone@example.com', { reason: 'unsubscribe' });

    expect(await collectDesyncTargets(env, 10)).toEqual(['gone@example.com']);
  });

  it('finds previously-synced contacts who are now banned', async () => {
    raw
      .prepare('INSERT INTO users (id, google_id, email, banned) VALUES (?,?,?,1)')
      .run('u3', 'g-u3', 'bad@example.com');
    raw
      .prepare('INSERT INTO resend_contact_sync (email, user_id, segment, props_hash) VALUES (?,?,?,?)')
      .run('bad@example.com', 'u3', 'member', 'h3');

    expect(await collectDesyncTargets(env, 10)).toEqual(['bad@example.com']);
  });

  it('returns nothing when everything is in good standing', async () => {
    raw
      .prepare('INSERT INTO resend_contact_sync (email, user_id, segment, props_hash) VALUES (?,?,?,?)')
      .run('ok@example.com', 'u4', 'member', 'h4');
    expect(await collectDesyncTargets(env, 10)).toEqual([]);
  });
});
