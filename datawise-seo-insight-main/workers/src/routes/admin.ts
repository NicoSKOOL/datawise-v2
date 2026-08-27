import type { Env } from '../index';
import type { AuthUser } from '../auth/google';
import { sendInviteEmail } from '../email/resend';
import { cancelUserSequences, startWinbackSequence } from '../email/sequences';
import { logTierChange, logBulkTierChanges, upgradeUserToCommunityIfMember } from '../lib/tier-changes';
import { normalizeEmail } from '../lib/email-normalize';
import { suggestMembers, type BlockedAccount, type RosterCandidate } from '../lib/member-match';

const ADMIN_EMAIL = 'nico@airankingskool.com';

// env is optional so the many existing one-arg call sites (feedback.ts,
// admin-activity.ts, admin-content-writer-prompts.ts, etc.) keep compiling
// unchanged; they fall back to the single hardcoded admin email. Passing
// env lets a route (currently only the blueprint router) check against the
// ADMIN_EMAILS allowlist (wrangler.toml [vars]) instead.
export function isAdmin(user: AuthUser, env?: { ADMIN_EMAILS?: string }): boolean {
  if (isTruthyFlag(user.is_admin)) return true;
  const allowlist = (env?.ADMIN_EMAILS ?? ADMIN_EMAIL)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(user.email.toLowerCase());
}

interface CommunitySyncUser {
  id: string;
  email: string;
  name: string | null;
  subscription_tier: string | null;
  is_community_member: number | boolean | null;
  is_admin: number | boolean | null;
}

interface CommunitySyncResult {
  granted: number;
  revoked: number;
  preserved_pro: number;
  winback_started: number;
  revoked_emails: string[];
}

function isTruthyFlag(value: number | boolean | null | undefined): boolean {
  return value === true || value === 1;
}

// Every identity a roster represents: the lower-cased email plus its canonical
// (dots/+tags collapsed) form. Users match if either form of THEIR email is in
// the set, so gmail-dot variants between Skool and Google logins line up.
function rosterKeySet(emails: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const raw of emails) {
    const lower = String(raw || '').trim().toLowerCase();
    if (!lower) continue;
    keys.add(lower);
    keys.add(normalizeEmail(lower));
  }
  return keys;
}

// Reconciles users against the CURRENT community_members table (not the raw
// CSV): webhook/manual rows count as membership even when the Skool export
// misses them.
async function reconcileCommunityAccess(env: Env, memberKeys: Set<string>): Promise<CommunitySyncResult> {
  const { results } = await env.DB.prepare(`
    SELECT id, email, name, subscription_tier, is_community_member, is_admin
    FROM users
  `).all<CommunitySyncUser>();

  let granted = 0;
  let revoked = 0;
  let preservedPro = 0;
  let winbackStarted = 0;
  const revokedEmails: string[] = [];

  for (const user of results || []) {
    const email = String(user.email || '').trim().toLowerCase();
    if (!email) continue;

    const tier = user.subscription_tier || 'free';
    const isCommunityMember = isTruthyFlag(user.is_community_member);
    const isAdminUser = isTruthyFlag(user.is_admin) || email === ADMIN_EMAIL;
    const inCsv = memberKeys.has(email) || memberKeys.has(normalizeEmail(email));

    if (inCsv) {
      if (tier === 'pro') {
        if (!isCommunityMember) {
          await env.DB.prepare(
            "UPDATE users SET is_community_member = 1, updated_at = datetime('now') WHERE id = ?"
          ).bind(user.id).run();
          granted++;
        }
        await cancelUserSequences(env, user.id);
        continue;
      }

      if (tier !== 'community' || !isCommunityMember) {
        await logTierChange(env.DB, user.id, tier, 'community', 'csv_upload');
        await env.DB.prepare(
          "UPDATE users SET is_community_member = 1, subscription_tier = 'community', updated_at = datetime('now') WHERE id = ?"
        ).bind(user.id).run();
        granted++;
      }

      await cancelUserSequences(env, user.id);
      continue;
    }

    if (isAdminUser) continue;

    if (tier === 'pro') {
      if (isCommunityMember) {
        await env.DB.prepare(
          "UPDATE users SET is_community_member = 0, updated_at = datetime('now') WHERE id = ?"
        ).bind(user.id).run();
        preservedPro++;
      }
      continue;
    }

    if (tier === 'community' || isCommunityMember) {
      await logTierChange(env.DB, user.id, tier, 'free', 'csv_upload');
      await env.DB.prepare(
        "UPDATE users SET subscription_tier = 'free', is_community_member = 0, updated_at = datetime('now') WHERE id = ?"
      ).bind(user.id).run();
      await startWinbackSequence(env, user.id);
      revoked++;
      winbackStarted++;
      revokedEmails.push(email);
    }
  }

  return { granted, revoked, preserved_pro: preservedPro, winback_started: winbackStarted, revoked_emails: revokedEmails };
}

