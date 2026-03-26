import type { Env } from '../index';
import { dataforseoRequest } from '../dataforseo/client';

// POST /api/keywords/related
export async function handleRelatedKeywords(request: Request, env: Env): Promise<Response> {
  const { keyword, location_code = 2840, language_code = 'en', limit = 100 } = await request.json() as any;
  if (!keyword) return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });

  // Parallel calls to related_keywords + keyword_ideas for broader results
  const [relatedData, ideasData] = await Promise.all([
    dataforseoRequest(env, '/dataforseo_labs/google/related_keywords/live', [{
      keyword,
      location_code,
      language_code,
      include_seed_keyword: true,
      limit: Math.min(limit, 1000),
      depth: 2,
      filters: [['keyword_data.keyword_info.search_volume', '>', 0]],
    }]),
    dataforseoRequest(env, '/dataforseo_labs/google/keyword_ideas/live', [{
      keywords: [keyword],
      location_code,
      language_code,
      limit: Math.min(limit, 1000),
      filters: [['keyword_info.search_volume', '>', 0]],
      order_by: ['keyword_info.search_volume,desc'],
    }]),
  ]);

  // Deduplicate and merge
  const seen = new Set<string>();
  const allKeywords: any[] = [];

  const addKeywords = (items: any[], extractor: (item: any) => any) => {
    for (const item of items || []) {
      const kw = extractor(item);
      if (kw && !seen.has(kw.keyword)) {
        seen.add(kw.keyword);
        allKeywords.push(kw);
      }
    }
  };

  addKeywords(relatedData?.tasks?.[0]?.result?.[0]?.items, (item) => ({
    keyword: item.keyword_data?.keyword,
    search_volume: item.keyword_data?.keyword_info?.search_volume || 0,
    competition: item.keyword_data?.keyword_info?.competition || 0,
    cpc: item.keyword_data?.keyword_info?.cpc || 0,
    competition_level: item.keyword_data?.keyword_info?.competition_level || 'UNKNOWN',
  }));

  addKeywords(ideasData?.tasks?.[0]?.result?.[0]?.items, (item) => ({
    keyword: item.keyword,
    search_volume: item.keyword_info?.search_volume || 0,
    competition: item.keyword_info?.competition || 0,
    cpc: item.keyword_info?.cpc || 0,
    competition_level: item.keyword_info?.competition_level || 'UNKNOWN',
  }));

  allKeywords.sort((a, b) => b.search_volume - a.search_volume);
  const finalKeywords = allKeywords.slice(0, limit);

  // Return in the format the frontend expects
  const response = {
    tasks: [{
      result: [{
        items: finalKeywords.map((kw) => ({
          keyword_data: {
            keyword: kw.keyword,
            keyword_info: {
              search_volume: kw.search_volume,
              competition: kw.competition,
              cpc: kw.cpc,
              competition_level: kw.competition_level,
            },
          },
        })),
        total_count: finalKeywords.length,
        items_count: finalKeywords.length,
      }],
    }],
  };

  return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/keywords/suggestions
export async function handleKeywordSuggestions(request: Request, env: Env): Promise<Response> {
  const { keyword, location_code = 2840, language_code = 'en', limit = 100 } = await request.json() as any;
  if (!keyword) return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });

  const data = await dataforseoRequest(env, '/dataforseo_labs/google/keyword_suggestions/live', [{
    keyword,
    location_code,
    language_code,
    limit,
  }]);

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/keywords/ideas
export async function handleKeywordIdeas(request: Request, env: Env): Promise<Response> {
  const { keyword, location_code = 2840, language_code = 'en' } = await request.json() as any;
  if (!keyword) return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });

  const data = await dataforseoRequest(env, '/dataforseo_labs/google/keyword_ideas/live', [{
    keywords: [keyword],
    location_code,
    language_code,
    limit: 100,
    filters: [['keyword_info.search_volume', '>', 0]],
    order_by: ['keyword_info.search_volume,desc'],
  }]);

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/keywords/difficulty
export async function handleKeywordDifficulty(request: Request, env: Env): Promise<Response> {
  const { keywords, location_code = 2840, language_code = 'en' } = await request.json() as any;
  if (!keywords || !Array.isArray(keywords)) return new Response(JSON.stringify({ error: 'Keywords array is required' }), { status: 400 });

  const data = await dataforseoRequest(env, '/dataforseo_labs/google/bulk_keyword_difficulty/live', [{
    keywords,
    location_code,
    language_code,
  }]);

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/keywords/overview
export async function handleKeywordOverview(request: Request, env: Env): Promise<Response> {
  const { keyword, location_code = 2840, language_code = 'en' } = await request.json() as any;
  if (!keyword) return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });

  const data = await dataforseoRequest(env, '/dataforseo_labs/google/keyword_overview/live', [{
    keywords: [keyword],
    location_code,
    language_code,
  }]);

  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
}
