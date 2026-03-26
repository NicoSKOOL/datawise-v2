import type { Env } from '../index';
import { dataforseoRequest } from '../dataforseo/client';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function cleanDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .trim()
    .toLowerCase();
}

function domainsMatch(candidate: string, target: string): boolean {
  // Strip sc-domain: prefix (GSC property format)
  const c = candidate.replace(/^sc-domain:/, '');
  const t = target.replace(/^sc-domain:/, '');
  // Strip paths - compare hostnames only
  const cHost = c.split('/')[0];
  const tHost = t.split('/')[0];
  return (
    cHost === tHost ||
    cHost.endsWith(`.${tHost}`) ||
    tHost.endsWith(`.${cHost}`)
  );
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function findTrackedDomainPosition(items: any[], targetDomain: string) {
  for (const item of items || []) {
    if (item.type !== 'organic' || !item.url) continue;

    const itemDomain = extractDomain(item.url);
    if (!itemDomain || !domainsMatch(itemDomain, targetDomain)) continue;

    const position = item.rank_absolute ?? item.rank_group ?? null;
    return {
      position,
      rank_group: item.rank_group ?? position,
    };
  }

  return null;
}

// GET /api/rank-tracking/projects
export async function handleListProjects(env: Env, userId: string): Promise<Response> {
  const { results } = await env.DB.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM tracked_keywords WHERE project_id = p.id AND is_active = 1) as keyword_count
    FROM seo_projects p
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).bind(userId).all();

  return json(results);
}

