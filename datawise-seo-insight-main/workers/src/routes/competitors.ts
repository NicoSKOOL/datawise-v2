import type { Env } from '../index';
import { dataforseoRequestCached } from '../dataforseo/client';
import { getLLMProvider, type ChatMessage } from '../llm/provider';

// Server-side, platform-paid model for the gap-analysis strategic write-up.
// Cheap "speed pick" from the approved catalog ($0.14/$0.28 per M tokens); the
// output is short prose so a call costs a fraction of a cent. Replaces the old
// Supabase function's google/gemini-2.5-flash on the (removed) Lovable gateway.
const GAP_ANALYSIS_AI_MODEL = 'deepseek/deepseek-v4-flash';

// Competitor / domain rankings drift slower than search volume — 6h KV cache.
const COMPETITORS_TTL_SECONDS = 21600;

function normalizeGapKeyword(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// POST /api/competitors/ranked-keywords
export async function handleRankedKeywords(request: Request, env: Env): Promise<Response> {
  const { target, location_code = 2840, language_code = 'en', limit = 100 } = await request.json() as any;
  if (!target) return new Response(JSON.stringify({ error: 'Target domain is required' }), { status: 400 });

  const data = await dataforseoRequestCached(env, '/dataforseo_labs/google/ranked_keywords/live', [{
    target,
    location_code,
    language_code,
    limit,
  }], { ttlSeconds: COMPETITORS_TTL_SECONDS });

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/competitors/domain-rank
export async function handleDomainRankOverview(request: Request, env: Env): Promise<Response> {
  const { target, targets, location_code = 2840, language_code = 'en' } = await request.json() as any;

  // Support single domain or multiple
  const domainTargets = targets || [target];
  if (!domainTargets?.length) return new Response(JSON.stringify({ error: 'Target domain(s) required' }), { status: 400 });

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
  if (!my_domain || !competitor_domain) {
    return new Response(JSON.stringify({ error: 'Both domains are required' }), { status: 400 });
  }

  // Get ranked keywords for both domains in parallel
  const [myData, compData] = await Promise.all([
    dataforseoRequestCached(env, '/dataforseo_labs/google/ranked_keywords/live', [{
      target: my_domain, location_code, language_code, limit: 1000,
    }], { ttlSeconds: COMPETITORS_TTL_SECONDS }),
    dataforseoRequestCached(env, '/dataforseo_labs/google/ranked_keywords/live', [{
      target: competitor_domain, location_code, language_code, limit: 1000,
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
  if (!targets?.length) return new Response(JSON.stringify({ error: 'Targets array is required' }), { status: 400 });

  const data = await dataforseoRequestCached(env, '/dataforseo_labs/google/bulk_traffic_estimation/live', [{
    targets,
    location_code,
    language_code,
  }], { ttlSeconds: COMPETITORS_TTL_SECONDS });

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/competitors/domains
export async function handleCompetitorsDomain(request: Request, env: Env): Promise<Response> {
  const { target, location_code = 2840, language_code = 'en' } = await request.json() as any;
  if (!target) return new Response(JSON.stringify({ error: 'Target domain is required' }), { status: 400 });

  const data = await dataforseoRequestCached(env, '/dataforseo_labs/google/competitors_domain/live', [{
    target,
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

  if (!env.OPENROUTER_API_KEY) {
    console.error('[gap-analysis-ai] OPENROUTER_API_KEY not configured');
    return new Response(JSON.stringify({
      error: 'AI analysis is temporarily unavailable',
      details: 'The AI service is not configured. Please try again later.',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are an expert SEO strategist providing actionable insights based on keyword gap analysis data.' },
    { role: 'user', content: buildGapAnalysisPrompt(input) },
  ];

  // Platform-paid: pass provider+model only so the OpenRouter adapter falls
  // back to env.OPENROUTER_API_KEY (no BYOK key required for this feature).
  const config = { provider: 'openrouter' as const, model: GAP_ANALYSIS_AI_MODEL };

  let analysis: string;
  try {
    const result = await getLLMProvider(env, config).chatComplete(messages, env, config, 2000);
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
