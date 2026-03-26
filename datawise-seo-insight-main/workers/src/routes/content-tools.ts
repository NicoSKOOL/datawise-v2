import type { Env } from '../index';
import { getLLMProvider, type UserLLMConfig, type ChatMessage } from '../llm/provider';

// ---------------------------------------------------------------------------
// Prompts (ported from blog-revival-agent/rewriter.py)
// ---------------------------------------------------------------------------

const ANALYSIS_PROMPT = `You are an SEO content auditor. Analyze this blog post and return ONLY a valid JSON object with no extra text, no markdown fences.

Return exactly this structure:
{
  "thin_sections": ["list of H2 heading texts where the section content is under 150 words"],
  "outdated_claims": ["exact sentences or phrases that appear outdated, reference old stats, or use vague 'recently' language"],
  "missing_internal_links": ["topics or keywords mentioned in the post that match available site pages"],
  "missing_external_links": ["specific factual claims that need a citation - quote the claim"],
  "overall_word_count": {WORD_COUNT},
  "verdict": "thin"
}

Verdict must be one of: "thin" (under 800 words or sparse), "average" (800-1200 words), "good" (1200+ words with depth).

BLOG POST TITLE: {TITLE}
CURRENT WORD COUNT: {WORD_COUNT}

CURRENT POST CONTENT:
{BODY_TEXT}

AVAILABLE SITE PAGES (for internal link matching):
{SITE_PAGES}

Return only the JSON object.`;

const REWRITE_PROMPT = `You are an expert SEO content writer. Rewrite the blog post below following every rule in this brief exactly.

TONE & VOICE (critical, do this first):
- Read the original post carefully and identify the author's tone: casual or formal, technical or plain-English, use of "you" or third-person, sentence length, vocabulary level, use of humour or directness
- The rewrite MUST sound like the same person wrote it. Do not homogenise or make it generic
- If the original is conversational, keep it conversational. If it's technical, keep it technical
- Preserve any recurring phrases, stylistic quirks, or structural habits the author uses
- NEVER use em dashes anywhere in the post. Replace them with a colon, comma, parentheses, or split into two sentences instead

CAPSULE CONTENT STRUCTURE (apply to 60% of H2 sections):
- H2 heading must be phrased as a question
- Immediately after the H2, write a 30-60 word direct answer in **bold** - self-contained enough to be a Google featured snippet
- Follow with 2-3 supporting paragraphs (depth, examples, data)

CONTENT REQUIREMENTS:
- Update any outdated facts with accurate 2024-2025 information
- Minimum 1,200 words total
- Fix all issues listed in the audit below

EXTERNAL LINKS (important):
- Back up every factual claim with a real, working URL from a credible source
- Use well-known sources: government sites (.gov), major publications (e.g. Search Engine Journal, Moz, Ahrefs blog, Google Search Central, HubSpot, Semrush blog), Wikipedia for general facts, academic/research sources
- Format: [descriptive anchor text](https://real-url.com)
- Only use a placeholder like (SOURCE: domain.com) if you are genuinely uncertain of the exact URL, prefer real links

INTERNAL LINKS (important):
- Add at least 3-5 internal links using the site pages listed below
- Use the FULL URL provided for each page, do not shorten to a relative path
- Format: [contextual anchor text](https://full-url-from-sitemap)
- Anchor text must be natural and contextual, never "click here"

FAQ SECTION (required, append at the very end of the post):
- Add a ## Frequently Asked Questions section as the final section
- Include 3 to 5 questions that readers of this topic are likely to ask
- The questions MUST be different from any question already answered or addressed in the post body, look at the H2 headings and content and avoid duplicating those topics
- Format each as: ### Question text? followed by a concise 2-4 sentence answer
- Questions should be genuinely useful and reflect real search intent around the topic

OUTPUT FORMAT:
- Clean markdown only, start directly with the # title, no preamble or commentary
- Do not add any text before or after the post content

ORIGINAL TITLE: {TITLE}

AUDIT FINDINGS:
{AUDIT}

AVAILABLE SITE PAGES FOR INTERNAL LINKS (use these full URLs):
{SITE_PAGES}

ORIGINAL POST TO REWRITE:
{BODY_TEXT}`;

// ---------------------------------------------------------------------------
// Content selectors for HTML parsing
// ---------------------------------------------------------------------------

const CONTENT_SELECTORS = [
  'class="post-content"',
  'class="entry-content"',
  'class="et_pb_post_content"',
  'class="et_pb_text_inner"',
  'class="post-body"',
  'class="article-body"',
  'class="blog-post"',
  'class="single-post"',
  'id="content"',
  'class="content"',
];

// ---------------------------------------------------------------------------
// HTML parsing helpers (lightweight, no external deps in Workers)
// ---------------------------------------------------------------------------

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitle(html: string): string {
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return stripHtmlTags(h1Match[1]);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) return stripHtmlTags(titleMatch[1]);
  return '';
}

