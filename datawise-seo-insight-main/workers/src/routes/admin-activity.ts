import type { Env } from '../index';
import type { AuthUser } from '../auth/google';
import { isAdmin } from './admin';
import { getLLMProvider } from '../llm/provider';

// Read side of the app_events telemetry (the write side lives in
// src/activity.ts and runs on every classified authenticated request).
// Serves the /admin/activity dashboard: usage totals, per-tool adoption,
// per-user timelines, an activation funnel, and raw event logs.
//
// All queries range-filter on created_at, which is indexed
// (idx_app_events_created_at). app_events holds ~90 days of product events
// (pruned on the 6h cron), so range scans stay small.

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const forbidden = () => json({ error: 'Admin access required' }, 403);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parses ?from=&to= into an inclusive [from, to] day range, expressed as the
// half-open SQL pair [from, to + 1 day) so 'YYYY-MM-DD HH:MM:SS' timestamps
// compare correctly as strings. Defaults to the last 30 days.
function parseRange(url: URL): { from: string; toExclusive: string } | null {
  const from = url.searchParams.get('from') || isoDaysAgo(30);
  const to = url.searchParams.get('to') || isoDaysAgo(0);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return null;
  const toDate = new Date(`${to}T00:00:00Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  return { from, toExclusive: toDate.toISOString().slice(0, 10) };
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

interface EventRow {
  id: string;
  event_name: string;
  event_category: string;
  feature: string;
  route: string | null;
  error_code: string | null;
  outcome: string | null;
  status_code: number | null;
  credit_cost: number | null;
  created_at: string;
  email?: string | null;
  name?: string | null;
}

const EVENT_COLUMNS = `e.id, e.event_name, e.event_category, e.feature, e.route,
  e.error_code, e.outcome, e.status_code, e.credit_cost, e.created_at`;

// GET /api/admin/activity/overview?from=&to=
export async function handleActivityOverview(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const range = parseRange(new URL(request.url));
  if (!range) return json({ error: 'Invalid date range' }, 400);

  const totals = await env.DB.prepare(
    `SELECT
       COUNT(DISTINCT user_id) AS active_users,
       COUNT(*) AS total_events,
       SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS success_events,
       SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked_events,
       SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS error_events,
       COALESCE(SUM(credit_cost), 0) AS credits_used,
       CAST(COALESCE(AVG(duration_ms), 0) AS INTEGER) AS avg_duration_ms
     FROM app_events
     WHERE event_category = 'product' AND created_at >= ? AND created_at < ?`
  ).bind(range.from, range.toExclusive).first();

  const newUsers = await env.DB.prepare(
    `SELECT COUNT(*) AS new_users FROM users WHERE created_at >= ? AND created_at < ?`
  ).bind(range.from, range.toExclusive).first();

  const failures = await env.DB.prepare(
    `SELECT ${EVENT_COLUMNS}, u.email, u.name
       FROM app_events e
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.outcome IN ('blocked', 'error') AND e.created_at >= ? AND e.created_at < ?
      ORDER BY e.created_at DESC
      LIMIT 15`
  ).bind(range.from, range.toExclusive).all<EventRow>();

  return json({
    totals: {
      active_users: Number(totals?.active_users || 0),
      new_users: Number(newUsers?.new_users || 0),
      total_events: Number(totals?.total_events || 0),
      success_events: Number(totals?.success_events || 0),
      blocked_events: Number(totals?.blocked_events || 0),
      error_events: Number(totals?.error_events || 0),
      credits_used: Number(totals?.credits_used || 0),
      avg_duration_ms: Number(totals?.avg_duration_ms || 0),
    },
    recent_failures: failures.results || [],
  });
}

// GET /api/admin/activity/features?from=&to=
export async function handleActivityFeatures(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const range = parseRange(new URL(request.url));
  if (!range) return json({ error: 'Invalid date range' }, 400);

  const features = await env.DB.prepare(
    `SELECT feature,
            COUNT(DISTINCT user_id) AS active_users,
            COUNT(*) AS events,
            COALESCE(SUM(credit_cost), 0) AS credits_used,
            SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked_events,
            SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS error_events
       FROM app_events
      WHERE event_category = 'product' AND created_at >= ? AND created_at < ?
      GROUP BY feature
      ORDER BY events DESC`
  ).bind(range.from, range.toExclusive).all();

  return json({ features: features.results || [] });
}

// GET /api/admin/activity/users?from=&to=&query=&tier=&sort=
export async function handleActivityUsers(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const url = new URL(request.url);
  const range = parseRange(url);
  if (!range) return json({ error: 'Invalid date range' }, 400);

  const query = (url.searchParams.get('query') || '').trim();
  const tier = url.searchParams.get('tier') || 'all';
  const sort = url.searchParams.get('sort') || 'last_active';

  const filters: string[] = [];
  const params: unknown[] = [range.from, range.toExclusive, range.from, range.toExclusive];
  if (query) {
    filters.push('(u.email LIKE ? OR u.name LIKE ?)');
    params.push(`%${query}%`, `%${query}%`);
  }
  if (['free', 'community', 'pro'].includes(tier)) {
    filters.push('u.subscription_tier = ?');
    params.push(tier);
  }

  const orderBy = {
    last_active: 'ua.last_active DESC',
    events: 'ua.total_events DESC',
    credits: 'ua.credits_used DESC',
    created: 'u.created_at DESC',
  }[sort] || 'ua.last_active DESC';

  const users = await env.DB.prepare(
    `WITH ua AS (
       SELECT user_id,
              COUNT(*) AS total_events,
              COUNT(DISTINCT date(created_at)) AS active_days,
              COALESCE(SUM(credit_cost), 0) AS credits_used,
              MAX(created_at) AS last_active
         FROM app_events
        WHERE event_category = 'product' AND created_at >= ? AND created_at < ?
        GROUP BY user_id
     )
     SELECT u.id, u.email, u.name, u.subscription_tier,
            ua.total_events, ua.active_days, ua.credits_used, ua.last_active,
            (SELECT e.feature FROM app_events e
              WHERE e.user_id = u.id AND e.event_category = 'product'
                AND e.created_at >= ? AND e.created_at < ?
              GROUP BY e.feature ORDER BY COUNT(*) DESC LIMIT 1) AS top_feature
       FROM ua
       JOIN users u ON u.id = ua.user_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT 100`
  ).bind(...params).all();

  return json({ users: users.results || [] });
}

// GET /api/admin/activity/funnel?from=&to=
// Activation funnel over users who SIGNED UP in the range: connected a site,
// ran a product tool, came back on a second day. Rates are relative to signups.
export async function handleActivityFunnel(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const range = parseRange(new URL(request.url));
  if (!range) return json({ error: 'Invalid date range' }, 400);

  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS signed_up,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM gsc_properties p WHERE p.user_id = u.id)
                  OR EXISTS (SELECT 1 FROM gsc_connections c WHERE c.user_id = u.id)
                  OR EXISTS (SELECT 1 FROM bwt_connections b WHERE b.user_id = u.id)
            THEN 1 ELSE 0 END) AS connected,
       SUM(CASE WHEN EXISTS (
             SELECT 1 FROM app_events e
              WHERE e.user_id = u.id AND e.event_category = 'product'
                AND e.created_at >= ? AND e.created_at < ?)
            THEN 1 ELSE 0 END) AS ran_tool,
       SUM(CASE WHEN (
             SELECT COUNT(DISTINCT date(e.created_at)) FROM app_events e
              WHERE e.user_id = u.id AND e.event_category = 'product'
                AND e.created_at >= ? AND e.created_at < ?) >= 2
            THEN 1 ELSE 0 END) AS returned
     FROM users u
     WHERE u.created_at >= ? AND u.created_at < ?`
  ).bind(
    range.from, range.toExclusive,
    range.from, range.toExclusive,
    range.from, range.toExclusive,
  ).first();

  const signedUp = Number(row?.signed_up || 0);
  const step = (key: string, label: string, users: number) => ({
    key,
    label,
    users,
    rate: signedUp ? (users / signedUp) * 100 : 0,
  });

  return json({
    steps: [
      step('signed_up', 'Signed up', signedUp),
      step('connected', 'Connected a site', Number(row?.connected || 0)),
      step('ran_tool', 'Ran a tool', Number(row?.ran_tool || 0)),
      step('returned', 'Came back (2+ days)', Number(row?.returned || 0)),
    ],
  });
}

