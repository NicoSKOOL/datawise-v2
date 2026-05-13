import type { Env } from '../index';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function requireProperty(
  env: Env,
  userId: string,
  propertyId: string | null | undefined,
): Promise<string | Response> {
  if (!propertyId) return json({ error: 'propertyId is required' }, 400);
  const owned = await env.DB.prepare(
    'SELECT id FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(propertyId, userId).first();
  if (!owned) return json({ error: 'Property not found' }, 404);
  return propertyId;
}

// GET /api/planner/clusters?propertyId=...
export async function handleListClusters(
  request: Request, env: Env, userId: string
): Promise<Response> {
  const propertyIdParam = new URL(request.url).searchParams.get('propertyId');
  const prop = await requireProperty(env, userId, propertyIdParam);
  if (prop instanceof Response) return prop;

  const { results } = await env.DB.prepare(`
    SELECT c.id, c.name, c.description, c.color, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM planner_keywords k WHERE k.cluster_id = c.id) AS keyword_count
    FROM planner_clusters c
    WHERE c.user_id = ? AND c.property_id = ?
    ORDER BY c.created_at DESC
  `).bind(userId, prop).all();

  return json(results || []);
}

// POST /api/planner/clusters
export async function handleCreateCluster(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as {
    name?: string;
    description?: string;
    color?: string;
    property_id?: string;
  };
  const name = body.name?.trim();
  if (!name) return json({ error: 'Name is required' }, 400);

  const prop = await requireProperty(env, userId, body.property_id);
  if (prop instanceof Response) return prop;

  const id = generateId();
  await env.DB.prepare(`
    INSERT INTO planner_clusters (id, user_id, property_id, name, description, color)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, prop, name,
    body.description?.trim() || null,
    body.color || '#6366f1',
  ).run();

  return json({ id, name, description: body.description || null, color: body.color || '#6366f1', keyword_count: 0 }, 201);
}

// PATCH /api/planner/clusters/:id
export async function handleUpdateCluster(
  request: Request, env: Env, userId: string, clusterId: string
): Promise<Response> {
  const owned = await env.DB.prepare(
    'SELECT id FROM planner_clusters WHERE id = ? AND user_id = ?'
  ).bind(clusterId, userId).first();
  if (!owned) return json({ error: 'Not found' }, 404);

  const body = await request.json() as { name?: string; description?: string | null; color?: string };
  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.name !== undefined) {
    const n = body.name.trim();
    if (!n) return json({ error: 'Name cannot be empty' }, 400);
    updates.push('name = ?'); values.push(n);
  }
  if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description || null); }
  if (body.color !== undefined)       { updates.push('color = ?');       values.push(body.color); }
  if (!updates.length) return json({ error: 'No fields to update' }, 400);
  updates.push("updated_at = datetime('now')");

  values.push(clusterId);
  await env.DB.prepare(
    `UPDATE planner_clusters SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return json({ success: true });
}

// DELETE /api/planner/clusters/:id
export async function handleDeleteCluster(
  env: Env, userId: string, clusterId: string
): Promise<Response> {
  const owned = await env.DB.prepare(
    'SELECT id FROM planner_clusters WHERE id = ? AND user_id = ?'
  ).bind(clusterId, userId).first();
  if (!owned) return json({ error: 'Not found' }, 404);

  // ON DELETE SET NULL on the FK will unassign member keywords automatically.
  await env.DB.prepare('DELETE FROM planner_clusters WHERE id = ?').bind(clusterId).run();
  return json({ success: true });
}

// POST /api/planner/clusters/:id/pillar
export async function handleSetClusterPillar(
  request: Request, env: Env, userId: string, clusterId: string
): Promise<Response> {
  const cluster = await env.DB.prepare(
    'SELECT id FROM planner_clusters WHERE id = ? AND user_id = ?'
  ).bind(clusterId, userId).first();
  if (!cluster) return json({ error: 'Cluster not found' }, 404);

  const body = await request.json() as { keyword_id?: string };
  const keywordId = body.keyword_id;
  if (!keywordId) return json({ error: 'keyword_id is required' }, 400);

  const kw = await env.DB.prepare(
    'SELECT id FROM planner_keywords WHERE id = ? AND user_id = ? AND cluster_id = ?'
  ).bind(keywordId, userId, clusterId).first();
  if (!kw) return json({ error: 'Keyword not in this cluster' }, 404);

  await env.DB.batch([
    env.DB.prepare('UPDATE planner_keywords SET is_pillar = 0 WHERE cluster_id = ? AND user_id = ?')
      .bind(clusterId, userId),
    env.DB.prepare('UPDATE planner_keywords SET is_pillar = 1 WHERE id = ? AND user_id = ?')
      .bind(keywordId, userId),
  ]);

  return json({ success: true });
}
