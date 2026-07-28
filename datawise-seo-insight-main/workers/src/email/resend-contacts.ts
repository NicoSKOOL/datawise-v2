// Resend contact sync.
//
// Pushes D1 users into Resend as contacts carrying precomputed dw_* properties,
// and reconciles their segment membership. D1 stays the source of truth; Resend
// only ever receives answers, never rules.
//
// API surface used (verified against the reference on 2026-07-28; contacts are
// global entities and every endpoint accepts an EMAIL in place of a contact id,
// which is why no Resend contact ids are persisted):
//   GET    /contact-properties
//   POST   /contact-properties            { key, type, fallback_value }
//   GET    /segments
//   POST   /segments                      { name }
//   POST   /contacts                      { email, first_name, last_name, properties, segments }
//   PATCH  /contacts/{email}              { first_name, last_name, properties }
//   DELETE /contacts/{email}
//   POST   /contacts/{email}/segments/{segment_id}
//   DELETE /contacts/{email}/segments/{segment_id}
//
// Custom properties MUST exist before a contact references them, otherwise the
// contact call fails outright. ensureContactProperties() handles that.
import type { Env } from '../index';
import { normalizeEmail } from '../lib/email-normalize';
import {
  ALL_SEGMENTS,
  SEGMENT_LABELS,
  collectDesyncTargets,
  fetchSegmentPage,
  propsFingerprint,
  toContactSnapshot,
  type ContactSnapshot,
  type Segment,
} from './segments';

const API = 'https://api.resend.com';

// Resend allows 10 req/s per team. The same team also sends transactional mail,
// so stay well under and leave headroom rather than racing to the ceiling.
const MAX_REQUESTS_PER_SECOND = 5;
const MIN_REQUEST_SPACING_MS = 1000 / MAX_REQUESTS_PER_SECOND;

// Properties we declare. Values are always strings (Resend accepts string or
// number; one code path is simpler). Keys must be alphanumeric + underscore.
const CONTACT_PROPERTIES: Array<{ key: string; type: string; fallback_value: string }> = [
  { key: 'dw_segment', type: 'string', fallback_value: 'unknown' },
  { key: 'dw_tier', type: 'string', fallback_value: 'free' },
  { key: 'dw_signup_month', type: 'string', fallback_value: '' },
  { key: 'dw_credits_used', type: 'string', fallback_value: '0' },
];

const CURSOR_KEY = 'resend-sync-cursor';
const CACHE_KEY_SEGMENTS = 'resend-segment-ids';
const CACHE_TTL_SECONDS = 6 * 60 * 60;

export interface SyncResult {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  removed: number;
  errors: number;
  requests: number;
  done: boolean;
  cursor: string;
  note?: string;
}

class RateLimiter {
  private last = 0;
  constructor(private spacingMs: number) {}
  async wait(): Promise<void> {
    if (this.spacingMs <= 0) return;
    const now = Date.now();
    const gap = now - this.last;
    if (gap < this.spacingMs) {
      await new Promise((r) => setTimeout(r, this.spacingMs - gap));
    }
    this.last = Date.now();
  }
}

interface ApiResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

class ResendClient {
  requests = 0;
  private limiter: RateLimiter;

  constructor(
    private apiKey: string,
    spacingMs = MIN_REQUEST_SPACING_MS,
    private backoffMs = 1000
  ) {
    this.limiter = new RateLimiter(spacingMs);
  }

  async call(method: string, path: string, body?: unknown): Promise<ApiResponse> {
    await this.limiter.wait();
    this.requests++;

    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      // Back off and retry on rate limit or transient server error.
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, this.backoffMs * (attempt + 1)));
          continue;
        }
      }

      let parsed: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: res.status, ok: res.ok, body: parsed };
    }
    return { status: 0, ok: false, body: 'retries_exhausted' };
  }
}

/**
 * Create any dw_* property Resend does not already know about.
 *
 * Non-negotiable ordering: a contact that references an undeclared property is
 * rejected outright, so this runs before any contact write.
 */
