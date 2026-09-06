import type { Env } from '../index';
import { dataforseoRequestCached } from '../dataforseo/client';
import { resolveModel } from '../dataforseo/llm-models';
import { buildRecommendation, type EngineCheck } from './ai-recommendations';

// AI Visibility Tracker: persistent weekly tracking of AI search presence per
// rank-tracking project. See docs/specs/2026-06-09-ai-visibility-tracker-design.md.

export type AIEngine = 'google_ai_mode' | 'chatgpt' | 'perplexity';
export const ALL_AI_ENGINES: AIEngine[] = ['google_ai_mode', 'chatgpt', 'perplexity'];

export const MAX_AI_QUERIES_PER_PROJECT = 20;
// Cross-user dedup window: identical query+engine payloads within the same
// weekly cycle share one DataForSEO call. 6 days so it never spans two runs.
const ENGINE_CACHE_TTL_SECONDS = 6 * 24 * 3600;
const ENGINE_TIMEOUT_MS = 60_000;
// Hard ceiling on engine calls per scheduled run, so a runaway project list
// can never blow up the DataForSEO bill or the cron's subrequest budget.
const MAX_CHECKS_PER_SCHEDULED_RUN = 600;
// Skip-if-fresh: a query+engine checked in the last 24h is not re-checked.
const FRESHNESS_HOURS = 24;
// KV kill switch: set any value at this key to pause all scheduled AI checks.
const PAUSE_KEY = 'ai-tracking-paused';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function normalizeDomain(raw: string): string | null {
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function domainsMatch(candidate: string, target: string): boolean {
  return candidate === target || candidate.endsWith(`.${target}`) || target.endsWith(`.${candidate}`);
}

function parseJsonArray(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string' && v.trim());
  } catch { /* fall through */ }
  return null;
}

function projectEngines(project: { ai_engines?: string | null }): AIEngine[] {
  const parsed = parseJsonArray(project.ai_engines);
  if (!parsed?.length) return ALL_AI_ENGINES;
  return ALL_AI_ENGINES.filter(e => parsed.includes(e));
}

// Brand terms default to the project name and the domain's second-level label
// (datawiseseo.com -> "datawiseseo"). Users can edit them in the panel.
export function defaultBrandTerms(project: { name?: string | null; domain?: string | null }): string[] {
  const terms = new Set<string>();
  const name = (project.name || '').trim();
  if (name) terms.add(name);
  const host = normalizeDomain(project.domain || '');
  const sld = host?.split('.')[0];
  if (sld && sld.length > 2) terms.add(sld);
  return Array.from(terms);
}

// --- Response parsing ---------------------------------------------------

export interface ParsedAnswer {
  answerText: string;
  citations: Array<{ url: string | null; domain: string; position: number }>;
}

// The three engines return differently shaped payloads (ai_mode items with
// `references`, llm_responses sections with `annotations`). Rather than chase
// each shape, walk the result tree: answer text accumulates from `text`
// fields, citations from objects inside `annotations`/`references`/`sources`
// arrays. Falls back to item-level url/source_url when no citation arrays
// exist (older ai_mode payloads).
export function parseEngineResponse(data: any): ParsedAnswer {
  const items = data?.tasks?.[0]?.result?.[0]?.items || [];
  const texts: string[] = [];
  const rawCitations: Array<{ url?: string; domain?: string; source?: string }> = [];

  const walk = (node: any): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'text' && typeof value === 'string' && value.trim()) {
        texts.push(value);
      } else if ((key === 'annotations' || key === 'references' || key === 'sources') && Array.isArray(value)) {
        for (const cite of value) {
          if (cite && typeof cite === 'object' && ((cite as any).url || (cite as any).domain || (cite as any).source)) {
            rawCitations.push(cite as any);
          }
        }
        walk(value);
      } else {
        walk(value);
      }
    }
  };
  walk(items);

  if (rawCitations.length === 0) {
    for (const item of items) {
      const url = item?.url || item?.source_url;
      if (typeof url === 'string' && url) rawCitations.push({ url });
    }
  }

  const seen = new Set<string>();
  const citations: ParsedAnswer['citations'] = [];
  for (const raw of rawCitations) {
    const url = typeof raw.url === 'string' && raw.url ? raw.url : null;
    const domain = normalizeDomain(url || raw.domain || raw.source || '');
    if (!domain) continue;
    const dedupeKey = url || domain;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    citations.push({ url, domain, position: citations.length + 1 });
  }

  return { answerText: texts.join('\n'), citations };
}

