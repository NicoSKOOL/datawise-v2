import { z } from 'zod';
import { defineTool, localeInputs, shapeFor } from './types';
import { callJson, readJson, HandlerError } from '../call-handler';
import { asWorkerEnv } from '../env';
import { toolResult, toolError, compact } from '../shape';
import {
  handleGBPProfile, handleLocalProjectReport, handleLocalKeywords,
  handleGeoGridHistory, handleGeoGridScanDetail,
} from '../../routes/local-seo';

// Read-only audit of a member's own Local Pack project. Everything except the
// profile lookup comes from D1 (rank history, review snapshots, geo-grid
// scans). The profile lookup goes through handleGBPProfile, which is KV-cached
// for 24 hours, so at most one small DataForSEO call per business per day.
//
// The completeness checks and fix text are the same six the app's GBP card
// shows (src/components/local-seo/GBPProfileCard.tsx). Keep them in step: the
// assistant repeats this text to the member as the recommendation.

interface Check { label: string; status: 'ok' | 'missing' | 'unknown'; fix?: string }

export function completenessChecks(profile: any): Check[] {
  const checks: Array<Check & { fix: string }> = [
    {
      label: 'Description',
      status: profile.description && profile.description !== profile.address ? 'ok' : 'missing',
      fix: 'Add a 750-character business description with your primary keywords and services. Include your city or neighbourhood to boost local relevance.',
    },
    {
      label: 'Phone',
      status: profile.phone ? 'ok' : 'missing',
      fix: 'Add a local phone number (not toll-free). Google prioritises local area codes for local pack rankings.',
    },
    {
      label: 'Website',
      status: profile.url ? 'ok' : 'missing',
      fix: 'Link your website. Use a location-specific landing page (for example /melbourne) rather than your homepage for stronger local signals.',
    },
    {
      label: 'Hours',
      status: profile.work_time ? 'ok' : 'missing',
      fix: 'Set your business hours including special hours for holidays. Profiles with hours get more engagement and rank higher in "open now" searches.',
    },
    {
      label: 'Photos',
      status: (profile.total_photos ?? 0) > 0 ? 'ok' : 'missing',
      fix: 'Upload at least 10 high-quality photos (exterior, interior, products, team). Businesses with 100+ photos get far more calls than average.',
    },
    {
      label: 'Claimed',
      status: profile.is_claimed === true ? 'ok' : profile.is_claimed === false ? 'missing' : 'unknown',
      fix: 'Claim and verify your listing at business.google.com. Unclaimed profiles cannot be optimised and are open to competitor edits.',
    },
  ];
  // Only failing checks carry the fix text; the assistant should not tell a
  // member to fix something that is fine or that we could not verify.
  return checks.map((c) => (c.status === 'missing' ? c : { label: c.label, status: c.status }));
}

export function completenessSummary(checks: Check[]) {
  const verifiable = checks.filter((c) => c.status !== 'unknown');
  const ok = verifiable.filter((c) => c.status === 'ok').length;
  return {
    score_pct: verifiable.length ? Math.round((ok / verifiable.length) * 100) : null,
    checks,
    missing: checks.filter((c) => c.status === 'missing').map((c) => c.label),
    unverified: checks.filter((c) => c.status === 'unknown').map((c) => c.label),
  };
}

const PROFILE_FIELDS = ['title', 'address', 'phone', 'url', 'category', 'additional_categories', 'rating', 'reviews_count', 'is_claimed', 'description', 'place_id', 'total_photos'];

function pick(row: Record<string, unknown>, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  return out;
}

