// Pure module for the Local Pack Experience wave: review snapshots, rating
// distribution fallback, geo-grid zoom and competitor aggregation, review
// theme validation. No Env, no D1, fully unit-tested in
// local-reviews-analysis.test.ts. See docs/specs/2026-06-10-local-pack-experience.md.

export interface ReviewLike {
  rating: number | null;
  owner_response: string | null;
}

export interface ReviewSnapshot {
  rating: number | null;
  reviews_count: number | null;
  fetched_count: number;
  responded_count: number;
  response_rate: number;       // 0-100 integer
  unanswered_low_star: number; // rating <= 3 with no owner response
  rating_distribution: string; // JSON {"5":n,...}
}

// Radius-derived Maps zoom. Replaces the hardcoded 17z that made every grid
// point search hyper-local regardless of scan radius.
export function zoomForRadius(radiusKm: number): string {
  if (radiusKm <= 1) return '15z';
  if (radiusKm <= 2.5) return '14z';
  if (radiusKm <= 5) return '13z';
  return '12z';
}

export function ratingDistributionFallback(reviews: ReviewLike[]): Record<string, number> {
  const dist: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
  for (const r of reviews) {
    if (r.rating == null) continue;
    const star = String(Math.min(5, Math.max(1, Math.round(r.rating))));
    dist[star]++;
  }
  return dist;
}

export function buildSnapshot(args: {
  rating: number | null;
  reviews_count: number | null;
  reviews: ReviewLike[];
  rating_distribution: Record<string, number> | null;
}): ReviewSnapshot {
  const fetched = args.reviews.length;
  const responded = args.reviews.filter(r => !!r.owner_response).length;
  const unanswered = args.reviews.filter(r => !r.owner_response && r.rating != null && r.rating <= 3).length;
  const dist = args.rating_distribution && Object.keys(args.rating_distribution).length > 0
    ? args.rating_distribution
    : ratingDistributionFallback(args.reviews);
  return {
    rating: args.rating,
    reviews_count: args.reviews_count,
    fetched_count: fetched,
    responded_count: responded,
    response_rate: fetched > 0 ? Math.round((responded / fetched) * 100) : 0,
    unanswered_low_star: unanswered,
    rating_distribution: JSON.stringify(dist),
  };
}

// At most one snapshot row per project per UTC day. lastCreatedAt is the D1
// datetime('now') format: 'YYYY-MM-DD HH:MM:SS'.
export function shouldWriteSnapshot(lastCreatedAt: string | null, now: Date): boolean {
  if (!lastCreatedAt) return true;
  return lastCreatedAt.slice(0, 10) !== now.toISOString().slice(0, 10);
}

export function computeVelocity(args: {
  currentCount: number | null;
  startOfPeriodCount: number | null;
  startOfPreviousPeriodCount: number | null;
}): { current: number | null; previous: number | null } {
  const current = args.currentCount != null && args.startOfPeriodCount != null
    ? args.currentCount - args.startOfPeriodCount
    : null;
  const previous = args.startOfPeriodCount != null && args.startOfPreviousPeriodCount != null
    ? args.startOfPeriodCount - args.startOfPreviousPeriodCount
    : null;
  return { current, previous };
}

// --- Geo-grid competitor aggregation ---

export interface GeoGridPointResult {
  position: number | null;
  top_competitors?: Array<{ title: string; rating: number | null; reviews: number | null; position: number }>;
}

export interface AggregatedCompetitor {
  name: string;
  appearances: number;
  total_points: number;
  avg_position: number | null;
  best_position: number | null;
  rating: number | null;
  reviews: number | null;
  is_user: boolean;
}

