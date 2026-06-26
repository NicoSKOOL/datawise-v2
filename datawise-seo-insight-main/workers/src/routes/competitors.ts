import type { Env } from '../index';
import { dataforseoRequestCached } from '../dataforseo/client';
import { getLLMProvider, type ChatMessage, type UserLLMConfig } from '../llm/provider';

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

// POST /api/competitors/gap-analysis-ai
// Generates a strategic SEO analysis (markdown) from already-computed
// keyword-gap data. BYOK, same pattern as content-tools. This replaces the
// legacy Supabase `keyword-analysis-ai` edge function that died in the
// Cloudflare migration: the frontend kept calling supabase.functions.invoke()
// against a dead backend, so "Generate AI Analysis" always errored
// (bug bfe5d249, "error getting ai insights").
export async function handleGapAnalysisAI(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as {
    my_domain?: string;
    competitor_domain?: string;
    both_ranking?: any[];
    gaps?: any[];
    advantages?: any[];
    llm_config?: UserLLMConfig;
  };

  if (!body.llm_config?.api_key) {
    return new Response(
      JSON.stringify({ error: 'Add your OpenRouter API key in Settings to generate AI insights.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const myDomain = body.my_domain || 'your site';
  const competitorDomain = body.competitor_domain || 'the competitor';
  const gaps = Array.isArray(body.gaps) ? body.gaps : [];
  const bothRanking = Array.isArray(body.both_ranking) ? body.both_ranking : [];
  const advantages = Array.isArray(body.advantages) ? body.advantages : [];
  const num = (v: any) => (typeof v === 'number' ? v.toLocaleString() : '0');

  const prompt = `You are an expert SEO strategist analyzing keyword gap data for competitive analysis.

**Your Domain:** ${myDomain}
**Competitor:** ${competitorDomain}

**Data Summary:**
- Shared Keywords (both ranking): ${bothRanking.length}
- Keyword Gaps (competitor has, you don't): ${gaps.length}
- Your Advantages (you have, competitor doesn't): ${advantages.length}

**Top Keyword Gaps (Opportunities):**
${gaps.slice(0, 10).map((k: any, i: number) =>
  `${i + 1}. "${k.keyword}" - ${num(k.search_volume)} monthly searches, $${(k.cpc || 0).toFixed(2)} CPC, ${Math.round((k.competition || 0) * 100)}% competition`
).join('\n') || 'No gaps found'}

**Top Shared Keywords (Competitive Overlap):**
${bothRanking.slice(0, 5).map((k: any, i: number) =>
  `${i + 1}. "${k.keyword}" - You: #${k.my_position || '?'}, Competitor: #${k.competitor_position || '?'}, ${num(k.search_volume)} searches`
).join('\n') || 'No shared keywords'}

**Your Unique Advantages:**
${advantages.slice(0, 5).map((k: any, i: number) =>
  `${i + 1}. "${k.keyword}" - Position #${k.my_position || '?'}, ${num(k.search_volume)} searches`
).join('\n') || 'No unique advantages found'}

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

  const messages: ChatMessage[] = [
    { role: 'system', content: 'You are an expert SEO strategist providing actionable insights based on keyword gap analysis data.' },
    { role: 'user', content: prompt },
  ];

  const provider = getLLMProvider(env, body.llm_config);
  try {
    const result = await provider.chatComplete(messages, env, body.llm_config, 2048);
    const analysis = (result.text || '').trim();
    if (!analysis) {
      return new Response(
        JSON.stringify({ error: 'The AI returned an empty analysis. Try again in a moment.' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ analysis }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // The provider throws a descriptive error (bad key 401, out of credits 402,
    // bad model 404, rate limit). Surface it verbatim; the frontend toasts it.
    const message = err instanceof Error
      ? err.message
      : 'The AI provider could not generate the analysis. Check your API key and credits in Settings.';
    console.error('Gap analysis AI failed:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
}
