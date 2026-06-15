// Structured SEO analysis. Takes the raw Lighthouse result + optional
// instant_pages meta and returns a beginner-friendly, dashboard-ready object.
// All fields are meant to be rendered directly — no parsing on the frontend.

import type { LighthouseResult, InstantPageMeta } from './analyzer';

export interface LoadingSummary {
  score: number; // 0-100
  seconds: number | null; // LCP seconds (or FCP fallback)
  ttfb_ms: number | null;
  total_bytes: number | null;
  verdict: 'fast' | 'ok' | 'slow' | 'very_slow' | 'unknown';
  verdict_text: string;
  sample_count?: number;
  seconds_min?: number | null;
  seconds_max?: number | null;
  score_source?: 'lighthouse_median' | 'onpage_fallback';
  confidence?: 'high' | 'medium' | 'low';
  straddles_lcp_threshold?: boolean;
}

export interface PerfBreakdown {
  images: {
    present: boolean;
    savings_bytes: number;
    savings_items: { url: string; savings_bytes: number }[];
  };
  javascript: { present: boolean; unused_bytes: number };
  css: { present: boolean; unused_bytes: number };
  render_blocking: { present: boolean; count: number; savings_ms: number };
}

export interface TitleAnalysis {
  present: boolean;
  text: string | null;
  length: number;
  status: 'missing' | 'too_short' | 'too_long' | 'ok';
  source: 'meta_tag' | 'google_snippet' | 'h1_fallback' | null;
  issues: string[];
  suggestion: string;
}

export interface MetaDescriptionAnalysis {
  present: boolean;
  text: string | null;
  length: number;
  status: 'missing' | 'too_short' | 'too_long' | 'ok';
  source: 'meta_tag' | 'google_snippet' | null;
  is_google_snippet: boolean;
  has_cta: boolean;
  issues: string[];
  suggestion: string;
}

export interface HeadingsAnalysis {
  h1: string[];
  h2: string[];
  h3: string[];
  issues: string[];
  hierarchy_ok: boolean;
  total_count: number;
  lighthouse_order_score: number | null;
  // Keyword coverage (populated by computeKeywordCoverage post-LLM)
  primary_keyword_in_h1: boolean;
  primary_keyword_in_any_heading: boolean;
  lsi_keyword_coverage: { keyword: string; found_in: string[] }[];
}

export interface KeywordCoverage {
  primary_keyword: string;
  primary_in_title: boolean;
  primary_in_meta: boolean;
  primary_in_h1: boolean;
  primary_in_any_heading: boolean;
  lsi_keywords: { keyword: string; found_in: string[] }[];
  // Short verdict text for UI
  verdict: string;
}

export interface ImagesAnalysis {
  total: number;
  missing_alt: number;
  missing_alt_samples: { src: string }[];
  webp_savings_bytes: number;
  webp_savings_items: { url: string; savings_bytes: number }[];
  lighthouse_alt_score: number | null;
  // NEW: format breakdown from direct HTML parse
  png_count: number;
  png_samples: { src: string; alt: string }[];
  format_breakdown: { format: string; count: number }[];
}

export interface SchemaAnalysis {
  present: boolean;
  types: string[];
  has_faq: boolean;
  has_local_business: boolean;
  has_organization: boolean;
  has_service: boolean;
  recommended_missing: string[];
}

export interface DataSourceStatus {
  direct_fetch_ok: boolean;
  instant_pages_ok: boolean;
  content_parsing_ok: boolean;
  serp_ok: boolean;
  lighthouse_ok: boolean;
  bot_protection_detected: boolean;
}

export interface CrawledPageSummary {
  url: string;
  status_code: number | null;
  title: string | null;
  title_length: number;
  title_status: 'missing' | 'too_short' | 'too_long' | 'ok';
  description: string | null;
  description_length: number;
  description_status: 'missing' | 'too_short' | 'too_long' | 'ok';
  h1_count: number;
  h1_status: 'missing' | 'multiple' | 'ok';
  load_ms: number | null;
  internal_links_count: number | null;
  external_links_count: number | null;
  images_count: number | null;
  is_homepage: boolean;
  issue_count: number;
}

