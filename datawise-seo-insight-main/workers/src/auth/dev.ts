import type { Env } from '../index';

const DEV_EMAIL = 'dev@localhost';
const DEV_NAME = 'Dev User';

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// POST /auth/dev-login (development only)
// Mints a session for a local dev admin user so the localhost frontend can skip sign-in.
// Returns 404 in any non-development environment.
async function ensureUserColumns(env: Env): Promise<void> {
  // Local dev D1 may lag behind schema.sql. Add missing columns idempotently.
  const tryAlter = async (sql: string) => {
    try { await env.DB.prepare(sql).run(); } catch { /* already exists */ }
  };
  await tryAlter("ALTER TABLE users ADD COLUMN default_location_code INTEGER DEFAULT 2840");
  await tryAlter("ALTER TABLE users ADD COLUMN default_language_code TEXT DEFAULT 'en'");
  await tryAlter("ALTER TABLE users ADD COLUMN credits_exhausted_email_sent INTEGER DEFAULT 0");
  await tryAlter("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
  await tryAlter("ALTER TABLE users ADD COLUMN is_community_member INTEGER DEFAULT 0");
  await tryAlter("ALTER TABLE users ADD COLUMN credits_used INTEGER DEFAULT 0");
}

export async function handleDevLogin(request: Request, env: Env): Promise<Response> {
  // Belt + braces: require ENVIRONMENT=development AND a local hostname.
  // Both must be true — a misconfigured var alone cannot open this endpoint.
  const hostname = new URL(request.url).hostname;
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  if (env.ENVIRONMENT !== 'development' || !isLocalHost) {
    return new Response('Not found', { status: 404 });
  }

  await ensureUserColumns(env);

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(DEV_EMAIL).first();

  let userId: string;
  if (existing) {
    userId = existing.id as string;
  } else {
    userId = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      `INSERT INTO users (id, google_id, email, name, subscription_tier, is_admin)
       VALUES (?, ?, ?, ?, 'pro', 1)`
    ).bind(userId, `dev-${userId}`, DEV_EMAIL, DEV_NAME).run();
  }

  const sessionToken = generateToken();
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID().replace(/-/g, ''), userId, tokenHash, expiresAt).run();

  await env.KV.put(`session:${tokenHash}`, userId, { expirationTtl: 30 * 24 * 60 * 60 });

  return new Response(JSON.stringify({ token: sessionToken }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
