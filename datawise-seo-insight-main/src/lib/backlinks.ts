import { api } from './api';

// ---------- Generic envelopes ----------

interface ApiEnvelope<T> {
  data: T;
  cost: number;
}

// DFS timeseries rows are a loose shape; we only consume `date`, `backlinks`,
// `referring_domains` etc. so keep it permissive and narrow at render time.
export type BacklinksTimeseriesRow = {
  date?: string;
  year?: number;
  month?: number;
  new_backlinks?: number;
  lost_backlinks?: number;
  new_referring_domains?: number;
  lost_referring_domains?: number;
  backlinks?: number;
  referring_domains?: number;
} & Record<string, unknown>;

// ---------- Summary ----------

export interface BacklinksSummaryResult {
  target?: string;
  first_seen?: string;
  lost_date?: string | null;
  rank?: number;
  backlinks?: number;
  backlinks_spam_score?: number;
  broken_backlinks?: number;
  broken_pages?: number;
  referring_domains?: number;
  referring_main_domains?: number;
  referring_ips?: number;
  referring_subnets?: number;
  referring_pages?: number;
  crawled_pages?: number;
  referring_links_tld?: Record<string, number>;
  referring_links_types?: Record<string, number>;
  referring_links_attributes?: Record<string, number>;
  referring_links_platform_types?: Record<string, number>;
  referring_links_semantic_locations?: Record<string, number>;
  referring_links_countries?: Record<string, number>;
  [k: string]: unknown;
}

export async function fetchBacklinksSummary(body: {
  target: string;
  include_subdomains?: boolean;
  internal_list_limit?: number;
}): Promise<BacklinksSummaryResult> {
  const res = await api<ApiEnvelope<BacklinksSummaryResult | null>>('/api/backlinks/summary', {
    method: 'POST',
    body,
  });
  return res.data ?? {};
}

// ---------- Timeseries ----------

export interface BacklinksTimeseriesResult {
  items?: BacklinksTimeseriesRow[] | null;
  items_count?: number;
  total_count?: number;
}

