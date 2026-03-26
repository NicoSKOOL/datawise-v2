import type { Env } from '../index';
import { dataforseoRequest, dataforseoGet } from '../dataforseo/client';
import { getLLMProvider, type ChatMessage, type UserLLMConfig } from '../llm/provider';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

interface LocalProject {
  id: string;
  user_id: string;
  name: string;
  domain: string | null;
  project_type: string;
  place_id: string | null;
  cid: string | null;
  business_name: string | null;
}

function findLocalPackPosition(items: any[], project: LocalProject) {
  for (const item of items || []) {
    if (item.type !== 'maps_search') continue;
    if (project.place_id && item.place_id === project.place_id) return item;
    if (project.cid && item.cid === project.cid) return item;
    if (project.business_name && item.title?.toLowerCase().includes(project.business_name.toLowerCase())) return item;
  }
  return null;
}

// POST /api/local-seo/business-search
export async function handleBusinessSearch(request: Request, env: Env): Promise<Response> {
  const { query, location_code = 2840 } = await request.json() as any;
  if (!query?.trim()) return json({ error: 'Query is required' }, 400);

  const payload = [{
    keyword: query.trim(),
    location_code,
    language_code: 'en',
    device: 'desktop',
    os: 'windows',
    depth: 20,
  }];

  const data = await dataforseoRequest(env, '/serp/google/maps/live/advanced', payload);
  const items = data?.tasks?.[0]?.result?.[0]?.items || [];

  const businesses = items
    .filter((item: any) => item.type === 'maps_search')
    .slice(0, 10)
    .map((item: any) => ({
      title: item.title || '',
      place_id: item.place_id || null,
      cid: item.cid || null,
      address: item.address || '',
      rating: item.rating?.value ?? null,
      reviews_count: item.rating?.votes_count ?? null,
      phone: item.phone || null,
      category: item.category || null,
      url: item.url || null,
    }));

  return json({ businesses });
}

