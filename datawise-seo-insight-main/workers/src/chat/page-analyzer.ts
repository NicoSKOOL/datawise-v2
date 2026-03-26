import type { Env } from '../index';
import { dataforseoRequest } from '../dataforseo/client';

// --- Types ---

interface PageData {
  url: string;
  meta: {
    title: string;
    description: string;
    htags: Record<string, string[]>;
  };
  plain_text_content: string;
  word_count: number;
  internal_links: { url: string; anchor: string }[];
  external_links: { url: string; anchor: string }[];
  images_count: number;
  content_html: string;
}

interface BlogAnalysis {
  wordCountAssessment: string;
  headingCounts: { h1: number; h2: number; h3: number };
  externalLinkCount: number;
  externalLinkFlag: string | null;
  internalLinkCount: number;
  internalLinkFlag: string | null;
  capsuleScore: string;
  capsuleDetails: string;
  metaTitle: { length: number; assessment: string };
  metaDescription: { length: number; assessment: string };
  hasH1: boolean;
}

interface ServiceAnalysis {
  ctaCount: number;
  ctaAboveFold: boolean;
  ctaExamples: string[];
  trustSignals: string[];
  localSeoSignals: string[];
  schemaTypes: string[];
}

// --- URL Detection ---

export function detectPageUrl(message: string, siteUrl: string, knownPages: string[]): string | null {
  // Match full URLs
  const fullUrlMatch = message.match(/https?:\/\/[^\s)]+/i);
  if (fullUrlMatch) {
    const url = fullUrlMatch[0].replace(/[.,;:!?)]+$/, '');
    const siteDomain = new URL(siteUrl.replace(/\/$/, '')).hostname;
    try {
      const urlDomain = new URL(url).hostname;
      if (urlDomain !== siteDomain) return null; // reject competitor URLs
    } catch {
      return null;
    }
    return url;
  }

  // Match paths starting with /
  const pathMatch = message.match(/(?:^|\s)(\/[a-z0-9\-_/]+)/i);
  if (pathMatch) {
    const path = pathMatch[1];
    const baseUrl = siteUrl.replace(/\/$/, '');
    const resolvedUrl = baseUrl + path;

    // Check against known pages
    for (const knownPage of knownPages) {
      if (knownPage === resolvedUrl || knownPage.endsWith(path) || knownPage.endsWith(path + '/')) {
        return knownPage;
      }
    }

    // Even if not in known pages, resolve it
    return resolvedUrl;
  }

  return null;
}

// --- Page Fetch ---

export async function fetchPageData(env: Env, url: string): Promise<PageData | null> {
  const data = await dataforseoRequest(env, '/on_page/instant_pages', [{
    url,
    load_resources: false,
    enable_javascript: true,
  }]);

  const page = data?.tasks?.[0]?.result?.[0]?.items?.[0];
  if (!page) return null;

  let plainText = page.plain_text_content || '';
  if (plainText.length > 15000) {
    plainText = plainText.substring(0, 15000);
  }

  return {
    url: page.url || url,
    meta: {
      title: page.meta?.title || '',
      description: page.meta?.description || '',
      htags: page.meta?.htags || {},
    },
    plain_text_content: plainText,
    word_count: page.meta?.content?.plain_text_word_count || plainText.split(/\s+/).length,
    internal_links: (page.internal_links || []).map((l: any) => ({
      url: l.url || l.link_to || '',
      anchor: l.anchor || '',
    })),
    external_links: (page.external_links || []).map((l: any) => ({
      url: l.url || l.link_to || '',
      anchor: l.anchor || '',
    })),
    images_count: page.meta?.content?.plain_text_images_count || 0,
    content_html: (page.html || '').substring(0, 50000),
  };
}

// --- Classification ---

