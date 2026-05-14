import type { Env } from '../index';

const DEV_EMAIL = 'dev@localhost';
const DEV_NAME = 'Dev User';
const DEFAULT_STAGING_EMAIL = 'staging-admin@datawiseseo.test';
const DEFAULT_STAGING_NAME = 'Staging Admin';

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

async function readStagingLoginToken(request: Request): Promise<string> {
  const body = await request.json().catch(() => ({})) as { token?: unknown };
  return typeof body.token === 'string' ? body.token : '';
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const [aHash, bHash] = await Promise.all([hashToken(a), hashToken(b)]);
  return aHash === bHash;
}

// POST /auth/staging-test-login (staging only)
// Mints a session for a staging admin user so preview builds can be tested
// without Google OAuth. Returns 404 unless ENVIRONMENT=staging and a secret is
// configured, so production cannot expose this by accident.
export async function handleStagingTestLogin(request: Request, env: Env): Promise<Response> {
  const hostname = new URL(request.url).hostname;
  const isProductionWorkerHost = hostname === 'datawise-api.nico-510.workers.dev';
  if (env.ENVIRONMENT !== 'staging' || isProductionWorkerHost || !env.STAGING_LOGIN_SECRET) {
    return new Response('Not found', { status: 404 });
  }

  const suppliedToken = await readStagingLoginToken(request);
  const valid = await timingSafeEqual(suppliedToken, env.STAGING_LOGIN_SECRET);
  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid staging login token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await ensureUserColumns(env);

  const email = (env.STAGING_LOGIN_EMAIL || DEFAULT_STAGING_EMAIL).toLowerCase();
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE lower(email) = ?'
  ).bind(email).first();

  let userId: string;
  if (existing) {
    userId = existing.id as string;
    await env.DB.prepare(
      `UPDATE users
       SET name = ?, subscription_tier = 'pro', is_admin = 1, is_community_member = 1, updated_at = datetime("now")
       WHERE id = ?`
    ).bind(DEFAULT_STAGING_NAME, userId).run();
  } else {
    userId = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      `INSERT INTO users (id, google_id, email, name, avatar_url, subscription_tier, is_admin, is_community_member)
       VALUES (?, ?, ?, ?, '', 'pro', 1, 1)`
    ).bind(userId, `staging-${userId}`, email, DEFAULT_STAGING_NAME).run();
  }

  const sessionToken = generateToken();
  const tokenHash = await hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID().replace(/-/g, ''), userId, tokenHash, expiresAt).run();

  await env.KV.put(`session:${tokenHash}`, userId, { expirationTtl: 24 * 60 * 60 });

  return new Response(JSON.stringify({ token: sessionToken }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
