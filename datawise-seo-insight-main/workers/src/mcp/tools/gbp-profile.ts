import { z } from 'zod';
import { defineTool, shapeFor } from './types';
import { callJson, HandlerError } from '../call-handler';
import { asWorkerEnv } from '../env';
import { toolResult, toolError, compact, stripHtml } from '../shape';
import { dataforseoRequest, dataforseoRequestCached } from '../../dataforseo/client';
import { pickMyBusinessInfo, handleReviews } from '../../routes/local-seo';
import { classifyGbpInput, parseMapsUrl } from '../../gbp/identify';
import { normalizeGbpProfile, locationCodeForCountry } from '../../gbp/normalize';
import { summarizeReviews, type ReviewRow } from '../../gbp/reviews-summary';
import { fetchGbpPosts } from '../../gbp/posts';

// Any business, not only a member's project. The member pastes a Maps link
// (or a name and city) and the tool works out the rest. Data only: no
// scoring, no fix text. The model on the other end does the audit.

const GBP_INFO_TTL = 86400;
const REVIEW_TEXT_CAP = 600;

interface Candidate { title: string; place_id: string | null; cid: string | null; address: string; category: string | null; rating: number | null; reviews_count: number | null; website: string | null }

function candidateFrom(item: any): Candidate {
  return {
    title: item.title ?? '', place_id: item.place_id ?? null, cid: item.cid ?? null, address: item.address ?? '',
    category: item.category ?? null, rating: item.rating?.value ?? null, reviews_count: item.rating?.votes_count ?? null, website: item.url ?? null,
  };
}

function keywordFor(c: { cid?: string | null; place_id?: string | null }): string | null {
  if (c.place_id) return `place_id:${c.place_id}`;
  if (c.cid) return `cid:${c.cid}`;
  return null;
}

// The top Maps hit is a clear match when its title contains every word of
// the part of the query before the first comma.
function clearMatch(query: string, title: string): boolean {
  const words = query.split(',')[0].toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const t = title.toLowerCase();
  return words.length > 0 && words.every((w) => t.includes(w));
}

