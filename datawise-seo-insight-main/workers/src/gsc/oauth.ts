import type { Env } from '../index';

const GSC_SCOPES = 'https://www.googleapis.com/auth/webmasters.readonly';

// POST /gsc/connect - Initiate GSC OAuth flow (separate from login)
export async function handleGSCConnect(request: Request, env: Env, userId: string): Promise<Response> {
  const redirectUri = `${new URL(request.url).origin}/gsc/callback`;

  // Store a temporary state token that maps to the user ID
  const stateToken = crypto.randomUUID().replace(/-/g, '');
  await env.KV.put(`gsc_state:${stateToken}`, userId, { expirationTtl: 600 }); // 10 min TTL

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GSC_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: stateToken,
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  return new Response(JSON.stringify({ url: authUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /gsc/callback - Handle GSC OAuth callback, store tokens (PUBLIC route, uses state param)
export async function handleGSCCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error || !code) {
    return Response.redirect(`${env.FRONTEND_URL}/settings?gsc_error=${error || 'no_code'}`, 302);
  }

  // Look up user from state token
  if (!state) {
    return Response.redirect(`${env.FRONTEND_URL}/settings?gsc_error=missing_state`, 302);
  }
  const userId = await env.KV.get(`gsc_state:${state}`);
  if (!userId) {
    return Response.redirect(`${env.FRONTEND_URL}/settings?gsc_error=invalid_state`, 302);
  }
  // Clean up state token
  await env.KV.delete(`gsc_state:${state}`);

  const redirectUri = `${url.origin}/gsc/callback`;

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
    console.error('GSC token exchange failed:', errorBody);
    return Response.redirect(`${env.FRONTEND_URL}/settings?gsc_error=token_failed`, 302);
  }

  const tokens = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Store tokens in D1 (upsert)
  await env.DB.prepare(`
    INSERT INTO gsc_connections (id, user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted,
      token_expires_at = excluded.token_expires_at,
      connected_at = datetime('now')
  `).bind(
    crypto.randomUUID().replace(/-/g, ''),
    userId,
    tokens.access_token, // TODO: encrypt with ENCRYPTION_KEY
    tokens.refresh_token || '',
    expiresAt
  ).run();

  // Fetch and store the user's GSC properties
  await syncProperties(env, userId, tokens.access_token);

  return Response.redirect(`${env.FRONTEND_URL}/settings?gsc_connected=true`, 302);
}

// Refresh GSC access token
export async function refreshGSCToken(env: Env, userId: string): Promise<string | null> {
  const conn = await env.DB.prepare(
    'SELECT access_token_encrypted, refresh_token_encrypted, token_expires_at FROM gsc_connections WHERE user_id = ?'
  ).bind(userId).first();

  if (!conn) return null;

  // Check if token is still valid
  if (new Date(conn.token_expires_at as string) > new Date()) {
    return conn.access_token_encrypted as string;
  }

  // Refresh the token
  const refreshToken = conn.refresh_token_encrypted as string;
  if (!refreshToken) return null;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    console.error('GSC token refresh failed');
    return null;
  }

  const tokens = await tokenResponse.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await env.DB.prepare(
    'UPDATE gsc_connections SET access_token_encrypted = ?, token_expires_at = ? WHERE user_id = ?'
  ).bind(tokens.access_token, expiresAt, userId).run();

  return tokens.access_token;
}

// Fetch user's GSC properties and store in D1
async function syncProperties(env: Env, userId: string, accessToken: string): Promise<void> {
  const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return;

  const data = await response.json() as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
  const sites = data.siteEntry || [];

  for (const site of sites) {
    await env.DB.prepare(`
      INSERT INTO gsc_properties (id, user_id, site_url, permission_level)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, site_url) DO UPDATE SET permission_level = excluded.permission_level
    `).bind(
      crypto.randomUUID().replace(/-/g, ''),
      userId,
      site.siteUrl,
      site.permissionLevel
    ).run();
  }
}

// GET /gsc/properties - List user's connected GSC properties
export async function handleGSCProperties(env: Env, userId: string): Promise<Response> {
  const properties = await env.DB.prepare(
    'SELECT id, site_url, permission_level, last_synced_at, color, is_enabled FROM gsc_properties WHERE user_id = ?'
  ).bind(userId).all();

  const connection = await env.DB.prepare(
    'SELECT connected_at FROM gsc_connections WHERE user_id = ?'
  ).bind(userId).first();

  return new Response(JSON.stringify({
    connected: !!connection,
    properties: properties.results || [],
  }), { headers: { 'Content-Type': 'application/json' } });
}

// PATCH /gsc/properties/:id - Update property color/enabled status
export async function handleGSCPropertyUpdate(request: Request, env: Env, userId: string, propertyId: string): Promise<Response> {
  const body = await request.json() as { color?: string; is_enabled?: boolean };

  // Verify ownership
  const property = await env.DB.prepare(
    'SELECT id FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(propertyId, userId).first();

  if (!property) {
    return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404 });
  }

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.color !== undefined) {
    updates.push('color = ?');
    values.push(body.color);
  }
  if (body.is_enabled !== undefined) {
    updates.push('is_enabled = ?');
    values.push(body.is_enabled ? 1 : 0);
  }

  if (updates.length > 0) {
    values.push(propertyId);
    await env.DB.prepare(
      `UPDATE gsc_properties SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /gsc/disconnect - Remove GSC connection
export async function handleGSCDisconnect(env: Env, userId: string): Promise<Response> {
  const propRows = await env.DB.prepare(
    'SELECT id FROM gsc_properties WHERE user_id = ?'
  ).bind(userId).all();
  const propIds = (propRows.results || []).map((r: Record<string, unknown>) => r.id as string);

  if (propIds.length > 0) {
    await env.DB.prepare(
      `DELETE FROM gsc_search_data WHERE property_id IN (${propIds.map(() => '?').join(',')})`
    ).bind(...propIds).run();

    await env.DB.prepare(
      `UPDATE chat_conversations SET property_id = NULL WHERE property_id IN (${propIds.map(() => '?').join(',')})`
    ).bind(...propIds).run();
  }

  await env.DB.prepare('DELETE FROM gsc_properties WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM gsc_connections WHERE user_id = ?').bind(userId).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// POST /gsc/refresh-properties - Re-fetch properties from Google without full disconnect
export async function handleGSCRefreshProperties(env: Env, userId: string): Promise<Response> {
  const accessToken = await refreshGSCToken(env, userId);
  if (!accessToken) {
    return new Response(JSON.stringify({ error: 'GSC not connected or token expired. Please reconnect.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  await syncProperties(env, userId, accessToken);

  const properties = await env.DB.prepare(
    'SELECT id, site_url, permission_level, last_synced_at, color, is_enabled FROM gsc_properties WHERE user_id = ?'
  ).bind(userId).all();

  return new Response(JSON.stringify({
    success: true,
    properties: properties.results || [],
  }), { headers: { 'Content-Type': 'application/json' } });
}
