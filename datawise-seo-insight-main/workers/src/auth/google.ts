import type { Env } from '../index';

interface GoogleTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture: string;
  email_verified: boolean;
}

export interface AuthUser {
  id: string;
  google_id: string;
  email: string;
  name: string;
  avatar_url: string;
  subscription_tier: string;
  is_community_member: boolean;
  credits_used: number;
}

// Generate a random session token
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Hash a token for storage (we store hash, compare hash)
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST /auth/google - Returns the Google OAuth URL for the frontend to redirect to
export async function handleGoogleAuth(request: Request, env: Env): Promise<Response> {
  const redirectUri = `${new URL(request.url).origin}/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Response(JSON.stringify({ url: authUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /auth/google/callback - Exchange code for tokens, create/find user, set session
export async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(`${env.FRONTEND_URL}/auth?error=${error || 'no_code'}`, 302);
  }

  const redirectUri = `${url.origin}/auth/google/callback`;

  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    console.error('Token exchange failed:', errorBody);
    console.error('redirect_uri used:', redirectUri);
    console.error('client_id used:', env.GOOGLE_CLIENT_ID?.substring(0, 20) + '...');
    return Response.redirect(`${env.FRONTEND_URL}/auth?error=token_exchange_failed&detail=${encodeURIComponent(errorBody)}`, 302);
  }

  const tokens: GoogleTokenResponse = await tokenResponse.json();

  // Get user info from Google
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    return Response.redirect(`${env.FRONTEND_URL}/auth?error=userinfo_failed`, 302);
  }

  const googleUser: GoogleUserInfo = await userInfoResponse.json();

  // Upsert user in D1
  // Check by google_id first, then by email (for pre-created/invited users)
  let existingUser = await env.DB.prepare(
    'SELECT * FROM users WHERE google_id = ?'
  ).bind(googleUser.sub).first();

  if (!existingUser) {
    existingUser = await env.DB.prepare(
      'SELECT * FROM users WHERE lower(email) = ?'
    ).bind(googleUser.email.toLowerCase()).first();
  }

  let userId: string;
  const isAdminUser = googleUser.email === 'nico@airankingskool.com';

  if (existingUser) {
    userId = existingUser.id as string;
    // Link Google account and update profile (handles invited users who sign in with Google)
    await env.DB.prepare(
      `UPDATE users SET google_id = ?, email = ?, name = ?, avatar_url = ?, is_admin = ${isAdminUser ? 1 : 0}, updated_at = datetime("now") WHERE id = ?`
    ).bind(googleUser.sub, googleUser.email, googleUser.name, googleUser.picture, userId).run();
  } else {
    userId = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      'INSERT INTO users (id, google_id, email, name, avatar_url, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(userId, googleUser.sub, googleUser.email, googleUser.name, googleUser.picture, isAdminUser ? 1 : 0).run();
  }

  // Auto-detect community member
  const communityMember = await env.DB.prepare(
    'SELECT email FROM community_members WHERE lower(email) = ?'
  ).bind(googleUser.email.toLowerCase()).first();
  if (communityMember) {
    await env.DB.prepare(
      "UPDATE users SET is_community_member = 1, subscription_tier = 'community', updated_at = datetime('now') WHERE id = ?"
    ).bind(userId).run();
  }

  // Create session
  const sessionToken = generateToken();
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID().replace(/-/g, ''), userId, tokenHash, expiresAt).run();

  // Also store in KV for fast lookups (token_hash -> user_id)
  await env.KV.put(`session:${tokenHash}`, userId, { expirationTtl: 30 * 24 * 60 * 60 });

  // Redirect to frontend with session token
  return Response.redirect(`${env.FRONTEND_URL}/auth/callback?token=${sessionToken}`, 302);
}

// POST /auth/logout - Clear session
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    const tokenHash = await hashToken(token);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    await env.KV.delete(`session:${tokenHash}`);
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /auth/me - Return current user
export async function handleMe(user: AuthUser): Promise<Response> {
  return new Response(JSON.stringify({ user }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
