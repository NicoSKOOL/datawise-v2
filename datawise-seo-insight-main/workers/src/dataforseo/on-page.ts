import type { Env } from '../index';
import { dataforseoRequest, dataforseoGet } from './client';
import type { PerformanceProbeSample } from '../site-audit/performance-stability';

// ---------- Narrow response types ----------
// We only model the fields we actually read. DataForSEO returns far more.

export interface OnPageTaskOptions {
  target: string; // cleaned domain, no protocol
  max_crawl_pages: number;
  start_url?: string;
  switch_pool?: boolean;
}

export interface OnPageSummary {
  crawl_progress: 'in_progress' | 'finished';
  crawl_stop_reason?: string | null;
  crawl_gateway_address?: string | null;
  crawl_status: {
    max_crawl_pages: number;
    pages_in_queue: number;
    pages_crawled: number;
  };
  domain_info?: {
    name?: string;
    cms?: string | null;
    ip?: string;
    server?: string;
    crawl_start?: string;
    crawl_end?: string | null;
    crawl_stop_reason?: string | null;
    extended_crawl_status?: string;
    crawl_gateway_address?: string | null;
    status_code?: number | null;
    status_message?: string | null;
    ssl_info?: { valid_certificate?: boolean } | null;
    checks?: Record<string, boolean | number>;
    total_pages?: number;
  };
  page_metrics?: {
    onpage_score?: number;
    links_external?: number;
    links_internal?: number;
    duplicate_title?: number;
    duplicate_description?: number;
    duplicate_content?: number;
    broken_links?: number;
    broken_resources?: number;
    links_relation_conflict?: number;
    redirect_loop?: number;
    checks?: Record<string, number>;
  };
}

export interface OnPagePage {
  url: string;
  status_code?: number;
  meta?: {
    title?: string;
    description?: string;
    charset?: number | string;
    title_length?: number;
    description_length?: number;
    internal_links_count?: number;
    external_links_count?: number;
    inbound_links_count?: number;
    images_count?: number;
    images_size?: number;
    scripts_count?: number;
    scripts_size?: number;
    stylesheets_count?: number;
    stylesheets_size?: number;
    htags?: {
      h1?: string[];
      h2?: string[];
      h3?: string[];
      h4?: string[];
    };
  };
  page_timing?: {
    time_to_interactive?: number;
    dom_complete?: number;
    largest_contentful_paint?: number;
    first_input_delay?: number;
    connection_time?: number;
    time_to_secure_connection?: number;
    request_sent_time?: number;
    waiting_time?: number;
    download_time?: number;
    duration_time?: number;
    fetch_start?: number;
    fetch_end?: number;
  };
  total_transfer_size?: number;
  size?: number;
  encoded_size?: number;
  checks?: Record<string, boolean>;
}

export interface OnPageResource {
  resource_type: 'image' | 'stylesheet' | 'script' | 'broken' | string;
  url: string;
  size?: number;
  encoded_size?: number;
  total_transfer_size?: number;
  status_code?: number;
  meta?: {
    alternative_text?: string | null;
    original_width?: number;
    original_height?: number;
    width?: number;
    height?: number;
  };
  fetch_timing?: {
    duration_time?: number;
    fetch_start?: number;
    fetch_end?: number;
  };
  checks?: Record<string, boolean>;
}

export interface OnPageMicrodata {
  test_summary?: {
    fatal?: number;
    error?: number;
    warning?: number;
    info?: number;
  };
  items?: unknown[];
}

// ---------- Helpers ----------

function unwrap(data: any, endpoint: string): any {
  const task = data?.tasks?.[0];
  if (!task) {
    throw new Error(`DataForSEO ${endpoint}: empty tasks array`);
  }
  if (task.status_code < 20000 || task.status_code >= 30000) {
    throw new Error(
      `DataForSEO ${endpoint}: ${task.status_message || 'unknown error'} (${task.status_code})`
    );
  }
  return task;
}

// ---------- Public API ----------

const LIGHTHOUSE_PERFORMANCE_CATEGORIES = ['performance'] as const;

export const LIGHTHOUSE_PERFORMANCE_PROBE_CONFIG = {
  for_mobile: false,
  categories: LIGHTHOUSE_PERFORMANCE_CATEGORIES,
  browser_screen_width: 1920,
  browser_screen_height: 1080,
  browser_screen_scale_factor: 1,
  language_code: 'en',
  browser_network_throttling_method: 'simulate',
} as const;

const LIGHTHOUSE_PERFORMANCE_PROBE_TIMEOUT_MS = 35_000;

function shouldRetryWithSwitchPool(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  return /rate.?limit|site.?unreachable|unreachable|temporar|timeout|blocked/i.test(message);
}

async function taskPostOnce(
  env: Env,
  opts: OnPageTaskOptions & { auditId?: string }
): Promise<string> {
  const body = [
    {
      target: opts.target,
      max_crawl_pages: opts.max_crawl_pages,
      start_url: opts.start_url,
      load_resources: true,
      enable_javascript: true,
      enable_browser_rendering: true,
      validate_micromarkup: true,
      store_raw_html: false,
      // NOTE: respect_sitemap:true caused empty crawls on sites without a
      // sitemap.xml (DFS refused to queue anything). Omitting it so DFS always
      // starts from start_url and follows links itself.
      force_sitewide_checks: true,
      switch_pool: opts.switch_pool ? true : undefined,
      return_despite_timeout: true,
      tag: opts.auditId ? `audit:${opts.auditId}` : undefined,
    },
  ];
  const data = await dataforseoRequest(env, '/on_page/task_post', body, 20_000);
  const task = unwrap(data, 'task_post');
  if (!task.id) throw new Error('DataForSEO task_post: missing task id');
  return task.id as string;
}

