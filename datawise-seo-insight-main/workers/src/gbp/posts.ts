// Google Business posts via DataForSEO my_business_updates. Async only
// (task_post then task_get), the same flow routes/local-seo.ts uses for
// reviews. Results are cached in KV for a day per business.
import { dataforseoRequest, dataforseoGet, type DataForSeoEnv } from '../dataforseo/client';
import { stripHtml } from '../mcp/shape';

export interface GbpPost { date: string | null; text: string; url: string | null; image_url: string | null; links: Array<{ title: string | null; url: string }> }
export interface GbpPosts { posts_count: number; last_post_date: string | null; days_since_last_post: number | null; posts: GbpPost[] }

const POLL_DELAYS_MS = [2000, 2000, 3000, 3000, 4000];
const TTL_SECONDS = 86400;

export function normalizePosts(items: any[], now: Date): GbpPosts {
  const posts: GbpPost[] = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({
      date: typeof it.timestamp === 'string' ? it.timestamp : (typeof it.post_date === 'string' ? it.post_date : null),
      text: stripHtml([it.post_text, it.snippet].filter((t) => typeof t === 'string' && t.trim()).join(' ')),
      url: typeof it.url === 'string' ? it.url : null,
      image_url: typeof it.images_url === 'string' ? it.images_url : null,
      links: (Array.isArray(it.links) ? it.links : []).filter((l: any) => typeof l?.url === 'string').map((l: any) => ({ title: typeof l.title === 'string' ? l.title : null, url: l.url })),
    }));
  const dated = posts.map((p) => (p.date ? Date.parse(p.date) : NaN)).filter((t) => Number.isFinite(t));
  const last = dated.length ? Math.max(...dated) : null;
  const lastPost = last !== null ? posts.find((p) => p.date && Date.parse(p.date) === last) ?? null : null;
  return {
    posts_count: posts.length,
    last_post_date: lastPost?.date ?? null,
    days_since_last_post: last !== null ? Math.max(0, Math.round((now.getTime() - last) / 86_400_000)) : null,
    posts,
  };
}

export async function fetchGbpPosts(env: DataForSeoEnv, opts: {
  keyword: string; location_code: number; language_code: string; depth?: number; now?: Date; sleep?: (ms: number) => Promise<void>;
}): Promise<GbpPosts> {
  const depth = opts.depth ?? 10;
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cacheKey = `gbp-posts:v1:${opts.keyword}:${depth}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        return normalizePosts(parsed, now);
      }
    } catch {
      // Ignore parse error or non-array value, fall through to fresh fetch
    }
  }

  const post = await dataforseoRequest(env, '/business_data/google/my_business_updates/task_post', [{
    keyword: opts.keyword, location_code: opts.location_code, language_code: opts.language_code, depth,
  }]);
  const taskId = post?.tasks?.[0]?.id;
  if (!taskId) throw new Error('Failed to create Google posts task');

  for (const delay of POLL_DELAYS_MS) {
    await sleep(delay);
    const got = await dataforseoGet(env, `/business_data/google/my_business_updates/task_get/${taskId}`);
    const task = got?.tasks?.[0];
    if (task?.status_code === 20000 && Array.isArray(task?.result)) {
      const items = task.result[0]?.items ?? [];
      await env.KV.put(cacheKey, JSON.stringify(items), { expirationTtl: TTL_SECONDS });
      return normalizePosts(items, now);
    }
  }
  throw new Error('Google posts task timed out');
}
