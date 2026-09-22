// Regex-based facts from a page's HTML. No DOM in vitest on Node and no
// HTMLRewriter outside workerd, so this stays plain string work. Everything
// here is untrusted page content returned as data.
import { detectBotChallenge } from '../blueprint/domain/bot-challenge';

export interface PageFacts {
  url: string;
  status_code: number | null;
  source: 'direct' | 'dataforseo';
  blocked: boolean;
  fetch_failed: boolean;
  fetched_at: string;
  title: string | null;
  meta_description: string | null;
  canonical: string | null;
  headings: { h1: string[]; h2: string[]; h3: string[] };
  phones: string[];
  addresses: string[];
  hours_text: string[];
  schema: Array<Record<string, any>>;
  nav_links: Array<{ anchor: string; url: string }>;
  service_terms: string[];
  word_count: number;
  body_text: string | null;
}

const LOCAL_TYPES = /^(LocalBusiness|Organization|Service|Product|FAQPage|BreadcrumbList|OpeningHoursSpecification|PostalAddress|Plumber|Electrician|Dentist|Attorney|Physician|MedicalBusiness|HomeAndConstructionBusiness|AutoRepair|Restaurant|Store|ProfessionalService|LegalService|FinancialService|HealthAndBeautyBusiness|SportsActivityLocation|LodgingBusiness|FoodEstablishment|RealEstateAgent|RoofingContractor|HVACBusiness|MovingCompany|Locksmith|GeneralContractor|HousePainter|Florist|Bakery|Cafe|BarOrPub|Hotel|Gym|HairSalon|BeautySalon|DaySpa|Pharmacy|VeterinaryCare|ChildCare|School|EducationalOrganization|Church|TravelAgency|InsuranceAgency|AccountingService|EmploymentAgency|AutoDealer|AutoWash|GasStation|DryCleaningOrLaundry|SelfStorage|PetStore|AnimalShelter|LandscapingBusiness|PestControl|CleaningService)$/;

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ', '&#8211;': '-', '&ndash;': '-', '&#8212;': '-', '&mdash;': '-', '&rsquo;': "'", '&#8217;': "'" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m) => {
    if (ENTITIES[m]) return ENTITIES[m];
    if (/^&#\d+;$/.test(m)) return String.fromCodePoint(parseInt(m.slice(2, -1), 10));
    if (/^&#x[0-9a-f]+;$/i.test(m)) return String.fromCodePoint(parseInt(m.slice(3, -1), 16));
    return m;
  });
}
const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function stripNoise(html: string): string {
  return html.replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}

function tagTexts(html: string, tag: string, max = 40): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))) {
    const t = clean(m[1]);
    if (t) out.push(t.slice(0, 200));
    if (out.length >= max) break;
  }
  return out;
}

function attr(tagHtml: string, name: string): string | null {
  const m = tagHtml.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function jsonLd(html: string): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: any;
    try { parsed = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes: any[] = [];
    const push = (n: any) => { if (Array.isArray(n)) n.forEach(push); else if (n && typeof n === 'object') { nodes.push(n); if (Array.isArray(n['@graph'])) n['@graph'].forEach(push); } };
    push(parsed);
    for (const n of nodes) {
      const types = Array.isArray(n['@type']) ? n['@type'] : [n['@type']];
      if (types.some((t: unknown) => typeof t === 'string' && LOCAL_TYPES.test(t))) {
        const { '@graph': _g, ...rest } = n;
        const text = JSON.stringify(rest);
        out.push(text.length > 4000 ? JSON.parse(text.slice(0, 4000).replace(/,[^,]*$/, '') + '}') : rest);
      }
      if (out.length >= 10) return out;
    }
  }
  return out;
}

// Controller ruling: allow an optional leading "(" so "(03) 9000 0001" is
// captured whole (the brief's regex without it split on the parenthesis).
const PHONE = /(?:\+?\(?\d[\d\s().-]{6,}\d)/g;
export function extractPhones(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(PHONE) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) continue;
    const v = m.trim();
    if (!out.includes(v)) out.push(v);
    if (out.length >= 10) break;
  }
  return out;
}

// Controller ruling: build the street-type alternation case-insensitively by
// hand (first letter as a [Xx] class) and drop the "i" flag entirely, so the
// TAIL group below can require capitalised words for the locality/state and
// stop before the next, lowercase, sentence.
const STREET_WORDS = ['street', 'st', 'road', 'rd', 'avenue', 'ave', 'boulevard', 'blvd', 'drive', 'dr', 'lane', 'ln', 'way', 'court', 'ct', 'highway', 'hwy', 'place', 'pl', 'parade', 'pde', 'crescent', 'cres', 'terrace', 'tce', 'square', 'sq', 'circuit', 'cct', 'esplanade', 'close', 'cl', 'grove', 'gr', 'calle', 'avenida', 'carrera'];
const STREET = STREET_WORDS.map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join('|');
const UNIT = `(?:(?:[Uu]nit|[Ss]uite|[Ss]te|[Ss]hop|[Ll]evel|[Ll]vl)\\s*[\\w-]+[,\\s/]+)?`;
const TAIL = `(?:,?\\s+[A-Z][\\w'-]*(?:\\s+[A-Z][\\w'-]*){0,2})?(?:,?\\s+\\d{4,5}(?:-\\d{4})?)?`;
const ADDRESS = new RegExp(`${UNIT}\\d{1,6}[a-z]?(?:\\/\\d+)?\\s+[\\w'-]+(?:\\s+[\\w'-]+){0,3}\\s+(?:${STREET})\\b\\.?${TAIL}`, 'g');
export function extractAddresses(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(ADDRESS) ?? []) {
    const v = m.replace(/\s+/g, ' ').replace(/[.,]$/, '').trim();
    if (v.length >= 10 && !out.includes(v)) out.push(v);
    if (out.length >= 10) break;
  }
  return out;
}

