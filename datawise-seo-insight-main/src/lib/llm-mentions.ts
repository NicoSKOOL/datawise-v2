import { api } from './api';
import type { LlmHistoricalItem } from './llm-historical';

export interface LlmHistoricalResult {
  items: LlmHistoricalItem[];
}

export interface LlmMentionTarget {
  domain?: string;
  keyword?: string;
  include_subdomains?: boolean;
  search_scope?: string[];
  match_type?: 'exact_match' | 'partial_match';
}

export interface LlmMetricItem {
  type?: string;
  key: string;
  mentions: number;
  ai_search_volume: number;
  impressions: number;
}

export interface LlmAggregateTotal {
  platform?: LlmMetricItem[] | null;
  location?: LlmMetricItem[] | null;
  language?: LlmMetricItem[] | null;
  sources_domain?: LlmMetricItem[] | null;
  search_results_domain?: LlmMetricItem[] | null;
  brand_entities_title?: LlmMetricItem[] | null;
  brand_entities_category?: LlmMetricItem[] | null;
}

export interface LlmAggregateResult {
  total: LlmAggregateTotal;
  items: null;
}

// Helper: sum mentions / volume / impressions across any dimension array.
// The aggregated_metrics response stores scalars only inside dimension arrays
// (each element is one bucket, e.g. platform="google"). Totals can be derived
// by summing any dimension — they all sum to the same grand total.
export function sumDim(
  arr: LlmMetricItem[] | null | undefined,
  field: 'mentions' | 'ai_search_volume' | 'impressions'
): number {
  if (!arr) return 0;
  let s = 0;
  for (const item of arr) s += (item?.[field] as number) || 0;
  return s;
}

export interface LlmSource {
  snippet?: string;
  source_name?: string;
  title?: string;
  domain?: string;
  url?: string;
  publication_date?: string;
}

export interface LlmMonthlySearch {
  year: number;
  month: number;
  search_volume?: number;
  ai_search_volume?: number;
}

// Cross-aggregated metrics: one `items[]` entry per aggregation_key the caller
// supplied. Each item is a flat dimension bag (same shape as a top_domains
// item, NOT a nested `total` object). Caller's aggregation_key lands on `key`.
export interface LlmCrossAggregateItem {
  key: string;
  location?: LlmMetricItem[] | null;
  language?: LlmMetricItem[] | null;
  platform?: LlmMetricItem[] | null;
  sources_domain?: LlmMetricItem[] | null;
  search_results_domain?: LlmMetricItem[] | null;
  brand_entities_title?: LlmMetricItem[] | null;
  brand_entities_category?: LlmMetricItem[] | null;
  [k: string]: unknown;
}

export interface LlmCrossAggregateResult {
  total?: LlmAggregateTotal;
  items: LlmCrossAggregateItem[] | null;
}

export interface LlmSearchRow {
  platform?: string;
  model_name?: string;
  question?: string;
  answer?: string;
  sources?: LlmSource[];
  search_results?: unknown[];
  ai_search_volume?: number;
  monthly_searches?: LlmMonthlySearch[];
  first_response_at?: string;
  last_response_at?: string;
  brand_entities?: unknown[];
  fan_out_queries?: string[];
}

export interface LlmSearchResult {
  total_count?: number;
  current_offset?: number;
  items_count?: number;
  items: LlmSearchRow[] | null;
  search_after_token?: string;
}

// Each top_domains item has `key` (the cited domain) plus dimension arrays
// (location / platform / language / sources_domain / ...) holding the metrics.
export interface LlmTopDomainItem {
  type?: string;
  key: string;
  location?: LlmMetricItem[] | null;
  platform?: LlmMetricItem[] | null;
  language?: LlmMetricItem[] | null;
  sources_domain?: LlmMetricItem[] | null;
  search_results_domain?: LlmMetricItem[] | null;
  [k: string]: unknown;
}

export interface LlmTopDomainsResult {
  total?: LlmAggregateTotal;
  items: LlmTopDomainItem[] | null;
}

export interface LlmTopPageItem {
  type?: string;
  key: string;
  location?: LlmMetricItem[] | null;
  platform?: LlmMetricItem[] | null;
  language?: LlmMetricItem[] | null;
  sources_domain?: LlmMetricItem[] | null;
  [k: string]: unknown;
}

