import type { Env } from '../index';
import { decryptToken, encryptToken, isEncryptedToken } from '../lib/token-crypto';

const BWT_SCOPE = 'webmaster.read';
const BWT_AUTHORIZE_URL = 'https://www.bing.com/webmasters/oauth/authorize';
const BWT_TOKEN_URL = 'https://www.bing.com/webmasters/oauth/token';
const BWT_API_BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

type BWTConnectionRow = {
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
};

async function storeBWTConnection(
  env: Env,
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: string
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO bwt_connections (id, user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted,
      token_expires_at = excluded.token_expires_at,
      connected_at = datetime('now')
  `).bind(
    crypto.randomUUID().replace(/-/g, ''),
    userId,
    await encryptToken(accessToken, env.ENCRYPTION_KEY),
    await encryptToken(refreshToken, env.ENCRYPTION_KEY),
    expiresAt
  ).run();
}

async function migratePlaintextBWTTokens(
  env: Env,
  userId: string,
  row: BWTConnectionRow,
  accessToken: string,
  refreshToken: string
): Promise<void> {
  const accessNeedsMigration = !!row.access_token_encrypted && !isEncryptedToken(row.access_token_encrypted);
  const refreshNeedsMigration = !!row.refresh_token_encrypted && !isEncryptedToken(row.refresh_token_encrypted);
  if (!accessNeedsMigration && !refreshNeedsMigration) return;

  await env.DB.prepare(
    'UPDATE bwt_connections SET access_token_encrypted = ?, refresh_token_encrypted = ? WHERE user_id = ?'
  ).bind(
    await encryptToken(accessToken, env.ENCRYPTION_KEY),
    await encryptToken(refreshToken, env.ENCRYPTION_KEY),
    userId
  ).run();
}

function normalizeSiteUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '');
}

// POST /bwt/connect
export async function handleBWTConnect(request: Request, env: Env, userId: string): Promise<Response> {
  const redirectUri = `${new URL(request.url).origin}/bwt/callback`;

  const stateToken = crypto.randomUUID().replace(/-/g, '');
  await env.KV.put(`bwt_state:${stateToken}`, userId, { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id: env.BWT_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: BWT_SCOPE,
    state: stateToken,
  });

  return new Response(JSON.stringify({ url: `${BWT_AUTHORIZE_URL}?${params.toString()}` }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /bwt/callback
export async function handleBWTCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error || !code) {
    return Response.redirect(`${env.FRONTEND_URL}/settings?bwt_error=${error || 'no_code'}`, 302);
  }
  if (!state) {
    return Response.redirect(`${env.FRONTEND_URL}/settings?bwt_error=missing_state`, 302);
  }

  const userId = await env.KV.get(`bwt_state:${state}`);
  if (!userId) {
    return Response.redirect(`${env.FRONTEND_URL}/settings?bwt_error=invalid_state`, 302);
  }
  await env.KV.delete(`bwt_state:${state}`);

  const redirectUri = `${url.origin}/bwt/callback`;

  const tokenResponse = await fetch(BWT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.BWT_CLIENT_ID,
      client_secret: env.BWT_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    console.error('BWT token exchange failed:', await tokenResponse.text());
    return Response.redirect(`${env.FRONTEND_URL}/settings?bwt_error=token_failed`, 302);
  }

  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await storeBWTConnection(env, userId, tokens.access_token, tokens.refresh_token, expiresAt);

  await syncBWTProperties(env, userId, tokens.access_token);

  return Response.redirect(`${env.FRONTEND_URL}/settings?bwt_connected=true`, 302);
}

// Refresh BWT access token. Refresh tokens do NOT rotate per Microsoft docs.
export async function refreshBWTToken(env: Env, userId: string): Promise<string | null> {
  const conn = await env.DB.prepare(
    'SELECT access_token_encrypted, refresh_token_encrypted, token_expires_at FROM bwt_connections WHERE user_id = ?'
  ).bind(userId).first<BWTConnectionRow>();

  if (!conn) return null;

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = await decryptToken(conn.access_token_encrypted, env.ENCRYPTION_KEY);
    refreshToken = await decryptToken(conn.refresh_token_encrypted, env.ENCRYPTION_KEY);
  } catch (err) {
    console.error('BWT OAuth token decrypt failed:', err);
    return null;
  }

  if (new Date(conn.token_expires_at as string) > new Date()) {
    await migratePlaintextBWTTokens(env, userId, conn, accessToken, refreshToken);
    return accessToken;
  }

  if (!refreshToken) return null;

  const tokenResponse = await fetch(BWT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.BWT_CLIENT_ID,
      client_secret: env.BWT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    console.error('BWT token refresh failed:', await tokenResponse.text());
    return null;
  }

  const tokens = await tokenResponse.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await env.DB.prepare(
    'UPDATE bwt_connections SET access_token_encrypted = ?, refresh_token_encrypted = ?, token_expires_at = ? WHERE user_id = ?'
  ).bind(
    await encryptToken(tokens.access_token, env.ENCRYPTION_KEY),
    await encryptToken(refreshToken, env.ENCRYPTION_KEY),
    expiresAt,
    userId
  ).run();

  return tokens.access_token;
}

// Fetch user's BWT sites and store as gsc_properties rows with kind='bwt'.
// Auto-pair to existing GSC properties via normalized hostname.
export async function syncBWTProperties(env: Env, userId: string, accessToken: string): Promise<void> {
  const response = await fetch(`${BWT_API_BASE}/GetUserSites?apikey=${accessToken}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.error('BWT GetUserSites failed:', response.status, await response.text());
    return;
  }

  const data = await response.json() as { d?: Array<{ Url: string }> };
  const sites = data.d || [];

  // Load existing properties for this user (both GSC and BWT) to compute auto-pair groups
  const existing = await env.DB.prepare(
    'SELECT id, site_url, kind, site_group_id FROM gsc_properties WHERE user_id = ?'
  ).bind(userId).all();
  const existingRows = (existing.results || []) as Array<{
    id: string;
    site_url: string;
    kind: string;
    site_group_id: string | null;
  }>;

  for (const site of sites) {
    const normalized = normalizeSiteUrl(site.Url);

    // Find a GSC sibling with the same normalized host
    const sibling = existingRows.find(
      (r) => r.kind === 'gsc' && normalizeSiteUrl(r.site_url) === normalized
    );
    const groupId = sibling?.site_group_id ?? sibling?.id ?? crypto.randomUUID().replace(/-/g, '');

    await env.DB.prepare(`
      INSERT INTO gsc_properties (id, user_id, site_url, permission_level, kind, site_group_id)
      VALUES (?, ?, ?, ?, 'bwt', ?)
      ON CONFLICT(user_id, site_url) DO UPDATE SET
        kind = 'bwt',
        site_group_id = COALESCE(gsc_properties.site_group_id, excluded.site_group_id)
    `).bind(
      crypto.randomUUID().replace(/-/g, ''),
      userId,
      site.Url,
      'siteOwner',
      groupId
    ).run();
  }
}

