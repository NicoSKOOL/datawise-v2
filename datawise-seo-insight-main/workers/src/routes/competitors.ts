import type { Env } from '../index';
import { dataforseoRequest } from '../dataforseo/client';

// POST /api/competitors/ranked-keywords
export async function handleRankedKeywords(request: Request, env: Env): Promise<Response> {
  const { target, location_code = 2840, language_code = 'en', limit = 100 } = await request.json() as any;
  if (!target) return new Response(JSON.stringify({ error: 'Target domain is required' }), { status: 400 });

  const data = await dataforseoRequest(env, '/dataforseo_labs/google/ranked_keywords/live', [{
    target,
    location_code,
    language_code,
    limit,
  }]);

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
      dataforseoRequest(env, '/dataforseo_labs/google/domain_rank_overview/live', [{
        target: t,
        location_code,
        language_code,
      }])
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
    dataforseoRequest(env, '/dataforseo_labs/google/ranked_keywords/live', [{
      target: my_domain, location_code, language_code, limit: 1000,
    }]),
    dataforseoRequest(env, '/dataforseo_labs/google/ranked_keywords/live', [{
      target: competitor_domain, location_code, language_code, limit: 1000,
    }]),
  ]);

  const myKeywords = new Map<string, any>();
  const compKeywords = new Map<string, any>();

  const processItems = (items: any[], map: Map<string, any>) => {
    for (const item of items || []) {
      const kw = item.keyword_data?.keyword;
      if (kw) {
        map.set(kw, {
          keyword: kw,
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

  const data = await dataforseoRequest(env, '/dataforseo_labs/google/bulk_traffic_estimation/live', [{
    targets,
    location_code,
    language_code,
  }]);

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/competitors/domains
export async function handleCompetitorsDomain(request: Request, env: Env): Promise<Response> {
  const { target, location_code = 2840, language_code = 'en' } = await request.json() as any;
  if (!target) return new Response(JSON.stringify({ error: 'Target domain is required' }), { status: 400 });

  const data = await dataforseoRequest(env, '/dataforseo_labs/google/competitors_domain/live', [{
    target,
    location_code,
    language_code,
  }]);

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
