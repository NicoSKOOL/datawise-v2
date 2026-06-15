import type { Env } from '../index';
import {
  taskPost,
  getSummary,
  getPages,
  getResources,
  getMicrodata,
  getLighthousePerformanceProbe,
  LIGHTHOUSE_PERFORMANCE_PROBE_CONFIG,
} from '../dataforseo/on-page';
import type { OnPageSummary } from '../dataforseo/on-page';
import { safeFetch, BROWSER_UA } from '../lib/safe-fetch';
import {
  analyzeOnPage,
  buildStructuredSEO,
  pickHomepage,
  summarizeCrawledPages,
} from '../site-audit/on-page-analyzer';
import type { AnalyzeResult } from '../site-audit/analyzer';
import {
  collectPerformanceProbeSamples,
  summarizePerformanceSamples,
  type PerformanceProbeSample,
  type PerformanceMeasurementSummary,
} from '../site-audit/performance-stability';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function cleanDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
    .trim()
    .toLowerCase();
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const PERFORMANCE_PROBE_COUNT = 3;
const INITIAL_POLL_DELAY_SECONDS = 45;
const MAX_POLL_DELAY_SECONDS = 5 * 60;
const PROCESSING_LOCK_SECONDS = 90;
const HARD_TIMEOUT_MINUTES = 45;

export interface CrawlDiagnostics {
  reason_code: string;
  user_message: string;
  technical_message?: string | null;
  task_status_message?: string | null;
  crawl_progress?: string | null;
  crawl_stop_reason?: string | null;
  extended_crawl_status?: string | null;
  crawl_gateway_address?: string | null;
  pages_crawled?: number | null;
  max_crawl_pages?: number | null;
  domain_server?: string | null;
  domain_ip?: string | null;
  checks?: Record<string, unknown> | null;
}

export function getAuditPollDelaySeconds(retryCount: number): number {
  const safeRetryCount = Number.isFinite(retryCount) ? Math.max(0, Math.floor(retryCount)) : 0;
  return Math.min(
    INITIAL_POLL_DELAY_SECONDS * 2 ** Math.min(safeRetryCount, 4),
    MAX_POLL_DELAY_SECONDS
  );
}

