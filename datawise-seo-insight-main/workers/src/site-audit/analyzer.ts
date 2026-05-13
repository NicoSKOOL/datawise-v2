// Lighthouse-first analyzer. Converts a DataForSEO /on_page/lighthouse response
// (optionally enriched with /on_page/instant_pages meta data) into categorized
// findings + action items + aggregate scores. Pure, no I/O.

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category =
  | 'performance'
  | 'seo'
  | 'accessibility'
  | 'best_practices'
  | 'meta'
  | 'images'
  | 'content'
  | 'technical';

export interface FindingItem {
  url: string;
  size_bytes: number;
}

export interface ActionSubtask {
  id: string;
  text: string;
  url?: string;
  done: boolean;
}

export interface Finding {
  code: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  how_to_fix: string;
  score: number | null;        // Lighthouse 0-1 score, null if N/A
  display_value: string | null; // Lighthouse human-readable measurement
  impact: 'quick_win' | 'high_impact' | 'normal' | 'advanced';
  items?: FindingItem[];
}

export interface ActionItem {
  code: string;
  category: Category;
  priority: 'high' | 'medium' | 'low';
  title: string;
  how_to_fix: string;
  finding_index: number;
  impact: 'quick_win' | 'high_impact' | 'normal' | 'advanced';
  subtasks?: ActionSubtask[];
}

export interface AnalyzeResult {
  findings: Finding[];
  action_items: ActionItem[];
  score: number;
  perf_score: number | null;
  seo_score: number | null;
  a11y_score: number | null;
  best_practices_score: number | null;
  meta: {
    title: string | null;
    description: string | null;
    h1: string[];
    has_schema: boolean;
  };
}

// ---------- Lighthouse types (only what we use) ----------
interface LhCategory {
  id?: string;
  title?: string;
  score?: number | null;
}

interface LhAudit {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  details?: {
    overallSavingsBytes?: number;
    overallSavingsMs?: number;
    items?: unknown[];
  };
}

export interface LighthouseResult {
  finalUrl?: string;
  requestedUrl?: string;
  categories?: Record<string, LhCategory>;
  audits?: Record<string, LhAudit>;
  fetchTime?: string;
}

export type DataSource = 'meta_tag' | 'google_snippet' | 'h1_fallback' | null;

export interface InstantPageMeta {
  title?: string;
  description?: string;
  h1?: string[];
  h2?: string[];
  h3?: string[];
  images?: { src: string; alt?: string; width?: number; height?: number }[];
  has_schema?: boolean;
  content?: string;
  // Enrichment — populated by content_parsing + SERP site: fallbacks
  title_source?: DataSource;
  description_source?: DataSource;
  business_content?: string;
  navigation_items?: { text: string; url: string }[];
  main_topic_sections?: { h_title: string; main_title?: string; content?: string }[];
  faq_questions?: string[];
  schema_types?: string[];
}

// ---------- Curated audit-ID → (category, severity, impact, how_to_fix) map ----------
// Only audits the tutorial actually cares about. Lighthouse has 150+ audits;
// surfacing every single one would overwhelm a Day 1 student. Anything not in
// this table gets bucketed with a generic description so we never miss real
// failures — but the curated ones get rich, actionable fix instructions.
interface AuditRule {
  category: Category;
  severity: Severity; // baseline — can be elevated if the lighthouse score is very bad
  impact: 'quick_win' | 'high_impact' | 'normal';
  how_to_fix: string;
  title_override?: string;
}

// "advanced" = too technical for the beginner dashboard. Still surfaced in
// the full Lighthouse findings section, just filtered out of primary UI.
const ADVANCED_AUDITS = new Set([
  'unused-css-rules',
  'total-byte-weight',
  'bf-cache',
  'third-party-cookies',
  'inspector-issues',
  'uses-passive-event-listeners',
  'dom-size',
  'legacy-javascript',
  'duplicated-javascript',
  'third-party-summary',
  'uses-long-cache-ttl',
  'uses-text-compression',
  'no-document-write',
  'redirects-http',
  'uses-http2',
]);