// POST /api/local-seo/projects/:id/check
export async function handleLocalRankCheck(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id, user_id, name, domain, project_type, place_id, cid, business_name FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
  ).bind(projectId, userId, 'local').first() as LocalProject | null;

  if (!project) return json({ error: 'Local project not found' }, 404);

  const { results: keywords } = await env.DB.prepare(
    'SELECT id, keyword, location_code, language_code FROM tracked_keywords WHERE project_id = ? AND is_active = 1'
  ).bind(projectId).all() as { results: any[] };

  if (!keywords.length) return json({ error: 'No keywords to check' }, 400);

  const stmts: D1PreparedStatement[] = [];
  const checkedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  let found = 0;
  let notInPack = 0;

  // Maps SERP Live API only supports one task per call, so send each keyword individually
  for (const kw of keywords) {
    const payload = [{
      keyword: kw.keyword,
      location_code: kw.location_code || 2840,
      language_code: kw.language_code || 'en',
      device: 'desktop',
      os: 'windows',
      depth: 20,
    }];

    const data = await dataforseoRequest(env, '/serp/google/maps/live/advanced', payload);
    const items = data?.tasks?.[0]?.result?.[0]?.items || [];
    const match = findLocalPackPosition(items, project);

    if (match) {
      found++;
      const position = match.rank_absolute ?? match.rank_group ?? null;
      const rating = match.rating?.value ?? null;
      const reviewsCount = match.rating?.votes_count ?? null;

      stmts.push(
        env.DB.prepare(
          'INSERT INTO local_rank_history (keyword_id, pack_position, rating, reviews_count, checked_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(kw.id, position, rating, reviewsCount, checkedAt)
      );
    } else {
      notInPack++;
      stmts.push(
        env.DB.prepare(
          'INSERT INTO local_rank_history (keyword_id, pack_position, rating, reviews_count, checked_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(kw.id, null, null, null, checkedAt)
      );
    }
  }

  if (stmts.length > 0) {
    for (let i = 0; i < stmts.length; i += 50) {
      await env.DB.batch(stmts.slice(i, i + 50));
    }
  }

  return json({ checked: keywords.length, found, not_in_pack: notInPack });
}

// GET /api/local-seo/projects/:id/report?period=30
export async function handleLocalProjectReport(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
  ).bind(projectId, userId, 'local').first();

  if (!project) return json({ error: 'Local project not found' }, 404);

  const url = new URL(request.url);
  const period = Math.min(Math.max(parseInt(url.searchParams.get('period') || '30', 10), 1), 365);

  // Current period rank history
  const { results: historyRows } = await env.DB.prepare(`
    SELECT lrh.keyword_id, lrh.pack_position, lrh.rating, lrh.reviews_count, lrh.checked_at
    FROM local_rank_history lrh
    JOIN tracked_keywords tk ON tk.id = lrh.keyword_id
    WHERE tk.project_id = ? AND tk.is_active = 1
      AND lrh.checked_at >= datetime('now', '-' || ? || ' days')
    ORDER BY lrh.checked_at ASC
  `).bind(projectId, period).all();

  // Previous period for comparison
  const { results: prevRows } = await env.DB.prepare(`
    SELECT lrh.keyword_id, lrh.pack_position, lrh.rating, lrh.reviews_count, lrh.checked_at
    FROM local_rank_history lrh
    JOIN tracked_keywords tk ON tk.id = lrh.keyword_id
    WHERE tk.project_id = ? AND tk.is_active = 1
      AND lrh.checked_at >= datetime('now', '-' || ? || ' days')
      AND lrh.checked_at < datetime('now', '-' || ? || ' days')
    ORDER BY lrh.checked_at ASC
  `).bind(projectId, period * 2, period).all();

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM tracked_keywords WHERE project_id = ? AND is_active = 1'
  ).bind(projectId).first() as any;
  const totalKeywords = countRow?.cnt || 0;

  function computeSnapshot(rows: any[], total: number) {
    const latestByKeyword = new Map<string, any>();
    for (const row of rows) {
      const existing = latestByKeyword.get(row.keyword_id);
      if (!existing || row.checked_at > existing.checked_at) {
        latestByKeyword.set(row.keyword_id, row);
      }
    }

    const positions: (number | null)[] = [];
    const ratings: number[] = [];
    const reviewCounts: number[] = [];
    const dist = { top3: 0, top10: 0, top20: 0, not_in_pack: 0 };

    for (const [, row] of latestByKeyword) {
      const pos = row.pack_position;
      positions.push(pos);

      if (row.rating != null) ratings.push(row.rating);
      if (row.reviews_count != null) reviewCounts.push(row.reviews_count);

      if (pos == null) { dist.not_in_pack++; }
      else if (pos <= 3) { dist.top3++; }
      else if (pos <= 10) { dist.top10++; }
      else { dist.top20++; }
    }

    const ranked = positions.filter(p => p != null) as number[];
    const avgPos = ranked.length ? Math.round((ranked.reduce((s, p) => s + p, 0) / ranked.length) * 10) / 10 : null;
    const avgRating = ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null;
    const totalReviews = reviewCounts.length ? Math.max(...reviewCounts) : null;

    return {
      total_keywords: total,
      in_pack: ranked.length,
      avg_pack_position: avgPos,
      avg_rating: avgRating,
      total_reviews: totalReviews,
      distribution: dist,
      improved: 0,
      declined: 0,
      stable: 0,
    };
  }

  const current = computeSnapshot(historyRows as any[], totalKeywords);
  const previous = computeSnapshot(prevRows as any[], totalKeywords);

  // Compute improved/declined/stable
  const byKeyword = new Map<string, any[]>();
  for (const row of historyRows as any[]) {
    if (!byKeyword.has(row.keyword_id)) byKeyword.set(row.keyword_id, []);
    byKeyword.get(row.keyword_id)!.push(row);
  }

  let improved = 0, declined = 0, stable = 0;
  for (const [, rows] of byKeyword) {
    rows.sort((a: any, b: any) => a.checked_at < b.checked_at ? -1 : 1);
    if (rows.length < 2) { stable++; continue; }
    const latest = rows[rows.length - 1].pack_position;
    const prev = rows[rows.length - 2].pack_position;
    if (latest == null || prev == null) { stable++; }
    else if (latest < prev) { improved++; }
    else if (latest > prev) { declined++; }
    else { stable++; }
  }
  current.improved = improved;
  current.declined = declined;
  current.stable = stable;

  // Build trend data
  const trendMap = new Map<string, any[]>();
  for (const row of historyRows as any[]) {
    const date = (row.checked_at as string).split(' ')[0];
    if (!trendMap.has(date)) trendMap.set(date, []);
    trendMap.get(date)!.push(row);
  }

  const trend = Array.from(trendMap.entries()).map(([date, rows]) => {
    const positions = rows.filter((r: any) => r.pack_position != null).map((r: any) => r.pack_position as number);
    const avgP = positions.length ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10 : null;
    let t3 = 0, t10 = 0, t20 = 0;
    for (const p of positions) {
      if (p <= 3) t3++;
      else if (p <= 10) t10++;
      else t20++;
    }
    const ratings = rows.filter((r: any) => r.rating != null).map((r: any) => r.rating as number);
    const avgR = ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null;
    return { date, avg_pack_position: avgP, top3: t3, top10: t10, top20: t20, avg_rating: avgR };
  }).sort((a, b) => a.date < b.date ? -1 : 1);

  return json({ current, previous, trend });
}

// GET /api/local-seo/projects/:id/keywords
export async function handleLocalKeywords(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
  ).bind(projectId, userId, 'local').first();

  if (!project) return json({ error: 'Local project not found' }, 404);

  const { results } = await env.DB.prepare(`
    SELECT tk.*,
      lrh.pack_position, lrh.rating, lrh.reviews_count, lrh.checked_at,
      prev.pack_position as prev_pack_position
    FROM tracked_keywords tk
    LEFT JOIN local_rank_history lrh ON lrh.keyword_id = tk.id
      AND lrh.checked_at = (SELECT MAX(checked_at) FROM local_rank_history WHERE keyword_id = tk.id)
    LEFT JOIN local_rank_history prev ON prev.keyword_id = tk.id
      AND prev.checked_at = (SELECT MAX(checked_at) FROM local_rank_history WHERE keyword_id = tk.id AND checked_at < lrh.checked_at)
    WHERE tk.project_id = ? AND tk.is_active = 1
    ORDER BY CASE WHEN lrh.pack_position IS NULL THEN 1 ELSE 0 END, lrh.pack_position ASC
  `).bind(projectId).all();

  return json(results);
}

