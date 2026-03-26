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

export interface ReviewsResponse {
  rating: number | null;
  reviews_count: number;
  place_id: string | null;
  reviews: ReviewItem[];
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

export interface GeoGridScanResult {
  id: string;
  keyword: string;
  grid_size: number;
  radius_km: number;
  center: { lat: number; lng: number };
  points: GeoGridPoint[];
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