export interface StructuredSEO {
  loading: LoadingSummary;
  perf: PerfBreakdown;
  title: TitleAnalysis;
  meta_description: MetaDescriptionAnalysis;
  headings: HeadingsAnalysis;
  images: ImagesAnalysis;
  schema: SchemaAnalysis;
  crawled_pages?: CrawledPageSummary[];
  keyword_coverage?: KeywordCoverage | null;
  data_sources?: DataSourceStatus | null;
}

// ---------- Helpers ----------

function getAudit(lh: LighthouseResult | null, id: string): any {
  return (lh?.audits as any)?.[id];
}

function lcpScoreFromSeconds(seconds: number | null): number {
  if (seconds == null) return 50; // unknown → neutral
  // Mirrors Google's LCP thresholds: <2.5s good, <4s needs improvement, >4s poor
  if (seconds <= 1.0) return 100;
  if (seconds <= 2.5) return Math.round(90 - ((seconds - 1.0) / 1.5) * 20); // 90 → 70
  if (seconds <= 4.0) return Math.round(70 - ((seconds - 2.5) / 1.5) * 30); // 70 → 40
  if (seconds <= 8.0) return Math.round(40 - ((seconds - 4.0) / 4.0) * 30); // 40 → 10
  return 0;
}

function computeLoading(lh: LighthouseResult | null): LoadingSummary {
  const lcp = getAudit(lh, 'largest-contentful-paint');
  const fcp = getAudit(lh, 'first-contentful-paint');
  const srt = getAudit(lh, 'server-response-time');
  const tbw = getAudit(lh, 'total-byte-weight');
  const perfCategory = (lh?.categories as any)?.performance;
  const lhPerfScore: number | null =
    typeof perfCategory?.score === 'number' ? Math.round(perfCategory.score * 100) : null;

  const lcpMs: number | null =
    typeof lcp?.numericValue === 'number' ? lcp.numericValue : null;
  const fcpMs: number | null =
    typeof fcp?.numericValue === 'number' ? fcp.numericValue : null;

  const seconds = lcpMs != null ? lcpMs / 1000 : fcpMs != null ? fcpMs / 1000 : null;
  const ttfb_ms = typeof srt?.numericValue === 'number' ? Math.round(srt.numericValue) : null;
  const total_bytes = typeof tbw?.numericValue === 'number' ? Math.round(tbw.numericValue) : null;

  // Score priority: LCP seconds > Lighthouse perf category > TTFB-derived fallback
  let score: number;
  if (seconds != null) {
    score = lcpScoreFromSeconds(seconds);
  } else if (lhPerfScore != null) {
    score = lhPerfScore;
  } else if (ttfb_ms != null) {
    // TTFB-only heuristic: <200ms=95, <500ms=85, <800ms=70, <1500ms=55, >=1500ms=35
    score =
      ttfb_ms < 200
        ? 95
        : ttfb_ms < 500
          ? 85
          : ttfb_ms < 800
            ? 70
            : ttfb_ms < 1500
              ? 55
              : 35;
  } else {
    score = 50;
  }

  // Verdict priority: LCP > TTFB-based estimate > unknown
  let verdict: LoadingSummary['verdict'];
  let verdict_text: string;

  const estimatedSeconds = seconds ?? (ttfb_ms != null ? ttfb_ms / 1000 + 0.6 : null);

  if (estimatedSeconds == null) {
    verdict = 'unknown';
    verdict_text =
      'We could not measure the loading time this run. Try running the audit again in a minute — Lighthouse sometimes skips these metrics.';
  } else if (estimatedSeconds < 1.5) {
    verdict = 'fast';
    verdict_text = seconds != null
      ? `Your site shows its main content in ${seconds.toFixed(1)} seconds. Visitors and Google love this.`
      : `Your server responds in ${ttfb_ms} ms and your page is lightweight. Your site should load fast for most visitors.`;
  } else if (estimatedSeconds < 2.5) {
    verdict = 'ok';
    verdict_text = `Your site loads in about ${estimatedSeconds.toFixed(1)} seconds. That's acceptable, but getting under 1.5 seconds will boost your rankings and conversions.`;
  } else if (estimatedSeconds < 4) {
    verdict = 'slow';
    verdict_text = `Your site takes ${estimatedSeconds.toFixed(1)} seconds to show its main content. Google demotes sites that take more than 2.5 seconds. Fix this first.`;
  } else {
    verdict = 'very_slow';
    verdict_text = `Your site takes ${estimatedSeconds.toFixed(1)} seconds to show its main content. Most visitors will leave before it even finishes loading. This is the single most important thing to fix.`;
  }

  return { score, seconds, ttfb_ms, total_bytes, verdict, verdict_text };
}