function extractHeadings(html: string): Array<{ level: string; text: string }> {
  const headings: Array<{ level: string; text: string }> = [];
  const regex = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    headings.push({ level: match[1].toLowerCase(), text: stripHtmlTags(match[2]) });
  }
  return headings;
}

function extractLinks(html: string, domain: string): { internal: Array<{ text: string; href: string }>; external: Array<{ text: string; href: string }> } {
  const internal: Array<{ text: string; href: string }> = [];
  const external: Array<{ text: string; href: string }> = [];
  const regex = /<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const text = stripHtmlTags(match[2]);
    if (!href || href.startsWith('#') || href.startsWith('mailto:')) continue;
    if (domain && href.includes(domain)) {
      internal.push({ text, href });
    } else if (href.startsWith('/')) {
      internal.push({ text, href });
    } else if (href.startsWith('http')) {
      external.push({ text, href });
    }
  }
  return { internal, external };
}

function extractContentArea(html: string): string {
  // Try known content selectors
  for (const selector of CONTENT_SELECTORS) {
    const attrMatch = selector.match(/^(class|id)="([^"]+)"$/);
    if (!attrMatch) continue;
    const [, attr, value] = attrMatch;
    // Match the opening tag with this attribute and extract inner content
    const pattern = new RegExp(
      `<([a-z]+)[^>]*${attr}="${value}"[^>]*>([\\s\\S]*?)(?=<\\/\\1>)`,
      'i'
    );
    const m = html.match(pattern);
    if (m) {
      const text = stripHtmlTags(m[2]);
      if (text.split(/\s+/).length >= 100) return m[2];
    }
  }

  // Fallback: try <article> or <main>
  for (const tag of ['article', 'main']) {
    const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = html.match(pattern);
    if (m) {
      const text = stripHtmlTags(m[1]);
      if (text.split(/\s+/).length >= 100) return m[1];
    }
  }

  // Last resort: use body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return bodyMatch ? bodyMatch[1] : html;
}

function isBlockedPage(html: string): boolean {
  const lower = html.substring(0, 5000).toLowerCase();
  const signals = ['just a moment', 'checking your browser', 'cf-challenge', 'challenge-platform', 'turnstile'];
  return signals.some(s => lower.includes(s));
}

// ---------------------------------------------------------------------------
// Sitemap XML parser (lightweight, no external deps)
// ---------------------------------------------------------------------------

function parseSitemapXml(xml: string): Array<{ url: string; slug: string; title: string }> {
  const pages: Array<{ url: string; slug: string; title: string }> = [];

  // Check if this is a sitemap index
  if (xml.includes('<sitemapindex') || xml.includes(':sitemapindex')) {
    return []; // Return empty, caller will handle index recursion
  }

  const locRegex = /<loc>([\s\S]*?)<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const pageUrl = match[1].trim();
    try {
      const urlObj = new URL(pageUrl);
      const path = urlObj.pathname.replace(/\/$/, '') || '/';
      const slug = path;
      const raw = path.split('/').pop()?.replace(/-/g, ' ').replace(/_/g, ' ').trim() || '';
      const title = raw ? raw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : slug;
      pages.push({ url: pageUrl, slug, title });
    } catch {
      // skip invalid URLs
    }
  }

  return pages;
}

