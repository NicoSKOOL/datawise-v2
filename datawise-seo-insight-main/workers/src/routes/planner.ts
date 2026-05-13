import type { Env } from '../index';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const VALID_INTENTS = ['transactional', 'informational', 'commercial', 'navigational', 'fan_out'] as const;
const VALID_STATUSES = ['backlog', 'assigned', 'draft', 'published', 'indexed', 'ranking'] as const;

type Intent = typeof VALID_INTENTS[number];
type Status = typeof VALID_STATUSES[number];

interface PlannerItemInput {
  keyword?: string;
  intent?: Intent;
  status?: Status;
  assigned_url?: string | null;
  notes?: string | null;
  search_volume?: number | null;
  keyword_difficulty?: number | null;
  cpc?: number | null;
  competition?: number | null;
  source?: string | null;
  source_context?: unknown;
}

function serializeContext(ctx: unknown): string | null {
  if (ctx == null) return null;
  if (typeof ctx === 'string') return ctx;
  try {
    return JSON.stringify(ctx);
  } catch {
    return null;
  }
}

// Verify the propertyId belongs to this user. Returns the propertyId on success,
// or a Response with the appropriate error status on failure.
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

// GET /api/planner/keywords?propertyId=...
export async function handleListPlannerKeywords(
  request: Request, env: Env, userId: string
): Promise<Response> {
  const propertyIdParam = new URL(request.url).searchParams.get('propertyId');
  const prop = await requireProperty(env, userId, propertyIdParam);
  if (prop instanceof Response) return prop;

  const { results } = await env.DB.prepare(`
    SELECT id, keyword, intent, status, assigned_url, notes,
           search_volume, keyword_difficulty, cpc, competition,
           source, source_context, content_brief,
           cluster_id, is_pillar,
           position, created_at, updated_at
    FROM planner_keywords
    WHERE user_id = ? AND property_id = ?
    ORDER BY status ASC, position ASC, created_at DESC
  `).bind(userId, prop).all();

  const rows = (results || []).map((r: any) => ({
    ...r,
    source_context: r.source_context ? safeParse(r.source_context) : null,
    content_brief: r.content_brief ? safeParse(r.content_brief) : null,
    is_pillar: r.is_pillar === 1 || r.is_pillar === true,
  }));

  return json(rows);
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

// POST /api/planner/keywords
export async function handleAddPlannerKeyword(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as PlannerItemInput & { property_id?: string };
  const keyword = body.keyword?.trim().toLowerCase();
  if (!keyword) return json({ error: 'Keyword is required' }, 400);

  const prop = await requireProperty(env, userId, body.property_id);
  if (prop instanceof Response) return prop;

  const intent: Intent = VALID_INTENTS.includes(body.intent as Intent) ? body.intent as Intent : 'informational';
  const id = generateId();

  try {
    await env.DB.prepare(`
      INSERT INTO planner_keywords
        (id, user_id, property_id, keyword, intent, search_volume, keyword_difficulty, cpc, competition, source, source_context)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, userId, prop, keyword, intent,
      body.search_volume ?? null,
      body.keyword_difficulty ?? null,
      body.cpc ?? null,
      body.competition ?? null,
      body.source ?? null,
      serializeContext(body.source_context),
    ).run();
  } catch (err: any) {
    if (/UNIQUE/i.test(err?.message || '')) {
      const existing = await env.DB.prepare(
        'SELECT id FROM planner_keywords WHERE user_id = ? AND property_id = ? AND keyword = ?'
      ).bind(userId, prop, keyword).first() as any;
      return json({ id: existing?.id, keyword, duplicate: true }, 200);
    }
    throw err;
  }

  return json({ id, keyword, intent, status: 'backlog', duplicate: false }, 201);
}

// POST /api/planner/keywords/bulk
export async function handleBulkAddPlannerKeywords(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await request.json() as {
    items?: PlannerItemInput[];
    intent?: Intent;
    source?: string;
    source_context?: unknown;
    property_id?: string;
  };
  const items = body.items || [];
  if (!items.length) return json({ error: 'items array is required' }, 400);

  const prop = await requireProperty(env, userId, body.property_id);
  if (prop instanceof Response) return prop;

  const defaultIntent: Intent = VALID_INTENTS.includes(body.intent as Intent) ? body.intent as Intent : 'informational';
  const defaultSource = body.source ?? null;
  const defaultContext = serializeContext(body.source_context);

  // Load existing keywords once (for this property) to compute added/skipped counts accurately
  const { results: existing } = await env.DB.prepare(
    'SELECT keyword FROM planner_keywords WHERE user_id = ? AND property_id = ?'
  ).bind(userId, prop).all();
  const existingSet = new Set((existing || []).map((r: any) => r.keyword));

  const stmts: D1PreparedStatement[] = [];
  let added = 0;
  for (const item of items) {
    const keyword = item.keyword?.trim().toLowerCase();
    if (!keyword || existingSet.has(keyword)) continue;
    existingSet.add(keyword);

    const intent: Intent = VALID_INTENTS.includes(item.intent as Intent)
      ? item.intent as Intent
      : defaultIntent;

    stmts.push(
      env.DB.prepare(`
        INSERT OR IGNORE INTO planner_keywords
          (id, user_id, property_id, keyword, intent, search_volume, keyword_difficulty, cpc, competition, source, source_context)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        generateId(), userId, prop, keyword, intent,
        item.search_volume ?? null,
        item.keyword_difficulty ?? null,
        item.cpc ?? null,
        item.competition ?? null,
        item.source ?? defaultSource,
        serializeContext(item.source_context) ?? defaultContext,
      )
    );
    added++;
  }

  if (stmts.length > 0) {
    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
  }

  return json({ added, skipped: items.length - added });
}

