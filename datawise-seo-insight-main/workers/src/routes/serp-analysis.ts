import type { Env } from '../index';
import { dataforseoGet, dataforseoRequestCached, getTaskError } from '../dataforseo/client';
import { fillMissingKeywordDifficulty } from './keywords';

// SERP Analysis: "who ranks for this keyword in this place, and why".
// One live SERP (city-level when the user picks a city), one Labs overview
// (country-level, Labs has no city data), and one backlinks bulk summary for
// every ranking page + its domain. The "why" signals are computed here so the
// SPA and any future MCP tool read the same verdicts.

const SERP_TTL_SECONDS = 43200; // local SERPs move daily; 12h is fresh enough
const LABS_TTL_SECONDS = 86400;
const BACKLINKS_TTL_SECONDS = 604800; // backlink index refreshes slowly
const LOCATIONS_TTL_SECONDS = 2592000;
const LOCATIONS_KV_PREFIX = 'serp-locations:v1:';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- keyword matching ----------

const STOPWORDS = new Set(['a', 'an', 'the', 'in', 'of', 'for', 'to', 'and', 'or', 'on', 'at', 'near', 'me', 'my', 'best', 'with', 'by']);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function keywordTokens(keyword: string): string[] {
  const tokens = normalize(keyword).split(' ').filter(Boolean);
  const meaningful = tokens.filter((t) => !STOPWORDS.has(t));
  return meaningful.length > 0 ? meaningful : tokens;
}

// Loose stem so "washing"/"wash" and "cleaners"/"cleaner" count as present.
function tokenPresent(haystack: string, token: string): boolean {
  if (haystack.includes(token)) return true;
  for (const suffix of ['ing', 'es', 's', 'er', 'ers']) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix) && haystack.includes(token.slice(0, -suffix.length))) {
      return true;
    }
  }
  return false;
}

export type MatchLevel = 'exact' | 'all' | 'partial' | 'none';

export function titleMatch(title: string, keyword: string): MatchLevel {
  const t = normalize(title);
  const phrase = normalize(keyword);
  if (phrase && t.includes(phrase)) return 'exact';
  const tokens = keywordTokens(keyword);
  const hits = tokens.filter((tok) => tokenPresent(t, tok)).length;
  if (tokens.length > 0 && hits === tokens.length) return 'all';
  return hits > 0 ? 'partial' : 'none';
}