export async function taskPost(
  env: Env,
  opts: OnPageTaskOptions & { auditId?: string }
): Promise<string> {
  try {
    return await taskPostOnce(env, { ...opts, switch_pool: false });
  } catch (err) {
    if (!shouldRetryWithSwitchPool(err)) throw err;
    console.warn('[on-page] task_post retrying with switch_pool:', err);
    return await taskPostOnce(env, { ...opts, switch_pool: true });
  }
}

function extractLighthouseAudit(result: any, id: string): any {
  const audits = result?.audits || {};
  return audits[id] || audits[`metrics/${id}`] || null;
}

export async function getLighthousePerformanceProbe(
  env: Env,
  url: string,
  opts: { auditId?: string; sampleIndex?: number } = {}
): Promise<PerformanceProbeSample> {
  const startedAt = Date.now();
  const body = [
    {
      url,
      ...LIGHTHOUSE_PERFORMANCE_PROBE_CONFIG,
      tag:
        opts.auditId && opts.sampleIndex != null
          ? `audit:${opts.auditId}:perf:${opts.sampleIndex}`
          : opts.auditId
            ? `audit:${opts.auditId}:perf`
            : undefined,
    },
  ];

  try {
    const data = await dataforseoRequest(
      env,
      '/on_page/lighthouse/live/json',
      body,
      LIGHTHOUSE_PERFORMANCE_PROBE_TIMEOUT_MS
    );
    const task = data?.tasks?.[0];
    if (!task) {
      return {
        ok: false,
        error: 'DataForSEO Lighthouse probe: empty tasks array',
        duration_ms: Date.now() - startedAt,
      };
    }

    if (task.status_code < 20000 || task.status_code >= 30000) {
      return {
        ok: false,
        status_code: task.status_code ?? null,
        status_message: task.status_message || null,
        error: task.status_message || 'DataForSEO Lighthouse probe failed',
        duration_ms: Date.now() - startedAt,
      };
    }

    const result = task.result?.[0];
    const lcp = extractLighthouseAudit(result, 'largest-contentful-paint');
    const perfScore = result?.categories?.performance?.score;
    const lcpMs =
      typeof lcp?.numericValue === 'number' && Number.isFinite(lcp.numericValue)
        ? Math.round(lcp.numericValue)
        : null;

    return {
      ok: lcpMs != null,
      lcp_ms: lcpMs,
      performance_score:
        typeof perfScore === 'number' && Number.isFinite(perfScore)
          ? Math.round(perfScore * 100)
          : null,
      status_code: task.status_code ?? null,
      status_message: task.status_message || null,
      error: lcpMs == null ? 'Lighthouse probe did not return LCP' : null,
      duration_ms: Date.now() - startedAt,
      lighthouse_version: result?.lighthouseVersion || null,
      final_url: result?.finalUrl || result?.requestedUrl || null,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Lighthouse probe failed',
      duration_ms: Date.now() - startedAt,
    };
  }
}

export async function getSummary(env: Env, taskId: string): Promise<OnPageSummary> {
  // /on_page/summary/{id} is a GET endpoint with the task id in the path.
  // Using POST here returns "POST Data Is Empty." (40502).
  const data = await dataforseoGet(env, `/on_page/summary/${taskId}`, 20_000);
  const task = unwrap(data, 'summary');
  const result = task.result?.[0];
  if (!result) throw new Error('DataForSEO summary: missing result');
  return result as OnPageSummary;
}

export async function getPages(
  env: Env,
  taskId: string,
  limit: number = 20
): Promise<OnPagePage[]> {
  const data = await dataforseoRequest(
    env,
    '/on_page/pages',
    [{ id: taskId, limit }],
    30_000
  );
  const task = unwrap(data, 'pages');
  const items = task.result?.[0]?.items;
  return Array.isArray(items) ? (items as OnPagePage[]) : [];
}

export async function getResources(
  env: Env,
  taskId: string,
  limit: number = 200
): Promise<OnPageResource[]> {
  const data = await dataforseoRequest(
    env,
    '/on_page/resources',
    [{ id: taskId, limit }],
    30_000
  );
  const task = unwrap(data, 'resources');
  const items = task.result?.[0]?.items;
  return Array.isArray(items) ? (items as OnPageResource[]) : [];
}

export async function getMicrodata(
  env: Env,
  taskId: string,
  url: string
): Promise<OnPageMicrodata | null> {
  try {
    const data = await dataforseoRequest(
      env,
      '/on_page/microdata',
      [{ id: taskId, url }],
      20_000
    );
    const task = unwrap(data, 'microdata');
    const result = task.result?.[0];
    return (result as OnPageMicrodata) || null;
  } catch (err) {
    console.warn('[on-page] microdata fetch failed:', err);
    return null;
  }
}
