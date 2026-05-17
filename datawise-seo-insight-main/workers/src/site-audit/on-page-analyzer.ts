// Analyzer for the DataForSEO OnPage API (task-based flow).
// Consumes summary + pages + resources + microdata and produces the same
// AnalyzeResult + StructuredSEO shapes the existing dashboard renders, so the
// frontend does not need to change.

import type {
  OnPageSummary,
  OnPagePage,
  OnPageResource,
  OnPageMicrodata,
} from '../dataforseo/on-page';
import type {
  AnalyzeResult,
  Finding,
  FindingItem,
  ActionItem,
  ActionSubtask,
  Category,
  Severity,
} from './analyzer';
import type {
  StructuredSEO,
  LoadingSummary,
  PerfBreakdown,
  TitleAnalysis,
  MetaDescriptionAnalysis,
  HeadingsAnalysis,
  ImagesAnalysis,
  SchemaAnalysis,
  CrawledPageSummary,
} from './seo-analysis';
import {
  hasStablePoorLcp,
  mergeLoadingWithPerformanceSummary,
  shouldUseOnPageDurationForSlowPageLoad,
  type PerformanceMeasurementSummary,
} from './performance-stability';

// ---------- Severity → priority ----------
function severityToPriority(s: Severity): 'high' | 'medium' | 'low' {
  if (s === 'critical' || s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}

// ---------- Finding builder ----------
interface FindingInput {
  code: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  how_to_fix: string;
  display_value?: string | null;
  impact?: Finding['impact'];
  items?: FindingItem[];
  subtasks?: ActionSubtask[];
}

function push(
  findings: Finding[],
  items: ActionItem[],
  input: FindingInput
): void {
  const finding: Finding = {
    code: input.code,
    category: input.category,
    severity: input.severity,
    title: input.title,
    description: input.description,
    how_to_fix: input.how_to_fix,
    score: null,
    display_value: input.display_value ?? null,
    impact: input.impact ?? 'normal',
    ...(input.items && input.items.length ? { items: input.items } : {}),
  };
  const idx = findings.push(finding) - 1;
  items.push({
    code: finding.code,
    category: finding.category,
    priority: severityToPriority(finding.severity),
    title: finding.title,
    how_to_fix: finding.how_to_fix,
    finding_index: idx,
    impact: finding.impact,
    ...(input.subtasks && input.subtasks.length ? { subtasks: input.subtasks } : {}),
  });
}

function imageFilename(u: string): string {
  try {
    const parsed = new URL(u);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || parsed.hostname;
  } catch {
    return u;
  }
}

function formatSizeKB(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${Math.round(bytes / 1000)}KB`;
}

function buildImageSubtask(url: string, sizeBytes: number): ActionSubtask {
  return {
    id: `img-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    text: `${imageFilename(url)} — ${formatSizeKB(sizeBytes)}`,
    url,
    done: false,
  };
}

// Picks the homepage out of the crawled pages list. DataForSEO orders pages by
// discovery order, not canonical homepage, so pages[0] is often /about/ or
// similar. Prefer an exact match on root path, then fall back to pages[0].
export function pickHomepage(
  pages: OnPagePage[],
  startUrl: string | null
): OnPagePage | null {
  if (!pages.length) return null;
  const normalize = (u: string): string => {
    try {
      const url = new URL(u);
      return `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '') || '/'}`;
    } catch {
      return u;
    }
  };
  const start = startUrl ? normalize(startUrl) : null;
  if (start) {
    const exact = pages.find((p) => normalize(p.url) === start);
    if (exact) return exact;
  }
  // Fall back to any page whose path is just "/"
  const rootPath = pages.find((p) => {
    try {
      const u = new URL(p.url);
      return u.pathname === '/' || u.pathname === '';
    } catch {
      return false;
    }
  });
  return rootPath || pages[0];
}

function normalizeComparableUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '') || raw;
  }
}

