import type { Env } from '../index';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const BOT_UA = /bot|crawler|spider|preview|headless|axios|fetch|wget|curl|monitor|lighthouse/i;
const PER_SESSION_PER_MIN = 60;

// Internal IPs to exclude from analytics (admin's own traffic).
// IPv6 matched by prefix because the host suffix can rotate.
const EXCLUDED_IPV4 = new Set<string>([
  '138.84.34.226',
]);
const EXCLUDED_IPV6_PREFIXES: string[] = [
  '2001:4860:7:1105:',
];

function isExcludedIp(ip: string | null): boolean {
  if (!ip) return false;
  if (EXCLUDED_IPV4.has(ip)) return true;
  const lower = ip.toLowerCase();
  return EXCLUDED_IPV6_PREFIXES.some(prefix => lower.startsWith(prefix));
}

interface PageviewPayload {
  session_id?: string;
  user_id?: string;
  path?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  promo_code?: string;
}

function clamp(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function refHost(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.replace(/^www\./, '').slice(0, 128);
  } catch {
    return null;
  }
}

// POST /api/track/pageview — public, anonymous, beacon-friendly.
// Body is JSON. No auth. Bot UAs short-circuit with 204. Per-session_id rate
// limit via KV at 60/min prevents accidental loops or abuse.
export async function handlePageview(request: Request, env: Env): Promise<Response> {
  const ua = request.headers.get('User-Agent') || '';
  if (BOT_UA.test(ua)) {
    return new Response(null, { status: 204 });
  }

  // Silently drop pageviews from excluded internal IPs (admin's own traffic).
  const clientIp = request.headers.get('cf-connecting-ip');
  if (isExcludedIp(clientIp)) {
    return new Response(null, { status: 204 });
  }

  let body: PageviewPayload;
  try {
    body = await request.json() as PageviewPayload;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const sessionId = clamp(body.session_id, 64);
  const path = clamp(body.path, 512);
  if (!sessionId || !path) {
    return json({ error: 'session_id_and_path_required' }, 400);
  }

  // Rate limit: rolling 60-second window per session_id.
  const minute = Math.floor(Date.now() / 60000);
  const rlKey = `pv_rl:${sessionId}:${minute}`;
  const used = parseInt((await env.KV.get(rlKey)) || '0', 10);
  if (used >= PER_SESSION_PER_MIN) {
    return new Response(null, { status: 204 });
  }
  await env.KV.put(rlKey, String(used + 1), { expirationTtl: 120 });

  const referrer = clamp(body.referrer, 512);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const country = ((request as any).cf?.country as string | undefined) || null;

  await env.DB.prepare(
    `INSERT INTO pageviews
       (session_id, user_id, path, referrer, referrer_host,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, promo_code, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    sessionId,
    clamp(body.user_id, 64),
    path,
    referrer,
    refHost(referrer),
    clamp(body.utm_source, 128),
    clamp(body.utm_medium, 128),
    clamp(body.utm_campaign, 128),
    clamp(body.utm_content, 128),
    clamp(body.utm_term, 128),
    clamp(body.promo_code, 64)?.toUpperCase() ?? null,
    country,
  ).run();

  return new Response(null, { status: 204 });
}

// Daily cron task: prune pageviews older than 90 days. Called from index.ts
// scheduled handler (idempotent — safe to run on every cron tick).
export async function prunePageviews(env: Env): Promise<{ deleted: number }> {
  const result = await env.DB.prepare(
    "DELETE FROM pageviews WHERE created_at < datetime('now', '-90 days')"
  ).run();
  return { deleted: result.meta?.changes ?? 0 };
}