export interface Classification {
  status: 'cited' | 'mentioned' | 'absent' | 'no_answer';
  citation_position: number | null;
  cited_url: string | null;
  answer_excerpt: string | null;
}

export function classifyAnswer(parsed: ParsedAnswer, projectDomain: string, brandTerms: string[]): Classification {
  const target = normalizeDomain(projectDomain);
  if (target) {
    for (const cite of parsed.citations) {
      if (domainsMatch(cite.domain, target)) {
        return { status: 'cited', citation_position: cite.position, cited_url: cite.url, answer_excerpt: null };
      }
    }
  }

  const text = parsed.answerText;
  if (!text && parsed.citations.length === 0) {
    return { status: 'no_answer', citation_position: null, cited_url: null, answer_excerpt: null };
  }

  for (const term of brandTerms) {
    const cleaned = term.trim();
    if (cleaned.length < 3) continue;
    const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`\\b${escaped}\\b`, 'i'));
    if (match && match.index != null) {
      const start = Math.max(0, match.index - 60);
      const excerpt = (start > 0 ? '…' : '') + text.slice(start, match.index + cleaned.length + 100).trim() + '…';
      return { status: 'mentioned', citation_position: null, cited_url: null, answer_excerpt: excerpt.slice(0, 300) };
    }
  }

  return { status: 'absent', citation_position: null, cited_url: null, answer_excerpt: null };
}

// --- Engine calls ---------------------------------------------------------

// Builds the DataForSEO request for one engine. Exported so the model
// selection is testable without D1: model names come from the live catalog
// (see dataforseo/llm-models.ts), never from string literals here.
export async function buildEngineRequest(
  env: Env,
  engine: AIEngine,
  query: string
): Promise<{ endpoint: string; body: Record<string, unknown>[] }> {
  if (engine === 'google_ai_mode') {
    return {
      endpoint: '/serp/google/ai_mode/live/advanced',
      body: [{
        keyword: query,
        location_name: 'United States',
        language_name: 'English',
        device: 'desktop',
        os: 'windows',
      }],
    };
  }
  if (engine === 'chatgpt') {
    return {
      endpoint: '/ai_optimization/chat_gpt/llm_responses/live',
      body: [{
        user_prompt: query,
        model_name: await resolveModel(env, 'chat_gpt'),
        web_search: true,
        max_output_tokens: 2048,
      }],
    };
  }
  return {
    endpoint: '/ai_optimization/perplexity/llm_responses/live',
    body: [{
      user_prompt: query,
      model_name: await resolveModel(env, 'perplexity'),
      max_output_tokens: 2048,
    }],
  };
}

async function callEngine(env: Env, engine: AIEngine, query: string): Promise<any> {
  const { endpoint, body } = await buildEngineRequest(env, engine, query);
  return dataforseoRequestCached(env, endpoint, body, { ttlSeconds: ENGINE_CACHE_TTL_SECONDS, timeoutMs: ENGINE_TIMEOUT_MS });
}

interface ProjectRow {
  id: string;
  user_id: string;
  name: string | null;
  domain: string;
  ai_tracking_enabled: number;
  ai_brand_terms: string | null;
  ai_engines: string | null;
}

interface QueryRow {
  id: string;
  query_text: string;
}