// POST /bwt/properties/refresh
export async function handleBWTPropertiesRefresh(env: Env, userId: string): Promise<Response> {
  const accessToken = await refreshBWTToken(env, userId);
  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'BWT not connected. Reconnect in Settings.' }), { status: 403 });
  }

  await syncBWTProperties(env, userId, accessToken);

  const properties = await env.DB.prepare(
    "SELECT id, site_url, permission_level, last_synced_at, color, is_enabled, kind, site_group_id FROM gsc_properties WHERE user_id = ? AND kind = 'bwt'"
  ).bind(userId).all();

  return new Response(JSON.stringify({
    success: true,
    count: properties.results?.length ?? 0,
    properties: properties.results || [],
  }), { headers: { 'Content-Type': 'application/json' } });
}

// GET /bwt/properties
export async function handleBWTProperties(env: Env, userId: string): Promise<Response> {
  const properties = await env.DB.prepare(
    "SELECT id, site_url, permission_level, last_synced_at, color, is_enabled, kind, site_group_id FROM gsc_properties WHERE user_id = ? AND kind = 'bwt'"
  ).bind(userId).all();

  const connection = await env.DB.prepare(
    'SELECT connected_at FROM bwt_connections WHERE user_id = ?'
  ).bind(userId).first();

  return new Response(JSON.stringify({
    connected: !!connection,
    properties: properties.results || [],
  }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /bwt/disconnect
export async function handleBWTDisconnect(env: Env, userId: string): Promise<Response> {
  await env.DB.prepare('DELETE FROM bwt_connections WHERE user_id = ?').bind(userId).run();
  // Delete BWT properties (and their search data via FK cascade)
  await env.DB.prepare("DELETE FROM gsc_properties WHERE user_id = ? AND kind = 'bwt'").bind(userId).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