function truthyCheckKeys(checks: Record<string, unknown> | undefined | null): string[] {
  if (!checks) return [];
  return Object.entries(checks)
    .filter(([, value]) => value === true || value === 1)
    .map(([key]) => key.toLowerCase());
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function buildCrawlDiagnostics(
  summary: OnPageSummary | null,
  fallbackMessage?: string | null
): CrawlDiagnostics {
  const domainInfo = summary?.domain_info || {};
  const checks = domainInfo.checks || {};
  const checkKeys = truthyCheckKeys(checks as Record<string, unknown>);
  const crawlStopReason =
    summary?.crawl_stop_reason || domainInfo.crawl_stop_reason || null;
  const extendedStatus = domainInfo.extended_crawl_status || null;
  const crawlGatewayAddress =
    summary?.crawl_gateway_address || domainInfo.crawl_gateway_address || null;
  const pagesCrawled = summary?.crawl_status?.pages_crawled ?? null;
  const maxCrawlPages = summary?.crawl_status?.max_crawl_pages ?? null;
  const server = domainInfo.server || '';
  const combined = [
    fallbackMessage || '',
    crawlStopReason || '',
    extendedStatus || '',
    crawlGatewayAddress || '',
    domainInfo.status_message || '',
    server,
    checkKeys.join(' '),
  ]
    .join(' ')
    .toLowerCase();

  let reasonCode = 'unknown_zero_page_crawl';
  let userMessage =
    'DataForSEO finished with zero pages. The crawler may be blocked by staging protection, firewall rules, or temporary access issues. Make the URL crawlable or whitelist DataForSEO, then retry.';

  if (containsAny(combined, ['forbidden_robots', 'robots.txt', 'robots_txt'])) {
    reasonCode = 'forbidden_robots';
    userMessage =
      'The crawler was blocked by robots.txt. Make the URL crawlable or whitelist DataForSEO, then retry.';
  } else if (containsAny(combined, ['forbidden_meta_tag', 'meta robots', 'noindex'])) {
    reasonCode = 'forbidden_meta_tag';
    userMessage =
      'The page blocks crawlers with a robots meta tag. Remove that block or retry on a crawlable URL.';
  } else if (
    containsAny(combined, ['forbidden_http_header', 'x-robots', 'x_robots'])
  ) {
    reasonCode = 'forbidden_http_header';
    userMessage =
      'The page blocks crawlers with an X-Robots-Tag header. Remove that block or whitelist DataForSEO, then retry.';
  } else if (containsAny(combined, ['too_many_redirects', 'redirect loop', 'redirect_loop'])) {
    reasonCode = 'too_many_redirects';
    userMessage =
      'The crawl stopped in a redirect chain. Fix the redirects and retry.';
  } else if (
    containsAny(combined, ['site_unreachable', 'unreachable', 'dns', 'connection refused'])
  ) {
    reasonCode = 'site_unreachable';
    userMessage =
      'DataForSEO could not reach the site. Check DNS, hosting, firewall, or HTTPS and retry.';
  } else if (
    containsAny(combined, ['invalid_page_status_code', '4xx', '5xx']) ||
    (typeof domainInfo.status_code === 'number' && domainInfo.status_code >= 400)
  ) {
    reasonCode = 'invalid_page_status_code';
    const isCloudflare = containsAny(combined, ['cloudflare', 'cf-ray', 'attention required']);
    userMessage = isCloudflare
      ? 'The crawl reached a blocked HTTP response, likely Cloudflare bot protection. Whitelist DataForSEO crawler IPs or use a crawlable staging URL, then retry.'
      : 'The crawl got an invalid HTTP status. Fix the server response or make the URL crawlable, then retry.';
  }

  return {
    reason_code: reasonCode,
    user_message: userMessage,
    technical_message: fallbackMessage || domainInfo.status_message || null,
    crawl_progress: summary?.crawl_progress || null,
    crawl_stop_reason: crawlStopReason,
    extended_crawl_status: extendedStatus,
    crawl_gateway_address: crawlGatewayAddress,
    pages_crawled: pagesCrawled,
    max_crawl_pages: maxCrawlPages,
    domain_server: domainInfo.server || null,
    domain_ip: domainInfo.ip || null,
    checks: checks as Record<string, unknown>,
  };
}

async function collectHomepagePerformanceSamples(
  env: Env,
  auditId: string,
  url: string
): Promise<PerformanceProbeSample[]> {
  return collectPerformanceProbeSamples(PERFORMANCE_PROBE_COUNT, async (sampleIndex) => {
    const sample = await getLighthousePerformanceProbe(env, url, {
      auditId,
      sampleIndex,
    });
    console.log(
      `[site-audit] performance probe ${sampleIndex}/${PERFORMANCE_PROBE_COUNT} for ${auditId}: ok=${sample.ok} lcp=${sample.lcp_ms ?? 'n/a'}`
    );
    return sample;
  });
}

function buildLighthouseDiagnostics(
  samples: PerformanceProbeSample[],
  summary: PerformanceMeasurementSummary,
  url: string
): Record<string, unknown> {
  return {
    source: 'dataforseo_lighthouse_live_json',
    version: 1,
    url,
    config: LIGHTHOUSE_PERFORMANCE_PROBE_CONFIG,
    summary,
    samples: samples.map((sample, index) => ({
      index: index + 1,
      ok: sample.ok,
      lcp_ms: sample.lcp_ms ?? null,
      performance_score: sample.performance_score ?? null,
      status_code: sample.status_code ?? null,
      status_message: sample.status_message ?? null,
      error: sample.error ?? null,
      duration_ms: sample.duration_ms ?? null,
      lighthouse_version: sample.lighthouse_version ?? null,
      final_url: sample.final_url ?? null,
    })),
  };
}

// ---------- POST /api/site-audit/audits ----------
// Fires a DataForSEO OnPage task and returns immediately. The crawl runs on
// DataForSEO's infrastructure; the scheduled queue processor polls and
// finalizes even if the browser is closed.
export async function handleCreateAudit(
  request: Request,
  env: Env,
  userId: string,
  _ctx: ExecutionContext
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { domain?: string };
  if (!body.domain?.trim()) return json({ error: 'domain is required' }, 400);

  const domain = cleanDomain(body.domain);
  if (!domain || !domain.includes('.')) return json({ error: 'Invalid domain' }, 400);

  const startUrl = `https://${domain}/`;
  const auditId = generateId();

  let taskId: string;
  try {
    taskId = await taskPost(env, {
      target: domain,
      max_crawl_pages: 10,
      start_url: startUrl,
      auditId,
    });
  } catch (err: any) {
    console.error('[site-audit] task_post failed:', err);
    return json(
      { error: `Failed to start audit: ${err?.message || 'unknown error'}` },
      502
    );
  }

  await env.DB.prepare(
    `INSERT INTO site_audits (
       id, user_id, domain, start_url, status, dataforseo_task_id, next_poll_at
     )
     VALUES (?, ?, ?, ?, 'running', ?, datetime('now', ?))`
  )
    .bind(auditId, userId, domain, startUrl, taskId, `+${INITIAL_POLL_DELAY_SECONDS} seconds`)
    .run();

  console.log(`[site-audit] created audit ${auditId} task ${taskId} for ${domain}`);

  const row = await env.DB.prepare('SELECT * FROM site_audits WHERE id = ?').bind(auditId).first();
  return json(row, 201);
}

function buildInProgressDiagnostics(summary: OnPageSummary): CrawlDiagnostics {
  return {
    ...buildCrawlDiagnostics(summary, null),
    reason_code: 'crawling',
    user_message: 'DataForSEO is still crawling this site.',
  };
}

function buildCompletedDiagnostics(summary: OnPageSummary): CrawlDiagnostics {
  return {
    ...buildCrawlDiagnostics(summary, null),
    reason_code: 'completed',
    user_message: 'DataForSEO completed the crawl.',
  };
}

function buildHardTimeoutDiagnostics(audit: any): CrawlDiagnostics {
  return {
    reason_code: 'hard_timeout',
    user_message:
      'The audit did not finish within 45 minutes. Retry the audit, and if this is a staging or protected URL, make it crawlable or whitelist DataForSEO first.',
    technical_message: `Audit ${audit.id} exceeded the ${HARD_TIMEOUT_MINUTES}-minute processing timeout.`,
    pages_crawled: typeof audit.pages_crawled === 'number' ? audit.pages_crawled : null,
    max_crawl_pages: null,
  };
}

async function markAuditFailed(
  env: Env,
  auditId: string,
  diagnostics: CrawlDiagnostics
): Promise<void> {
  await env.DB.prepare(
    `UPDATE site_audits
     SET status = 'failed',
         error_message = ?,
         crawl_diagnostics = ?,
         next_poll_at = NULL,
         processing_locked_until = NULL,
         completed_at = COALESCE(completed_at, datetime('now')),
         last_polled_at = datetime('now')
     WHERE id = ?`
  )
    .bind(diagnostics.user_message, JSON.stringify(diagnostics), auditId)
    .run();
}

async function scheduleAuditRetry(
  env: Env,
  audit: any,
  err: any
): Promise<void> {
  const retryCount = Number(audit.retry_count || 0) + 1;
  const delaySeconds = getAuditPollDelaySeconds(retryCount);
  const diagnostics: CrawlDiagnostics = {
    reason_code: 'dataforseo_retry',
    user_message: 'DataForSEO did not return audit progress yet. Retrying automatically.',
    technical_message: err?.message || String(err || 'DataForSEO summary fetch failed'),
    pages_crawled: typeof audit.pages_crawled === 'number' ? audit.pages_crawled : null,
    max_crawl_pages: null,
  };

  await env.DB.prepare(
    `UPDATE site_audits
     SET retry_count = ?,
         next_poll_at = datetime('now', ?),
         processing_locked_until = NULL,
         crawl_diagnostics = ?,
         last_polled_at = datetime('now')
     WHERE id = ?`
  )
    .bind(retryCount, `+${delaySeconds} seconds`, JSON.stringify(diagnostics), audit.id)
    .run();
}

async function scheduleNextAuditPoll(
  env: Env,
  auditId: string,
  summary: OnPageSummary
): Promise<void> {
  await env.DB.prepare(
    `UPDATE site_audits
     SET status = 'running',
         pages_crawled = ?,
         retry_count = 0,
         next_poll_at = datetime('now', ?),
         processing_locked_until = NULL,
         crawl_diagnostics = ?,
         last_polled_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      summary.crawl_status?.pages_crawled ?? 0,
      `+${INITIAL_POLL_DELAY_SECONDS} seconds`,
      JSON.stringify(buildInProgressDiagnostics(summary)),
      auditId
    )
    .run();
}

// DFS sometimes reports robots.txt / sitemap as missing when the site's WAF
// blocked DFS's own fetch (many WooCommerce/Cloudflare sites 403 non-browser
// user agents) even though the files exist and serve 200 to a real browser.
// Confirmed 2026-06-03 on resortstylebeanbags.com.au, which was flagged "No
// robots.txt found" while robots.txt is present. Before trusting a "missing"
// verdict, re-check ourselves with a browser UA and clear the false negative
// (mutating summary.domain_info.checks) so the analyzer never emits the wrong
// finding. Costs zero extra fetches for sites DFS already saw as present.
async function clearRobotsSitemapFalseNegatives(
  summary: OnPageSummary,
  startUrl: string | null
): Promise<void> {
  const checks = summary.domain_info?.checks;
  if (!checks) return;
  const robotsMissing = checks.robots_txt === false;
  const sitemapMissing = checks.sitemap === false;
  if (!robotsMissing && !sitemapMissing) return;

  let origin: string;
  try {
    origin = new URL(startUrl || '').origin;
  } catch {
    return;
  }

  const declaredSitemaps: string[] = [];

  if (robotsMissing) {
    try {
      const resp = await safeFetch(`${origin}/robots.txt`, {
        headers: { 'User-Agent': BROWSER_UA, Accept: 'text/plain,*/*' },
        redirect: 'follow',
        timeoutMs: 10_000,
      });
      if (resp.ok) {
        const text = (await resp.text()).trim();
        if (text.length > 0) {
          checks.robots_txt = true;
          for (const line of text.split('\n')) {
            if (line.toLowerCase().startsWith('sitemap:')) {
              const u = line.split(':').slice(1).join(':').trim();
              if (u) declaredSitemaps.push(u);
            }
          }
        }
      }
    } catch {
      // leave DFS verdict untouched on fetch/SSRF-guard error
    }
  }

  if (sitemapMissing) {
    const candidates = declaredSitemaps.length
      ? declaredSitemaps
      : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
    for (const url of candidates) {
      try {
        const resp = await safeFetch(url, {
          headers: { 'User-Agent': BROWSER_UA, Accept: 'application/xml,text/xml,*/*' },
          redirect: 'follow',
          timeoutMs: 10_000,
        });
        if (resp.ok && /<(urlset|sitemapindex)/i.test((await resp.text()).slice(0, 5000))) {
          checks.sitemap = true;
          break;
        }
      } catch {
        // try next candidate
      }
    }
  }
}

// ---------- Queue processor + finalizer ----------
// Used by cron and opportunistically by list/detail endpoints. It checks DFS
// summary, and if the crawl is finished, pulls pages/resources/microdata,
// runs the analyzer, persists findings, and marks the row completed.
async function processAuditRow(env: Env, audit: any): Promise<any> {
  const taskId = audit.dataforseo_task_id;
  if (!taskId) return audit;

  let summary;
  try {
    summary = await getSummary(env, taskId);
  } catch (err: any) {
    console.error(`[site-audit] summary fetch failed for ${audit.id}:`, err);
    await scheduleAuditRetry(env, audit, err);
    return audit;
  }

  console.log(
    `[site-audit] poll ${audit.id} crawl_progress=${summary.crawl_progress} pages_crawled=${summary.crawl_status?.pages_crawled}/${summary.crawl_status?.max_crawl_pages}`
  );

  if (summary.crawl_progress !== 'finished') {
    await scheduleNextAuditPoll(env, audit.id, summary);
    return {
      ...audit,
      pages_crawled: summary.crawl_status?.pages_crawled ?? 0,
      crawl_diagnostics: buildInProgressDiagnostics(summary),
    };
  }

  // Crawl finished — but DFS occasionally reports "finished" with 0 pages
  // crawled (bot protection, rate limits, or a transient DFS issue). Treat
  // that as a failure so the UI doesn't render an empty audit.
  const crawledCount = summary.crawl_status?.pages_crawled ?? 0;
  if (crawledCount === 0) {
    const diagnostics = buildCrawlDiagnostics(summary, null);
    console.error(`[site-audit] zero-page crawl for ${audit.id}: ${JSON.stringify(summary.domain_info?.checks || {})}`);
    await markAuditFailed(env, audit.id, diagnostics);
    return await env.DB.prepare('SELECT * FROM site_audits WHERE id = ?').bind(audit.id).first();
  }

  // Crawl is done. Pull the rest in parallel, mark status='analyzing'.
  await env.DB.prepare(
    `UPDATE site_audits
     SET status = 'analyzing',
         crawl_diagnostics = ?,
         last_polled_at = datetime('now')
     WHERE id = ?`
  )
    .bind(JSON.stringify(buildCompletedDiagnostics(summary)), audit.id)
    .run();

  const t0 = Date.now();
  const [pagesRes, resourcesRes] = await Promise.allSettled([
    getPages(env, taskId, 20),
    getResources(env, taskId, 200),
  ]);

  const pages = pagesRes.status === 'fulfilled' ? pagesRes.value : [];
  const resources = resourcesRes.status === 'fulfilled' ? resourcesRes.value : [];
  if (pages.length === 0) {
    const diagnostics = buildCrawlDiagnostics(
      summary,
      'DataForSEO reported crawled pages, but the pages endpoint returned no rows.'
    );
    await markAuditFailed(env, audit.id, diagnostics);
    return await env.DB.prepare('SELECT * FROM site_audits WHERE id = ?').bind(audit.id).first();
  }

  const homepage = pickHomepage(pages, audit.start_url);
  const homepageUrl = homepage?.url || audit.start_url;
  const [microdata, performanceSamples] = await Promise.all([
    homepage ? getMicrodata(env, taskId, homepage.url).catch(() => null) : Promise.resolve(null),
    collectHomepagePerformanceSamples(env, audit.id, homepageUrl),
  ]);
  const performanceSummary = summarizePerformanceSamples(
    performanceSamples,
    PERFORMANCE_PROBE_COUNT
  );
  const lighthouseDiagnostics = buildLighthouseDiagnostics(
    performanceSamples,
    performanceSummary,
    homepageUrl
  );

  console.log(
    `[site-audit] pulled data for ${audit.id} in ${Date.now() - t0}ms: ${pages.length} pages, ${resources.length} resources, microdata=${!!microdata}, perf_samples=${performanceSummary.successful_sample_count}/${PERFORMANCE_PROBE_COUNT}`
  );

  // Clear DFS robots.txt/sitemap false negatives (WAF-blocked DFS fetch) before
  // analysis so we don't surface findings that contradict the live site.
  await clearRobotsSitemapFalseNegatives(summary, homepageUrl);

  // Run the analyzer.
  let result: AnalyzeResult;
  let seoAnalysis: any;
  try {
    result = analyzeOnPage(
      summary,
      pages,
      resources,
      microdata,
      audit.start_url,
      performanceSummary
    );
    seoAnalysis = {
      ...buildStructuredSEO(summary, homepage, resources, microdata, performanceSummary),
      crawled_pages: summarizeCrawledPages(pages, audit.start_url),
    };
  } catch (err: any) {
    console.error(`[site-audit] analyzer crashed for ${audit.id}:`, err);
    const diagnostics: CrawlDiagnostics = {
      ...buildCrawlDiagnostics(summary, err?.message || 'Analyzer error'),
      reason_code: 'analyzer_error',
      user_message:
        'The crawl finished, but we could not analyze the returned data. Please retry the audit.',
    };
    await markAuditFailed(env, audit.id, diagnostics);
    return await env.DB.prepare('SELECT * FROM site_audits WHERE id = ?').bind(audit.id).first();
  }

  // Persist findings + action items in batches.
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM audit_action_items WHERE audit_id = ? AND source = ?').bind(audit.id, 'audit'),
    env.DB.prepare('DELETE FROM audit_findings WHERE audit_id = ?').bind(audit.id),
  ];
  const findingIdByIdx = new Map<number, string>();
  result.findings.forEach((f, i) => {
    const fid = generateId();
    findingIdByIdx.set(i, fid);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO audit_findings (id, audit_id, category, severity, code, title, description, page_url, evidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        fid,
        audit.id,
        f.category,
        f.severity,
        f.code,
        f.title,
        f.description,
        audit.start_url,
        JSON.stringify({
          score: f.score,
          display_value: f.display_value,
          how_to_fix: f.how_to_fix,
          impact: f.impact,
          ...(f.items && f.items.length ? { items: f.items } : {}),
        })
      )
    );
  });

  result.action_items.forEach((a, i) => {
    const aid = generateId();
    const findingId = findingIdByIdx.get(a.finding_index) || null;
    const subtasksJson =
      a.subtasks && a.subtasks.length ? JSON.stringify(a.subtasks) : null;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO audit_action_items
         (id, audit_id, finding_id, title, how_to_fix, category, priority, status, position, subtasks)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?)`
      ).bind(
        aid,
        audit.id,
        findingId,
        a.title,
        a.how_to_fix,
        a.category,
        a.priority,
        i * 1000,
        subtasksJson
      )
    );
  });

  for (let i = 0; i < stmts.length; i += 50) {
    await env.DB.batch(stmts.slice(i, i + 50));
  }

  // We do not generate an AI summary. The dashboard hides its "Your audit, in
  // plain English" card when ai_analysis is null, which is what we want.
  await env.DB.prepare(
    `UPDATE site_audits
     SET status = 'completed',
         score = ?,
         perf_score = ?,
         seo_score = ?,
         a11y_score = ?,
         best_practices_score = ?,
         lighthouse_data = ?,
         ai_analysis = NULL,
         seo_analysis = ?,
         pages_crawled = ?,
         error_message = NULL,
         crawl_diagnostics = ?,
         retry_count = 0,
         next_poll_at = NULL,
         processing_locked_until = NULL,
         completed_at = datetime('now')
     WHERE id = ?`
  )
    .bind(
      result.score,
      result.perf_score,
      result.seo_score,
      result.a11y_score,
      result.best_practices_score,
      JSON.stringify(lighthouseDiagnostics),
      JSON.stringify(seoAnalysis),
      summary.crawl_status?.pages_crawled ?? pages.length,
      JSON.stringify(buildCompletedDiagnostics(summary)),
      audit.id
    )
    .run();

  console.log(`[site-audit] finalized audit ${audit.id} with ${result.findings.length} findings`);

  return await env.DB.prepare('SELECT * FROM site_audits WHERE id = ?').bind(audit.id).first();
}