export async function ensureContactProperties(client: ResendClient): Promise<void> {
  const existing = await client.call('GET', '/contact-properties');
  const known = new Set<string>();
  const data = (existing.body as { data?: Array<{ key?: string }> })?.data;
  if (Array.isArray(data)) {
    for (const p of data) if (p?.key) known.add(p.key);
  }

  for (const prop of CONTACT_PROPERTIES) {
    if (known.has(prop.key)) continue;
    const res = await client.call('POST', '/contact-properties', prop);
    // 409/422 means someone else created it between the list and the write.
    if (!res.ok && res.status !== 409 && res.status !== 422) {
      throw new Error(`failed to create contact property ${prop.key}: ${res.status}`);
    }
  }
}

/** Resolve our segment names to Resend segment ids, creating any that are missing. */
export async function ensureSegments(
  client: ResendClient,
  env: Env
): Promise<Record<Segment, string>> {
  const cached = await env.KV.get(CACHE_KEY_SEGMENTS, 'json');
  if (cached && typeof cached === 'object') {
    const map = cached as Record<string, string>;
    if (ALL_SEGMENTS.every((s) => map[s])) return map as Record<Segment, string>;
  }

  const listed = await client.call('GET', '/segments');
  const byName = new Map<string, string>();
  const data = (listed.body as { data?: Array<{ id?: string; name?: string }> })?.data;
  if (Array.isArray(data)) {
    for (const s of data) if (s?.name && s?.id) byName.set(s.name, s.id);
  }

  const map = {} as Record<Segment, string>;
  for (const seg of ALL_SEGMENTS) {
    const label = SEGMENT_LABELS[seg];
    let id = byName.get(label);
    if (!id) {
      const created = await client.call('POST', '/segments', { name: label });
      id = (created.body as { id?: string })?.id;
      if (!id) throw new Error(`failed to create segment ${label}: ${created.status}`);
    }
    map[seg] = id;
  }

  await env.KV.put(CACHE_KEY_SEGMENTS, JSON.stringify(map), { expirationTtl: CACHE_TTL_SECONDS });
  return map;
}

async function upsertContact(
  client: ResendClient,
  snapshot: ContactSnapshot,
  segmentIds: Record<Segment, string>,
  isKnown: boolean
): Promise<'created' | 'updated'> {
  const email = normalizeEmail(snapshot.email);
  const payload = {
    first_name: snapshot.firstName,
    last_name: snapshot.lastName,
    properties: snapshot.properties,
  };

  if (isKnown) {
    const patched = await client.call('PATCH', `/contacts/${encodeURIComponent(email)}`, payload);
    if (patched.ok) return 'updated';
    if (patched.status !== 404) {
      throw new Error(`PATCH contact failed (${patched.status})`);
    }
    // Ledger said we knew it but Resend disagrees (deleted upstream): fall
    // through and recreate.
  }

  const created = await client.call('POST', '/contacts', {
    email,
    ...payload,
    segments: [segmentIds[snapshot.segment]],
  });
  if (created.ok) return 'created';

  // Already exists (created out of band, or a race): fall back to updating.
  if (created.status === 409 || created.status === 422) {
    const patched = await client.call('PATCH', `/contacts/${encodeURIComponent(email)}`, payload);
    if (patched.ok) return 'updated';
    throw new Error(`POST conflicted then PATCH failed (${patched.status})`);
  }
  throw new Error(`POST contact failed (${created.status})`);
}

async function moveSegment(
  client: ResendClient,
  email: string,
  segmentIds: Record<Segment, string>,
  from: Segment | null,
  to: Segment
): Promise<void> {
  const e = encodeURIComponent(normalizeEmail(email));
  if (from && from !== to && segmentIds[from]) {
    await client.call('DELETE', `/contacts/${e}/segments/${segmentIds[from]}`);
  }
  await client.call('POST', `/contacts/${e}/segments/${segmentIds[to]}`);
}