function extractSitemapIndexUrls(xml: string): string[] {
  const urls: string[] = [];
  // Match <sitemap><loc>...</loc></sitemap> patterns
  const sitemapRegex = /<sitemap>[\s\S]*?<loc>([\s\S]*?)<\/loc>[\s\S]*?<\/sitemap>/gi;
  let match;
  while ((match = sitemapRegex.exec(xml)) !== null) {
    urls.push(match[1].trim());
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSitePages(sitePages: Array<{ url: string; slug: string; title: string }>, domain: string): string {
  if (!sitePages.length) return 'No sitemap pages available.';

  const base = domain.replace(/\/$/, '');
  const lines = sitePages.slice(0, 100).map(page => {
    let fullUrl = page.url || '';
    if (!fullUrl && page.slug && base) {
      fullUrl = base + (page.slug.startsWith('/') ? '' : '/') + page.slug;
    }
    return `- ${fullUrl || page.slug || '(no url)'} | ${page.title}`;
  });
  return lines.join('\n');
}

function stripCodeFences(text: string): string {
  text = text.trim();
  if (text.startsWith('```')) {
    text = text.includes('\n') ? text.split('\n').slice(1).join('\n') : text.slice(3);
    if (text.endsWith('```')) text = text.slice(0, -3);
  }
  return text.trim();
}

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

export async function handleFetchPost(request: Request): Promise<Response> {
  const body = await request.json() as { url: string };
  const url = body.url?.trim();
  if (!url) return json({ error: 'url is required' }, 400);

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname.replace(/\/$/, '');
    const slug = path.split('/').pop() || 'post';

    // Fetch the page
    const response = await fetch(url, { headers: FETCH_HEADERS });
    if (!response.ok) {
      return json({ error: `Failed to fetch: HTTP ${response.status}` }, 400);
    }

    const html = await response.text();

    if (html.length < 500) {
      return json({ error: 'Server returned a near-empty response (likely blocked)' }, 400);
    }

    if (isBlockedPage(html)) {
      // Try WordPress REST API fallback
      const wpResult = await tryWpApi(url, domain, slug);
      if (wpResult) return json(wpResult);
      return json({ error: 'Page is blocked by Cloudflare. Try pasting the post content manually.' }, 400);
    }

    const contentHtml = extractContentArea(html);
    const bodyText = stripHtmlTags(contentHtml).replace(/\s+/g, ' ').trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

    if (wordCount < 50) {
      // Try WP API fallback
      const wpResult = await tryWpApi(url, domain, slug);
      if (wpResult) return json(wpResult);
      return json({ error: `Page returned only ${wordCount} words. Likely blocked or requires JavaScript.` }, 400);
    }

    const title = extractTitle(html);
    const headings = extractHeadings(contentHtml);
    if (!headings.some(h => h.level === 'h1') && title) {
      headings.unshift({ level: 'h1', text: title });
    }
    const links = extractLinks(contentHtml, domain);

    return json({
      url,
      slug,
      title,
      headings,
      body_text: bodyText,
      internal_links: links.internal,
      external_links: links.external,
      word_count: wordCount,
      error: null,
    });
  } catch (err) {
    return json({ error: `Failed to fetch post: ${err instanceof Error ? err.message : 'Unknown error'}` }, 500);
  }
}

async function tryWpApi(url: string, domain: string, slug: string): Promise<Record<string, unknown> | null> {
  try {
    const urlObj = new URL(url);
    const base = `${urlObj.protocol}//${urlObj.hostname}`;
    const apiUrl = `${base}/wp-json/wp/v2/posts?slug=${slug}&_fields=title,content,link`;

    const resp = await fetch(apiUrl, {
      headers: { ...FETCH_HEADERS, 'Accept': 'application/json' },
    });
    if (!resp.ok) return null;

    const posts = await resp.json() as any[];
    if (!posts?.length) return null;

    const wpPost = posts[0];
    const titleHtml = wpPost.title?.rendered || '';
    const contentHtml = wpPost.content?.rendered || '';
    if (!contentHtml) return null;

    const title = stripHtmlTags(titleHtml);
    const bodyText = stripHtmlTags(contentHtml).replace(/\s+/g, ' ').trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

    if (wordCount < 50) return null;

    const headings = extractHeadings(contentHtml);
    if (!headings.some(h => h.level === 'h1') && title) {
      headings.unshift({ level: 'h1', text: title });
    }
    const links = extractLinks(contentHtml, domain);

    return {
      url,
      slug,
      title,
      headings,
      body_text: bodyText,
      internal_links: links.internal,
      external_links: links.external,
      word_count: wordCount,
      error: null,
    };
  } catch {
    return null;
  }
}

export async function handleDiscoverSitemap(request: Request): Promise<Response> {
  const body = await request.json() as { domain: string };
  let domain = body.domain?.trim();
  if (!domain) return json({ error: 'domain is required' }, 400);

  if (!domain.startsWith('http')) domain = 'https://' + domain;
  domain = domain.replace(/\/$/, '');

  const sitemapCandidates: string[] = [];

  // Check robots.txt first
  try {
    const robotsResp = await fetch(`${domain}/robots.txt`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataWiseBot/1.0)' },
    });
    if (robotsResp.ok) {
      const text = await robotsResp.text();
      for (const line of text.split('\n')) {
        if (line.toLowerCase().startsWith('sitemap:')) {
          const declared = line.split(':').slice(1).join(':').trim();
          if (declared) sitemapCandidates.push(declared);
        }
      }
    }
  } catch {
    // robots.txt fetch failed, continue with fallbacks
  }

  // Add common fallback locations
  sitemapCandidates.push(
    `${domain}/sitemap.xml`,
    `${domain}/sitemap_index.xml`,
    `${domain}/sitemap-index.xml`,
    `${domain}/wp-sitemap.xml`,
  );

  // Deduplicate
  const seen = new Set<string>();
  const uniqueCandidates = sitemapCandidates.filter(u => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  let pages: Array<{ url: string; slug: string; title: string }> = [];

  for (const sitemapUrl of uniqueCandidates) {
    try {
      const resp = await fetch(sitemapUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataWiseBot/1.0)' },
      });
      if (!resp.ok) continue;

      const xml = await resp.text();

      // Check if this is a sitemap index
      if (xml.includes('<sitemapindex') || xml.includes(':sitemapindex')) {
        const childUrls = extractSitemapIndexUrls(xml);
        for (const childUrl of childUrls.slice(0, 5)) {
          try {
            const childResp = await fetch(childUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DataWiseBot/1.0)' },
            });
            if (childResp.ok) {
              const childXml = await childResp.text();
              pages.push(...parseSitemapXml(childXml));
            }
          } catch {
            // skip child sitemap
          }
        }
      } else {
        pages = parseSitemapXml(xml);
      }

      if (pages.length > 0) break;
    } catch {
      continue;
    }
  }

  return json({ pages });
}