const AUDIT_RULES: Record<string, AuditRule> = {
  // --- SEO ---
  'document-title': {
    category: 'meta',
    severity: 'critical',
    impact: 'quick_win',
    how_to_fix:
      'Add a <title> tag to your <head>. Write 50–60 characters, lead with your primary keyword, end with your brand. Example: "Dog Training Melbourne | Force-Free Methods | Ethical Dog Training".',
  },
  'meta-description': {
    category: 'meta',
    severity: 'critical',
    impact: 'quick_win',
    how_to_fix:
      'Add <meta name="description" content="..."> with 150–160 characters. Say what you offer, where, and drop a soft CTA ("Book a free call"). This controls the snippet Google shows under your title.',
  },
  'link-text': {
    category: 'seo',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Replace generic link text ("click here", "learn more", "read more") with descriptive text that says what the destination is. "See our puppy training packages" is better than "learn more".',
  },
  'crawlable-anchors': {
    category: 'seo',
    severity: 'high',
    impact: 'normal',
    how_to_fix:
      'Some of your links use onClick handlers or JavaScript instead of real href attributes. Search engines can\'t crawl them. Rewrite as real <a href="..."> links.',
  },
  'hreflang': {
    category: 'seo',
    severity: 'low',
    impact: 'normal',
    how_to_fix: 'If you target multiple languages or regions, add hreflang tags to each version of the page.',
  },
  'canonical': {
    category: 'seo',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix:
      'Add <link rel="canonical" href="https://yourdomain.com/this-page"> in the <head>. Points Google to the authoritative version of the page and prevents duplicate-content splits.',
  },
  'http-status-code': {
    category: 'technical',
    severity: 'critical',
    impact: 'high_impact',
    how_to_fix: 'Page returned a non-200 status. Fix the server error or redirect the URL to its correct destination.',
  },
  'is-crawlable': {
    category: 'seo',
    severity: 'critical',
    impact: 'high_impact',
    how_to_fix:
      'Your page is blocked from indexing (via robots.txt, a meta robots tag, or an X-Robots-Tag HTTP header). If you want it to rank, remove the noindex/disallow directive. This is usually the single most important SEO fix.',
  },
  'robots-txt': {
    category: 'seo',
    severity: 'high',
    impact: 'normal',
    how_to_fix:
      'Your /robots.txt has syntax errors. Validate it at search.google.com/search-console/robots.txt. At minimum it should have: `User-agent: *` and a `Sitemap:` line pointing to your sitemap.xml.',
  },
  'structured-data': {
    category: 'seo',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'Add JSON-LD schema. Start with LocalBusiness (name, address, phone, hours, geo) and Service for each service page. Validate at search.google.com/test/rich-results.',
  },
  'font-size': {
    category: 'seo',
    severity: 'medium',
    impact: 'normal',
    how_to_fix: 'Base font size should be at least 16px for legibility on mobile. Bump up the body size in your CSS.',
  },
  'viewport': {
    category: 'seo',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Add <meta name="viewport" content="width=device-width, initial-scale=1"> in <head>. Without it, mobile users see a desktop-scaled page.',
  },
  'tap-targets': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'normal',
    how_to_fix: 'Make tappable elements (buttons, links) at least 48×48px with 8px spacing so users can tap them accurately on mobile.',
  },

  // --- Performance ---
  'server-response-time': {
    category: 'performance',
    severity: 'high',
    impact: 'high_impact',
    how_to_fix:
      'Server response time (TTFB) is slow. Enable caching, upgrade hosting, use a CDN, or move to a faster DNS provider. Target < 600ms.',
  },
  'largest-contentful-paint': {
    category: 'performance',
    severity: 'critical',
    impact: 'high_impact',
    how_to_fix:
      'Your hero image/headline takes too long to show. Preload the LCP image with <link rel="preload" as="image">, add fetchpriority="high" to it, switch to WebP, and remove render-blocking CSS above the fold.',
  },
  'first-contentful-paint': {
    category: 'performance',
    severity: 'high',
    impact: 'high_impact',
    how_to_fix: 'Reduce render-blocking resources, inline critical CSS, defer non-critical JS. Target < 1.8s.',
  },
  'total-blocking-time': {
    category: 'performance',
    severity: 'high',
    impact: 'high_impact',
    how_to_fix: 'Too much JavaScript is blocking the main thread. Defer/async your scripts, remove unused libraries, split heavy bundles.',
  },
  'cumulative-layout-shift': {
    category: 'performance',
    severity: 'high',
    impact: 'normal',
    how_to_fix:
      'Content is jumping as the page loads. Add explicit width/height to images and embeds, reserve space for ads, and avoid injecting content above existing content.',
  },
  'speed-index': {
    category: 'performance',
    severity: 'medium',
    impact: 'high_impact',
    how_to_fix: 'Improve perceived load speed: optimize critical rendering path, lazy-load below-the-fold images.',
  },
  'interactive': {
    category: 'performance',
    severity: 'high',
    impact: 'high_impact',
    how_to_fix: 'Time-to-interactive is high. Reduce JavaScript execution time and defer non-essential scripts.',
  },
  'render-blocking-resources': {
    category: 'performance',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Stylesheets and scripts block first paint. Add `defer` or `async` to non-critical <script> tags. Inline critical CSS and defer the rest.',
  },
  'uses-optimized-images': {
    category: 'images',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Compress your images. Run them through Squoosh.app, TinyPNG, or cwebp. Target < 100 KB for hero images, < 40 KB for thumbnails.',
  },
  'uses-webp-images': {
    category: 'images',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Convert images to WebP (smaller than JPG/PNG with same quality). Use `<picture><source srcset="x.webp" type="image/webp"><img src="x.jpg"></picture>` for fallback.',
  },
  'modern-image-formats': {
    category: 'images',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Use WebP or AVIF instead of JPG/PNG. Most CDNs (Cloudinary, Cloudflare Images, ImageKit) can do this automatically.',
  },
  'uses-responsive-images': {
    category: 'images',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'Serve different image sizes per device via `srcset` and `sizes` so mobile users don\'t download desktop-sized images.',
  },
  'offscreen-images': {
    category: 'images',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix:
      'Add `loading="lazy"` to images below the fold so they only load when the user scrolls to them.',
  },
  'efficient-animated-content': {
    category: 'images',
    severity: 'medium',
    impact: 'normal',
    how_to_fix: 'Replace GIFs with MP4 or WebM — an order of magnitude smaller.',
  },
  'unused-css-rules': {
    category: 'performance',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'Your CSS ships rules that aren\'t used on this page. If you\'re on WordPress, use a plugin like Asset CleanUp. Otherwise tree-shake unused selectors with PurgeCSS.',
  },
  'unused-javascript': {
    category: 'performance',
    severity: 'high',
    impact: 'normal',
    how_to_fix:
      'Significant chunks of JS are never executed. Remove unused libraries, split bundles with dynamic imports, or disable unused WordPress plugins.',
  },
  'duplicated-javascript': {
    category: 'performance',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix: 'The same JavaScript is loaded twice. Check your tag manager and theme for double-loaded libraries.',
  },
  'legacy-javascript': {
    category: 'performance',
    severity: 'medium',
    impact: 'normal',
    how_to_fix: 'You\'re shipping polyfills for browsers no one uses. Update your build target to modern ES2020+.',
  },
  'uses-text-compression': {
    category: 'performance',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Enable gzip or Brotli compression on your server. On Cloudflare/Netlify/Vercel it\'s on by default; on cPanel hosts enable mod_deflate.',
  },
  'uses-long-cache-ttl': {
    category: 'performance',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix: 'Set a long Cache-Control max-age on static assets (images, CSS, JS) — 1 year is standard. Use versioned filenames.',
  },
  'total-byte-weight': {
    category: 'performance',
    severity: 'high',
    impact: 'high_impact',
    how_to_fix: 'Your page is heavy. Compress images, remove unused JS/CSS, and lazy-load below-the-fold content.',
  },
  'dom-size': {
    category: 'performance',
    severity: 'medium',
    impact: 'normal',
    how_to_fix: 'Too many DOM nodes. Flatten deep div nesting, paginate long lists, virtualize long tables.',
  },
  'third-party-summary': {
    category: 'performance',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'Third-party scripts (analytics, chat widgets, ads) are slowing you down. Defer them until user interaction or lazy-load via a tag manager.',
  },
  'third-party-cookies': {
    category: 'best_practices',
    severity: 'low',
    impact: 'normal',
    how_to_fix: 'Browsers are deprecating third-party cookies. Audit trackers and move to first-party or server-side analytics.',
  },
  'bf-cache': {
    category: 'performance',
    severity: 'low',
    impact: 'normal',
    how_to_fix:
      'Your page blocks the back/forward cache, making back-button navigation slower. Remove `unload` event listeners and `no-store` Cache-Control headers.',
  },

  // --- Accessibility ---
  'color-contrast': {
    category: 'accessibility',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Some text has insufficient contrast against its background. Aim for WCAG AA: 4.5:1 for body text, 3:1 for large text. Use webaim.org/resources/contrastchecker.',
  },
  'image-alt': {
    category: 'accessibility',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Images are missing alt text. Add descriptive alt attributes (or empty alt="" for decorative images). Screen readers depend on this and Google Images uses it too.',
  },
  'link-name': {
    category: 'accessibility',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Links have no discernible name — usually icon-only buttons with no aria-label. Add aria-label="Open menu" or visible text inside the link.',
  },
  'button-name': {
    category: 'accessibility',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix: 'Buttons have no accessible name. Add visible text inside the button or aria-label="Close dialog".',
  },
  'heading-order': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'Your headings skip levels (e.g. H2 → H4). Use them in sequence. One <h1> per page, then <h2> for sections, <h3> for sub-sections.',
  },
  'html-has-lang': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix: 'Add lang="en" (or your language) to <html>. Screen readers use this to pick the right voice.',
  },
  'label': {
    category: 'accessibility',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix: 'Form fields are missing <label> elements. Wrap each input in a <label> or use `for="id"` to associate them.',
  },
  'select-name': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix: '<select> elements need associated <label>s so screen readers can announce them.',
  },
  'target-size': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'normal',
    how_to_fix: 'Touch targets are too small or too close together. Use at least 48×48px with 8px of spacing between them.',
  },
  'aria-valid-attr': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'normal',
    how_to_fix: 'You\'re using ARIA attributes that don\'t exist. Check the attribute names against the ARIA spec.',
  },

  // --- Best Practices ---
  'is-on-https': {
    category: 'technical',
    severity: 'critical',
    impact: 'high_impact',
    how_to_fix:
      'Your site is not on HTTPS. Install a TLS certificate (Let\'s Encrypt is free) and redirect all HTTP traffic to HTTPS with 301. Google penalises insecure sites.',
  },
  'inspector-issues': {
    category: 'best_practices',
    severity: 'low',
    impact: 'normal',
    how_to_fix: 'Chrome DevTools logged issues — usually console errors or deprecations. Open DevTools → Issues tab to see what.',
  },
  'no-vulnerable-libraries': {
    category: 'best_practices',
    severity: 'high',
    impact: 'normal',
    how_to_fix: 'You\'re loading a JavaScript library with a known vulnerability. Update jQuery, Bootstrap, etc. to their latest versions.',
  },
  'errors-in-console': {
    category: 'best_practices',
    severity: 'medium',
    impact: 'normal',
    how_to_fix: 'Browser console is logging errors. Open DevTools and fix them — they often break features silently.',
  },
  'charset': {
    category: 'best_practices',
    severity: 'low',
    impact: 'quick_win',
    how_to_fix: 'Declare a character encoding with <meta charset="UTF-8"> as the first element in <head>.',
  },
  'doctype': {
    category: 'best_practices',
    severity: 'low',
    impact: 'quick_win',
    how_to_fix: 'Add <!DOCTYPE html> as the first line of your HTML document.',
  },

  // --- Layout shift family (were falling through to technical) ---
  'layout-shifts': {
    category: 'performance',
    severity: 'high',
    impact: 'normal',
    how_to_fix:
      "Content jumps as the page loads. Add explicit width and height to <img>, <video>, <iframe>, and embeds. Reserve space for ad slots and banners. Never inject content above existing visible content.",
  },
  'layout-shift-elements': {
    category: 'performance',
    severity: 'high',
    impact: 'normal',
    how_to_fix:
      "Specific elements are shifting during load. Use the Chrome DevTools Performance tab → Experience row to find which elements are moving, then pin their dimensions with width/height attributes or CSS aspect-ratio.",
  },

  // --- Accessibility landmarks (were falling through to technical) ---
  'landmark-one-main': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix:
      "Wrap your main page content in a <main> element. Screen reader users rely on it to skip past navigation to the content they care about.",
  },
  'bypass': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix:
      'Add a "Skip to main content" link as the first focusable element on the page. Keyboard users need a way to jump past the navigation.',
  },

  // --- Robots.txt (valid-robots-txt vs robots-txt — LH uses both names across versions) ---
  'valid-robots-txt': {
    category: 'seo',
    severity: 'high',
    impact: 'normal',
    how_to_fix:
      'Your /robots.txt has syntax errors. Validate it at search.google.com/search-console/robots.txt and check for typos in User-agent or Disallow lines. Malformed robots.txt can block crawlers silently.',
  },

  // --- LCP family (image-first optimizations) ---
  'preload-lcp-image': {
    category: 'performance',
    severity: 'high',
    impact: 'high_impact',
    how_to_fix:
      'Preload your LCP image in <head>: <link rel="preload" as="image" href="/hero.webp" fetchpriority="high">. This tells the browser to start fetching it immediately instead of waiting for CSS/JS to run.',
  },
  'prioritize-lcp-image': {
    category: 'performance',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Add fetchpriority="high" to your hero <img> tag so the browser fetches it before other resources. Also remove loading="lazy" — it is the LCP image, not a below-the-fold one.',
  },
  'lcp-lazy-loaded': {
    category: 'performance',
    severity: 'high',
    impact: 'quick_win',
    how_to_fix:
      'Your LCP element has loading="lazy". Remove it. Lazy-loading the hero image delays the LCP paint by hundreds of milliseconds.',
  },

  // --- Image-specific ---
  'unsized-images': {
    category: 'images',
    severity: 'medium',
    impact: 'quick_win',
    how_to_fix:
      'Images without explicit width and height attributes cause layout shift while the browser waits to learn their size. Add width="..." height="..." to every <img>.',
  },
  'image-aspect-ratio': {
    category: 'images',
    severity: 'low',
    impact: 'quick_win',
    how_to_fix:
      'Images are being displayed at a distorted aspect ratio. Use the natural dimensions or apply CSS object-fit: cover to crop cleanly.',
  },

  // --- Network / protocol ---
  'uses-http2': {
    category: 'performance',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'Enable HTTP/2 on your server. Most modern hosts support it — on Cloudflare/Netlify/Vercel it is on by default. HTTP/2 lets the browser multiplex many requests over a single connection.',
  },
  'redirects-http': {
    category: 'technical',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'HTTP → HTTPS redirect is slower than necessary. Make sure your redirect is a single 301 (not a chain) and that internal links already use https://.',
  },

  // --- Best practices (were previously generic) ---
  'deprecations': {
    category: 'best_practices',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      "You're using web APIs that are scheduled for removal. Open DevTools → Issues panel to see which. Fix them now before they break silently.",
  },
  'geolocation-on-start': {
    category: 'best_practices',
    severity: 'low',
    impact: 'quick_win',
    how_to_fix:
      "Don't request geolocation permission on page load — browsers block it and users distrust it. Wait for a button click before calling navigator.geolocation.",
  },
  'notification-on-start': {
    category: 'best_practices',
    severity: 'low',
    impact: 'quick_win',
    how_to_fix:
      "Don't request notification permission on page load. Ask only after a user action (click a 'Get updates' button).",
  },
  'no-document-write': {
    category: 'best_practices',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'Remove document.write() calls — they block HTML parsing on slow connections and often come from legacy ad scripts. Replace with DOM APIs or async tag loading.',
  },
  'uses-passive-event-listeners': {
    category: 'performance',
    severity: 'low',
    impact: 'quick_win',
    how_to_fix:
      'Touch and wheel event listeners need {passive: true} so they do not block scrolling. Update addEventListener calls: element.addEventListener("touchstart", fn, {passive: true}).',
  },

  // --- Media accessibility ---
  'video-caption': {
    category: 'accessibility',
    severity: 'medium',
    impact: 'normal',
    how_to_fix:
      'Add <track kind="captions" src="..." srclang="en" label="English"> inside your <video> elements. Captions are required for accessibility compliance.',
  },
  'list': {
    category: 'accessibility',
    severity: 'low',
    impact: 'normal',
    how_to_fix: 'Lists (<ul>, <ol>) must only contain <li> as direct children. Fix any stray <div>s inside list containers.',
  },
  'listitem': {
    category: 'accessibility',
    severity: 'low',
    impact: 'normal',
    how_to_fix: '<li> elements must be direct children of <ul> or <ol>. Wrap them properly or change the tag.',
  },
  'definition-list': {
    category: 'accessibility',
    severity: 'low',
    impact: 'normal',
    how_to_fix: '<dl> definition lists must contain only <dt> and <dd> children (optionally wrapped in <div>).',
  },
  'dlitem': {
    category: 'accessibility',
    severity: 'low',
    impact: 'normal',
    how_to_fix: '<dt> and <dd> elements must be children of a <dl>. Wrap them in a definition list or change the tag.',
  },
  'form-field-multiple-labels': {
    category: 'accessibility',
    severity: 'low',
    impact: 'quick_win',
    how_to_fix: 'A form field has multiple <label> elements associated with it. Keep one label per field.',
  },
};