export function aggregateGeogridCompetitors(
  points: GeoGridPointResult[],
  userBusinessName?: string | null,
): AggregatedCompetitor[] {
  const totalPoints = points.length;
  const map = new Map<string, { appearances: number; positions: number[]; rating: number | null; reviews: number | null }>();

  for (const point of points) {
    for (const comp of point.top_competitors || []) {
      if (!comp.title) continue;
      let entry = map.get(comp.title);
      if (!entry) {
        entry = { appearances: 0, positions: [], rating: null, reviews: null };
        map.set(comp.title, entry);
      }
      entry.appearances++;
      if (comp.position > 0) entry.positions.push(comp.position);
      if (comp.rating != null) entry.rating = comp.rating;
      if (comp.reviews != null && (entry.reviews == null || comp.reviews > entry.reviews)) entry.reviews = comp.reviews;
    }
  }

  const competitors: AggregatedCompetitor[] = Array.from(map.entries()).map(([name, e]) => ({
    name,
    appearances: e.appearances,
    total_points: totalPoints,
    avg_position: e.positions.length
      ? Math.round((e.positions.reduce((s, p) => s + p, 0) / e.positions.length) * 10) / 10
      : null,
    best_position: e.positions.length ? Math.min(...e.positions) : null,
    rating: e.rating,
    reviews: e.reviews,
    is_user: false,
  }));

  // The scan excludes the target business from top_competitors (filtered by
  // place_id/cid), so synthesize its own top 3 share from per-point positions.
  if (userBusinessName) {
    const ownPoints = points.filter(p => p.position != null && p.position <= 3);
    if (ownPoints.length > 0) {
      const positions = ownPoints.map(p => p.position as number);
      competitors.push({
        name: userBusinessName,
        appearances: ownPoints.length,
        total_points: totalPoints,
        avg_position: Math.round((positions.reduce((s, p) => s + p, 0) / positions.length) * 10) / 10,
        best_position: Math.min(...positions),
        rating: null,
        reviews: null,
        is_user: true,
      });
    }
  }

  competitors.sort((a, b) =>
    b.appearances - a.appearances || (a.avg_position ?? 99) - (b.avg_position ?? 99));
  return competitors.slice(0, 10);
}

// --- Review themes (LLM output validation + cache key) ---

export async function computeReviewsHash(
  reviews: Array<{ date: string | null; text: string }>
): Promise<string> {
  const material = reviews.map(r => `${r.date ?? ''}|${r.text}`).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export interface ReviewThemeResult {
  theme: string;
  sentiment: 'positive' | 'negative' | 'mixed';
  mention_count: number;
  quotes: string[];
  review_indexes: number[];
}

// LLM output that may arrive wrapped in code fences, prefaced with prose, or
// carrying trailing commas. Best-effort extraction of the first JSON object so
// a minor formatting deviation does not blank the whole panel. Returns the
// parsed value, or null if nothing parseable is found.
export function extractJsonObject(raw: string): unknown | null {
  if (typeof raw !== 'string') return null;
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidates: string[] = [];
  if (start >= 0 && end > start) candidates.push(cleaned.slice(start, end + 1));
  candidates.push(cleaned);
  const relax = (s: string) => s.replace(/,\s*([}\]])/g, '$1'); // trailing commas
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* try next */ }
    try { return JSON.parse(relax(c)); } catch { /* try next */ }
  }
  return null;
}

// Models label sentiment freely ("neutral", "Positive", "mixed/neutral"). Map
// everything onto the three buckets the UI understands instead of rejecting
// the whole response over one stray label (the reason themes went blank for
// DeepSeek/OpenRouter users).
function normalizeSentiment(s: unknown): 'positive' | 'negative' | 'mixed' {
  const v = typeof s === 'string' ? s.trim().toLowerCase() : '';
  if (v === 'positive' || v === 'negative' || v === 'mixed') return v;
  if (v.startsWith('pos')) return 'positive';
  if (v.startsWith('neg')) return 'negative';
  return 'mixed'; // neutral, mixed/neutral, unknown -> mixed
}

// Tolerant validation of the LLM JSON. Returns null only when nothing usable
// remains (caller responds 502 with a retry hint). Individual malformed themes
// are dropped rather than failing the whole set; sentiments are normalized; a
// missing summary is tolerated. Out-of-range review_indexes are dropped,
// quotes capped at 2, themes capped at 8.
export function validateReviewThemes(
  raw: unknown,
  reviewCount: number
): { summary: string; themes: ReviewThemeResult[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { summary?: unknown; themes?: unknown };
  if (!Array.isArray(obj.themes)) return null;

  const themes: ReviewThemeResult[] = [];
  for (const t of obj.themes as Array<Record<string, unknown>>) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.theme !== 'string' || !t.theme.trim()) continue;
    const indexes = Array.isArray(t.review_indexes)
      ? (t.review_indexes as unknown[]).filter(
          (i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < reviewCount
        )
      : [];
    const quotes = Array.isArray(t.quotes)
      ? (t.quotes as unknown[]).filter((q): q is string => typeof q === 'string').slice(0, 2)
      : [];
    themes.push({
      theme: t.theme.trim(),
      sentiment: normalizeSentiment(t.sentiment),
      mention_count: typeof t.mention_count === 'number' ? t.mention_count : indexes.length,
      quotes,
      review_indexes: indexes,
    });
  }
  if (themes.length === 0) return null;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  return { summary, themes: themes.slice(0, 8) };
}
