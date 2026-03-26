import type { Env } from '../index';
import { dataforseoRequest } from '../dataforseo/client';

// POST /api/ai/google-ai-mode
export async function handleGoogleAIMode(request: Request, env: Env): Promise<Response> {
  const { keyword, location_name = 'United States', device = 'desktop', os = 'windows' } = await request.json() as any;
  if (!keyword) return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });

  try {
    const data = await dataforseoRequest(env, '/serp/google/ai_mode/live/advanced', [{
      keyword,
      location_name,
      language_name: 'English',
      device,
      os,
    }]);
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Google AI Mode error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to fetch AI Mode data' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// POST /api/ai/chatgpt-search
export async function handleChatGPTSearch(request: Request, env: Env): Promise<Response> {
  const { keyword } = await request.json() as any;
  if (!keyword) return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });

  try {
    const data = await dataforseoRequest(env, '/ai_optimization/chat_gpt/llm_responses/live', [{
      user_prompt: keyword,
      model_name: 'gpt-4o',
      web_search: true,
      max_output_tokens: 2048,
    }]);
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('ChatGPT Search error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to fetch ChatGPT data' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// POST /api/ai/perplexity
export async function handlePerplexitySearch(request: Request, env: Env): Promise<Response> {
  const { keyword, location_code } = await request.json() as any;
  if (!keyword) return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });

  // Map numeric location_code to ISO country code for Perplexity's web_search_country_iso_code
  const locationMap: Record<number, string> = {
    2036: 'AU', 2840: 'US', 2826: 'GB', 2124: 'CA', 2554: 'NZ',
    2276: 'DE', 2250: 'FR', 2380: 'IT', 2724: 'ES', 2528: 'NL',
    2076: 'BR', 2356: 'IN', 2392: 'JP', 2410: 'KR', 2484: 'MX',
  };
  const isoCode = locationMap[Number(location_code)] || 'US';

  try {
    const data = await dataforseoRequest(env, '/ai_optimization/perplexity/llm_responses/live', [{
      user_prompt: keyword,
      model_name: 'sonar',
      web_search_country_iso_code: isoCode,
      max_output_tokens: 2048,
    }]);
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Perplexity Search error:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Failed to fetch Perplexity data' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}

// POST /api/ai/people-also-ask
export async function handlePeopleAlsoAsk(request: Request, env: Env): Promise<Response> {
  const { keyword, location = '2840', language = 'en', depth = 2 } = await request.json() as any;
  if (!keyword) return new Response(JSON.stringify({ error: 'Keyword is required' }), { status: 400 });

  const maxDepth = Math.min(Math.max(1, depth), 3);
  const maxApiCalls = maxDepth === 1 ? 1 : maxDepth === 2 ? 10 : 25;
  const allItems: any[] = [];
  const seenQuestions = new Set<string>();
  const searchedKeywords = new Set<string>();

  // Seed the queue: original keyword + question/FAQ variants for broader PAA coverage
  const searchQueue: Array<{ keyword: string; depth: number; parentKeyword: string }> = [
    { keyword, depth: 1, parentKeyword: '' },
  ];
  if (maxDepth >= 2) {
    searchQueue.push(
      { keyword: `${keyword} questions`, depth: 1, parentKeyword: '' },
      { keyword: `what is ${keyword}`, depth: 1, parentKeyword: '' },
    );
  }

  let apiCallsMade = 0;

  // Helper to add a PAA item with deduplication
  const addItem = (sourceType: string, question: string, answer: string, url: string, domain: string, depthLevel: number, parentKw: string) => {
    const normalized = question.toLowerCase().trim();
    if (seenQuestions.has(normalized)) return false;
    seenQuestions.add(normalized);
    allItems.push({
      position: allItems.length + 1,
      source_type: sourceType,
      question,
      answer,
      source_url: url,
      source_domain: domain,
      search_iteration: apiCallsMade,
      depth_level: depthLevel,
      parent_keyword: parentKw,
    });
    return true;
  };

  // BFS through PAA questions at increasing depth
  while (searchQueue.length > 0 && apiCallsMade < maxApiCalls) {
    const current = searchQueue.shift()!;
    const normalizedKw = current.keyword.toLowerCase().trim();

    if (searchedKeywords.has(normalizedKw)) continue;
    searchedKeywords.add(normalizedKw);

    let data: any;
    try {
      data = await dataforseoRequest(env, '/serp/google/organic/live/advanced', [{
        keyword: current.keyword,
        location_code: parseInt(location),
        language_code: language,
        device: 'desktop',
        os: 'windows',
      }]);
    } catch {
      continue;
    }
    apiCallsMade++;

    const result = data?.tasks?.[0]?.result?.[0];
    const items = result?.items || [];

    // The parent for items found in THIS search is the keyword we searched
    // For the root keyword, parent is the keyword itself; for deeper searches, it's the question we followed
    const thisParent = current.parentKeyword || keyword;

    for (const item of items) {
      if (item.type === 'people_also_ask') {
        const questions = item.items || [];
        for (const q of questions) {
          const questionText = q.title || '';
          if (!questionText) continue;

          const added = addItem(
            'people_also_ask',
            questionText,
            q.snippet || '',
            q.url || '',
            q.domain || '',
            current.depth,
            thisParent,
          );

          // Queue for deeper search: use the question as the next keyword
          // parent_keyword for those results will be THIS question
          if (added && current.depth < maxDepth) {
            searchQueue.push({
              keyword: questionText,
              depth: current.depth + 1,
              parentKeyword: questionText,
            });
          }
        }
      }

      // Capture related searches and also queue them for PAA discovery
      if (item.type === 'related_searches') {
        for (const related of (item.items || [])) {
          const relatedText = related.title || '';
          if (!relatedText) continue;

          addItem(
            'related_search',
            relatedText,
            '',
            '',
            '',
            current.depth,
            thisParent,
          );

          // Queue related searches for deeper PAA discovery too (same depth, not deeper)
          if (current.depth <= maxDepth) {
            searchQueue.push({
              keyword: relatedText,
              depth: current.depth,
              parentKeyword: thisParent,
            });
          }
        }
      }
    }
  }

  // Build source stats
  const sourceStats: Record<string, number> = {};
  for (const item of allItems) {
    sourceStats[item.source_type] = (sourceStats[item.source_type] || 0) + 1;
  }

  // Build iteration stats by depth
  const iterationStats: Record<string, number> = {};
  for (const item of allItems) {
    const key = `depth_${item.depth_level}`;
    iterationStats[key] = (iterationStats[key] || 0) + 1;
  }

  // Build content map
  const contentMap = buildContentMap(keyword, allItems);

  return new Response(JSON.stringify({
    data: allItems,
    source_stats: sourceStats,
    extraction_method: 'iterative_serp',
    clicks_simulated: maxDepth,
    estimated_cost: apiCallsMade * 0.003,
    api_calls_made: apiCallsMade,
    keywords_searched: Array.from(searchedKeywords),
    iteration_stats: iterationStats,
    content_map: contentMap,
  }), { headers: { 'Content-Type': 'application/json' } });
}

function buildContentMap(rootKeyword: string, items: any[]) {
  const paaItems = items.filter(i => i.source_type === 'people_also_ask');
  const relatedItems = items.filter(i => i.source_type === 'related_search');

  // Group by parent keyword to build tree
  const byParent: Record<string, any[]> = {};
  for (const item of paaItems) {
    const parent = item.parent_keyword || rootKeyword;
    if (!byParent[parent]) byParent[parent] = [];
    byParent[parent].push(item);
  }

  // Recursive tree builder
  const buildNode = (kw: string, depth: number, maxTreeDepth: number): any[] => {
    if (depth > maxTreeDepth) return [];
    return (byParent[kw] || []).map(item => ({
      question: item.question,
      answer: item.answer,
      source_url: item.source_url,
      source_domain: item.source_domain,
      depth_level: item.depth_level,
      children: buildNode(item.question, depth + 1, maxTreeDepth),
    }));
  };

  const tree = {
    keyword: rootKeyword,
    children: buildNode(rootKeyword, 1, 3),
  };

  // Generate topic clusters using word frequency
  const clusters = generateTopicClusters(paaItems);

  return {
    tree,
    clusters,
    related_searches: relatedItems.map(i => i.question),
    total_questions: paaItems.length,
    total_related: relatedItems.length,
    depth_reached: Math.max(...items.map(i => i.depth_level || 1), 1),
  };
}

function generateTopicClusters(items: any[]) {
  const stopWords = new Set([
    'what', 'when', 'where', 'which', 'that', 'this', 'with', 'from',
    'have', 'does', 'will', 'your', 'about', 'they', 'their', 'there',
    'been', 'more', 'than', 'much', 'most', 'some', 'could', 'would',
    'should', 'into', 'best', 'good', 'like', 'also', 'just', 'know',
    'need', 'make', 'many', 'well', 'between', 'being', 'without',
    'really', 'after', 'before', 'other', 'these', 'those', 'very',
  ]);

  // Count word frequency across all questions
  const wordToQuestions: Record<string, Set<number>> = {};
  for (let i = 0; i < items.length; i++) {
    const words = items[i].question.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3 && !stopWords.has(w));
    for (const word of words) {
      if (!wordToQuestions[word]) wordToQuestions[word] = new Set();
      wordToQuestions[word].add(i);
    }
  }

  // Pick top themes (words appearing in 2+ questions)
  const themes = Object.entries(wordToQuestions)
    .filter(([_, indices]) => indices.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 10);

  const assigned = new Set<number>();
  const clusters = themes.map(([theme, indices]) => {
    const unassigned = [...indices].filter(i => !assigned.has(i));
    unassigned.forEach(i => assigned.add(i));
    return {
      theme: theme.charAt(0).toUpperCase() + theme.slice(1),
      questions: unassigned.map(i => ({
        question: items[i].question,
        answer: items[i].answer,
        source_url: items[i].source_url,
        depth_level: items[i].depth_level,
      })),
      count: unassigned.length,
    };
  }).filter(c => c.count > 0);

  // Remaining unclustered
  const unclustered = items
    .map((item, i) => ({ item, i }))
    .filter(({ i }) => !assigned.has(i));

  if (unclustered.length > 0) {
    clusters.push({
      theme: 'Other Topics',
      questions: unclustered.map(({ item }) => ({
        question: item.question,
        answer: item.answer,
        source_url: item.source_url,
        depth_level: item.depth_level,
      })),
      count: unclustered.length,
    });
  }

  return clusters;
}

// GET /api/ai/visibility-summary?domain=X
export async function handleVisibilitySummary(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const domain = url.searchParams.get('domain');
  if (!domain) {
    return new Response(JSON.stringify({ error: 'domain parameter is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const cacheKey = `ai-visibility:${userId}:${domain}`;
  const cached = await env.KV.get(cacheKey, 'json');

  if (cached) {
    return new Response(JSON.stringify({ cached: true, data: cached }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ cached: false, data: null }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/ai/visibility-check
export async function handleVisibilityCheck(request: Request, env: Env, userId: string): Promise<Response> {
  const { domain, keywords } = await request.json() as { domain?: string; keywords?: string[] };
  if (!domain || !keywords?.length) {
    return new Response(JSON.stringify({ error: 'domain and keywords are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const limitedKeywords = keywords.slice(0, 3);
  const results: Array<{ keyword: string; google_ai: boolean; chatgpt: boolean; perplexity: boolean }> = [];

  for (const keyword of limitedKeywords) {
    let googleAI = false;
    let chatgpt = false;
    let perplexity = false;

    // Check Google AI Mode
    try {
      const aiData = await dataforseoRequest(env, '/serp/google/ai_mode/live/advanced', [{ keyword, location_name: 'United States', language_name: 'English', device: 'desktop', os: 'windows' }]);
      const items = aiData?.tasks?.[0]?.result?.[0]?.items || [];
      googleAI = items.some((item: any) => {
        const url = item.url || item.source_url || '';
        return url.includes(domain);
      });
    } catch { /* skip */ }

    // Check ChatGPT Search
    try {
      const chatData = await dataforseoRequest(env, '/ai_optimization/chat_gpt/llm_responses/live', [{
        user_prompt: keyword, model_name: 'gpt-4o', web_search: true, max_output_tokens: 2048,
      }]);
      const items = chatData?.tasks?.[0]?.result?.[0]?.items || [];
      chatgpt = JSON.stringify(items).includes(domain);
    } catch { /* skip */ }

    // Check Perplexity
    try {
      const perpData = await dataforseoRequest(env, '/ai_optimization/perplexity/llm_responses/live', [{
        user_prompt: keyword, model_name: 'sonar', max_output_tokens: 2048,
      }]);
      const items = perpData?.tasks?.[0]?.result?.[0]?.items || [];
      perplexity = JSON.stringify(items).includes(domain);
    } catch { /* skip */ }

    results.push({ keyword, google_ai: googleAI, chatgpt, perplexity });
  }

  const enginesVisible = new Set<string>();
  for (const r of results) {
    if (r.google_ai) enginesVisible.add('google_ai');
    if (r.chatgpt) enginesVisible.add('chatgpt');
    if (r.perplexity) enginesVisible.add('perplexity');
  }

  const summary = {
    domain,
    keywords_checked: limitedKeywords,
    results,
    engines_visible: enginesVisible.size,
    engines_total: 3,
    checked_at: new Date().toISOString(),
  };

  // Cache for 24 hours
  const cacheKey = `ai-visibility:${userId}:${domain}`;
  await env.KV.put(cacheKey, JSON.stringify(summary), { expirationTtl: 86400 });

  return new Response(JSON.stringify(summary), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/ai/lighthouse-seo (On-Page SEO)
export async function handleLighthouseSEO(request: Request, env: Env): Promise<Response> {
  const { url } = await request.json() as any;
  if (!url) return new Response(JSON.stringify({ error: 'URL is required' }), { status: 400 });

  const data = await dataforseoRequest(env, '/on_page/lighthouse/live/json', [{
    url,
    for_mobile: false,
    categories: ['seo', 'performance', 'accessibility', 'best-practices'],
  }]);

  // Also fetch HTML content for meta tag analysis
  let htmlData = null;
  try {
    const htmlResponse = await dataforseoRequest(env, '/on_page/instant_pages', [{
      url,
      load_resources: false,
    }]);
    const page = htmlResponse?.tasks?.[0]?.result?.[0]?.items?.[0];
    if (page) {
      htmlData = {
        title: { content: page.meta?.title || '', length: (page.meta?.title || '').length, exists: !!page.meta?.title },
        metaDescription: { content: page.meta?.description || '', length: (page.meta?.description || '').length, exists: !!page.meta?.description },
        h1Tags: { content: page.meta?.htags?.h1 || [], count: (page.meta?.htags?.h1 || []).length },
        url: page.url,
      };
    }
  } catch {
    // HTML data is optional
  }

  const lighthouseResult = data?.tasks?.[0]?.result?.[0];

  return new Response(JSON.stringify({
    lighthouse: lighthouseResult || {},
    htmlData,
    url,
    timestamp: new Date().toISOString(),
  }), { headers: { 'Content-Type': 'application/json' } });
}

// POST /api/ai/geo-analyzer
export async function handleGeoAnalyzer(request: Request, env: Env): Promise<Response> {
  const { url, businessName, targetLocation, primaryService } = await request.json() as any;
  if (!url) return new Response(JSON.stringify({ error: 'URL is required' }), { status: 400 });

  // Fetch the page content via DataForSEO On-Page API
  const data = await dataforseoRequest(env, '/on_page/instant_pages', [{
    url,
    load_resources: true,
    enable_javascript: true,
  }]);

  const page = data?.tasks?.[0]?.result?.[0]?.items?.[0];
  if (!page) {
    return new Response(JSON.stringify({ error: 'Could not fetch page content' }), { status: 400 });
  }

  // GEO scoring logic (simplified version of the edge function)
  const meta = page.meta || {};
  const content = page.plain_text_content || '';
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  const keyStats = {
    wordCount,
    h1Count: (meta.htags?.h1 || []).length,
    internalLinks: page.internal_links_count || 0,
    externalLinks: page.external_links_count || 0,
    images: page.images_count || 0,
    imagesWithAlt: page.images_count || 0,
    phoneDetected: /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(content),
  };

  // Simplified scoring
  let score = 0;
  const maxScore = 160;

  // Content Uniqueness scoring
  const contentScore = Math.min(40, Math.round((wordCount / 2000) * 40));
  // Local Trust scoring
  const localScore = Math.min(40, (keyStats.phoneDetected ? 15 : 0) + Math.min(15, keyStats.externalLinks * 3) + 10);
  // Transactional scoring
  const transactionalScore = Math.min(40, (keyStats.phoneDetected ? 15 : 0) + Math.min(25, keyStats.internalLinks * 2));
  // Technical scoring
  const technicalScore = Math.min(40, (keyStats.h1Count > 0 ? 15 : 0) + (meta.title ? 15 : 0) + (meta.description ? 10 : 0));

  score = contentScore + localScore + transactionalScore + technicalScore;
  const geoScore = Math.round((score / maxScore) * 100);
  const grade = geoScore >= 80 ? 'A' : geoScore >= 60 ? 'B' : geoScore >= 40 ? 'C' : geoScore >= 20 ? 'D' : 'F';

  return new Response(JSON.stringify({
    url,
    analyzedAt: new Date().toISOString(),
    geoScore,
    grade,
    rawScore: score,
    maxScore,
    categories: {
      content_uniqueness: { score: contentScore, max: 40, percentage: Math.round((contentScore / 40) * 100) },
      local_trust_signals: { score: localScore, max: 40, percentage: Math.round((localScore / 40) * 100) },
      transactional_elements: { score: transactionalScore, max: 40, percentage: Math.round((transactionalScore / 40) * 100) },
      technical_schema: { score: technicalScore, max: 40, percentage: Math.round((technicalScore / 40) * 100) },
    },
    elements: [],
    recommendations: { critical: [], important: [], optimize: [] },
    schemaAnalysis: {
      LocalBusiness: { present: false, complete: false, missing: ['@type', 'name', 'address'] },
      Service: { present: false, complete: false, missing: ['@type', 'name', 'provider'] },
      FAQPage: { present: false, complete: false, missing: ['@type', 'mainEntity'] },
      AggregateRating: { present: false, complete: false, missing: ['ratingValue', 'reviewCount'] },
    },
    keyStats,
  }), { headers: { 'Content-Type': 'application/json' } });
}
