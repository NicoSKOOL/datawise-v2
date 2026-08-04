import type { Env } from '../index';
import { dataforseoRequestCached } from '../dataforseo/client';
import { getLLMProvider, type ChatMessage, type UserLLMConfig } from '../llm/provider';
import { chatCompleteEscalating } from '../llm/length-escalation';

// Model for the gap-analysis strategic write-up, billed to the user's own
// OpenRouter key (see resolveGapAnalysisKey). Cheap "speed pick" from the
// approved catalog ($0.14/$0.28 per M tokens); the output is short prose so a
// call costs them a fraction of a cent. Replaces the old Supabase function's
// google/gemini-2.5-flash on the (removed) Lovable gateway.
const GAP_ANALYSIS_AI_MODEL = 'deepseek/deepseek-v4-flash';

// Competitor / domain rankings drift slower than search volume — 6h KV cache.
const COMPETITORS_TTL_SECONDS = 21600;

function normalizeGapKeyword(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// DFS Labs domain endpoints reject any target that is not a bare domain:
// protocol, www., a trailing slash, or a path all produce a per-task error
// (which the merged responses used to swallow, so the SPA could only say
// "no data found" — bug fe933c66, users pasting URLs from the address bar).
// Every handler that takes a domain target normalizes through this first.
// Exported for tests. Backlinks routes intentionally do NOT use this: they
// support page-URL targets.
export function sanitizeDomainTarget(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

// POST /api/competitors/ranked-keywords
export async function handleRankedKeywords(request: Request, env: Env): Promise<Response> {
  const { target, location_code = 2840, language_code = 'en', limit = 100 } = await request.json() as any;
  const cleanTarget = sanitizeDomainTarget(String(target || ''));
  if (!cleanTarget) return new Response(JSON.stringify({ error: 'Target domain is required' }), { status: 400 });

  const data = await dataforseoRequestCached(env, '/dataforseo_labs/google/ranked_keywords/live', [{
    target: cleanTarget,
    location_code,
    language_code,
    limit,
  }], { ttlSeconds: COMPETITORS_TTL_SECONDS });

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/competitors/domain-rank
export async function handleDomainRankOverview(request: Request, env: Env): Promise<Response> {
  const { target, targets, location_code = 2840, language_code = 'en' } = await request.json() as any;

  // Support single domain or multiple. Sanitize in place (keeping array
  // length and order) because the SPA maps returned tasks back to its
  // inputs by index.
  const domainTargets = ((targets || [target]) as unknown[]).map((t) => sanitizeDomainTarget(String(t ?? '')));
  if (!domainTargets.length || domainTargets.every((t: string) => !t)) {
    return new Response(JSON.stringify({ error: 'Target domain(s) required' }), { status: 400 });
  }

  // Send individual requests per domain to avoid batch API quirks
  const results = await Promise.all(
    domainTargets.map((t: string) =>
      dataforseoRequestCached(env, '/dataforseo_labs/google/domain_rank_overview/live', [{
        target: t,
        location_code,
        language_code,
      }], { ttlSeconds: COMPETITORS_TTL_SECONDS })
    )
  );

  // Merge into a single response structure with all tasks
  const merged = {
    ...results[0],
    tasks_count: results.length,
    tasks: results.map((r: any) => r.tasks?.[0]).filter(Boolean),
  };

  return new Response(JSON.stringify(merged), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/competitors/gap-analysis
export async function handleKeywordGapAnalysis(request: Request, env: Env): Promise<Response> {
  const { my_domain, competitor_domain, location_code = 2840, language_code = 'en' } = await request.json() as any;
  const cleanMyDomain = sanitizeDomainTarget(String(my_domain || ''));
  const cleanCompetitorDomain = sanitizeDomainTarget(String(competitor_domain || ''));
  if (!cleanMyDomain || !cleanCompetitorDomain) {
    return new Response(JSON.stringify({ error: 'Both domains are required' }), { status: 400 });
  }

  // Get ranked keywords for both domains in parallel
  const [myData, compData] = await Promise.all([
    dataforseoRequestCached(env, '/dataforseo_labs/google/ranked_keywords/live', [{
      target: cleanMyDomain, location_code, language_code, limit: 1000,
    }], { ttlSeconds: COMPETITORS_TTL_SECONDS }),
    dataforseoRequestCached(env, '/dataforseo_labs/google/ranked_keywords/live', [{
      target: cleanCompetitorDomain, location_code, language_code, limit: 1000,
    }], { ttlSeconds: COMPETITORS_TTL_SECONDS }),
  ]);

  const myKeywords = new Map<string, any>();
  const compKeywords = new Map<string, any>();

  const processItems = (items: any[], map: Map<string, any>) => {
    for (const item of items || []) {
      const kw = item.keyword_data?.keyword;
      if (kw) {
        const normalized = normalizeGapKeyword(kw);
        if (!normalized) continue;
        map.set(normalized, {
          keyword: kw.trim(),
          search_volume: item.keyword_data?.keyword_info?.search_volume || 0,
          cpc: item.keyword_data?.keyword_info?.cpc || 0,
          competition: item.keyword_data?.keyword_info?.competition || 0,
          position: item.ranked_serp_element?.serp_item?.rank_group || null,
        });
      }
    }
  };

  processItems(myData?.tasks?.[0]?.result?.[0]?.items, myKeywords);
  processItems(compData?.tasks?.[0]?.result?.[0]?.items, compKeywords);

  const gaps: any[] = [];
  const both_ranking: any[] = [];
  const advantages: any[] = [];

  // Gaps: competitor ranks, I don't
  for (const [kw, data] of compKeywords) {
    if (!myKeywords.has(kw)) {
      gaps.push({ ...data, my_position: null, competitor_position: data.position });
    }
  }

  // Both ranking + advantages
  for (const [kw, data] of myKeywords) {
    if (compKeywords.has(kw)) {
      both_ranking.push({ ...data, my_position: data.position, competitor_position: compKeywords.get(kw).position });
    } else {
      advantages.push({ ...data, my_position: data.position, competitor_position: null });
    }
  }

  const response = {
    my_domain,
    competitor_domain,
    metrics: {
      total_gaps: gaps.length,
      total_shared: both_ranking.length,
      total_advantages: advantages.length,
    },
    gaps: gaps.sort((a, b) => b.search_volume - a.search_volume).slice(0, 500),
    both_ranking: both_ranking.sort((a, b) => b.search_volume - a.search_volume).slice(0, 500),
    advantages: advantages.sort((a, b) => b.search_volume - a.search_volume).slice(0, 500),
  };

  return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/competitors/traffic
export async function handleBulkTrafficEstimation(request: Request, env: Env): Promise<Response> {
  const { targets, location_code = 2840, language_code = 'en' } = await request.json() as any;
  const cleanTargets = ((targets || []) as unknown[]).map((t) => sanitizeDomainTarget(String(t ?? ''))).filter(Boolean);
  if (!cleanTargets.length) return new Response(JSON.stringify({ error: 'Targets array is required' }), { status: 400 });

  const data = await dataforseoRequestCached(env, '/dataforseo_labs/google/bulk_traffic_estimation/live', [{
    targets: cleanTargets,
    location_code,
    language_code,
  }], { ttlSeconds: COMPETITORS_TTL_SECONDS });

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// Monthly history never changes intraday, so cache a full day instead of the
// usual 6h to halve repeat DFS spend on the same domains.
const TRAFFIC_HISTORY_TTL_SECONDS = 86400;
const TRAFFIC_HISTORY_MAX_TARGETS = 10;

interface DfsMonthlyMetric {
  year: number;
  month: number;
  etv: number | null;
  count: number | null;
}

export interface TrafficHistoryMonth {
  date: string; // YYYY-MM-01
  organic_etv: number;
  organic_count: number;
  paid_etv: number;
  paid_count: number;
}

// Flatten a DFS historical_bulk_traffic_estimation item list into one sorted
// monthly series per target. metrics.organic / metrics.paid are arrays of
// { year, month, etv, count }; months missing from one type still appear with
// zeros so every series has the same x-axis.
export function buildTrafficHistorySeries(
  items: Array<{ target?: string; metrics?: { organic?: DfsMonthlyMetric[]; paid?: DfsMonthlyMetric[] } }>,
): Array<{ target: string; months: TrafficHistoryMonth[] }> {
  return (items || []).map((item) => {
    const byDate = new Map<string, TrafficHistoryMonth>();
    const fold = (entries: DfsMonthlyMetric[] | undefined, kind: 'organic' | 'paid') => {
      for (const e of entries || []) {
        if (!e || typeof e.year !== 'number' || typeof e.month !== 'number') continue;
        const date = `${e.year}-${String(e.month).padStart(2, '0')}-01`;
        const row = byDate.get(date) ?? { date, organic_etv: 0, organic_count: 0, paid_etv: 0, paid_count: 0 };
        row[`${kind}_etv`] = Math.round(e.etv || 0);
        row[`${kind}_count`] = e.count || 0;
        byDate.set(date, row);
      }
    };
    fold(item.metrics?.organic, 'organic');
    fold(item.metrics?.paid, 'paid');
    return {
      target: item.target || '',
      months: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  });
}

// POST /api/competitors/traffic-history
// Historical estimated traffic (Ahrefs-style trend) for up to 10 domains.
// Omitting location/language asks DFS for worldwide traffic, which is the
// right default when researching a domain whose market you don't know.
export async function handleTrafficHistory(request: Request, env: Env): Promise<Response> {
  const { targets, location_code, language_code, months = 12 } = await request.json() as any;
  if (!Array.isArray(targets) || targets.length === 0) {
    return new Response(JSON.stringify({ error: 'Targets array is required' }), { status: 400 });
  }

  const cleanTargets = [...new Set(targets.map((t: unknown) => sanitizeDomainTarget(String(t))).filter(Boolean))]
    .slice(0, TRAFFIC_HISTORY_MAX_TARGETS);
  if (cleanTargets.length === 0) {
    return new Response(JSON.stringify({ error: 'No valid domains in targets' }), { status: 400 });
  }

  const monthsBack = Math.min(Math.max(Number(months) || 12, 1), 24);
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsBack - 1), 1));
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo = now.toISOString().slice(0, 10);

  const data = await dataforseoRequestCached(env, '/dataforseo_labs/google/historical_bulk_traffic_estimation/live', [{
    targets: cleanTargets,
    date_from: dateFrom,
    date_to: dateTo,
    item_types: ['organic', 'paid'],
    ...(location_code ? { location_code, language_code: language_code || 'en' } : {}),
  }], { ttlSeconds: TRAFFIC_HISTORY_TTL_SECONDS });

  const items = (data as any)?.tasks?.[0]?.result?.[0]?.items || [];
  return new Response(JSON.stringify({
    date_from: dateFrom,
    date_to: dateTo,
    targets: buildTrafficHistorySeries(items),
  }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/competitors/domains
export async function handleCompetitorsDomain(request: Request, env: Env): Promise<Response> {
  const { target, location_code = 2840, language_code = 'en' } = await request.json() as any;
  const cleanTarget = sanitizeDomainTarget(String(target || ''));
  if (!cleanTarget) return new Response(JSON.stringify({ error: 'Target domain is required' }), { status: 400 });

  const data = await dataforseoRequestCached(env, '/dataforseo_labs/google/competitors_domain/live', [{
    target: cleanTarget,
    location_code,
    language_code,
  }], { ttlSeconds: COMPETITORS_TTL_SECONDS });

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// Inputs the frontend AIAnalysisSummary component sends. The gap arrays are
// already computed client-side by the gap-analysis run, so we trust them here
// rather than re-running a DataForSEO call.
interface GapAnalysisAIInput {
  my_domain: string;
  competitor_domain: string;
  both_ranking?: any[];
  gaps?: any[];
  advantages?: any[];
  // Optional caller key, used only when the platform key is unset. Every other
  // AI route already accepts this; this one did not, which is why it had no
  // fallback when OPENROUTER_API_KEY turned out to be missing.
  llm_config?: UserLLMConfig;
}

export type GapAnalysisKey =
  | { ok: true; apiKey: string }
  | { ok: false; reason: 'no_key' | 'wrong_provider' };

/**
 * Resolve the OpenRouter key that pays for this analysis: the caller's own.
 *
 * This is deliberately BYOK-only. It must NOT fall back to
 * env.OPENROUTER_API_KEY: that key exists for the content-writer's default
 * routing, and letting this route reach it would silently move the inference
 * bill onto the platform the moment the secret is set. The platform already
 * absorbs the DataForSEO cost of the gap analysis itself; the LLM write-up on
 * top of it is the user's spend, the same as review themes and meta rewrite.
 */
export function resolveGapAnalysisKey(
  callerConfig: UserLLMConfig | undefined
): GapAnalysisKey {
  const callerKey = callerConfig?.api_key?.trim();
  if (!callerKey) return { ok: false, reason: 'no_key' };
  // GAP_ANALYSIS_AI_MODEL is an OpenRouter model id, so only an OpenRouter key
  // can serve it. Anything else would surface as an opaque upstream 401.
  if (callerConfig?.provider !== 'openrouter') return { ok: false, reason: 'wrong_provider' };

  return { ok: true, apiKey: callerKey };
}

// Pure, deterministic prompt builder. Mirrors the original Supabase
// keyword-analysis-ai prompt so the strategic write-up UX is unchanged. Caps
// each list so prompt size (and token cost) stays bounded regardless of how
// many keywords the client sends.
export function buildGapAnalysisPrompt(input: GapAnalysisAIInput): string {
  const { my_domain, competitor_domain } = input;
  const both_ranking = input.both_ranking || [];
  const gaps = input.gaps || [];
  const advantages = input.advantages || [];

  const gapLines = gaps.slice(0, 10).map((k: any, i: number) =>
    `${i + 1}. "${k.keyword}" - ${(k.search_volume ?? 0).toLocaleString()} monthly searches, $${(k.cpc ?? 0).toFixed(2)} CPC, ${Math.round((k.competition ?? 0) * 100)}% competition`
  ).join('\n') || 'No gaps found';

  const sharedLines = both_ranking.slice(0, 5).map((k: any, i: number) =>
    `${i + 1}. "${k.keyword}" - You: #${k.my_position ?? '?'}, Competitor: #${k.competitor_position ?? '?'}, ${(k.search_volume ?? 0).toLocaleString()} searches`
  ).join('\n') || 'No shared keywords';

  const advantageLines = advantages.slice(0, 5).map((k: any, i: number) =>
    `${i + 1}. "${k.keyword}" - Position #${k.my_position ?? '?'}, ${(k.search_volume ?? 0).toLocaleString()} searches`
  ).join('\n') || 'No unique advantages found';

  return `You are an expert SEO strategist analyzing keyword gap data for competitive analysis.

**Your Domain:** ${my_domain}
**Competitor:** ${competitor_domain}

**Data Summary:**
- Shared Keywords (both ranking): ${both_ranking.length}
- Keyword Gaps (competitor has, you don't): ${gaps.length}
- Your Advantages (you have, competitor doesn't): ${advantages.length}

**Top Keyword Gaps (Opportunities):**
${gapLines}

**Top Shared Keywords (Competitive Overlap):**
${sharedLines}

**Your Unique Advantages:**
${advantageLines}

Please provide a strategic SEO analysis with these sections:

## 🎯 Key Opportunities
Identify the top 3-5 most actionable keyword opportunities from the gaps data. Focus on keywords with good search volume, manageable competition, and clear commercial intent.

## 📊 Competitive Analysis
Compare the competitive landscape. What are the competitor's strengths? Where are your advantages? What does the overlap tell us about market positioning?

## 🚀 Priority Recommendations
Which keywords should be targeted first and why? Consider search volume, competition level, relevance, and existing rankings.

## 💡 Market Insights
What do the search volumes, CPC values, and competition levels tell us about this market? Are there trends or patterns worth noting?

## ✅ Action Items
Provide 3-5 specific, actionable next steps to capitalize on these insights.

Keep the analysis strategic, actionable, and focused on business impact.`;
}

// POST /api/competitors/gap-analysis-ai
// Generates a strategic SEO write-up from gap-analysis data using the Worker's
// server-side LLM (platform-paid OpenRouter). Replaces the decommissioned
// Supabase keyword-analysis-ai edge function, whose Lovable gateway key was
// removed during the Cloudflare migration (bug bfe5d249). Returns
// { analysis: <markdown> } so the existing frontend renders it unchanged.
export async function handleGapAnalysisAI(request: Request, env: Env): Promise<Response> {
  let input: GapAnalysisAIInput;
  try {
    input = await request.json() as GapAnalysisAIInput;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!input.my_domain || !input.competitor_domain) {
    return new Response(JSON.stringify({ error: 'Both domains are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = resolveGapAnalysisKey(input.llm_config);
  if (!key.ok) {
    // 400, not the old 503: the caller did not send a key, which is a request
    // problem they can fix. The old copy said "temporarily unavailable ... try
    // again later", wrong in both halves, since nothing was temporary and
    // retrying never helped. Name the one action the user can actually take.
    return new Response(JSON.stringify({
      error: 'AI analysis needs your OpenRouter API key',
      details: key.reason === 'wrong_provider'
        ? 'This feature runs on OpenRouter. Add an OpenRouter key (sk-or-...) in Settings.'
        : 'Add your OpenRouter API key in Settings, then try again.',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are an expert SEO strategist providing actionable insights based on keyword gap analysis data.' },
    { role: 'user', content: buildGapAnalysisPrompt(input) },
  ];

  // Always the caller's key: passing api_key explicitly stops the provider
  // falling through to env.OPENROUTER_API_KEY (provider.ts:337). The model is
  // pinned so the write-up reads the same for everyone.
  const config = {
    provider: 'openrouter' as const,
    model: GAP_ANALYSIS_AI_MODEL,
    api_key: key.apiKey,
  };

  let analysis: string;
  try {
    // 2000 could truncate the markdown analysis on reasoning-mode outputs;
    // escalate the budget on finish_reason=length. See llm/length-escalation.ts.
    const result = await chatCompleteEscalating(getLLMProvider(env, config), messages, env, config, {
      startTokens: 4000, ceilingTokens: 8000, label: 'gap-analysis-ai',
    });
    analysis = (result.text || '').trim();
  } catch (err) {
    // Never leak platform billing/provider details (e.g. "your OpenRouter
    // account is out of credits") to the end user — they can't act on it.
    console.error('[gap-analysis-ai] LLM error:', err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({
      error: 'AI analysis is temporarily unavailable',
      details: 'The AI service could not complete this request. Please try again in a moment.',
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  if (!analysis) {
    return new Response(JSON.stringify({
      error: 'AI analysis is temporarily unavailable',
      details: 'The AI service returned an empty response. Please try again.',
    }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ analysis }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