// POST /api/local-seo/projects
export async function handleCreateLocalProject(request: Request, env: Env, userId: string): Promise<Response> {
  const { name, business_name, place_id, cid, domain, location_code, latitude, longitude } = await request.json() as any;
  if (!name?.trim()) return json({ error: 'Name is required' }, 400);

  const id = generateId();
  const locCode = location_code || 2840;

  await env.DB.prepare(
    'INSERT INTO seo_projects (id, user_id, name, domain, project_type, place_id, cid, business_name, location_code, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, name.trim(), domain || null, 'local', place_id || null, cid || null, business_name || null, locCode, latitude || null, longitude || null).run();

  return json({
    id,
    name: name.trim(),
    domain: domain || null,
    project_type: 'local',
    place_id: place_id || null,
    cid: cid || null,
    business_name: business_name || null,
    location_code: locCode,
    keyword_count: 0,
  }, 201);
}

// POST /api/local-seo/gbp-profile
export async function handleGBPProfile(request: Request, env: Env): Promise<Response> {
  const { place_id, business_name, location_code = 2840, language_code = 'en' } = await request.json() as any;
  if (!place_id && !business_name) return json({ error: 'place_id or business_name is required' }, 400);

  // Check KV cache first (only return if data is non-empty)
  const cacheKey = `gbp-profile:${place_id || business_name}`;
  const cached = await env.KV.get(cacheKey, 'json') as any;
  if (cached && cached.title) return json(cached);

  // Try my_business_info first for rich data
  let business: any = null;
  const keyword = place_id ? `place_id:${place_id}` : business_name;
  try {
    const data = await dataforseoRequest(env, '/business_data/google/my_business_info/live', [{
      keyword,
      location_code,
      language_code,
    }]);
    const candidate = data?.tasks?.[0]?.result?.[0];
    if (candidate?.title) business = candidate;
  } catch (err) {
    console.error('my_business_info failed:', err);
  }

  // Fallback: Maps SERP search if my_business_info returned nothing useful
  if (!business && business_name) {
    try {
      const searchData = await dataforseoRequest(env, '/serp/google/maps/live/advanced', [{
        keyword: business_name,
        location_code,
        language_code,
        device: 'desktop',
        os: 'windows',
        depth: 10,
      }]);
      const items = searchData?.tasks?.[0]?.result?.[0]?.items || [];
      // Match by place_id if we have one; only fall back to first result if no place_id
      const mapsItems = items.filter((i: any) => i.type === 'maps_search');
      const match = place_id
        ? mapsItems.find((i: any) => i.place_id === place_id)
        : mapsItems[0];
      if (match) {
        business = {
          title: match.title || '',
          address: match.address || '',
          phone: match.phone || null,
          url: match.url || null,
          category: match.category || null,
          additional_categories: match.additional_categories || [],
          rating: match.rating,
          rating_distribution: null,
          is_claimed: null,
          description: match.snippet || null,
          place_id: match.place_id || place_id,
          cid: match.cid || null,
          work_time: match.work_hours || null,
          popular_times: null,
          total_photos: match.main_image ? 1 : 0,
          latitude: match.latitude ?? null,
          longitude: match.longitude ?? null,
        };
      }
    } catch (err) {
      console.error('Maps SERP fallback failed:', err);
    }
  }

  if (!business || !business.title) return json({ error: 'Business not found' }, 404);

  const profile = {
    title: business.title || '',
    address: business.address || '',
    phone: business.phone || null,
    url: business.url || null,
    category: business.category || null,
    additional_categories: business.additional_categories || [],
    rating: business.rating?.value ?? business.rating ?? null,
    rating_distribution: business.rating_distribution ?? null,
    reviews_count: business.rating?.votes_count ?? business.reviews_count ?? null,
    is_claimed: business.is_claimed ?? null,
    description: business.description || null,
    place_id: business.place_id || place_id,
    cid: business.cid || null,
    work_time: business.work_time || null,
    popular_times: business.popular_times || null,
    total_photos: business.total_photos ?? null,
    latitude: business.latitude ?? null,
    longitude: business.longitude ?? null,
  };

  // Only cache if we got useful data
  if (profile.title) {
    await env.KV.put(cacheKey, JSON.stringify(profile), { expirationTtl: 86400 });
  }

  return json(profile);
}

// POST /api/local-seo/reviews
export async function handleReviews(request: Request, env: Env): Promise<Response> {
  const { place_id, cid, business_name, location_code = 2840, language_code = 'en', depth = 20, sort_by = 'newest' } = await request.json() as any;
  if (!place_id && !cid && !business_name) return json({ error: 'place_id, cid, or business_name is required' }, 400);

  const identifier = place_id || cid || business_name;
  const cacheKey = `gbp-reviews:${identifier}:${sort_by}:${depth}`;
  const cached = await env.KV.get(cacheKey, 'json');
  if (cached) return json(cached);

  // Reviews API only supports async: task_post then poll task_get
  // place_id and cid are top-level params, not in keyword
  const taskPayload: Record<string, any> = {
    location_code,
    language_code,
    depth,
    sort_by,
  };
  if (place_id) {
    taskPayload.keyword = `place_id:${place_id}`;
  } else if (cid) {
    taskPayload.keyword = `cid:${cid}`;
  } else {
    taskPayload.keyword = business_name;
  }

  const postData = await dataforseoRequest(env, '/business_data/google/reviews/task_post', [taskPayload]);
  const taskId = postData?.tasks?.[0]?.id;

  if (!taskId) return json({ error: 'Failed to create reviews task' }, 500);

  // Poll task_get up to 5 times (2s intervals, 10s max)
  let result: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const getData = await dataforseoGet(env, `/business_data/google/reviews/task_get/${taskId}`);
    const task = getData?.tasks?.[0];
    if (task?.status_code === 20000 && task?.result?.[0]?.items) {
      result = task.result[0];
      break;
    }
  }

  if (!result) return json({ error: 'Reviews task timed out or returned no data' }, 504);

  const reviews = (result.items || []).map((item: any) => ({
    rating: item.rating?.value ?? null,
    text: item.review_text || '',
    author: item.profile_name || 'Anonymous',
    author_image: item.profile_image_url || null,
    date: item.timestamp || null,
    owner_response: item.owner_answer || null,
    owner_response_date: item.owner_timestamp || null,
    is_local_guide: item.is_local_guide ?? false,
    review_images: item.review_images || [],
    review_url: item.review_url || item.url || null,
  }));

  const response = {
    rating: result.rating?.value ?? null,
    reviews_count: result.reviews_count ?? reviews.length,
    place_id: place_id || result.place_id || null,
    reviews,
  };

  // Cache for 6h
  await env.KV.put(cacheKey, JSON.stringify(response), { expirationTtl: 21600 });

  return json(response);
}