export interface LlmTopPagesResult {
  total?: LlmAggregateTotal;
  items: LlmTopPageItem[] | null;
}

export interface LlmSearchResultEnvelope {
  total_count?: number;
  current_offset?: number;
  search_after_token?: string;
  items_count?: number;
  items: LlmSearchRow[] | null;
}

export interface LlmKeywordVolumeItem {
  keyword: string;
  ai_search_volume: number;
  ai_monthly_searches: LlmMonthlySearch[];
}

export interface LlmKeywordVolumeResult {
  items: LlmKeywordVolumeItem[];
}

interface AggregateRequestBody {
  target: LlmMentionTarget[];
  platform?: 'google' | 'chat_gpt';
  location_code?: number;
  language_code?: string;
  internal_list_limit?: number;
}

interface CrossAggregateRequestBody {
  targets: Array<{ aggregation_key: string; target: LlmMentionTarget[] }>;
  platform?: 'google' | 'chat_gpt';
  location_code?: number;
  language_code?: string;
  internal_list_limit?: number;
}

interface SearchRequestBody {
  target: LlmMentionTarget[];
  platform?: 'google' | 'chat_gpt';
  location_code?: number;
  language_code?: string;
  limit?: number;
  offset?: number;
  search_after_token?: string;
  filters?: unknown[];
  order_by?: unknown[];
}

interface TopDomainsRequestBody {
  target: LlmMentionTarget[];
  platform?: 'google' | 'chat_gpt';
  location_code?: number;
  language_code?: string;
  links_scope?: 'sources' | 'search_results';
  items_list_limit?: number;
  internal_list_limit?: number;
}

interface TopPagesRequestBody {
  target: LlmMentionTarget[];
  platform?: 'google' | 'chat_gpt';
  location_code?: number;
  language_code?: string;
  links_scope?: 'sources' | 'search_results';
  items_list_limit?: number;
  internal_list_limit?: number;
}

interface KeywordVolumeRequestBody {
  keywords: string[];
  location_code?: number;
  language_code?: string;
}

interface HistoricalRequestBody {
  target: LlmMentionTarget[];
  platform?: 'google' | 'chat_gpt';
  location_code?: number;
  language_code?: string;
  date_from?: string;
  date_to?: string;
}

interface ApiEnvelope<T> {
  data: T;
  cost: number;
}

// DFS extractResult returns null when no task/result exists, so api envelopes
// can carry `data: null`. We coerce to an empty shape so callers never have
// to null-check the top-level result object (they still guard `.items` etc).

export async function fetchLlmAggregate(body: AggregateRequestBody): Promise<LlmAggregateResult> {
  const res = await api<ApiEnvelope<LlmAggregateResult | null>>('/api/llm-mentions/aggregate', {
    method: 'POST',
    body,
  });
  return res.data ?? { total: {}, items: null };
}

export async function fetchLlmCrossAggregate(body: CrossAggregateRequestBody): Promise<LlmCrossAggregateResult> {
  const res = await api<ApiEnvelope<LlmCrossAggregateResult | null>>('/api/llm-mentions/cross-aggregate', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

export async function fetchLlmSearch(body: SearchRequestBody): Promise<LlmSearchResult> {
  const res = await api<ApiEnvelope<LlmSearchResult | null>>('/api/llm-mentions/search', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

export async function fetchLlmTopDomains(body: TopDomainsRequestBody): Promise<LlmTopDomainsResult> {
  const res = await api<ApiEnvelope<LlmTopDomainsResult | null>>('/api/llm-mentions/top-domains', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

export async function fetchLlmTopPages(body: TopPagesRequestBody): Promise<LlmTopPagesResult> {
  const res = await api<ApiEnvelope<LlmTopPagesResult | null>>('/api/llm-mentions/top-pages', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

export async function fetchLlmKeywordVolume(body: KeywordVolumeRequestBody): Promise<LlmKeywordVolumeResult> {
  const res = await api<ApiEnvelope<LlmKeywordVolumeResult | null>>('/api/llm-mentions/keyword-volume', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: [] };
}

export async function fetchLlmHistorical(body: HistoricalRequestBody): Promise<LlmHistoricalResult> {
  const res = await api<ApiEnvelope<LlmHistoricalResult | null>>('/api/llm-mentions/historical', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: [] };
}