export async function handleAnalyzePost(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    post: { title: string; body_text: string; word_count: number };
    site_pages: Array<{ url: string; slug: string; title: string }>;
    domain: string;
    llm_config: UserLLMConfig;
  };

  if (!body.post?.body_text) return json({ error: 'post.body_text is required' }, 400);
  if (!body.llm_config?.api_key) return json({ error: 'llm_config.api_key is required' }, 400);

  const prompt = ANALYSIS_PROMPT
    .replace('{TITLE}', body.post.title || 'Untitled')
    .replace(/{WORD_COUNT}/g, String(body.post.word_count || 0))
    .replace('{BODY_TEXT}', (body.post.body_text || '').substring(0, 8000))
    .replace('{SITE_PAGES}', formatSitePages(body.site_pages || [], body.domain || ''));

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const provider = getLLMProvider(env, body.llm_config);

  try {
    const result = await provider.chatComplete(messages, env, body.llm_config, 1024);
    const raw = stripCodeFences(result.text);

    let audit;
    try {
      audit = JSON.parse(raw);
    } catch {
      audit = {
        thin_sections: [],
        outdated_claims: [],
        missing_internal_links: [],
        missing_external_links: [],
        overall_word_count: body.post.word_count || 0,
        verdict: 'average',
        _parse_error: raw.substring(0, 500),
      };
    }

    return json({ audit, usage: result.usage });
  } catch (err) {
    return json({ error: `LLM error: ${err instanceof Error ? err.message : 'Unknown error'}` }, 500);
  }
}

// ---------------------------------------------------------------------------
// Service Page Optimizer - HTML extraction helpers
// ---------------------------------------------------------------------------

function extractMetaDescription(html: string): string {
  const match = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return match ? match[1].trim() : '';
}

function extractMetaTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtmlTags(match[1]).trim() : '';
}

function extractCanonical(html: string): string {
  const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
    || html.match(/<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);
  return match ? match[1].trim() : '';
}

function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1].trim()));
    } catch {
      // skip malformed JSON-LD
    }
  }
  return results;
}

function extractImages(html: string): Array<{ src: string; alt: string }> {
  const images: Array<{ src: string; alt: string }> = [];
  const regex = /<img[^>]+>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const tag = match[0];
    const srcMatch = tag.match(/src=["']([^"']*)["']/i);
    const altMatch = tag.match(/alt=["']([^"']*)["']/i);
    if (srcMatch) {
      images.push({
        src: srcMatch[1],
        alt: altMatch ? altMatch[1].trim() : '',
      });
    }
  }
  return images;
}

// ---------------------------------------------------------------------------
// Service Page Optimizer - Prompt
// ---------------------------------------------------------------------------