function computePerfBreakdown(lh: LighthouseResult | null): PerfBreakdown {
  const readSavings = (auditId: string): { bytes: number; ms: number; items: any[] } => {
    const a = getAudit(lh, auditId);
    const details = a?.details || {};
    return {
      bytes: typeof details.overallSavingsBytes === 'number' ? details.overallSavingsBytes : 0,
      ms: typeof details.overallSavingsMs === 'number' ? details.overallSavingsMs : 0,
      items: Array.isArray(details.items) ? details.items : [],
    };
  };

  const imagesBytes = [
    readSavings('uses-optimized-images'),
    readSavings('modern-image-formats'),
    readSavings('uses-webp-images'),
    readSavings('offscreen-images'),
  ];
  const imageSavings = imagesBytes.reduce((s, x) => s + x.bytes, 0);
  const imageItems = imagesBytes
    .flatMap((x) =>
      x.items.map((it: any) => ({
        url: String(it.url || it.node?.snippet || '').slice(0, 200),
        savings_bytes: Number(it.wastedBytes || it.totalBytes || 0),
      }))
    )
    .filter((x) => x.url && x.savings_bytes > 0)
    .sort((a, b) => b.savings_bytes - a.savings_bytes)
    .slice(0, 8);

  const jsUnused = readSavings('unused-javascript').bytes;
  const cssUnused = readSavings('unused-css-rules').bytes;

  const rb = readSavings('render-blocking-resources');

  return {
    images: {
      present: imageSavings > 0,
      savings_bytes: imageSavings,
      savings_items: imageItems,
    },
    javascript: {
      present: jsUnused > 0,
      unused_bytes: jsUnused,
    },
    css: {
      present: cssUnused > 0,
      unused_bytes: cssUnused,
    },
    render_blocking: {
      present: rb.items.length > 0,
      count: rb.items.length,
      savings_ms: rb.ms,
    },
  };
}

function computeTitle(lh: LighthouseResult | null, pageMeta: InstantPageMeta | null): TitleAnalysis {
  const docTitleAudit = getAudit(lh, 'document-title');
  const pmTitle = pageMeta?.title?.trim() || '';
  const source: TitleAnalysis['source'] = pageMeta?.title_source || null;
  const present = pmTitle.length > 0 || docTitleAudit?.score === 1;
  const text = pmTitle || null;
  const length = pmTitle.length;

  const issues: string[] = [];
  let status: TitleAnalysis['status'];
  if (!present || !text) {
    status = 'missing';
    issues.push('Your page has no <title> tag. This is the single most important on-page ranking signal.');
  } else if (length < 30) {
    status = 'too_short';
    issues.push(`Your title is only ${length} characters. Target 50–60 to use the full SERP real estate.`);
  } else if (length > 65) {
    status = 'too_long';
    issues.push(`Your title is ${length} characters. Google truncates anything over ~60 characters.`);
  } else {
    status = 'ok';
  }

  if (source === 'google_snippet') {
    issues.push(
      'We read this from Google\'s search results, not your actual <title> tag. Your real tag could still be missing — double-check in View Source.'
    );
  } else if (source === 'h1_fallback') {
    issues.push('We could not read your <title> tag directly — this is your H1 instead.');
  }

  const suggestion =
    status === 'missing'
      ? 'Add a <title> tag to your <head>: "Primary Keyword | Location | Brand". Keep it between 50 and 60 characters.'
      : status === 'too_short'
        ? 'Expand your title to 50–60 characters. Add a location, benefit, or brand suffix.'
        : status === 'too_long'
          ? 'Shorten your title to 50–60 characters. Keep the most important words at the start so they survive truncation.'
          : 'Your title length is in the sweet spot. Double-check that it leads with the keyword you want to rank for.';

  return { present, text, length, status, source, issues, suggestion };
}

const CTA_WORDS = [
  'book',
  'call',
  'get',
  'find',
  'discover',
  'learn',
  'start',
  'try',
  'join',
  'contact',
  'see',
  'save',
  'shop',
  'buy',
  'schedule',
  'request',
  'claim',
  'download',
  'explore',
  'today',
  'now',
  'free',
];

