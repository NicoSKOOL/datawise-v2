import type { PageType } from '../../contracts/enums';
import { normalizeSlug } from '../slug';

// Deterministic naming for the page plan: logical IDs, slugs, titles, and H1s.
// All pure over their inputs (pageType + service/area/keyword/brand parts): the
// same inputs always yield the same output. No LLM, no cleverness, no clock, no
// randomness. Never emits an em dash (user hard rule); templates separate parts
// with pipes, commas, and the word "in".

// SEO title target. Well under PAGE_PLAN_RULESET_V1.caps.maxTitleChars (120), so
// a generated title never trips the blueprint field-limit validator.
const TITLE_MAX_CHARS = 60;
const H1_MAX_CHARS = 70;

// ---------------------------------------------------------------------------
// Shared string helpers
// ---------------------------------------------------------------------------

// Collapses one input part to a single slug token: reuses normalizeSlug for the
// ascii/lowercase/hyphen rules, then strips the surrounding slashes and joins any
// interior segments with a hyphen so a part is always one token.
// "Emergency Plumbing" -> "emergency-plumbing"; "Austin, TX" -> "austin-tx".
function slugToken(part: string): string {
  return normalizeSlug(part).replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
}

// First non-empty (after trim) of the candidates, or ''.
function firstNonEmpty(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    if (c !== null && c !== undefined && c.trim() !== '') return c.trim();
  }
  return '';
}

// Capitalizes the first letter of each whitespace-separated word. Applied to
// normalized (lowercased) keyword/service/city inputs; business names are used
// verbatim so brand casing (e.g. "DataWise") survives.
function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Caps a title/H1 at `max` chars without cutting a word in half and without
// leaving a trailing separator. Templates aim well under the cap, so this only
// bites on pathologically long inputs.
function capLength(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[\s|,\-]+$/, '').trim();
}

// ---------------------------------------------------------------------------
// Logical IDs
// ---------------------------------------------------------------------------

const LOGICAL_PREFIX: Record<PageType, string> = {
  home: 'home',
  hub: 'hub',
  service: 'svc',
  location: 'loc',
  service_location: 'svcloc',
  resource: 'res',
  comparison: 'cmp',
  company: 'company',
  contact: 'contact',
  faq: 'faq',
};