// POST /api/local-seo/keyword-suggestions
export async function handleLocalKeywordSuggestions(request: Request, env: Env): Promise<Response> {
  const { category, city, location_code = 2840, language_code = 'en' } = await request.json() as any;
  if (!category?.trim()) return json({ error: 'Category is required' }, 400);

  const cat = category.trim().toLowerCase();
  const loc = city?.trim() || '';

  // Generate static suggestions from common local patterns (no API call)
  const staticKeywords: string[] = [];
  if (loc) {
    staticKeywords.push(
      `${cat} ${loc}`, `best ${cat} ${loc}`, `${cat} near me`,
      `${cat} open now`, `top ${cat} ${loc}`, `${cat} downtown ${loc}`,
      `affordable ${cat} ${loc}`, `${cat} reviews ${loc}`,
    );
  } else {
    staticKeywords.push(
      `${cat} near me`, `best ${cat} near me`, `${cat} open now`,
      `top rated ${cat}`, `${cat} reviews`,
    );
  }

  // Call DataForSEO keyword_suggestions with category as seed
  let apiKeywords: { keyword: string; search_volume: number }[] = [];
  try {
    const data = await dataforseoRequest(env, '/dataforseo_labs/google/keyword_suggestions/live', [{
      keyword: cat,
      location_code,
      language_code,
      limit: 200,
    }]);

    const items = data?.tasks?.[0]?.result?.[0]?.items || [];
    const cityLower = loc.toLowerCase();
    const localTerms = ['near me', 'near', 'nearby', 'local', 'closest', 'open now', 'open late'];

    for (const item of items) {
      const kw = item.keyword?.toLowerCase();
      if (!kw) continue;
      const sv = item.keyword_info?.search_volume || 0;

      // Keep if it contains city name or local-intent terms
      const isLocal = (cityLower && kw.includes(cityLower)) ||
        localTerms.some(term => kw.includes(term)) ||
        kw.includes(cat);

      if (isLocal && sv > 0) {
        apiKeywords.push({ keyword: item.keyword, search_volume: sv });
      }
    }
  } catch (err) {
    console.error('DataForSEO keyword suggestions failed:', err);
    // Fall through with static-only suggestions
  }

  // Categorize all keywords into groups
  const cityLower = loc.toLowerCase();
  const groups: Record<string, { keyword: string; search_volume?: number }[]> = {
    'Core': [],
    'Near Me': [],
    'Best/Top': [],
    'Service': [],
  };

  const categorize = (kw: string, sv?: number) => {
    const lower = kw.toLowerCase();
    const entry = { keyword: kw, search_volume: sv };

    if (lower.includes('near me') || lower.includes('nearby') || lower.includes('closest')) {
      groups['Near Me'].push(entry);
    } else if (lower.includes('best') || lower.includes('top')) {
      groups['Best/Top'].push(entry);
    } else if (cityLower && lower.includes(cityLower) && lower.includes(cat)) {
      groups['Core'].push(entry);
    } else {
      groups['Service'].push(entry);
    }
  };

  // Add static suggestions
  for (const kw of staticKeywords) {
    categorize(kw);
  }

  // Add API keywords (deduplicate against static)
  const staticSet = new Set(staticKeywords.map(k => k.toLowerCase()));
  for (const { keyword, search_volume } of apiKeywords) {
    if (!staticSet.has(keyword.toLowerCase())) {
      categorize(keyword, search_volume);
      staticSet.add(keyword.toLowerCase());
    }
  }

  // Sort each group by search volume (if available), then alphabetically
  for (const group of Object.values(groups)) {
    group.sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0));
  }

  const suggestions = Object.entries(groups)
    .filter(([, keywords]) => keywords.length > 0)
    .map(([group, keywords]) => ({ group, keywords }));

  return json({ suggestions });
}

// POST /api/local-seo/local-competitors
export async function handleLocalCompetitors(request: Request, env: Env): Promise<Response> {
  const { keyword, location_code = 2840, language_code = 'en', depth = 10 } = await request.json() as any;
  if (!keyword?.trim()) return json({ error: 'Keyword is required' }, 400);

  const payload = [{
    keyword: keyword.trim(),
    location_code,
    language_code,
    device: 'desktop',
    os: 'windows',
    depth,
  }];

  const data = await dataforseoRequest(env, '/serp/google/maps/live/advanced', payload);
  const items = data?.tasks?.[0]?.result?.[0]?.items || [];

  const competitors = items
    .filter((item: any) => item.type === 'maps_search')
    .map((item: any, index: number) => ({
      position: index + 1,
      title: item.title || '',
      place_id: item.place_id || null,
      cid: item.cid || null,
      address: item.address || '',
      rating: item.rating?.value ?? null,
      reviews_count: item.rating?.votes_count ?? null,
      category: item.category || null,
      phone: item.phone || null,
      url: item.url || null,
    }));

  return json({ keyword, competitors });
}