function computeMetaDescription(
  lh: LighthouseResult | null,
  pageMeta: InstantPageMeta | null
): MetaDescriptionAnalysis {
  const mdAudit = getAudit(lh, 'meta-description');
  const pmDesc = pageMeta?.description?.trim() || '';
  const rawSource = pageMeta?.description_source || null;
  const source: MetaDescriptionAnalysis['source'] =
    rawSource === 'meta_tag' || rawSource === 'google_snippet' ? rawSource : null;
  const is_google_snippet = source === 'google_snippet';

  // If Lighthouse explicitly failed meta-description AND we got the description
  // from Google's auto-generated snippet (not a real meta tag), the real tag
  // is missing — flag it.
  const lhFailed = mdAudit && mdAudit.score === 0;
  const realMetaTagMissing = lhFailed && (source !== 'meta_tag');
  const present = pmDesc.length > 0 && !realMetaTagMissing;
  const text = pmDesc || null;
  const length = pmDesc.length;

  const issues: string[] = [];
  let status: MetaDescriptionAnalysis['status'];
  if (realMetaTagMissing) {
    status = 'missing';
    issues.push(
      'Your page has no real meta description — what you see here is the snippet Google auto-generated from your content. Add a real <meta name="description"> tag so you control what Google shows.'
    );
  } else if (!present) {
    status = 'missing';
    issues.push('Your page has no meta description. Google will auto-generate a snippet from your content — usually poorly.');
  } else if (length < 120) {
    status = 'too_short';
    issues.push(`Your description is only ${length} characters. Target 140–155 to maximise your SERP snippet.`);
  } else if (length > 160) {
    status = 'too_long';
    issues.push(`Your description is ${length} characters. Google truncates anything over 160.`);
  } else {
    status = 'ok';
  }

  const lowerDesc = text?.toLowerCase() || '';
  const has_cta = CTA_WORDS.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(lowerDesc));
  if (present && !has_cta) {
    issues.push('Your description has no call to action. Adding "Book today" or "Get a free quote" can lift your click-through rate by 10-20%.');
  }

  const suggestion =
    status === 'missing'
      ? 'Add <meta name="description" content="..."> to your <head>. Write 140–155 characters describing what you offer, where, and end with a CTA like "Book a free call".'
      : status === 'too_short'
        ? 'Expand your description to 140–155 characters. Add the location, a key benefit, and a CTA.'
        : status === 'too_long'
          ? 'Trim your description to 140–155 characters. Put the most important words first.'
          : has_cta
            ? 'Your meta description is well-sized and has a call to action. Solid.'
            : 'Your length is good but there is no CTA. Add "Book today" or "Get a free quote" at the end.';

  return { present, text, length, status, source, is_google_snippet, has_cta, issues, suggestion };
}

// Extract real headings from a Lighthouse audit's details.items[].node.snippet
// Each snippet looks like '<h1 class="x">Real Heading Text</h1>'. We parse the
// tag + text. Used as a last-resort when direct fetch + content_parsing both fail.
function extractHeadingsFromLighthouse(
  lh: LighthouseResult | null
): { h1: string[]; h2: string[]; h3: string[] } {
  const out = { h1: [] as string[], h2: [] as string[], h3: [] as string[] };
  if (!lh) return out;
  const auditIds = ['heading-order', 'largest-contentful-paint-element'];
  const seen = new Set<string>();
  for (const id of auditIds) {
    const audit = getAudit(lh, id);
    const items = audit?.details?.items || [];
    for (const it of items as any[]) {
      const node = it?.node;
      if (!node) continue;
      const snippet: string = typeof node === 'object' ? node.snippet || '' : String(node);
      if (!snippet) continue;
      const m = snippet.match(/^<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/i);
      if (!m) continue;
      const tag = m[1].toLowerCase() as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!text || seen.has(`${tag}:${text}`)) continue;
      seen.add(`${tag}:${text}`);
      if (tag === 'h1') out.h1.push(text);
      else if (tag === 'h2') out.h2.push(text);
      else if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') out.h3.push(text);
    }
  }
  return out;
}