/**
 * Sync a slice of users into Resend.
 *
 * Cursor lives in KV, so successive invocations (cron or the admin endpoint)
 * walk the whole table without re-scanning. Returns `done: false` when the
 * budget ran out mid-pass, which lets the admin endpoint be called repeatedly
 * to seed the initial load rather than waiting days for the daily cron.
 */
export async function syncResendContacts(
  env: Env,
  opts: {
    budgetMs?: number;
    pageSize?: number;
    reset?: boolean;
    /** Test seam: 0 disables inter-request pacing. Production must not set this. */
    requestSpacingMs?: number;
    retryBackoffMs?: number;
  } = {}
): Promise<SyncResult> {
  const budgetMs = opts.budgetMs ?? 20_000;
  const pageSize = opts.pageSize ?? 100;
  const startedAt = Date.now();

  const client = new ResendClient(
    env.RESEND_API_KEY,
    opts.requestSpacingMs ?? MIN_REQUEST_SPACING_MS,
    opts.retryBackoffMs ?? 1000
  );
  const result: SyncResult = {
    scanned: 0, created: 0, updated: 0, skipped: 0,
    removed: 0, errors: 0, requests: 0, done: false, cursor: '',
  };

  if (!env.RESEND_API_KEY) {
    return { ...result, done: true, note: 'RESEND_API_KEY not set' };
  }

  await ensureContactProperties(client);
  const segmentIds = await ensureSegments(client, env);

  let cursor = opts.reset ? '' : (await env.KV.get(CURSOR_KEY)) ?? '';

  // Remove anyone who became suppressed or banned since we last pushed them.
  // Done first: leaving an opted-out address inside a segment is the one
  // failure mode that actually harms someone.
  for (const email of await collectDesyncTargets(env, 25)) {
    if (Date.now() - startedAt > budgetMs) break;
    try {
      await client.call('DELETE', `/contacts/${encodeURIComponent(email)}`);
      await env.DB.prepare('DELETE FROM resend_contact_sync WHERE email = ?').bind(email).run();
      result.removed++;
    } catch {
      result.errors++;
    }
  }

  while (Date.now() - startedAt < budgetMs) {
    const rows = await fetchSegmentPage(env, cursor, pageSize);
    if (!rows.length) {
      cursor = '';
      result.done = true;
      break;
    }

    for (const row of rows) {
      if (Date.now() - startedAt > budgetMs) break;
      result.scanned++;
      cursor = row.user_id;

      const snapshot = toContactSnapshot(row);
      const email = normalizeEmail(snapshot.email);
      const hash = propsFingerprint(snapshot);

      const ledger = await env.DB.prepare(
        'SELECT props_hash, segment FROM resend_contact_sync WHERE email = ?'
      )
        .bind(email)
        .first<{ props_hash: string; segment: string }>();

      if (ledger?.props_hash === hash) {
        result.skipped++;
        continue;
      }

      try {
        const outcome = await upsertContact(client, snapshot, segmentIds, Boolean(ledger));

        // POST /contacts already placed a new contact in its segment, so only
        // the update path ever needs reconciling, and then only when the
        // segment actually moved or we have no record of where it sits.
        const previous = (ledger?.segment as Segment | undefined) ?? null;
        if (outcome === 'updated' && previous !== snapshot.segment) {
          await moveSegment(client, email, segmentIds, previous, snapshot.segment);
        }

        await env.DB.prepare(
          `INSERT INTO resend_contact_sync (email, user_id, segment, props_hash, synced_at)
           VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(email) DO UPDATE SET
             user_id = excluded.user_id,
             segment = excluded.segment,
             props_hash = excluded.props_hash,
             synced_at = excluded.synced_at`
        )
          .bind(email, snapshot.userId, snapshot.segment, hash)
          .run();

        if (outcome === 'created') result.created++;
        else result.updated++;
      } catch (err) {
        console.error(`Resend contact sync failed for ${email}:`, err);
        result.errors++;
      }
    }

    if (rows.length < pageSize) {
      cursor = '';
      result.done = true;
      break;
    }
  }

  await env.KV.put(CURSOR_KEY, cursor);
  result.cursor = cursor;
  result.requests = client.requests;
  return result;
}
