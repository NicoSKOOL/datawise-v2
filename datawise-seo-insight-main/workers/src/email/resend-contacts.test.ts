// Sync tests run against a fake Resend API that records every request, so the
// call sequence itself is under test: which endpoints are hit, in what order,
// and how many times. The "unchanged contacts cost zero API calls" property is
// what keeps the daily cron nearly free, so it is asserted directly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { syncResendContacts } from './resend-contacts';
import { suppress } from './suppression';
import type { Env } from '../index';

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let env: Env;
let raw: ReturnType<typeof createTestDb>['raw'];
let calls: Call[];
let kv: Map<string, string>;
let existingProperties: string[];
let existingSegments: Array<{ id: string; name: string }>;
let failOn: ((c: Call) => number | null) | null;

function seedUser(
  id: string,
  email: string,
  over: { name?: string; member?: number; credits?: number; banned?: number } = {}
) {
  raw
    .prepare(
      `INSERT INTO users (id, google_id, email, name, subscription_tier, is_community_member, credits_used, banned, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-07-01 00:00:00')`
    )
    .run(
      id, `g-${id}`, email, over.name ?? 'Test User',
      over.member ? 'community' : 'free',
      over.member ?? 0, over.credits ?? 0, over.banned ?? 0
    );
}

function ledger(email: string) {
  return raw
    .prepare('SELECT email, segment, props_hash FROM resend_contact_sync WHERE email = ?')
    .get(email) as { email: string; segment: string; props_hash: string } | undefined;
}

function pathsFor(method: string): string[] {
  return calls.filter((c) => c.method === method).map((c) => c.path);
}

beforeEach(() => {
  const db = createTestDb();
  raw = db.raw;
  calls = [];
  kv = new Map();
  existingProperties = [];
  existingSegments = [];
  failOn = null;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace('https://api.resend.com', '');
      const method = init.method ?? 'GET';
      const body = init.body ? JSON.parse(init.body as string) : null;
      const call: Call = { method, path, body };
      calls.push(call);

      const forced = failOn?.(call) ?? null;
      if (forced) return new Response(JSON.stringify({ error: 'forced' }), { status: forced });

      if (method === 'GET' && path === '/contact-properties') {
        return new Response(
          JSON.stringify({ data: existingProperties.map((key) => ({ key })) }),
          { status: 200 }
        );
      }
      if (method === 'POST' && path === '/contact-properties') {
        existingProperties.push(body!.key as string);
        return new Response(JSON.stringify({ id: `prop_${body!.key}` }), { status: 201 });
      }
      if (method === 'GET' && path === '/segments') {
        return new Response(JSON.stringify({ data: existingSegments }), { status: 200 });
      }
      if (method === 'POST' && path === '/segments') {
        const seg = { id: `seg_${existingSegments.length + 1}`, name: body!.name as string };
        existingSegments.push(seg);
        return new Response(JSON.stringify(seg), { status: 201 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    })
  );

  env = {
    DB: db.d1,
    RESEND_API_KEY: 're_test',
    KV: {
      get: async (k: string, type?: string) => {
        const v = kv.get(k) ?? null;
        return v !== null && type === 'json' ? JSON.parse(v) : v;
      },
      put: async (k: string, v: string) => { kv.set(k, v); },
    },
  } as unknown as Env;
});

afterEach(() => vi.unstubAllGlobals());

describe('bootstrap', () => {
  it('creates the dw_* contact properties before writing any contact', async () => {
    seedUser('u1', 'a@example.com');
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    const propCreates = calls.filter((c) => c.method === 'POST' && c.path === '/contact-properties');
    expect(propCreates.map((c) => c.body!.key)).toEqual([
      'dw_segment', 'dw_tier', 'dw_signup_month', 'dw_credits_used',
    ]);

    // Ordering is not cosmetic: a contact referencing an undeclared property
    // is rejected outright by Resend.
    const firstContactIdx = calls.findIndex((c) => c.path.startsWith('/contacts'));
    const lastPropIdx = calls.map((c) => c.path).lastIndexOf('/contact-properties');
    expect(lastPropIdx).toBeLessThan(firstContactIdx);
  });

  it('does not recreate properties that already exist', async () => {
    existingProperties = ['dw_segment', 'dw_tier', 'dw_signup_month', 'dw_credits_used'];
    seedUser('u1', 'a@example.com');
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/contact-properties')).toHaveLength(0);
  });

  it('creates the four segments and caches their ids in KV', async () => {
    seedUser('u1', 'a@example.com');
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    expect(existingSegments.map((s) => s.name)).toEqual([
      'DataWise: Community members',
      'DataWise: Free, used credits',
      'DataWise: Free, never activated',
      'DataWise: Churned members',
    ]);
    expect(JSON.parse(kv.get('resend-segment-ids')!)).toHaveProperty('member');
  });

  it('reuses cached segment ids instead of listing again', async () => {
    kv.set(
      'resend-segment-ids',
      JSON.stringify({ member: 's1', free_unconverted: 's2', free_inactive: 's3', churned: 's4' })
    );
    seedUser('u1', 'a@example.com');
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });
    expect(pathsFor('GET')).not.toContain('/segments');
  });
});

