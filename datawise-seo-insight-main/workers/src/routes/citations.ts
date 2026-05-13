import type { Env } from '../index';
import type { AuthUser } from '../auth/google';

export async function handleListChecklist(env: Env, user: AuthUser): Promise<Response> {
  const result = await env.DB.prepare(
    'SELECT citation_key, completed_at FROM citation_checklist WHERE user_id = ?'
  ).bind(user.id).all();

  return json({ items: result.results ?? [] });
}

export async function handleUpsertChecklist(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const body = await request.json() as { citation_key?: unknown; completed?: unknown };
  const key = typeof body.citation_key === 'string' ? body.citation_key.trim() : '';
  const completed = body.completed === true;

  if (!key || key.length > 128) {
    return json({ error: 'citation_key required (<=128 chars)' }, 400);
  }

  if (completed) {
    await env.DB.prepare(
      `INSERT INTO citation_checklist (user_id, citation_key) VALUES (?, ?)
       ON CONFLICT(user_id, citation_key) DO NOTHING`
    ).bind(user.id, key).run();
  } else {
    await env.DB.prepare(
      'DELETE FROM citation_checklist WHERE user_id = ? AND citation_key = ?'
    ).bind(user.id, key).run();
  }

  return json({ success: true });
}

// GET /api/citations/custom?project_id=...
export async function handleListCustom(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id');
  if (!projectId) return json({ error: 'project_id required' }, 400);

  const result = await env.DB.prepare(
    `SELECT id, name, url, category, created_at
     FROM custom_citations
     WHERE user_id = ? AND project_id = ?
     ORDER BY created_at ASC`
  ).bind(user.id, projectId).all();

  return json({ items: result.results ?? [] });
}

// POST /api/citations/custom
export async function handleCreateCustom(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const projectId = typeof body.project_id === 'string' ? body.project_id : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  let urlRaw = typeof body.url === 'string' ? body.url.trim() : '';
  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim() : null;

  if (!projectId) return json({ error: 'project_id required' }, 400);
  if (!name || name.length > 200) return json({ error: 'name required (<=200 chars)' }, 400);
  if (!urlRaw || urlRaw.length > 500) return json({ error: 'url required (<=500 chars)' }, 400);

  if (!/^https?:\/\//i.test(urlRaw)) urlRaw = 'https://' + urlRaw;
  try {
    new URL(urlRaw);
  } catch {
    return json({ error: 'invalid url' }, 400);
  }

  // Verify the project belongs to this user.
  const project = await env.DB.prepare(
    'SELECT id FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, user.id).first();
  if (!project) return json({ error: 'project not found' }, 404);

  const result = await env.DB.prepare(
    `INSERT INTO custom_citations (user_id, project_id, name, url, category)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, name, url, category, created_at`
  ).bind(user.id, projectId, name, urlRaw, category).first();

  return json({ item: result });
}

// DELETE /api/citations/custom/:id
export async function handleDeleteCustom(env: Env, user: AuthUser, id: string): Promise<Response> {
  await env.DB.prepare(
    'DELETE FROM custom_citations WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).run();
  // Also clear any checklist row for this custom citation.
  await env.DB.prepare(
    'DELETE FROM citation_checklist WHERE user_id = ? AND citation_key = ?'
  ).bind(user.id, `custom-${id}`).run();
  return json({ success: true });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