// URLs often glue words together ("sydneypressure.com.au"), so match tokens
// as substrings of the raw lowercase URL rather than of split words.
export function urlMatch(url: string, keyword: string): MatchLevel {
  const u = url.toLowerCase().replace(/^https?:\/\//, '');
  const tokens = keywordTokens(keyword);
  const hits = tokens.filter((tok) => tokenPresent(u, tok)).length;
  if (tokens.length > 0 && hits === tokens.length) return 'all';
  return hits > 0 ? 'partial' : 'none';
}

export function bareDomain(domainOrUrl: string): string {
  return domainOrUrl.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

function isHomepage(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.pathname === '/' || u.pathname === '') && !u.search;
  } catch {
    return false;
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ---------- analysis ----------

export interface LinkStats {
  rank: number; // 0-100 (DataForSEO rank / 10)
  backlinks: number;
  referringDomains: number;
  spamScore: number | null;
  firstSeen: string | null;
  localLinkShare: number | null; // 0-1, share of referring links from the searched country
}

export interface TrafficStats {
  etv: number; // estimated monthly organic visits in the searched country
  keywords: number; // organic keywords the target ranks for
  localPackEtv: number;
}

export interface Reason {
  kind: 'strength' | 'weakness';
  label: string;
}

export interface SerpRow {
  position: number;
  absolutePosition: number;
  title: string;
  url: string;
  domain: string;
  description: string;
  isHomepage: boolean;
  inLocalPack: boolean;
  rating: { value: number; votes: number } | null;
  titleMatch: MatchLevel;
  urlMatch: MatchLevel;
  page: LinkStats | null;
  site: LinkStats | null;
  pageTraffic: TrafficStats | null;
  siteTraffic: TrafficStats | null;
  reasons: Reason[];
  beatable: boolean;
}

export interface LocalPackEntry {
  position: number;
  title: string;
  domain: string | null;
  url: string | null;
  rating: { value: number; votes: number } | null;
  description: string | null;
  hasOrganicListing: boolean;
}

export interface SerpSummary {
  organicCount: number;
  medianDomainRank: number;
  medianPageReferringDomains: number;
  medianSiteTraffic: number | null;
  exactTitleCount: number;
  keywordInTitleCount: number;
  keywordInUrlCount: number;
  homepageCount: number;
  beatableCount: number;
  serpFeatures: string[];
  verdict: string;
}

function toLinkStats(item: any, countryIso: string | null): LinkStats | null {
  if (!item) return null;
  let localLinkShare: number | null = null;
  const countries = item.referring_links_countries;
  if (countryIso && countries && typeof countries === 'object') {
    let total = 0;
    for (const [code, count] of Object.entries(countries)) {
      if (code && typeof count === 'number') total += count;
    }
    const local = typeof countries[countryIso] === 'number' ? countries[countryIso] : 0;
    if (total >= 5) localLinkShare = local / total;
  }
  return {
    rank: Math.round((typeof item.rank === 'number' ? item.rank : 0) / 10),
    backlinks: typeof item.backlinks === 'number' ? item.backlinks : 0,
    referringDomains: typeof item.referring_main_domains === 'number'
      ? item.referring_main_domains
      : (typeof item.referring_domains === 'number' ? item.referring_domains : 0),
    spamScore: typeof item.backlinks_spam_score === 'number' ? item.backlinks_spam_score : null,
    firstSeen: typeof item.first_seen === 'string' ? item.first_seen : null,
    localLinkShare,
  };
}

function toTrafficStats(item: any): TrafficStats | null {
  const m = item?.metrics;
  if (!m) return null;
  return {
    etv: Math.round(m.organic?.etv ?? 0),
    keywords: m.organic?.count ?? 0,
    localPackEtv: Math.round(m.local_pack?.etv ?? 0),
  };
}

function rating(raw: any): { value: number; votes: number } | null {
  if (!raw || typeof raw.value !== 'number') return null;
  return { value: raw.value, votes: typeof raw.votes_count === 'number' ? raw.votes_count : 0 };
}

const FEATURE_LABELS: Record<string, string> = {
  local_pack: 'Local Pack',
  map: 'Map',
  people_also_ask: 'People Also Ask',
  ai_overview: 'AI Overview',
  featured_snippet: 'Featured Snippet',
  video: 'Videos',
  images: 'Images',
  top_stories: 'Top Stories',
  related_searches: 'Related Searches',
  paid: 'Ads',
  shopping: 'Shopping',
  knowledge_graph: 'Knowledge Panel',
  discussions_and_forums: 'Discussions & Forums',
  perspectives: 'Perspectives',
  short_videos: 'Short Videos',
};

export function analyzeSerp(input: {
  keyword: string;
  serpItems: any[];
  backlinkItems: any[];
  trafficItems?: any[];
  countryIso: string | null;
  countryLabel: string | null;
}): { results: SerpRow[]; localPack: LocalPackEntry[]; summary: SerpSummary } {
  const { keyword, serpItems, backlinkItems, countryIso, countryLabel } = input;
  const trafficByTarget = new Map<string, any>();
  for (const item of input.trafficItems ?? []) {
    if (item && typeof item.target === 'string') trafficByTarget.set(item.target.toLowerCase(), item);
  }
  const byTarget = new Map<string, any>();
  for (const item of backlinkItems) {
    if (item && typeof item.url === 'string') byTarget.set(item.url.toLowerCase(), item);
  }

  const localPackRaw = serpItems.filter((i) => i?.type === 'local_pack');
  const localDomains = new Set(localPackRaw.map((i) => (i.domain ? bareDomain(i.domain) : '')).filter(Boolean));
  const organicRaw = serpItems.filter((i) => i?.type === 'organic' && typeof i.url === 'string');
  const organicDomains = new Set(organicRaw.map((i) => bareDomain(i.domain || i.url)));

  const featureSet = new Set<string>();
  for (const i of serpItems) {
    if (i?.type && i.type !== 'organic' && FEATURE_LABELS[i.type]) featureSet.add(FEATURE_LABELS[i.type]);
  }

  const rows: SerpRow[] = organicRaw.map((i) => {
    const domain = bareDomain(i.domain || i.url);
    return {
      position: i.rank_group,
      absolutePosition: i.rank_absolute,
      title: i.title || '',
      url: i.url,
      domain,
      description: i.description || '',
      isHomepage: isHomepage(i.url),
      inLocalPack: localDomains.has(domain),
      rating: rating(i.rating),
      titleMatch: titleMatch(i.title || '', keyword),
      urlMatch: urlMatch(i.url, keyword),
      page: toLinkStats(byTarget.get(i.url.toLowerCase()), countryIso),
      site: toLinkStats(byTarget.get(domain), countryIso),
      pageTraffic: toTrafficStats(trafficByTarget.get(i.url.toLowerCase())),
      siteTraffic: toTrafficStats(trafficByTarget.get(domain)),
      reasons: [],
      beatable: false,
    };
  });

  const medianDomainRank = median(rows.map((r) => r.site?.rank ?? 0));
  const medianPageRd = median(rows.map((r) => r.page?.referringDomains ?? 0));
  const hasTraffic = rows.some((r) => r.siteTraffic);
  const medianSiteTraffic = hasTraffic ? median(rows.map((r) => r.siteTraffic?.etv ?? 0)) : null;
  const nowYear = new Date().getUTCFullYear();

  for (const r of rows) {
    const reasons: Reason[] = [];
    const dr = r.site?.rank ?? 0;
    const pageRd = r.page?.referringDomains ?? 0;
    const siteRd = r.site?.referringDomains ?? 0;

    if (dr >= 50) reasons.push({ kind: 'strength', label: `Big-brand site authority (Domain Rank ${dr})` });
    else if (dr >= 20 && dr >= medianDomainRank * 1.5) reasons.push({ kind: 'strength', label: `Stronger domain than most here (Domain Rank ${dr} vs ${medianDomainRank} typical)` });

    if (pageRd >= 10 && pageRd >= medianPageRd * 2) reasons.push({ kind: 'strength', label: `${pageRd.toLocaleString()} sites link to this exact page` });

    if (r.titleMatch === 'exact') reasons.push({ kind: 'strength', label: 'Exact keyword in the title' });
    else if (r.titleMatch === 'all') reasons.push({ kind: 'strength', label: 'Every keyword word is in the title' });
    else if (r.titleMatch === 'none') reasons.push({ kind: 'weakness', label: 'Keyword missing from the title' });

    if (r.urlMatch === 'all') reasons.push({ kind: 'strength', label: 'Keyword in the domain or URL' });
    if (r.isHomepage) reasons.push({ kind: 'strength', label: "Homepage ranking, so the whole site's authority is behind it" });
    if (r.inLocalPack) reasons.push({ kind: 'strength', label: 'Also shows in the Local Pack (strong Google Business Profile)' });
    if (r.rating && r.rating.votes >= 10) {
      reasons.push({ kind: 'strength', label: `Review stars in the result (${r.rating.value}★ from ${r.rating.votes.toLocaleString()} reviews)` });
    }

    const localShare = r.site?.localLinkShare;
    if (localShare != null && localShare >= 0.5 && countryLabel) {
      reasons.push({ kind: 'strength', label: `${Math.round(localShare * 100)}% of its links come from ${countryLabel} sites` });
    }
    const firstSeenYear = r.site?.firstSeen ? Number(r.site.firstSeen.slice(0, 4)) : NaN;
    if (Number.isFinite(firstSeenYear) && nowYear - firstSeenYear >= 5) {
      reasons.push({ kind: 'strength', label: `Link profile established since ${firstSeenYear}` });
    }

    const st = r.siteTraffic;
    if (st && medianSiteTraffic != null) {
      if (st.keywords >= 1000 && st.etv >= Math.max(medianSiteTraffic * 3, 1000)) {
        reasons.push({ kind: 'strength', label: `Site gets ~${st.etv.toLocaleString()} search visits/mo from ${st.keywords.toLocaleString()} keywords, so Google already trusts it widely` });
      } else if (st.etv >= Math.max(medianSiteTraffic * 2, 200)) {
        reasons.push({ kind: 'strength', label: `More search traffic than most here (~${st.etv.toLocaleString()} visits/mo)` });
      }
      if (st.localPackEtv >= 500) reasons.push({ kind: 'strength', label: `~${st.localPackEtv.toLocaleString()} visits/mo from Local Pack listings` });
      if (st.etv < 50 && st.keywords < 20) reasons.push({ kind: 'weakness', label: `Site barely gets search traffic (~${st.etv}/mo from ${st.keywords} keywords)` });
    }
    if (r.pageTraffic && r.pageTraffic.keywords >= 20 && !r.isHomepage) {
      reasons.push({ kind: 'strength', label: `This page ranks for ${r.pageTraffic.keywords.toLocaleString()} keywords` });
    }

    if (r.page && pageRd <= 2 && !r.isHomepage) reasons.push({ kind: 'weakness', label: 'Almost no links to this page' });
    if (siteRd > 0 && siteRd < 20) reasons.push({ kind: 'weakness', label: `Small link profile (${siteRd} referring domains)` });
    if ((r.site?.spamScore ?? 0) >= 30) reasons.push({ kind: 'weakness', label: `High link spam score (${r.site!.spamScore})` });

    r.beatable = dr < 50 && dr <= medianDomainRank && pageRd <= medianPageRd;
    if (r.beatable) reasons.push({ kind: 'weakness', label: 'Weaker than the typical result here: a realistic target to outrank' });
    r.reasons = reasons;
  }

  const localPack: LocalPackEntry[] = localPackRaw.map((i, idx) => ({
    position: typeof i.rank_group === 'number' ? i.rank_group : idx + 1,
    title: i.title || '',
    domain: i.domain ? bareDomain(i.domain) : null,
    url: i.url || null,
    rating: rating(i.rating),
    description: i.description || null,
    hasOrganicListing: i.domain ? organicDomains.has(bareDomain(i.domain)) : false,
  }));

  const summary: SerpSummary = {
    organicCount: rows.length,
    medianDomainRank,
    medianPageReferringDomains: medianPageRd,
    medianSiteTraffic,
    exactTitleCount: rows.filter((r) => r.titleMatch === 'exact').length,
    keywordInTitleCount: rows.filter((r) => r.titleMatch === 'exact' || r.titleMatch === 'all').length,
    keywordInUrlCount: rows.filter((r) => r.urlMatch === 'all').length,
    homepageCount: rows.filter((r) => r.isHomepage).length,
    beatableCount: rows.filter((r) => r.beatable).length,
    serpFeatures: [...featureSet],
    verdict: buildVerdict(rows, medianDomainRank, medianPageRd, localPack.length > 0),
  };

  return { results: rows, localPack, summary };
}

function buildVerdict(rows: SerpRow[], medianDr: number, medianPageRd: number, hasLocalPack: boolean): string {
  if (rows.length === 0) return 'No organic results were returned for this search.';
  const parts: string[] = [];
  const bigBrands = rows.filter((r) => (r.site?.rank ?? 0) >= 50).length;
  if (bigBrands >= 4) parts.push(`${bigBrands} of ${rows.length} results are big-brand sites, so authority is what wins here.`);
  else if (medianDr < 20) parts.push(`Most ranking sites are small (typical Domain Rank ${medianDr}), so authority is not the main barrier.`);
  else parts.push(`The typical ranking site has Domain Rank ${medianDr}.`);

  const inTitle = rows.filter((r) => r.titleMatch === 'exact' || r.titleMatch === 'all').length;
  if (inTitle >= Math.ceil(rows.length / 2)) parts.push(`${inTitle} of ${rows.length} put the keyword in their title, so relevance is table stakes.`);

  const homepages = rows.filter((r) => r.isHomepage).length;
  if (homepages >= Math.ceil(rows.length / 2)) parts.push(`${homepages} of ${rows.length} are homepages, so Google favours whole-business sites for this search.`);

  if (hasLocalPack) parts.push('A Local Pack sits above the organic results, so a strong Google Business Profile matters as much as the website.');
  if (medianPageRd <= 5) parts.push(`Ranking pages have few links of their own (typical ${medianPageRd} referring domains).`);
  return parts.join(' ');
}

// ---------- handlers ----------

// POST /api/keywords/serp-analysis
export async function handleSerpAnalysis(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => null) as any;
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  if (!keyword) return json({ error: 'Keyword is required' }, 400);
  const location_code = Number(body.location_code) || 2840;
  const language_code = typeof body.language_code === 'string' && body.language_code ? body.language_code : 'en';
  const serpLocationCode = Number(body.serp_location_code) || location_code;
  const countryIso = typeof body.country_iso === 'string' ? body.country_iso.toUpperCase() : null;
  const countryLabel = typeof body.country_label === 'string' ? body.country_label : null;

  const [serpData, overviewSettled] = await Promise.all([
    dataforseoRequestCached(env, '/serp/google/organic/live/advanced', [{
      keyword,
      location_code: serpLocationCode,
      language_code,
      device: 'desktop',
      os: 'windows',
      depth: 10,
    }], { ttlSeconds: SERP_TTL_SECONDS }),
    (async () => {
      try {
        const data = await dataforseoRequestCached(env, '/dataforseo_labs/google/keyword_overview/live', [{
          keywords: [keyword],
          location_code,
          language_code,
        }], { ttlSeconds: LABS_TTL_SECONDS });
        await fillMissingKeywordDifficulty(env, data, location_code, language_code);
        return data;
      } catch (e) {
        console.error('serp-analysis overview failed:', e);
        return null;
      }
    })(),
  ]);

  const serpError = getTaskError(serpData);
  if (serpError) return json({ error: `SERP lookup failed: ${serpError}` }, 502);
  const serpResult = serpData?.tasks?.[0]?.result?.[0];
  const serpItems: any[] = Array.isArray(serpResult?.items) ? serpResult.items : [];
  const organic = serpItems.filter((i) => i?.type === 'organic' && typeof i.url === 'string');
  if (organic.length === 0) return json({ error: 'No organic results found for this keyword and location' }, 404);

  const targets = [...new Set([
    ...organic.map((i) => i.url as string),
    ...organic.map((i) => bareDomain(i.domain || i.url)),
  ])];
  // Both best-effort: the SERP is still useful without link or traffic data.
  const [backlinkItems, trafficItems] = await Promise.all([
    (async () => {
      try {
        const bl = await dataforseoRequestCached(env, '/backlinks/bulk_pages_summary/live', [{ targets }], { ttlSeconds: BACKLINKS_TTL_SECONDS });
        return getTaskError(bl) ? [] : (bl?.tasks?.[0]?.result?.[0]?.items ?? []) as any[];
      } catch (e) {
        console.error('serp-analysis backlinks failed:', e);
        return [] as any[];
      }
    })(),
    (async () => {
      try {
        // Labs traffic is country-level: the city SERP code is not a Labs location.
        const tr = await dataforseoRequestCached(env, '/dataforseo_labs/google/bulk_traffic_estimation/live', [{
          targets,
          location_code,
          language_code,
          item_types: ['organic', 'local_pack'],
        }], { ttlSeconds: BACKLINKS_TTL_SECONDS });
        return getTaskError(tr) ? [] : (tr?.tasks?.[0]?.result?.[0]?.items ?? []) as any[];
      } catch (e) {
        console.error('serp-analysis traffic failed:', e);
        return [] as any[];
      }
    })(),
  ]);

  const overviewItem = overviewSettled?.tasks?.[0]?.result?.[0]?.items?.[0] ?? null;
  const analysis = analyzeSerp({ keyword, serpItems, backlinkItems, trafficItems, countryIso, countryLabel });

  return json({
    keyword,
    location: {
      serp_location_code: serpLocationCode,
      country_location_code: location_code,
      language_code,
    },
    checked_at: serpResult?.datetime ?? null,
    metrics: overviewItem ? {
      search_volume: overviewItem.keyword_info?.search_volume ?? null,
      cpc: overviewItem.keyword_info?.cpc ?? null,
      competition: overviewItem.keyword_info?.competition ?? null,
      keyword_difficulty: overviewItem.keyword_properties?.keyword_difficulty ?? null,
      monthly_searches: Array.isArray(overviewItem.keyword_info?.monthly_searches)
        ? overviewItem.keyword_info.monthly_searches
            .filter((m: any) => typeof m?.year === 'number' && typeof m?.month === 'number')
            .map((m: any) => ({ year: m.year, month: m.month, search_volume: m.search_volume ?? 0 }))
            .sort((a: any, b: any) => a.year - b.year || a.month - b.month)
            .slice(-12)
        : [],
      search_intent: overviewItem.search_intent_info?.main_intent ?? null,
    } : null,
    backlinks_available: backlinkItems.length > 0,
    traffic_available: trafficItems.length > 0,
    ...analysis,
  });
}

const KEPT_LOCATION_TYPES = new Set([
  'City', 'Neighborhood', 'State', 'Province', 'Region', 'County', 'Territory', 'Municipality', 'Borough', 'District', 'DMA Region', 'Country',
]);

type SlimLocation = [code: number, name: string, type: string];

async function loadCountryLocations(env: Env, countryIso: string): Promise<SlimLocation[]> {
  const key = `${LOCATIONS_KV_PREFIX}${countryIso}`;
  const cached = await env.KV.get(key);
  if (cached) return JSON.parse(cached) as SlimLocation[];
  // Free catalog endpoint. The raw US list is several MB, so we keep a slim
  // copy (no postal codes, airports, etc.) instead of caching the response.
  const data = await dataforseoGet(env, `/serp/google/locations/${countryIso.toLowerCase()}`);
  const raw: any[] = Array.isArray(data?.tasks?.[0]?.result) ? data.tasks[0].result : [];
  const slim: SlimLocation[] = raw
    .filter((e) => typeof e?.location_code === 'number' && typeof e?.location_name === 'string' && KEPT_LOCATION_TYPES.has(e.location_type))
    .map((e) => [e.location_code, e.location_name, e.location_type]);
  if (slim.length > 0) await env.KV.put(key, JSON.stringify(slim), { expirationTtl: LOCATIONS_TTL_SECONDS });
  return slim;
}

const TYPE_ORDER: Record<string, number> = { City: 0, Neighborhood: 1, Municipality: 2, Borough: 3, District: 4, County: 5, 'DMA Region': 6, Region: 7, State: 8, Province: 8, Territory: 8, Country: 9 };

export function searchLocations(list: SlimLocation[], query: string, limit = 20): Array<{ location_code: number; location_name: string; location_type: string }> {
  const q = normalize(query);
  if (!q) return [];
  const scored: Array<{ loc: SlimLocation; score: number }> = [];
  for (const loc of list) {
    const first = normalize(loc[1].split(',')[0]);
    const full = normalize(loc[1]);
    let score: number;
    if (first === q) score = 0;
    else if (first.startsWith(q)) score = 1;
    else if (full.includes(q)) score = 2;
    else continue;
    scored.push({ loc, score: score * 100 + (TYPE_ORDER[loc[2]] ?? 50) });
  }
  scored.sort((a, b) => a.score - b.score || a.loc[1].localeCompare(b.loc[1]));
  return scored.slice(0, limit).map(({ loc }) => ({ location_code: loc[0], location_name: loc[1], location_type: loc[2] }));
}

// GET /api/keywords/serp-locations?country=AU&q=syd
export async function handleSerpLocations(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const country = (url.searchParams.get('country') || '').toUpperCase();
  const q = url.searchParams.get('q') || '';
  if (!/^[A-Z]{2}$/.test(country)) return json({ error: 'country must be a 2-letter ISO code' }, 400);
  if (q.trim().length < 2) return json({ locations: [] });
  try {
    const list = await loadCountryLocations(env, country);
    return json({ locations: searchLocations(list, q) });
  } catch (e) {
    console.error('serp-locations failed:', e);
    return json({ error: 'Location lookup failed' }, 502);
  }
}
