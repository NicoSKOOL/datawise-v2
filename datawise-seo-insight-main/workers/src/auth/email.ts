import type { Env } from '../index';
import { sendPasswordResetEmail } from '../email/resend';

// --- Password hashing with PBKDF2 (Web Crypto API) ---

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, expectedHash] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === expectedHash;
}

// --- Session helpers ---

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(env: Env, userId: string): Promise<string> {
  const sessionToken = generateToken();
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID().replace(/-/g, ''), userId, tokenHash, expiresAt).run();

  await env.KV.put(`session:${tokenHash}`, userId, { expirationTtl: 30 * 24 * 60 * 60 });

  return sessionToken;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// --- Handlers ---

// POST /auth/email/signup
export async function handleEmailSignup(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { email?: string; password?: string; name?: string };
  const { email, password, name } = body;

  if (!email || !password) {
    return json({ error: 'Email and password are required' }, 400);
  }

  if (password.length < 6) {
    return json({ error: 'Password must be at least 6 characters' }, 400);
  }

  // Check if email already exists
  const existing = await env.DB.prepare(
    'SELECT id, password_hash, google_id FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first();

  if (existing) {
    if (existing.google_id && !existing.password_hash) {
      // User signed up with Google before, let them add a password
      const passwordHash = await hashPassword(password);
      await env.DB.prepare(
        'UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(passwordHash, existing.id).run();

      const token = await createSession(env, existing.id as string);
      return json({ token, message: 'Password added to existing account' });
    }
    return json({ error: 'An account with this email already exists' }, 409);
  }

  // Create new user
  const userId = crypto.randomUUID().replace(/-/g, '');
  const passwordHash = await hashPassword(password);
  const isAdmin = email.toLowerCase() === 'nico@airankingskool.com';

  await env.DB.prepare(
    'INSERT INTO users (id, google_id, email, name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, `email:${userId}`, email.toLowerCase(), name || email.split('@')[0], passwordHash, isAdmin ? 1 : 0).run();

  // Auto-detect community member
  const communityMember = await env.DB.prepare(
    'SELECT email FROM community_members WHERE lower(email) = ?'
  ).bind(email.toLowerCase()).first();
  if (communityMember) {
    await env.DB.prepare(
      "UPDATE users SET is_community_member = 1, subscription_tier = 'community', updated_at = datetime('now') WHERE id = ?"
    ).bind(userId).run();
  }

  const token = await createSession(env, userId);
  return json({ token });
}

// POST /auth/email/login
export async function handleEmailLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { email?: string; password?: string };
  const { email, password } = body;

  if (!email || !password) {
    return json({ error: 'Email and password are required' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, password_hash FROM users WHERE lower(email) = ?'
  ).bind(email.toLowerCase()).first();

  if (!user || !user.password_hash) {
    return json({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash as string);
  if (!valid) {
    return json({ error: 'Invalid email or password' }, 401);
  }

  const token = await createSession(env, user.id as string);
  return json({ token });
}

// POST /auth/forgot-password
export async function handleForgotPassword(request: Request, env: Env): Promise<Response> {
  const { email } = await request.json() as { email?: string };
  if (!email) return json({ error: 'Email is required' }, 400);

  // Always return success to avoid leaking whether email exists
  const successResponse = json({ success: true });

  const user = await env.DB.prepare(
    'SELECT id, name FROM users WHERE lower(email) = ?'
  ).bind(email.toLowerCase()).first();

  if (!user) return successResponse;

  // Generate reset token
  const rawToken = generateToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  await env.DB.prepare(
    'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID().replace(/-/g, ''), user.id as string, tokenHash, expiresAt).run();

  // Send email
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;
  await sendPasswordResetEmail(env, email.toLowerCase(), user.name as string | null, resetUrl);

  return successResponse;
}

// POST /auth/reset-password
export async function handleResetPassword(request: Request, env: Env): Promise<Response> {
  const { token: rawToken, password } = await request.json() as { token?: string; password?: string };
  if (!rawToken || !password) return json({ error: 'Token and password are required' }, 400);
  if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

  const tokenHash = await hashToken(rawToken);

  const resetToken = await env.DB.prepare(
    "SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')"
  ).bind(tokenHash).first();

  if (!resetToken) return json({ error: 'Invalid or expired reset link. Please request a new one.' }, 400);

  // Update password
  const passwordHash = await hashPassword(password);
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(passwordHash, resetToken.user_id as string).run();

  // Mark token as used
  await env.DB.prepare(
    'UPDATE password_reset_tokens SET used = 1 WHERE id = ?'
  ).bind(resetToken.id as string).run();

  // Create session so user is logged in immediately
  const sessionToken = await createSession(env, resetToken.user_id as string);
  return json({ token: sessionToken });
}
