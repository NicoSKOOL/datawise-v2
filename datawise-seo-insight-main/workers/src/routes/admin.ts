import type { Env } from '../index';
import type { AuthUser } from '../auth/google';
import { sendInviteEmail } from '../email/resend';

const ADMIN_EMAIL = 'nico@airankingskool.com';

export function isAdmin(user: AuthUser): boolean {
  return user.email === ADMIN_EMAIL;
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

  const lines = csv.split('\n').filter(line => line.trim());
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

  // Clear previous data
  await env.DB.prepare('DELETE FROM community_members').run();

  // Parse rows and batch insert (D1 supports up to ~100 statements per batch)
  const BATCH_SIZE = 80;
  let inserted = 0;
  const statements: D1PreparedStatement[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const email = cols[emailIdx]?.trim().toLowerCase();
    if (!email) continue;

    const firstName = firstNameIdx >= 0 ? cols[firstNameIdx]?.trim() || null : null;
    const lastName = lastNameIdx >= 0 ? cols[lastNameIdx]?.trim() || null : null;
    const tier = tierIdx >= 0 ? cols[tierIdx]?.trim() || null : null;
    const ltv = ltvIdx >= 0 ? parseFloat(cols[ltvIdx]?.trim()) || 0 : 0;
    const joinedDate = joinedIdx >= 0 ? cols[joinedIdx]?.trim() || null : null;

    statements.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO community_members (email, first_name, last_name, tier, ltv, joined_date) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(email, firstName, lastName, tier, ltv, joinedDate)
    );
    inserted++;
  }

  // Execute in batches
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE);
    await env.DB.batch(batch);
  }

  return new Response(JSON.stringify({ success: true, imported: inserted }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/admin/cross-reference
export async function handleCrossReference(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Active members: app users whose email IS in the community CSV
  const activeMembers = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.subscription_tier, u.created_at,
           cm.first_name, cm.last_name, cm.tier as community_tier, cm.ltv, cm.joined_date
    FROM users u
    INNER JOIN community_members cm ON lower(u.email) = lower(cm.email)
  `).all();

  // Non-members: app users whose email is NOT in the community CSV
  const nonMembers = await env.DB.prepare(`
    SELECT u.id, u.email, u.name, u.subscription_tier, u.is_community_member, u.created_at
    FROM users u
    WHERE lower(u.email) NOT IN (SELECT lower(email) FROM community_members)
  `).all();

  // Not registered: CSV members who haven't signed up
  const notRegistered = await env.DB.prepare(`
    SELECT cm.email, cm.first_name, cm.last_name, cm.tier, cm.ltv, cm.joined_date
    FROM community_members cm
    WHERE lower(cm.email) NOT IN (SELECT lower(email) FROM users)
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

  if (action === 'restore') {
    await env.DB.prepare(
      `UPDATE users SET subscription_tier = 'community', is_community_member = 1, updated_at = datetime('now') WHERE id IN (${placeholders})`
    ).bind(...user_ids).run();
  } else {
    await env.DB.prepare(
      `UPDATE users SET subscription_tier = 'free', is_community_member = 0, updated_at = datetime('now') WHERE id IN (${placeholders})`
    ).bind(...user_ids).run();
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

  if (action === 'grant') {
    await env.DB.prepare(
      "UPDATE users SET subscription_tier = 'community', is_community_member = 1, updated_at = datetime('now') WHERE id = ?"
    ).bind(user_id).run();
  } else {
    await env.DB.prepare(
      "UPDATE users SET subscription_tier = 'free', is_community_member = 0, updated_at = datetime('now') WHERE id = ?"
    ).bind(user_id).run();
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

  // Add to community_members table (so auto-detect works)
  await env.DB.prepare(
    'INSERT OR IGNORE INTO community_members (email) VALUES (?)'
  ).bind(cleanEmail).run();

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
