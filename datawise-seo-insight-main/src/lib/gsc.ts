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
  site_group_id?: string | null;
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
  range?: GSCRangeData;
}

export type GSCRangeDays = 7 | 14 | 30 | 90;

export interface GSCRangeData {
  days: GSCRangeDays;
  clicks: number;
  impressions: number;
  avg_position: number | null;
  prev_clicks: number | null;
  prev_impressions: number | null;
  prev_avg_position: number | null;
  striking_distance: number;
  top_10: number;
  daily: Array<{ date: string; clicks: number; impressions: number }>;
  opportunities: Array<{
    query: string;
    clicks: number;
    impressions: number;
    avg_position: number;
    avg_ctr: number;
    page?: string | null;
  }>;
  top_pages: Array<{
    page: string;
    clicks: number;
    impressions: number;
    avg_position: number;
  }>;
}

export interface IndexationData {
  status?: 'ok' | 'search_analytics_only' | 'needs_sync' | 'manual_property' | 'no_page_data' | 'sitemap_unavailable';
  message?: string;
  total: number;
  indexed: number;
  search_visible_pages?: number;
  not_indexed: number;
  indexed_pct: number;
}

export interface GSCPropertiesResponse {
  connected: boolean;
  // True when the user needs to reconnect Google: either the refresh token
  // failed (refresh_failed_at is set) or there are orphan properties left
  // over from a partial disconnect. The Settings page renders a persistent
  // "Reconnect Google" banner when this is true.
  needs_reconnect?: boolean;
  // True when gsc_properties rows exist for a kind != 'manual' but the
  // gsc_connections row is gone (john's f83f0ecd state). The Settings page
  // offers a one-click "Clean up orphaned properties" action in this case.
  has_orphan_properties?: boolean;
  properties: GSCProperty[];
}

export async function getGSCProperties() {
  return api<GSCPropertiesResponse>('/gsc/properties');
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

export interface CreateManualPropertyResult {
  property: GSCProperty;
  duplicate?: boolean;
  connectedViaGsc?: boolean;
}

export async function createManualProperty(siteUrl: string, color?: string) {
  return api<CreateManualPropertyResult>('/api/properties/manual', {
    method: 'POST',
    body: { site_url: siteUrl, color },
  });
}

export async function deleteManualProperty(propertyId: string) {
  return api<{ success: boolean }>(`/api/properties/manual/${encodeURIComponent(propertyId)}`, {
    method: 'DELETE',
  });
}

export async function syncGSCProperty(propertyId: string) {
  return api<{
    success: boolean;
    rows_synced: number;
    daily_rows: number;
    query_7d_rows: number;
    query_30d_rows: number;
    total_clicks: number;
    total_impressions: number;
    property: string;
  }>('/gsc/sync', {
    method: 'POST',
    body: { property_id: propertyId },
  });
}

export async function getGSCData(propertyId: string, range?: GSCRangeDays) {
  const rangeParam = range ? `&range=${range}` : '';
  return api<GSCOverviewData>(`/gsc/data?property_id=${propertyId}${rangeParam}`);
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

export interface GSCPageQueriesResponse {
  rows: GSCResultRow[];
  mode: 'page_queries';
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

export async function getGSCPageQueries(propertyId: string, page: string) {
  const params = new URLSearchParams({ property_id: propertyId, filter: 'page2', page });
  return api<GSCPageQueriesResponse>(`/gsc/queries?${params}`);
}

export async function disconnectGSC() {
  return api('/gsc/disconnect', { method: 'POST' });
}