// GET /api/admin/activity/events?from=&to=&limit=
export async function handleActivityEvents(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const url = new URL(request.url);
  const range = parseRange(url);
  if (!range) return json({ error: 'Invalid date range' }, 400);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 60), 1), 200);

  const events = await env.DB.prepare(
    `SELECT ${EVENT_COLUMNS}, u.email, u.name
       FROM app_events e
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.created_at >= ? AND e.created_at < ?
      ORDER BY e.created_at DESC
      LIMIT ?`
  ).bind(range.from, range.toExclusive, limit).all<EventRow>();

  return json({ events: events.results || [] });
}

// GET /api/admin/activity/users/:id?from=&to=
export async function handleActivityUserDetail(request: Request, env: Env, user: AuthUser, userId: string): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const range = parseRange(new URL(request.url));
  if (!range) return json({ error: 'Invalid date range' }, 400);

  const subject = await env.DB.prepare(
    `SELECT id, email, name, subscription_tier, is_admin, is_community_member, created_at
       FROM users WHERE id = ?`
  ).bind(userId).first();
  if (!subject) return json({ error: 'User not found' }, 404);

  const summary = await env.DB.prepare(
    `SELECT COUNT(*) AS total_events,
            COUNT(DISTINCT date(created_at)) AS active_days,
            COALESCE(SUM(credit_cost), 0) AS credits_used,
            SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked_events,
            SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS error_events
       FROM app_events
      WHERE user_id = ? AND event_category = 'product' AND created_at >= ? AND created_at < ?`
  ).bind(userId, range.from, range.toExclusive).first();

  const features = await env.DB.prepare(
    `SELECT feature, COUNT(*) AS events
       FROM app_events
      WHERE user_id = ? AND event_category = 'product' AND created_at >= ? AND created_at < ?
      GROUP BY feature ORDER BY events DESC`
  ).bind(userId, range.from, range.toExclusive).all();

  const events = await env.DB.prepare(
    `SELECT ${EVENT_COLUMNS}
       FROM app_events e
      WHERE e.user_id = ? AND e.created_at >= ? AND e.created_at < ?
      ORDER BY e.created_at DESC
      LIMIT 50`
  ).bind(userId, range.from, range.toExclusive).all<EventRow>();

  return json({
    user: subject,
    summary: summary || {},
    features: features.results || [],
    events: events.results || [],
  });
}

