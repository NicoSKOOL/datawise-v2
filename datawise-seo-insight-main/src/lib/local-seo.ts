import { api } from './api';
import type {
  LocalProject, LocalTrackedKeyword, LocalProjectReport,
  BusinessSearchResult, GBPProfile, ReviewsResponse, LocalCompetitor,
  GeoGridScanResult, GeoGridHistoryItem, GeoGridInsights,
} from '@/types/local-seo';

// --- Local Project CRUD ---

export async function fetchLocalProjects() {
  const all = await api<any[]>('/api/rank-tracking/projects');
  return all.filter(p => p.project_type === 'local') as LocalProject[];
}

export async function createLocalProject(params: {
  name: string;
  business_name?: string;
  place_id?: string;
  cid?: string;
  domain?: string;
  location_code?: number;
}) {
  return api<LocalProject>('/api/local-seo/projects', { method: 'POST', body: params });
}

export async function deleteLocalProject(projectId: string) {
  return api(`/api/rank-tracking/projects/${projectId}`, { method: 'DELETE' });
}

// --- Local Keywords ---

export async function fetchLocalKeywords(projectId: string) {
  return api<LocalTrackedKeyword[]>(`/api/local-seo/projects/${projectId}/keywords`);
}

export async function addLocalKeywords(projectId: string, params: {
  keywords: string[];
  location_code?: number;
  language_code?: string;
}) {
  return api<{ added: number; skipped: number }>(
    `/api/rank-tracking/projects/${projectId}/keywords`,
    { method: 'POST', body: params }
  );
}

// --- Local Rank Checks ---

export async function checkLocalRankings(projectId: string) {
  return api<{ checked: number; found: number; not_in_pack: number }>(
    `/api/local-seo/projects/${projectId}/check`,
    { method: 'POST' }
  );
}

export async function fetchLocalReport(projectId: string, period = 30) {
  return api<LocalProjectReport>(`/api/local-seo/projects/${projectId}/report?period=${period}`);
}

// --- Business Search ---

export async function searchBusinesses(query: string, location_code = 2840) {
  return api<{ businesses: BusinessSearchResult[] }>(
    '/api/local-seo/business-search',
    { method: 'POST', body: { query, location_code } }
  );
}

// --- GBP Profile ---

export async function fetchGBPProfile(params: { place_id?: string; business_name?: string; location_code?: number }) {
  return api<GBPProfile>(
    '/api/local-seo/gbp-profile',
    { method: 'POST', body: params }
  );
}

// --- Reviews ---

export async function fetchReviews(params: {
  place_id?: string;
  cid?: string;
  business_name?: string;
  location_code?: number;
  depth?: number;
  sort_by?: string;
}) {
  return api<ReviewsResponse>(
    '/api/local-seo/reviews',
    { method: 'POST', body: params }
  );
}

// --- Local Keyword Suggestions ---

export interface LocalKeywordSuggestion {
  keyword: string;
  search_volume?: number;
}

export interface LocalKeywordSuggestionGroup {
  group: string;
  keywords: LocalKeywordSuggestion[];
}

export async function fetchLocalKeywordSuggestions(params: {
  category: string;
  city?: string;
  location_code?: number;
  language_code?: string;
}) {
  return api<{ suggestions: LocalKeywordSuggestionGroup[] }>(
    '/api/local-seo/keyword-suggestions',
    { method: 'POST', body: params }
  );
}

// --- Resolve GBP URL ---

export async function resolveGBPUrl(url: string) {
  return api<BusinessSearchResult>(
    '/api/local-seo/resolve-gbp-url',
    { method: 'POST', body: { url } }
  );
}

// --- Local Competitors ---

export async function fetchLocalCompetitors(params: {
  keyword: string;
  location_code?: number;
  language_code?: string;
  depth?: number;
}) {
  return api<{ keyword: string; competitors: LocalCompetitor[] }>(
    '/api/local-seo/local-competitors',
    { method: 'POST', body: params }
  );
}

// --- GeoGrid ---

export async function runGeoGridScan(projectId: string, params: {
  keyword: string;
  grid_size?: number;
  radius_km?: number;
}) {
  return api<GeoGridScanResult>(
    `/api/local-seo/projects/${projectId}/geogrid`,
    { method: 'POST', body: params }
  );
}

export async function fetchGeoGridHistory(projectId: string) {
  return api<{ scans: GeoGridHistoryItem[] }>(
    `/api/local-seo/projects/${projectId}/geogrid-history`
  );
}

export async function fetchGeoGridScan(scanId: string) {
  return api<GeoGridScanResult>(
    `/api/local-seo/geogrid-scans/${scanId}`
  );
}

export async function fetchGeoGridInsights(projectId: string, scanId: string, llmConfig?: { provider: string; api_key: string; model?: string }) {
  return api<{ insights: GeoGridInsights; usage: { input_tokens: number; output_tokens: number } }>(
    `/api/local-seo/projects/${projectId}/geogrid-insights`,
    { method: 'POST', body: { scan_id: scanId, llm_config: llmConfig } }
  );
}