// POST /api/rank-tracking/projects
export async function handleCreateProject(request: Request, env: Env, userId: string): Promise<Response> {
  const { name, domain, location_code } = await request.json() as any;
  if (!name?.trim() || !domain?.trim()) {
    return json({ error: 'Name and domain are required' }, 400);
  }

  const id = generateId();
  const cleanedDomain = cleanDomain(domain);
  const locCode = location_code || 2840;

  await env.DB.prepare(
    'INSERT INTO seo_projects (id, user_id, name, domain, location_code) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, userId, name.trim(), cleanedDomain, locCode).run();

  return json({ id, name: name.trim(), domain: cleanedDomain, location_code: locCode, keyword_count: 0 }, 201);
}

// DELETE /api/rank-tracking/projects/:id
export async function handleDeleteProject(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first();

  if (!project) return json({ error: 'Project not found' }, 404);

  await env.DB.prepare('DELETE FROM seo_projects WHERE id = ?').bind(projectId).run();
  return json({ success: true });
}

// GET /api/rank-tracking/projects/:id/keywords
export async function handleListKeywords(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first();

  if (!project) return json({ error: 'Project not found' }, 404);

  const { results } = await env.DB.prepare(`
    SELECT tk.*,
      rh.position, rh.rank_group, rh.estimated_traffic, rh.checked_at,
      prev.position as prev_position
    FROM tracked_keywords tk
    LEFT JOIN rank_history rh ON rh.keyword_id = tk.id
      AND rh.checked_at = (SELECT MAX(checked_at) FROM rank_history WHERE keyword_id = tk.id)
    LEFT JOIN rank_history prev ON prev.keyword_id = tk.id
      AND prev.checked_at = (SELECT MAX(checked_at) FROM rank_history WHERE keyword_id = tk.id AND checked_at < rh.checked_at)
    WHERE tk.project_id = ? AND tk.is_active = 1
    ORDER BY CASE WHEN rh.position IS NULL THEN 1 ELSE 0 END, rh.position ASC
  `).bind(projectId).all();

  return json(results);
}

// POST /api/rank-tracking/projects/:id/keywords
export async function handleAddKeywords(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first();

  if (!project) return json({ error: 'Project not found' }, 404);

  const { keywords, location_code = 2840, language_code = 'en', initial_positions } = await request.json() as any;
  if (!keywords?.length) return json({ error: 'Keywords array is required' }, 400);

  // Get existing keywords to skip duplicates
  const { results: existing } = await env.DB.prepare(
    'SELECT keyword FROM tracked_keywords WHERE project_id = ? AND is_active = 1'
  ).bind(projectId).all();
  const existingSet = new Set((existing || []).map((r: any) => r.keyword.toLowerCase()));

  let added = 0;
  const stmts: D1PreparedStatement[] = [];
  const checkedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  for (const kw of keywords) {
    const cleaned = kw.trim().toLowerCase();
    if (!cleaned || existingSet.has(cleaned)) continue;
    existingSet.add(cleaned);
    const keywordId = generateId();
    stmts.push(
      env.DB.prepare(
        'INSERT INTO tracked_keywords (id, project_id, keyword, location_code, language_code) VALUES (?, ?, ?, ?, ?)'
      ).bind(keywordId, projectId, cleaned, location_code, language_code)
    );

    // Seed rank_history with GSC position if provided
    const pos = initial_positions?.[kw] ?? initial_positions?.[cleaned];
    if (pos != null) {
      stmts.push(
        env.DB.prepare(
          'INSERT INTO rank_history (keyword_id, position, rank_group, estimated_traffic, checked_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(keywordId, Math.round(pos), Math.round(pos), null, checkedAt)
      );
    }

    added++;
  }

  if (stmts.length > 0) {
    // D1 batch limit, process in chunks of 50
    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
  }

  return json({ added, skipped: keywords.length - added });
}

// DELETE /api/rank-tracking/keywords/:id
export async function handleDeleteKeyword(env: Env, userId: string, keywordId: string): Promise<Response> {
  const keyword = await env.DB.prepare(`
    SELECT tk.id FROM tracked_keywords tk
    JOIN seo_projects p ON p.id = tk.project_id
    WHERE tk.id = ? AND p.user_id = ?
  `).bind(keywordId, userId).first();

  if (!keyword) return json({ error: 'Keyword not found' }, 404);

  await env.DB.prepare('DELETE FROM tracked_keywords WHERE id = ?').bind(keywordId).run();
  return json({ success: true });
}

// POST /api/rank-tracking/projects/:id/check
export async function handleCheckRankings(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id, domain, location_code FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first() as any;

  if (!project) return json({ error: 'Project not found' }, 404);

  const { results: keywords } = await env.DB.prepare(
    'SELECT id, keyword, location_code, language_code FROM tracked_keywords WHERE project_id = ? AND is_active = 1'
  ).bind(projectId).all() as { results: any[] };

  if (!keywords.length) return json({ error: 'No keywords to check' }, 400);

  // Group keywords by location+language to minimize API calls
  // Use project's location_code as fallback instead of hardcoded US (2840)
  const projectLocCode = project.location_code || 2840;
  const groups = new Map<string, { location_code: number; language_code: string; keywords: any[] }>();
  for (const kw of keywords) {
    const locCode = kw.location_code || projectLocCode;
    const key = `${locCode}_${kw.language_code || 'en'}`;
    if (!groups.has(key)) {
      groups.set(key, { location_code: locCode, language_code: kw.language_code || 'en', keywords: [] });
    }
    groups.get(key)!.keywords.push(kw);
  }

  const stmts: D1PreparedStatement[] = [];
  const checkedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  let found = 0;
  let notRanking = 0;

  for (const [, group] of groups) {
    const chunkSize = 50;

    for (let i = 0; i < group.keywords.length; i += chunkSize) {
      const keywordChunk = group.keywords.slice(i, i + chunkSize);
      const payload = keywordChunk.map((kw) => ({
        keyword: kw.keyword,
        location_code: group.location_code,
        language_code: group.language_code,
        device: 'desktop',
        os: 'windows',
        depth: 100,
      }));

      const data = await dataforseoRequest(env, '/serp/google/organic/live/regular', payload);
      const tasks = data?.tasks || [];

      for (let taskIndex = 0; taskIndex < keywordChunk.length; taskIndex++) {
        const kw = keywordChunk[taskIndex];
        const task = tasks[taskIndex];
        const items = task?.result?.[0]?.items || [];
        const match = findTrackedDomainPosition(items, project.domain);

        if (match?.position != null) {
          found++;
          stmts.push(
            env.DB.prepare(
              'INSERT INTO rank_history (keyword_id, position, rank_group, estimated_traffic, checked_at) VALUES (?, ?, ?, ?, ?)'
            ).bind(kw.id, match.position, match.rank_group, null, checkedAt)
          );
        } else {
          // Don't overwrite existing positions with NULL.
          // If SERP check can't find the domain (common for niche/long-tail terms
          // that GSC confirms are ranking), preserve the last known position.
          notRanking++;
        }
      }
    }
  }

  if (stmts.length > 0) {
    // D1 batch has a limit, process in chunks of 50
    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
  }

  return json({ checked: keywords.length, found, not_ranking: notRanking });
}

// GET /api/rank-tracking/projects/:id/report?period=30
export async function handleProjectReport(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first();

  if (!project) return json({ error: 'Project not found' }, 404);

  const url = new URL(request.url);
  const period = Math.min(Math.max(parseInt(url.searchParams.get('period') || '30', 10), 1), 365);

  // Get all rank history for this project within the period
  const { results: historyRows } = await env.DB.prepare(`
    SELECT rh.keyword_id, rh.position, rh.rank_group, rh.estimated_traffic, rh.checked_at
    FROM rank_history rh
    JOIN tracked_keywords tk ON tk.id = rh.keyword_id
    WHERE tk.project_id = ? AND tk.is_active = 1
      AND rh.checked_at >= datetime('now', '-' || ? || ' days')
    ORDER BY rh.checked_at ASC
  `).bind(projectId, period).all();

  // Get previous period data for comparison
  const { results: prevRows } = await env.DB.prepare(`
    SELECT rh.keyword_id, rh.position, rh.rank_group, rh.estimated_traffic, rh.checked_at
    FROM rank_history rh
    JOIN tracked_keywords tk ON tk.id = rh.keyword_id
    WHERE tk.project_id = ? AND tk.is_active = 1
      AND rh.checked_at >= datetime('now', '-' || ? || ' days')
      AND rh.checked_at < datetime('now', '-' || ? || ' days')
    ORDER BY rh.checked_at ASC
  `).bind(projectId, period * 2, period).all();

  // Get total active keywords
  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM tracked_keywords WHERE project_id = ? AND is_active = 1'
  ).bind(projectId).first() as any;
  const totalKeywords = countRow?.cnt || 0;

  // Helper to compute a snapshot from rows (uses latest position per keyword)
  function computeSnapshot(rows: any[], total: number) {
    const latestByKeyword = new Map<string, any>();
    for (const row of rows) {
      const existing = latestByKeyword.get(row.keyword_id);
      if (!existing || row.checked_at > existing.checked_at) {
        latestByKeyword.set(row.keyword_id, row);
      }
    }

    const positions: (number | null)[] = [];
    let traffic = 0;
    const dist = { top3: 0, top10: 0, top20: 0, top50: 0, above50: 0, not_ranking: 0 };

    for (const [, row] of latestByKeyword) {
      const pos = row.position;
      positions.push(pos);
      traffic += row.estimated_traffic || 0;

      if (pos == null) { dist.not_ranking++; }
      else if (pos <= 3) { dist.top3++; }
      else if (pos <= 10) { dist.top10++; }
      else if (pos <= 20) { dist.top20++; }
      else if (pos <= 50) { dist.top50++; }
      else { dist.above50++; }
    }

    const ranked = positions.filter(p => p != null) as number[];
    const avgPos = ranked.length ? Math.round((ranked.reduce((s, p) => s + p, 0) / ranked.length) * 10) / 10 : null;

    return {
      total_keywords: total,
      ranking_keywords: ranked.length,
      avg_position: avgPos,
      estimated_traffic: Math.round(traffic),
      distribution: dist,
      improved: 0,
      declined: 0,
      stable: 0,
    };
  }

  const current = computeSnapshot(historyRows as any[], totalKeywords);
  const previous = computeSnapshot(prevRows as any[], totalKeywords);

  // Compute improved/declined/stable by comparing latest vs second-latest position per keyword
  const byKeyword = new Map<string, any[]>();
  for (const row of historyRows as any[]) {
    if (!byKeyword.has(row.keyword_id)) byKeyword.set(row.keyword_id, []);
    byKeyword.get(row.keyword_id)!.push(row);
  }

  let improved = 0, declined = 0, stable = 0;
  for (const [, rows] of byKeyword) {
    rows.sort((a: any, b: any) => a.checked_at < b.checked_at ? -1 : 1);
    if (rows.length < 2) { stable++; continue; }
    const latest = rows[rows.length - 1].position;
    const prev = rows[rows.length - 2].position;
    if (latest == null || prev == null) { stable++; }
    else if (latest < prev) { improved++; }
    else if (latest > prev) { declined++; }
    else { stable++; }
  }
  current.improved = improved;
  current.declined = declined;
  current.stable = stable;

  // Build trend data: group by date
  const trendMap = new Map<string, any[]>();
  for (const row of historyRows as any[]) {
    const date = (row.checked_at as string).split(' ')[0];
    if (!trendMap.has(date)) trendMap.set(date, []);
    trendMap.get(date)!.push(row);
  }

  const trend = Array.from(trendMap.entries()).map(([date, rows]) => {
    const positions = rows.filter((r: any) => r.position != null).map((r: any) => r.position as number);
    const avgP = positions.length ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10 : null;
    let t3 = 0, t10 = 0, t20 = 0, t50 = 0, a50 = 0;
    for (const p of positions) {
      if (p <= 3) t3++;
      else if (p <= 10) t10++;
      else if (p <= 20) t20++;
      else if (p <= 50) t50++;
      else a50++;
    }
    return { date, avg_position: avgP, top3: t3, top10: t10, top20: t20, top50: t50, above50: a50 };
  }).sort((a, b) => a.date < b.date ? -1 : 1);

  return json({ current, previous, trend });
}

// GET /api/rank-tracking/dashboard-summary
export async function handleDashboardSummary(env: Env, userId: string): Promise<Response> {
  // Check if user has any projects
  const { results: projects } = await env.DB.prepare(
    'SELECT id, name FROM seo_projects WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  if (!projects || projects.length === 0) {
    return json({
      has_projects: false,
      total_keywords: 0,
      avg_position: null,
      distribution: { top3: 0, top10: 0, top20: 0, top50: 0, above50: 0, not_ranking: 0 },
      top_movers: [],
      top_decliners: [],
    });
  }

  const projectIds = (projects as any[]).map(p => p.id);
  const projectNameMap = new Map((projects as any[]).map(p => [p.id, p.name]));

  // Get latest position per keyword across all projects
  const placeholders = projectIds.map(() => '?').join(',');
  const { results: latestRows } = await env.DB.prepare(`
    SELECT tk.id as keyword_id, tk.keyword, tk.project_id,
      rh.position, rh.estimated_traffic, rh.checked_at
    FROM tracked_keywords tk
    LEFT JOIN rank_history rh ON rh.keyword_id = tk.id
      AND rh.checked_at = (SELECT MAX(checked_at) FROM rank_history WHERE keyword_id = tk.id)
    WHERE tk.project_id IN (${placeholders}) AND tk.is_active = 1
  `).bind(...projectIds).all();

  // Get previous positions for movers
  const { results: prevRows } = await env.DB.prepare(`
    SELECT tk.id as keyword_id, tk.keyword, tk.project_id,
      prev.position as prev_position
    FROM tracked_keywords tk
    LEFT JOIN rank_history rh ON rh.keyword_id = tk.id
      AND rh.checked_at = (SELECT MAX(checked_at) FROM rank_history WHERE keyword_id = tk.id)
    LEFT JOIN rank_history prev ON prev.keyword_id = tk.id
      AND prev.checked_at = (SELECT MAX(checked_at) FROM rank_history WHERE keyword_id = tk.id AND checked_at < rh.checked_at)
    WHERE tk.project_id IN (${placeholders}) AND tk.is_active = 1
  `).bind(...projectIds).all();

  const prevMap = new Map((prevRows as any[]).map(r => [r.keyword_id, r.prev_position]));

  // Compute distribution
  const dist = { top3: 0, top10: 0, top20: 0, top50: 0, above50: 0, not_ranking: 0 };
  const positions: number[] = [];
  const movers: Array<{ keyword: string; project_name: string; old_position: number | null; new_position: number | null; change: number }> = [];

  for (const row of latestRows as any[]) {
    const pos = row.position;
    if (pos == null) { dist.not_ranking++; }
    else {
      positions.push(pos);
      if (pos <= 3) dist.top3++;
      else if (pos <= 10) dist.top10++;
      else if (pos <= 20) dist.top20++;
      else if (pos <= 50) dist.top50++;
      else dist.above50++;
    }

    const prevPos = prevMap.get(row.keyword_id);
    if (pos != null && prevPos != null) {
      movers.push({
        keyword: row.keyword,
        project_name: projectNameMap.get(row.project_id) || '',
        old_position: prevPos,
        new_position: pos,
        change: prevPos - pos, // positive = improved
      });
    }
  }

  const avgPos = positions.length
    ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10
    : null;

  // Sort movers
  movers.sort((a, b) => b.change - a.change);
  const topMovers = movers.filter(m => m.change > 0).slice(0, 5);
  const topDecliners = movers.filter(m => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 5);

  return json({
    has_projects: true,
    total_keywords: (latestRows as any[]).length,
    avg_position: avgPos,
    distribution: dist,
    top_movers: topMovers,
    top_decliners: topDecliners,
  });
}

// GET /api/rank-tracking/keywords/:id/history
export async function handleKeywordHistory(env: Env, userId: string, keywordId: string): Promise<Response> {
  const keyword = await env.DB.prepare(`
    SELECT tk.id, tk.keyword FROM tracked_keywords tk
    JOIN seo_projects p ON p.id = tk.project_id
    WHERE tk.id = ? AND p.user_id = ?
  `).bind(keywordId, userId).first();

  if (!keyword) return json({ error: 'Keyword not found' }, 404);

  const { results } = await env.DB.prepare(
    'SELECT position, rank_group, estimated_traffic, checked_at FROM rank_history WHERE keyword_id = ? ORDER BY checked_at DESC LIMIT 30'
  ).bind(keywordId).all();

  return json({ keyword, history: results });
}