async function runChecksForProject(
  env: Env,
  project: ProjectRow,
  queries: QueryRow[],
  runType: 'scheduled' | 'manual',
  budget?: { remaining: number }
): Promise<{ checks: number; cited: number; mentioned: number; errors: number; skipped_fresh: number }> {
  const engines = projectEngines(project);
  const brandTerms = parseJsonArray(project.ai_brand_terms) || defaultBrandTerms(project);
  const summary = { checks: 0, cited: 0, mentioned: 0, errors: 0, skipped_fresh: 0 };
  if (!queries.length || !engines.length) return summary;

  // One D1 read covers freshness for every query+engine in this project.
  const placeholders = queries.map(() => '?').join(',');
  const { results: freshRows } = await env.DB.prepare(`
    SELECT query_id, engine FROM ai_visibility_checks
    WHERE query_id IN (${placeholders}) AND status != 'error'
      AND checked_at >= datetime('now', '-${FRESHNESS_HOURS} hours')
  `).bind(...queries.map(q => q.id)).all();
  const fresh = new Set((freshRows as any[] || []).map(r => `${r.query_id}|${r.engine}`));

  for (const query of queries) {
    const due = engines.filter(e => !fresh.has(`${query.id}|${e}`));
    summary.skipped_fresh += engines.length - due.length;
    if (!due.length) continue;
    if (budget && budget.remaining < due.length) break;
    if (budget) budget.remaining -= due.length;

    const checkedAt = nowSql();
    const settled = await Promise.allSettled(due.map(async (engine) => {
      const data = await callEngine(env, engine, query.query_text);
      const parsed = parseEngineResponse(data);
      return { engine, parsed, classification: classifyAnswer(parsed, project.domain, brandTerms) };
    }));

    for (let i = 0; i < settled.length; i++) {
      const engine = due[i];
      const outcome = settled[i];
      summary.checks++;

      if (outcome.status === 'rejected') {
        summary.errors++;
        console.error(`AI check failed [${engine}] "${query.query_text}":`, outcome.reason instanceof Error ? outcome.reason.message : outcome.reason);
        await env.DB.prepare(
          'INSERT INTO ai_visibility_checks (query_id, engine, status, run_type, checked_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(query.id, engine, 'error', runType, checkedAt).run();
        continue;
      }

      const { parsed, classification } = outcome.value;
      if (classification.status === 'cited') summary.cited++;
      if (classification.status === 'mentioned') summary.mentioned++;

      const inserted = await env.DB.prepare(`
        INSERT INTO ai_visibility_checks (query_id, engine, status, citation_position, cited_url, answer_excerpt, answer_text, run_type, checked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        query.id, engine, classification.status, classification.citation_position,
        classification.cited_url, classification.answer_excerpt,
        parsed.answerText ? parsed.answerText.slice(0, 10_000) : null,
        runType, checkedAt,
      ).run();

      const checkId = inserted.meta?.last_row_id;
      if (checkId && parsed.citations.length) {
        const stmts = parsed.citations.slice(0, 30).map(cite =>
          env.DB.prepare(
            'INSERT INTO ai_check_citations (check_id, domain, url, position) VALUES (?, ?, ?, ?)'
          ).bind(checkId, cite.domain, cite.url, cite.position)
        );
        for (let j = 0; j < stmts.length; j += 50) {
          await env.DB.batch(stmts.slice(j, j + 50));
        }
      }
    }
  }

  return summary;
}

// --- Cron entry -----------------------------------------------------------

export async function runScheduledAIChecks(env: Env): Promise<void> {
  const paused = await env.KV.get(PAUSE_KEY);
  if (paused) {
    console.log('AI tracking: paused via KV kill switch, skipping scheduled run');
    return;
  }

  const { results: projects } = await env.DB.prepare(
    'SELECT id, user_id, name, domain, ai_tracking_enabled, ai_brand_terms, ai_engines FROM seo_projects WHERE ai_tracking_enabled = 1'
  ).all() as { results: ProjectRow[] };

  if (!projects?.length) {
    console.log('AI tracking: no projects enabled');
    return;
  }

  const budget = { remaining: MAX_CHECKS_PER_SCHEDULED_RUN };
  let totals = { projects: 0, checks: 0, cited: 0, mentioned: 0, errors: 0, skipped_fresh: 0 };

  for (const project of projects) {
    if (budget.remaining <= 0) {
      console.warn(`AI tracking: per-run check budget exhausted; ${projects.length - totals.projects} project(s) deferred to next run`);
      break;
    }
    const { results: queries } = await env.DB.prepare(
      'SELECT id, query_text FROM ai_tracked_queries WHERE project_id = ? AND is_active = 1 ORDER BY created_at ASC LIMIT ?'
    ).bind(project.id, MAX_AI_QUERIES_PER_PROJECT).all() as { results: QueryRow[] };

    const summary = await runChecksForProject(env, project, queries || [], 'scheduled', budget);
    totals = {
      projects: totals.projects + 1,
      checks: totals.checks + summary.checks,
      cited: totals.cited + summary.cited,
      mentioned: totals.mentioned + summary.mentioned,
      errors: totals.errors + summary.errors,
      skipped_fresh: totals.skipped_fresh + summary.skipped_fresh,
    };
  }

  console.log(`AI tracking weekly run: ${JSON.stringify(totals)}`);
}

// --- Routes -----------------------------------------------------------------

async function getOwnedProject(env: Env, userId: string, projectId: string): Promise<ProjectRow | null> {
  return await env.DB.prepare(
    'SELECT id, user_id, name, domain, ai_tracking_enabled, ai_brand_terms, ai_engines FROM seo_projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first() as ProjectRow | null;
}

// GET /api/rank-tracking/projects/:id/ai
export async function handleGetAITracking(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await getOwnedProject(env, userId, projectId);
  if (!project) return json({ error: 'Project not found' }, 404);

  const { results: queryRows } = await env.DB.prepare(`
    SELECT q.id, q.query_text, q.source, q.keyword_id, q.created_at,
      c.engine, c.status, c.citation_position, c.cited_url, c.answer_excerpt, c.checked_at,
      c.id as check_id
    FROM ai_tracked_queries q
    LEFT JOIN ai_visibility_checks c ON c.query_id = q.id
      AND c.id = (SELECT MAX(id) FROM ai_visibility_checks WHERE query_id = q.id AND engine = c.engine)
    WHERE q.project_id = ? AND q.is_active = 1
    ORDER BY q.created_at ASC
  `).bind(projectId).all();

  // Citations for each latest check (the per-engine evidence lists).
  const checkIds = [...new Set((queryRows as any[] || []).map(r => r.check_id).filter(Boolean))];
  const citationsByCheck = new Map<number, Array<{ domain: string; url: string | null; position: number }>>();
  if (checkIds.length) {
    const placeholders2 = checkIds.map(() => '?').join(',');
    const { results: citeRows } = await env.DB.prepare(
      `SELECT check_id, domain, url, position FROM ai_check_citations
       WHERE check_id IN (${placeholders2}) ORDER BY position ASC`
    ).bind(...checkIds).all();
    for (const row of (citeRows as any[] || [])) {
      if (!citationsByCheck.has(row.check_id)) citationsByCheck.set(row.check_id, []);
      const list = citationsByCheck.get(row.check_id)!;
      if (list.length < 10) list.push({ domain: row.domain, url: row.url, position: row.position });
    }
  }

  const byQuery = new Map<string, any>();
  for (const row of (queryRows as any[] || [])) {
    if (!byQuery.has(row.id)) {
      byQuery.set(row.id, {
        id: row.id,
        query_text: row.query_text,
        source: row.source,
        keyword_id: row.keyword_id,
        created_at: row.created_at,
        engines: {},
      });
    }
    if (row.engine) {
      byQuery.get(row.id).engines[row.engine] = {
        status: row.status,
        citation_position: row.citation_position,
        cited_url: row.cited_url,
        answer_excerpt: row.answer_excerpt,
        checked_at: row.checked_at,
        check_id: row.check_id,
        citations: citationsByCheck.get(row.check_id) || [],
      };
    }
  }

  for (const q of byQuery.values()) {
    const checks: EngineCheck[] = Object.entries(q.engines).map(([engine, e]: [string, any]) => ({
      engine, status: e.status, citation_position: e.citation_position, citations: e.citations || [],
    }));
    q.recommendation = buildRecommendation(q.query_text, checks, project.domain);
  }

  return json({
    settings: {
      enabled: !!project.ai_tracking_enabled,
      brand_terms: parseJsonArray(project.ai_brand_terms) || defaultBrandTerms(project),
      engines: projectEngines(project),
      max_queries: MAX_AI_QUERIES_PER_PROJECT,
    },
    queries: Array.from(byQuery.values()),
  });
}

// PATCH /api/rank-tracking/projects/:id/ai
export async function handleUpdateAISettings(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await getOwnedProject(env, userId, projectId);
  if (!project) return json({ error: 'Project not found' }, 404);

  const body = await request.json() as { enabled?: boolean; brand_terms?: string[]; engines?: string[] };

  const updates: string[] = [];
  const binds: unknown[] = [];

  if (typeof body.enabled === 'boolean') {
    updates.push('ai_tracking_enabled = ?');
    binds.push(body.enabled ? 1 : 0);
  }
  if (Array.isArray(body.brand_terms)) {
    const terms = body.brand_terms.map(t => String(t).trim()).filter(Boolean).slice(0, 10);
    updates.push('ai_brand_terms = ?');
    binds.push(terms.length ? JSON.stringify(terms) : null);
  }
  if (Array.isArray(body.engines)) {
    const engines = ALL_AI_ENGINES.filter(e => body.engines!.includes(e));
    if (!engines.length) return json({ error: 'At least one engine is required' }, 400);
    updates.push('ai_engines = ?');
    binds.push(engines.length === ALL_AI_ENGINES.length ? null : JSON.stringify(engines));
  }

  if (updates.length) {
    await env.DB.prepare(`UPDATE seo_projects SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...binds, projectId).run();
  }

  return handleGetAITracking(env, userId, projectId);
}

// POST /api/rank-tracking/projects/:id/ai/queries
export async function handleAddAIQueries(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await getOwnedProject(env, userId, projectId);
  if (!project) return json({ error: 'Project not found' }, 404);

  const { queries } = await request.json() as { queries?: Array<{ text: string; keyword_id?: string; source?: string }> };
  if (!queries?.length) return json({ error: 'queries array is required' }, 400);

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM ai_tracked_queries WHERE project_id = ? AND is_active = 1'
  ).bind(projectId).first() as any;
  let remaining = MAX_AI_QUERIES_PER_PROJECT - (countRow?.cnt || 0);

  const { results: existing } = await env.DB.prepare(
    'SELECT query_text FROM ai_tracked_queries WHERE project_id = ? AND is_active = 1'
  ).bind(projectId).all();
  const existingSet = new Set((existing as any[] || []).map(r => r.query_text.toLowerCase()));

  let added = 0;
  for (const q of queries) {
    const text = (q.text || '').trim();
    if (!text || existingSet.has(text.toLowerCase())) continue;
    if (remaining <= 0) break;
    existingSet.add(text.toLowerCase());
    await env.DB.prepare(
      'INSERT INTO ai_tracked_queries (id, project_id, query_text, source, keyword_id) VALUES (?, ?, ?, ?, ?)'
    ).bind(generateId(), projectId, text, q.source === 'discovery' ? 'discovery' : (q.keyword_id ? 'keyword' : 'custom'), q.keyword_id || null).run();
    remaining--;
    added++;
  }

  return json({ added, skipped: queries.length - added, remaining });
}

// GET /api/rank-tracking/ai/checks/:id/answer
export async function handleGetAIAnswer(env: Env, userId: string, checkId: string): Promise<Response> {
  const row = await env.DB.prepare(`
    SELECT c.answer_text FROM ai_visibility_checks c
    JOIN ai_tracked_queries q ON q.id = c.query_id
    JOIN seo_projects p ON p.id = q.project_id
    WHERE c.id = ? AND p.user_id = ?
  `).bind(checkId, userId).first() as any;
  if (!row) return json({ error: 'Check not found' }, 404);
  return json({ answer_text: row.answer_text ?? null });
}

// DELETE /api/rank-tracking/ai-queries/:id
export async function handleDeleteAIQuery(env: Env, userId: string, queryId: string): Promise<Response> {
  const query = await env.DB.prepare(`
    SELECT q.id FROM ai_tracked_queries q
    JOIN seo_projects p ON p.id = q.project_id
    WHERE q.id = ? AND p.user_id = ?
  `).bind(queryId, userId).first();

  if (!query) return json({ error: 'Query not found' }, 404);

  await env.DB.prepare('DELETE FROM ai_tracked_queries WHERE id = ?').bind(queryId).run();
  return json({ success: true });
}

// POST /api/rank-tracking/projects/:id/ai/check (credit-gated in index.ts)
export async function handleRunAICheck(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await getOwnedProject(env, userId, projectId);
  if (!project) return json({ error: 'Project not found' }, 404);

  const { results: queries } = await env.DB.prepare(
    'SELECT id, query_text FROM ai_tracked_queries WHERE project_id = ? AND is_active = 1 ORDER BY created_at ASC LIMIT ?'
  ).bind(projectId, MAX_AI_QUERIES_PER_PROJECT).all() as { results: QueryRow[] };

  if (!queries?.length) return json({ error: 'No AI queries to check. Add queries first.' }, 400);

  const summary = await runChecksForProject(env, project, queries, 'manual');
  return json(summary);
}

// GET /api/rank-tracking/projects/:id/ai/report?period=90
export async function handleAIReport(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await getOwnedProject(env, userId, projectId);
  if (!project) return json({ error: 'Project not found' }, 404);

  const url = new URL(request.url);
  const period = Math.min(Math.max(parseInt(url.searchParams.get('period') || '90', 10), 7), 365);

  // Trend: per run date and engine, how many tracked queries were cited /
  // mentioned out of all checked that day.
  const { results: trendRows } = await env.DB.prepare(`
    SELECT date(c.checked_at) as date, c.engine,
      COUNT(*) as total,
      SUM(CASE WHEN c.status = 'cited' THEN 1 ELSE 0 END) as cited,
      SUM(CASE WHEN c.status = 'mentioned' THEN 1 ELSE 0 END) as mentioned
    FROM ai_visibility_checks c
    JOIN ai_tracked_queries q ON q.id = c.query_id
    WHERE q.project_id = ? AND c.status != 'error'
      AND c.checked_at >= datetime('now', '-' || ? || ' days')
    GROUP BY date(c.checked_at), c.engine
    ORDER BY date(c.checked_at) ASC
  `).bind(projectId, period).all();

  // Share of voice: which domains AI answers cite across this project's
  // queries in the period (your domain included).
  const shareQuery = `
    SELECT cc.domain,
      COUNT(*) as citations,
      COUNT(DISTINCT c.query_id) as queries_cited
    FROM ai_check_citations cc
    JOIN ai_visibility_checks c ON c.id = cc.check_id
    JOIN ai_tracked_queries q ON q.id = c.query_id
    WHERE q.project_id = ? AND c.checked_at >= datetime('now', '-' || ? || ' days')
    GROUP BY cc.domain
    ORDER BY citations DESC, queries_cited DESC
    LIMIT 15
  `;
  const { results: shareRows } = await env.DB.prepare(shareQuery).bind(projectId, period).all();

  const target = normalizeDomain(project.domain);
  const share = (shareRows as any[] || []).map(row => ({
    ...row,
    is_you: !!target && domainsMatch(row.domain, target),
  }));

  const trend = (trendRows as any[] || []).map(r => ({
    ...r,
    score: r.total ? Math.round(((r.cited + 0.5 * r.mentioned) / r.total) * 100) : 0,
  }));

  return json({ trend, share_of_voice: share, period });
}
