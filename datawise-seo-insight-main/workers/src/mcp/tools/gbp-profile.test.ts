import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const dfs = vi.hoisted(() => ({ request: vi.fn(), cached: vi.fn(), get: vi.fn() }));
vi.mock('../../dataforseo/client', () => ({
  dataforseoRequest: (...a: unknown[]) => dfs.request(...a),
  dataforseoRequestCached: (...a: unknown[]) => dfs.cached(...a),
  dataforseoGet: (...a: unknown[]) => dfs.get(...a),
}));

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const reviews = vi.fn(async (_req: Request) => json({
  rating: 4.6, reviews_count: 86, place_id: 'ChIJ-acme', rating_distribution: { '5': 70 },
  reviews: [
    { rating: 5, text: 'Hot water fixed', author: 'A', date: '2026-09-01 10:00:00 +00:00', owner_response: 'Thanks', owner_response_date: '2026-09-02 10:00:00 +00:00' },
    { rating: 2, text: 'Drain still blocked', author: 'B', date: '2026-08-20 10:00:00 +00:00', owner_response: null, owner_response_date: null },
  ],
}));
vi.mock('../../routes/local-seo', async (importActual) => {
  const actual = await importActual<typeof import('../../routes/local-seo')>();
  return { ...actual, handleReviews: (req: Request, env: unknown, uid?: string) => reviews(req) };
});

// Controller ruling 1: fetchGbpPosts sleeps 2s+ between polls by default.
// Partially mock the posts module so the real function runs with a no-op
// sleep, keeping the DataForSEO body assertions exact.
vi.mock('../../gbp/posts', async (importActual) => {
  const actual = await importActual<typeof import('../../gbp/posts')>();
  return { ...actual, fetchGbpPosts: (env: any, opts: any) => actual.fetchGbpPosts(env, { ...opts, sleep: async () => {} }) };
});

import { gbpProfile } from './gbp-profile';
import { ALL_TOOLS } from './registry';
import { estimateCostUsd } from '../budget';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

const businessItem = {
  title: 'Acme Plumbing', place_id: 'ChIJ-acme', cid: '123456789012', category: 'Plumber', additional_categories: ['Emergency plumber'],
  address: '1 Main St, Richmond VIC 3121, Australia', address_info: { address: '1 Main St', city: 'Richmond', zip: '3121', region: 'Victoria', country_code: 'AU' },
  phone: '+61 3 9000 0000', url: 'https://acme.com.au/', rating: { value: 4.6, votes_count: 86 }, is_claimed: true, total_photos: 42,
  work_time: { work_hours: { timetable: { monday: [{ open: { hour: 8, minute: 0 }, close: { hour: 17, minute: 0 } }] } } },
  services: [{ category: 'Plumber', title: 'Blocked drains', snippet: null, price: null }],
};
const infoResponse = { tasks: [{ result: [{ keyword: 'cid:123456789012', items: [businessItem] }] }] };

beforeEach(() => {
  dfs.request.mockReset(); dfs.cached.mockReset(); dfs.get.mockReset(); reviews.mockClear();
  dfs.cached.mockResolvedValue(infoResponse);
  dfs.request.mockImplementation(async (_env: unknown, endpoint: string) => {
    if (endpoint.endsWith('my_business_updates/task_post')) return { tasks: [{ id: 'pt' }] };
    return {};
  });
  dfs.get.mockResolvedValue({ tasks: [{ status_code: 20000, result: [{ items: [{ type: 'google_business_post', post_text: 'Offer', timestamp: '2026-09-20 00:00:00 +00:00' }] }] }] });
});

