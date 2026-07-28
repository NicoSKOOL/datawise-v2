// Integration coverage for the suppression gate inside the cron path.
// The unit tests in suppression.test.ts prove canEmail() is correct; these
// prove processEmailSequences() actually calls it before hitting Resend.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from '../test-support/d1';
import { processEmailSequences } from './sequences';
import { suppress } from './suppression';
import type { Env } from '../index';

let env: Env;
let raw: ReturnType<typeof createTestDb>['raw'];
let sentTo: string[];
let lastBody: Record<string, unknown> | null;

function seedUser(id: string, email: string) {
  raw
    .prepare('INSERT INTO users (id, google_id, email, name) VALUES (?, ?, ?, ?)')
    .run(id, `google-${id}`, email, 'Test User');
}

function seedDueSequence(userId: string, type = 'credits_exhausted') {
  raw
    .prepare(
      `INSERT INTO email_sequences (user_id, sequence_type, current_step, next_send_at)
       VALUES (?, ?, 0, datetime('now', '-1 day'))`
    )
    .run(userId, type);
}

function sequenceState(userId: string): { cancelled: number; current_step: number } {
  return raw
    .prepare('SELECT cancelled, current_step FROM email_sequences WHERE user_id = ?')
    .get(userId) as never;
}

beforeEach(() => {
  const db = createTestDb();
  raw = db.raw;
  sentTo = [];
  lastBody = null;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      lastBody = body;
      sentTo.push(body.to[0]);
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
    })
  );

  env = {
    DB: db.d1,
    UNSUBSCRIBE_SECRET: 'test-secret',
    WORKER_URL: 'https://api.example.com',
    RESEND_API_KEY: 'test-key',
  } as unknown as Env;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('processEmailSequences respects the suppression gate', () => {
  it('sends to a user with no suppression', async () => {
    seedUser('ok-1', 'reachable@example.com');
    seedDueSequence('ok-1');

    const result = await processEmailSequences(env);

    expect(result.sent).toBe(1);
    expect(sentTo).toEqual(['reachable@example.com']);
    expect(sequenceState('ok-1').current_step).toBe(1);
  });

  it('does not send to a suppressed user, and cancels the sequence', async () => {
    seedUser('gone-1', 'optout@example.com');
    seedDueSequence('gone-1');
    await suppress(env, 'optout@example.com', { reason: 'unsubscribe' });

    const result = await processEmailSequences(env);

    expect(result.sent).toBe(0);
    expect(sentTo).toEqual([]);
    // Cancelled, not merely skipped: otherwise the cron re-checks this row
    // every 6 hours forever.
    expect(sequenceState('gone-1').cancelled).toBe(1);
  });

  it('does not send to a hard-bounced address', async () => {
    seedUser('dead-1', 'dead@example.com');
    seedDueSequence('dead-1');
    await suppress(env, 'dead@example.com', { reason: 'bounce', scope: 'all' });

    const result = await processEmailSequences(env);

    expect(result.sent).toBe(0);
    expect(sequenceState('dead-1').cancelled).toBe(1);
  });

  it('honours a suppression recorded against an alias of the same inbox', async () => {
    seedUser('alias-1', 'Sam.Smith+dw@gmail.com');
    seedDueSequence('alias-1');
    await suppress(env, 'samsmith@gmail.com', { reason: 'unsubscribe' });

    const result = await processEmailSequences(env);

    expect(result.sent).toBe(0);
    expect(sequenceState('alias-1').cancelled).toBe(1);
  });

  it('attaches RFC 8058 one-click unsubscribe headers to marketing sends', async () => {
    seedUser('ok-2', 'headers@example.com');
    seedDueSequence('ok-2');

    await processEmailSequences(env);

    const headers = lastBody?.headers as Record<string, string>;
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/api\.example\.com\/api\/unsubscribe\?e=headers%40example\.com&t=[A-Za-z0-9_-]+&uid=ok-2>$/
    );
  });

  it('embeds the same signed unsubscribe link in the email body', async () => {
    seedUser('ok-3', 'body@example.com');
    seedDueSequence('ok-3');

    await processEmailSequences(env);

    const html = lastBody?.html as string;
    expect(html).toContain('/api/unsubscribe?e=body%40example.com&t=');
    // The old unsigned form must be gone.
    expect(html).not.toMatch(/\/api\/unsubscribe\?uid=[^&"]*"/);
  });

  it('still cancels for community members before consulting suppression', async () => {
    seedUser('member-1', 'member@example.com');
    raw.prepare('UPDATE users SET is_community_member = 1 WHERE id = ?').run('member-1');
    seedDueSequence('member-1');

    const result = await processEmailSequences(env);

    expect(result.sent).toBe(0);
    expect(sequenceState('member-1').cancelled).toBe(1);
  });
});