// PATCH /api/planner/keywords/:id
export async function handleUpdatePlannerKeyword(
  request: Request, env: Env, userId: string, keywordId: string
): Promise<Response> {
  const owned = await env.DB.prepare(
    'SELECT id FROM planner_keywords WHERE id = ? AND user_id = ?'
  ).bind(keywordId, userId).first();
  if (!owned) return json({ error: 'Not found' }, 404);

  const body = await request.json() as PlannerItemInput;
  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.intent !== undefined) {
    if (!VALID_INTENTS.includes(body.intent as Intent)) return json({ error: 'Invalid intent' }, 400);
    updates.push('intent = ?'); values.push(body.intent);
  }
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as Status)) return json({ error: 'Invalid status' }, 400);
    updates.push('status = ?'); values.push(body.status);
  }
  if (body.assigned_url !== undefined) { updates.push('assigned_url = ?'); values.push(body.assigned_url || null); }
  if (body.notes !== undefined)        { updates.push('notes = ?');        values.push(body.notes || null); }
  if ((body as any).content_brief !== undefined) {
    const cb = (body as any).content_brief;
    updates.push('content_brief = ?');
    values.push(cb == null ? null : (typeof cb === 'string' ? cb : JSON.stringify(cb)));
  }
  if ((body as any).cluster_id !== undefined) {
    const cid = (body as any).cluster_id;
    if (cid != null) {
      // Cluster must belong to the same user AND the same property as the keyword,
      // so a cluster under site A can't be attached to a keyword under site B.
      const cluster = await env.DB.prepare(`
        SELECT c.id FROM planner_clusters c
        JOIN planner_keywords k ON k.id = ? AND k.user_id = c.user_id
        WHERE c.id = ? AND c.user_id = ? AND c.property_id = k.property_id
      `).bind(keywordId, cid, userId).first();
      if (!cluster) return json({ error: 'Invalid cluster_id' }, 400);
    }
    updates.push('cluster_id = ?'); values.push(cid || null);
    // When leaving a cluster, clear pillar flag
    if (cid == null) { updates.push('is_pillar = 0'); }
  }
  if ((body as any).is_pillar !== undefined) {
    updates.push('is_pillar = ?'); values.push((body as any).is_pillar ? 1 : 0);
  }
  if ((body as any).position !== undefined) {
    updates.push('position = ?'); values.push((body as any).position);
  }

  if (!updates.length) return json({ error: 'No fields to update' }, 400);
  updates.push("updated_at = datetime('now')");

  values.push(keywordId);
  await env.DB.prepare(
    `UPDATE planner_keywords SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return json({ success: true });
}

// DELETE /api/planner/keywords/:id
export async function handleDeletePlannerKeyword(
  env: Env, userId: string, keywordId: string
): Promise<Response> {
  const owned = await env.DB.prepare(
    'SELECT id FROM planner_keywords WHERE id = ? AND user_id = ?'
  ).bind(keywordId, userId).first();
  if (!owned) return json({ error: 'Not found' }, 404);

  await env.DB.prepare('DELETE FROM planner_keywords WHERE id = ?').bind(keywordId).run();
  return json({ success: true });
}