describe('datawise_gbp_profile', () => {
  it('resolves a cid, fetches the profile with the exact body, infers AU for reviews and posts', async () => {
    const { env } = makeMcpTestEnv();
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'cid:123456789012' }), { env, identity });
    const s = out.structuredContent as any;
    expect(out.isError).toBeFalsy();
    expect(s.resolved_from).toBe('cid');
    expect(dfs.cached).toHaveBeenCalledWith(expect.anything(), '/business_data/google/my_business_info/live', [{ keyword: 'cid:123456789012', location_code: 2840, language_code: 'en' }], { ttlSeconds: 86400 });
    expect(s.profile.identity.title).toBe('Acme Plumbing');
    expect(s.profile.services[0].title).toBe('Blocked drains');
    expect(s.inferred_location_code).toBe(2036);
    // Reviews go through the app handler with the same body the SPA sends.
    const sent = await reviews.mock.calls[0][0].clone().json();
    expect(sent).toEqual({ cid: '123456789012', depth: 20, sort_by: 'newest', location_code: 2036, language_code: 'en' });
    expect(s.reviews.summary.reply_rate_pct).toBe(50);
    expect(s.reviews.items).toHaveLength(2);
    expect(dfs.request).toHaveBeenCalledWith(expect.anything(), '/business_data/google/my_business_updates/task_post', [{ keyword: 'cid:123456789012', location_code: 2036, language_code: 'en', depth: 10 }]);
    expect(s.posts.posts_count).toBe(1);
    expect(out.content[0].text).toContain('Acme Plumbing');
  });

  it('prefers place_id over cid from a Maps link and skips reviews and posts when asked', async () => {
    const { env } = makeMcpTestEnv();
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4', include_reviews: false, include_posts: false }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.resolved_from).toBe('maps_url');
    expect(dfs.cached.mock.calls[0][2]).toEqual([{ keyword: 'place_id:ChIJN1t_tDeuEmsRUsoyG83frY4', location_code: 2840, language_code: 'en' }]);
    expect(reviews).not.toHaveBeenCalled();
    expect(s.reviews).toBeNull();
    expect(s.posts).toBeNull();
  });

  it('name search: returns candidates when the top hit is not a clear match', async () => {
    const { env } = makeMcpTestEnv();
    dfs.request.mockResolvedValueOnce({ tasks: [{ result: [{ items: [
      { type: 'maps_search', title: 'Acme Roofing', place_id: 'p1', cid: 'c1', address: 'A', category: 'Roofer', rating: { value: 4, votes_count: 5 }, url: 'https://roof.example' },
      { type: 'maps_search', title: 'Acme Plumbing Pty', place_id: 'p2', cid: 'c2', address: 'B', category: 'Plumber', rating: { value: 4.6, votes_count: 86 }, url: 'https://acme.com.au' },
    ] }] }] });
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'Acme Plumbing, Melbourne' }), { env, identity });
    const s = out.structuredContent as any;
    expect(dfs.request).toHaveBeenCalledWith(expect.anything(), '/serp/google/maps/live/advanced', [{ keyword: 'Acme Plumbing, Melbourne', location_code: 2840, language_code: 'en', device: 'desktop', os: 'windows', depth: 10 }]);
    expect(s.profile).toBeNull();
    expect(s.candidates).toHaveLength(2);
    expect(s.candidates[1]).toEqual({ title: 'Acme Plumbing Pty', place_id: 'p2', cid: 'c2', address: 'B', category: 'Plumber', rating: 4.6, reviews_count: 86, website: 'https://acme.com.au' });
    expect(dfs.cached).not.toHaveBeenCalled();
    expect(out.content[0].text).toContain('call again');
  });

  it('name search: uses the top hit when its title contains every word of the name', async () => {
    const { env } = makeMcpTestEnv();
    dfs.request.mockResolvedValueOnce({ tasks: [{ result: [{ items: [
      { type: 'maps_search', title: 'Acme Plumbing Pty Ltd', place_id: 'p2', cid: 'c2' },
      { type: 'maps_search', title: 'Other', place_id: 'p3', cid: 'c3' },
    ] }] }] });
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'acme plumbing, Melbourne', include_reviews: false, include_posts: false }), { env, identity });
    expect((out.structuredContent as any).resolved_from).toBe('name_search');
    // Controller ruling 3: keywordFor prefers place_id, so the top hit
    // resolves to place_id:p2, not cid:c2.
    expect(dfs.cached.mock.calls[0][2]).toEqual([{ keyword: 'place_id:p2', location_code: 2840, language_code: 'en' }]);
  });

  it('keeps the profile when reviews or posts fail', async () => {
    const { env } = makeMcpTestEnv();
    reviews.mockResolvedValueOnce(json({ error: 'Reviews task timed out or returned no data' }, 504));
    dfs.get.mockResolvedValue({ tasks: [{ status_code: 40602 }] });
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.profile.identity.title).toBe('Acme Plumbing');
    expect(s.reviews).toBeNull();
    expect(s.reviews_error).toContain('timed out');
    expect(s.posts).toBeNull();
    expect(s.posts_error).toContain('timed out');
  });

  it('returns a tool error when the business is not found', async () => {
    const { env } = makeMcpTestEnv();
    dfs.cached.mockResolvedValue({ tasks: [{ result: [{ items: [] }] }] });
    // A 12-digit CID matches the CID pattern, so this exercises the
    // profile-not-found branch directly rather than falling through to the
    // name-search path (which a short, non-CID-shaped "cid:999" would hit).
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'cid:999000111222' }), { env, identity });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('Business not found on Google for cid:999000111222');
    expect(dfs.request).not.toHaveBeenCalled();
  });

  it('strips HTML and caps the business name in the summary line', async () => {
    const { env } = makeMcpTestEnv();
    dfs.cached.mockResolvedValueOnce({
      tasks: [{ result: [{ keyword: 'cid:123456789012', items: [{ ...businessItem, title: `<b>${'Acme Plumbing '.repeat(15)}</b>` }] }] }],
    });
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'cid:123456789012', include_reviews: false, include_posts: false }), { env, identity });
    expect(out.content[0].text).not.toContain('<b>');
    const title = out.content[0].text.split(',')[0];
    expect(title.length).toBeLessThanOrEqual(120);
  });

  it('is registered at position 15 with a budget line', () => {
    expect(ALL_TOOLS[14].name).toBe('datawise_gbp_profile');
    expect(estimateCostUsd('datawise_gbp_profile', { include_reviews: true, reviews_depth: 20, include_posts: true })).toBeCloseTo(0.0054 * 2 + 0.003 + 0.003 + 0.01, 5);
    expect(estimateCostUsd('datawise_gbp_profile', { include_reviews: false, include_posts: false })).toBeCloseTo(0.0054 + 0.003, 5);
  });
});