// POST /api/local-seo/resolve-gbp-url
export async function handleResolveGBPUrl(request: Request, env: Env): Promise<Response> {
  const { url: rawUrl } = await request.json() as any;
  if (!rawUrl?.trim()) return json({ error: 'URL is required' }, 400);

  let resolvedUrl = rawUrl.trim();

  // Resolve short links (maps.app.goo.gl, goo.gl)
  if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl)\//i.test(resolvedUrl)) {
    const resp = await fetch(resolvedUrl, { redirect: 'follow' });
    resolvedUrl = resp.url;
  }

  // Try to extract place_id from URL parameter (ftid= or place_id=)
  let placeId: string | null = null;
  let cid: string | null = null;
  let businessQuery: string | null = null;

  try {
    const parsed = new URL(resolvedUrl);
    const ftid = parsed.searchParams.get('ftid');
    if (ftid) {
      // ftid format: 0x...:0x... - the second part is CID in hex
      const parts = ftid.split(':');
      if (parts.length === 2 && parts[1].startsWith('0x')) {
        cid = BigInt(parts[1]).toString();
      }
    }

    // Check for place_id in data= parameter or URL path
    const dataParam = parsed.searchParams.get('data');
    if (dataParam) {
      const placeMatch = dataParam.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
      if (placeMatch) {
        const cidParts = placeMatch[1].split(':');
        if (cidParts.length === 2 && cidParts[1].startsWith('0x')) {
          cid = BigInt(cidParts[1]).toString();
        }
      }
    }

    // Extract business name from /maps/place/BUSINESS+NAME/ path
    const placePathMatch = parsed.pathname.match(/\/maps\/place\/([^/@]+)/);
    if (placePathMatch) {
      businessQuery = decodeURIComponent(placePathMatch[1].replace(/\+/g, ' '));
    }
  } catch {
    return json({ error: 'Invalid URL format' }, 400);
  }

  if (!cid && !businessQuery) {
    return json({ error: 'Could not extract business info from URL. Paste a Google Maps business URL.' }, 400);
  }

  // Look up business via GBP profile API
  const keyword = cid ? `cid:${cid}` : businessQuery;
  const payload = [{
    keyword,
    location_code: 2840,
    language_code: 'en',
  }];

  const data = await dataforseoRequest(env, '/business_data/google/my_business_info/live', payload);
  const business = data?.tasks?.[0]?.result?.[0];

  if (!business) {
    // Fallback: search Maps SERP with business name
    if (businessQuery) {
      const searchPayload = [{
        keyword: businessQuery,
        location_code: 2840,
        language_code: 'en',
        device: 'desktop',
        os: 'windows',
        depth: 5,
      }];
      const searchData = await dataforseoRequest(env, '/serp/google/maps/live/advanced', searchPayload);
      const items = searchData?.tasks?.[0]?.result?.[0]?.items || [];
      const match = items.find((item: any) => item.type === 'maps_search');
      if (match) {
        return json({
          title: match.title || '',
          place_id: match.place_id || null,
          cid: match.cid || null,
          address: match.address || '',
          rating: match.rating?.value ?? null,
          reviews_count: match.rating?.votes_count ?? null,
          phone: match.phone || null,
          category: match.category || null,
          url: match.url || null,
        });
      }
    }
    return json({ error: 'Business not found from URL' }, 404);
  }

  return json({
    title: business.title || '',
    place_id: business.place_id || null,
    cid: business.cid || null,
    address: business.address || '',
    rating: business.rating?.value ?? null,
    reviews_count: business.rating?.votes_count ?? null,
    phone: business.phone || null,
    category: business.category || null,
    url: business.url || null,
  });
}

// --- GeoGrid Rank Tracking ---

function generateGridPoints(
  centerLat: number,
  centerLng: number,
  gridSize: number,
  radiusKm: number
): Array<{ lat: number; lng: number; row: number; col: number }> {
  const points: Array<{ lat: number; lng: number; row: number; col: number }> = [];
  const latOffset = radiusKm / 111.32;
  const lngOffset = radiusKm / (111.32 * Math.cos((centerLat * Math.PI) / 180));
  const step = 2 / (gridSize - 1); // from -1 to +1

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const latFraction = -1 + row * step;
      const lngFraction = -1 + col * step;
      points.push({
        lat: Math.round((centerLat + latFraction * latOffset) * 1e7) / 1e7,
        lng: Math.round((centerLng + lngFraction * lngOffset) * 1e7) / 1e7,
        row,
        col,
      });
    }
  }

  return points;
}

