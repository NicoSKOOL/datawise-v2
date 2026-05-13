export type WebsitePageSource = 'sitemap' | 'homepage_link' | 'nav_link' | 'sonar_fallback';
export type SiteArchetype = 'service' | 'saas' | 'ecommerce' | 'marketplace/community' | 'publisher' | 'mixed';
export type WebsitePageType =
  | 'Home'
  | 'Service'
  | 'Location'
  | 'Service+Location'
  | 'Feature'
  | 'Product'
  | 'Product Category'
  | 'Pricing'
  | 'Tool'
  | 'Comparison'
  | 'Case Study'
  | 'Community'
  | 'Blog Post'
  | 'About'
  | 'Contact'
  | 'Legal'
  | 'Other';

export interface WebsitePageCandidate {
  url: string;
  title: string;
  page_type: WebsitePageType;
  description: string;
  link_worthy: 'yes' | 'sometimes' | 'no';
  source: WebsitePageSource;
  confidence: 'high' | 'medium' | 'low';
  slug?: string;
  meta_description?: string;
  h1?: string[];
  h2?: string[];
  canonical_url?: string;
  snippet?: string;
}

const LOW_VALUE_SEGMENTS = [
  'privacy',
  'terms',
  'cookie',
  'cart',
  'checkout',
  'account',
  'login',
  'wp-login',
  'tag',
  'author',
  'page',
  'feed',
  'thank-you',
  'thankyou',
  'search',
];

const ASSET_EXT_RE = /\.(?:jpg|jpeg|png|gif|webp|svg|pdf|zip|css|js|ico|xml)$/i;

export function normalizeWebsiteUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function parseSitemapUrls(xml: string, source: WebsitePageSource = 'sitemap'): WebsitePageCandidate[] {
  const pages: WebsitePageCandidate[] = [];
  const locRegex = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = locRegex.exec(xml)) !== null) {
    const url = decodeXml(match[1]).trim();
    const candidate = candidateFromUrl(url, source);
    if (candidate) pages.push(candidate);
  }
  return dedupeCandidates(pages);
}

export function extractSitemapIndexUrls(xml: string): string[] {
  const urls = new Set<string>();
  const sitemapRegex = /<sitemap>[\s\S]*?<loc>\s*([\s\S]*?)\s*<\/loc>[\s\S]*?<\/sitemap>/gi;
  let match: RegExpExecArray | null;
  while ((match = sitemapRegex.exec(xml)) !== null) {
    const url = decodeXml(match[1]).trim();
    if (url) urls.add(url);
  }
  return [...urls];
}

export function rankAndFilterPages(
  pages: WebsitePageCandidate[],
  websiteUrl: string,
  limit = 50,
  options: { siteArchetype?: SiteArchetype } = {},
): WebsitePageCandidate[] {
  const base = normalizeWebsiteUrl(websiteUrl);
  const host = safeHost(base);
  const siteArchetype = options.siteArchetype || inferSiteArchetype(pages);
  return dedupeCandidates(pages)
    .filter((page) => !isLowValueUrl(page.url))
    .filter((page) => !host || safeHost(page.url) === host)
    .map((page) => ({ ...page, ...classifyUrl(page.url) }))
    .sort((a, b) => scorePage(b, siteArchetype) - scorePage(a, siteArchetype) || a.url.length - b.url.length)
    .slice(0, limit);
}

export function selectBalancedWebsitePages(
  pages: WebsitePageCandidate[],
  websiteUrl: string,
  options: {
    siteArchetype?: SiteArchetype;
    reviewLimit?: number;
    blogLimit?: number;
    enrichLimit?: number;
  } = {},
): WebsitePageCandidate[] {
  const siteArchetype = options.siteArchetype || inferSiteArchetype(pages);
  const reviewLimit = options.reviewLimit ?? 40;
  const blogLimit = options.blogLimit ?? defaultBlogLimit(siteArchetype);
  const ranked = rankAndFilterPages(pages, websiteUrl, Math.max(reviewLimit * 2, 80), { siteArchetype });
  const blogPages = ranked.filter((page) => page.page_type === 'Blog Post').slice(0, blogLimit);
  const corePages = ranked.filter((page) => page.page_type !== 'Blog Post').slice(0, Math.max(reviewLimit - blogPages.length, 0));
  const balanced = rankAndFilterPages([...corePages, ...blogPages], websiteUrl, reviewLimit, { siteArchetype });

  return balanced;
}