// POST /api/admin/activity/summary  { from, to }
// Sends AGGREGATE COUNTS ONLY (no emails, no per-user rows) to the
// env-configured LLM and returns a short product-analytics readout. Falls
// back to a deterministic local summary when no provider is reachable.
export async function handleActivitySummary(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user)) return forbidden();
  const body = await request.json().catch(() => ({})) as { from?: string; to?: string };
  const from = body.from && DATE_RE.test(body.from) ? body.from : isoDaysAgo(30);
  const to = body.to && DATE_RE.test(body.to) ? body.to : isoDaysAgo(0);
  const url = new URL(request.url);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  const range = parseRange(url)!;

  const [totals, features] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(DISTINCT user_id) AS active_users, COUNT(*) AS total_events,
              SUM(CASE WHEN outcome = 'blocked' THEN 1 ELSE 0 END) AS blocked_events,
              SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS error_events,
              COALESCE(SUM(credit_cost), 0) AS credits_used
         FROM app_events
        WHERE event_category = 'product' AND created_at >= ? AND created_at < ?`
    ).bind(range.from, range.toExclusive).first(),
    env.DB.prepare(
      `SELECT feature, COUNT(DISTINCT user_id) AS active_users, COUNT(*) AS events,
              SUM(CASE WHEN outcome IN ('blocked','error') THEN 1 ELSE 0 END) AS failures
         FROM app_events
        WHERE event_category = 'product' AND created_at >= ? AND created_at < ?
        GROUP BY feature ORDER BY events DESC`
    ).bind(range.from, range.toExclusive).all(),
  ]);

  const featureLines = (features.results || [])
    .map((f: Record<string, unknown>) => `- ${f.feature}: ${f.events} events, ${f.active_users} users, ${f.failures} failures`)
    .join('\n');
  const aggregates =
    `Range: ${from} to ${to}\n` +
    `Active users: ${totals?.active_users || 0}\n` +
    `Total product events: ${totals?.total_events || 0}\n` +
    `Blocked: ${totals?.blocked_events || 0}, Errors: ${totals?.error_events || 0}\n` +
    `Credits used: ${totals?.credits_used || 0}\n` +
    `Per-feature:\n${featureLines || '- none'}`;

  const generatedAt = new Date().toISOString();
  try {
    const provider = getLLMProvider(env);
    const result = await provider.chatComplete([
      {
        role: 'system',
        content:
          'You are a product analyst for an SEO SaaS. You receive aggregate usage counts only. ' +
          'Write a short markdown readout (max ~200 words): 1) headline usage trend, 2) the tools ' +
          'that matter most, 3) friction (blocked/error hotspots), 4) one or two concrete decisions ' +
          'the founder should consider. Do not invent data that is not in the aggregates. Never use em dashes.',
      },
      { role: 'user', content: aggregates },
    ], env, undefined, 800);

    return json({
      summary: result.text,
      generated_at: generatedAt,
      usage: result.usage,
      model_source: `${env.LLM_PROVIDER || 'openai'}:${env.LLM_MODEL || 'default'}`,
      fallback_reason: null,
    });
  } catch (err) {
    // Provider unreachable or misconfigured: return a deterministic local
    // readout instead of failing the dashboard.
    const top = (features.results || [])[0] as Record<string, unknown> | undefined;
    const summary =
      `**Usage readout (local fallback)**\n\n` +
      `${totals?.active_users || 0} active users generated ${totals?.total_events || 0} product events ` +
      `between ${from} and ${to}. ` +
      (top ? `The most used tool was ${top.feature} (${top.events} events by ${top.active_users} users). ` : '') +
      `${totals?.blocked_events || 0} requests were blocked and ${totals?.error_events || 0} errored.`;
    return json({
      summary,
      generated_at: generatedAt,
      usage: { input_tokens: 0, output_tokens: 0 },
      model_source: 'local-fallback',
      fallback_reason: err instanceof Error ? err.message : 'LLM provider unavailable',
    });
  }
}