async function markHardTimedOutAudits(
  env: Env,
  options: { userId?: string; auditId?: string } = {}
): Promise<number> {
  const conditions = [
    "status IN ('pending','running','analyzing')",
    `created_at < datetime('now', '-${HARD_TIMEOUT_MINUTES} minutes')`,
  ];
  const params: string[] = [];
  if (options.userId) {
    conditions.push('user_id = ?');
    params.push(options.userId);
  }
  if (options.auditId) {
    conditions.push('id = ?');
    params.push(options.auditId);
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM site_audits WHERE ${conditions.join(' AND ')} LIMIT 25`
  )
    .bind(...params)
    .all();

  for (const audit of results || []) {
    await markAuditFailed(env, (audit as any).id, buildHardTimeoutDiagnostics(audit));
  }
  return (results || []).length;
}

export interface ProcessSiteAuditQueueOptions {
  batchSize?: number;
  userId?: string;
  auditId?: string;
}

export async function processSiteAuditQueue(
  env: Env,
  options: ProcessSiteAuditQueueOptions = {}
): Promise<{ processed: number; completed: number; failed: number; timed_out: number }> {
  const timedOut = await markHardTimedOutAudits(env, options);
  const batchSize = Math.max(1, Math.min(options.batchSize || 5, 10));
  const conditions = [
    "status IN ('pending','running','analyzing')",
    "(next_poll_at IS NULL OR next_poll_at <= datetime('now'))",
    "(processing_locked_until IS NULL OR processing_locked_until < datetime('now'))",
    `created_at >= datetime('now', '-${HARD_TIMEOUT_MINUTES} minutes')`,
  ];
  const params: (string | number)[] = [];
  if (options.userId) {
    conditions.push('user_id = ?');
    params.push(options.userId);
  }
  if (options.auditId) {
    conditions.push('id = ?');
    params.push(options.auditId);
  }

  const { results } = await env.DB.prepare(
    `SELECT * FROM site_audits
     WHERE ${conditions.join(' AND ')}
     ORDER BY COALESCE(next_poll_at, created_at) ASC
     LIMIT ?`
  )
    .bind(...params, batchSize)
    .all();

  let processed = 0;
  let completed = 0;
  let failed = 0;
  for (const row of results || []) {
    const audit = row as any;
    const lockResult = await env.DB.prepare(
      `UPDATE site_audits
       SET processing_locked_until = datetime('now', ?)
       WHERE id = ?
         AND status IN ('pending','running','analyzing')
         AND (processing_locked_until IS NULL OR processing_locked_until < datetime('now'))`
    )
      .bind(`+${PROCESSING_LOCK_SECONDS} seconds`, audit.id)
      .run();
    if (!((lockResult.meta as any)?.changes > 0)) continue;

    const locked = await env.DB.prepare('SELECT * FROM site_audits WHERE id = ?')
      .bind(audit.id)
      .first();
    if (!locked) continue;

    processed += 1;
    try {
      const updated = await processAuditRow(env, locked);
      if (updated?.status === 'completed') completed += 1;
      if (updated?.status === 'failed') failed += 1;
    } catch (err) {
      console.error(`[site-audit] queue processor failed for ${audit.id}:`, err);
      await scheduleAuditRetry(env, locked, err);
    }
  }

  return { processed, completed, failed, timed_out: timedOut };
}

// ---------- GET /api/site-audit/audits ----------
export async function handleListAudits(env: Env, userId: string): Promise<Response> {
  await processSiteAuditQueue(env, { userId, batchSize: 1 });
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.domain, a.start_url, a.status, a.score, a.perf_score, a.seo_score,
            a.a11y_score, a.best_practices_score, a.pages_crawled, a.error_message,
            a.crawl_diagnostics, a.created_at, a.completed_at,
       (SELECT COUNT(*) FROM audit_action_items WHERE audit_id = a.id) AS total_items,
       (SELECT COUNT(*) FROM audit_action_items WHERE audit_id = a.id AND status = 'done') AS done_items
     FROM site_audits a
     WHERE a.user_id = ?
     ORDER BY a.created_at DESC
     LIMIT 50`
  )
    .bind(userId)
    .all();
  return json(
    (results || []).map((audit: any) => ({
      ...audit,
      crawl_diagnostics: audit.crawl_diagnostics ? safeJson(audit.crawl_diagnostics) : null,
    }))
  );
}