const SERVICE_PAGE_ANALYSIS_PROMPT = `You are an expert SEO and GEO (Generative Engine Optimization) consultant specializing in local service businesses.
Analyze this service page and return ONLY a valid JSON object with no extra text, no markdown fences.

Return exactly this structure:
{
  "service_type": "the detected service type (e.g. landscaping, plumbing, HVAC, law, real estate)",
  "industry_category": "one of: home_services, legal, real_estate, health_wellness, contractors, professional_services, other",
  "location": "the detected location (e.g. Austin, TX)",
  "content_score": "thin",
  "content_score_pct": 35,
  "content_word_count": 320,
  "content_gaps": [
    { "issue": "description of the gap", "severity": "high" }
  ],
  "swap_test": {
    "score": 72,
    "generic_sections": [
      {
        "heading_or_location": "The heading or approximate location in the page where this generic content appears",
        "sample_text": "A short excerpt (20-30 words) of the generic content",
        "why_generic": "Explanation of why this section could be swapped to any other city without changes",
        "fix": "Specific suggestion to make it location-unique (e.g. reference local building types, climate, regulations, neighborhood names)"
      }
    ]
  },
  "missing_page_sections": [
    {
      "section_type": "how_we_work",
      "label": "How We Work / Process",
      "why_needed": "Brief explanation of why this section matters for this type of service page",
      "priority": "high"
    }
  ],
  "industry_specific_sections": [
    {
      "section_type": "seasonal_climate",
      "label": "Seasonal & Climate Considerations",
      "why_relevant": "Brief explanation of why this section is relevant for this specific service type and location",
      "priority": "high"
    }
  ],
  "image_audit": {
    "has_images": true,
    "total_count": 5,
    "missing_alt_count": 2,
    "needs_service_area_map": true,
    "suggestions": ["Add alt text to 2 images describing the service shown", "Add a service area map showing neighborhoods served"]
  },
  "heading_structure": {
    "has_h1": true,
    "h1_text": "the H1 text found on the page",
    "h1_includes_keyword": true,
    "h1_includes_location": false,
    "hierarchy_valid": false,
    "issues": ["H2 sections jump to H4 without H3"],
    "suggested_headings": [
      { "current": "Our Services", "suggested": "Landscaping Services in Austin, TX", "reason": "Add service type and location for local SEO" }
    ]
  },
  "cta_audit": {
    "ctas_found": ["Get a Free Quote", "Call Now"],
    "score": "weak",
    "suggestions": ["Add a CTA above the fold with a specific value proposition"]
  },
  "trust_signals": {
    "found": ["Phone number visible", "Years in business mentioned"],
    "missing": ["No customer reviews or testimonials", "No license or certification numbers"],
    "score": "weak"
  },
  "tone_analysis": "Brief description of the page's writing tone and voice",
  "local_content_section": {
    "title": "A compelling H2 title for a new locally-relevant section",
    "content": "A full 150-300 word section written in the EXACT same tone and voice as the original page, incorporating local knowledge.",
    "placement": "Where to add this section"
  },
  "schema_existing": ["LocalBusiness"],
  "schema_missing": ["Service", "FAQPage"],
  "schema_generated": {},
  "faq": [
    { "question": "question tailored to service and location", "answer": "concise 2-3 sentence answer" }
  ],
  "meta_title_current": "",
  "meta_title_suggested": "",
  "meta_description_current": "",
  "meta_description_suggested": "",
  "additional_recommendations": ["recommendation"]
}

Rules:
- content_score must be one of: "thin" (under 500 words or sparse), "adequate" (500-1000 words with decent depth), "comprehensive" (1000+ words with strong depth)
- content_score_pct is a number from 0-100 representing overall page quality
- Generate exactly 5 FAQ items
- The local_content_section MUST be written in the same tone as the original page
- schema_generated should be a complete, valid JSON-LD object following schema.org best practices
- NEVER use em dashes in any generated content. Use colons, commas, parentheses, or separate sentences instead
- All generated content must be specific to the detected service type and location
- cta_audit.score must be one of: "none", "weak", "strong"
- trust_signals.score must be one of: "none", "weak", "strong"
- heading_structure: check H1 for keyword and location, validate H1>H2>H3 hierarchy

SWAP TEST rules:
- swap_test.score is 0-100 where 100 means the content is completely generic (could be used for any city) and 0 means it is deeply location-specific
- For each section of the page that fails the swap test (you could replace the city name and the content still works), add an entry to generic_sections
- Explain WHY each section is generic and HOW to fix it with specific local details

MISSING PAGE SECTIONS rules (check if the page is missing any of these):
- "service_description": A detailed service description with local context (not just a list)
- "how_we_work": A step-by-step process section explaining how the service works
- "why_choose_us": A differentiators section with specific proof points
- "testimonials": Customer testimonials with names and specific details
- "case_study": A case study or project example with specific results
- "team_bio": Team member bios with names, credentials, local connection
- Only include sections that are genuinely MISSING, not sections that exist but are weak
- priority must be one of: "high", "medium", "low"

INDUSTRY-SPECIFIC SECTIONS rules:
- Based on the detected industry_category, suggest relevant optional sections:
  - home_services / contractors: "permits_codes" (local permit requirements), "seasonal_climate" (how local climate affects the service)
  - legal: "legal_process" (local court/legal process for this practice area)
  - real_estate: "property_market" (local property market data), "buyer_programs" (first-time buyer assistance programs)
  - health_wellness: "seasonal_climate" (seasonal health considerations)
  - All industries: "seasonal_climate" if the service is affected by weather/seasons
- Only suggest sections that are NOT already on the page
- priority must be "high" or "medium"

IMAGE AUDIT rules:
- Use the IMAGES data provided to check alt text
- needs_service_area_map: true if the service covers a geographic area and no map is visible
- If there are zero images, flag this as a high priority issue

PAGE URL: {URL}
META TITLE: {META_TITLE}
META DESCRIPTION: {META_DESCRIPTION}
EXISTING SCHEMA (JSON-LD): {SCHEMA_JSON_LD}
WORD COUNT: {WORD_COUNT}
HEADINGS: {HEADINGS}
IMAGES: {IMAGES}

PAGE CONTENT:
{BODY_TEXT}

Return only the JSON object.`;

// ---------------------------------------------------------------------------
// Service Page Optimizer - Handlers
// ---------------------------------------------------------------------------