export const gbpAudit = defineTool({
  name: 'datawise_gbp_audit',
  description:
    'Use this to audit one of the member\'s own DataWise Local Pack projects (Google Business Profile). Returns the profile with a completeness score and the exact fix for each missing field, local pack performance for the period (keywords in the pack, average position, top 3 / top 10 / not in pack, improved and declined, each keyword\'s current and previous position), the review picture (rating, count, new reviews this period versus last, star distribution), and the latest geo-grid scan (coverage, average position, and the competitors that outrank the business with their rating and review counts). ' +
    'Reads stored DataWise data; the only cost is one small profile lookup, cached for a day. Get project_id from datawise_rank_tracking list_projects (project_type local). Use datawise_local_reviews for review text, and datawise_ai_visibility for AI engines.',
  inputSchema: z.object({
    project_id: z.string().min(1).describe('A local project id from datawise_rank_tracking list_projects.'),
    period: z.number().int().min(7).max(365).default(30).describe('Days for the local pack and review comparison. The previous period of the same length is the baseline.'),
    response_format: localeInputs.response_format,
  }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);

    const project = await env.DB.prepare(
      'SELECT id, name, domain, project_type, place_id, cid, business_name, location_code FROM seo_projects WHERE id = ? AND user_id = ?'
    ).bind(args.project_id, uid).first<any>();
    if (!project || project.project_type !== 'local') {
      return toolError('No local project with that id. Use datawise_rank_tracking list_projects and pick one with project_type local.');
    }
    const locationCode = project.location_code ?? ctx.identity.defaultLocationCode;

    // Stored data first (never fails for a valid project), then the profile.
    const reportReq = new Request(`https://mcp.internal/report?period=${args.period}`, { method: 'GET' });
    const [report, keywordRows, history] = await Promise.all([
      readJson<any>(await handleLocalProjectReport(reportReq, env, uid, project.id)),
      readJson<any[]>(await handleLocalKeywords(env, uid, project.id)),
      readJson<any>(await handleGeoGridHistory(env, uid, project.id)),
    ]);

    let profile: Record<string, unknown> | null = null;
    let profileError: string | null = null;
    try {
      const ident = project.place_id ? { place_id: project.place_id } : { business_name: project.business_name };
      const raw = await callJson<any>(ctx.env, uid, (req, e) => handleGBPProfile(req, e), {
        ...ident,
        location_code: locationCode,
        language_code: ctx.identity.defaultLanguageCode,
      });
      profile = raw;
    } catch (err) {
      if (err instanceof HandlerError && err.status < 500) profileError = err.message;
      else throw err;
    }

    const latestScan = Array.isArray(history?.scans) && history.scans.length ? history.scans[0] : null;
    let geoGrid: Record<string, unknown> | null = null;
    if (latestScan) {
      const detail = await readJson<any>(await handleGeoGridScanDetail(env, uid, latestScan.id));
      const gridSize = detail.grid_size ?? latestScan.grid_size;
      const competitors = (Array.isArray(detail.competitors) ? detail.competitors : [])
        .filter((c: any) => !c.is_user)
        .map((c: any) => pick(c, ['name', 'appearances', 'avg_position', 'best_position', 'rating', 'reviews']));
      geoGrid = {
        scan_id: latestScan.id,
        keyword: detail.keyword ?? latestScan.keyword,
        grid_size: gridSize,
        radius_km: detail.radius_km ?? latestScan.radius_km,
        total_points: gridSize * gridSize,
        found_points: detail.found_count ?? latestScan.found_count,
        top3_points: detail.top3_count ?? latestScan.top3_count,
        avg_position: detail.avg_position ?? latestScan.avg_position,
        scanned_at: detail.scanned_at ?? latestScan.scanned_at,
        competitors: compact(competitors, shape),
      };
    }

    const cur = report?.current ?? {};
    const prev = report?.previous ?? {};

    // The period report only counts checks inside the window. A project whose
    // last check is older than the period would read as "0 in the pack" while
    // the keyword list still shows positions, so fall back to the latest known
    // positions and say the checks are stale.
    const kws: any[] = Array.isArray(keywordRows) ? keywordRows : [];
    const checksInPeriod = kws.length === 0 || (cur.total_keywords ?? 0) === 0 || (cur.in_pack ?? 0) > 0 || (cur.distribution?.not_in_pack ?? 0) > 0;
    const lastCheckedAt = kws.map((k) => k.checked_at).filter(Boolean).sort().at(-1) ?? null;
    const fromLatest = (() => {
      const ranked = kws.map((k) => k.pack_position).filter((p): p is number => typeof p === 'number');
      const dist = { top3: 0, top10: 0, top20: 0, not_in_pack: kws.length - ranked.length };
      for (const p of ranked) { if (p <= 3) dist.top3++; else if (p <= 10) dist.top10++; else dist.top20++; }
      let improved = 0, declined = 0, stable = 0;
      for (const k of kws) {
        const a = k.pack_position, b = k.prev_pack_position;
        if (typeof a !== 'number' || typeof b !== 'number') stable++;
        else if (a < b) improved++; else if (a > b) declined++; else stable++;
      }
      return {
        tracked_keywords: kws.length,
        in_pack: ranked.length,
        avg_pack_position: ranked.length ? Math.round((ranked.reduce((s, p) => s + p, 0) / ranked.length) * 10) / 10 : null,
        distribution: dist, improved, declined, stable,
      };
    })();
    const pack = checksInPeriod
      ? { tracked_keywords: cur.total_keywords ?? 0, in_pack: cur.in_pack ?? 0, avg_pack_position: cur.avg_pack_position ?? null, distribution: cur.distribution ?? null, improved: cur.improved ?? 0, declined: cur.declined ?? 0, stable: cur.stable ?? 0 }
      : fromLatest;

    const out = {
      project: { id: project.id, name: project.name, business_name: project.business_name, place_id: project.place_id, domain: project.domain, location_code: locationCode },
      profile: profile ? pick(profile, PROFILE_FIELDS) : null,
      profile_completeness: profile ? completenessSummary(completenessChecks(profile)) : null,
      profile_error: profileError,
      local_pack: {
        period_days: args.period,
        checks_in_period: checksInPeriod,
        last_checked_at: lastCheckedAt,
        ...pack,
        previous_avg_pack_position: checksInPeriod ? (prev.avg_pack_position ?? null) : null,
        keywords: compact(kws.map((k: any) => ({
          keyword: k.keyword,
          pack_position: k.pack_position ?? null,
          prev_position: k.prev_pack_position ?? null,
        })), shape),
        trend: compact(report?.trend ?? [], shape),
      },
      reviews: {
        rating: (profile?.rating as number | undefined) ?? cur.avg_rating ?? null,
        count: (profile?.reviews_count as number | undefined) ?? cur.total_reviews ?? null,
        new_this_period: report?.velocity?.current ?? null,
        new_previous_period: report?.velocity?.previous ?? null,
        distribution: (profile?.rating_distribution as unknown) ?? null,
      },
      geo_grid: geoGrid,
    };
    const missing = out.profile_completeness?.missing ?? [];
    return toolResult(
      out,
      `GBP audit for ${project.business_name ?? project.name}: ` +
        (out.profile_completeness ? `profile ${out.profile_completeness.score_pct}% complete` + (missing.length ? ` (missing ${missing.join(', ')})` : '') : 'profile unavailable') +
        `, ${out.local_pack.in_pack}/${out.local_pack.tracked_keywords} keywords in the pack` +
        (checksInPeriod ? '' : ` (no checks in the last ${args.period} days, last checked ${lastCheckedAt ?? 'unknown'})`) +
        (geoGrid ? `, geo-grid ${geoGrid.found_points}/${geoGrid.total_points} points.` : ', no geo-grid scan yet.'),
    );
  },
});