// POST /api/local-seo/projects/:id/geogrid
export async function handleGeoGridScan(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const { keyword, grid_size = 7, radius_km = 3 } = await request.json() as any;
  if (!keyword?.trim()) return json({ error: 'Keyword is required' }, 400);

  const size = Math.min(Math.max(grid_size, 3), 9);
  const radius = Math.min(Math.max(radius_km, 0.5), 20);

  const project = await env.DB.prepare(
    'SELECT id, user_id, name, domain, project_type, place_id, cid, business_name, location_code, latitude, longitude FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
  ).bind(projectId, userId, 'local').first() as (LocalProject & { latitude: number | null; longitude: number | null; location_code: number }) | null;

  if (!project) return json({ error: 'Local project not found' }, 404);

  let centerLat = typeof project.latitude === 'number' ? project.latitude : null;
  let centerLng = typeof project.longitude === 'number' ? project.longitude : null;

  // If no stored coordinates, try fetching from GBP profile
  if (centerLat == null || centerLng == null) {
    const gbpKeyword = project.place_id ? `place_id:${project.place_id}` : project.business_name;
    if (!gbpKeyword) return json({ error: 'Business has no location data. Update project with coordinates.' }, 400);

    try {
      const data = await dataforseoRequest(env, '/business_data/google/my_business_info/live', [{
        keyword: gbpKeyword,
        location_code: project.location_code || 2840,
        language_code: 'en',
      }]);
      const biz = data?.tasks?.[0]?.result?.[0];
      if (biz?.latitude && biz?.longitude) {
        centerLat = biz.latitude;
        centerLng = biz.longitude;
        // Store for future use
        await env.DB.prepare(
          'UPDATE seo_projects SET latitude = ?, longitude = ? WHERE id = ?'
        ).bind(centerLat, centerLng, projectId).run();
      }
    } catch { /* fall through */ }

    // Fallback: Maps SERP search
    if (centerLat == null || centerLng == null) {
      try {
        const searchData = await dataforseoRequest(env, '/serp/google/maps/live/advanced', [{
          keyword: project.business_name || project.name,
          location_code: project.location_code || 2840,
          language_code: 'en',
          device: 'desktop',
          os: 'windows',
          depth: 5,
        }]);
        const items = searchData?.tasks?.[0]?.result?.[0]?.items || [];
        const match = findLocalPackPosition(items, project);
        if (match?.latitude && match?.longitude) {
          centerLat = match.latitude;
          centerLng = match.longitude;
          await env.DB.prepare(
            'UPDATE seo_projects SET latitude = ?, longitude = ? WHERE id = ?'
          ).bind(centerLat, centerLng, projectId).run();
        }
      } catch { /* fall through */ }
    }

    if (centerLat == null || centerLng == null) {
      return json({ error: 'Could not determine business location. Please check the business profile.' }, 400);
    }
  }

  // Generate grid points
  const gridPoints = generateGridPoints(centerLat, centerLng, size, radius);

  // Maps Live API only supports one task per call, so send concurrently in batches
  const results: Array<{
    row: number; col: number;
    lat: number; lng: number;
    position: number | null;
    total_results: number;
    top_competitors: Array<{ title: string; rating: number | null; reviews: number | null; position: number }>;
  }> = [];

  const CONCURRENCY = 10;
  for (let i = 0; i < gridPoints.length; i += CONCURRENCY) {
    const chunk = gridPoints.slice(i, i + CONCURRENCY);
    const promises = chunk.map(async (point) => {
      const data = await dataforseoRequest(env, '/serp/google/maps/live/advanced', [{
        keyword: keyword.trim(),
        location_coordinate: `${point.lat},${point.lng},17z`,
        language_code: 'en',
        device: 'desktop',
        os: 'windows',
        depth: 20,
      }]);
      const items = data?.tasks?.[0]?.result?.[0]?.items || [];
      const mapsItems = items.filter((it: any) => it.type === 'maps_search');
      const match = findLocalPackPosition(items, project);

      // Capture top 3 competitors (excluding the target business)
      const top_competitors = mapsItems
        .filter((it: any) => {
          if (project.place_id && it.place_id === project.place_id) return false;
          if (project.cid && it.cid === project.cid) return false;
          return true;
        })
        .slice(0, 3)
        .map((it: any) => ({
          title: it.title || '',
          rating: it.rating?.value ?? null,
          reviews: it.rating?.votes_count ?? null,
          position: it.rank_absolute ?? it.rank_group ?? 0,
        }));

      return {
        row: point.row,
        col: point.col,
        lat: point.lat,
        lng: point.lng,
        position: match ? (match.rank_absolute ?? match.rank_group ?? null) : null,
        total_results: mapsItems.length,
        top_competitors,
      };
    });

    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults);
  }

  // Compute summary
  const positions = results.filter(r => r.position != null).map(r => r.position as number);
  const avgPosition = positions.length ? Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10 : null;
  const top3Count = positions.filter(p => p <= 3).length;
  const foundCount = positions.length;
  const notFoundCount = results.length - foundCount;

  // Store scan
  const scanId = generateId();
  const scannedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');

  await env.DB.prepare(
    'INSERT INTO geogrid_scans (id, project_id, keyword, grid_size, radius_km, center_lat, center_lng, results, avg_position, top3_count, found_count, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    scanId, projectId, keyword.trim(), size, radius,
    centerLat, centerLng, JSON.stringify(results),
    avgPosition, top3Count, foundCount, scannedAt
  ).run();

  return json({
    id: scanId,
    keyword: keyword.trim(),
    grid_size: size,
    radius_km: radius,
    center: { lat: centerLat, lng: centerLng },
    points: results,
    summary: {
      avg_position: avgPosition,
      top3_count: top3Count,
      found_count: foundCount,
      not_found_count: notFoundCount,
    },
    scanned_at: scannedAt,
  });
}

// GET /api/local-seo/projects/:id/geogrid-history
export async function handleGeoGridHistory(env: Env, userId: string, projectId: string): Promise<Response> {
  const project = await env.DB.prepare(
    'SELECT id FROM seo_projects WHERE id = ? AND user_id = ? AND project_type = ?'
  ).bind(projectId, userId, 'local').first();

  if (!project) return json({ error: 'Local project not found' }, 404);

  const { results } = await env.DB.prepare(
    'SELECT id, keyword, grid_size, radius_km, center_lat, center_lng, avg_position, top3_count, found_count, scanned_at FROM geogrid_scans WHERE project_id = ? ORDER BY scanned_at DESC LIMIT 50'
  ).bind(projectId).all();

  return json({ scans: results });
}

