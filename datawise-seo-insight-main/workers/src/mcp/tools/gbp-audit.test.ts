import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv, seedUser } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });

const gbpProfile = vi.fn(async (req: Request, _env?: unknown) => {
  const b = await req.clone().json() as any;
  if (b.place_id === 'ChIJ-missing') return json({ error: 'Business not found' }, 404);
  return json({
    title: 'Acme Plumbing',
    address: '1 Main St, Melbourne VIC',
    phone: '+61 3 9000 0000',
    url: null,
    category: 'Plumber',
    additional_categories: ['Emergency plumber'],
    rating: 4.6,
    rating_distribution: { 1: 2, 2: 1, 3: 3, 4: 10, 5: 70 },
    reviews_count: 86,
    is_claimed: null,
    description: null,
    place_id: b.place_id,
    work_time: { timetable: { monday: [] } },
    total_photos: 0,
  });
});

vi.mock('../../routes/local-seo', () => ({
  handleGBPProfile: (req: Request, env: unknown) => gbpProfile(req, env as never),
  handleLocalProjectReport: vi.fn(async (req: Request, _env: unknown, _uid: string, projectId: string) => {
    if (projectId !== 'lp1') return json({ error: 'Local project not found' }, 404);
    const period = new URL(req.url).searchParams.get('period');
    return json({
      current: { total_keywords: 6, in_pack: 4, avg_pack_position: 2.5, avg_rating: 4.6, total_reviews: 86, distribution: { top3: 3, top10: 1, top20: 0, not_in_pack: 2 }, improved: 2, declined: 1, stable: 3 },
      previous: { total_keywords: 6, in_pack: 3, avg_pack_position: 3.1, avg_rating: 4.5, total_reviews: 80, distribution: { top3: 2, top10: 1, top20: 0, not_in_pack: 3 }, improved: 0, declined: 0, stable: 0 },
      velocity: { current: 6, previous: 4 },
      trend: [{ date: '2026-09-01', avg_pack_position: 3.1, top3: 2, top10: 1, top20: 0, avg_rating: 4.5 }, { date: '2026-09-10', avg_pack_position: 2.5, top3: 3, top10: 1, top20: 0, avg_rating: 4.6 }],
      period_echo: period,
    });
  }),
  handleLocalKeywords: vi.fn(async () => json([
    { id: 'k1', keyword: 'plumber melbourne', pack_position: 2, prev_pack_position: 3, rating: 4.6, reviews_count: 86, checked_at: '2026-09-10' },
    { id: 'k2', keyword: 'emergency plumber', pack_position: null, prev_pack_position: null, rating: null, reviews_count: null, checked_at: '2026-09-10' },
  ])),
  handleGeoGridHistory: vi.fn(async (_env: unknown, _uid: string, projectId: string) =>
    projectId === 'lp1'
      ? json({ scans: [{ id: 'scan-new', keyword: 'plumber melbourne', grid_size: 7, radius_km: 5, avg_position: 4.2, top3_count: 20, found_count: 41, scanned_at: '2026-09-09' }, { id: 'scan-old', keyword: 'plumber melbourne', grid_size: 7, radius_km: 5, avg_position: 6, top3_count: 10, found_count: 30, scanned_at: '2026-08-01' }] })
      : json({ scans: [] })),
  handleGeoGridScanDetail: vi.fn(async (_env: unknown, _uid: string, scanId: string) => json({
    id: scanId, keyword: 'plumber melbourne', grid_size: 7, radius_km: 5, avg_position: 4.2, top3_count: 20, found_count: 41, scanned_at: '2026-09-09',
    competitors: [
      { name: 'Acme Plumbing', appearances: 41, total_points: 49, avg_position: 4.2, best_position: 1, rating: 4.6, reviews: 86, is_user: 1 },
      { name: 'Rival Plumbing', appearances: 49, total_points: 49, avg_position: 1.4, best_position: 1, rating: 4.9, reviews: 410, is_user: 0 },
      { name: 'Other Co', appearances: 30, total_points: 49, avg_position: 5, best_position: 2, rating: 4.1, reviews: 12, is_user: 0 },
    ],
    points: [{ row: 0, col: 0, lat: -37.8, lng: 144.9, position: 1, total_results: 20 }],
  })),
}));

import { gbpAudit } from './gbp-audit';
import * as local from '../../routes/local-seo';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2036, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

