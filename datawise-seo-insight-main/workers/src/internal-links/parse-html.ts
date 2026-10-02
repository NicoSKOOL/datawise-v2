// Page parser for the Internal Links crawl: title, h1, description, lang,
// same-host outlinks and link-free paragraphs. Port of crawl.py parse(),
// which uses BeautifulSoup + lxml. A small tolerant tree builder is used
// instead of HTMLRewriter so the exact BeautifulSoup semantics (nested
// p/li, get_text separators, removed nav/header/footer) can be reproduced
// and unit-tested in Node.

export interface ParsedPassage {
  i: number;
  text: string;
}

export interface ParsedPage {
  url: string;
  canon: string;
  lang: string;
  title: string;
  h1: string;
  description: string;
  passages: ParsedPassage[];
  outlinks: string[];
  word_count: number;
}

// Paragraphs shorter than this are not worth a link.
const MIN_PASSAGE = 120;
const DROP = /\b(cookie|newsletter|subscribe|all rights reserved)\b/i;
const REMOVED = new Set(['script', 'style', 'noscript', 'nav', 'footer', 'header']);
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp']);
// Opening one of these implicitly closes an open <p>.
const CLOSES_P = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl',
  'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'ul',
]);

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: Array<El | string>;
  parent: El | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', middot: '·', deg: '°', euro: '€', pound: '£', cent: '¢',
  times: '×', divide: '÷', iexcl: '¡', iquest: '¿', ordf: 'ª', ordm: 'º',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', egrave: 'è', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  acirc: 'â', ecirc: 'ê', icirc: 'î', ocirc: 'ô', ucirc: 'û',
  auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü',
  Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ntilde: 'ñ', Ntilde: 'Ñ',
  ccedil: 'ç', Ccedil: 'Ç', atilde: 'ã', otilde: 'õ', aring: 'å', oslash: 'ø',
  zwj: '‍', zwnj: '‌', shy: '­', ensp: ' ', emsp: ' ',
  thinsp: ' ', rarr: '→', larr: '←', check: '✓',
};

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined && m.endsWith(';') ? named : m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function buildTree(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const tagRe =
    /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][^\s/>]*)[^>]*>|<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const addText = (t: string) => {
    if (t) cur.children.push(decodeEntities(t));
  };
  const closeTo = (tag: string) => {
    for (let n: El | null = cur; n && n !== root; n = n.parent) {
      if (n.tag === tag) {
        cur = n.parent!;
        return;
      }
    }
  };
  const hasOpen = (tag: string, stopAt: Set<string>) => {
    for (let n: El | null = cur; n && n !== root; n = n.parent) {
      if (n.tag === tag) return true;
      if (stopAt.has(n.tag)) return false;
    }
    return false;
  };
  const LIST_SCOPE = new Set(['ul', 'ol', 'menu']);
  const BUTTON_SCOPE = new Set(['button', 'table', 'td', 'th']);

  while ((m = tagRe.exec(html))) {
    addText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    if (m[1]) {
      closeTo(m[1].toLowerCase());
      continue;
    }
    if (!m[2]) continue; // comment, doctype, processing instruction
    const tag = m[2].toLowerCase();
    const rawAttrs = m[3] ?? '';

    if (CLOSES_P.has(tag) && hasOpen('p', BUTTON_SCOPE)) closeTo('p');
    if (tag === 'li' && hasOpen('li', LIST_SCOPE)) closeTo('li');
    if ((tag === 'dt' || tag === 'dd') && (hasOpen('dt', new Set(['dl'])) || hasOpen('dd', new Set(['dl'])))) {
      closeTo(hasOpen('dt', new Set(['dl'])) ? 'dt' : 'dd');
    }

    const el: El = { tag, attrs: parseAttrs(rawAttrs), children: [], parent: cur };
    cur.children.push(el);
    if (VOID.has(tag) || /\/\s*$/.test(rawAttrs)) continue;

    if (RAW_TEXT.has(tag)) {
      const end = html.slice(last).search(new RegExp(`</${tag}\\s*>`, 'i'));
      const content = end === -1 ? html.slice(last) : html.slice(last, last + end);
      if (content) el.children.push(tag === 'script' || tag === 'style' ? content : decodeEntities(content));
      if (end === -1) {
        last = html.length;
        break;
      }
      last = last + end;
      tagRe.lastIndex = last;
      continue;
    }
    cur = el;
  }
  addText(html.slice(last));
  return root;
}

