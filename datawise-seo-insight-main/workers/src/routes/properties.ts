import type { Env } from '../index';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname || !/[a-z0-9]/i.test(u.hostname)) return null;
    // Store as origin (https://example.com), no path/query/fragment.
    return `${u.protocol}//${u.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

// POST /api/properties/manual
// Body: { site_url: string, color?: string }
export async function handleCreateManualProperty(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    site_url?: unknown;
    color?: unknown;
  };

  if (typeof body.site_url !== 'string') {
    return json({ error: 'site_url is required' }, 400);
  }
  const normalized = normalizeDomain(body.site_url);
  if (!normalized) {
    return json({ error: 'Invalid domain' }, 400);
  }

  // Reject if a property with this URL already exists for this user (could be GSC or manual).
  const existing = await env.DB.prepare(
    'SELECT id, kind FROM gsc_properties WHERE user_id = ? AND site_url = ?'
  ).bind(userId, normalized).first<{ id: string; kind: string }>();
  if (existing) {
    return json(
      {
        error: existing.kind === 'gsc' ? 'already_connected_via_gsc' : 'already_added',
        property_id: existing.id,
      },
      409,
    );
  }

  const color = typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color)
    ? body.color
    : pickColor(normalized);

  const result = await env.DB.prepare(
    `INSERT INTO gsc_properties (user_id, site_url, kind, color, is_enabled, permission_level)
     VALUES (?, ?, 'manual', ?, 1, 'manual')
     RETURNING id, site_url, permission_level, last_synced_at, color, is_enabled, kind`
  ).bind(userId, normalized, color).first();

  if (!result) {
    return json({ error: 'Failed to create property' }, 500);
  }

  return json({ property: result });
}

// DELETE /api/properties/manual/:id
// Only allows deleting properties owned by the user with kind='manual'.
// GSC properties must be removed via the existing /gsc/disconnect flow.
export async function handleDeleteManualProperty(
  env: Env,
  userId: string,
  propertyId: string,
): Promise<Response> {
  const property = await env.DB.prepare(
    'SELECT id, kind FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(propertyId, userId).first<{ id: string; kind: string }>();

  if (!property) {
    return json({ error: 'not_found' }, 404);
  }
  if (property.kind !== 'manual') {
    return json(
      { error: 'cannot_delete_gsc_property', hint: 'Use Settings → Disconnect GSC to remove a Search Console property.' },
      400,
    );
  }

  // Detach loose references that don't cascade automatically.
  await env.DB.prepare(
    'UPDATE chat_conversations SET property_id = NULL WHERE property_id = ?'
  ).bind(propertyId).run();
  // No user_id column on audit_action_items — ownership is implicit via the
  // property_id we already verified is owned by this user above.
  await env.DB.prepare(
    'DELETE FROM audit_action_items WHERE property_id = ?'
  ).bind(propertyId).run();

  // Cascades clean planner_keywords, planner_clusters, gsc_search_data.
  await env.DB.prepare(
    "DELETE FROM gsc_properties WHERE id = ? AND user_id = ? AND kind = 'manual'"
  ).bind(propertyId, userId).run();

  return json({ success: true });
}