async function seedProject(env: any, overrides: Record<string, unknown> = {}) {
  await seedUser(env, { id: 'u1', email: 'a@b.c' }).catch(() => undefined); // once per env
  const row = { id: 'lp1', user_id: 'u1', name: 'Acme', domain: 'acme.com.au', project_type: 'local', place_id: 'ChIJ-acme', cid: '123', business_name: 'Acme Plumbing', location_code: 2036, ...overrides };
  await env.DB.prepare(
    'INSERT INTO seo_projects (id, user_id, name, domain, project_type, place_id, cid, business_name, location_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(row.id, row.user_id, row.name, row.domain, row.project_type, row.place_id, row.cid, row.business_name, row.location_code).run();
  return row;
}

describe('datawise_gbp_audit', () => {
  it('audits a local project: completeness with fixes, pack performance, reviews, geo-grid', async () => {
    const { env } = makeMcpTestEnv();
    await seedProject(env);
    gbpProfile.mockClear();
    const out = await gbpAudit.run(gbpAudit.inputSchema.parse({ project_id: 'lp1' }), { env, identity });
    expect(out.isError).toBeFalsy();
    const s = out.structuredContent as any;

    expect(s.project).toMatchObject({ id: 'lp1', business_name: 'Acme Plumbing', place_id: 'ChIJ-acme', location_code: 2036 });

    // Profile lookup uses the project's place id and locale (never business name when a place id exists).
    const sent = await gbpProfile.mock.calls[0][0].json();
    expect(sent).toEqual({ place_id: 'ChIJ-acme', location_code: 2036, language_code: 'en' });

    // Completeness mirrors GBPProfileCard: description missing, phone ok, website missing,
    // hours ok, photos missing, claimed unknown (excluded from the score).
    const byLabel = Object.fromEntries(s.profile_completeness.checks.map((c: any) => [c.label, c]));
    expect(byLabel['Description'].status).toBe('missing');
    expect(byLabel['Phone'].status).toBe('ok');
    expect(byLabel['Website'].status).toBe('missing');
    expect(byLabel['Hours'].status).toBe('ok');
    expect(byLabel['Photos'].status).toBe('missing');
    expect(byLabel['Claimed'].status).toBe('unknown');
    expect(byLabel['Description'].fix).toMatch(/750-character/);
    expect(byLabel['Claimed'].fix).toBeUndefined();
    expect(s.profile_completeness.score_pct).toBe(40); // 2 ok of 5 verifiable
    expect(s.profile_completeness.missing).toEqual(['Description', 'Website', 'Photos']);
    expect(s.profile_completeness.unverified).toEqual(['Claimed']);

    expect(s.profile).toMatchObject({ title: 'Acme Plumbing', category: 'Plumber', rating: 4.6, reviews_count: 86, phone: '+61 3 9000 0000' });

    expect(s.local_pack).toMatchObject({
      period_days: 30,
      tracked_keywords: 6,
      in_pack: 4,
      avg_pack_position: 2.5,
      previous_avg_pack_position: 3.1,
      distribution: { top3: 3, top10: 1, top20: 0, not_in_pack: 2 },
      improved: 2,
      declined: 1,
    });
    expect(s.local_pack.keywords).toEqual([
      { keyword: 'plumber melbourne', pack_position: 2, prev_position: 3 },
      { keyword: 'emergency plumber', pack_position: null, prev_position: null },
    ]);

    expect(s.reviews).toMatchObject({ rating: 4.6, count: 86, new_this_period: 6, new_previous_period: 4, distribution: { 1: 2, 2: 1, 3: 3, 4: 10, 5: 70 } });

    expect(s.geo_grid).toMatchObject({ scan_id: 'scan-new', keyword: 'plumber melbourne', grid_size: 7, radius_km: 5, found_points: 41, total_points: 49, top3_points: 20, avg_position: 4.2, scanned_at: '2026-09-09' });
    // The member's own listing is removed from the competitor list and competitors keep rating and reviews.
    expect(s.geo_grid.competitors.map((c: any) => c.name)).toEqual(['Rival Plumbing', 'Other Co']);
    expect(s.geo_grid.competitors[0]).toMatchObject({ appearances: 49, avg_position: 1.4, rating: 4.9, reviews: 410 });
    expect(local.handleGeoGridScanDetail).toHaveBeenCalledWith(expect.anything(), 'u1', 'scan-new');
  });

  it('period is passed through and clamps to the report handler range', async () => {
    const { env } = makeMcpTestEnv();
    await seedProject(env);
    const out = await gbpAudit.run(gbpAudit.inputSchema.parse({ project_id: 'lp1', period: 90 }), { env, identity });
    expect((out.structuredContent as any).local_pack.period_days).toBe(90);
    const req = (local.handleLocalProjectReport as any).mock.calls.at(-1)[0] as Request;
    expect(new URL(req.url).searchParams.get('period')).toBe('90');
    expect(() => gbpAudit.inputSchema.parse({ project_id: 'lp1', period: 400 })).toThrow();
  });

  it('returns a clear error for a project that is not a local project of this member', async () => {
    const { env } = makeMcpTestEnv();
    await seedProject(env, { id: 'org1', project_type: 'organic', place_id: null, business_name: null });
    const missing = await gbpAudit.run(gbpAudit.inputSchema.parse({ project_id: 'nope' }), { env, identity });
    expect(missing.isError).toBe(true);
    expect((missing.content[0] as any).text).toMatch(/local project/i);
    const organic = await gbpAudit.run(gbpAudit.inputSchema.parse({ project_id: 'org1' }), { env, identity });
    expect(organic.isError).toBe(true);
    expect((organic.content[0] as any).text).toMatch(/local project/i);
  });

  it('still audits stored data when the profile lookup fails, and says the profile is unavailable', async () => {
    const { env } = makeMcpTestEnv();
    await seedProject(env, { place_id: 'ChIJ-missing' });
    const out = await gbpAudit.run(gbpAudit.inputSchema.parse({ project_id: 'lp1' }), { env, identity });
    expect(out.isError).toBeFalsy();
    const s = out.structuredContent as any;
    expect(s.profile).toBeNull();
    expect(s.profile_completeness).toBeNull();
    expect(s.profile_error).toMatch(/Business not found/);
    expect(s.local_pack.in_pack).toBe(4);
  });

  it('falls back to latest known positions when no checks landed inside the period', async () => {
    const { env } = makeMcpTestEnv();
    await seedProject(env);
    // Period report sees no rows in the window (project last checked long ago)
    // but the keyword list still carries the latest positions.
    (local.handleLocalProjectReport as any).mockImplementationOnce(async () => json({
      current: { total_keywords: 6, in_pack: 0, avg_pack_position: null, avg_rating: null, total_reviews: null, distribution: { top3: 0, top10: 0, top20: 0, not_in_pack: 0 }, improved: 0, declined: 0, stable: 0 },
      previous: { total_keywords: 6, in_pack: 0, avg_pack_position: null, avg_rating: null, total_reviews: null, distribution: { top3: 0, top10: 0, top20: 0, not_in_pack: 0 }, improved: 0, declined: 0, stable: 0 },
      velocity: { current: null, previous: null }, trend: [],
    }));
    (local.handleLocalKeywords as any).mockImplementationOnce(async () => json([
      { id: 'k1', keyword: 'a', pack_position: 1, prev_pack_position: 1, checked_at: '2026-03-01' },
      { id: 'k2', keyword: 'b', pack_position: 5, prev_pack_position: 6, checked_at: '2026-03-01' },
      { id: 'k3', keyword: 'c', pack_position: 12, prev_pack_position: 9, checked_at: '2026-03-01' },
      { id: 'k4', keyword: 'd', pack_position: null, prev_pack_position: null, checked_at: '2026-03-01' },
    ]));
    const out = await gbpAudit.run(gbpAudit.inputSchema.parse({ project_id: 'lp1' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.local_pack.in_pack).toBe(3);
    expect(s.local_pack.avg_pack_position).toBe(6);
    expect(s.local_pack.distribution).toEqual({ top3: 1, top10: 1, top20: 1, not_in_pack: 1 });
    expect(s.local_pack.improved).toBe(1);
    expect(s.local_pack.declined).toBe(1);
    expect(s.local_pack.checks_in_period).toBe(false);
    expect(s.local_pack.last_checked_at).toBe('2026-03-01');
    // Tracked count comes from the keyword list (4), not the stale report (6).
    expect(s.local_pack.tracked_keywords).toBe(4);
    expect((out.content[0] as any).text).toMatch(/3\/4 keywords in the pack/);
    expect((out.content[0] as any).text).toMatch(/last checked 2026-03-01/);
  });

  it('reports no geo-grid scan when the project has none', async () => {
    const { env } = makeMcpTestEnv();
    await seedProject(env, { id: 'lp2' });
    (local.handleLocalProjectReport as any).mockImplementationOnce(async () => json({ current: { total_keywords: 0, in_pack: 0, avg_pack_position: null, avg_rating: null, total_reviews: null, distribution: { top3: 0, top10: 0, top20: 0, not_in_pack: 0 }, improved: 0, declined: 0, stable: 0 }, previous: { total_keywords: 0, in_pack: 0, avg_pack_position: null, avg_rating: null, total_reviews: null, distribution: { top3: 0, top10: 0, top20: 0, not_in_pack: 0 }, improved: 0, declined: 0, stable: 0 }, velocity: { current: null, previous: null }, trend: [] }));
    (local.handleLocalKeywords as any).mockImplementationOnce(async () => json([]));
    const out = await gbpAudit.run(gbpAudit.inputSchema.parse({ project_id: 'lp2' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.geo_grid).toBeNull();
    expect(s.local_pack.tracked_keywords).toBe(0);
    expect(s.local_pack.keywords).toEqual([]);
  });
});