export function inferSiteArchetype(pages: WebsitePageCandidate[]): SiteArchetype {
  const corpus = pages.map((page) => [
    page.url,
    page.title,
    page.description,
    page.meta_description,
    ...(page.h1 || []),
    ...(page.h2 || []),
  ].filter(Boolean).join(' ').toLowerCase()).join('\n');

  const scores = {
    service: scoreMatches(corpus, [
      /\/(?:services?|solutions?|what-we-do)\b/g,
      /\/(?:locations?|service-areas?|areas-we-serve)\b/g,
      /\b(?:service area|book a call|get a quote|request a quote|contractor|repair|installation|consultation)\b/g,
    ]),
    saas: scoreMatches(corpus, [
      /\/(?:features?|pricing|plans|free-tools|tools?|compare|integrations?)\b/g,
      /\b(?:software|platform|dashboard|workspace|api|automation|subscription|saas|feature|tool)\b/g,
    ]),
    ecommerce: scoreMatches(corpus, [
      /\/(?:shop|store|products?|collections?|categories?|category|cart|checkout)\b/g,
      /\b(?:add to cart|shipping|returns|product|collection|sku|checkout|shop)\b/g,
    ]),
    community: scoreMatches(corpus, [
      /\/(?:community|membership|members|courses?|cohort|academy)\b/g,
      /\b(?:community|membership|course|cohort|lesson|students|skool)\b/g,
    ]),
    publisher: scoreMatches(corpus, [
      /\/(?:blog|resources|guides|articles|news)\b/g,
      /\b(?:blog|article|newsletter|editorial|latest news|author)\b/g,
    ]),
  };

  const commercialScores = [
    ['saas', scores.saas] as const,
    ['ecommerce', scores.ecommerce] as const,
    ['service', scores.service] as const,
    ['marketplace/community', scores.community] as const,
  ].sort((a, b) => b[1] - a[1]);
  const [top, second] = commercialScores;

  if (top[1] >= 3 && top[1] >= second[1] + 2) return top[0];
  if (scores.saas >= 3 && scores.saas >= scores.ecommerce && scores.saas >= scores.service) return 'saas';
  if (scores.ecommerce >= 3 && scores.ecommerce >= scores.service) return 'ecommerce';
  if (scores.service >= 3) return 'service';
  if (scores.community >= 3) return 'marketplace/community';
  if (scores.publisher >= 5) return 'publisher';
  return 'mixed';
}

function defaultBlogLimit(siteArchetype: SiteArchetype): number {
  if (siteArchetype === 'publisher') return 18;
  if (siteArchetype === 'saas') return 10;
  if (siteArchetype === 'service') return 10;
  if (siteArchetype === 'ecommerce') return 8;
  return 10;
}

export function candidateFromUrl(url: string, source: WebsitePageSource): WebsitePageCandidate | null {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const cleanUrl = parsed.toString();
    const classified = classifyUrl(cleanUrl);
    const slug = parsed.pathname.replace(/\/$/, '') || '/';
    return {
      url: cleanUrl,
      title: titleFromPath(parsed.pathname),
      description: '',
      source,
      confidence: source === 'sitemap' ? 'high' : 'medium',
      slug,
      ...classified,
    };
  } catch {
    return null;
  }
}

export function extractPageEvidence(
  url: string,
  html: string,
  source: WebsitePageSource,
): WebsitePageCandidate {
  const fallback = candidateFromUrl(url, source);
  if (!fallback) throw new Error('invalid_url');

  const title = stripHtml(extractFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)) || fallback.title;
  const metaDescription = extractMetaDescription(html);
  const canonical = extractCanonical(html);
  const h1 = extractHeadings(html, 1).slice(0, 3);
  const h2 = extractHeadings(html, 2).slice(0, 8);
  const visible = stripHtml(
    extractFirst(html, /<main[^>]*>([\s\S]*?)<\/main>/i)
    || extractFirst(html, /<article[^>]*>([\s\S]*?)<\/article>/i)
    || extractFirst(html, /<body[^>]*>([\s\S]*?)<\/body>/i)
    || html,
  );
  const snippet = visible.slice(0, 280).trim();

  return {
    ...fallback,
    title,
    description: metaDescription || snippet,
    meta_description: metaDescription,
    h1,
    h2,
    canonical_url: canonical,
    snippet,
  };
}