const DAY = /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays|weekends|lunes|martes|miércoles|jueves|viernes|sábado|domingo)\b/i;
const TIME = /(\d{1,2}(:\d{2})?\s*(am|pm|h|hrs)\b|\d{1,2}:\d{2}|\bclosed\b|\bcerrado\b|24\/7|24 hours)/i;
// Controller ruling: split on newlines only, not sentence ends, so a single
// hours paragraph (one <p>, no embedded newline) stays one line.
export function extractHoursLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (line.length > 8 && line.length <= 300 && DAY.test(line) && TIME.test(line) && !out.includes(line)) out.push(line);
    if (out.length >= 10) break;
  }
  return out;
}

function schemaAddresses(schema: Array<Record<string, any>>): string[] {
  const out: string[] = [];
  const visit = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.streetAddress) {
      const parts = [n.streetAddress, n.addressLocality, n.addressRegion, n.postalCode].filter((p) => typeof p === 'string' && p.trim());
      const v = parts.join(', ');
      if (v && !out.includes(v)) out.push(v);
    }
    for (const v of Object.values(n)) if (v && typeof v === 'object') visit(v);
  };
  schema.forEach(visit);
  return out;
}

function schemaPhones(schema: Array<Record<string, any>>): string[] {
  const out: string[] = [];
  const visit = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.telephone === 'string' && n.telephone.trim() && !out.includes(n.telephone.trim())) out.push(n.telephone.trim());
    for (const v of Object.values(n)) if (v && typeof v === 'object') visit(v);
  };
  schema.forEach(visit);
  return out;
}

export function extractPageFacts(html: string, url: string, statusCode: number | null, opts: { bodyChars: number }): PageFacts {
  const schema = jsonLd(html);
  const noise = stripNoise(html);
  const head = noise.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? noise;
  const titleRaw = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? noise.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = titleRaw ? clean(titleRaw) : null;
  const metaTag = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /name\s*=\s*["']description["']/i.test(t));
  const canonicalTag = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /rel\s*=\s*["']canonical["']/i.test(t));

  const headings = { h1: tagTexts(noise, 'h1', 10), h2: tagTexts(noise, 'h2', 40), h3: tagTexts(noise, 'h3', 40) };

  let host = '';
  try { host = new URL(url).hostname; } catch { /* keep '' */ }
  const navHtml = [...noise.matchAll(/<(nav|header|footer)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]).join(' ');
  const navLinks: Array<{ anchor: string; url: string }> = [];
  for (const m of navHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], 'href');
    const anchor = clean(m[2]).slice(0, 80);
    if (!href || !anchor) continue;
    let abs: URL;
    try { abs = new URL(href, url); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol)) continue;
    if (abs.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) continue;
    abs.hash = '';
    const u = abs.toString();
    if (!navLinks.some((l) => l.url === u)) navLinks.push({ anchor, url: u });
    if (navLinks.length >= 60) break;
  }

  const telLinks: string[] = [];
  for (const m of noise.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
    const v = decodeURIComponent(m[1]).trim();
    if (v && !telLinks.includes(v)) telLinks.push(v);
  }

  const bodyHtml = noise.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? noise;
  const text = clean(bodyHtml.replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '$&\n').replace(/<br\s*\/?>/gi, '\n'));
  const lines = decodeEntities(bodyHtml.replace(/<\/(p|div|li|h[1-6]|tr|section|article)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

  const phones = [...telLinks, ...extractPhones(text), ...schemaPhones(schema)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 10);
  const addresses = [...extractAddresses(text), ...schemaAddresses(schema)].filter((v, i, a) => a.indexOf(v) === i).slice(0, 10);
  const hours = extractHoursLines(lines);

  const terms: string[] = [];
  for (const t of [...headings.h1, ...headings.h2, ...headings.h3, ...navLinks.map((l) => l.anchor)]) if (!terms.includes(t)) terms.push(t);

  const headingCount = headings.h1.length + headings.h2.length + headings.h3.length;
  const blocked = detectBotChallenge({ statusCode, textSample: `${title ?? ''} ${text.slice(0, 2000)}`, headingCount, contentChars: text.length });
  const wordCount = text ? text.split(/\s+/).length : 0;

  return {
    url, status_code: statusCode, source: 'direct', blocked, fetch_failed: false, fetched_at: new Date().toISOString(),
    title, meta_description: metaTag ? attr(metaTag, 'content') : null, canonical: canonicalTag ? attr(canonicalTag, 'href') : null,
    headings, phones, addresses, hours_text: hours, schema, nav_links: navLinks, service_terms: terms.slice(0, 80),
    word_count: wordCount, body_text: blocked ? null : text.slice(0, opts.bodyChars),
  };
}
