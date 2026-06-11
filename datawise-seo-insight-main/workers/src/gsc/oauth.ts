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

  // Google omits refresh_token on re-auth when the user has previously
  // consented and the prior grant is still active. Storing an empty string
  // here orphans the connection: the access token expires in ~1 hour, then
  // refreshGSCToken() sees a falsy refresh_token and returns null forever
  // (this stranded john@captivatewebsites, bug f83f0ecd). Force the user
  // back through the consent screen with a clear error instead.
  if (!tokens.refresh_token) {
    console.error('GSC callback: Google returned no refresh_token for user', userId);
    return Response.redirect(`${env.FRONTEND_URL}/settings?gsc_error=no_refresh_token`, 302);
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Store tokens in D1 (upsert). Clear any previous refresh_failed_at flag
  // since a successful re-auth resets the "needs reconnect" state.
  await env.DB.prepare(`
    INSERT INTO gsc_connections (id, user_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, refresh_failed_at)
    VALUES (?, ?, ?, ?, ?, NULL)
    ON CONFLICT(user_id) DO UPDATE SET
      access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted,
      token_expires_at = excluded.token_expires_at,
      refresh_failed_at = NULL,
      connected_at = datetime('now')
  `).bind(
    crypto.randomUUID().replace(/-/g, ''),
    userId,
    tokens.access_token, // TODO: encrypt with ENCRYPTION_KEY
    tokens.refresh_token,
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
  if (!refreshToken) {
    await markRefreshFailed(env, userId);
    return null;
  }

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
    const body = await tokenResponse.text().catch(() => '');
    console.error('GSC token refresh failed for user', userId, tokenResponse.status, body.slice(0, 200));
    await markRefreshFailed(env, userId);
    return null;
  }

  const tokens = await tokenResponse.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Successful refresh clears any prior failure flag.
  await env.DB.prepare(
    'UPDATE gsc_connections SET access_token_encrypted = ?, token_expires_at = ?, refresh_failed_at = NULL WHERE user_id = ?'
  ).bind(tokens.access_token, expiresAt, userId).run();

  return tokens.access_token;
}

// Stamp refresh_failed_at so the SPA can show a persistent "Reconnect Google"
// banner instead of silently returning empty syncs. Best-effort: a failed
// write here must not throw, because the caller already returned null and
// the user-facing UX path doesn't change either way.
async function markRefreshFailed(env: Env, userId: string): Promise<void> {
  try {
    await env.DB.prepare(
      "UPDATE gsc_connections SET refresh_failed_at = COALESCE(refresh_failed_at, datetime('now')) WHERE user_id = ?"
    ).bind(userId).run();
  } catch (err) {
    console.error('markRefreshFailed write failed for user', userId, err);
  }
}

// Fetch user's GSC properties and store in D1
async function syncProperties(env: Env, userId: string, accessToken: string): Promise<number> {
  const response = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return 0;

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
  return sites.length;
}

// GET /gsc/properties - List user's connected GSC properties.
//
// Returns three boolean states the SPA cares about:
//  - connected: there is a gsc_connections row at all
//  - needs_reconnect: a refresh-token failure was recorded since the last
//    successful refresh (set by refreshGSCToken on failure, cleared on
//    success or fresh OAuth)
//  - has_orphan_properties: gsc_properties rows exist for a kind != 'manual'
//    even though there is no connection row (john's f83f0ecd state). The SPA
//    surfaces this as "Google connection lost — Reconnect" with a one-click
//    cleanup option.
export async function handleGSCProperties(env: Env, userId: string): Promise<Response> {
  const properties = await env.DB.prepare(
    'SELECT id, site_url, kind, permission_level, last_synced_at, color, is_enabled FROM gsc_properties WHERE user_id = ?'
  ).bind(userId).all();

  const connection = await env.DB.prepare(
    'SELECT connected_at, refresh_failed_at FROM gsc_connections WHERE user_id = ?'
  ).bind(userId).first();

  const propertyRows = properties.results || [];
  const hasOrphanProperties = !connection && propertyRows.some(p => p.kind !== 'manual');

  return new Response(JSON.stringify({
    connected: !!connection,
    needs_reconnect: !!(connection?.refresh_failed_at) || hasOrphanProperties,
    has_orphan_properties: hasOrphanProperties,
    properties: propertyRows,
  }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /gsc/properties/refresh - Refresh the property list from Google
export async function handleGSCPropertiesRefresh(env: Env, userId: string): Promise<Response> {
  const accessToken = await refreshGSCToken(env, userId);
  if (!accessToken) {
    return new Response(JSON.stringify({
      error: 'GSC not connected or token expired. Please reconnect.',
      code: 'gsc_reauth_required',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const count = await syncProperties(env, userId, accessToken);
  const properties = await env.DB.prepare(
    'SELECT id, site_url, kind, permission_level, last_synced_at, color, is_enabled FROM gsc_properties WHERE user_id = ?'
  ).bind(userId).all();
  return new Response(JSON.stringify({ success: true, count, properties: properties.results || [] }), {
    headers: { 'Content-Type': 'application/json' },
  });
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

// POST /gsc/disconnect - Remove GSC connection.
//
// Idempotent on purpose: must succeed whether the user has a healthy
// connection, an orphan state (properties but no connection row, e.g. john's
// f83f0ecd state), or nothing at all.
//
// gsc_search_data is deleted in chunks first: D1 caps a single SQL statement
// at 30 seconds and a one-shot DELETE of hundreds of thousands of rows blows
// that cap (bug ae38480a, tony: 83 properties / 882k rows -> "Disconnect
// failed"). The chunk loop is safe to interrupt and retry: rows only ever
// shrink and the connection/property rows are untouched until the final
// atomic batch, so partial-state orphaning (f83f0ecd) still cannot recur.
export const GSC_DISCONNECT_CHUNK = 10000;

export async function handleGSCDisconnect(env: Env, userId: string): Promise<Response> {
  try {
    // 1000-subrequest worker cap minus headroom; at 10k rows per chunk this
    // covers ~9M rows, ~10x the largest account seen.
    const maxChunks = 900;
    for (let i = 0; i < maxChunks; i++) {
      const res = await env.DB.prepare(
        `DELETE FROM gsc_search_data
         WHERE id IN (
           SELECT d.id FROM gsc_search_data d
           JOIN gsc_properties p ON p.id = d.property_id
           WHERE p.user_id = ? AND p.kind != 'manual'
           LIMIT ?
         )`
      ).bind(userId, GSC_DISCONNECT_CHUNK).run();
      if ((res.meta?.changes ?? 0) < GSC_DISCONNECT_CHUNK) break;
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM gsc_connections WHERE user_id = ?').bind(userId),
      env.DB.prepare("DELETE FROM gsc_properties WHERE user_id = ? AND kind != 'manual'").bind(userId),
    ]);
  } catch (err) {
    console.error('handleGSCDisconnect batch failed for user', userId, err);
    return new Response(
      JSON.stringify({ error: 'Disconnect failed. Please try again, or contact support.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