export async function handleFetchServicePage(request: Request): Promise<Response> {
  const body = await request.json() as { url: string };
  const url = body.url?.trim();
  if (!url) return json({ error: 'url is required' }, 400);

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname.replace(/\/$/, '');
    const slug = path.split('/').pop() || 'page';

    const response = await fetch(url, { headers: FETCH_HEADERS });
    if (!response.ok) {
      return json({ error: `Failed to fetch: HTTP ${response.status}` }, 400);
    }

    const html = await response.text();

    if (html.length < 500) {
      return json({ error: 'Server returned a near-empty response (likely blocked)' }, 400);
    }

    if (isBlockedPage(html)) {
      return json({ error: 'Page is blocked by Cloudflare or bot protection. Try a different URL.' }, 400);
    }

    const contentHtml = extractContentArea(html);
    const bodyText = stripHtmlTags(contentHtml).replace(/\s+/g, ' ').trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

    if (wordCount < 30) {
      return json({ error: `Page returned only ${wordCount} words. Likely blocked or requires JavaScript.` }, 400);
    }

    const title = extractTitle(html);
    const metaTitle = extractMetaTitle(html);
    const metaDescription = extractMetaDescription(html);
    const canonical = extractCanonical(html);
    const headings = extractHeadings(contentHtml);
    // H1 is often in a hero/header section outside the content area; ensure it's in headings
    if (!headings.some(h => h.level === 'h1') && title) {
      headings.unshift({ level: 'h1', text: title });
    }
    const links = extractLinks(contentHtml, domain);
    const schemaJsonLd = extractJsonLd(html);

    return json({
      url,
      slug,
      title,
      meta_title: metaTitle,
      meta_description: metaDescription,
      canonical,
      headings,
      body_text: bodyText,
      internal_links: links.internal,
      external_links: links.external,
      word_count: wordCount,
      schema_json_ld: schemaJsonLd,
      images: extractImages(contentHtml),
      error: null,
    });
  } catch (err) {
    return json({ error: `Failed to fetch page: ${err instanceof Error ? err.message : 'Unknown error'}` }, 500);
  }
}

export async function handleAnalyzeServicePage(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    page: {
      url: string;
      title: string;
      meta_title: string;
      meta_description: string;
      body_text: string;
      word_count: number;
      headings: Array<{ level: string; text: string }>;
      schema_json_ld: unknown[];
      images: Array<{src: string; alt: string}>;
    };
    llm_config: UserLLMConfig;
  };

  if (!body.page?.body_text) return json({ error: 'page.body_text is required' }, 400);
  if (!body.llm_config?.api_key) return json({ error: 'llm_config.api_key is required' }, 400);

  const headingsStr = (body.page.headings || [])
    .map(h => `${h.level}: ${h.text}`)
    .join('\n');

  const schemaStr = body.page.schema_json_ld?.length
    ? JSON.stringify(body.page.schema_json_ld, null, 2)
    : 'None found';

  const prompt = SERVICE_PAGE_ANALYSIS_PROMPT
    .replace('{URL}', body.page.url || '')
    .replace('{META_TITLE}', body.page.meta_title || '(none)')
    .replace('{META_DESCRIPTION}', body.page.meta_description || '(none)')
    .replace('{SCHEMA_JSON_LD}', schemaStr)
    .replace('{WORD_COUNT}', String(body.page.word_count || 0))
    .replace('{HEADINGS}', headingsStr || '(none)')
    .replace('{IMAGES}', (body.page.images || []).map((img: {src: string; alt: string}) => `src="${img.src}" alt="${img.alt || '(none)'}"`).join('\n') || '(none)')
    .replace('{BODY_TEXT}', (body.page.body_text || '').substring(0, 8000));

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const provider = getLLMProvider(env, body.llm_config);

  try {
    const result = await provider.chatComplete(messages, env, body.llm_config, 8192);
    const raw = stripCodeFences(result.text);

    // Try to salvage truncated JSON by closing open braces/brackets
    let jsonText = raw;
    if (!jsonText.endsWith('}')) {
      // Count open vs close braces and brackets
      let braces = 0, brackets = 0;
      for (const ch of jsonText) {
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
        else if (ch === '[') brackets++;
        else if (ch === ']') brackets--;
      }
      // Close any open brackets then braces
      while (brackets > 0) { jsonText += ']'; brackets--; }
      while (braces > 0) { jsonText += '}'; braces--; }
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonText);
    } catch {
      // Try to extract partial JSON by finding the last complete key-value
      try {
        // Remove trailing incomplete value and close the object
        const lastComma = raw.lastIndexOf(',');
        if (lastComma > 0) {
          let truncated = raw.substring(0, lastComma);
          let b = 0, br = 0;
          for (const ch of truncated) {
            if (ch === '{') b++; if (ch === '}') b--;
            if (ch === '[') br++; if (ch === ']') br--;
          }
          while (br > 0) { truncated += ']'; br--; }
          while (b > 0) { truncated += '}'; b--; }
          analysis = JSON.parse(truncated);
          analysis._truncated = true;
        }
      } catch {
        // Complete fallback
      }
      if (!analysis) {
        analysis = {
          _parse_error: raw.substring(0, 500),
          service_type: 'unknown',
          location: 'unknown',
          industry_category: 'other',
          content_score: 'thin',
          content_score_pct: 0,
          content_word_count: body.page.word_count || 0,
          content_gaps: [],
          swap_test: { score: 0, generic_sections: [] },
          missing_page_sections: [],
          industry_specific_sections: [],
          image_audit: { has_images: false, total_count: 0, missing_alt_count: 0, needs_service_area_map: false, suggestions: [] },
          heading_structure: { has_h1: false, h1_text: '', h1_includes_keyword: false, h1_includes_location: false, hierarchy_valid: false, issues: [], suggested_headings: [] },
          cta_audit: { ctas_found: [], score: 'none', suggestions: [] },
          trust_signals: { found: [], missing: [], score: 'none' },
          tone_analysis: '',
          local_content_section: { title: '', content: '', placement: '' },
          schema_existing: [],
          schema_missing: [],
          schema_generated: {},
          faq: [],
          meta_title_current: body.page.meta_title || '',
          meta_title_suggested: '',
          meta_description_current: body.page.meta_description || '',
          meta_description_suggested: '',
          additional_recommendations: [],
        };
      }
    }

    return json({ analysis, usage: result.usage });
  } catch (err) {
    return json({ error: `LLM error: ${err instanceof Error ? err.message : 'Unknown error'}` }, 500);
  }
}