// ---------- GET /api/site-audit/audits/:id ----------
export async function handleGetAudit(
  env: Env,
  userId: string,
  auditId: string
): Promise<Response> {
  await processSiteAuditQueue(env, { userId, auditId, batchSize: 1 });

  const audit = (await env.DB.prepare(
    'SELECT * FROM site_audits WHERE id = ? AND user_id = ?'
  )
    .bind(auditId, userId)
    .first()) as any;
  if (!audit) return json({ error: 'Audit not found' }, 404);

  const { results: findings } = await env.DB.prepare(
    `SELECT * FROM audit_findings WHERE audit_id = ?
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at`
  )
    .bind(auditId)
    .all();

  const parsedAudit = {
    ...audit,
    lighthouse_data: audit.lighthouse_data ? safeJson(audit.lighthouse_data) : null,
    ai_analysis: audit.ai_analysis ? safeJson(audit.ai_analysis) : null,
    seo_analysis: audit.seo_analysis ? safeJson(audit.seo_analysis) : null,
    crawl_diagnostics: audit.crawl_diagnostics ? safeJson(audit.crawl_diagnostics) : null,
  };
  const parsedFindings = (findings || []).map((f: any) => ({
    ...f,
    evidence: f.evidence ? safeJson(f.evidence) : null,
  }));

  return json({ audit: parsedAudit, findings: parsedFindings });
}