function titleStatus(title: string, length: number): CrawledPageSummary['title_status'] {
  if (!title) return 'missing';
  if (length < 30) return 'too_short';
  if (length > 60) return 'too_long';
  return 'ok';
}

function descriptionStatus(
  description: string,
  length: number
): CrawledPageSummary['description_status'] {
  if (!description) return 'missing';
  if (length < 80) return 'too_short';
  if (length > 160) return 'too_long';
  return 'ok';
}

function h1Status(count: number): CrawledPageSummary['h1_status'] {
  if (count === 0) return 'missing';
  if (count > 1) return 'multiple';
  return 'ok';
}

export function summarizeCrawledPages(
  pages: OnPagePage[],
  startUrl: string | null
): CrawledPageSummary[] {
  const homepage = pickHomepage(pages, startUrl);
  const homepageKey = homepage ? normalizeComparableUrl(homepage.url) : null;
  const seen = new Set<string>();
  const summaries: CrawledPageSummary[] = [];

  for (const page of pages) {
    if (!page.url || seen.has(page.url)) continue;
    seen.add(page.url);

    const meta = page.meta || {};
    const title = meta.title || '';
    const titleLen = meta.title_length ?? title.length;
    const description = meta.description || '';
    const descriptionLen = meta.description_length ?? description.length;
    const h1Count = meta.htags?.h1?.length ?? 0;
    const status = typeof page.status_code === 'number' ? page.status_code : null;
    const loadMs =
      typeof page.page_timing?.duration_time === 'number'
        ? Math.round(page.page_timing.duration_time)
        : null;
    const titleState = titleStatus(title, titleLen);
    const descriptionState = descriptionStatus(description, descriptionLen);
    const h1State = h1Status(h1Count);
    const issueCount = [
      status != null && status >= 400,
      titleState !== 'ok',
      descriptionState !== 'ok',
      h1State !== 'ok',
      loadMs != null && loadMs > 3000,
    ].filter(Boolean).length;

    summaries.push({
      url: page.url,
      status_code: status,
      title: title || null,
      title_length: titleLen,
      title_status: titleState,
      description: description || null,
      description_length: descriptionLen,
      description_status: descriptionState,
      h1_count: h1Count,
      h1_status: h1State,
      load_ms: loadMs,
      internal_links_count:
        typeof meta.internal_links_count === 'number' ? meta.internal_links_count : null,
      external_links_count:
        typeof meta.external_links_count === 'number' ? meta.external_links_count : null,
      images_count: typeof meta.images_count === 'number' ? meta.images_count : null,
      is_homepage:
        homepageKey != null && normalizeComparableUrl(page.url) === homepageKey,
      issue_count: issueCount,
    });
  }

  return summaries.sort((a, b) => Number(b.is_homepage) - Number(a.is_homepage));
}

// Extracts unique schema type names from the DFS microdata response.
// DFS returns items[].inspection_info.types[] as arrays of schema.org types
// (e.g. ["WebPage"], ["Organization"]). We flatten and deduplicate.
export function extractSchemaTypes(microdata: OnPageMicrodata | null): string[] {
  if (!microdata?.items?.length) return [];
  const set = new Set<string>();
  for (const item of microdata.items as any[]) {
    const types = item?.inspection_info?.types;
    if (Array.isArray(types)) {
      for (const t of types) if (typeof t === 'string' && t) set.add(t);
    }
    // Recurse into nested fields for types like BreadcrumbList > itemListElement
    const fields = item?.inspection_info?.fields;
    if (Array.isArray(fields)) collectNestedTypes(fields, set);
  }
  return Array.from(set).sort();
}

function collectNestedTypes(fields: any[], set: Set<string>): void {
  for (const f of fields) {
    if (Array.isArray(f?.types)) {
      for (const t of f.types) if (typeof t === 'string' && t) set.add(t);
    }
    if (Array.isArray(f?.fields)) collectNestedTypes(f.fields, set);
  }
}

