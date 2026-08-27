// Membership lifecycle tests for the Skool community roster.
//
// Covers the 2026-08 incident class: paying Skool members losing DataWise
// access because the admin CSV upload wiped webhook/manual roster rows and
// revoked anyone whose Skool-export email differed from their login email.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from '../test-support/d1';
import {
  handleUploadMembers,
  handleAddMember,
  handleRevokeAccess,
  handleToggleMember,
} from './admin';
import { handleSkoolMemberJoined, handleSkoolMemberLeft } from './webhooks';
import { upgradeUserToCommunityIfMember } from '../lib/tier-changes';
import { handleEmailSignup, handleEmailLogin } from '../auth/email';
import type { Env } from '../index';
import type { AuthUser } from '../auth/google';

const WEBHOOK_SECRET = 'test-secret';

function makeEnv(d1: D1Database): Env {
  return {
    DB: d1,
    KV: {
      put: async () => undefined,
      get: async () => null,
      delete: async () => undefined,
    },
    SKOOL_WEBHOOK_SECRET: WEBHOOK_SECRET,
    FRONTEND_URL: 'https://app.test',
  } as unknown as Env;
}

function adminUser(): AuthUser {
  return {
    id: 'admin1',
    google_id: 'g-admin',
    email: 'nico@airankingskool.com',
    name: 'Admin',
    avatar_url: '',
    subscription_tier: 'community',
    is_community_member: 1,
    is_admin: 1,
    credits_used: 0,
  } as unknown as AuthUser;
}

function postJson(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://test.local/', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function csvOf(emails: string[]): string {
  const rows = emails.map((e, i) => `First${i},Last${i},${e},,2026-01-0${(i % 9) + 1} 10:00:00,,,,,,,$47,month,premium,$47`);
  return [
    'FirstName,LastName,Email,Invited By,JoinedDate,Question1,Answer1,Question2,Answer2,Question3,Answer3,Price,Recurring Interval,Tier,LTV',
    ...rows,
  ].join('\n');
}

interface UploadResponse {
  success: boolean;
  imported: number;
  granted: number;
  revoked: number;
  revoked_emails: string[];
  protected_members: Array<{ email: string; source: string }>;
}