const SECTION_GENERATION_PROMPTS: Record<string, string> = {
  permits_codes: `You are an expert SEO content writer for local service businesses.
Write a "Local Permits & Building Codes" section for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- Maximum 120 words
- Reference the specific city/county jurisdiction
- Include specific permit fees, timelines, or requirements if you can determine them
- Include a "Source:" line with a hyperlink to the official city/county building department website
- Mention how the business helps with permits
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead

Format as markdown with a bold heading. Include "Source: [Department Name](URL)" at the end.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  seasonal_climate: `You are an expert SEO content writer for local service businesses.
Write a "Seasonal & Climate Considerations" section for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- Maximum 120 words
- Reference specific local climate conditions (temperatures, rainfall, humidity, seasons)
- Include at least one specific weather statistic for this area
- Explain how the local climate affects this specific service
- Include timing recommendations (which months to schedule service)
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead

Format as markdown with a bold heading.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  how_we_work: `You are an expert SEO content writer for local service businesses.
Write a "How We Work" process section for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- 150-200 words
- 4-6 numbered steps
- Each step should include: who does it, what happens, timeline
- Include local context (response times to specific areas, local building types)
- Include specific numbers (response time, price range, warranty period)
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead

Format as markdown with a bold heading and numbered steps.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  why_choose_us: `You are an expert SEO content writer for local service businesses.
Write a "Why Choose Us" section for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- 150-250 words
- 4-6 differentiators, each with a bold sub-heading
- Each differentiator must have: a specific claim, proof/number, local context, customer benefit
- Include verifiable details: license numbers, insurance, years in area, review counts
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead
- Mark any facts that need to be verified by the business owner with [VERIFY]

Format as markdown with bold heading and bold sub-headings per differentiator.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  service_description: `You are an expert SEO content writer for local service businesses.
Write a "Service Description" section for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- 150-200 words, 2-3 paragraphs
- Must reference at least 3 local elements: building types, local conditions/challenges, local regulations, local infrastructure, landmarks/geography
- Paragraph 1: Local problem statement (40-60 words)
- Paragraph 2: Service approach with local context (60-80 words)
- Paragraph 3: Local credibility and CTA (40-60 words)
- Apply the "swap test": if you can replace the location name and it still works, add more local specifics
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead

Format as markdown with a bold heading.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  legal_process: `You are an expert SEO content writer for legal services.
Write a "Local Court & Legal Process" section for a {SERVICE_TYPE} practice in {LOCATION}.

Requirements:
- Maximum 150 words
- Reference the specific county/court by name
- Include typical case timelines for this jurisdiction
- Include at least one practical detail (courthouse location, parking, what to bring)
- Include a "Source:" line with a hyperlink to the official court website
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead
- Do NOT guarantee specific outcomes

Format as markdown with a bold heading. Include "Source: [Court Name](URL)" at the end.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  property_market: `You are an expert SEO content writer for real estate and mortgage businesses.
Write a "Local Property Market Snapshot" section for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- Maximum 100 words
- Include 3-5 specific data points: median price, price change over time, growth rate, days on market
- Data must be specific to the suburb/neighborhood level, not city-wide
- Include a "Sources:" line with hyperlinks to authoritative sources (Zillow, Redfin, CoreLogic, government data)
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead
- If you cannot verify specific numbers, mark them with [VERIFY]

Format as markdown with a bold heading. Include "Sources: [Name](URL)" at the end.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  buyer_programs: `You are an expert SEO content writer for mortgage and real estate businesses.
Write a "First-Time Buyer Programs" section for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- Maximum 130 words
- Name specific state/local programs by name
- Include eligibility criteria or income limits
- Include specific dollar amounts or percentages for assistance
- Explain how the business helps clients access these programs
- Include a "Source:" line with hyperlink to the state Housing Finance Agency
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead
- Note that program details change annually and should be verified

Format as markdown with a bold heading. Include "Source: [Agency Name](URL)" at the end.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  testimonials: `You are an expert SEO content writer for local service businesses.
Write a sample testimonial template for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- 75-100 words
- Include placeholders for: [Customer Full Name], [Street/Neighborhood], specific problem with local context
- The testimonial should reference local building types, conditions, or landmarks
- Include the service provider's name as [Technician/Team Member Name]
- Include specific results (time saved, cost, outcome)
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead
- Add a note: "Replace bracketed items with real customer details. Only use with customer permission."

Format as a quoted testimonial with attribution.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  case_study: `You are an expert SEO content writer for local service businesses.
Write a case study template for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- 200-300 words
- Structure: Challenge > Solution > Results
- Include placeholders for verifiable details: [Customer Name], [Address/Neighborhood], [Date], [Cost]
- Reference local building types, conditions, or challenges specific to this area
- Include specific measurable outcomes with placeholders
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead
- Add a note: "Replace bracketed items with real project details."

Format as markdown with Challenge, Our Approach, and Results sub-headings.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,

  team_bio: `You are an expert SEO content writer for local service businesses.
Write a team bio template for a {SERVICE_TYPE} business in {LOCATION}.

Requirements:
- 100-150 words
- Include placeholders: [Full Name], [Title], [License #], [Years], [Neighborhoods Served]
- Include a local connection (where they live, community ties)
- Include a personal humanizing detail placeholder
- Provide both third-person and first-person quote versions
- NEVER use em dashes. Use colons, commas, parentheses, or separate sentences instead
- Add a note: "Replace bracketed items with real team member details."

Format as markdown with both versions labeled.
Write in this tone: {TONE}

Return ONLY the section content, no preamble.`,
};