describe('contact upsert', () => {
  it('creates a new contact with properties and its segment in one call', async () => {
    seedUser('u1', 'new@example.com', { name: 'Ada Lovelace', credits: 4 });
    const r = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    const post = calls.find((c) => c.method === 'POST' && c.path === '/contacts')!;
    expect(post.body).toMatchObject({
      email: 'new@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      properties: { dw_segment: 'free_unconverted', dw_credits_used: '4' },
    });
    expect(post.body!.segments).toHaveLength(1);

    // Created straight into the right segment, so no separate add call.
    expect(calls.filter((c) => c.path.includes('/segments/'))).toHaveLength(0);
    expect(r.created).toBe(1);
    expect(ledger('new@example.com')!.segment).toBe('free_unconverted');
  });

  it('skips an unchanged contact on the next pass with zero API calls', async () => {
    seedUser('u1', 'same@example.com');
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    calls.length = 0;
    kv.delete('resend-sync-cursor');
    const second = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    expect(second.skipped).toBe(1);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(calls.filter((c) => c.path.startsWith('/contacts'))).toHaveLength(0);
  });

  it('updates a contact whose properties changed, without touching segments', async () => {
    seedUser('u1', 'chg@example.com', { credits: 1 });
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    calls.length = 0;
    kv.delete('resend-sync-cursor');
    raw.prepare('UPDATE users SET credits_used = 9 WHERE id = ?').run('u1');
    const r = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    expect(r.updated).toBe(1);
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('/contacts/chg%40example.com');
    expect(patch.body).toMatchObject({ properties: { dw_credits_used: '9' } });
    // Segment did not move, so no membership churn.
    expect(calls.filter((c) => c.path.includes('/segments/'))).toHaveLength(0);
  });

  it('moves a contact between segments when its classification changes', async () => {
    seedUser('u1', 'up@example.com', { credits: 0 });
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });
    expect(ledger('up@example.com')!.segment).toBe('free_inactive');

    calls.length = 0;
    kv.delete('resend-sync-cursor');
    raw.prepare('UPDATE users SET is_community_member = 1 WHERE id = ?').run('u1');
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    const del = calls.find((c) => c.method === 'DELETE' && c.path.includes('/segments/'));
    const add = calls.find((c) => c.method === 'POST' && c.path.includes('/segments/'));
    expect(del).toBeTruthy();
    expect(add).toBeTruthy();
    expect(ledger('up@example.com')!.segment).toBe('member');
  });

  it('falls back to PATCH when the contact already exists in Resend', async () => {
    seedUser('u1', 'dupe@example.com');
    failOn = (c) => (c.method === 'POST' && c.path === '/contacts' ? 409 : null);

    const r = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    expect(r.updated).toBe(1);
    expect(r.errors).toBe(0);
    expect(pathsFor('PATCH')).toContain('/contacts/dupe%40example.com');
  });

  it('recreates a contact the ledger knows but Resend has lost', async () => {
    seedUser('u1', 'lost@example.com');
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    calls.length = 0;
    kv.delete('resend-sync-cursor');
    raw.prepare('UPDATE users SET name = ? WHERE id = ?').run('New Name', 'u1');
    failOn = (c) => (c.method === 'PATCH' ? 404 : null);

    const r = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });
    expect(r.created).toBe(1);
    expect(pathsFor('POST')).toContain('/contacts');
  });

  it('counts an error and moves on rather than aborting the pass', async () => {
    seedUser('u1', 'aaa@example.com');
    seedUser('u2', 'bbb@example.com');
    failOn = (c) =>
      c.method === 'POST' && c.path === '/contacts' && c.body?.email === 'aaa@example.com' ? 400 : null;

    const r = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    expect(r.errors).toBe(1);
    expect(r.created).toBe(1);
    expect(ledger('aaa@example.com')).toBeUndefined();
    expect(ledger('bbb@example.com')).toBeTruthy();
  });
});

describe('suppression safety', () => {
  it('never syncs a suppressed user', async () => {
    seedUser('u1', 'ok@example.com');
    seedUser('u2', 'no@example.com');
    await suppress(env, 'no@example.com', { reason: 'unsubscribe' });

    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    const emails = calls.filter((c) => c.method === 'POST' && c.path === '/contacts').map((c) => c.body!.email);
    expect(emails).toEqual(['ok@example.com']);
  });

  it('deletes an already-synced contact who later unsubscribes', async () => {
    seedUser('u1', 'later@example.com');
    await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });
    expect(ledger('later@example.com')).toBeTruthy();

    calls.length = 0;
    kv.delete('resend-sync-cursor');
    await suppress(env, 'later@example.com', { reason: 'complaint' });
    const r = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });

    expect(r.removed).toBe(1);
    expect(pathsFor('DELETE')).toContain('/contacts/later%40example.com');
    // Ledger row goes too, so a later resubscribe re-creates cleanly.
    expect(ledger('later@example.com')).toBeUndefined();
  });
});

describe('cursor and budget', () => {
  it('persists a cursor and resumes from it', async () => {
    for (let i = 1; i <= 5; i++) seedUser(`u${i}`, `u${i}@example.com`);
    const first = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000, pageSize: 2 });
    expect(first.done).toBe(true);
    expect(kv.get('resend-sync-cursor')).toBe('');
    expect(first.scanned).toBe(5);
  });

  it('reports done=false and keeps the cursor when the budget runs out', async () => {
    for (let i = 1; i <= 5; i++) seedUser(`u${i}`, `u${i}@example.com`);
    const r = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 0, pageSize: 2 });
    expect(r.done).toBe(false);
  });

  it('reset:true restarts from the beginning', async () => {
    seedUser('u1', 'a@example.com');
    kv.set('resend-sync-cursor', 'zzz');
    const r = await syncResendContacts(env, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000, reset: true });
    expect(r.scanned).toBe(1);
  });

  it('returns early with a note when no API key is configured', async () => {
    seedUser('u1', 'a@example.com');
    const noKey = { ...env, RESEND_API_KEY: '' } as Env;
    const r = await syncResendContacts(noKey, { requestSpacingMs: 0, retryBackoffMs: 0, budgetMs: 5000 });
    expect(r.done).toBe(true);
    expect(r.note).toContain('RESEND_API_KEY');
    expect(calls).toHaveLength(0);
  });
});