describe('community membership lifecycle', () => {
  let d1: D1Database;
  let raw: import('better-sqlite3').Database;
  let env: Env;

  beforeEach(() => {
    const db = createTestDb();
    d1 = db.d1;
    raw = db.raw;
    env = makeEnv(d1);
    // Membership paths send transactional emails via Resend; never hit the network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'stub' }), { status: 200 })));
  });

  function seedUser(id: string, email: string, opts: { tier?: string; member?: number; password?: string } = {}) {
    raw.prepare(
      'INSERT INTO users (id, google_id, email, subscription_tier, is_community_member, password_hash) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, `g-${id}`, email, opts.tier ?? 'free', opts.member ?? 0, opts.password ?? null);
  }

  function seedRosterRow(email: string, source: string, normalized: string | null = null) {
    raw.prepare(
      'INSERT INTO community_members (email, source, normalized_email) VALUES (?, ?, ?)'
    ).run(email, source, normalized);
  }

  function getUser(id: string): { subscription_tier: string; is_community_member: number } {
    return raw.prepare('SELECT subscription_tier, is_community_member FROM users WHERE id = ?').get(id) as never;
  }

  function rosterRow(email: string): { email: string; source: string; normalized_email: string | null } | undefined {
    return raw.prepare('SELECT email, source, normalized_email FROM community_members WHERE email = ?').get(email) as never;
  }

  async function upload(emails: string[]): Promise<UploadResponse> {
    const res = await handleUploadMembers(postJson({ csv: csvOf(emails) }), env, adminUser());
    expect(res.status).toBe(200);
    return await res.json() as UploadResponse;
  }

  it('grants users present in the CSV and revokes csv-managed members absent from it', async () => {
    seedUser('u1', 'a@x.com');
    seedUser('u2', 'b@x.com', { tier: 'community', member: 1 });
    seedRosterRow('b@x.com', 'csv');

    const result = await upload(['a@x.com']);

    expect(result.imported).toBe(1);
    expect(getUser('u1')).toEqual({ subscription_tier: 'community', is_community_member: 1 });
    expect(getUser('u2')).toEqual({ subscription_tier: 'free', is_community_member: 0 });
    expect(result.revoked_emails).toContain('b@x.com');
    expect(rosterRow('b@x.com')).toBeUndefined();

    const winback = raw.prepare(
      "SELECT 1 FROM email_sequences WHERE user_id = 'u2' AND sequence_type = 'winback'"
    ).get();
    expect(winback).toBeTruthy();
  });

  it('preserves webhook and manual roster rows absent from the CSV and reports them', async () => {
    seedUser('jin', 'jinshin79@gmail.com', { tier: 'community', member: 1 });
    seedRosterRow('jinshin79@gmail.com', 'webhook', 'jinshin79@gmail.com');
    seedUser('has', 'hasnain@ewebmarketing.com.au', { tier: 'community', member: 1 });
    seedRosterRow('hasnain@ewebmarketing.com.au', 'manual', 'hasnain@ewebmarketing.com.au');
    seedUser('u1', 'a@x.com');

    const result = await upload(['a@x.com']);

    expect(getUser('jin')).toEqual({ subscription_tier: 'community', is_community_member: 1 });
    expect(getUser('has')).toEqual({ subscription_tier: 'community', is_community_member: 1 });
    expect(result.revoked_emails).toEqual([]);
    expect(rosterRow('jinshin79@gmail.com')?.source).toBe('webhook');
    expect(result.protected_members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ email: 'jinshin79@gmail.com', source: 'webhook' }),
        expect.objectContaining({ email: 'hasnain@ewebmarketing.com.au', source: 'manual' }),
      ])
    );
  });

  it('flips a webhook row to csv-managed once the export includes it, then revokes on later absence', async () => {
    seedUser('jin', 'jin@x.com', { tier: 'community', member: 1 });
    seedRosterRow('jin@x.com', 'webhook', 'jin@x.com');

    await upload(['jin@x.com']);
    expect(rosterRow('jin@x.com')?.source).toBe('csv');

    const result = await upload(['other@x.com']);
    expect(getUser('jin')).toEqual({ subscription_tier: 'free', is_community_member: 0 });
    expect(result.revoked_emails).toContain('jin@x.com');
  });

  it('matches gmail dot variants between roster and user emails', async () => {
    seedUser('sean', 'hausean@gmail.com');

    const result = await upload(['hau.sean@gmail.com']);

    expect(result.granted).toBe(1);
    expect(getUser('sean')).toEqual({ subscription_tier: 'community', is_community_member: 1 });
  });

  it('does not revoke a dot-variant user still covered by the CSV', async () => {
    seedUser('sean', 'hausean@gmail.com', { tier: 'community', member: 1 });
    const result = await upload(['hau.sean@gmail.com']);
    expect(result.revoked_emails).toEqual([]);
    expect(getUser('sean')).toEqual({ subscription_tier: 'community', is_community_member: 1 });
  });

  it('upgradeUserToCommunityIfMember matches normalized variants and plain lower-case rows', async () => {
    seedUser('sean', 'hausean@gmail.com');
    seedRosterRow('hau.sean@gmail.com', 'webhook', 'hausean@gmail.com');
    const up = await upgradeUserToCommunityIfMember(env, 'sean', 'hausean@gmail.com', 'test');
    expect(up.matched).toBe(true);
    expect(getUser('sean').is_community_member).toBe(1);

    // Legacy row: normalized_email NULL, exact lower-case email still matches.
    seedUser('old', 'legacy@x.com');
    seedRosterRow('legacy@x.com', 'csv', null);
    const up2 = await upgradeUserToCommunityIfMember(env, 'old', 'Legacy@X.com', 'test');
    expect(up2.matched).toBe(true);
  });

  it('add-member creates a manual roster row that survives uploads', async () => {
    seedUser('u9', 'vip@x.com');
    const res = await handleAddMember(postJson({ email: 'vip@x.com', send_invite: false }), env, adminUser());
    expect(res.status).toBe(200);
    expect(rosterRow('vip@x.com')?.source).toBe('manual');
    expect(getUser('u9').is_community_member).toBe(1);

    await upload(['someoneelse@x.com']);
    expect(getUser('u9').is_community_member).toBe(1);
    expect(rosterRow('vip@x.com')?.source).toBe('manual');
  });

  it('skool-member-joined records a webhook roster row with a normalized email', async () => {
    const res = await handleSkoolMemberJoined(
      postJson({ email: 'New.Member+skool@Gmail.com', first_name: 'New' }, { Authorization: `Bearer ${WEBHOOK_SECRET}` }),
      env
    );
    expect(res.status).toBe(200);
    expect(rosterRow('new.member+skool@gmail.com')?.source).toBe('webhook');
    expect(rosterRow('new.member+skool@gmail.com')?.normalized_email).toBe('newmember@gmail.com');
  });

  it('skool-member-left removes the roster row and downgrades the user', async () => {
    seedUser('jin', 'jinshin79@gmail.com', { tier: 'community', member: 1 });
    seedRosterRow('jinshin79@gmail.com', 'webhook', 'jinshin79@gmail.com');

    const unauthorized = await handleSkoolMemberLeft(postJson({ email: 'jinshin79@gmail.com' }), env);
    expect(unauthorized.status).toBe(401);
    expect(getUser('jin').is_community_member).toBe(1);

    const res = await handleSkoolMemberLeft(
      postJson({ email: 'jinshin79@gmail.com' }, { Authorization: `Bearer ${WEBHOOK_SECRET}` }),
      env
    );
    expect(res.status).toBe(200);
    expect(rosterRow('jinshin79@gmail.com')).toBeUndefined();
    expect(getUser('jin')).toEqual({ subscription_tier: 'free', is_community_member: 0 });
  });

  it('revoke-access removes roster rows so login auto-detect cannot silently re-grant', async () => {
    seedUser('u1', 'gone@x.com', { tier: 'community', member: 1 });
    seedRosterRow('gone@x.com', 'csv', 'gone@x.com');

    const res = await handleRevokeAccess(postJson({ user_ids: ['u1'] }), env, adminUser());
    expect(res.status).toBe(200);
    expect(getUser('u1')).toEqual({ subscription_tier: 'free', is_community_member: 0 });
    expect(rosterRow('gone@x.com')).toBeUndefined();
    const up = await upgradeUserToCommunityIfMember(env, 'u1', 'gone@x.com', 'test');
    expect(up.matched).toBe(false);

    // restore adds a manual roster row back
    await handleRevokeAccess(postJson({ user_ids: ['u1'], action: 'restore' }), env, adminUser());
    expect(getUser('u1')).toEqual({ subscription_tier: 'community', is_community_member: 1 });
    expect(rosterRow('gone@x.com')?.source).toBe('manual');
  });

  it('toggle-member keeps the roster in sync in both directions', async () => {
    seedUser('u1', 'flip@x.com', { tier: 'community', member: 1 });
    seedRosterRow('flip@x.com', 'csv', 'flip@x.com');

    await handleToggleMember(postJson({ user_id: 'u1', action: 'revoke' }), env, adminUser());
    expect(getUser('u1').is_community_member).toBe(0);
    expect(rosterRow('flip@x.com')).toBeUndefined();

    await handleToggleMember(postJson({ user_id: 'u1', action: 'grant' }), env, adminUser());
    expect(getUser('u1').is_community_member).toBe(1);
    expect(rosterRow('flip@x.com')?.source).toBe('manual');
  });

  it('password login re-checks membership for users who joined Skool after signing up', async () => {
    const signup = await handleEmailSignup(
      postJson({ email: 'late@x.com', password: 'secret123' }),
      env
    );
    expect(signup.status).toBe(200);
    const row = raw.prepare("SELECT id FROM users WHERE email = 'late@x.com'").get() as { id: string };
    expect(getUser(row.id).is_community_member).toBe(0);

    seedRosterRow('late@x.com', 'webhook', 'late@x.com');

    const login = await handleEmailLogin(postJson({ email: 'late@x.com', password: 'secret123' }), env);
    expect(login.status).toBe(200);
    expect(getUser(row.id)).toEqual({ subscription_tier: 'community', is_community_member: 1 });
  });

  it('tolerates a UTF-8 BOM and CRLF line endings in the uploaded CSV', async () => {
    seedUser('u1', 'a@x.com');
    const csv = '﻿FirstName,LastName,Email\r\nJin,Shin,a@x.com\r\n';
    const res = await handleUploadMembers(postJson({ csv }), env, adminUser());
    expect(res.status).toBe(200);
    const body = await res.json() as UploadResponse;
    expect(body.imported).toBe(1);
    expect(getUser('u1').is_community_member).toBe(1);
  });
});