// Stable, human-readable, collision-free-by-construction logical page id. The
// type prefix plus the slug-tokenized key parts uniquely identify a page:
//   home                             -> "home"
//   hub, "services"                  -> "hub:services"
//   service, "emergency plumbing"    -> "svc:emergency-plumbing"
//   service_location, svc, "Austin"  -> "svcloc:emergency-plumbing:austin"
//   contact                          -> "contact"
// Two pages collide only if they are the same type over the same key parts,
// which is exactly when they are the same page. Same inputs => same id.
export function buildLogicalId(pageType: PageType, ...keyParts: string[]): string {
  if (pageType === 'home') return 'home';
  const prefix = LOGICAL_PREFIX[pageType];
  const tokens = keyParts.map(slugToken).filter(Boolean);
  return tokens.length > 0 ? `${prefix}:${tokens.join(':')}` : prefix;
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

// Default top-level path segment(s) per page type when no explicit parent path
// is supplied. Service pages nest under /services, locations under /locations,
// resources under /resources, comparisons under /compare. Service-location pages
// live at the flatter conversion-facing /{service}/{city}. Hub, home, company,
// contact, and faq carry their own leading segment in `parts`.
const SLUG_PREFIX: Record<PageType, string[]> = {
  home: [],
  hub: [],
  service: ['services'],
  location: ['locations'],
  service_location: [],
  resource: ['resources'],
  comparison: ['compare'],
  company: [],
  contact: [],
  faq: [],
};

function pathSegments(path: string): string[] {
  return normalizeSlug(path).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

// Root-relative URL path (leading + trailing slash) for a page. When
// `parentSlugPath` is given, the candidate hangs off it: parent segments then
// the page's own parts. Otherwise the page's type prefix leads. Examples:
//   buildSlug('home', [])                                   -> "/"
//   buildSlug('service', ['Emergency Plumbing'])            -> "/services/emergency-plumbing/"
//   buildSlug('service_location', ['Emergency Plumbing','Austin TX']) -> "/emergency-plumbing/austin-tx/"
//   buildSlug('location', ['Austin'])                       -> "/locations/austin/"
//   buildSlug('hub', ['Services'])                          -> "/services/"
//   buildSlug('service_location', ['Austin'], '/services/emergency-plumbing/')
//                                                           -> "/services/emergency-plumbing/austin/"
// Deterministic; the engine handles cross-page uniqueness via dedupeSlug.
export function buildSlug(pageType: PageType, parts: string[], parentSlugPath?: string): string {
  const partTokens = parts.map(slugToken).filter(Boolean);
  const baseSegments = parentSlugPath !== undefined
    ? pathSegments(parentSlugPath)
    : SLUG_PREFIX[pageType];
  const segments = [...baseSegments, ...partTokens];
  return segments.length > 0 ? `/${segments.join('/')}/` : '/';
}

// Appends -n before the trailing slash of a slug's last segment.
function suffixSlug(slug: string, n: number): string {
  const withoutTrailing = slug.replace(/\/+$/, '');
  if (withoutTrailing === '') return `/page-${n}/`;
  return `${withoutTrailing}-${n}/`;
}

// Returns a slug not already in `existing`, suffixing -2, -3, ... on the last
// segment until free, and records the chosen slug in `existing` so sequential
// calls stay collision-free. Mutating the set is deliberate: it makes repeated
// calls over a shared registry deterministic (first "/services/plumbing/" wins,
// the next becomes "/services/plumbing-2/"). Same set + same candidate sequence
// => same results.
export function dedupeSlug(existing: Set<string>, candidate: string): string {
  const base = normalizeSlug(candidate);
  if (!existing.has(base)) {
    existing.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const suffixed = suffixSlug(base, n);
    if (!existing.has(suffixed)) {
      existing.add(suffixed);
      return suffixed;
    }
  }
}

// ---------------------------------------------------------------------------
// Titles + H1s
// ---------------------------------------------------------------------------

// Inputs for a page's title/H1. businessName is always required (brand suffix);
// the rest are supplied per page type. Names are the human-readable forms
// (service.name, area.city, cluster label / primary keyword), not slugs.
export interface TitleParts {
  pageType: PageType;
  businessName: string;
  primaryKeyword?: string | null;
  serviceName?: string | null;
  cityName?: string | null;
  category?: string | null;
  hubLabel?: string | null;
}

// Template-based SEO title, capped at TITLE_MAX_CHARS. Predictable per type so a
// user (or the spec) can read the rule off the output. Never uses an em dash.
export function buildTitle(parts: TitleParts): string {
  const brand = parts.businessName.trim();
  const raw = titleFor(parts, brand);
  return capLength(raw, TITLE_MAX_CHARS);
}

// Template-based H1, capped at H1_MAX_CHARS. Mirrors the title but drops the
// brand suffix where an on-page H1 reads better without it.
export function buildH1(parts: TitleParts): string {
  const brand = parts.businessName.trim();
  const raw = h1For(parts, brand);
  return capLength(raw, H1_MAX_CHARS);
}

function titleFor(parts: TitleParts, brand: string): string {
  switch (parts.pageType) {
    case 'home': {
      const category = firstNonEmpty(parts.category);
      return category ? `${brand} | ${titleCase(category)}` : brand;
    }
    case 'hub': {
      const label = titleCase(firstNonEmpty(parts.hubLabel, 'Services'));
      return `${label} | ${brand}`;
    }
    case 'service':
    case 'resource':
    case 'comparison':
    case 'faq': {
      const topic = titleCase(firstNonEmpty(parts.serviceName, parts.primaryKeyword));
      return topic ? `${topic} | ${brand}` : brand;
    }
    case 'service_location': {
      const svc = titleCase(firstNonEmpty(parts.serviceName, parts.primaryKeyword));
      const city = titleCase(firstNonEmpty(parts.cityName));
      return `${svc} in ${city} | ${brand}`;
    }
    case 'location': {
      const base = titleCase(firstNonEmpty(parts.category, parts.serviceName));
      const city = titleCase(firstNonEmpty(parts.cityName));
      return base ? `${base} in ${city} | ${brand}` : `${city} | ${brand}`;
    }
    case 'company': {
      const label = titleCase(firstNonEmpty(parts.hubLabel, 'About'));
      return `${label} ${brand}`;
    }
    case 'contact':
      return `Contact ${brand}`;
  }
}

function h1For(parts: TitleParts, brand: string): string {
  switch (parts.pageType) {
    case 'home':
      return brand;
    case 'hub':
      return titleCase(firstNonEmpty(parts.hubLabel, 'Services'));
    case 'service':
    case 'resource':
    case 'comparison':
    case 'faq':
      return titleCase(firstNonEmpty(parts.serviceName, parts.primaryKeyword)) || brand;
    case 'service_location': {
      const svc = titleCase(firstNonEmpty(parts.serviceName, parts.primaryKeyword));
      const city = titleCase(firstNonEmpty(parts.cityName));
      return `${svc} in ${city}`;
    }
    case 'location': {
      const base = titleCase(firstNonEmpty(parts.category, parts.serviceName));
      const city = titleCase(firstNonEmpty(parts.cityName));
      return base ? `${base} in ${city}` : city;
    }
    case 'company':
      return `${titleCase(firstNonEmpty(parts.hubLabel, 'About'))} ${brand}`;
    case 'contact':
      return `Contact ${brand}`;
  }
}
