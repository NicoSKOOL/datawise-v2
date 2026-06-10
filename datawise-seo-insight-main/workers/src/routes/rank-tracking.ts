import type { Env } from '../index';
import { dataforseoRequestCached } from '../dataforseo/client';

// SERP positions don't shift faster than a 1h window for the long-tail keywords
// typical beta users track. Caching at this TTL lets same-user re-clicks (and
// users tracking identical kw/location/language) skip the 3.8s DataForSEO call.
const SERP_TTL_SECONDS = 3600;

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

  // Per-project health for the list cards: avg position + ranking count from
  // each keyword's latest check, and when the project was last checked at all.
  const { results: stats } = await env.DB.prepare(`
    WITH latest AS (
      SELECT tk.project_id, rh.position,
        ROW_NUMBER() OVER (PARTITION BY rh.keyword_id ORDER BY rh.checked_at DESC, rh.id DESC) as rn
      FROM rank_history rh
      JOIN tracked_keywords tk ON tk.id = rh.keyword_id
      JOIN seo_projects p ON p.id = tk.project_id
      WHERE p.user_id = ? AND tk.is_active = 1
    )
    SELECT project_id,
      COUNT(CASE WHEN position IS NOT NULL THEN 1 END) as ranking_keywords,
      ROUND(AVG(position), 1) as avg_position
    FROM latest WHERE rn = 1
    GROUP BY project_id
  `).bind(userId).all();

  const { results: lastChecks } = await env.DB.prepare(`
    SELECT tk.project_id, MAX(rh.checked_at) as last_checked_at
    FROM rank_history rh
    JOIN tracked_keywords tk ON tk.id = rh.keyword_id
    JOIN seo_projects p ON p.id = tk.project_id
    WHERE p.user_id = ?
    GROUP BY tk.project_id
  `).bind(userId).all();

  const statsById = new Map((stats as any[]).map(s => [s.project_id, s]));
  const lastById = new Map((lastChecks as any[]).map(s => [s.project_id, s.last_checked_at]));
  const enriched = (results as any[]).map(p => ({
    ...p,
    ranking_keywords: statsById.get(p.id)?.ranking_keywords ?? 0,
    avg_position: statsById.get(p.id)?.avg_position ?? null,
    last_checked_at: lastById.get(p.id) ?? null,
  }));

  return json(enriched);
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

  // Single window-function pass instead of two correlated subqueries per
  // keyword (the old shape re-scanned rank_history twice per row and
  // degraded quadratically as check history accumulated).
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT rh.keyword_id, rh.position, rh.rank_group, rh.estimated_traffic, rh.checked_at,
        ROW_NUMBER() OVER (PARTITION BY rh.keyword_id ORDER BY rh.checked_at DESC, rh.id DESC) as rn
      FROM rank_history rh
      JOIN tracked_keywords tk ON tk.id = rh.keyword_id
      WHERE tk.project_id = ? AND tk.is_active = 1
    )
    SELECT tk.*,
      cur.position, cur.rank_group, cur.estimated_traffic, cur.checked_at,
      prev.position as prev_position
    FROM tracked_keywords tk
    LEFT JOIN ranked cur ON cur.keyword_id = tk.id AND cur.rn = 1
    LEFT JOIN ranked prev ON prev.keyword_id = tk.id AND prev.rn = 2
    WHERE tk.project_id = ? AND tk.is_active = 1
    ORDER BY CASE WHEN cur.position IS NULL THEN 1 ELSE 0 END, cur.position ASC
  `).bind(projectId, projectId).all();

  return json(results);
}

// POST /api/rank-tracking/projects/:id/keywords
export async function handleAddKeywords(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id, project_type FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first() as { id: string; project_type: string } | null;

  if (!project) return json({ error: 'Project not found' }, 404);
  const isLocal = project.project_type === 'local';

  const { keywords, location_code = 2840, language_code = 'en', device = 'desktop', initial_positions } = await request.json() as any;
  if (!keywords?.length) return json({ error: 'Keywords array is required' }, 400);
  const cleanDevice = device === 'mobile' ? 'mobile' : 'desktop';

  // Get existing keywords to skip duplicates. Dedupe is per keyword+device:
  // the same keyword tracked on desktop AND mobile is two distinct entries.
  const { results: existing } = await env.DB.prepare(
    'SELECT keyword, device FROM tracked_keywords WHERE project_id = ? AND is_active = 1'
  ).bind(projectId).all();
  const dupKey = (keyword: string, dev: any) => `${keyword}::${dev === 'mobile' ? 'mobile' : 'desktop'}`;
  const existingSet = new Set((existing || []).map((r: any) => dupKey(r.keyword.toLowerCase(), r.device)));

  let added = 0;
  const stmts: D1PreparedStatement[] = [];
  const checkedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  for (const kw of keywords) {
    const cleaned = kw.trim().toLowerCase();
    if (!cleaned || existingSet.has(dupKey(cleaned, cleanDevice))) continue;
    existingSet.add(dupKey(cleaned, cleanDevice));
    const keywordId = generateId();
    stmts.push(
      env.DB.prepare(
        'INSERT INTO tracked_keywords (id, project_id, keyword, location_code, language_code, device) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(keywordId, projectId, cleaned, location_code, language_code, cleanDevice)
    );

    // Seed history with the provided position so the first row of the
    // rank/local-pack table is populated immediately. For local projects
    // the position represents Local Pack rank (1-3) or Maps rank (4-20)
    // and goes into local_rank_history; for organic projects it's an
    // SERP position and goes into rank_history.
    const pos = initial_positions?.[kw] ?? initial_positions?.[cleaned];
    if (pos != null) {
      if (isLocal) {
        stmts.push(
          env.DB.prepare(
            'INSERT INTO local_rank_history (keyword_id, pack_position, rating, reviews_count, checked_at) VALUES (?, ?, ?, ?, ?)'
          ).bind(keywordId, Math.round(pos), null, null, checkedAt)
        );
      } else {
        stmts.push(
          env.DB.prepare(
            'INSERT INTO rank_history (keyword_id, position, rank_group, estimated_traffic, checked_at) VALUES (?, ?, ?, ?, ?)'
          ).bind(keywordId, Math.round(pos), Math.round(pos), null, checkedAt)
        );
      }
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

// Core SERP check for one project. Shared by the manual check button and the
// scheduled weekly cron.
async function checkRankingsForProject(
  env: Env,
  project: { id: string; domain: string; location_code?: number | null },
): Promise<{ checked: number; found: number; not_ranking: number }> {
  const { results: keywords } = await env.DB.prepare(
    'SELECT id, keyword, location_code, language_code, device FROM tracked_keywords WHERE project_id = ? AND is_active = 1'
  ).bind(project.id).all() as { results: any[] };

  if (!keywords.length) return { checked: 0, found: 0, not_ranking: 0 };

  // Group keywords by location+language+device to minimize API calls
  // Use project's location_code as fallback instead of hardcoded US (2840)
  const projectLocCode = project.location_code || 2840;
  const groups = new Map<string, { location_code: number; language_code: string; device: string; keywords: any[] }>();
  for (const kw of keywords) {
    const locCode = kw.location_code || projectLocCode;
    const device = kw.device === 'mobile' ? 'mobile' : 'desktop';
    const key = `${locCode}_${kw.language_code || 'en'}_${device}`;
    if (!groups.has(key)) {
      groups.set(key, { location_code: locCode, language_code: kw.language_code || 'en', device, keywords: [] });
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
        device: group.device,
        os: group.device === 'mobile' ? 'android' : 'windows',
        depth: 100,
      }));

      const data = await dataforseoRequestCached(env, '/serp/google/organic/live/regular', payload, { ttlSeconds: SERP_TTL_SECONDS });
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
          // Record the miss as a NULL-position row. A tracker that silently
          // keeps the stale rank when a keyword drops out of the top 100 is
          // lying to the user; the NULL row also updates "Last Checked".
          notRanking++;
          stmts.push(
            env.DB.prepare(
              'INSERT INTO rank_history (keyword_id, position, rank_group, estimated_traffic, checked_at) VALUES (?, ?, ?, ?, ?)'
            ).bind(kw.id, null, null, null, checkedAt)
          );
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

  return { checked: keywords.length, found, not_ranking: notRanking };
}

// POST /api/rank-tracking/projects/:id/check
export async function handleCheckRankings(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id, domain, location_code FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first() as any;

  if (!project) return json({ error: 'Project not found' }, 404);

  const summary = await checkRankingsForProject(env, project);
  if (summary.checked === 0) return json({ error: 'No keywords to check' }, 400);

  return json({ checked: summary.checked, found: summary.found, not_ranking: summary.not_ranking });
}

// --- Scheduled weekly rank checks ------------------------------------------
//
// Kill switch: set KV key `rank-checks-paused` to any value to skip runs.
// Scope guards (same philosophy as runDailyGSCSync):
//  - only organic projects with at least one active keyword
//  - only owners with a currently valid session (inactive users cost nothing)
//  - only projects with no check (manual or scheduled) in the last 6 days
//  - hard per-run keyword budget so a pathological account cannot blow up
//    the DataForSEO bill or the cron's subrequest limit
const RANK_CHECKS_PAUSE_KEY = 'rank-checks-paused';
const RANK_CHECKS_MAX_KEYWORDS_PER_RUN = 3000;
const RANK_CHECKS_STALE_DAYS = 6;

export async function runScheduledRankChecks(env: Env): Promise<void> {
  const startedAt = Date.now();
  const paused = await env.KV.get(RANK_CHECKS_PAUSE_KEY);
  if (paused) {
    console.log('Rank checks: paused via KV kill switch, skipping scheduled run');
    return;
  }

  const { results: projects } = await env.DB.prepare(`
    SELECT p.id, p.user_id, p.domain, p.location_code
    FROM seo_projects p
    WHERE COALESCE(p.project_type, 'organic') != 'local'
      AND p.domain IS NOT NULL AND p.domain != ''
      AND EXISTS (SELECT 1 FROM tracked_keywords tk WHERE tk.project_id = p.id AND tk.is_active = 1)
      AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = p.user_id AND s.expires_at > datetime('now'))
      AND NOT EXISTS (
        SELECT 1 FROM rank_history rh
        JOIN tracked_keywords tk2 ON tk2.id = rh.keyword_id
        WHERE tk2.project_id = p.id
          AND rh.checked_at > datetime('now', '-' || ? || ' days')
      )
    ORDER BY p.created_at ASC
  `).bind(RANK_CHECKS_STALE_DAYS).all() as { results: any[] };

  if (!projects?.length) {
    console.log('Rank checks: no due projects');
    return;
  }

  let budget = RANK_CHECKS_MAX_KEYWORDS_PER_RUN;
  let done = 0, checked = 0, errors = 0;

  for (const project of projects) {
    if (budget <= 0) {
      console.warn(`Rank checks: per-run keyword budget exhausted; ${projects.length - done} project(s) deferred to next run`);
      break;
    }
    try {
      const summary = await checkRankingsForProject(env, project);
      budget -= summary.checked;
      checked += summary.checked;
      done++;
    } catch (err) {
      errors++;
      console.error(`Rank checks: project ${project.id} failed:`, err);
    }
  }

  console.log(
    `Rank checks weekly run: ${done}/${projects.length} due projects, ${checked} keywords checked, ` +
    `${errors} errors, ${Date.now() - startedAt}ms`
  );
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
export async function handleDashboardSummary(env: Env, userId: string, domain?: string): Promise<Response> {
  // Check if user has any projects. When a selected website is supplied by
  // the dashboard, scope ranking KPIs to matching project domains instead of
  // mixing every project in the account.
  const { results: projects } = await env.DB.prepare(
    'SELECT id, name, domain FROM seo_projects WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  const targetDomain = domain ? cleanDomain(domain) : '';
  const scopedProjects = targetDomain
    ? (projects as any[] || []).filter((project) => (
      project.domain && domainsMatch(cleanDomain(project.domain), targetDomain)
    ))
    : (projects as any[] || []);

  if (!scopedProjects || scopedProjects.length === 0) {
    return json({
      has_projects: false,
      total_keywords: 0,
      avg_position: null,
      distribution: { top3: 0, top10: 0, top20: 0, top50: 0, above50: 0, not_ranking: 0 },
      top_movers: [],
      top_decliners: [],
    });
  }

  const projectIds = scopedProjects.map(p => p.id);
  const projectNameMap = new Map(scopedProjects.map(p => [p.id, p.name]));

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
