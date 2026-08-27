// Admin flow for members whose Skool email differs from their DataWise login.
//
// The shape under test is the real 2026-08-17 case: Taz Street joined Skool as
// positiveoutloud@gmail.com, signed up here as seostreetconsulting@gmail.com,
// and burned all five free credits while the community grant sat on an invite
// row they never claimed.
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../test-support/d1';
import {
  handleEmailMismatches,
  handleLinkMember,
  handleUnlinkMember,
  handleCrossReference,
  handleUploadMembers,
} from './admin';
import { findCommunityMemberByEmail } from '../lib/tier-changes';
import type { Env } from '../index';
import type { AuthUser } from '../auth/google';

function makeEnv(d1: D1Database): Env {
  return {
    DB: d1,
    KV: { put: async () => undefined, get: async () => null, delete: async () => undefined },
    FRONTEND_URL: 'https://app.test',
  } as unknown as Env;
}

function adminUser(): AuthUser {
  return {
    id: 'admin1', google_id: 'g-admin', email: 'nico@airankingskool.com', name: 'Admin',
    avatar_url: '', subscription_tier: 'community', is_community_member: 1, is_admin: 1, credits_used: 0,
  } as unknown as AuthUser;
}

function getReq(qs = ''): Request {
  return new Request(`http://test.local/api/admin/email-mismatches${qs}`);
}

function postJson(body: unknown): Request {
  return new Request('http://test.local/', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  });
}

let db: D1Database;
let env: Env;

async function addRosterMember(email: string, first: string, last: string, joined: string, source = 'csv') {
  await db.prepare(
    `INSERT INTO community_members (email, first_name, last_name, tier, ltv, joined_date, source, normalized_email)
     VALUES (?, ?, ?, 'standard', 0, ?, ?, ?)`
  ).bind(email, first, last, joined, source, email).run();
}