// Durable roster row for an admin-granted member. 'manual' rows survive CSV
// uploads; ON CONFLICT also promotes an existing csv/webhook row to manual.
async function upsertManualRosterRow(env: Env, email: string): Promise<void> {
  const lower = String(email || '').trim().toLowerCase();
  if (!lower) return;
  await env.DB.prepare(
    `INSERT INTO community_members (email, source, normalized_email)
     VALUES (?, 'manual', ?)
     ON CONFLICT(email) DO UPDATE SET source = 'manual', normalized_email = excluded.normalized_email`
  ).bind(lower, normalizeEmail(lower)).run();
}

// Removes every roster row representing this identity (exact or alias form),
// so login-time auto-detect cannot re-grant a deliberate revocation.
async function deleteRosterRowsForEmail(env: Env, email: string): Promise<void> {
  const lower = String(email || '').trim().toLowerCase();
  if (!lower) return;
  await env.DB.prepare(
    'DELETE FROM community_members WHERE lower(email) = ? OR normalized_email = ?'
  ).bind(lower, normalizeEmail(lower)).run();
}

// POST /api/admin/upload-members
export async function handleUploadMembers(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { csv } = await request.json() as { csv: string };
  if (!csv) {
    return new Response(JSON.stringify({ error: 'CSV data required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Tolerate a UTF-8 BOM and CRLF line endings (both appear in real Skool exports).
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) {
    return new Response(JSON.stringify({ error: 'CSV must have a header row and at least one data row' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Parse header to find column indices
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const emailIdx = header.findIndex(h => h === 'email');
  const firstNameIdx = header.findIndex(h => h.includes('first') && h.includes('name'));
  const lastNameIdx = header.findIndex(h => h.includes('last') && h.includes('name'));
  const tierIdx = header.findIndex(h => h === 'tier');
  const ltvIdx = header.findIndex(h => h === 'ltv');
  const joinedIdx = header.findIndex(h => h.includes('joined'));

  if (emailIdx === -1) {
    return new Response(JSON.stringify({ error: 'CSV must have an Email column' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Upsert every CSV row as csv-managed. No blanket DELETE: webhook and manual
  // rows must survive an upload, because the Skool export has repeatedly been
  // missing genuinely-paying members (their Skool email differs from the email
  // the webhook or admin registered). Wiping them here is what caused the
  // Aug 2026 "paying member locked out after every CSV sync" incidents.
  const BATCH_SIZE = 80;
  let inserted = 0;
  const statements: D1PreparedStatement[] = [];
  const csvEmails = new Set<string>();
  const csvNormalized = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const email = cols[emailIdx]?.trim().toLowerCase();
    if (!email) continue;
    csvEmails.add(email);
    csvNormalized.add(normalizeEmail(email));

    const firstName = firstNameIdx >= 0 ? cols[firstNameIdx]?.trim() || null : null;
    const lastName = lastNameIdx >= 0 ? cols[lastNameIdx]?.trim() || null : null;
    const tier = tierIdx >= 0 ? cols[tierIdx]?.trim() || null : null;
    const ltv = ltvIdx >= 0 ? parseFloat(cols[ltvIdx]?.trim()) || 0 : 0;
    const joinedDate = joinedIdx >= 0 ? cols[joinedIdx]?.trim() || null : null;

    statements.push(
      env.DB.prepare(
        `INSERT INTO community_members (email, first_name, last_name, tier, ltv, joined_date, source, normalized_email, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, 'csv', ?, datetime('now'))
         ON CONFLICT(email) DO UPDATE SET
           first_name = excluded.first_name,
           last_name = excluded.last_name,
           tier = excluded.tier,
           ltv = excluded.ltv,
           joined_date = excluded.joined_date,
           source = 'csv',
           normalized_email = excluded.normalized_email,
           uploaded_at = excluded.uploaded_at`
      ).bind(email, firstName, lastName, tier, ltv, joinedDate, normalizeEmail(email))
    );
    inserted++;
  }

  // Execute in batches
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE);
    await env.DB.batch(batch);
  }

  // Prune csv-managed rows that dropped out of the export: those members left
  // the community, and reconcile below revokes their user accounts.
  const { results: csvRows } = await env.DB.prepare(
    "SELECT id, email FROM community_members WHERE source = 'csv'"
  ).all<{ id: number; email: string }>();
  const staleIds = (csvRows || [])
    .filter(r => !csvEmails.has(String(r.email || '').trim().toLowerCase()))
    .map(r => r.id);
  for (let i = 0; i < staleIds.length; i += BATCH_SIZE) {
    const chunk = staleIds.slice(i, i + BATCH_SIZE);
    await env.DB.prepare(
      `DELETE FROM community_members WHERE id IN (${chunk.map(() => '?').join(',')})`
    ).bind(...chunk).run();
  }

  // Webhook/manual rows the export does not cover: preserved, but surfaced to
  // the admin so a member who genuinely left can still be revoked by hand.
  const { results: nonCsvRows } = await env.DB.prepare(
    "SELECT email, source FROM community_members WHERE source != 'csv'"
  ).all<{ email: string; source: string }>();
  const protectedMembers = (nonCsvRows || []).filter(r => {
    const lower = String(r.email || '').trim().toLowerCase();
    return !csvEmails.has(lower) && !csvNormalized.has(normalizeEmail(lower));
  });

  // Reconcile users against the resulting table state (csv + webhook + manual).
  const { results: rosterRows } = await env.DB.prepare(
    'SELECT email FROM community_members'
  ).all<{ email: string }>();
  // Linked login emails count as membership too. Without this the sweep would
  // revoke the very accounts an admin linked, since an alias deliberately has
  // no community_members row of its own.
  const { results: aliasRows } = await env.DB.prepare(
    `SELECT a.alias_email FROM community_email_aliases a
       WHERE EXISTS (
         SELECT 1 FROM community_members cm
          WHERE lower(cm.email) = lower(a.member_email)
             OR cm.normalized_email = a.member_normalized
       )`
  ).all<{ alias_email: string }>();
  const memberKeys = rosterKeySet([
    ...(rosterRows || []).map(r => r.email),
    ...(aliasRows || []).map(r => r.alias_email),
  ]);

  const sync = await reconcileCommunityAccess(env, memberKeys);

  return new Response(JSON.stringify({
    success: true,
    imported: inserted,
    ...sync,
    protected_members: protectedMembers,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/admin/cross-reference
export async function handleCrossReference(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Active members: app users whose email IS on the roster, directly or through
  // an admin-confirmed alias. The alias arm is what keeps a linked account out
  // of the Non-Members list below, where a revoke click would strip it.
  const activeMembers = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.subscription_tier, u.created_at,
           cm.first_name, cm.last_name, cm.tier as community_tier, cm.ltv, cm.joined_date,
           CASE WHEN lower(u.email) = lower(cm.email) THEN NULL ELSE cm.email END AS linked_via
    FROM users u
    INNER JOIN community_members cm
      ON lower(u.email) = lower(cm.email)
      OR lower(cm.email) IN (
        SELECT lower(a.member_email) FROM community_email_aliases a
         WHERE lower(a.alias_email) = lower(u.email)
      )
  `).all();

  // Non-members: app users on neither the roster nor an alias.
  const nonMembers = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.subscription_tier, u.is_community_member, u.created_at
    FROM users u
    WHERE lower(u.email) NOT IN (SELECT lower(email) FROM community_members)
      AND lower(u.email) NOT IN (SELECT lower(alias_email) FROM community_email_aliases)
  `).all();

  // Not registered: roster members with no account under their roster email and
  // no account linked to it by alias.
  const notRegistered = await env.DB.prepare(`
    SELECT cm.email, cm.first_name, cm.last_name, cm.tier, cm.ltv, cm.joined_date
    FROM community_members cm
    WHERE lower(cm.email) NOT IN (SELECT lower(email) FROM users)
      AND lower(cm.email) NOT IN (SELECT lower(member_email) FROM community_email_aliases)
  `).all();

  // Total community members count
  const totalMembers = await env.DB.prepare('SELECT COUNT(*) as count FROM community_members').first();

  return new Response(JSON.stringify({
    total_csv_members: totalMembers?.count || 0,
    active_members: activeMembers.results || [],
    non_members: nonMembers.results || [],
    not_registered: notRegistered.results || [],
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/admin/email-mismatches
//
// Finds paying Skool members who are locked out because they signed up for
// DataWise with a different email than they used on Skool. Two lists, scored
// against each other:
//
//   unclaimed grants  - roster members whose invite was never claimed. The
//                       marker is exact, not a guess: Google login overwrites
//                       google_id and email signup sets password_hash, so a row
//                       can only still be 'invited:' with a NULL password_hash
//                       if nobody ever logged into it.
//   blocked accounts  - free accounts that burned real credits and are on
//                       neither the roster nor an alias.
export async function handleEmailMismatches(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const url = new URL(request.url);
  const minCredits = Math.max(1, parseInt(url.searchParams.get('min_credits') || '3', 10) || 3);

  const { results: unclaimedRows } = await env.DB.prepare(`
    SELECT u.id AS user_id, u.email, cm.first_name, cm.last_name, cm.tier, cm.ltv, cm.joined_date
    FROM users u
    INNER JOIN community_members cm ON lower(cm.email) = lower(u.email)
    WHERE u.google_id LIKE 'invited:%'
      AND u.password_hash IS NULL
    ORDER BY cm.joined_date DESC
  `).all<{
    user_id: string; email: string; first_name: string | null;
    last_name: string | null; tier: string | null; ltv: number | null; joined_date: string | null;
  }>();

  const { results: blockedRows } = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.created_at, u.credits_used
    FROM users u
    WHERE u.subscription_tier = 'free'
      AND u.credits_used >= ?
      AND u.is_admin = 0
      AND lower(u.email) NOT IN (SELECT lower(email) FROM community_members)
      AND lower(u.email) NOT IN (SELECT lower(alias_email) FROM community_email_aliases)
    ORDER BY u.credits_used DESC, u.created_at DESC
  `).bind(minCredits).all<BlockedAccount>();

  const roster: RosterCandidate[] = (unclaimedRows || []).map(r => ({
    email: r.email,
    first_name: r.first_name,
    last_name: r.last_name,
    joined_date: r.joined_date,
  }));

  const matches = [];
  for (const account of blockedRows || []) {
    const suggestions = suggestMembers(account, roster);
    if (suggestions.length > 0) matches.push({ account, suggestions });
  }
  matches.sort((a, b) => b.suggestions[0].score - a.suggestions[0].score);

  return new Response(JSON.stringify({
    matches,
    unclaimed_grants: unclaimedRows || [],
    blocked_count: (blockedRows || []).length,
    min_credits: minCredits,
  }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/admin/link-member
//
// Records that a login email and a roster email are the same person, then
// grants community access. The alias is the durable half: every login path
// re-resolves it through findCommunityMemberByEmail, so a later CSV upload
// cannot strip the grant.
export async function handleLinkMember(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await request.json() as { user_id?: string; login_email?: string; member_email?: string; note?: string };
  const userId = String(body.user_id || '').trim();
  const loginEmail = String(body.login_email || '').trim().toLowerCase();
  const memberEmail = String(body.member_email || '').trim().toLowerCase();
  if ((!userId && !loginEmail) || !memberEmail) {
    return new Response(JSON.stringify({ error: 'member_email plus one of user_id or login_email are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Suggested pairs arrive with a user_id; manual pairing types an address.
  const target = userId
    ? await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first<{ id: string; email: string }>()
    : await env.DB.prepare('SELECT id, email FROM users WHERE lower(email) = ?').bind(loginEmail).first<{ id: string; email: string }>();
  if (!target) {
    return new Response(JSON.stringify({ error: userId ? 'User not found' : `No DataWise account uses ${loginEmail}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  const member = await env.DB.prepare(
    'SELECT email, normalized_email FROM community_members WHERE lower(email) = ? LIMIT 1'
  ).bind(memberEmail).first<{ email: string; normalized_email: string | null }>();
  if (!member) {
    return new Response(JSON.stringify({ error: 'That email is not on the community roster' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const aliasEmail = String(target.email || '').trim().toLowerCase();
  if (aliasEmail === memberEmail) {
    return new Response(JSON.stringify({ error: 'Account already uses the roster email' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare(
    `INSERT INTO community_email_aliases
       (alias_email, member_email, alias_normalized, member_normalized, linked_by, note)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(alias_email) DO UPDATE SET
       member_email = excluded.member_email,
       member_normalized = excluded.member_normalized,
       linked_by = excluded.linked_by,
       note = excluded.note`
  ).bind(
    aliasEmail,
    member.email.toLowerCase(),
    normalizeEmail(aliasEmail),
    member.normalized_email || normalizeEmail(member.email.toLowerCase()),
    user.email,
    body.note || null,
  ).run();

  const upgrade = await upgradeUserToCommunityIfMember(env, target.id, aliasEmail, 'admin_email_link');

  // Retire the stranded invite row, but only when it is provably untouched:
  // never logged in, no password, no usage. Anything else is someone's real
  // account and must be left alone even though it shares the identity.
  let removedOrphan: string | null = null;
  const orphan = await env.DB.prepare(
    `SELECT id, email FROM users
      WHERE lower(email) = ?
        AND google_id LIKE 'invited:%'
        AND password_hash IS NULL
        AND credits_used = 0
        AND id != ?
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id)`
  ).bind(memberEmail, target.id).first<{ id: string; email: string }>();
  if (orphan) {
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(orphan.id).run();
    removedOrphan = orphan.email;
  }

  return new Response(JSON.stringify({
    success: true,
    alias_email: aliasEmail,
    member_email: member.email,
    granted: upgrade.changed,
    preserved_pro: upgrade.preservedPro,
    removed_orphan_account: removedOrphan,
  }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/admin/unlink-member
export async function handleUnlinkMember(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const body = await request.json() as { alias_email?: string };
  const aliasEmail = String(body.alias_email || '').trim().toLowerCase();
  if (!aliasEmail) {
    return new Response(JSON.stringify({ error: 'alias_email is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  await env.DB.prepare('DELETE FROM community_email_aliases WHERE lower(alias_email) = ?').bind(aliasEmail).run();
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/admin/revoke-access
export async function handleRevokeAccess(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { user_ids, action } = await request.json() as { user_ids: string[]; action?: 'restore' };
  if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
    return new Response(JSON.stringify({ error: 'user_ids array required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const placeholders = user_ids.map(() => '?').join(',');

  const { results: affectedUsers } = await env.DB.prepare(
    `SELECT id, email, subscription_tier FROM users WHERE id IN (${placeholders})`
  ).bind(...user_ids).all<{ id: string; email: string; subscription_tier: string | null }>();

  if (action === 'restore') {
    await env.DB.prepare(
      `UPDATE users SET subscription_tier = 'community', is_community_member = 1, updated_at = datetime('now') WHERE id IN (${placeholders})`
    ).bind(...user_ids).run();
    // Put them back on the roster (as durable manual rows) so the change
    // survives logins and future CSV uploads.
    for (const u of affectedUsers || []) {
      await upsertManualRosterRow(env, u.email);
    }
    await logBulkTierChanges(
      env.DB,
      (affectedUsers || []).map(u => ({ id: u.id, tier: u.subscription_tier || 'free' })),
      'community',
      'admin_restore'
    );
  } else {
    await env.DB.prepare(
      `UPDATE users SET subscription_tier = 'free', is_community_member = 0, updated_at = datetime('now') WHERE id IN (${placeholders})`
    ).bind(...user_ids).run();
    // Also remove their roster rows: otherwise the next Google login's
    // auto-detect silently re-grants what the admin just revoked.
    for (const u of affectedUsers || []) {
      await deleteRosterRowsForEmail(env, u.email);
    }
    await logBulkTierChanges(
      env.DB,
      (affectedUsers || []).map(u => ({ id: u.id, tier: u.subscription_tier || 'free' })),
      'free',
      'admin_revoke'
    );
  }

  return new Response(JSON.stringify({ success: true, affected: user_ids.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/admin/send-invites
export async function handleSendInvites(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const body = await request.json() as { emails?: string[] };

  // Get not-registered community members (in CSV but no user account)
  let query = `
    SELECT cm.email, cm.first_name, cm.last_name
    FROM community_members cm
    WHERE lower(cm.email) NOT IN (SELECT lower(email) FROM users)
  `;
  const params: string[] = [];

  if (body.emails?.length) {
    const placeholders = body.emails.map(() => '?').join(',');
    query += ` AND lower(cm.email) IN (${placeholders})`;
    params.push(...body.emails.map(e => e.toLowerCase()));
  }

  const { results: members } = params.length
    ? await env.DB.prepare(query).bind(...params).all()
    : await env.DB.prepare(query).all();

  let sent = 0;
  let failed = 0;

  for (const member of (members || []) as any[]) {
    const email = (member.email as string).toLowerCase();
    const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || null;

    // Pre-create user account
    const userId = crypto.randomUUID().replace(/-/g, '');
    try {
      await env.DB.prepare(
        "INSERT INTO users (id, google_id, email, name, is_community_member, subscription_tier) VALUES (?, ?, ?, ?, 1, 'community')"
      ).bind(userId, `invited:${userId}`, email, name || email.split('@')[0]).run();
    } catch {
      // User might already exist (race condition), skip
      failed++;
      continue;
    }

    // Generate activation token (24h expiry for invites)
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const rawToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawToken));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
      'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID().replace(/-/g, ''), userId, tokenHash, expiresAt).run();

    const activateUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;
    const emailSent = await sendInviteEmail(env, email, name, activateUrl);

    if (emailSent) {
      sent++;
    } else {
      failed++;
    }

    // Small delay to avoid hitting Resend rate limits
    if (sent % 10 === 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return new Response(JSON.stringify({ sent, failed, total: (members || []).length }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/admin/toggle-member
export async function handleToggleMember(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { user_id, action } = await request.json() as { user_id?: string; action?: 'grant' | 'revoke' };
  if (!user_id || !action) {
    return new Response(JSON.stringify({ error: 'user_id and action are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const target = await env.DB.prepare(
    'SELECT id, email, subscription_tier FROM users WHERE id = ?'
  ).bind(user_id).first<{ id: string; email: string; subscription_tier: string | null }>();
  if (!target) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  if (action === 'grant') {
    await env.DB.prepare(
      "UPDATE users SET subscription_tier = 'community', is_community_member = 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(user_id).run();
    await upsertManualRosterRow(env, target.email);
    await logTierChange(env.DB, target.id, target.subscription_tier || 'free', 'community', 'toggle_grant');
  } else {
    await env.DB.prepare(
      "UPDATE users SET subscription_tier = 'free', is_community_member = 0, updated_at = datetime('now') WHERE id = ?"
    ).bind(user_id).run();
    await deleteRosterRowsForEmail(env, target.email);
    await logTierChange(env.DB, target.id, target.subscription_tier || 'free', 'free', 'toggle_revoke');
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /api/admin/add-member
export async function handleAddMember(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { email, send_invite } = await request.json() as { email?: string; send_invite?: boolean };
  if (!email?.trim()) {
    return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const cleanEmail = email.trim().toLowerCase();

  // Durable manual roster row (so auto-detect works and CSV uploads keep it)
  await upsertManualRosterRow(env, cleanEmail);

  // Check if user already has an account
  const existingUser = await env.DB.prepare(
    'SELECT id, is_community_member FROM users WHERE lower(email) = ?'
  ).bind(cleanEmail).first();

  if (existingUser) {
    // Grant community access to existing user
    await env.DB.prepare(
      "UPDATE users SET is_community_member = 1, subscription_tier = 'community', updated_at = datetime('now') WHERE id = ?"
    ).bind(existingUser.id as string).run();

    // Send welcome email if they already have a password (existing active user)
    const userInfo = await env.DB.prepare('SELECT name, password_hash FROM users WHERE id = ?').bind(existingUser.id as string).first();
    if (userInfo?.password_hash) {
      // Already has account, send a simple notification
      await sendInviteEmail(env, cleanEmail, userInfo.name as string | null, `${env.FRONTEND_URL}/auth`);
    } else {
      // Has account but no password (e.g., Google-only or invited but never activated), send activation link
      const tokenBytes = new Uint8Array(32);
      crypto.getRandomValues(tokenBytes);
      const rawToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawToken));
      const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await env.DB.prepare(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
      ).bind(crypto.randomUUID().replace(/-/g, ''), existingUser.id as string, tokenHash, expiresAt).run();
      await sendInviteEmail(env, cleanEmail, userInfo?.name as string | null, `${env.FRONTEND_URL}/reset-password?token=${rawToken}`);
    }

    return new Response(JSON.stringify({ status: 'granted', message: 'Community access granted and notification sent' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // No account yet - pre-create and optionally send invite
  const userId = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    "INSERT INTO users (id, google_id, email, name, is_community_member, subscription_tier) VALUES (?, ?, ?, ?, 1, 'community')"
  ).bind(userId, `invited:${userId}`, cleanEmail, cleanEmail.split('@')[0]).run();

  if (send_invite !== false) {
    // Generate activation token
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const rawToken = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawToken));
    const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(
      'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID().replace(/-/g, ''), userId, tokenHash, expiresAt).run();

    const activateUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;
    await sendInviteEmail(env, cleanEmail, null, activateUrl);
  }

  return new Response(JSON.stringify({ status: 'invited', message: send_invite !== false ? 'Account created and invite sent' : 'Account created' }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// DELETE /api/admin/delete-user
export async function handleDeleteUser(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { user_id } = await request.json() as { user_id?: string };
  if (!user_id) {
    return new Response(JSON.stringify({ error: 'user_id is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Don't allow deleting yourself
  if (user_id === user.id) {
    return new Response(JSON.stringify({ error: 'Cannot delete your own account' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // CASCADE will handle sessions, projects, keywords, etc.
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user_id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/admin/users
export async function handleListUsers(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { results } = await env.DB.prepare(`
    SELECT id, email, name, avatar_url, subscription_tier, is_community_member, is_admin, credits_used, created_at
    FROM users ORDER BY created_at DESC
  `).all();

  return new Response(JSON.stringify({ users: results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleListPromoCodes(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { results } = await env.DB.prepare(`
    SELECT pc.*,
      COUNT(pr.id) AS redemption_count,
      0 AS conversion_count,
      0 AS total_ltv,
      NULL AS avg_days_to_convert
    FROM promo_codes pc
    LEFT JOIN promo_redemptions pr ON pr.promo_code_id = pc.id
    GROUP BY pc.id
    ORDER BY pc.created_at DESC
  `).all();

  return new Response(JSON.stringify({
    promo_codes: results || [],
    organic: { conversion_count: 0, total_ltv: 0 },
    promo_total: { conversion_count: 0, total_ltv: 0 },
  }), { headers: { 'Content-Type': 'application/json' } });
}

export async function handleCreatePromoCode(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const body = await request.json().catch(() => ({})) as {
    code?: string;
    label?: string;
    duration_hours?: number;
    max_redemptions?: number | null;
    expires_at?: string | null;
  };
  const code = body.code?.trim().toUpperCase();
  const label = body.label?.trim();
  if (!code || !label) {
    return new Response(JSON.stringify({ error: 'code and label are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(`
    INSERT INTO promo_codes (id, code, label, duration_hours, max_redemptions, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    code,
    label,
    Number(body.duration_hours || 48),
    body.max_redemptions ?? null,
    body.expires_at || null
  ).run();

  const promoCode = await env.DB.prepare('SELECT * FROM promo_codes WHERE id = ?').bind(id).first();
  return new Response(JSON.stringify({ promo_code: promoCode }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleTogglePromoCode(
  request: Request,
  env: Env,
  user: AuthUser,
  codeId: string
): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  await env.DB.prepare('UPDATE promo_codes SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?')
    .bind(codeId)
    .run();
  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handlePromoRedemptions(
  request: Request,
  env: Env,
  user: AuthUser,
  codeId: string
): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const { results } = await env.DB.prepare(`
    SELECT pr.id,
      u.email AS user_email,
      u.name AS user_name,
      pr.activated_at,
      pr.expires_at,
      CASE WHEN datetime(pr.expires_at) < datetime('now') THEN 1 ELSE 0 END AS is_expired,
      0 AS converted,
      NULL AS converted_at
    FROM promo_redemptions pr
    JOIN users u ON u.id = pr.user_id
    WHERE pr.promo_code_id = ?
    ORDER BY pr.activated_at DESC
  `).bind(codeId).all();
  return new Response(JSON.stringify({ redemptions: results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleConversionAnalytics(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const total = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  const paid = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE subscription_tier IN ('pro','community')").first();
  const tiers = await env.DB.prepare('SELECT subscription_tier, COUNT(*) AS count FROM users GROUP BY subscription_tier').all();
  return new Response(JSON.stringify({
    overview: {
      free_to_paid: Number(paid?.count || 0),
      churned_back: 0,
      converted_users: Number(paid?.count || 0),
      total_users: Number(total?.count || 0),
      conversion_rate: Number(total?.count || 0) ? ((Number(paid?.count || 0) / Number(total?.count || 0)) * 100).toFixed(1) : '0.0',
    },
    promo_funnel: { total_promo_users: 0, promo_then_converted: 0, promo_conversion_rate: '0.0' },
    tier_distribution: tiers.results || [],
    monthly_conversions: [],
    conversions_by_source: [],
  }), { headers: { 'Content-Type': 'application/json' } });
}

function analyticsRange(request: Request): { from: string; to: string } {
  const url = new URL(request.url);
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return { from, to };
}

export async function handleTrafficAnalytics(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const range = analyticsRange(request);
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS sessions, COUNT(DISTINCT user_id) AS logged_in_users
    FROM pageviews WHERE date(created_at) BETWEEN ? AND ?
  `).bind(range.from, range.to).first();
  const sources = await env.DB.prepare(`
    SELECT COALESCE(utm_source, referrer_host, 'direct') AS source, COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS sessions
    FROM pageviews WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY source ORDER BY pageviews DESC LIMIT 20
  `).bind(range.from, range.to).all();
  const daily = await env.DB.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS sessions
    FROM pageviews WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY day ORDER BY day ASC
  `).bind(range.from, range.to).all();
  const topPaths = await env.DB.prepare(`
    SELECT path, COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS sessions
    FROM pageviews WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY path ORDER BY pageviews DESC LIMIT 20
  `).bind(range.from, range.to).all();
  const countries = await env.DB.prepare(`
    SELECT COALESCE(country, 'unknown') AS country, COUNT(DISTINCT session_id) AS sessions
    FROM pageviews WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY country ORDER BY sessions DESC LIMIT 20
  `).bind(range.from, range.to).all();

  return new Response(JSON.stringify({
    range,
    totals: {
      pageviews: Number(totals?.pageviews || 0),
      sessions: Number(totals?.sessions || 0),
      logged_in_users: Number(totals?.logged_in_users || 0),
    },
    sources: sources.results || [],
    daily: daily.results || [],
    top_paths: topPaths.results || [],
    countries: countries.results || [],
  }), { headers: { 'Content-Type': 'application/json' } });
}

export async function handleSignupAnalytics(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const range = analyticsRange(request);
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) AS total_signups,
      SUM(CASE WHEN subscription_tier IN ('pro','community') THEN 1 ELSE 0 END) AS paid_signups,
      SUM(CASE WHEN signup_utm_source IS NULL AND signup_referrer IS NULL THEN 1 ELSE 0 END) AS unattributed
    FROM users WHERE date(created_at) BETWEEN ? AND ?
  `).bind(range.from, range.to).first();
  const bySource = await env.DB.prepare(`
    SELECT signup_utm_source AS utm_source, signup_referrer AS referrer, COUNT(*) AS signups,
      SUM(CASE WHEN subscription_tier IN ('pro','community') THEN 1 ELSE 0 END) AS paid
    FROM users WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY signup_utm_source, signup_referrer ORDER BY signups DESC LIMIT 20
  `).bind(range.from, range.to).all();
  const byCampaign = await env.DB.prepare(`
    SELECT COALESCE(signup_utm_campaign, 'none') AS campaign, COUNT(*) AS signups,
      SUM(CASE WHEN subscription_tier IN ('pro','community') THEN 1 ELSE 0 END) AS paid
    FROM users WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY campaign ORDER BY signups DESC LIMIT 20
  `).bind(range.from, range.to).all();
  const byMedium = await env.DB.prepare(`
    SELECT COALESCE(signup_utm_medium, 'none') AS medium, COUNT(*) AS signups
    FROM users WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY medium ORDER BY signups DESC LIMIT 20
  `).bind(range.from, range.to).all();
  const daily = await env.DB.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS signups
    FROM users WHERE date(created_at) BETWEEN ? AND ?
    GROUP BY day ORDER BY day ASC
  `).bind(range.from, range.to).all();
  const recent = await env.DB.prepare(`
    SELECT email, name, subscription_tier, signup_utm_source, signup_utm_medium,
      signup_utm_campaign, signup_referrer, signup_landing_path, created_at
    FROM users WHERE date(created_at) BETWEEN ? AND ?
    ORDER BY created_at DESC LIMIT 25
  `).bind(range.from, range.to).all();

  return new Response(JSON.stringify({
    range,
    totals: {
      total_signups: Number(totals?.total_signups || 0),
      paid_signups: Number(totals?.paid_signups || 0),
      unattributed: Number(totals?.unattributed || 0),
    },
    by_source: bySource.results || [],
    by_campaign: byCampaign.results || [],
    by_medium: byMedium.results || [],
    daily: daily.results || [],
    recent_signups: recent.results || [],
  }), { headers: { 'Content-Type': 'application/json' } });
}

// Simple CSV line parser that handles quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}