function computeHeadings(
  lh: LighthouseResult | null,
  pageMeta: InstantPageMeta | null
): HeadingsAnalysis {
  let h1 = pageMeta?.h1 || [];
  let h2 = pageMeta?.h2 || [];
  let h3 = pageMeta?.h3 || [];

  // If we have no headings from page meta, fall back to whatever Lighthouse's
  // audit details surface. This is less complete but captures real text for
  // captcha-protected sites where direct fetch + content_parsing fail.
  if (h1.length === 0 && h2.length === 0 && h3.length === 0) {
    const lhHeadings = extractHeadingsFromLighthouse(lh);
    if (lhHeadings.h1.length || lhHeadings.h2.length || lhHeadings.h3.length) {
      h1 = lhHeadings.h1;
      h2 = lhHeadings.h2;
      h3 = lhHeadings.h3;
    }
  }

  const headingOrderAudit = getAudit(lh, 'heading-order');
  const lighthouse_order_score =
    typeof headingOrderAudit?.score === 'number' ? headingOrderAudit.score : null;

  const issues: string[] = [];
  let hierarchy_ok = true;
  if (h1.length === 0 && (pageMeta?.title || pageMeta?.h1)) {
    issues.push('Your page has no <h1> tag. The H1 is your headline for both users and search engines.');
    hierarchy_ok = false;
  } else if (h1.length > 1) {
    issues.push(`Your page has ${h1.length} <h1> tags. Use exactly one. Demote the others to <h2>.`);
    hierarchy_ok = false;
  }
  if (lighthouse_order_score !== null && lighthouse_order_score < 1) {
    issues.push('Your headings skip levels (for example, an H2 followed by an H4). Use them in sequence so screen readers and Google can parse your structure.');
    hierarchy_ok = false;
  }
  if (h2.length === 0 && h1.length > 0) {
    issues.push('You have an H1 but no H2 tags. Break your content into sections with H2 subheadings.');
  }

  return {
    h1,
    h2,
    h3,
    issues,
    hierarchy_ok,
    total_count: h1.length + h2.length + h3.length,
    lighthouse_order_score,
    primary_keyword_in_h1: false,
    primary_keyword_in_any_heading: false,
    lsi_keyword_coverage: [],
  };
}

/**
 * Heuristic primary keyword extractor — used when the LLM is unavailable.
 * Tokenizes title + H1 + first few H2s, removes stop words and brand suffixes,
 * and returns the best 2-4 word phrase.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with',
  'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'this', 'that', 'these', 'those', 'your', 'our', 'my', 'me', 'you', 'we', 'us',
  'home', 'page', 'welcome', 'about', 'contact', 'services', 'click', 'here',
  'more', 'read', 'learn', 'info',
]);

export function extractHeuristicPrimaryKeyword(seo: StructuredSEO): string {
  const sources: string[] = [];
  if (seo.title?.text) sources.push(seo.title.text);
  if (seo.headings?.h1?.length) sources.push(...seo.headings.h1);
  if (seo.headings?.h2?.length) sources.push(...seo.headings.h2.slice(0, 3));
  if (sources.length === 0) return '';

  // Prefer the H1 if present, else the title
  const primary = seo.headings?.h1?.[0] || seo.title?.text || '';
  // Strip brand / separator suffixes like " | Brand" or " - Home"
  const cleaned = primary
    .split(/\s*[|•·–—-]\s*/)[0]
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(' ').filter((w) => w && !STOP_WORDS.has(w) && w.length > 2);
  if (words.length === 0) return cleaned;
  // Take up to 4 meaningful words
  return words.slice(0, 4).join(' ');
}

/**
 * Post-LLM keyword coverage pass.
 * Takes the primary keyword + LSI keywords the LLM inferred, and checks them
 * against the real title/meta/H1/H2/H3 text. Case-insensitive word-boundary match.
 */