export function classifyPageType(data: PageData): 'blog' | 'service' | 'homepage' {
  const url = data.url.toLowerCase();

  // Homepage check
  const path = new URL(url).pathname;
  if (path === '/' || path === '/index' || path === '/index.html') return 'homepage';

  // Blog signals from URL
  if (/\/(blog|post|article|news)\//.test(url)) return 'blog';

  // Service signals from URL
  if (/\/(services?|pricing|contact|booking|schedule)\//.test(url)) return 'service';

  // Content-based heuristics
  const h2Count = (data.meta.htags?.h2 || []).length;
  if (data.word_count > 1000 && h2Count > 3 && data.external_links.length > 2) return 'blog';

  const titleLower = data.meta.title.toLowerCase();
  if (data.word_count < 800 && /services?|pricing|book|schedule|contact/.test(titleLower)) return 'service';

  return 'service'; // default: safer to give transactional advice
}

// --- Blog Analysis ---

export function analyzeBlogContent(data: PageData): BlogAnalysis {
  const h1s = data.meta.htags?.h1 || [];
  const h2s = data.meta.htags?.h2 || [];
  const h3s = data.meta.htags?.h3 || [];

  // Word count assessment
  let wordCountAssessment: string;
  if (data.word_count < 800) wordCountAssessment = 'thin (< 800 words)';
  else if (data.word_count < 1500) wordCountAssessment = 'moderate';
  else if (data.word_count < 2500) wordCountAssessment = 'good depth';
  else wordCountAssessment = 'comprehensive';

  // External link flag
  let externalLinkFlag: string | null = null;
  if (data.external_links.length === 0 && data.word_count > 1500) {
    externalLinkFlag = 'No external links on a long post: claims lack citations';
  } else if (data.external_links.length < 2 && data.word_count > 1000) {
    externalLinkFlag = 'Very few external links: consider adding citations';
  }

  // Internal link flag
  let internalLinkFlag: string | null = null;
  if (data.internal_links.length < 3) {
    internalLinkFlag = 'Low internal linking: add links to related content';
  }

  // Content capsule detection
  const { score: capsuleScore, details: capsuleDetails } = detectContentCapsules(data.plain_text_content, h2s);

  // Meta assessment
  const titleLen = data.meta.title.length;
  const descLen = data.meta.description.length;

  return {
    wordCountAssessment,
    headingCounts: { h1: h1s.length, h2: h2s.length, h3: h3s.length },
    externalLinkCount: data.external_links.length,
    externalLinkFlag,
    internalLinkCount: data.internal_links.length,
    internalLinkFlag,
    capsuleScore,
    capsuleDetails,
    metaTitle: {
      length: titleLen,
      assessment: titleLen === 0 ? 'missing' : titleLen < 50 ? 'short' : titleLen <= 60 ? 'good' : 'too long',
    },
    metaDescription: {
      length: descLen,
      assessment: descLen === 0 ? 'missing' : descLen < 120 ? 'short' : descLen <= 160 ? 'good' : 'too long',
    },
    hasH1: h1s.length > 0,
  };
}

function detectContentCapsules(text: string, h2s: string[]): { score: string; details: string } {
  if (h2s.length < 2) {
    return { score: 'no capsule structure', details: 'Too few H2 sections to form capsules' };
  }

  // Split text by h2 headings to estimate section lengths
  let sectionWordCounts: number[] = [];
  let remainingText = text;

  for (let i = 0; i < h2s.length; i++) {
    const heading = h2s[i];
    const idx = remainingText.indexOf(heading);
    if (idx === -1) continue;

    const afterHeading = remainingText.substring(idx + heading.length);
    const nextH2 = h2s[i + 1];
    let sectionText: string;

    if (nextH2) {
      const nextIdx = afterHeading.indexOf(nextH2);
      sectionText = nextIdx !== -1 ? afterHeading.substring(0, nextIdx) : afterHeading;
    } else {
      sectionText = afterHeading;
    }

    sectionWordCounts.push(sectionText.split(/\s+/).filter(w => w.length > 0).length);
    remainingText = afterHeading;
  }

  if (sectionWordCounts.length < 2) {
    return { score: 'no capsule structure', details: 'Could not identify distinct sections' };
  }

  const mean = sectionWordCounts.reduce((a, b) => a + b, 0) / sectionWordCounts.length;
  const stdDev = Math.sqrt(sectionWordCounts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / sectionWordCounts.length);
  const isConsistent = mean > 0 && (stdDev / mean) < 0.4;

  // Check for takeaway markers
  const takeawayPattern = /key takeaway|bottom line|in summary|takeaway|tldr|tl;dr/i;
  const hasTakeaways = takeawayPattern.test(text);

  const rangeStr = `${Math.min(...sectionWordCounts)}-${Math.max(...sectionWordCounts)} words`;

  if (isConsistent && hasTakeaways) {
    return { score: 'uses capsule structure', details: `Sections are consistent (${rangeStr}) with takeaway markers` };
  } else if (isConsistent || hasTakeaways) {
    return { score: 'partially uses capsule structure', details: `Sections vary ${rangeStr}; ${hasTakeaways ? 'has' : 'no'} takeaway markers` };
  }

  return { score: 'no capsule structure', details: `Sections vary widely (${rangeStr}); no consistent takeaways` };
}

// --- Service Page Analysis ---

export function analyzeServicePage(data: PageData): ServiceAnalysis {
  const textLower = data.plain_text_content.toLowerCase();
  const htmlLower = data.content_html.toLowerCase();

  // CTA detection
  const ctaPatterns = ['get started', 'contact us', 'book a call', 'free quote', 'schedule', 'sign up', 'get a quote', 'request a demo', 'start free', 'try free'];
  const ctaExamples: string[] = [];
  for (const pattern of ctaPatterns) {
    if (textLower.includes(pattern)) ctaExamples.push(pattern);
  }
  // Also check link anchors
  for (const link of data.internal_links) {
    const anchorLower = link.anchor.toLowerCase();
    for (const pattern of ctaPatterns) {
      if (anchorLower.includes(pattern) && !ctaExamples.includes(pattern)) {
        ctaExamples.push(pattern);
      }
    }
  }

  const first500 = textLower.substring(0, 500);
  const ctaAboveFold = ctaPatterns.some(p => first500.includes(p));

  // Trust signals
  const trustPatterns = ['review', 'testimonial', 'rated', 'stars', 'certified', 'years of experience', 'clients served', 'guarantee', 'award'];
  const trustSignals = trustPatterns.filter(p => textLower.includes(p));

  // Local SEO signals
  const localSignals: string[] = [];
  if (/\(\d{3}\)\s?\d{3}[- ]?\d{4}|\d{3}[- ]\d{3}[- ]\d{4}/.test(data.plain_text_content)) localSignals.push('phone number');
  if (/\d+\s+\w+\s+(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive)/i.test(data.plain_text_content)) localSignals.push('physical address');
  if (/serving\s+\w+/i.test(textLower)) localSignals.push('location mention');

  // Schema markup
  const schemaTypes: string[] = [];
  const schemaRegex = /"@type"\s*:\s*"(\w+)"/g;
  let match;
  while ((match = schemaRegex.exec(htmlLower)) !== null) {
    const type = match[1];
    if (!schemaTypes.includes(type)) schemaTypes.push(type);
  }

  return {
    ctaCount: ctaExamples.length,
    ctaAboveFold,
    ctaExamples,
    trustSignals,
    localSeoSignals: localSignals,
    schemaTypes,
  };
}

// --- Summary Formatter ---

export function formatPageAnalysis(
  url: string,
  pageType: string,
  analysis: BlogAnalysis | ServiceAnalysis,
  pageQueries: any[]
): string {
  const shortUrl = url.replace(/https?:\/\/[^/]+/, '');
  let out = `\n---\n## PAGE ANALYSIS: ${shortUrl}\n`;
  out += `**Type**: ${pageType === 'blog' ? 'Blog/Content Page' : pageType === 'homepage' ? 'Homepage' : 'Service/Transactional Page'}\n`;

  if (pageType === 'blog') {
    const a = analysis as BlogAnalysis;
    out += `**Word Count**: ${a.wordCountAssessment}\n`;
    out += `**Heading Structure**: ${a.headingCounts.h1} H1, ${a.headingCounts.h2} H2s, ${a.headingCounts.h3} H3s${a.hasH1 ? '' : ' (MISSING H1!)'}\n`;
    out += `**External Links**: ${a.externalLinkCount}${a.externalLinkFlag ? ` (${a.externalLinkFlag})` : ''}\n`;
    out += `**Internal Links**: ${a.internalLinkCount}${a.internalLinkFlag ? ` (${a.internalLinkFlag})` : ''}\n`;
    out += `**Content Capsule**: ${a.capsuleScore} (${a.capsuleDetails})\n`;
    out += `**Meta**: Title ${a.metaTitle.length} chars (${a.metaTitle.assessment}), Description ${a.metaDescription.length} chars (${a.metaDescription.assessment})\n`;
  } else {
    const a = analysis as ServiceAnalysis;
    out += `**CTAs Found**: ${a.ctaCount}${a.ctaCount > 0 ? ` (${a.ctaExamples.join(', ')})` : ' (NONE: needs CTAs!)'}\n`;
    out += `**CTA Above Fold**: ${a.ctaAboveFold ? 'Yes' : 'No (add CTA in first visible section)'}\n`;
    out += `**Trust Signals**: ${a.trustSignals.length > 0 ? a.trustSignals.join(', ') : 'None detected (add reviews, testimonials, certifications)'}\n`;
    out += `**Local SEO**: ${a.localSeoSignals.length > 0 ? a.localSeoSignals.join(', ') : 'None detected'}\n`;
    out += `**Schema Markup**: ${a.schemaTypes.length > 0 ? a.schemaTypes.join(', ') : 'None (add LocalBusiness, Service, or FAQPage schema)'}\n`;
  }

  // GSC queries for this page
  if (pageQueries.length > 0) {
    out += `\n### Queries ranking for this page\n`;
    out += `| Query | Clicks | Impressions | CTR% | Position |\n`;
    out += `|-------|--------|-------------|------|----------|\n`;
    for (const q of pageQueries) {
      out += `| ${q.query} | ${q.clicks} | ${q.impressions} | ${q.ctr_pct}% | ${q.position} |\n`;
    }
  } else {
    out += `\n*No GSC ranking data found for this page.*\n`;
  }

  out += `---\n`;
  return out;
}

// --- Helper: Get top page URLs from GSC data ---

export async function getTopPageUrls(env: Env, propertyId: string): Promise<string[]> {
  const result = await env.DB.prepare(`
    SELECT DISTINCT page FROM gsc_search_data
    WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
    ORDER BY clicks DESC LIMIT 20
  `).bind(propertyId).all();
  return (result.results || []).map((r: any) => r.page as string);
}

// --- Helper: Get queries for a specific page ---

export async function getPageQueries(env: Env, propertyId: string, pageUrl: string): Promise<any[]> {
  const result = await env.DB.prepare(`
    SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as position, ROUND(AVG(ctr) * 100, 1) as ctr_pct
    FROM gsc_search_data
    WHERE property_id = ? AND page = ? AND query != '__daily_total__'
    GROUP BY query ORDER BY impressions DESC LIMIT 15
  `).bind(propertyId, pageUrl).all();
  return result.results || [];
}