async function addUser(opts: {
  id: string; email: string; name?: string; googleId?: string; passwordHash?: string | null;
  tier?: string; community?: number; credits?: number; created?: string;
}) {
  await db.prepare(
    `INSERT INTO users (id, google_id, email, name, password_hash, subscription_tier, is_community_member, credits_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    opts.id, opts.googleId ?? `google-${opts.id}`, opts.email, opts.name ?? opts.email,
    opts.passwordHash ?? null, opts.tier ?? 'free', opts.community ?? 0,
    opts.credits ?? 0, opts.created ?? '2026-08-17 00:40:38',
  ).run();
}

/** The stranded invite + the account actually in use. */
async function seedTazCase() {
  await addRosterMember('positiveoutloud@gmail.com', 'Taz', 'Street', '2026-08-17 00:51:16');
  await addUser({
    id: 'invited1', email: 'positiveoutloud@gmail.com', name: 'positiveoutloud',
    googleId: 'invited:invited1', passwordHash: null, tier: 'community', community: 1, credits: 0,
  });
  await addUser({
    id: 'real1', email: 'seostreetconsulting@gmail.com', name: 'Taz',
    googleId: 'email:real1', passwordHash: 'hash', tier: 'free', community: 0, credits: 5,
  });
}

interface MismatchResponse {
  matches: Array<{ account: { id: string; email: string }; suggestions: Array<{ member: { email: string }; score: number; reasons: string[] }> }>;
  unclaimed_grants: Array<{ email: string }>;
  blocked_count: number;
}

beforeEach(() => {
  db = createTestDb().d1;
  env = makeEnv(db);
});

describe('handleEmailMismatches', () => {
  it('pairs the blocked account with its stranded roster grant', async () => {
    await seedTazCase();
    const res = await handleEmailMismatches(getReq(), env, adminUser());
    const body = await res.json() as MismatchResponse;

    expect(body.matches).toHaveLength(1);
    expect(body.matches[0].account.email).toBe('seostreetconsulting@gmail.com');
    expect(body.matches[0].suggestions[0].member.email).toBe('positiveoutloud@gmail.com');
    expect(body.matches[0].suggestions[0].reasons.join(' ')).toContain('street');
    expect(body.unclaimed_grants.map(g => g.email)).toContain('positiveoutloud@gmail.com');
  });

  it('ignores an invite that was actually claimed', async () => {
    await seedTazCase();
    // Claiming by email signup sets password_hash; by Google login it rewrites google_id.
    await db.prepare("UPDATE users SET password_hash = 'set' WHERE id = 'invited1'").run();
    const body = await handleEmailMismatches(getReq(), env, adminUser()).then(r => r.json()) as MismatchResponse;
    expect(body.unclaimed_grants).toHaveLength(0);
    expect(body.matches).toHaveLength(0);
  });

  it('drops an account once it is linked', async () => {
    await seedTazCase();
    await handleLinkMember(postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }), env, adminUser());
    const body = await handleEmailMismatches(getReq(), env, adminUser()).then(r => r.json()) as MismatchResponse;
    expect(body.matches).toHaveLength(0);
  });

  it('respects the min_credits filter', async () => {
    await seedTazCase();
    await db.prepare("UPDATE users SET credits_used = 1 WHERE id = 'real1'").run();
    const strict = await handleEmailMismatches(getReq('?min_credits=3'), env, adminUser()).then(r => r.json()) as MismatchResponse;
    expect(strict.matches).toHaveLength(0);
    const loose = await handleEmailMismatches(getReq('?min_credits=1'), env, adminUser()).then(r => r.json()) as MismatchResponse;
    expect(loose.matches).toHaveLength(1);
  });

  it('refuses non-admins', async () => {
    const res = await handleEmailMismatches(getReq(), env, { ...adminUser(), email: 'someone@else.com', is_admin: 0 } as unknown as AuthUser);
    expect(res.status).toBe(403);
  });
});

describe('handleLinkMember', () => {
  it('grants community access to the account actually in use', async () => {
    await seedTazCase();
    const res = await handleLinkMember(postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }), env, adminUser());
    expect(res.status).toBe(200);

    const user = await db.prepare("SELECT subscription_tier, is_community_member FROM users WHERE id = 'real1'")
      .first<{ subscription_tier: string; is_community_member: number }>();
    expect(user?.subscription_tier).toBe('community');
    expect(user?.is_community_member).toBe(1);
  });

  it('resolves on every later login, so the grant is re-derived not just written once', async () => {
    await seedTazCase();
    await handleLinkMember(postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }), env, adminUser());
    const found = await findCommunityMemberByEmail(db, 'seostreetconsulting@gmail.com');
    expect(found?.email).toBe('positiveoutloud@gmail.com');
  });

  it('survives a CSV upload that does not list the alias address', async () => {
    // This is the property the alias exists for: the roster will never contain
    // the login email, so only alias resolution keeps the sweep from revoking.
    await seedTazCase();
    await handleLinkMember(postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }), env, adminUser());

    const csv = [
      'FirstName,LastName,Email,JoinedDate,Tier,LTV',
      'Taz,Street,positiveoutloud@gmail.com,2026-08-17 00:51:16,standard,0',
    ].join('\n');
    await handleUploadMembers(postJson({ csv }), env, adminUser());

    const user = await db.prepare("SELECT subscription_tier FROM users WHERE id = 'real1'")
      .first<{ subscription_tier: string }>();
    expect(user?.subscription_tier).toBe('community');
  });

  it('retires the untouched invite row', async () => {
    await seedTazCase();
    const body = await handleLinkMember(postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }), env, adminUser())
      .then(r => r.json()) as { removed_orphan_account: string | null };
    expect(body.removed_orphan_account).toBe('positiveoutloud@gmail.com');
    const gone = await db.prepare("SELECT id FROM users WHERE id = 'invited1'").first();
    expect(gone).toBeNull();
  });

  it('keeps an invite row that shows any sign of use', async () => {
    await seedTazCase();
    await db.prepare("UPDATE users SET credits_used = 2 WHERE id = 'invited1'").run();
    const body = await handleLinkMember(postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }), env, adminUser())
      .then(r => r.json()) as { removed_orphan_account: string | null };
    expect(body.removed_orphan_account).toBeNull();
    expect(await db.prepare("SELECT id FROM users WHERE id = 'invited1'").first()).not.toBeNull();
  });

  it('pairs manually from a typed login email', async () => {
    await seedTazCase();
    const res = await handleLinkMember(
      postJson({ login_email: 'seostreetconsulting@gmail.com', member_email: 'positiveoutloud@gmail.com' }),
      env, adminUser(),
    );
    expect(res.status).toBe(200);
    const user = await db.prepare("SELECT subscription_tier FROM users WHERE id = 'real1'")
      .first<{ subscription_tier: string }>();
    expect(user?.subscription_tier).toBe('community');
  });

  it('reports a typed login email that has no account', async () => {
    await seedTazCase();
    const res = await handleLinkMember(
      postJson({ login_email: 'nosuch@gmail.com', member_email: 'positiveoutloud@gmail.com' }),
      env, adminUser(),
    );
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toContain('nosuch@gmail.com');
  });

  it('rejects an email that is not on the roster', async () => {
    await seedTazCase();
    const res = await handleLinkMember(postJson({ user_id: 'real1', member_email: 'nobody@gmail.com' }), env, adminUser());
    expect(res.status).toBe(400);
  });

  it('rejects linking an account to its own address', async () => {
    await seedTazCase();
    await addUser({ id: 'self1', email: 'onroster@gmail.com', credits: 5 });
    await addRosterMember('onroster@gmail.com', 'On', 'Roster', '2026-08-01 00:00:00');
    const res = await handleLinkMember(postJson({ user_id: 'self1', member_email: 'onroster@gmail.com' }), env, adminUser());
    expect(res.status).toBe(400);
  });

  it('refuses non-admins', async () => {
    await seedTazCase();
    const res = await handleLinkMember(
      postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }),
      env, { ...adminUser(), email: 'someone@else.com', is_admin: 0 } as unknown as AuthUser,
    );
    expect(res.status).toBe(403);
  });
});

describe('cross-reference after linking', () => {
  it('counts the linked account as a member instead of a non-member', async () => {
    await seedTazCase();
    await handleLinkMember(postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }), env, adminUser());

    const body = await handleCrossReference(new Request('http://test.local/'), env, adminUser()).then(r => r.json()) as {
      non_members: Array<{ email: string }>;
      active_members: Array<{ email: string; linked_via: string | null }>;
      not_registered: Array<{ email: string }>;
    };

    expect(body.non_members.map(m => m.email)).not.toContain('seostreetconsulting@gmail.com');
    const active = body.active_members.find(m => m.email === 'seostreetconsulting@gmail.com');
    expect(active?.linked_via).toBe('positiveoutloud@gmail.com');
    expect(body.not_registered.map(m => m.email)).not.toContain('positiveoutloud@gmail.com');
  });

  it('unlinking puts the account back on the non-member list', async () => {
    await seedTazCase();
    await handleLinkMember(postJson({ user_id: 'real1', member_email: 'positiveoutloud@gmail.com' }), env, adminUser());
    await handleUnlinkMember(postJson({ alias_email: 'seostreetconsulting@gmail.com' }), env, adminUser());

    const body = await handleCrossReference(new Request('http://test.local/'), env, adminUser()).then(r => r.json()) as {
      non_members: Array<{ email: string }>;
    };
    expect(body.non_members.map(m => m.email)).toContain('seostreetconsulting@gmail.com');
  });
});