export function computeKeywordCoverage(
  seo: StructuredSEO,
  primaryKeyword: string,
  lsiKeywords: string[]
): KeywordCoverage {
  const contains = (haystack: string, needle: string): boolean => {
    if (!haystack || !needle) return false;
    const h = haystack.toLowerCase();
    const n = needle.toLowerCase().trim();
    if (!n) return false;
    // Match any of the primary keyword's tokens with a loose contains check,
    // but require the full phrase to match as substring for accuracy.
    return h.includes(n);
  };

  const title = seo.title.text || '';
  const meta = seo.meta_description.text || '';
  const h1 = seo.headings.h1.join(' | ');
  const allHeadings = [...seo.headings.h1, ...seo.headings.h2, ...seo.headings.h3].join(' | ');

  const primary_in_title = contains(title, primaryKeyword);
  const primary_in_meta = contains(meta, primaryKeyword);
  const primary_in_h1 = contains(h1, primaryKeyword);
  const primary_in_any_heading = contains(allHeadings, primaryKeyword);

  const lsi_keywords = lsiKeywords.map((kw) => {
    const found_in: string[] = [];
    if (contains(title, kw)) found_in.push('title');
    if (contains(meta, kw)) found_in.push('meta');
    if (contains(h1, kw)) found_in.push('h1');
    for (let i = 0; i < seo.headings.h2.length; i++) {
      if (contains(seo.headings.h2[i], kw)) found_in.push(`h2:${i + 1}`);
    }
    for (let i = 0; i < seo.headings.h3.length; i++) {
      if (contains(seo.headings.h3[i], kw)) found_in.push(`h3:${i + 1}`);
    }
    return { keyword: kw, found_in };
  });

  // Build a short verdict
  let verdict = '';
  if (!primaryKeyword) {
    verdict = 'No primary keyword was identified for this page.';
  } else if (primary_in_title && primary_in_h1) {
    verdict = `Your primary keyword "${primaryKeyword}" appears in both your title and H1 — good alignment.`;
  } else if (primary_in_title && !primary_in_h1) {
    verdict = `Your primary keyword is in the title but missing from your H1. Add it to the H1 for stronger on-page relevance.`;
  } else if (!primary_in_title && primary_in_h1) {
    verdict = `Your H1 mentions the primary keyword but your title tag does not. The title is the #1 ranking signal — add it there first.`;
  } else {
    verdict = `Your primary keyword "${primaryKeyword}" is not in your title or H1. This is the single biggest on-page gap to close.`;
  }

  return {
    primary_keyword: primaryKeyword,
    primary_in_title,
    primary_in_meta,
    primary_in_h1,
    primary_in_any_heading,
    lsi_keywords,
    verdict,
  };
}

/**
 * Applies KeywordCoverage flags back onto the headings analysis so the
 * frontend can render green checkmarks without duplicating logic.
 */
export function enrichHeadingsWithCoverage(
  headings: HeadingsAnalysis,
  coverage: KeywordCoverage
): HeadingsAnalysis {
  return {
    ...headings,
    primary_keyword_in_h1: coverage.primary_in_h1,
    primary_keyword_in_any_heading: coverage.primary_in_any_heading,
    lsi_keyword_coverage: coverage.lsi_keywords,
  };
}

