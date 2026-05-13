import type { Env } from '../index';
import { dataforseoRequest, dataforseoRequestCached, dataforseoGetCached, extractResult } from '../dataforseo/client';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// --- Rate limiting ----------------------------------------------------------

const PER_IP_DAILY_LIMIT = 3;        // per tool per IP per UTC day
const GLOBAL_DAILY_REQUEST_CAP = 300; // hard stop across all tools per UTC day
                                      // At ~$0.02 avg cost per request, this caps spend near $6/day

function utcDay(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

interface RateLimitResult {
  allowed: boolean;
  reason?: 'ip_limit' | 'global_limit';
  used?: number;
  limit?: number;
}

async function checkAndIncrementRate(env: Env, ip: string, tool: string): Promise<RateLimitResult> {
  const day = utcDay();
  const ipKey = `publictool:${tool}:${ip}:${day}`;
  const globalKey = `publictool:global:${day}`;

  const [ipRaw, globalRaw] = await Promise.all([
    env.KV.get(ipKey),
    env.KV.get(globalKey),
  ]);

  const ipUsed = parseInt(ipRaw || '0', 10) || 0;
  const globalUsed = parseInt(globalRaw || '0', 10) || 0;

  if (ipUsed >= PER_IP_DAILY_LIMIT) {
    return { allowed: false, reason: 'ip_limit', used: ipUsed, limit: PER_IP_DAILY_LIMIT };
  }
  if (globalUsed >= GLOBAL_DAILY_REQUEST_CAP) {
    return { allowed: false, reason: 'global_limit' };
  }

  // Increment both counters, TTL 36h so they roll over cleanly at UTC midnight
  const ttl = 60 * 60 * 36;
  await Promise.all([
    env.KV.put(ipKey, String(ipUsed + 1), { expirationTtl: ttl }),
    env.KV.put(globalKey, String(globalUsed + 1), { expirationTtl: ttl }),
  ]);

  return { allowed: true, used: ipUsed + 1, limit: PER_IP_DAILY_LIMIT };
}

function rateLimitResponse(result: RateLimitResult): Response {
  if (result.reason === 'ip_limit') {
    return json(
      {
        error: 'daily_limit_reached',
        message: `You've used all ${result.limit} free runs today. Free tools reset at midnight UTC.`,
        limit: result.limit,
        used: result.used,
      },
      429
    );
  }
  return json(
    {
      error: 'service_busy',
      message: 'The free tool has hit its daily usage cap. Come back tomorrow, or sign up for unlimited access.',
    },
    429
  );
}

function validateKeyword(kw: unknown): kw is string {
  return typeof kw === 'string' && kw.trim().length >= 2 && kw.length <= 120;
}

// --- 1) Related Keywords (public, capped at 25 results) ---------------------

export async function handleRelatedKeywordsPublic(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
  const location_code = typeof body.location_code === 'number' ? body.location_code : 2840;
  const language_code = typeof body.language_code === 'string' ? body.language_code : 'en';

  if (!validateKeyword(keyword)) {
    return json({ error: 'keyword is required (2-120 chars)' }, 400);
  }

  const ip = clientIp(request);
  const rl = await checkAndIncrementRate(env, ip, 'related-keywords');
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const [relatedData, ideasData] = await Promise.all([
      dataforseoRequest(env, '/dataforseo_labs/google/related_keywords/live', [{
        keyword,
        location_code,
        language_code,
        include_seed_keyword: true,
        limit: 50,
        depth: 2,
        filters: [['keyword_data.keyword_info.search_volume', '>', 0]],
      }]),
      dataforseoRequest(env, '/dataforseo_labs/google/keyword_ideas/live', [{
        keywords: [keyword],
        location_code,
        language_code,
        limit: 50,
        filters: [['keyword_info.search_volume', '>', 0]],
        order_by: ['keyword_info.search_volume,desc'],
      }]),
    ]);

    const seen = new Set<string>();
    const merged: Array<{ keyword: string; volume: number; cpc: number; competition: string }> = [];
    const push = (kw: string | undefined, volume: number, cpc: number, competition: string) => {
      if (!kw) return;
      const k = kw.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      merged.push({ keyword: kw, volume: volume || 0, cpc: cpc || 0, competition: competition || 'UNKNOWN' });
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rItems = (relatedData as any)?.tasks?.[0]?.result?.[0]?.items || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of rItems as any[]) {
      push(
        item?.keyword_data?.keyword,
        item?.keyword_data?.keyword_info?.search_volume,
        item?.keyword_data?.keyword_info?.cpc,
        item?.keyword_data?.keyword_info?.competition_level
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iItems = (ideasData as any)?.tasks?.[0]?.result?.[0]?.items || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of iItems as any[]) {
      push(
        item?.keyword,
        item?.keyword_info?.search_volume,
        item?.keyword_info?.cpc,
        item?.keyword_info?.competition_level
      );
    }

    merged.sort((a, b) => b.volume - a.volume);
    const capped = merged.slice(0, 25);

    return json({
      keyword,
      location_code,
      language_code,
      results: capped,
      quota: { used: rl.used, limit: rl.limit },
    });
  } catch (err) {
    return json({ error: 'Upstream API failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// --- 2) Keyword Difficulty (public, capped at 5 keywords) -------------------

export async function handleKeywordDifficultyPublic(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const rawKeywords = Array.isArray(body.keywords) ? body.keywords : [];
  const location_code = typeof body.location_code === 'number' ? body.location_code : 2840;
  const language_code = typeof body.language_code === 'string' ? body.language_code : 'en';

  const keywords = rawKeywords
    .filter((k): k is string => validateKeyword(k))
    .map((k) => k.trim())
    .slice(0, 5);

  if (keywords.length === 0) {
    return json({ error: 'keywords array is required (1-5 items)' }, 400);
  }

  const ip = clientIp(request);
  const rl = await checkAndIncrementRate(env, ip, 'keyword-difficulty');
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const data = await dataforseoRequest(env, '/dataforseo_labs/google/bulk_keyword_difficulty/live', [{
      keywords,
      location_code,
      language_code,
    }]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (data as any)?.tasks?.[0]?.result?.[0]?.items || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (items as any[]).map((item) => ({
      keyword: item?.keyword,
      score: typeof item?.keyword_difficulty === 'number' ? Math.round(item.keyword_difficulty) : null,
    }));

    // Preserve user order even if DFS returns different ordering
    const byKeyword = new Map<string, { keyword: string; score: number | null }>(
      results.filter((r) => r.keyword).map((r) => [r.keyword.toLowerCase(), r])
    );
    const ordered = keywords.map((kw) =>
      byKeyword.get(kw.toLowerCase()) || { keyword: kw, score: null }
    );

    return json({
      location_code,
      language_code,
      results: ordered,
      quota: { used: rl.used, limit: rl.limit },
    });
  } catch (err) {
    return json({ error: 'Upstream API failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// --- 3) Fan-Out Queries (public, real data via LLM Mentions) ---------------

export async function handleFanOutQueriesPublic(request: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
  // Match app defaults: platform 'google' = Google AI Overview, 'chat_gpt' = ChatGPT
  const rawPlatform = typeof body.platform === 'string' ? body.platform : 'google';
  const platform = rawPlatform === 'chat_gpt' ? 'chat_gpt' : 'google';
  const location_code = typeof body.location_code === 'number' ? body.location_code : 2840;
  const language_code = typeof body.language_code === 'string' ? body.language_code : 'en';

  if (!validateKeyword(keyword) || keyword.length < 3) {
    return json(
      {
        error: 'invalid_keyword',
        message: `"${keyword}" is too short. Try at least 3 characters.`,
      },
      400
    );
  }

  const ip = clientIp(request);
  const rl = await checkAndIncrementRate(env, ip, 'fan-out-queries');
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    // Step 1: llm_mentions/search to collect questions + fan_out_queries
    const searchData = await dataforseoRequestCached(
      env,
      '/ai_optimization/llm_mentions/search/live',
      [{
        target: [{ keyword, match_type: 'partial_match' }],
        platform,
        location_code,
        language_code,
        limit: 100,
      }],
      { ttlSeconds: 21600 }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchResult = extractResult(searchData) as any;
    const searchRows: Array<{ question?: string; fan_out_queries?: string[] }> =
      searchResult?.items || [];

    // Dedupe across questions + fan_out_queries, prefer 'Fan-out' label when a
    // query appears as a fan_out of another row.
    const seen = new Map<string, { raw: string; sourceCount: number; type: 'Fan-out' | 'Question' }>();

    for (const row of searchRows) {
      const q = row.question?.trim();
      if (q) {
        const key = q.toLowerCase();
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, { raw: q, sourceCount: 1, type: 'Question' });
        } else {
          existing.sourceCount += 1;
        }
      }
      for (const fq of row.fan_out_queries || []) {
        const f = fq?.trim();
        if (!f) continue;
        const key = f.toLowerCase();
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, { raw: f, sourceCount: 1, type: 'Fan-out' });
        } else {
          existing.sourceCount += 1;
          // Upgrade to Fan-out if we discovered it via fan_out_queries
          existing.type = 'Fan-out';
        }
      }
    }

    const candidates = Array.from(seen.values())
      .sort((a, b) => b.sourceCount - a.sourceCount)
      .slice(0, 50); // cap before volume enrichment to control cost

    if (candidates.length === 0) {
      return json({
        keyword,
        platform,
        results: [],
        quota: { used: rl.used, limit: rl.limit },
      });
    }

    // Step 2: enrich with AI search volume (keeps UX parity with the app)
    let volumeMap = new Map<string, number>();
    try {
      const volData = await dataforseoRequestCached(
        env,
        '/ai_optimization/ai_keyword_data/keywords_search_volume/live',
        [{
          keywords: candidates.map((c) => c.raw.toLowerCase()),
          location_code,
          language_code,
        }],
        { ttlSeconds: 86400 }
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const volResult = extractResult(volData) as any;
      const volItems: Array<{ keyword: string; ai_search_volume: number }> = volResult?.items || [];
      volumeMap = new Map(volItems.map((i) => [i.keyword.toLowerCase(), i.ai_search_volume || 0]));
    } catch {
      // volume enrichment is best-effort; rows still ship with source_count ordering
    }

    const enriched = candidates
      .map((c) => ({
        query: c.raw,
        ai_search_volume: volumeMap.get(c.raw.toLowerCase()) || 0,
        source_count: c.sourceCount,
        type: c.type,
      }))
      .sort((a, b) => {
        // Primary: volume desc, secondary: source_count desc
        if (b.ai_search_volume !== a.ai_search_volume) return b.ai_search_volume - a.ai_search_volume;
        return b.source_count - a.source_count;
      })
      .slice(0, 10);

    return json({
      keyword,
      platform,
      results: enriched,
      quota: { used: rl.used, limit: rl.limit },
    });
  } catch (err) {
    return json({ error: 'Upstream API failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}

// --- 4) Business Categories Explorer (public, master GBP categories list) ---

export async function handleBusinessCategoriesPublic(request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);
  const rl = await checkAndIncrementRate(env, ip, 'business-categories');
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    // Master Google Business Profile category list. Cached 30 days — list is essentially static.
    const data = await dataforseoGetCached(
      env,
      '/business_data/business_listings/categories',
      { ttlSeconds: 60 * 60 * 24 * 30, timeoutMs: 30_000 }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (data as any)?.tasks?.[0]?.result;
    // The categories endpoint returns the list directly under tasks[0].result
    // (each item is { category: string } or similar). Normalize defensively.
    const rawItems: unknown[] = Array.isArray(result) ? result : [];
    const categories = rawItems
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((it: any) => {
        if (typeof it === 'string') return { category: it };
        if (it && typeof it === 'object') {
          const category = it.category ?? it.category_name ?? it.title ?? null;
          if (!category) return null;
          return {
            category: String(category),
            ...(typeof it.business_count === 'number' ? { business_count: it.business_count } : {}),
          };
        }
        return null;
      })
      .filter((c): c is { category: string; business_count?: number } => c !== null);

    return json({
      categories,
      count: categories.length,
      quota: { used: rl.used, limit: rl.limit },
    });
  } catch (err) {
    return json({ error: 'Upstream API failed', detail: err instanceof Error ? err.message : String(err) }, 502);
  }
}
