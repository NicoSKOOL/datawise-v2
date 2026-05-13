// Direct fetch + HTMLRewriter parser. When this works, it's the most
// authoritative source — real <title>, real <meta>, real headings, real
// <img> tags, real JSON-LD schema — because we're reading the raw HTML
// that Google would see. Cloudflare Workers egress from a well-reputed
// IP range that most bot-protection services allow.
//
// Falls back silently (returns null) if the target site refuses the
// request; the caller chains to other DFS-based sources.

export interface ParsedHtml {
  title: string;
  meta_description: string;
  meta_robots: string;
  canonical: string;
  headings: { tag: 'h1' | 'h2' | 'h3' | 'h4'; text: string }[];
  images: {
    src: string;
    alt: string;
    width: number | null;
    height: number | null;
    format: string; // extension: 'png', 'jpg', 'webp', 'avif', 'svg', 'gif', 'unknown'
    is_png: boolean;
  }[];
  schema_types: string[];
  raw_schema: unknown[]; // parsed JSON-LD objects
  html_lang: string | null;
  // Derived conveniences
  h1: string[];
  h2: string[];
  h3: string[];
  h4: string[];
  png_count: number;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

function extensionFromUrl(src: string): string {
  try {
    const url = new URL(src, 'https://example.com/');
    const path = url.pathname.toLowerCase();
    const m = path.match(/\.([a-z0-9]+)(?:$)/);
    return m ? m[1] : 'unknown';
  } catch {
    const m = src.toLowerCase().match(/\.([a-z0-9]+)(?:\?|#|$)/);
    return m ? m[1] : 'unknown';
  }
}

export async function fetchAndParseHtml(url: string): Promise<ParsedHtml | null> {
  console.log('[html-parser] fetching', url);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      cf: {
        // Disable Cloudflare caching for this request so we always get fresh HTML
        cacheTtl: 0,
        cacheEverything: false,
      },
    } as RequestInit);
  } catch (err: unknown) {
    console.error('[html-parser] fetch threw for', url, err);
    return null;
  }

  const status = response.status;
  const finalUrl = response.url;
  const contentType = response.headers.get('content-type') || '';
  console.log('[html-parser] got response', { status, finalUrl, contentType });

  if (!response.ok) {
    console.warn('[html-parser] non-OK status', status, 'for', url);
    return null;
  }

  // Short-circuit non-HTML responses
  if (!contentType.toLowerCase().includes('text/html')) {
    console.warn('[html-parser] non-HTML content-type:', contentType);
    return null;
  }

  // State captured by the rewriter handlers
  const state = {
    title: '',
    _inTitle: false,
    meta_description: '',
    meta_robots: '',
    canonical: '',
    html_lang: null as string | null,
    headings: [] as { tag: 'h1' | 'h2' | 'h3' | 'h4'; text: string; _open: boolean }[],
    _currentHeading: null as { tag: 'h1' | 'h2' | 'h3' | 'h4'; text: string } | null,
    images: [] as ParsedHtml['images'],
    schema_strings: [] as string[],
    _currentSchema: '',
    _inSchema: false,
  };

