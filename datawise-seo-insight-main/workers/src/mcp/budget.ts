import type { McpEnv, McpIdentity } from './env';

export const DEFAULT_USER_CAP_CENTS = 400;
export const DEFAULT_GLOBAL_CAP_CENTS = 10000;
export const RATE_LIMIT_PER_MINUTE = 30;
export const GLOBAL_USER_ID = '_global';

// DataForSEO live prices, 2026-09-07 (spec section 5).
const LABS_TASK = 0.012;
const LABS_ITEM = 0.00012;
const TRAFFIC_TASK = 0.12;
const BACKLINKS_REQUEST = 0.024;
const BACKLINKS_ROW = 0.000036;
const LLM_REQUEST = 0.1;
const LLM_ROW = 0.001;
const GBP_INFO = 0.0054;
const REVIEWS_PER_10 = 0.0015;
const SERP_TASK = 0.003;
const UNKNOWN_TOOL_ESTIMATE = 0.05;

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function estimateCostUsd(tool: string, args: Record<string, unknown>): number {
  const limit = num(args.limit, 25);
  switch (tool) {
    case 'datawise_keyword_research': {
      const one = LABS_TASK + LABS_ITEM * limit;
      return (args.mode ?? 'related') === 'related' ? 2 * one : one;
    }
    case 'datawise_keyword_metrics': {
      const n = Array.isArray(args.keywords) ? args.keywords.length : 1;
      return 2 * (LABS_TASK + LABS_ITEM * n);
    }
    case 'datawise_domain_overview':
      // rank overview (Labs task) + bulk traffic estimation ($0.12 task + $0.0012 per
      // domain) + backlinks summary, rounded up to the spec's $0.16 figure.
      return 0.16;
    case 'datawise_ranked_keywords': {
      const offset = num(args.offset, 0);
      return LABS_TASK + LABS_ITEM * (limit + offset);
    }
    case 'datawise_competitors':
      return LABS_TASK + LABS_ITEM * limit;
    case 'datawise_keyword_gap':
      return 2 * (LABS_TASK + LABS_ITEM * 300);
    case 'datawise_backlinks':
      return (args.view ?? 'summary') === 'summary'
        ? BACKLINKS_REQUEST + BACKLINKS_ROW * 10
        : BACKLINKS_REQUEST + BACKLINKS_ROW * limit;
    case 'datawise_ai_mentions': {
      const n = Array.isArray(args.domains) ? Math.max(1, args.domains.length) : 1;
      return LLM_REQUEST + LLM_ROW * 10 * n;
    }
    case 'datawise_local_reviews':
      return GBP_INFO + REVIEWS_PER_10 * (num(args.limit, 20) / 10);
    case 'datawise_people_also_ask': {
      // routes/ai.ts handlePeopleAlsoAsk caps SERP calls at 1 / 10 / 25 by depth.
      const depth = num(args.depth, 2);
      return SERP_TASK * (depth <= 1 ? 1 : depth === 2 ? 10 : 25);
    }
    case 'datawise_gbp_audit':
      // Stored data plus one my_business_info lookup, KV-cached for a day.
      return GBP_INFO;
    case 'datawise_rank_tracking':
    case 'datawise_ai_visibility':
    case 'datawise_search_console':
      return 0;
    default:
      return UNKNOWN_TOOL_ESTIMATE;
  }
}

