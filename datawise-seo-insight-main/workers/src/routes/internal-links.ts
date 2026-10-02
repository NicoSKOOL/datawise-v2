// Internal Links (Jev) API. A run is created here and then advanced in
// slices by internal-links/runner.ts: each status poll kicks one slice via
// ctx.waitUntil, and the */5 cron picks up runs whose page was closed.

import type { Env } from '../index';
import { discoverSitemap } from '../internal-links/discover';
import { resolveUserOpenRouterKey } from '../internal-links/key';
import { MAX_PAGES, processRun, type RunRow } from '../internal-links/runner';
import { deleteRunData, getRunJson, putRunJson } from '../internal-links/storage';
import { UnsafeUrlError } from '../lib/safe-fetch';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// A kick runs after the response, inside the 30s waitUntil window.
const POLL_SLICE_MS = 22_000;
const POLL_SLICE_SUBREQUESTS = 300;
// An advance request works inline (no waitUntil cap) and returns fresh status.
const ADVANCE_SLICE_MS = 45_000;
const ADVANCE_SLICE_SUBREQUESTS = 600;
const DEFAULT_MAX_COST = 3;

function formatRun(r: RunRow) {
  return {
    id: r.id,
    site_url: r.site_url,
    sitemap_url: r.sitemap_url,
    status: r.status,
    stage: r.stage,
    cursor: r.cursor,
    total: r.total,
    progress: r.progress_json ? JSON.parse(r.progress_json) : {},
    summary: r.summary_json ? JSON.parse(r.summary_json) : null,
    cost_usd: r.cost_usd,
    max_cost_usd: r.max_cost_usd,
    estimated_cost_usd: r.estimated_cost_usd,
    error: r.error,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

async function getRun(env: Env, userId: string, runId: string): Promise<RunRow | null> {
  return await env.DB.prepare('SELECT * FROM internal_link_runs WHERE id = ? AND user_id = ?')
    .bind(runId, userId)
    .first<RunRow>();
}

function kick(env: Env, ctx: ExecutionContext, run: RunRow) {
  if (run.status !== 'running') return;
  ctx.waitUntil(
    processRun(env, run.id, { deadline: Date.now() + POLL_SLICE_MS, subrequests: POLL_SLICE_SUBREQUESTS })
  );
}

async function handleCreate(request: Request, env: Env, ctx: ExecutionContext, userId: string): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { site_url?: string; max_cost_usd?: number };
  if (!body.site_url?.trim()) return json({ error: 'Enter your website URL.' }, 400);

  const active = await env.DB.prepare(
    `SELECT id FROM internal_link_runs WHERE user_id = ? AND status IN ('running','awaiting_confirmation') LIMIT 1`
  )
    .bind(userId)
    .first<{ id: string }>();
  if (active) {
    return json({ error: 'You already have a run in progress. Wait for it to finish or delete it first.', run_id: active.id }, 409);
  }

  if (!(await resolveUserOpenRouterKey(env, userId))) {
    return json({ error: 'no_llm_key', message: 'Save your OpenRouter API key in Settings first. Jev runs on your own key.' }, 400);
  }

  let discovery;
  try {
    discovery = await discoverSitemap(body.site_url);
  } catch (err) {
    if (err instanceof UnsafeUrlError || err instanceof TypeError) {
      return json({ error: 'That does not look like a valid public website URL.' }, 400);
    }
    throw err;
  }
  if (!discovery.urls.length) {
    return json(
      {
        error: discovery.blocked
          ? 'The site blocked our crawler with an anti-bot challenge, so its sitemap could not be read.'
          : 'No sitemap was found. We checked robots.txt, /sitemap.xml, /sitemap_index.xml, /sitemap-index.xml and /wp-sitemap.xml.',
      },
      422
    );
  }

  const urls = discovery.urls.slice(0, MAX_PAGES);
  const maxCost = Number.isFinite(body.max_cost_usd) && body.max_cost_usd! > 0 ? Math.min(body.max_cost_usd!, 50) : DEFAULT_MAX_COST;
  const id = crypto.randomUUID();
  await putRunJson(env, id, 'urls', urls);
  const progress = { pages_total: urls.length, pages_done: 0, sitemap_pages: discovery.urls.length };
  const run = await env.DB.prepare(
    `INSERT INTO internal_link_runs (id, user_id, site_url, sitemap_url, status, stage, cursor, total, progress_json, max_cost_usd)
     VALUES (?, ?, ?, ?, 'running', 'crawl', 0, ?, ?, ?) RETURNING *`
  )
    .bind(id, userId, discovery.siteUrl, discovery.sitemapUrl, urls.length, JSON.stringify(progress), maxCost)
    .first<RunRow>();
  kick(env, ctx, run!);
  return json({ run: formatRun(run!), truncated: discovery.urls.length > MAX_PAGES }, 201);
}

export async function handleInternalLinksRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  userId: string,
  path: string,
  method: string
): Promise<Response> {
  if (path === '/api/internal-links/runs') {
    if (method === 'POST') return handleCreate(request, env, ctx, userId);
    if (method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT * FROM internal_link_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 25'
      )
        .bind(userId)
        .all<RunRow>();
      return json({ runs: (results ?? []).map(formatRun) });
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  const m = path.match(/^\/api\/internal-links\/runs\/([^/]+)(?:\/([a-z]+))?$/);
  if (!m) return json({ error: 'Not found' }, 404);
  const [, runId, action] = m;
  const run = await getRun(env, userId, runId);
  if (!run) return json({ error: 'Run not found' }, 404);

  if (!action && method === 'GET') {
    return json({ run: formatRun(run) });
  }

  // The open report page calls this in a loop: one inline slice per call.
  if (action === 'advance' && method === 'POST') {
    const advanced =
      run.status === 'running' &&
      (await processRun(env, runId, { deadline: Date.now() + ADVANCE_SLICE_MS, subrequests: ADVANCE_SLICE_SUBREQUESTS }));
    const fresh = await getRun(env, userId, runId);
    return json({ run: fresh ? formatRun(fresh) : null, advanced });
  }

  if (!action && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM internal_link_runs WHERE id = ?').bind(runId).run();
    ctx.waitUntil(deleteRunData(env, runId));
    return json({ ok: true });
  }

  if (action === 'report' && method === 'GET') {
    if (run.status !== 'completed') return json({ error: 'The report is not ready yet.' }, 409);
    const report = await getRunJson(env, runId, 'report');
    if (!report) return json({ error: 'Report data is missing.' }, 404);
    return json({ report, approvals: run.approvals_json ? JSON.parse(run.approvals_json) : {} });
  }

  // Cost gate passed by the member: raise the run's limit past the estimate.
  if (action === 'confirm' && method === 'POST') {
    if (run.status !== 'awaiting_confirmation') return json({ error: 'This run is not waiting for confirmation.' }, 409);
    const maxCost = Math.max(run.max_cost_usd, Math.ceil((run.estimated_cost_usd ?? 0) * 1.25 * 100) / 100);
    const updated = await env.DB.prepare(
      `UPDATE internal_link_runs SET status = 'running', max_cost_usd = ?, updated_at = datetime('now')
       WHERE id = ? RETURNING *`
    )
      .bind(maxCost, runId)
      .first<RunRow>();
    kick(env, ctx, updated!);
    return json({ run: formatRun(updated!) });
  }

  // Retry after a failure (e.g. the key was fixed): picks up from the saved
  // stage and cursor, so no completed work is repeated.
  if (action === 'resume' && method === 'POST') {
    if (run.status !== 'failed') return json({ error: 'Only a failed run can be resumed.' }, 409);
    const updated = await env.DB.prepare(
      `UPDATE internal_link_runs SET status = 'running', error = NULL, processing_locked_until = NULL,
         updated_at = datetime('now') WHERE id = ? RETURNING *`
    )
      .bind(runId)
      .first<RunRow>();
    kick(env, ctx, updated!);
    return json({ run: formatRun(updated!) });
  }

  if (action === 'approvals' && method === 'PATCH') {
    const body = (await request.json().catch(() => ({}))) as { id?: number; value?: 'approved' | 'rejected' | null };
    if (typeof body.id !== 'number') return json({ error: 'id is required' }, 400);
    const approvals: Record<string, string> = run.approvals_json ? JSON.parse(run.approvals_json) : {};
    if (body.value === 'approved' || body.value === 'rejected') approvals[body.id] = body.value;
    else delete approvals[body.id];
    await env.DB.prepare('UPDATE internal_link_runs SET approvals_json = ? WHERE id = ?')
      .bind(JSON.stringify(approvals), runId)
      .run();
    return json({ approvals });
  }

  return json({ error: 'Not found' }, 404);
}