// GET /api/local-seo/geogrid-scans/:scanId
export async function handleGeoGridScanDetail(env: Env, userId: string, scanId: string): Promise<Response> {
  const scan = await env.DB.prepare(`
    SELECT gs.* FROM geogrid_scans gs
    JOIN seo_projects sp ON sp.id = gs.project_id
    WHERE gs.id = ? AND sp.user_id = ?
  `).bind(scanId, userId).first() as any;

  if (!scan) return json({ error: 'Scan not found' }, 404);

  return json({
    id: scan.id,
    keyword: scan.keyword,
    grid_size: scan.grid_size,
    radius_km: scan.radius_km,
    center: { lat: scan.center_lat, lng: scan.center_lng },
    points: JSON.parse(scan.results),
    summary: {
      avg_position: scan.avg_position,
      top3_count: scan.top3_count,
      found_count: scan.found_count,
      not_found_count: (scan.grid_size * scan.grid_size) - scan.found_count,
    },
    scanned_at: scan.scanned_at,
  });
}

// POST /api/local-seo/projects/:id/geogrid-insights
export async function handleGeoGridInsights(request: Request, env: Env, userId: string, projectId: string): Promise<Response> {
  const { scan_id, llm_config } = await request.json() as { scan_id?: string; llm_config?: UserLLMConfig };
  if (!scan_id) return json({ error: 'scan_id is required' }, 400);

  // Load scan + project
  const scan = await env.DB.prepare(`
    SELECT gs.*, sp.name as project_name, sp.business_name, sp.place_id, sp.cid,
           sp.domain, sp.location_code
    FROM geogrid_scans gs
    JOIN seo_projects sp ON sp.id = gs.project_id
    WHERE gs.id = ? AND sp.id = ? AND sp.user_id = ?
  `).bind(scan_id, projectId, userId).first() as any;

  if (!scan) return json({ error: 'Scan not found' }, 404);

  const gridPoints = JSON.parse(scan.results) as Array<{
    row: number; col: number; lat: number; lng: number;
    position: number | null; total_results: number;
    top_competitors?: Array<{ title: string; rating: number | null; reviews: number | null; position: number }>;
  }>;

  const totalPoints = scan.grid_size * scan.grid_size;
  const foundPoints = gridPoints.filter(p => p.position != null);
  const notFoundPoints = gridPoints.filter(p => p.position == null);

  // Aggregate competitor data from "not found" points
  const competitorMap = new Map<string, { rating: number | null; reviews: number | null; appearances: number }>();
  for (const point of notFoundPoints) {
    for (const comp of point.top_competitors || []) {
      if (!comp.title) continue;
      const existing = competitorMap.get(comp.title);
      if (existing) {
        existing.appearances++;
        if (comp.rating != null) existing.rating = comp.rating;
        if (comp.reviews != null && (existing.reviews == null || comp.reviews > existing.reviews)) existing.reviews = comp.reviews;
      } else {
        competitorMap.set(comp.title, { rating: comp.rating, reviews: comp.reviews, appearances: 1 });
      }
    }
  }

  const topCompetitors = Array.from(competitorMap.entries())
    .sort((a, b) => b[1].appearances - a[1].appearances)
    .slice(0, 5)
    .map(([name, data]) => ({ name, ...data }));

  // Fetch GBP profile using the same dual-strategy as handleGBPProfile
  let gbpSummary = 'GBP profile data not available';
  try {
    let biz: any = null;
    const locCode = scan.location_code || 2840;

    // Try my_business_info first
    const gbpKeyword = scan.place_id ? `place_id:${scan.place_id}` : scan.business_name;
    if (gbpKeyword) {
      try {
        const gbpData = await dataforseoRequest(env, '/business_data/google/my_business_info/live', [{
          keyword: gbpKeyword, location_code: locCode, language_code: 'en',
        }]);
        const candidate = gbpData?.tasks?.[0]?.result?.[0];
        if (candidate?.title) biz = candidate;
      } catch { /* fall through to Maps SERP */ }
    }

    // Fallback: Maps SERP search (same as handleGBPProfile)
    if (!biz?.title && scan.business_name) {
      try {
        const searchData = await dataforseoRequest(env, '/serp/google/maps/live/advanced', [{
          keyword: scan.business_name, location_code: locCode, language_code: 'en',
          device: 'desktop', os: 'windows', depth: 10,
        }]);
        const items = searchData?.tasks?.[0]?.result?.[0]?.items || [];
        const mapsItems = items.filter((i: any) => i.type === 'maps_search');
        const match = scan.place_id
          ? mapsItems.find((i: any) => i.place_id === scan.place_id)
          : mapsItems[0];
        if (match) {
          biz = {
            title: match.title, description: match.snippet || null,
            phone: match.phone, url: match.url,
            category: match.category, additional_categories: match.additional_categories || [],
            rating: match.rating, is_claimed: match.is_claimed ?? null,
            work_time: match.work_hours || null, total_photos: match.total_photos ?? (match.main_image ? 1 : 0),
          };
        }
      } catch { /* fall through */ }
    }

    if (biz) {
      const rating = biz.rating?.value ?? biz.rating ?? null;
      const reviewsCount = biz.rating?.votes_count ?? biz.reviews_count ?? null;
      const categories = [biz.category, ...(biz.additional_categories || [])].filter(Boolean);
      const hasDescription = !!(biz.description && biz.description !== biz.address);
      const photoCount = biz.total_photos ?? 0;

      const checks = [
        { label: 'Description', ok: hasDescription },
        { label: 'Phone', ok: !!biz.phone },
        { label: 'Website', ok: !!biz.url },
        { label: 'Hours', ok: !!biz.work_time },
        { label: 'Photos', ok: photoCount > 0 },
        { label: 'Claimed', ok: biz.is_claimed === true },
      ];
      // Mark as "unknown" instead of "missing" when data is null (API limitation)
      const completePct = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
      const missing = checks.filter(c => !c.ok).map(c => c.label);
      const unknown = ['is_claimed', 'total_photos'].filter(f => biz[f] == null);

      gbpSummary = [
        `Rating: ${rating ?? 'N/A'}/5 (${reviewsCount ?? 'unknown'} reviews)`,
        `Categories: ${categories.length > 0 ? categories.join(', ') : 'Not set'}`,
        `Profile completeness: ${completePct}% (based on available data)`,
        missing.length > 0 ? `Missing or not detected: ${missing.join(', ')}` : 'All detected profile fields are complete',
        unknown.length > 0 ? `Note: ${unknown.join(', ')} could not be verified via API (may be present)` : '',
        `Photos: ${photoCount > 0 ? photoCount : 'unknown (API may not report all photos)'}`,
        hasDescription ? `Has description` : 'No description detected',
        biz.phone ? `Phone: ${biz.phone}` : '',
        biz.url ? `Website: ${biz.url}` : '',
        biz.work_time ? 'Business hours are set' : 'Business hours not detected',
      ].filter(Boolean).join('\n');
    }
  } catch { /* use default summary */ }

  // Describe geographic pattern
  const gridSize = scan.grid_size;
  const centerRow = Math.floor(gridSize / 2);
  const centerCol = Math.floor(gridSize / 2);
  const nearCenter = foundPoints.filter(p =>
    Math.abs(p.row - centerRow) <= 1 && Math.abs(p.col - centerCol) <= 1
  ).length;
  const farFromCenter = foundPoints.filter(p =>
    Math.abs(p.row - centerRow) > 1 || Math.abs(p.col - centerCol) > 1
  ).length;

  const geoPattern = foundPoints.length === 0
    ? 'Business was NOT found at any grid point. Zero visibility for this keyword.'
    : foundPoints.length === totalPoints
      ? 'Business found at ALL grid points. Dominant local visibility.'
      : `Found at ${foundPoints.length}/${totalPoints} points. ${nearCenter} near center, ${farFromCenter} at edges. Visibility drops off ${farFromCenter === 0 ? 'quickly beyond immediate location' : 'gradually across the area'}.`;

  // Build competitor summary
  const compSummary = topCompetitors.length > 0
    ? topCompetitors.map(c =>
        `${c.name}: ${c.rating ?? 'N/A'} stars, ${c.reviews ?? 'N/A'} reviews, appeared at ${c.appearances} grid points`
      ).join('\n')
    : 'No competitor data available (business ranked at all points)';

  // Build LLM prompt
  const prompt = `You are an expert local SEO consultant analyzing a GeoGrid visibility scan. Based on the data below, provide specific, actionable recommendations to improve this business's local search visibility.

## Business
Name: ${scan.business_name || scan.project_name}
Keyword scanned: "${scan.keyword}"
Scan radius: ${scan.radius_km}km, Grid: ${scan.grid_size}x${scan.grid_size} (${totalPoints} points)

## GBP Profile
${gbpSummary}

## GeoGrid Results
Found: ${foundPoints.length}/${totalPoints} points
Average position (where found): ${scan.avg_position ?? 'N/A'}
Top 3 positions: ${scan.top3_count} points
Geographic pattern: ${geoPattern}

## Top Competitors in Weak Zones
These businesses rank where ${scan.business_name || 'the target business'} does NOT:
${compSummary}

## Instructions
Return ONLY valid JSON (no markdown, no code fences) with this exact structure:
{
  "visibility_score": <number 0-100 based on coverage and positions>,
  "headline": "<one concise sentence summarizing the situation>",
  "strengths": ["<strength 1>", "<strength 2>"],
  "priority_actions": [
    {
      "title": "<short action title>",
      "impact": "high" | "medium" | "low",
      "category": "gbp" | "reviews" | "content" | "citations" | "engagement",
      "description": "<2-3 sentences of specific, actionable advice>",
      "competitor_insight": "<what top competitors are doing better, or null>"
    }
  ],
  "competitor_gap": "<paragraph analyzing the gap between this business and top competitors>",
  "geographic_insight": "<paragraph about the geographic visibility pattern and what it means>"
}

Rules:
- Give 4-6 priority actions, ranked by impact
- Be SPECIFIC: reference actual competitor names, ratings, review counts from the data
- Each action must be something the business owner can DO, not vague advice
- Visibility score: 0-30 = poor, 31-60 = needs work, 61-80 = good, 81-100 = excellent
- Factor in: coverage %, avg position, GBP completeness, review gap vs competitors
- IMPORTANT: Some GBP fields may show "unknown" or "not detected" due to API limitations. Do NOT report these as missing. Only flag items as missing if explicitly stated. If a field says "unknown" or "could not be verified", assume it may be present and do NOT recommend fixing it.
- Focus recommendations on what IS known: ranking coverage, competitor gaps, and verifiable profile data`;

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const provider = getLLMProvider(env, llm_config);

  try {
    const result = await provider.chatComplete(messages, env, llm_config, 4096);
    let raw = result.text.trim();
    // Strip code fences if present
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let insights;
    try {
      insights = JSON.parse(raw);
    } catch {
      // Try to salvage truncated JSON
      const lastBrace = raw.lastIndexOf('}');
      if (lastBrace > 0) {
        try {
          insights = JSON.parse(raw.substring(0, lastBrace + 1));
        } catch {
          insights = {
            visibility_score: Math.round((foundPoints.length / totalPoints) * 100),
            headline: 'Analysis completed but could not parse detailed recommendations.',
            strengths: [],
            priority_actions: [],
            competitor_gap: raw.substring(0, 500),
            geographic_insight: geoPattern,
          };
        }
      }
    }

    return json({ insights, usage: result.usage });
  } catch (err) {
    return json({ error: `LLM error: ${err instanceof Error ? err.message : 'Unknown error'}` }, 500);
  }
}