function computeImages(
  lh: LighthouseResult | null,
  pageMeta: InstantPageMeta | null
): ImagesAnalysis {
  const altAudit = getAudit(lh, 'image-alt');
  const lighthouse_alt_score =
    typeof altAudit?.score === 'number' ? altAudit.score : null;

  // Cap how many sample URLs we surface. Generous enough to list every image
  // on a normal page (users asked for the full list, not just the first 5),
  // bounded so a pathological page can't bloat the stored audit JSON.
  const MAX_ALT_SAMPLES = 200;

  const missing_alt_samples: { src: string }[] = [];
  const pmImages = pageMeta?.images || [];
  const pmMissingAlt = pmImages.filter((img) => !img.alt || img.alt.trim() === '');

  // Prefer the parsed-HTML image list: it gives real, clickable src URLs.
  // The Lighthouse image-alt audit only exposes HTML snippets/selectors, which
  // aren't links, so we fall back to it only when the parser found nothing.
  if (pmMissingAlt.length > 0) {
    for (const img of pmMissingAlt.slice(0, MAX_ALT_SAMPLES)) {
      missing_alt_samples.push({ src: img.src });
    }
  } else {
    const altItems: any[] = Array.isArray(altAudit?.details?.items) ? altAudit.details.items : [];
    for (const it of altItems.slice(0, MAX_ALT_SAMPLES)) {
      const snippet = it?.node?.snippet || it?.node?.selector || it?.url || '';
      if (typeof snippet === 'string' && snippet) {
        missing_alt_samples.push({ src: snippet.slice(0, 300) });
      }
    }
  }

  // Format breakdown + PNG detection (from direct HTML parse)
  const getExtension = (src: string): string => {
    try {
      const u = new URL(src, 'https://example.com/');
      const m = u.pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
      return m ? m[1] : 'unknown';
    } catch {
      const m = src.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
      return m ? m[1] : 'unknown';
    }
  };
  const formatCounts = new Map<string, number>();
  for (const img of pmImages) {
    const ext = getExtension(img.src);
    formatCounts.set(ext, (formatCounts.get(ext) || 0) + 1);
  }
  const format_breakdown = Array.from(formatCounts.entries())
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count);
  const pngImages = pmImages.filter((img) => getExtension(img.src) === 'png');
  const png_count = pngImages.length;
  const png_samples = pngImages.slice(0, 8).map((img) => ({
    src: img.src,
    alt: img.alt || '',
  }));

  // WebP / optimized image savings — pull from all relevant audits, dedupe by URL
  // keeping the max wastedBytes per URL.
  const webpAuditIds = [
    'uses-optimized-images',
    'modern-image-formats',
    'uses-webp-images',
    'offscreen-images',
    'efficient-animated-content',
  ];
  const bestByUrl = new Map<string, number>();
  let totalSavings = 0;
  for (const id of webpAuditIds) {
    const a = getAudit(lh, id);
    const d = a?.details || {};
    if (typeof d.overallSavingsBytes === 'number') totalSavings += d.overallSavingsBytes;
    for (const it of (d.items || []) as any[]) {
      const url = String(it.url || '').slice(0, 300);
      const wastedBytes = Number(it.wastedBytes || it.totalBytes || 0);
      if (!url || wastedBytes <= 0) continue;
      const prev = bestByUrl.get(url) || 0;
      if (wastedBytes > prev) bestByUrl.set(url, wastedBytes);
    }
  }
  const webp_savings_items = Array.from(bestByUrl.entries())
    .map(([url, savings_bytes]) => ({ url, savings_bytes }))
    .sort((a, b) => b.savings_bytes - a.savings_bytes)
    .slice(0, 8);

  // Prefer the deduped per-image sum over overallSavingsBytes when available
  const webp_savings_bytes =
    webp_savings_items.length > 0
      ? webp_savings_items.reduce((s, i) => s + i.savings_bytes, 0)
      : totalSavings;

  const total = pmImages.length;
  // True count, independent of the sample cap, so the badge stays accurate even
  // when a page has more missing-alt images than we list URLs for.
  const missing_alt = pmMissingAlt.length > 0 ? pmMissingAlt.length : missing_alt_samples.length;

  return {
    total,
    missing_alt,
    missing_alt_samples,
    webp_savings_bytes,
    webp_savings_items,
    lighthouse_alt_score,
    png_count,
    png_samples,
    format_breakdown,
  };
}

function computeSchema(pageMeta: InstantPageMeta | null): SchemaAnalysis {
  // Prefer the pre-computed schema_types from the merge helper (which scanned
  // instant_pages content + content_parsing markdown). Fall back to scanning
  // pageMeta.content directly for older/simple flows.
  const explicitTypes = pageMeta?.schema_types || [];
  const content: string = pageMeta?.content || '';
  const typeMatches = Array.from(content.matchAll(/"@type"\s*:\s*"([^"]+)"/gi)).map((m) => m[1]);
  const unique = Array.from(new Set([...explicitTypes, ...typeMatches]));
  const lower = unique.map((t) => t.toLowerCase());

  const has_faq = lower.includes('faqpage');
  const has_local_business = lower.some((t) => t.includes('localbusiness'));
  const has_organization = lower.includes('organization');
  const has_service = lower.includes('service');
  const present = unique.length > 0 || Boolean(pageMeta?.has_schema);

  // If we detected FAQ-style questions in headings but no FAQPage schema,
  // the recommendation should still include FAQPage.
  const recommended_missing: string[] = [];
  if (!has_local_business && !has_organization)
    recommended_missing.push('LocalBusiness or Organization');
  if (!has_service) recommended_missing.push('Service');
  if (!has_faq) recommended_missing.push('FAQPage');

  return {
    present,
    types: unique,
    has_faq,
    has_local_business,
    has_organization,
    has_service,
    recommended_missing,
  };
}

// ---------- Main ----------

export function analyzeSEO(
  lighthouse: LighthouseResult | null,
  pageMeta: InstantPageMeta | null
): StructuredSEO {
  return {
    loading: computeLoading(lighthouse),
    perf: computePerfBreakdown(lighthouse),
    title: computeTitle(lighthouse, pageMeta),
    meta_description: computeMetaDescription(lighthouse, pageMeta),
    headings: computeHeadings(lighthouse, pageMeta),
    images: computeImages(lighthouse, pageMeta),
    schema: computeSchema(pageMeta),
  };
}