// ---------- Main entry ----------
export function analyzeOnPage(
  summary: OnPageSummary,
  pages: OnPagePage[],
  resources: OnPageResource[],
  microdata: OnPageMicrodata | null,
  startUrl: string | null = null,
  performanceSummary: PerformanceMeasurementSummary | null = null
): AnalyzeResult {
  const findings: Finding[] = [];
  const items: ActionItem[] = [];
  const homepage = pickHomepage(pages, startUrl);
  const meta = homepage?.meta || {};
  const timing = homepage?.page_timing || {};
  const checks = homepage?.checks || {};

  // --- Title checks ---
  const title = meta.title || '';
  const titleLen = meta.title_length ?? title.length;
  if (!title) {
    push(findings, items, {
      code: 'missing_title',
      category: 'meta',
      severity: 'critical',
      title: 'Missing page title',
      description: 'The homepage has no <title> tag.',
      how_to_fix:
        'Add a unique <title> between 50 and 60 characters that includes the primary keyword and the brand name.',
      impact: 'high_impact',
    });
  } else if (titleLen > 60) {
    push(findings, items, {
      code: 'title_too_long',
      category: 'meta',
      severity: 'medium',
      title: 'Title tag is too long',
      description: `Current title is ${titleLen} characters. Google truncates titles over ~60 characters in search results.`,
      how_to_fix: 'Rewrite the title to 50–60 characters, keeping the primary keyword near the front.',
      display_value: `${titleLen} chars`,
      impact: 'quick_win',
    });
  } else if (titleLen > 0 && titleLen < 30) {
    push(findings, items, {
      code: 'title_too_short',
      category: 'meta',
      severity: 'low',
      title: 'Title tag is short',
      description: `Current title is ${titleLen} characters. Short titles often miss ranking opportunities.`,
      how_to_fix: 'Expand the title to 50–60 characters. Add the primary keyword and brand.',
      display_value: `${titleLen} chars`,
      impact: 'quick_win',
    });
  }

  // --- Meta description checks ---
  const desc = meta.description || '';
  const descLen = meta.description_length ?? desc.length;
  if (!desc) {
    push(findings, items, {
      code: 'missing_meta_description',
      category: 'meta',
      severity: 'high',
      title: 'Missing meta description',
      description: 'The homepage has no meta description. Google may generate one from page content.',
      how_to_fix:
        'Add a unique meta description of 140–160 characters that summarizes the page and includes the primary keyword.',
      impact: 'quick_win',
    });
  } else if (descLen > 160) {
    push(findings, items, {
      code: 'meta_description_too_long',
      category: 'meta',
      severity: 'low',
      title: 'Meta description too long',
      description: `Current description is ${descLen} characters. Google truncates at ~155–160.`,
      how_to_fix: 'Trim the description to 140–160 characters without losing the hook.',
      display_value: `${descLen} chars`,
      impact: 'quick_win',
    });
  }

  // --- H1 checks ---
  const h1s = meta.htags?.h1 || [];
  if (h1s.length === 0) {
    push(findings, items, {
      code: 'missing_h1',
      category: 'content',
      severity: 'high',
      title: 'Missing H1 heading',
      description: 'The homepage has no <h1>. H1 is the single most important on-page heading for topical relevance.',
      how_to_fix: 'Add exactly one <h1> that states what the page is about and includes the primary keyword.',
      impact: 'high_impact',
    });
  } else if (h1s.length > 1) {
    push(findings, items, {
      code: 'multiple_h1',
      category: 'content',
      severity: 'medium',
      title: 'Multiple H1 tags',
      description: `This page has ${h1s.length} <h1> tags. Best practice is exactly one.`,
      how_to_fix: 'Keep the single most descriptive H1 and demote the others to H2.',
      display_value: `${h1s.length} H1s`,
      impact: 'quick_win',
    });
  }

  // --- Image alt checks ---
  const imageResources = resources.filter((r) => r.resource_type === 'image');
  const imagesMissingAlt = imageResources.filter((r) => {
    const alt = r.meta?.alternative_text;
    return alt == null || alt.trim() === '';
  });
  if (imagesMissingAlt.length > 0 || checks.no_image_alt) {
    const count = imagesMissingAlt.length || meta.images_count || 0;
    push(findings, items, {
      code: 'images_missing_alt',
      category: 'accessibility',
      severity: 'high',
      title: 'Images missing alt text',
      description: `${count} image${count === 1 ? '' : 's'} on this page ${count === 1 ? 'lacks' : 'lack'} descriptive alt text. Alt text helps both screen readers and image search.`,
      how_to_fix:
        'Add descriptive alt attributes to all <img> tags. Decorative images should use alt="". Never leave alt missing.',
      display_value: `${count} without alt`,
      impact: 'quick_win',
    });
  }

  // --- Performance: LCP / TTFB / loading time ---
  const lcpMs =
    performanceSummary?.median_lcp_ms != null
      ? performanceSummary.median_lcp_ms
      : typeof timing.largest_contentful_paint === 'number'
        ? timing.largest_contentful_paint
        : null;
  if (lcpMs != null && hasStablePoorLcp(performanceSummary, timing.largest_contentful_paint)) {
    const severity: Severity = lcpMs > 4000 ? 'critical' : 'high';
    push(findings, items, {
      code: 'poor_lcp',
      category: 'performance',
      severity,
      title: 'Slow Largest Contentful Paint (LCP)',
      description: `LCP is ${(lcpMs / 1000).toFixed(1)}s. Google considers >2.5s "needs improvement" and >4s "poor". LCP is a Core Web Vital ranking factor.`,
      how_to_fix:
        'Optimize the largest above-the-fold element: compress hero images, serve them in WebP/AVIF, add width/height attributes, preload critical resources, and remove render-blocking scripts.',
      display_value: `${(lcpMs / 1000).toFixed(1)}s`,
      impact: 'high_impact',
    });
  }

  const waitMs = timing.waiting_time;
  if (typeof waitMs === 'number' && waitMs > 600) {
    push(findings, items, {
      code: 'slow_server_response',
      category: 'performance',
      severity: 'medium',
      title: 'Slow server response (TTFB)',
      description: `Time to first byte is ${Math.round(waitMs)}ms. Google recommends TTFB under 600ms.`,
      how_to_fix:
        'Use a CDN, enable HTTP caching, upgrade hosting, or add a page cache. Database queries and heavy backend logic are common causes.',
      display_value: `${Math.round(waitMs)}ms`,
      impact: 'normal',
    });
  }

  const durationMs =
    shouldUseOnPageDurationForSlowPageLoad(performanceSummary) ? timing.duration_time : null;
  if (typeof durationMs === 'number' && durationMs > 3000) {
    push(findings, items, {
      code: 'slow_page_load',
      category: 'performance',
      severity: 'high',
      title: 'Slow overall page load',
      description: `Full page load is ${(durationMs / 1000).toFixed(1)}s. Pages over 3s see significant bounce-rate increases.`,
      how_to_fix:
        'Reduce total transfer size, defer non-critical JavaScript, lazy-load below-the-fold images, and minify CSS/JS.',
      display_value: `${(durationMs / 1000).toFixed(1)}s`,
      impact: 'high_impact',
    });
  }

  // --- Heavy images (per-page total) ---
  const imagesSize = meta.images_size ?? 0;
  if (imagesSize > 2_000_000) {
    // Surface the heaviest images (any format, > 100KB) as per-image subtasks
    // so the action card lets the user compress them one by one.
    const heavyImagesForSubtasks = imageResources
      .filter((r) => (r.size ?? 0) > 100_000)
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
      .slice(0, 20);
    const heavyItems: FindingItem[] = heavyImagesForSubtasks.map((r) => ({
      url: r.url,
      size_bytes: r.size ?? 0,
    }));
    const heavySubtasks: ActionSubtask[] = heavyImagesForSubtasks.map((r) =>
      buildImageSubtask(r.url, r.size ?? 0)
    );
    push(findings, items, {
      code: 'heavy_images',
      category: 'images',
      severity: 'medium',
      title: 'Heavy image payload',
      description: `This page ships ${(imagesSize / 1_000_000).toFixed(1)}MB of images. Large image payloads hurt mobile users the most.`,
      how_to_fix:
        'Serve images in WebP or AVIF, resize to the actual display size, compress with tools like Squoosh, and lazy-load anything below the fold.',
      display_value: `${(imagesSize / 1_000_000).toFixed(1)}MB`,
      impact: 'high_impact',
      items: heavyItems.length ? heavyItems : undefined,
      subtasks: heavySubtasks.length ? heavySubtasks : undefined,
    });
  }

  // --- Oversized individual images ---
  const oversized = imageResources
    .filter((r) => (r.size ?? 0) > 500_000)
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  if (oversized.length > 0) {
    const totalBytes = oversized.reduce((s, r) => s + (r.size ?? 0), 0);
    const capped = oversized.slice(0, 20);
    const oversizedItems: FindingItem[] = capped.map((r) => ({
      url: r.url,
      size_bytes: r.size ?? 0,
    }));
    const oversizedSubtasks: ActionSubtask[] = capped.map((r) =>
      buildImageSubtask(r.url, r.size ?? 0)
    );
    push(findings, items, {
      code: 'oversized_images',
      category: 'images',
      severity: 'medium',
      title: `${oversized.length} oversized image${oversized.length === 1 ? '' : 's'}`,
      description: `Found ${oversized.length} image${oversized.length === 1 ? '' : 's'} over 500KB, totalling ${(totalBytes / 1_000_000).toFixed(1)}MB.`,
      how_to_fix:
        'Compress each image and serve next-gen formats (WebP/AVIF). The individual files are listed below — tick each one off as you optimize it.',
      display_value: `${oversized.length} files`,
      impact: 'quick_win',
      items: oversizedItems,
      subtasks: oversizedSubtasks,
    });
  }

  // --- Broken resources ---
  const broken = resources.filter(
    (r) => r.checks?.is_broken || r.checks?.is_4xx_code || r.checks?.is_5xx_code
  );
  if (broken.length > 0) {
    push(findings, items, {
      code: 'broken_resources',
      category: 'technical',
      severity: 'high',
      title: `${broken.length} broken resource${broken.length === 1 ? '' : 's'}`,
      description: `Resources returning 4xx/5xx waste crawl budget and break page rendering.`,
      how_to_fix:
        'Fix or remove broken URLs. First broken: ' + (broken[0]?.url || 'unknown'),
      display_value: `${broken.length} broken`,
      impact: 'high_impact',
    });
  }

  // --- Schema / micromarkup ---
  const hasSchema = checks.has_micromarkup === true;
  if (!hasSchema) {
    push(findings, items, {
      code: 'no_schema',
      category: 'seo',
      severity: 'medium',
      title: 'No structured data (schema.org)',
      description:
        'No JSON-LD or microdata was detected. Schema helps Google understand your content and enables rich results.',
      how_to_fix:
        'Add JSON-LD for Organization or LocalBusiness, plus relevant types (Service, Product, FAQPage, Article). Test with schema.org validator.',
      impact: 'quick_win',
    });
  }
  const mdSummary = microdata?.test_summary;
  if (mdSummary && (mdSummary.error ?? 0) + (mdSummary.fatal ?? 0) > 0) {
    const totalErrs = (mdSummary.error ?? 0) + (mdSummary.fatal ?? 0);
    push(findings, items, {
      code: 'schema_validation_errors',
      category: 'seo',
      severity: 'medium',
      title: `${totalErrs} schema validation error${totalErrs === 1 ? '' : 's'}`,
      description:
        'Existing structured data has validation errors. Google may ignore malformed schema.',
      how_to_fix:
        'Run your homepage through https://validator.schema.org and fix each flagged field. Common issues: missing required properties, wrong types.',
      display_value: `${totalErrs} errors`,
      impact: 'normal',
    });
  }

  // --- HTTPS ---
  if (checks.is_https === false) {
    push(findings, items, {
      code: 'not_https',
      category: 'technical',
      severity: 'critical',
      title: 'Site not served over HTTPS',
      description: 'HTTPS is a Google ranking signal and required for modern browsers to trust the site.',
      how_to_fix:
        'Install a TLS certificate (Let\'s Encrypt is free) and force-redirect all HTTP traffic to HTTPS. Update canonical URLs.',
      impact: 'high_impact',
    });
  }

  // --- Domain-level checks from summary.domain_info ---
  const domainChecks = summary.domain_info?.checks || {};
  if (domainChecks.sitemap === false) {
    push(findings, items, {
      code: 'no_sitemap',
      category: 'technical',
      severity: 'low',
      title: 'No sitemap.xml found',
      description: 'Search engines use sitemaps to discover pages faster.',
      how_to_fix:
        'Generate a sitemap.xml and reference it in robots.txt. Most CMSs have a plugin for this.',
      impact: 'quick_win',
    });
  }
  if (domainChecks.robots_txt === false) {
    push(findings, items, {
      code: 'no_robots_txt',
      category: 'technical',
      severity: 'low',
      title: 'No robots.txt found',
      description: 'robots.txt tells crawlers what they can and cannot crawl.',
      how_to_fix:
        'Create a /robots.txt file at minimum with User-agent: * and a Sitemap: directive.',
      impact: 'quick_win',
    });
  }

  // --- Sitewide duplicate titles (from page_metrics) ---
  const dupTitles = summary.page_metrics?.duplicate_title ?? 0;
  if (dupTitles > 0) {
    push(findings, items, {
      code: 'duplicate_titles',
      category: 'meta',
      severity: 'medium',
      title: `${dupTitles} duplicate title tag${dupTitles === 1 ? '' : 's'}`,
      description: 'Multiple pages share the same <title>. Google has to guess which one to rank.',
      how_to_fix: 'Rewrite each page title to be unique and descriptive of that page\'s content.',
      display_value: `${dupTitles} pages`,
      impact: 'normal',
    });
  }

  // ---------- Aggregate scores ----------
  const onpageScore = summary.page_metrics?.onpage_score;
  const score = typeof onpageScore === 'number' ? Math.round(onpageScore) : 70;

  // Derive category scores from findings severity weights (crude but consistent).
  const seo_score = deriveCategoryScore(findings, ['seo', 'meta', 'content']);
  const derivedPerfScore = deriveCategoryScore(findings, ['performance', 'images']);
  const perf_score =
    performanceSummary?.median_performance_score ?? derivedPerfScore;
  const a11y_score = deriveCategoryScore(findings, ['accessibility']);
  const best_practices_score = deriveCategoryScore(findings, ['technical', 'best_practices']);

  return {
    findings,
    action_items: items,
    score,
    perf_score,
    seo_score,
    a11y_score,
    best_practices_score,
    meta: {
      title: title || null,
      description: desc || null,
      h1: h1s,
      has_schema: hasSchema,
    },
  };
}

