import { api } from './api';

export async function connectGSC() {
  return api<{ url: string }>('/gsc/connect', { method: 'POST' });
}

export interface GSCProperty {
  id: string;
  site_url: string;
  kind?: 'gsc' | 'manual';
  permission_level: string;
  last_synced_at: string | null;
  color: string | null;
  is_enabled: number | null;
}

export interface GSCOverviewData {
  property: string;
  last_synced: string | null;
  daily_trend?: Array<{ date: string; clicks: number; impressions: number }>;
  summary: {
    last_7_days: { total_clicks: number | null; total_impressions: number | null; avg_position: number | null };
    last_30_days: { total_clicks: number | null; total_impressions: number | null; avg_position: number | null };
    last_90_days: { total_clicks: number | null; total_impressions: number | null; avg_position: number | null };
  };
  query_summary: {
    total_queries: number;
    avg_position: number | null;
    top_3: number;
    top_10: number;
    top_20: number;
    striking_distance: number;
    top_10_impressions: number;
  };
  recent_queries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    avg_position: number;
    ctr_pct: number;
  }>;
  top_queries: Array<{
    query: string;
    clicks: number;
    impressions: number;
    avg_position: number;
    avg_ctr: number;
  }>;
  top_pages: Array<{
    page: string;
    clicks: number;
    impressions: number;
    avg_position: number;
  }>;
  opportunities: Array<{
    query: string;
    clicks: number;
    impressions: number;
    avg_position: number;
    avg_ctr: number;
  }>;
}

export interface IndexationData {
  status?: 'ok' | 'needs_sync' | 'manual_property' | 'no_page_data' | 'sitemap_unavailable';
  message?: string;
  total: number;
  indexed: number;
  search_visible_pages?: number;
  not_indexed: number;
  indexed_pct: number;
}

export async function getGSCProperties() {
  return api<{ connected: boolean; properties: GSCProperty[] }>('/gsc/properties');
}

export async function refreshGSCProperties() {
  return api<{ success: boolean; count: number }>('/gsc/properties/refresh', {
    method: 'POST',
  });
}

export async function updateGSCProperty(propertyId: string, data: { color?: string; is_enabled?: boolean }) {
  return api<{ success: boolean }>(`/gsc/properties/${propertyId}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function createManualProperty(siteUrl: string, color?: string) {
  const result = await api<{ property: GSCProperty }>('/api/properties/manual', {
    method: 'POST',
    body: { site_url: siteUrl, color },
  });
  return result.property;
}

export async function deleteManualProperty(propertyId: string) {
  return api<{ success: boolean }>(`/api/properties/manual/${encodeURIComponent(propertyId)}`, {
    method: 'DELETE',
  });
}

export async function syncGSCProperty(propertyId: string) {
  return api<{ success: boolean; rows_synced: number; property: string }>('/gsc/sync', {
    method: 'POST',
    body: { property_id: propertyId },
  });
}

export async function getGSCData(propertyId: string) {
  return api<GSCOverviewData>(`/gsc/data?property_id=${propertyId}`);
}

export async function getGSCSitemaps(propertyId: string) {
  return api<IndexationData>(`/gsc/sitemaps?property_id=${propertyId}`);
}

export type GSCQueryFilter = 'all' | 'top10' | 'page2' | 'opportunities';
export type GSCQuerySort = 'clicks' | 'impressions' | 'avg_position' | 'avg_ctr';

export interface GSCResultRow {
  query?: string;
  page?: string;
  clicks: number;
  impressions: number;
  avg_position: number;
  avg_ctr: number;
  query_count?: number;
}

export interface GSCQueriesResponse {
  rows: GSCResultRow[];
  mode: 'queries' | 'pages';
  total: number;
  limit: number;
  offset: number;
}

export async function getGSCQueries(
  propertyId: string,
  filter: GSCQueryFilter = 'all',
  search = '',
  sort: GSCQuerySort = 'clicks',
  order: 'asc' | 'desc' = 'desc',
  limit = 100,
  offset = 0,
) {
  const params = new URLSearchParams({
    property_id: propertyId,
    filter,
    search,
    sort,
    order,
    limit: String(limit),
    offset: String(offset),
  });
  return api<GSCQueriesResponse>(`/gsc/queries?${params}`);
}

export async function disconnectGSC() {
  return api('/gsc/disconnect', { method: 'POST' });
}