// Audits we deliberately skip (too noisy, not actionable, or duplicates)
const SKIP_AUDITS = new Set([
  'final-screenshot',
  'screenshot-thumbnails',
  'script-treemap-data',
  'resource-summary',
  'network-requests',
  'network-rtt',
  'network-server-latency',
  'main-thread-tasks',
  'diagnostics',
  'metrics',
  'full-page-screenshot',
  'user-timings',
  'bootup-time',
  'mainthread-work-breakdown',
  'critical-request-chains',
  'redirects',
  'uses-rel-preconnect',
  'uses-rel-preload',
  'font-display',
  'preload-fonts',
  'long-tasks',
  'non-composited-animations',
  // "insight" audits are internal LH groupings, not user-facing
]);

function severityToPriority(sev: Severity): 'high' | 'medium' | 'low' {
  if (sev === 'critical' || sev === 'high') return 'high';
  if (sev === 'medium') return 'medium';
  return 'low';
}

function fallbackCategory(auditId: string, lhCategoryId?: string): Category {
  // 1. Trust Lighthouse's own categorization when we have it.
  if (lhCategoryId === 'performance') return 'performance';
  if (lhCategoryId === 'accessibility') return 'accessibility';
  if (lhCategoryId === 'best-practices' || lhCategoryId === 'best_practices') return 'best_practices';
  if (lhCategoryId === 'seo') return 'seo';

  // 2. Keyword heuristics for unknown audits with no LH category info.
  const id = auditId.toLowerCase();

  const perfKeywords = ['paint', 'lcp', 'fcp', 'tti', 'tbt', 'speed-index', 'cls', 'layout-shift', 'bf-cache', 'render-blocking', 'unused-', 'cache-ttl', 'byte-weight', 'dom-size', 'third-party', 'server-response', 'main-thread', 'legacy-js', 'duplicated-js', 'preload', 'prefetch', 'http2', 'compression', 'interactive'];
  if (perfKeywords.some((k) => id.includes(k))) return 'performance';

  const a11yKeywords = ['landmark', 'aria-', 'color-contrast', 'heading', 'label', 'tab-', 'tap-target', 'target-size', 'button-name', 'link-name', 'select-name', 'form-field', 'html-has-lang', 'html-lang', 'video-caption', 'dlitem', 'listitem', 'definition-list'];
  if (a11yKeywords.some((k) => id.includes(k))) return 'accessibility';

  const seoKeywords = ['crawl', 'canonical', 'hreflang', 'structured-data', 'robots-txt', 'link-text', 'viewport', 'font-size', 'plugins', 'is-crawlable'];
  if (seoKeywords.some((k) => id.includes(k))) return 'seo';

  const bpKeywords = ['vulnerable', 'deprecated', 'charset', 'doctype', 'csp', 'third-party-cookies', 'inspector', 'no-document-write', 'errors-in-console', 'geolocation', 'notification', 'password', 'image-aspect-ratio'];
  if (bpKeywords.some((k) => id.includes(k))) return 'best_practices';

  if (id.includes('image') || id.includes('webp') || id.includes('avif')) return 'images';
  if (id.includes('meta-description') || id.includes('document-title') || id.includes('meta')) return 'meta';
  if (id.includes('https') || id.includes('ssl') || id.includes('tls')) return 'technical';

  // 3. Default: technical (last resort)
  return 'technical';
}

