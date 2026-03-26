import { api } from './api';

export async function connectGSC() {
  return api<{ url: string }>('/gsc/connect', { method: 'POST' });
}

export interface GSCProperty {
  id: string;
  site_url: string;
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

export async function getGSCProperties() {
  return api<{ connected: boolean; properties: GSCProperty[] }>('/gsc/properties');
}

export async function updateGSCProperty(propertyId: string, data: { color?: string; is_enabled?: boolean }) {
  return api<{ success: boolean }>(`/gsc/properties/${propertyId}`, {
    method: 'PATCH',
    body: data,
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