  // HTMLRewriter is a Cloudflare Workers global. @cloudflare/workers-types
  // declares it in the global scope.
  const rewriter = new HTMLRewriter()
    .on('html', {
      element(el) {
        state.html_lang = el.getAttribute('lang');
      },
    })
    .on('title', {
      element() {
        state._inTitle = true;
      },
      text(t) {
        if (state._inTitle) state.title += t.text;
        if (t.lastInTextNode) state._inTitle = false;
      },
    })
    .on('meta[name=description]', {
      element(el) {
        state.meta_description = el.getAttribute('content') || '';
      },
    })
    .on('meta[name=robots]', {
      element(el) {
        state.meta_robots = el.getAttribute('content') || '';
      },
    })
    .on('link[rel=canonical]', {
      element(el) {
        state.canonical = el.getAttribute('href') || '';
      },
    })
    .on('h1, h2, h3, h4', {
      element(el) {
        const tag = el.tagName.toLowerCase() as 'h1' | 'h2' | 'h3' | 'h4';
        state._currentHeading = { tag, text: '' };
      },
      text(t) {
        if (state._currentHeading) {
          state._currentHeading.text += t.text;
          if (t.lastInTextNode) {
            const trimmed = state._currentHeading.text.replace(/\s+/g, ' ').trim();
            if (trimmed)
              state.headings.push({ tag: state._currentHeading.tag, text: trimmed, _open: false });
            state._currentHeading = null;
          }
        }
      },
    })
    .on('img', {
      element(el) {
        const src = el.getAttribute('src') || '';
        if (!src) return;
        const alt = el.getAttribute('alt') || '';
        const widthStr = el.getAttribute('width');
        const heightStr = el.getAttribute('height');
        const width = widthStr ? Number(widthStr) || null : null;
        const height = heightStr ? Number(heightStr) || null : null;
        const format = extensionFromUrl(src);
        state.images.push({
          src,
          alt,
          width,
          height,
          format,
          is_png: format === 'png',
        });
      },
    })
    .on('script[type="application/ld+json"]', {
      element() {
        state._inSchema = true;
        state._currentSchema = '';
      },
      text(t) {
        if (state._inSchema) {
          state._currentSchema += t.text;
          if (t.lastInTextNode) {
            if (state._currentSchema.trim()) {
              state.schema_strings.push(state._currentSchema.trim());
            }
            state._currentSchema = '';
            state._inSchema = false;
          }
        }
      },
    });

  const transformed = rewriter.transform(response);
  // Consume the stream so the rewriter handlers fire
  try {
    await transformed.text();
  } catch (err) {
    console.warn('[html-parser] rewriter stream error:', err);
    return null;
  }

  // Parse schema JSON strings and extract @type values
  const raw_schema: unknown[] = [];
  const schema_types_set = new Set<string>();
  for (const s of state.schema_strings) {
    try {
      const parsed = JSON.parse(s);
      raw_schema.push(parsed);
      const walk = (obj: unknown) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach(walk);
          return;
        }
        const o = obj as Record<string, unknown>;
        if (typeof o['@type'] === 'string') {
          schema_types_set.add(o['@type']);
        } else if (Array.isArray(o['@type'])) {
          for (const t of o['@type'] as unknown[]) if (typeof t === 'string') schema_types_set.add(t);
        }
        if (Array.isArray(o['@graph'])) for (const g of o['@graph']) walk(g);
        for (const k of Object.keys(o)) {
          if (k === '@type' || k === '@graph') continue;
          walk(o[k]);
        }
      };
      walk(parsed);
    } catch {
      // Ignore bad JSON-LD blocks
    }
  }

  const headings = state.headings.map(({ tag, text }) => ({ tag, text }));
  const h1 = headings.filter((h) => h.tag === 'h1').map((h) => h.text);
  const h2 = headings.filter((h) => h.tag === 'h2').map((h) => h.text);
  const h3 = headings.filter((h) => h.tag === 'h3').map((h) => h.text);
  const h4 = headings.filter((h) => h.tag === 'h4').map((h) => h.text);
  const png_count = state.images.filter((i) => i.is_png).length;

  console.log('[html-parser] parsed', {
    title_len: state.title.length,
    description_len: state.meta_description.length,
    headings_total: headings.length,
    h1_count: h1.length,
    h2_count: h2.length,
    h3_count: h3.length,
    images: state.images.length,
    png_count,
    schema_blocks: state.schema_strings.length,
    schema_types_count: schema_types_set.size,
  });

  return {
    title: state.title.replace(/\s+/g, ' ').trim(),
    meta_description: state.meta_description.trim(),
    meta_robots: state.meta_robots.trim(),
    canonical: state.canonical.trim(),
    headings,
    images: state.images,
    schema_types: Array.from(schema_types_set),
    raw_schema,
    html_lang: state.html_lang,
    h1,
    h2,
    h3,
    h4,
    png_count,
  };
}
