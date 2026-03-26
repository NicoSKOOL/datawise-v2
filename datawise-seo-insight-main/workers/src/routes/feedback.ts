import type { Env } from '../index';
import type { AuthUser } from '../auth/google';
import { isAdmin } from './admin';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB base64 limit

// POST /api/feedback
export async function handleSubmitFeedback(request: Request, env: Env, user: AuthUser): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;
  const { type, title, description, severity, page_url, browser_info, screenshot_info, screenshot_data, screenshot_name } = body;

  // Validate required fields
  if (!type || !['bug', 'feature'].includes(type as string)) {
    return json({ error: 'type must be "bug" or "feature"' }, 400);
  }
  if (!title || typeof title !== 'string' || title.length < 3 || title.length > 200) {
    return json({ error: 'title must be 3-200 characters' }, 400);
  }
  if (!description || typeof description !== 'string' || description.length < 10 || description.length > 5000) {
    return json({ error: 'description must be 10-5000 characters' }, 400);
  }
  const validSeverities = ['low', 'medium', 'high', 'critical'];
  const sev = severity && validSeverities.includes(severity as string) ? severity : 'medium';

  const result = await env.DB.prepare(
    `INSERT INTO feedback_reports (user_id, type, title, description, page_url, browser_info, screenshot_info, severity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  ).bind(
    user.id,
    type,
    title,
    description,
    page_url || null,
    browser_info || null,
    screenshot_info || null,
    sev,
  ).first();

  const reportId = result?.id as string;

  // Store screenshot in KV if provided
  if (screenshot_data && typeof screenshot_data === 'string' && screenshot_data.length > 0) {
    if (screenshot_data.length > MAX_SCREENSHOT_BYTES) {
      return json({ error: 'Screenshot too large (max 5MB)' }, 400);
    }
    // screenshot_data is a data URL like "data:image/png;base64,..."
    await env.KV.put(`feedback-screenshot:${reportId}`, screenshot_data, {
      metadata: { name: screenshot_name || 'screenshot', uploaded_at: new Date().toISOString() },
    });
    // Mark that this report has a screenshot
    await env.DB.prepare(
      'UPDATE feedback_reports SET screenshot_info = ? WHERE id = ?'
    ).bind(`__has_screenshot__${screenshot_name || 'screenshot'}`, reportId).run();
  }

  return json({ success: true, id: reportId });
}

// GET /api/feedback/screenshot/:id
export async function handleGetScreenshot(env: Env, reportId: string): Promise<Response> {
  const data = await env.KV.get(`feedback-screenshot:${reportId}`);
  if (!data) {
    return json({ error: 'Screenshot not found' }, 404);
  }

  // data is a data URL: "data:image/png;base64,iVBOR..."
  const match = data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) {
    // Return raw data as fallback
    return new Response(data, { headers: { 'Content-Type': 'text/plain' } });
  }

  const contentType = match[1];
  const base64 = match[2];
  const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  return new Response(binary, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

// GET /api/feedback
export async function handleListMyFeedback(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, type, title, description, severity, status, admin_notes, page_url, screenshot_info, created_at, updated_at
     FROM feedback_reports WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(userId).all();

  return json({ reports: results });
}

// GET /api/admin/feedback
export async function handleListAllFeedback(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const typeFilter = url.searchParams.get('type');

  let query = `SELECT f.id, f.type, f.title, f.description, f.severity, f.status, f.admin_notes,
    f.page_url, f.browser_info, f.screenshot_info, f.created_at, f.updated_at,
    u.email as user_email, u.name as user_name
    FROM feedback_reports f JOIN users u ON f.user_id = u.id`;

  const conditions: string[] = [];
  const bindings: string[] = [];

  if (statusFilter && ['new', 'in_progress', 'resolved', 'closed'].includes(statusFilter)) {
    conditions.push('f.status = ?');
    bindings.push(statusFilter);
  }
  if (typeFilter && ['bug', 'feature'].includes(typeFilter)) {
    conditions.push('f.type = ?');
    bindings.push(typeFilter);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY f.created_at DESC';

  const stmt = env.DB.prepare(query);
  const bound = bindings.length > 0 ? stmt.bind(...bindings) : stmt;
  const { results } = await bound.all();

  return json({ reports: results });
}

// PATCH /api/admin/feedback/:id
export async function handleUpdateFeedback(request: Request, env: Env, user: AuthUser, reportId: string): Promise<Response> {
  if (!isAdmin(user)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const body = await request.json() as Record<string, unknown>;
  const updates: string[] = [];
  const bindings: unknown[] = [];

  if (body.status && ['new', 'in_progress', 'resolved', 'closed'].includes(body.status as string)) {
    updates.push('status = ?');
    bindings.push(body.status);
  }
  if (body.admin_notes !== undefined) {
    updates.push('admin_notes = ?');
    bindings.push(body.admin_notes);
  }

  if (updates.length === 0) {
    return json({ error: 'Nothing to update' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  bindings.push(reportId);

  await env.DB.prepare(
    `UPDATE feedback_reports SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...bindings).run();

  return json({ success: true });
}

// DELETE /api/admin/feedback/:id
export async function handleDeleteFeedback(env: Env, user: AuthUser, reportId: string): Promise<Response> {
  if (!isAdmin(user)) {
    return json({ error: 'Forbidden' }, 403);
  }

  await env.DB.prepare('DELETE FROM feedback_reports WHERE id = ?').bind(reportId).run();
  // Clean up screenshot from KV
  await env.KV.delete(`feedback-screenshot:${reportId}`);
  return json({ success: true });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
