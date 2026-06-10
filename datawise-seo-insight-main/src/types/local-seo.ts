export interface LocalProject {
  id: string;
  name: string;
  domain: string | null;
  project_type: 'local';
  place_id: string | null;
  cid: string | null;
  business_name: string | null;
  location_code: number | null;
  keyword_count: number;
  created_at: string;
}

export interface LocalTrackedKeyword {
  id: string;
  keyword: string;
  pack_position: number | null;
  prev_pack_position: number | null;
  rating: number | null;
  reviews_count: number | null;
  checked_at: string | null;
  location_code: number;
  language_code: string;
}

export interface LocalDistribution {
  top3: number;
  top10: number;
  top20: number;
  not_in_pack: number;
}

export interface LocalPeriodSnapshot {
  total_keywords: number;
  in_pack: number;
  avg_pack_position: number | null;
  avg_rating: number | null;
  total_reviews: number | null;
  distribution: LocalDistribution;
  improved: number;
  declined: number;
  stable: number;
}

export interface LocalTrendPoint {
  date: string;
  avg_pack_position: number | null;
  top3: number;
  top10: number;
  top20: number;
  avg_rating: number | null;
}

export interface LocalProjectReport {
  current: LocalPeriodSnapshot;
  previous: LocalPeriodSnapshot;
  velocity: { current: number | null; previous: number | null };
  trend: LocalTrendPoint[];
}

export interface BusinessSearchResult {
  title: string;
  place_id: string | null;
  cid: string | null;
  address: string;
  rating: number | null;
  reviews_count: number | null;
  phone: string | null;
  category: string | null;
  url: string | null;
}

export interface GBPProfile {
  title: string;
  address: string;
  phone: string | null;
  url: string | null;
  category: string | null;
  additional_categories: string[];
  rating: number | null;
  rating_distribution: Record<string, number> | null;
  reviews_count: number | null;
  is_claimed: boolean | null;
  description: string | null;
  place_id: string;
  cid: string | null;
  work_time: any;
  popular_times: any;
  total_photos: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ReviewItem {
  rating: number | null;
  text: string;
  author: string;
  author_image: string | null;
  date: string | null;
  owner_response: string | null;
  owner_response_date: string | null;
  is_local_guide: boolean;
  review_images: string[];
  review_url: string | null;
}

export interface ReviewSnapshotRow {
  rating: number | null;
  reviews_count: number | null;
  fetched_count: number | null;
  responded_count: number | null;
  response_rate: number | null;
  unanswered_low_star: number | null;
  rating_distribution: Record<string, number> | null;
  created_at: string;
}

export interface ReviewsResponse {
  rating: number | null;
  reviews_count: number;
  place_id: string | null;
  rating_distribution: Record<string, number> | null;
  reviews: ReviewItem[];
  snapshots: {
    latest: ReviewSnapshotRow | null;
    period_start: ReviewSnapshotRow | null;
    previous_period_start: ReviewSnapshotRow | null;
  };
  velocity: { current: number | null; previous: number | null };
}

export interface ReviewTheme {
  theme: string;
  sentiment: 'positive' | 'negative' | 'mixed';
  mention_count: number;
  quotes: string[];
  review_indexes: number[];
}

export interface ReviewThemesResponse {
  summary: string;
  themes: ReviewTheme[];
  generated_at: string;
  cached: boolean;
  model: string | null;
}

export interface LocalCompetitor {
  position: number;
  title: string;
  place_id: string | null;
  cid: string | null;
  address: string;
  rating: number | null;
  reviews_count: number | null;
  category: string | null;
  phone: string | null;
  url: string | null;
}

export interface GeoGridPoint {
  row: number;
  col: number;
  lat: number;
  lng: number;
  position: number | null;
  total_results: number;
}

export interface GeoGridSummary {
  avg_position: number | null;
  top3_count: number;
  found_count: number;
  not_found_count: number;
}

export interface GeoGridCompetitor {
  name: string;
  appearances: number;
  total_points: number;
  avg_position: number | null;
  best_position: number | null;
  rating: number | null;
  reviews: number | null;
  is_user: boolean;
}

export interface GeoGridCompetitorSeries {
  keyword: string;
  scans: Array<{ scan_id: string; scanned_at: string; competitors: GeoGridCompetitor[] }>;
}

export interface GeoGridScanResult {
  id: string;
  keyword: string;
  grid_size: number;
  radius_km: number;
  center: { lat: number; lng: number };
  points: GeoGridPoint[];
  competitors?: GeoGridCompetitor[];
  summary: GeoGridSummary;
  scanned_at: string;
}

export interface GeoGridHistoryItem {
  id: string;
  keyword: string;
  grid_size: number;
  radius_km: number;
  center_lat: number;
  center_lng: number;
  avg_position: number | null;
  top3_count: number;
  found_count: number;
  scanned_at: string;
}

export interface LocalPeriodKeywordMove {
  keyword: string;
  start_position: number | null;
  current_position: number | null;
  delta: number | null; // positive = improved
}

export interface LocalPeriodReportData {
  project: { id: string; name: string; business_name: string | null; domain: string | null };
  days: number;
  keywords: LocalPeriodKeywordMove[];
  best_movers: LocalPeriodKeywordMove[];
  decliners: LocalPeriodKeywordMove[];
  geogrid: {
    latest: {
      scan_id: string;
      keyword: string;
      scanned_at: string;
      avg_position: number | null;
      top3_count: number;
      found_count: number;
      total_points: number;
      competitors: GeoGridCompetitor[];
    };
    previous: { avg_position: number | null; top3_count: number; found_count: number; scanned_at: string } | null;
  } | null;
  reviews: {
    rating: number | null;
    rating_previous: number | null;
    reviews_count: number | null;
    response_rate: number | null;
    response_rate_previous: number | null;
    unanswered_low_star: number | null;
    rating_distribution: Record<string, number> | null;
    velocity: { current_period: number | null; previous_period: number | null };
    themes: { summary: string; themes: ReviewTheme[]; generated_at: string } | null;
  } | null;
  gbp: { completeness_pct: number; missing: string[] } | null;
  next_steps: Array<{ title: string; detail: string }>;
}

export interface GeoGridInsightAction {
  title: string;
  impact: 'high' | 'medium' | 'low';
  category: 'gbp' | 'reviews' | 'content' | 'citations' | 'engagement';
  description: string;
  competitor_insight: string | null;
}

export interface GeoGridInsights {
  visibility_score: number;
  headline: string;
  strengths: string[];
  priority_actions: GeoGridInsightAction[];
  competitor_gap: string;
  geographic_insight: string;
}