export function extractInternalLinks(
  pageUrl: string,
  html: string,
  source: WebsitePageSource = 'homepage_link',
): WebsitePageCandidate[] {
  const host = safeHost(pageUrl);
  if (!host) return [];
  const base = new URL(pageUrl);
  const out: WebsitePageCandidate[] = [];
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href || href.startsWith('#') || /^mailto:|^tel:/i.test(href)) continue;
    try {
      const resolved = new URL(href, base).toString();
      if (safeHost(resolved) !== host) continue;
      const candidate = candidateFromUrl(resolved, source);
      if (!candidate) continue;
      const text = stripHtml(match[2]);
      if (text && candidate.title === titleFromPath(new URL(resolved).pathname)) candidate.title = text;
      out.push(candidate);
    } catch {
      // skip malformed links
    }
  }
  return dedupeCandidates(out);
}

export function formatWebsitePagesDocument(candidates: WebsitePageCandidate[]): string {
  const lines = [
    'WEBSITE PAGES',
    '',
    'Each entry lists the URL, page type, what the page covers, and whether future blog posts should link to it.',
    '',
  ];
  for (const page of candidates) {
    lines.push(`URL: ${page.url}`);
    lines.push(`Page type: ${page.page_type}`);
    lines.push(`Description: ${page.description || page.title || 'Important site page.'}`);
    lines.push(`Link-worthy from blog: ${page.link_worthy}`);
    lines.push(`Discovery source: ${page.source}; confidence: ${page.confidence}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function isLowValueUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    if (ASSET_EXT_RE.test(path)) return true;
    const segments = path.split('/').filter(Boolean);
    if (segments.some((segment) => LOW_VALUE_SEGMENTS.some((blocked) => segment === blocked || segment.startsWith(`${blocked}-`)))) return true;
    if (/\/(?:blog|resources|guides|articles|news)\/(?:categories?|category)\b/.test(path)) return true;
    if (/[?&](?:s|replytocom|add-to-cart)=/i.test(parsed.search)) return true;
    return false;
  } catch {
    return true;
  }
}

function classifyUrl(url: string): Pick<WebsitePageCandidate, 'page_type' | 'link_worthy'> {
  let pathname = '/';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return { page_type: 'Other', link_worthy: 'sometimes' };
  }
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/') return { page_type: 'Home', link_worthy: 'yes' };
  if (/\/(?:about|about-us|our-story|team)\b/.test(path)) return { page_type: 'About', link_worthy: 'yes' };
  if (/\/(?:contact|contact-us|get-a-quote|quote)\b/.test(path)) return { page_type: 'Contact', link_worthy: 'sometimes' };
  if (/\/(?:privacy|terms|cookies?)\b/.test(path)) return { page_type: 'Legal', link_worthy: 'no' };
  if (/\/(?:pricing|plans|packages|rates|fees)\b/.test(path)) return { page_type: 'Pricing', link_worthy: 'yes' };
  if (/\/(?:features?)\b/.test(path)) return { page_type: 'Feature', link_worthy: 'yes' };
  if (/\/(?:free-tools|tools?|calculators?)\b/.test(path)) return { page_type: 'Tool', link_worthy: 'yes' };
  if (/\/(?:compare|comparison|versus|alternatives?)\b/.test(path)) return { page_type: 'Comparison', link_worthy: 'yes' };
  if (/\/(?:case-studies|case-study|customers|results|testimonials|reviews)\b/.test(path)) return { page_type: 'Case Study', link_worthy: 'sometimes' };
  if (/\/(?:community|membership|members|academy|courses?)\b/.test(path)) return { page_type: 'Community', link_worthy: 'sometimes' };
  if (/\/(?:collections?|categories?|category|shop|store)\b/.test(path)) return { page_type: 'Product Category', link_worthy: 'yes' };
  if (/\/(?:products?|product)\b/.test(path)) {
    const segments = path.split('/').filter(Boolean);
    return { page_type: segments.length > 1 ? 'Product' : 'Product Category', link_worthy: 'yes' };
  }
  if (/\/(?:locations?|service-areas?|areas-we-serve)\//.test(path)) {
    if (/\/(?:services?|solutions?)\//.test(path)) return { page_type: 'Service+Location', link_worthy: 'yes' };
    return { page_type: 'Location', link_worthy: 'yes' };
  }
  if (/\/(?:services?|solutions?|what-we-do)\b/.test(path)) return { page_type: 'Service', link_worthy: 'yes' };
  if (/\/(?:blog|resources|guides|articles|news)\//.test(path)) return { page_type: 'Blog Post', link_worthy: 'sometimes' };
  return { page_type: 'Other', link_worthy: 'sometimes' };
}

function scorePage(page: WebsitePageCandidate, siteArchetype: SiteArchetype): number {
  const shared: Record<WebsitePageType, number> = {
    Home: 100,
    Service: 86,
    'Service+Location': 84,
    Location: 80,
    Feature: 86,
    Product: 84,
    'Product Category': 86,
    Pricing: 88,
    Tool: 84,
    Comparison: 78,
    'Case Study': 72,
    Community: 62,
    About: 66,
    Contact: 54,
    'Blog Post': 45,
    Other: 30,
    Legal: 0,
  };
  const byArchetype: Partial<Record<SiteArchetype, Partial<Record<WebsitePageType, number>>>> = {
    service: {
      Service: 96,
      'Service+Location': 92,
      Location: 88,
      Pricing: 84,
      About: 70,
      Contact: 58,
      Feature: 56,
      Tool: 54,
    },
    saas: {
      Feature: 96,
      Pricing: 94,
      Tool: 90,
      Comparison: 84,
      Product: 82,
      'Product Category': 80,
      'Case Study': 78,
      About: 68,
      Community: 64,
    },
    ecommerce: {
      'Product Category': 96,
      Product: 94,
      Pricing: 76,
      Tool: 66,
      Comparison: 62,
      About: 56,
      Contact: 54,
    },
    'marketplace/community': {
      Community: 94,
      Pricing: 86,
      Feature: 84,
      Tool: 78,
      About: 70,
      'Blog Post': 50,
    },
    publisher: {
      'Blog Post': 88,
      About: 60,
      Feature: 54,
      Tool: 52,
    },
  };
  return byArchetype[siteArchetype]?.[page.page_type] ?? shared[page.page_type] ?? 0;
}

function scoreMatches(text: string, patterns: RegExp[]): number {
  let score = 0;
  for (const pattern of patterns) {
    score += text.match(pattern)?.length || 0;
  }
  return score;
}

function dedupeCandidates(pages: WebsitePageCandidate[]): WebsitePageCandidate[] {
  const seen = new Set<string>();
  const out: WebsitePageCandidate[] = [];
  for (const page of pages) {
    const key = normalizeUrlKey(page.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(page);
  }
  return out;
}

function normalizeUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.search = '';
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.slice(0, -1);
    return parsed.toString();
  } catch {
    return '';
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function titleFromPath(pathname: string): string {
  const clean = pathname.replace(/\/+$/, '').split('/').filter(Boolean).pop() || 'Home';
  return clean
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function extractMetaDescription(html: string): string {
  return decodeHtmlAttribute(
    extractFirst(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || extractFirst(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i),
  );
}

function extractCanonical(html: string): string {
  return decodeHtmlAttribute(extractFirst(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["'][^>]*>/i));
}

function extractHeadings(html: string, level: number): string[] {
  const headings: string[] = [];
  const regex = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const text = stripHtml(match[1]);
    if (text) headings.push(text);
  }
  return headings;
}

function extractFirst(html: string, regex: RegExp): string {
  const match = html.match(regex);
  return match?.[1] || '';
}

function stripHtml(value: string): string {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlAttribute(value: string): string {
  return decodeXml(value).trim();
}

function decodeXml(value: string): string {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}