export const gbpProfile = defineTool({
  name: 'datawise_gbp_profile',
  description:
    'Use this to get everything Google shows about ANY Google Business Profile, not only the member\'s own projects: name, structured address, phone, website, categories, description, hours by day, attributes (available and unavailable), services list, photo count, rating and star distribution, booking and menu links, place topics, similar businesses, plus a sample of recent reviews with owner replies (reply rate, unanswered low-star count) and recent Google posts. ' +
    'Pass gbp as a Google Maps link, a place_id, a CID, or "business name, city". A name search that is not a clear match returns candidates: pick one and call again with its place_id. ' +
    'Cost is about $0.02 (profile $0.005 cached for a day, reviews $0.0015 per 10, posts $0.01). To compare the profile with the business website, call datawise_site_pages next. For a member\'s tracked Local Pack project use datawise_gbp_audit.',
  inputSchema: z.object({
    gbp: z.string().min(2).max(2048).describe('Google Maps link (google.com/maps/place/..., maps.app.goo.gl/...), place_id (ChIJ...), CID (digits), or "business name, city".'),
    include_reviews: z.boolean().default(true).describe('Include the latest reviews with owner replies. Default true.'),
    reviews_depth: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(20).describe('How many reviews to fetch: 10, 20 or 50. reviews_depth: 50 takes about 40 seconds.'),
    include_posts: z.boolean().default(true).describe('Include recent Google Business posts. Default true.'),
    response_format: z.enum(['concise', 'detailed']).default('concise').describe('concise trims long lists; detailed returns more items and popular times.'),
  }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const shape = shapeFor(args.response_format);
    const locale = { location_code: ctx.identity.defaultLocationCode, language_code: ctx.identity.defaultLanguageCode };
    const input = classifyGbpInput(args.gbp);

    let keyword: string | null = null;
    let query: string | null = null;
    let resolvedFrom: 'maps_url' | 'place_id' | 'cid' | 'name_search' = input.kind === 'name' ? 'name_search' : input.kind;

    if (input.kind === 'place_id') keyword = `place_id:${input.placeId}`;
    else if (input.kind === 'cid') keyword = `cid:${input.cid}`;
    else if (input.kind === 'maps_url') {
      let parts;
      try { parts = await parseMapsUrl(input.url); } catch (err) { return toolError(`Could not open that Maps link: ${(err as Error).message}`); }
      keyword = keywordFor({ place_id: parts.placeId, cid: parts.cid });
      query = parts.businessQuery;
      if (!keyword && !query) return toolError('Could not read a business from that Maps link. Paste the link from the Share button on the Google Maps listing, or pass "business name, city".');
    } else query = input.query;

    if (!keyword && query) {
      const body = [{ keyword: query, ...locale, device: 'desktop', os: 'windows', depth: 10 }];
      const data = await dataforseoRequest(env, '/serp/google/maps/live/advanced', body);
      const hits: any[] = (data?.tasks?.[0]?.result?.[0]?.items ?? []).filter((i: any) => i?.type === 'maps_search');
      if (hits.length === 0) return toolError(`No Google Maps listing found for "${query}". Try "business name, city" or paste the Maps link.`);
      if (hits.length === 1 || clearMatch(query, hits[0].title ?? '')) {
        keyword = keywordFor({ cid: hits[0].cid, place_id: hits[0].place_id });
      } else {
        const candidates = hits.slice(0, 5).map(candidateFrom);
        return toolResult(
          { resolved_from: resolvedFrom, candidates, profile: null, reviews: null, posts: null },
          `${candidates.length} possible matches for "${query}". Pick the right one and call again with its place_id.`,
        );
      }
      if (!keyword) return toolError(`Google Maps returned a listing for "${query}" without an id. Paste the Maps link instead.`);
    }

    const info = await dataforseoRequestCached(env, '/business_data/google/my_business_info/live', [{ keyword, ...locale }], { ttlSeconds: GBP_INFO_TTL });
    const item = pickMyBusinessInfo(info);
    if (!item?.title) return toolError(`Business not found on Google for ${keyword}. Check the link or id and try again.`);
    const profile = normalizeGbpProfile(item);
    if (args.response_format !== 'detailed') profile.signals.popular_times = null;

    const inferred = locationCodeForCountry(profile.address.country_code) ?? locale.location_code;
    // Reviews and posts identifiers come from the RESOLVED keyword, not the
    // normalized profile: it is what we actually looked up, and the profile
    // may be missing a place_id or cid for a directory-only listing.
    const reviewKey = keyword!.startsWith('place_id:') ? { place_id: keyword!.slice('place_id:'.length) } : { cid: keyword!.replace(/^cid:/, '') };

    const [reviewsRes, postsRes] = await Promise.allSettled([
      args.include_reviews
        ? callJson<any>(ctx.env, ctx.identity.userId, (req, e) => handleReviews(req, e), { ...reviewKey, depth: args.reviews_depth, sort_by: 'newest', location_code: inferred, language_code: locale.language_code })
        : Promise.resolve(null),
      args.include_posts
        ? fetchGbpPosts(env, { keyword: keyword!, location_code: inferred, language_code: locale.language_code })
        : Promise.resolve(null),
    ]);

    let reviews: Record<string, unknown> | null = null;
    let reviewsError: string | undefined;
    if (reviewsRes.status === 'fulfilled' && reviewsRes.value) {
      const rows: ReviewRow[] = (reviewsRes.value.reviews ?? []).map((r: any) => ({
        rating: typeof r.rating === 'number' ? r.rating : null,
        text: stripHtml(String(r.text ?? '')).slice(0, REVIEW_TEXT_CAP),
        date: r.date ?? null, owner_response: r.owner_response ?? null, owner_response_date: r.owner_response_date ?? null, author: r.author ?? 'Anonymous',
      }));
      reviews = { summary: summarizeReviews(rows), items: compact(rows, { ...shape, maxString: REVIEW_TEXT_CAP, maxArray: Math.max(shape.maxArray, args.reviews_depth) }) };
    } else if (reviewsRes.status === 'rejected') {
      const e = reviewsRes.reason;
      if (!(e instanceof HandlerError) || (e.status >= 500 && e.status !== 504)) console.error('gbp_profile reviews failed', e);
      reviewsError = e instanceof Error ? e.message : String(e);
    }

    let posts: Record<string, unknown> | null = null;
    let postsError: string | undefined;
    if (postsRes.status === 'fulfilled' && postsRes.value) posts = compact(postsRes.value, shape) as Record<string, unknown>;
    else if (postsRes.status === 'rejected') postsError = postsRes.reason instanceof Error ? postsRes.reason.message : String(postsRes.reason);

    const out = {
      resolved_from: resolvedFrom,
      profile: compact(profile, { ...shape, maxArray: Math.max(shape.maxArray, 60) }),
      reviews, ...(reviewsError ? { reviews_error: reviewsError } : {}),
      posts, ...(postsError ? { posts_error: postsError } : {}),
      inferred_location_code: inferred,
      language_code: locale.language_code,
      fetched_at: new Date().toISOString(),
    };
    const r = profile.reputation;
    const summaryTitle = stripHtml(profile.identity.title ?? '').slice(0, 120);
    const summary =
      `${summaryTitle}, ${profile.categories.primary ?? 'no category'}, ` +
      `${r.rating ?? '?'} stars from ${r.reviews_count ?? '?'} reviews, ${profile.attributes.available.length} attributes, ` +
      `${profile.services.length} services, ${profile.hours.days_with_hours} days with hours` +
      (posts ? `, ${(posts as any).posts_count} posts, last ${(posts as any).days_since_last_post ?? '?'} days ago` : '') +
      (reviews ? `, review reply rate ${(reviews as any).summary.reply_rate_pct ?? '?'}%` : '') + '.';
    return toolResult(out, summary);
  },
});