// ---------- DELETE /api/site-audit/audits/:id ----------
export async function handleDeleteAudit(
  env: Env,
  userId: string,
  auditId: string
): Promise<Response> {
  const audit = await env.DB.prepare(
    'SELECT id FROM site_audits WHERE id = ? AND user_id = ?'
  )
    .bind(auditId, userId)
    .first();
  if (!audit) return json({ error: 'Audit not found' }, 404);
  await env.DB.prepare('DELETE FROM site_audits WHERE id = ?').bind(auditId).run();
  return json({ success: true });
}

// ---------- GET /api/site-audit/audits/:id/action-items ----------
export async function handleListActionItems(
  env: Env,
  userId: string,
  auditId: string
): Promise<Response> {
  const audit = await env.DB.prepare(
    'SELECT id FROM site_audits WHERE id = ? AND user_id = ?'
  )
    .bind(auditId, userId)
    .first();
  if (!audit) return json({ error: 'Audit not found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT * FROM audit_action_items
     WHERE audit_id = ?
     ORDER BY CASE status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, position ASC`
  )
    .bind(auditId)
    .all();
  return json(results);
}

// ---------- GET /api/site-audit/properties/:propertyId/tasks ----------
// Returns all tasks for a property: manual tasks (property_id match) plus
// any legacy audit-generated tasks for audits of that property.
export async function handleListPropertyTasks(
  env: Env,
  userId: string,
  propertyId: string,
  url: URL
): Promise<Response> {
  const prop = await env.DB.prepare(
    'SELECT id FROM gsc_properties WHERE id = ? AND user_id = ?'
  )
    .bind(propertyId, userId)
    .first();
  if (!prop) return json({ error: 'Property not found' }, 404);

  const auditId = url.searchParams.get('audit_id');

  // Union: property-scoped rows (manual + backfilled audit rows) + optional
  // current-audit rows (catches any audit rows where property_id couldn't be
  // backfilled, e.g. audits whose domain doesn't match any GSC property).
  const { results } = auditId
    ? await env.DB.prepare(
        `SELECT * FROM audit_action_items
         WHERE property_id = ? OR (audit_id = ? AND property_id IS NULL)
         ORDER BY CASE status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, position ASC`
      )
        .bind(propertyId, auditId)
        .all()
    : await env.DB.prepare(
        `SELECT * FROM audit_action_items
         WHERE property_id = ?
         ORDER BY CASE status WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, position ASC`
      )
        .bind(propertyId)
        .all();

  return json(results);
}

// ---------- POST /api/site-audit/tasks ----------
// Create a manual task, scoped to a property. Not tied to a specific audit.
export async function handleCreateTask(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    property_id?: string;
    audit_id?: string | null;
    title?: string;
    how_to_fix?: string;
    category?: string;
    url?: string;
    priority?: string;
    status?: string;
    due_date?: string;
    subtasks?: unknown;
    attachments?: unknown;
    notes?: string;
  };

  if (!body.property_id) return json({ error: 'property_id required' }, 400);
  if (!body.title?.trim()) return json({ error: 'title required' }, 400);

  const prop = await env.DB.prepare(
    'SELECT id FROM gsc_properties WHERE id = ? AND user_id = ?'
  )
    .bind(body.property_id, userId)
    .first();
  if (!prop) return json({ error: 'Property not found' }, 404);

  // Optional audit_id: verify ownership if provided.
  let auditId: string | null = null;
  if (body.audit_id) {
    const audit = await env.DB.prepare(
      'SELECT id FROM site_audits WHERE id = ? AND user_id = ?'
    )
      .bind(body.audit_id, userId)
      .first();
    if (!audit) return json({ error: 'Audit not found' }, 404);
    auditId = body.audit_id;
  }

  const allowedStatus = ['todo', 'in_progress', 'done'];
  const allowedPriority = ['high', 'medium', 'low'];
  const priority = body.priority && allowedPriority.includes(body.priority) ? body.priority : 'medium';
  const status = body.status && allowedStatus.includes(body.status) ? body.status : 'todo';

  const id = generateId();

  await env.DB.prepare(
    `INSERT INTO audit_action_items (
       id, property_id, audit_id, source, title, how_to_fix, category, url,
       priority, status, due_date, subtasks, attachments, notes
     ) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.property_id,
      auditId,
      body.title.trim(),
      body.how_to_fix || '',
      body.category || null,
      body.url || null,
      priority,
      status,
      body.due_date || null,
      body.subtasks != null ? JSON.stringify(body.subtasks) : null,
      body.attachments != null ? JSON.stringify(body.attachments) : null,
      body.notes || null
    )
    .run();

  const row = await env.DB.prepare('SELECT * FROM audit_action_items WHERE id = ?')
    .bind(id)
    .first();
  return json(row, 201);
}

// ---------- PATCH /api/site-audit/action-items/:id ----------
export async function handleUpdateActionItem(
  request: Request,
  env: Env,
  userId: string,
  itemId: string
): Promise<Response> {
  // Ownership: via audit_id OR via property_id.
  const item = await env.DB.prepare(
    `SELECT ai.id FROM audit_action_items ai
     LEFT JOIN site_audits a ON a.id = ai.audit_id
     LEFT JOIN gsc_properties p ON p.id = ai.property_id
     WHERE ai.id = ? AND (a.user_id = ? OR p.user_id = ?)`
  )
    .bind(itemId, userId, userId)
    .first();
  if (!item) return json({ error: 'Action item not found' }, 404);

  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    priority?: string;
    position?: number;
    notes?: string;
    title?: string;
    how_to_fix?: string;
    category?: string | null;
    url?: string | null;
    due_date?: string | null;
    subtasks?: unknown;
    attachments?: unknown;
  };

  const allowedStatus = ['todo', 'in_progress', 'done'];
  const allowedPriority = ['high', 'medium', 'low'];
  const sets: string[] = [];
  const values: any[] = [];

  if (body.status !== undefined) {
    if (!allowedStatus.includes(body.status)) return json({ error: 'Invalid status' }, 400);
    sets.push('status = ?');
    values.push(body.status);
    sets.push(body.status === 'done' ? "completed_at = datetime('now')" : 'completed_at = NULL');
  }
  if (body.priority !== undefined) {
    if (!allowedPriority.includes(body.priority)) return json({ error: 'Invalid priority' }, 400);
    sets.push('priority = ?');
    values.push(body.priority);
  }
  if (typeof body.position === 'number') {
    sets.push('position = ?');
    values.push(body.position);
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?');
    values.push(body.notes);
  }
  if (body.title !== undefined) {
    if (!body.title.trim()) return json({ error: 'title cannot be empty' }, 400);
    sets.push('title = ?');
    values.push(body.title.trim());
  }
  if (body.how_to_fix !== undefined) {
    sets.push('how_to_fix = ?');
    values.push(body.how_to_fix);
  }
  if (body.category !== undefined) {
    sets.push('category = ?');
    values.push(body.category || null);
  }
  if (body.url !== undefined) {
    sets.push('url = ?');
    values.push(body.url || null);
  }
  if (body.due_date !== undefined) {
    sets.push('due_date = ?');
    values.push(body.due_date || null);
  }
  if (body.subtasks !== undefined) {
    sets.push('subtasks = ?');
    values.push(body.subtasks == null ? null : JSON.stringify(body.subtasks));
  }
  if (body.attachments !== undefined) {
    sets.push('attachments = ?');
    values.push(body.attachments == null ? null : JSON.stringify(body.attachments));
  }
  if (sets.length === 0) return json({ error: 'Nothing to update' }, 400);

  sets.push("updated_at = datetime('now')");
  values.push(itemId);

  await env.DB.prepare(`UPDATE audit_action_items SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  const row = await env.DB.prepare('SELECT * FROM audit_action_items WHERE id = ?')
    .bind(itemId)
    .first();
  return json(row);
}

// ---------- POST /api/site-audit/tasks/:id/attachments ----------
// Upload a screenshot or doc attached to a task. Multipart/form-data with
// a single file field named "file". Streams to R2, returns { url, name, content_type }.
// The returned URL is a worker-served public endpoint; caller is expected to
// PATCH the task's attachments JSON to include this new entry.
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_ATTACHMENT_MIME = /^(image\/(png|jpe?g|webp|gif|avif|svg\+xml)|application\/pdf)$/i;

export async function handleUploadTaskAttachment(
  request: Request,
  env: Env,
  userId: string
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Expected multipart/form-data' }, 400);
  }
  const fileRaw = form.get('file');
  if (!fileRaw || typeof fileRaw === 'string') return json({ error: 'file field required' }, 400);
  const file = fileRaw as unknown as {
    size: number;
    type: string;
    name: string;
    stream: () => ReadableStream;
  };
  if (file.size === 0) return json({ error: 'Empty file' }, 400);
  if (file.size > MAX_ATTACHMENT_BYTES) return json({ error: 'File exceeds 10 MB limit' }, 413);

  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_ATTACHMENT_MIME.test(contentType)) {
    return json({ error: `Unsupported file type: ${contentType}` }, 415);
  }

  const ext = contentType.split('/')[1]?.split('+')[0]?.replace('jpeg', 'jpg') || 'bin';
  const key = `${userId}/${generateId()}.${ext}`;

  await env.TASK_ATTACHMENTS.put(key, file.stream(), {
    httpMetadata: { contentType },
  });

  const origin = new URL(request.url).origin;
  const url = `${origin}/api/attachments/${key}`;
  const name = (file.name || '').slice(0, 180) || `attachment.${ext}`;

  return json({ url, name, content_type: contentType }, 201);
}

// ---------- GET /api/attachments/:key ----------
// Public (unauthenticated) serve for task attachments. Keys are random UUIDs
// so enumeration is not feasible. The worker returns the R2 object directly.
export async function handleServeAttachment(
  env: Env,
  keyParts: string[]
): Promise<Response> {
  const key = keyParts.join('/');
  if (!key) return json({ error: 'Missing key' }, 400);
  const obj = await env.TASK_ATTACHMENTS.get(key);
  if (!obj) return json({ error: 'Not found' }, 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=3600');
  return new Response(obj.body, { headers });
}

// ---------- DELETE /api/site-audit/action-items/:id ----------
export async function handleDeleteActionItem(
  env: Env,
  userId: string,
  itemId: string
): Promise<Response> {
  const item = await env.DB.prepare(
    `SELECT ai.id FROM audit_action_items ai
     LEFT JOIN site_audits a ON a.id = ai.audit_id
     LEFT JOIN gsc_properties p ON p.id = ai.property_id
     WHERE ai.id = ? AND (a.user_id = ? OR p.user_id = ?)`
  )
    .bind(itemId, userId, userId)
    .first();
  if (!item) return json({ error: 'Action item not found' }, 404);
  await env.DB.prepare('DELETE FROM audit_action_items WHERE id = ?').bind(itemId).run();
  return json({ success: true });
}