function severityFromScore(score: number | null | undefined, base: Severity = 'medium'): Severity {
  if (score == null) return base;
  if (score === 0) return base === 'low' ? 'medium' : base === 'medium' ? 'high' : 'critical';
  if (score < 0.5) return base === 'low' ? 'medium' : base;
  if (score < 0.9) return base === 'critical' ? 'high' : base === 'high' ? 'medium' : 'low';
  return 'low';
}

// ---------- Main ----------
export function analyze(
  lighthouse: LighthouseResult | null,
  pageMeta: InstantPageMeta | null
): AnalyzeResult {
  const findings: Finding[] = [];
  const actionItems: ActionItem[] = [];

  const categories = lighthouse?.categories || {};
  const audits = lighthouse?.audits || {};

  // Top-line scores (Lighthouse returns 0-1; we convert to 0-100)
  const catScore = (id: string): number | null => {
    // Lighthouse category IDs use hyphen; DFS sometimes returns underscore
    const cat = categories[id] || categories[id.replace('-', '_')];
    const s = cat?.score;
    return s == null ? null : Math.round(s * 100);
  };

  const perf_score = catScore('performance');
  const seo_score = catScore('seo');
  const a11y_score = catScore('accessibility');
  const best_practices_score = catScore('best-practices');

  // Build a map of audit → which Lighthouse category it belongs to, using
  // Lighthouse's authoritative auditRefs. DFS passes these through on most
  // responses. Falls back to keyword heuristics in fallbackCategory() if not.
  const auditToLhCategory: Record<string, string> = {};
  for (const [catId, cat] of Object.entries(categories)) {
    const refs = ((cat as unknown as { auditRefs?: { id?: string }[] }).auditRefs) || [];
    for (const ref of refs) {
      if (ref?.id) auditToLhCategory[ref.id] = catId;
    }
  }

  // Walk all audits, pick up failures (score < 0.9)
  for (const [auditId, audit] of Object.entries(audits)) {
    if (SKIP_AUDITS.has(auditId)) continue;
    if (auditId.endsWith('-insight')) continue; // internal LH grouping
    const score = audit.score;
    if (score == null) continue; // informational-only audit
    if (score >= 0.9) continue; // passing

    const rule = AUDIT_RULES[auditId];
    const category: Category = rule?.category || fallbackCategory(auditId, auditToLhCategory[auditId]);
    const severity: Severity = rule
      ? severityFromScore(score, rule.severity)
      : severityFromScore(score, 'medium');

    const title = rule?.title_override || audit.title || auditId;
    const description = audit.description || 'Lighthouse flagged this audit as failing.';

    const how_to_fix =
      rule?.how_to_fix ||
      'Follow the Lighthouse recommendation above. You can run this audit manually at pagespeed.web.dev to see more detail.';

    let impact: Finding['impact'] = rule?.impact || 'normal';
    if (ADVANCED_AUDITS.has(auditId)) impact = 'advanced';

    const finding: Finding = {
      code: auditId,
      category,
      severity,
      title,
      description: cleanLhDescription(description),
      how_to_fix,
      score,
      display_value: audit.displayValue || null,
      impact,
    };

    const idx = findings.push(finding) - 1;
    actionItems.push({
      code: auditId,
      category,
      priority: severityToPriority(severity),
      title,
      how_to_fix,
      finding_index: idx,
      impact,
    });
  }

  // Enrich from instant_pages: hard-check title/description/H1/schema existence
  // even if Lighthouse didn't flag them.
  if (pageMeta) {
    if (!pageMeta.title && !findings.find((f) => f.code === 'document-title')) {
      pushSimpleFinding(findings, actionItems, {
        code: 'missing_title_tag',
        category: 'meta',
        severity: 'critical',
        impact: 'quick_win',
        title: 'Missing <title> tag',
        description: 'Your homepage has no <title> element. Title tags are the single biggest on-page ranking signal.',
        how_to_fix: AUDIT_RULES['document-title'].how_to_fix,
      });
    }

    if (!pageMeta.description && !findings.find((f) => f.code === 'meta-description')) {
      pushSimpleFinding(findings, actionItems, {
        code: 'missing_meta_description',
        category: 'meta',
        severity: 'critical',
        impact: 'quick_win',
        title: 'Missing meta description',
        description: 'No <meta name="description"> on your homepage. Google will generate a snippet for you — usually poorly.',
        how_to_fix: AUDIT_RULES['meta-description'].how_to_fix,
      });
    }

    const h1Count = pageMeta.h1?.length ?? 0;
    if (h1Count === 0) {
      pushSimpleFinding(findings, actionItems, {
        code: 'missing_h1',
        category: 'meta',
        severity: 'high',
        impact: 'quick_win',
        title: 'Missing <h1> tag',
        description: 'Your homepage has no <h1>. The H1 is the page\'s main headline for both users and crawlers.',
        how_to_fix: 'Add exactly one <h1> per page that clearly states the topic. Should echo your title tag but written for humans.',
      });
    } else if (h1Count > 1) {
      pushSimpleFinding(findings, actionItems, {
        code: 'multiple_h1',
        category: 'meta',
        severity: 'medium',
        impact: 'quick_win',
        title: `Multiple <h1> tags (${h1Count})`,
        description: `Your homepage has ${h1Count} H1 tags. Multiple H1s dilute the page\'s topical signal.`,
        how_to_fix: 'Keep exactly one <h1>. Downgrade the others to <h2>.',
      });
    }

    if (!pageMeta.has_schema) {
      pushSimpleFinding(findings, actionItems, {
        code: 'no_schema_markup',
        category: 'seo',
        severity: 'medium',
        impact: 'normal',
        title: 'No schema markup detected',
        description: 'Your homepage has no JSON-LD schema. Schema unlocks rich results: FAQ, LocalBusiness, Service, breadcrumb.',
        how_to_fix:
          'Add JSON-LD for LocalBusiness (name, address, phone, hours, geo) and Service for each service page. Validate at search.google.com/test/rich-results.',
      });
    }
  }

  // Sort: quick_wins first within each severity, then high → low severity
  const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const impactRank: Record<string, number> = { quick_win: 0, high_impact: 1, normal: 2 };
  findings.sort((a, b) => {
    if (severityRank[a.severity] !== severityRank[b.severity]) {
      return severityRank[a.severity] - severityRank[b.severity];
    }
    return impactRank[a.impact] - impactRank[b.impact];
  });
  // Re-sort action items to match findings order
  const actionByCode = new Map(actionItems.map((a) => [a.code, a]));
  const reordered: ActionItem[] = [];
  findings.forEach((f, i) => {
    const a = actionByCode.get(f.code);
    if (a) {
      a.finding_index = i;
      reordered.push(a);
    }
  });

  // Compute overall score: average of Lighthouse categories if we have them,
  // otherwise fall back to a severity-weighted penalty.
  let score: number;
  const cats = [perf_score, seo_score, a11y_score, best_practices_score].filter(
    (n): n is number => n != null
  );
  if (cats.length > 0) {
    score = Math.round(cats.reduce((s, n) => s + n, 0) / cats.length);
  } else {
    let penalty = 0;
    for (const f of findings) {
      penalty += f.severity === 'critical' ? 10 : f.severity === 'high' ? 5 : f.severity === 'medium' ? 2 : 1;
    }
    score = Math.max(0, 100 - penalty);
  }

  return {
    findings,
    action_items: reordered,
    score,
    perf_score,
    seo_score,
    a11y_score,
    best_practices_score,
    meta: {
      title: pageMeta?.title || null,
      description: pageMeta?.description || null,
      h1: pageMeta?.h1 || [],
      has_schema: pageMeta?.has_schema || false,
    },
  };
}

function pushSimpleFinding(
  findings: Finding[],
  actionItems: ActionItem[],
  f: Omit<Finding, 'score' | 'display_value'>
) {
  const finding: Finding = {
    ...f,
    score: null,
    display_value: null,
  };
  const idx = findings.push(finding) - 1;
  actionItems.push({
    code: f.code,
    category: f.category,
    priority: severityToPriority(f.severity),
    title: f.title,
    how_to_fix: f.how_to_fix,
    finding_index: idx,
    impact: f.impact,
  });
}

// Lighthouse descriptions come as markdown with trailing "[Learn more about X](url)."
// Strip the markdown link syntax AND the surrounding "Learn more..." sentence.
function cleanLhDescription(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
    .replace(/\s*Learn more about[^.]*\.?\s*$/i, '') // trailing "Learn more about …"
    .replace(/\s*Learn how to[^.]*\.?\s*$/i, '') // trailing "Learn how to …"
    .replace(/\s+/g, ' ')
    .trim();
}