export async function handleGenerateSection(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    section_type: string;
    service_type: string;
    location: string;
    tone: string;
    page_url: string;
    llm_config: UserLLMConfig;
  };

  if (!body.section_type) return json({ error: 'section_type is required' }, 400);
  if (!body.llm_config?.api_key) return json({ error: 'llm_config.api_key is required' }, 400);

  const promptTemplate = SECTION_GENERATION_PROMPTS[body.section_type];
  if (!promptTemplate) return json({ error: `Unknown section type: ${body.section_type}` }, 400);

  const prompt = promptTemplate
    .replace(/{SERVICE_TYPE}/g, body.service_type || 'service')
    .replace(/{LOCATION}/g, body.location || 'this area')
    .replace(/{TONE}/g, body.tone || 'professional and helpful');

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const provider = getLLMProvider(env, body.llm_config);

  try {
    const result = await provider.chatComplete(messages, env, body.llm_config, 2048);
    return json({ content: result.text.trim(), usage: result.usage });
  } catch (err) {
    return json({ error: `LLM error: ${err instanceof Error ? err.message : 'Unknown error'}` }, 500);
  }
}

export async function handleRewritePost(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    post: { title: string; body_text: string };
    audit: Record<string, unknown>;
    site_pages: Array<{ url: string; slug: string; title: string }>;
    domain: string;
    llm_config: UserLLMConfig;
  };

  if (!body.post?.body_text) return json({ error: 'post.body_text is required' }, 400);
  if (!body.llm_config?.api_key) return json({ error: 'llm_config.api_key is required' }, 400);

  const prompt = REWRITE_PROMPT
    .replace('{TITLE}', body.post.title || 'Untitled')
    .replace('{AUDIT}', JSON.stringify(body.audit || {}, null, 2))
    .replace('{SITE_PAGES}', formatSitePages(body.site_pages || [], body.domain || ''))
    .replace('{BODY_TEXT}', (body.post.body_text || '').substring(0, 8000));

  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  const provider = getLLMProvider(env, body.llm_config);

  try {
    const result = await provider.chatComplete(messages, env, body.llm_config, 4096);
    return json({ rewritten: result.text.trim(), usage: result.usage });
  } catch (err) {
    return json({ error: `LLM error: ${err instanceof Error ? err.message : 'Unknown error'}` }, 500);
  }
}