function* walk(el: El): Generator<El> {
  for (const c of el.children) {
    if (typeof c !== 'string') {
      yield c;
      yield* walk(c);
    }
  }
}

function find(el: El, tag: string): El | undefined {
  for (const n of walk(el)) if (n.tag === tag) return n;
  return undefined;
}

function strings(el: El, out: string[] = []): string[] {
  for (const c of el.children) {
    if (typeof c === 'string') out.push(c);
    else strings(c, out);
  }
  return out;
}

// Python str.strip() / split() treat all Unicode whitespace as whitespace.
const WS = /[\s\u001c-\u001f\u0085]+/;

/** BeautifulSoup get_text(sep, strip=True). */
function getText(el: El, sep: string): string {
  return strings(el)
    .map((s) => s.replace(new RegExp(`^${WS.source}|${WS.source}$`, 'g'), ''))
    .filter(Boolean)
    .join(sep);
}

function collapse(s: string): string {
  return s.split(WS).filter(Boolean).join(' ');
}

function removeTags(el: El): void {
  el.children = el.children.filter((c) => typeof c === 'string' || !REMOVED.has(c.tag));
  for (const c of el.children) if (typeof c !== 'string') removeTags(c);
}

/** Normalise to a comparable form: no scheme/www/query, trailing slash. */
export function canon(url: string): string {
  const u = new URL(url);
  let path = u.pathname || '/';
  if (!path.endsWith('/')) path += '/';
  return u.host.replace('www.', '') + path;
}

export function parsePage(url: string, html: string): ParsedPage {
  const root = buildTree(html);
  const htmlEl = find(root, 'html');
  const lang = (htmlEl?.attrs.lang ?? '').split('-')[0].toLowerCase();
  removeTags(root);

  const titleEl = find(root, 'title');
  const h1El = find(root, 'h1');
  let description = '';
  for (const n of walk(root)) {
    if (n.tag === 'meta' && n.attrs.name === 'description') {
      description = (n.attrs.content ?? '').trim();
      break;
    }
  }

  const main = find(root, 'main') ?? find(root, 'body') ?? root;
  const host = new URL(url).host.replace('www.', '');

  // Existing internal links, so we never propose a duplicate.
  const outlinks = new Set<string>();
  for (const n of walk(main)) {
    if (n.tag !== 'a' || !('href' in n.attrs)) continue;
    const href = n.attrs.href;
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) continue;
    try {
      const full = new URL(href, url);
      if (full.host.replace('www.', '') === host) outlinks.add(canon(full.href));
    } catch {
      // unparseable href
    }
  }

  // Passages: paragraphs and list items long enough to host a link. Anything
  // already containing a link is skipped: no room, and the author already
  // routed the reader somewhere from here.
  const passages: ParsedPassage[] = [];
  for (const n of walk(main)) {
    if (n.tag !== 'p' && n.tag !== 'li') continue;
    if (find(n, 'a')) continue;
    const txt = collapse(getText(n, ' '));
    if ([...txt].length < MIN_PASSAGE || DROP.test(txt)) continue;
    passages.push({ i: passages.length, text: txt });
  }

  const body = passages.map((p) => p.text).join(' ');
  return {
    url,
    canon: canon(url),
    lang,
    title: titleEl ? getText(titleEl, '') : '',
    h1: h1El ? getText(h1El, '') : '',
    description,
    passages,
    outlinks: [...outlinks].sort(),
    word_count: body.split(WS).filter(Boolean).length,
  };
}