export async function fetchBacklinksTimeseries(body: {
  target: string;
  date_from?: string;
  date_to?: string;
  group_range?: 'day' | 'week' | 'month' | 'year';
  include_subdomains?: boolean;
}): Promise<BacklinksTimeseriesResult> {
  const res = await api<ApiEnvelope<BacklinksTimeseriesResult | null>>('/api/backlinks/timeseries', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

// ---------- Backlinks list ----------

export interface BacklinkItem {
  type?: string;
  domain_from?: string;
  url_from?: string;
  url_from_https?: boolean;
  domain_to?: string;
  url_to?: string;
  tld_from?: string;
  is_new?: boolean;
  is_lost?: boolean;
  backlink_spam_score?: number;
  rank?: number;
  page_from_rank?: number;
  domain_from_rank?: number;
  page_from_external_links?: number;
  page_from_internal_links?: number;
  first_seen?: string;
  prev_seen?: string;
  last_seen?: string;
  item_type?: string;
  attributes?: string[] | null;
  dofollow?: boolean;
  original?: boolean;
  alt?: string | null;
  anchor?: string | null;
  text_pre?: string | null;
  text_post?: string | null;
  semantic_location?: string | null;
  links_count?: number;
  group_count?: number;
  is_broken?: boolean;
  url_to_status_code?: number;
  page_from_title?: string;
  page_from_language?: string;
  page_from_encoding?: string;
  page_from_size?: number;
  [k: string]: unknown;
}

export interface BacklinksListResult {
  target?: string;
  total_count?: number;
  items_count?: number;
  items?: BacklinkItem[] | null;
}

export async function fetchBacklinksList(body: {
  target: string;
  limit?: number;
  offset?: number;
  mode?: 'as_is' | 'one_per_domain' | 'one_per_anchor';
  filters?: unknown[];
  order_by?: string[];
  backlinks_status_type?: 'all' | 'live' | 'lost';
  include_subdomains?: boolean;
}): Promise<BacklinksListResult> {
  const res = await api<ApiEnvelope<BacklinksListResult | null>>('/api/backlinks/list', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

// ---------- Referring domains ----------

export interface ReferringDomainItem {
  type?: string;
  domain?: string;
  rank?: number;
  backlinks?: number;
  first_seen?: string;
  lost_date?: string | null;
  backlinks_spam_score?: number;
  broken_backlinks?: number;
  broken_pages?: number;
  referring_domains?: number;
  referring_main_domains?: number;
  referring_pages?: number;
  referring_links_tld?: Record<string, number>;
  referring_links_types?: Record<string, number>;
  referring_links_attributes?: Record<string, number>;
  [k: string]: unknown;
}

export interface ReferringDomainsResult {
  target?: string;
  total_count?: number;
  items_count?: number;
  items?: ReferringDomainItem[] | null;
}

export async function fetchReferringDomains(body: {
  target: string;
  limit?: number;
  offset?: number;
  filters?: unknown[];
  order_by?: string[];
  include_subdomains?: boolean;
}): Promise<ReferringDomainsResult> {
  const res = await api<ApiEnvelope<ReferringDomainsResult | null>>('/api/backlinks/referring-domains', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

// ---------- Anchors ----------

export interface AnchorItem {
  type?: string;
  anchor?: string;
  rank?: number;
  backlinks?: number;
  first_seen?: string;
  lost_date?: string | null;
  backlinks_spam_score?: number;
  broken_backlinks?: number;
  broken_pages?: number;
  referring_domains?: number;
  referring_main_domains?: number;
  referring_pages?: number;
  [k: string]: unknown;
}

export interface AnchorsResult {
  target?: string;
  total_count?: number;
  items_count?: number;
  items?: AnchorItem[] | null;
}

export async function fetchAnchors(body: {
  target: string;
  limit?: number;
  internal_list_limit?: number;
  include_subdomains?: boolean;
}): Promise<AnchorsResult> {
  const res = await api<ApiEnvelope<AnchorsResult | null>>('/api/backlinks/anchors', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

// ---------- Competitors ----------

export interface BacklinksCompetitorItem {
  type?: string;
  target?: string;
  rank?: number;
  main_domain_rank?: number;
  backlinks?: number;
  first_seen?: string;
  lost_date?: string | null;
  referring_links_tld?: Record<string, number>;
  referring_links_types?: Record<string, number>;
  referring_domains?: number;
  referring_main_domains?: number;
  referring_ips?: number;
  referring_subnets?: number;
  referring_pages?: number;
  intersections?: number;
  [k: string]: unknown;
}

export interface BacklinksCompetitorsResult {
  target?: string;
  total_count?: number;
  items_count?: number;
  items?: BacklinksCompetitorItem[] | null;
}

export async function fetchBacklinksCompetitors(body: {
  target: string;
  limit?: number;
  exclude_large_domains?: boolean;
  include_subdomains?: boolean;
}): Promise<BacklinksCompetitorsResult> {
  const res = await api<ApiEnvelope<BacklinksCompetitorsResult | null>>('/api/backlinks/competitors', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

// ---------- Domain intersection ----------

// A single per-target slice inside an intersection row. `target` confusingly
// refers to the LINKING domain (not the input target), and rank/backlinks
// describe that linking domain's relationship to the input target at this index.
export interface IntersectionSlice {
  type?: string;
  target?: string;
  rank?: number;
  backlinks?: number;
  first_seen?: string;
  lost_date?: string | null;
  backlinks_spam_score?: number;
  referring_domains?: number;
  referring_main_domains?: number;
  referring_pages?: number;
  [k: string]: unknown;
}

// Each item has `domain_intersection: {"1": slice, "2": slice, ...}` keyed by
// the position of the target in the input array. Null slices mean that target
// is not linked by this domain. To get the linking domain itself, read
// any non-null slice's `target` field.
export interface DomainIntersectionItem {
  domain_intersection: Record<string, IntersectionSlice | null>;
  [k: string]: unknown;
}

export interface DomainIntersectionResult {
  total_count?: number;
  items_count?: number;
  items?: DomainIntersectionItem[] | null;
}

export async function fetchDomainIntersection(body: {
  targets: string[];
  limit?: number;
  filters?: unknown[];
  exclude_targets?: string[];
}): Promise<DomainIntersectionResult> {
  const res = await api<ApiEnvelope<DomainIntersectionResult | null>>('/api/backlinks/domain-intersection', {
    method: 'POST',
    body,
  });
  return res.data ?? { items: null };
}

// ---------- Helpers ----------

export function cleanBacklinksDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase();
}