function deriveCategoryScore(findings: Finding[], cats: Category[]): number {
  const relevant = findings.filter((f) => cats.includes(f.category));
  if (relevant.length === 0) return 95;
  let penalty = 0;
  for (const f of relevant) {
    if (f.severity === 'critical') penalty += 25;
    else if (f.severity === 'high') penalty += 12;
    else if (f.severity === 'medium') penalty += 6;
    else penalty += 2;
  }
  return Math.max(20, 100 - penalty);
}

// ---------- StructuredSEO builder (for the dashboard UI) ----------
export function buildStructuredSEO(
  summary: OnPageSummary,
  homepage: OnPagePage | null,
  resources: OnPageResource[],
  microdata: OnPageMicrodata | null,
  performanceSummary: PerformanceMeasurementSummary | null = null
): StructuredSEO {
  void summary;
  const meta = homepage?.meta || {};
  const timing = homepage?.page_timing || {};
  const checks = homepage?.checks || {};

  const lcpMs = timing.largest_contentful_paint;
  const lcpSec = typeof lcpMs === 'number' ? lcpMs / 1000 : null;
  const ttfbMs = timing.waiting_time ?? null;
  const totalBytes = homepage?.total_transfer_size ?? null;

  const loadingVerdict: LoadingSummary['verdict'] =
    lcpSec == null
      ? 'unknown'
      : lcpSec < 1.5
      ? 'fast'
      : lcpSec < 2.5
      ? 'ok'
      : lcpSec < 4
      ? 'slow'
      : 'very_slow';
  const loadingScore =
    lcpSec == null
      ? 50
      : lcpSec < 1.5
      ? 95
      : lcpSec < 2.5
      ? 80
      : lcpSec < 4
      ? 55
      : 25;

  const loading: LoadingSummary = mergeLoadingWithPerformanceSummary({
    score: loadingScore,
    seconds: lcpSec,
    ttfb_ms: ttfbMs != null ? Math.round(ttfbMs) : null,
    total_bytes: totalBytes,
    verdict: loadingVerdict,
    verdict_text:
      loadingVerdict === 'fast'
        ? 'Fast. Core Web Vitals are in the green.'
        : loadingVerdict === 'ok'
        ? 'OK. LCP is within Google\'s passing threshold but there is room to improve.'
        : loadingVerdict === 'slow'
        ? 'Slow. LCP is over 2.5s, Google considers this "needs improvement".'
        : loadingVerdict === 'very_slow'
        ? 'Very slow. LCP is over 4s, actively hurting rankings.'
        : 'Performance data unavailable.',
  }, performanceSummary) as LoadingSummary;

  // Estimate WebP savings: for every PNG/JPG > 100KB we assume ~40% reduction.
  // This is a rough heuristic but gives the dashboard a useful number.
  const heavyRasterImages = resources.filter((r) => {
    if (r.resource_type !== 'image') return false;
    const url = r.url.toLowerCase();
    const isRaster = /\.(png|jpe?g)(\?|#|$)/.test(url);
    return isRaster && (r.size ?? 0) > 100_000;
  });
  const estWebpSavings = heavyRasterImages.reduce(
    (s, r) => s + Math.round((r.size ?? 0) * 0.4),
    0
  );

  const perf: PerfBreakdown = {
    images: {
      present: (meta.images_size ?? 0) > 1_000_000 || estWebpSavings > 200_000,
      savings_bytes: estWebpSavings,
      savings_items: heavyRasterImages
        .slice(0, 10)
        .map((r) => ({ url: r.url, savings_bytes: Math.round((r.size ?? 0) * 0.4) })),
    },
    javascript: { present: (meta.scripts_size ?? 0) > 500_000, unused_bytes: meta.scripts_size ?? 0 },
    css: { present: (meta.stylesheets_size ?? 0) > 200_000, unused_bytes: meta.stylesheets_size ?? 0 },
    render_blocking: { present: false, count: 0, savings_ms: 0 },
  };

  const titleText = meta.title || '';
  const titleLen = meta.title_length ?? titleText.length;
  const title: TitleAnalysis = {
    present: !!titleText,
    text: titleText || null,
    length: titleLen,
    status: !titleText
      ? 'missing'
      : titleLen < 30
      ? 'too_short'
      : titleLen > 60
      ? 'too_long'
      : 'ok',
    source: titleText ? 'meta_tag' : null,
    issues: [],
    suggestion:
      !titleText || titleLen < 30 || titleLen > 60
        ? 'Rewrite the title to 50–60 characters with the primary keyword near the front.'
        : '',
  };

  const descText = meta.description || '';
  const descLen = meta.description_length ?? descText.length;
  const meta_description: MetaDescriptionAnalysis = {
    present: !!descText,
    text: descText || null,
    length: descLen,
    status: !descText
      ? 'missing'
      : descLen < 80
      ? 'too_short'
      : descLen > 160
      ? 'too_long'
      : 'ok',
    source: descText ? 'meta_tag' : null,
    is_google_snippet: false,
    has_cta: /\b(learn|get|try|start|book|buy|call|see|find|discover|shop|contact)\b/i.test(descText),
    issues: [],
    suggestion:
      !descText || descLen < 80 || descLen > 160
        ? 'Write a 140–160 character description with the primary keyword and a clear call-to-action.'
        : '',
  };

  const h1 = meta.htags?.h1 || [];
  const h2 = meta.htags?.h2 || [];
  const h3 = meta.htags?.h3 || [];
  const headings: HeadingsAnalysis = {
    h1,
    h2,
    h3,
    issues: [],
    hierarchy_ok: h1.length === 1 && h2.length > 0,
    total_count: h1.length + h2.length + h3.length,
    lighthouse_order_score: null,
    primary_keyword_in_h1: false,
    primary_keyword_in_any_heading: false,
    lsi_keyword_coverage: [],
  };

  const imageResources = resources.filter((r) => r.resource_type === 'image');
  const missingAlt = imageResources.filter(
    (r) => !r.meta?.alternative_text || r.meta.alternative_text.trim() === ''
  );
  const missingAltSamples = missingAlt
    .slice(0, 10)
    .map((r) => ({ src: r.url }));
  const formatMap = new Map<string, number>();
  for (const r of imageResources) {
    const ext = (r.url.match(/\.([a-z0-9]+)(?:\?|#|$)/i)?.[1] || 'unknown').toLowerCase();
    formatMap.set(ext, (formatMap.get(ext) ?? 0) + 1);
  }
  const pngResources = imageResources.filter((r) => /\.png(\?|#|$)/i.test(r.url));
  const pngSamples = pngResources.slice(0, 10).map((r) => ({
    src: r.url,
    alt: r.meta?.alternative_text || '',
  }));

  const images: ImagesAnalysis = {
    total: imageResources.length || meta.images_count || 0,
    missing_alt: missingAlt.length,
    missing_alt_samples: missingAltSamples,
    webp_savings_bytes: estWebpSavings,
    webp_savings_items: heavyRasterImages
      .slice(0, 10)
      .map((r) => ({ url: r.url, savings_bytes: Math.round((r.size ?? 0) * 0.4) })),
    // 1 = Lighthouse-style "passing" alt audit; we only report 1 when nothing
    // is missing, otherwise null so the dashboard doesn't claim "all good".
    lighthouse_alt_score: missingAlt.length === 0 ? 1 : null,
    png_count: pngResources.length,
    png_samples: pngSamples,
    format_breakdown: Array.from(formatMap.entries())
      .map(([format, count]) => ({ format, count }))
      .sort((a, b) => b.count - a.count),
  };

  const schemaTypes = extractSchemaTypes(microdata);
  const schemaPresent = schemaTypes.length > 0 || checks.has_micromarkup === true;
  const lowerTypes = schemaTypes.map((t) => t.toLowerCase());
  const hasType = (needle: string) => lowerTypes.some((t) => t.includes(needle));
  const recommended: string[] = [];
  if (!hasType('organization') && !hasType('localbusiness')) recommended.push('Organization');
  if (!hasType('localbusiness')) recommended.push('LocalBusiness');
  if (!hasType('service')) recommended.push('Service');
  if (!hasType('faqpage')) recommended.push('FAQPage');
  const schema: SchemaAnalysis = {
    present: schemaPresent,
    types: schemaTypes,
    has_faq: hasType('faqpage'),
    has_local_business: hasType('localbusiness'),
    has_organization: hasType('organization'),
    has_service: hasType('service'),
    recommended_missing: recommended,
  };

  return {
    loading,
    perf,
    title,
    meta_description,
    headings,
    images,
    schema,
    keyword_coverage: null,
    data_sources: {
      direct_fetch_ok: true,
      instant_pages_ok: true,
      content_parsing_ok: true,
      serp_ok: false,
      lighthouse_ok: (performanceSummary?.successful_sample_count ?? 0) > 0,
      bot_protection_detected: false,
    },
  };
}