async function readCents(env: McpEnv, key: string, fallback: number): Promise<number> {
  const raw = await env.KV.get(key);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function readCaps(env: McpEnv): Promise<{ userCapUsd: number; globalCapUsd: number }> {
  const [user, global] = await Promise.all([
    readCents(env, 'mcp-user-cap-cents', DEFAULT_USER_CAP_CENTS),
    readCents(env, 'mcp-global-cap-cents', DEFAULT_GLOBAL_CAP_CENTS),
  ]);
  return { userCapUsd: user / 100, globalCapUsd: global / 100 };
}

export async function readSpent(env: McpEnv, userId: string, day: string = utcDay()): Promise<{ costUsd: number; calls: number }> {
  const row = await env.DB.prepare(
    'SELECT cost_usd, calls FROM mcp_usage_daily WHERE user_id = ? AND day = ?'
  ).bind(userId, day).first<{ cost_usd: number; calls: number }>();
  return { costUsd: row?.cost_usd ?? 0, calls: row?.calls ?? 0 };
}

export type BudgetDecision =
  | { ok: true; spentUsd: number; capUsd: number }
  | { ok: false; reason: 'user_cap' | 'global_cap'; spentUsd: number; capUsd: number };

export async function checkBudget(env: McpEnv, identity: McpIdentity, estimateUsd: number): Promise<BudgetDecision> {
  const day = utcDay();
  const [caps, user, global] = await Promise.all([
    readCaps(env),
    readSpent(env, identity.userId, day),
    readSpent(env, GLOBAL_USER_ID, day),
  ]);

  if (global.costUsd + estimateUsd > caps.globalCapUsd) {
    return { ok: false, reason: 'global_cap', spentUsd: global.costUsd, capUsd: caps.globalCapUsd };
  }
  if (!identity.isAdmin && user.costUsd + estimateUsd > caps.userCapUsd) {
    return { ok: false, reason: 'user_cap', spentUsd: user.costUsd, capUsd: caps.userCapUsd };
  }
  return { ok: true, spentUsd: user.costUsd, capUsd: caps.userCapUsd };
}

// Non-atomic KV counter: two concurrent calls may both see 29 and both pass.
// Acceptable; the dollar budget is the real guard. KV also allows only one
// write per second per key, so parallel tool calls in the same second can
// make the put reject; fail open rather than surface an internal error to
// the model, since the dollar budget is the real guard either way.
export async function checkRateLimit(env: McpEnv, userId: string, now: Date = new Date()): Promise<boolean> {
  const minute = now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  const key = `mcprate:${userId}:${minute}`;
  try {
    const current = Number((await env.KV.get(key)) ?? '0');
    if (current >= RATE_LIMIT_PER_MINUTE) return false;
    await env.KV.put(key, String(current + 1), { expirationTtl: 120 });
    return true;
  } catch (err) {
    console.error('[mcp] rate limit KV error, failing open:', err);
    return true;
  }
}

export interface UsageEntry {
  userId: string;
  tool: string;
  costUsd: number;
  cached: boolean;
  ok: boolean;
  durationMs: number;
  authKind: string;
  clientName: string;
}

const UPSERT = `INSERT INTO mcp_usage_daily (user_id, day, cost_usd, calls) VALUES (?, ?, ?, 1)
  ON CONFLICT(user_id, day) DO UPDATE SET cost_usd = cost_usd + excluded.cost_usd, calls = calls + 1`;

export async function recordUsage(env: McpEnv, entry: UsageEntry): Promise<void> {
  const day = utcDay();
  await env.DB.batch([
    env.DB.prepare(UPSERT).bind(entry.userId, day, entry.costUsd),
    env.DB.prepare(UPSERT).bind(GLOBAL_USER_ID, day, entry.costUsd),
    env.DB.prepare(
      `INSERT INTO mcp_calls (user_id, tool, cost_usd, cached, ok, duration_ms, auth_kind, client_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(entry.userId, entry.tool, entry.costUsd, entry.cached ? 1 : 0, entry.ok ? 1 : 0, entry.durationMs, entry.authKind, entry.clientName),
  ]);
}

export function budgetMessage(d: Extract<BudgetDecision, { ok: false }>): string {
  const cap = `$${d.capUsd.toFixed(2)}`;
  if (d.reason === 'global_cap') {
    return `The DataWise MCP server reached its daily DataForSEO budget for all members. It resets at 00:00 UTC. Tools that read stored data (rank tracking, AI visibility, Search Console) still work.`;
  }
  return `Daily MCP budget reached (${cap}). Resets at 00:00 UTC, no rollover. Rank tracking, AI visibility, and Search Console tools still work because they use stored data.`;
}
