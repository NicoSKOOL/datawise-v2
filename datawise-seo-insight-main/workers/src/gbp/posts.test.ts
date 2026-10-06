import { describe, it, expect, vi, beforeEach } from 'vitest';

const dfs = vi.hoisted(() => ({ request: vi.fn(), get: vi.fn() }));
vi.mock('../dataforseo/client', () => ({
  dataforseoRequest: (...a: unknown[]) => dfs.request(...a),
  dataforseoGet: (...a: unknown[]) => dfs.get(...a),
}));

import { fetchGbpPosts, normalizePosts } from './posts';

const kvStore = new Map<string, string>();
const env = {
  KV: { get: async (k: string) => kvStore.get(k) ?? null, put: async (k: string, v: string) => { kvStore.set(k, v); } },
  DATAFORSEO_EMAIL: 'e', DATAFORSEO_PASSWORD: 'p',
} as any;
const now = new Date('2026-09-22T00:00:00Z');
const noSleep = async () => {};

beforeEach(() => { kvStore.clear(); dfs.request.mockReset(); dfs.get.mockReset(); });

describe('normalizePosts', () => {
  it('maps items and computes recency', () => {
    const out = normalizePosts([
      { type: 'google_business_post', post_text: 'Spring special on <b>hot water</b>', snippet: null, url: 'https://acme.com.au/offer', images_url: 'https://lh3/1.jpg', timestamp: '2026-09-15 09:00:00 +00:00', links: [{ type: 'link', title: 'Learn more', url: 'https://acme.com.au/offer' }] },
      { type: 'google_business_post', post_text: 'Older', timestamp: '2026-07-01 09:00:00 +00:00', links: null },
    ], now);
    expect(out.posts_count).toBe(2);
    expect(out.last_post_date).toBe('2026-09-15 09:00:00 +00:00');
    expect(out.days_since_last_post).toBe(7);
    expect(out.posts[0]).toEqual({ date: '2026-09-15 09:00:00 +00:00', text: 'Spring special on hot water', url: 'https://acme.com.au/offer', image_url: 'https://lh3/1.jpg', links: [{ title: 'Learn more', url: 'https://acme.com.au/offer' }] });
    expect(out.posts[1].links).toEqual([]);
  });
  it('handles no posts', () => {
    expect(normalizePosts([], now)).toEqual({ posts_count: 0, last_post_date: null, days_since_last_post: null, posts: [] });
  });
});

describe('fetchGbpPosts', () => {
  it('posts a task with the exact body, polls, normalises and caches', async () => {
    dfs.request.mockResolvedValueOnce({ tasks: [{ id: 'task-1' }] });
    dfs.get
      .mockResolvedValueOnce({ tasks: [{ status_code: 40602 }] })
      .mockResolvedValueOnce({ tasks: [{ status_code: 20000, result: [{ items: [{ type: 'google_business_post', post_text: 'Hi', timestamp: '2026-09-20 00:00:00 +00:00' }] }] }] });
    const out = await fetchGbpPosts(env, { keyword: 'cid:123', location_code: 2036, language_code: 'en', now, sleep: noSleep });
    expect(dfs.request).toHaveBeenCalledWith(env, '/business_data/google/my_business_updates/task_post', [{ keyword: 'cid:123', location_code: 2036, language_code: 'en', depth: 10 }]);
    expect(dfs.get).toHaveBeenLastCalledWith(env, '/business_data/google/my_business_updates/task_get/task-1');
    expect(out.posts_count).toBe(1);
    expect(out.days_since_last_post).toBe(2);
    expect(kvStore.has('gbp-posts:v1:cid:123:10')).toBe(true);

    const again = await fetchGbpPosts(env, { keyword: 'cid:123', location_code: 2036, language_code: 'en', now, sleep: noSleep });
    expect(again.posts_count).toBe(1);
    expect(dfs.request).toHaveBeenCalledTimes(1);
  });
  it('throws a plain error when the task never completes', async () => {
    dfs.request.mockResolvedValueOnce({ tasks: [{ id: 'task-2' }] });
    dfs.get.mockResolvedValue({ tasks: [{ status_code: 40602 }] });
    await expect(fetchGbpPosts(env, { keyword: 'cid:1', location_code: 2840, language_code: 'en', now, sleep: noSleep })).rejects.toThrow('Google posts task timed out');
  });
  it('throws when no task id comes back', async () => {
    dfs.request.mockResolvedValueOnce({ tasks: [] });
    await expect(fetchGbpPosts(env, { keyword: 'cid:1', location_code: 2840, language_code: 'en', now, sleep: noSleep })).rejects.toThrow('Failed to create Google posts task');
  });
  it('ignores corrupted cache and fetches fresh', async () => {
    kvStore.set('gbp-posts:v1:cid:777:10', '{not json');
    dfs.request.mockResolvedValueOnce({ tasks: [{ id: 'task-3' }] });
    dfs.get.mockResolvedValueOnce({ tasks: [{ status_code: 20000, result: [{ items: [{ type: 'google_business_post', post_text: 'Fresh', timestamp: '2026-09-20 00:00:00 +00:00' }] }] }] });
    const out = await fetchGbpPosts(env, { keyword: 'cid:777', location_code: 2840, language_code: 'en', now, sleep: noSleep });
    expect(dfs.request).toHaveBeenCalledTimes(1);
    expect(out.posts_count).toBe(1);
    const cacheValue = kvStore.get('gbp-posts:v1:cid:777:10');
    expect(cacheValue).toBeTruthy();
    expect(JSON.parse(cacheValue!)).toEqual([{ type: 'google_business_post', post_text: 'Fresh', timestamp: '2026-09-20 00:00:00 +00:00' }]);
  });
});
