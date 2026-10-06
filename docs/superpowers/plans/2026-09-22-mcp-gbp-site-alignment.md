# MCP GBP Profile + Site Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two read-only MCP tools, `datawise_gbp_profile` and `datawise_site_pages`, so a member can audit any Google Business Profile and its website from a Maps link and a site URL.

**Architecture:** Pure, unit-tested modules under `workers/src/gbp/` (identify, normalise, reviews summary, posts) and `workers/src/site/` (discover, extract, fetch) do the parsing. Two thin tool files in `workers/src/mcp/tools/` compose them, following the existing `defineTool` / `toolResult` / `compact` pattern. DataForSEO is called through the existing client (`dataforseoRequest`, `dataforseoRequestCached`, `dataforseoGet`) so the MCP meter and KV cache apply unchanged.

**Tech Stack:** Cloudflare Worker (TypeScript), zod 4, vitest, DataForSEO Business Data + OnPage APIs, existing MCP worker (`workers/src/mcp/`).

**Spec:** `docs/superpowers/specs/2026-09-22-mcp-gbp-site-alignment-design.md`

## Global Constraints

- All paths below are relative to `datawise-seo-insight-main/workers/` unless they start with `docs/` or `../`.
- Run tests with `npx vitest run <file>` from `datawise-seo-insight-main/workers/`. The whole suite is `npm test`.
- Tools are appended to `ALL_TOOLS` as positions 15 and 16. Never reorder the first 14.
- Tool names: `datawise_gbp_profile`, `datawise_site_pages`. Every tool is read-only.
- Tests that touch DataForSEO must assert the exact request body sent (spec section 7).
- No em dashes in any copy or comment. Use commas, colons or separate sentences.
- Stage specific files only (`git add <path>`), never `git add .` or `-A`. Never amend.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Page-derived strings are untrusted data. Never interpolate them into prompts or logs as instructions; they are just returned.

---

### Task 1: GBP identifier detection and Maps URL parsing

**Files:**
- Create: `src/gbp/identify.ts`
- Test: `src/gbp/identify.test.ts`

**Interfaces:**
- Produces: `classifyGbpInput(raw: string): GbpInput` where `GbpInput = { kind: 'maps_url'; url: string } | { kind: 'place_id'; placeId: string } | { kind: 'cid'; cid: string } | { kind: 'name'; query: string }`.
- Produces: `parseMapsUrl(url: string, fetchImpl?: typeof fetch): Promise<MapsUrlParts>` with `MapsUrlParts = { cid: string | null; placeId: string | null; businessQuery: string | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/gbp/identify.test.ts
import { describe, it, expect, vi } from 'vitest';
import { classifyGbpInput, parseMapsUrl } from './identify';

describe('classifyGbpInput', () => {
  it('detects maps links in every common shape', () => {
    expect(classifyGbpInput('https://maps.app.goo.gl/AbC123').kind).toBe('maps_url');
    expect(classifyGbpInput('https://goo.gl/maps/AbC123').kind).toBe('maps_url');
    expect(classifyGbpInput('https://www.google.com/maps/place/Acme+Plumbing/@-37.8,144.9,17z/data=!4m6!3m5!1s0x6ad642af0f11fd81:0x5045675218ce6e0!8m2').kind).toBe('maps_url');
    expect(classifyGbpInput('google.com.au/maps/place/Acme').kind).toBe('maps_url');
    expect(classifyGbpInput('https://maps.google.com/?cid=5045675218ce6e0').kind).toBe('maps_url');
  });
  it('detects cid with or without prefix', () => {
    expect(classifyGbpInput('cid:194604053573767737')).toEqual({ kind: 'cid', cid: '194604053573767737' });
    expect(classifyGbpInput(' 194604053573767737 ')).toEqual({ kind: 'cid', cid: '194604053573767737' });
  });
  it('detects place ids', () => {
    expect(classifyGbpInput('ChIJN1t_tDeuEmsRUsoyG83frY4')).toEqual({ kind: 'place_id', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' });
  });
  it('falls back to a name search', () => {
    expect(classifyGbpInput("Joe's Plumbing, Melbourne")).toEqual({ kind: 'name', query: "Joe's Plumbing, Melbourne" });
  });
});

describe('parseMapsUrl', () => {
  it('reads the cid from a long place url data token in the path', async () => {
    const url = 'https://www.google.com/maps/place/Acme+Plumbing/@-37.8,144.9,17z/data=!3m1!4b1!4m6!3m5!1s0x6ad642af0f11fd81:0x5045675218ce6e0!8m2!3d-37.8!4d144.9';
    const parts = await parseMapsUrl(url, vi.fn() as any);
    expect(parts.cid).toBe(BigInt('0x5045675218ce6e0').toString());
    expect(parts.businessQuery).toBe('Acme Plumbing');
    expect(parts.placeId).toBeNull();
  });
  it('reads ftid and cid query params', async () => {
    expect((await parseMapsUrl('https://www.google.com/maps?ftid=0x1:0xabc', vi.fn() as any)).cid).toBe(BigInt('0xabc').toString());
    expect((await parseMapsUrl('https://maps.google.com/?cid=194604053573767737', vi.fn() as any)).cid).toBe('194604053573767737');
  });
  it('reads a place_id query param', async () => {
    const parts = await parseMapsUrl('https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4', vi.fn() as any);
    expect(parts.placeId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
  });
  it('follows short links with the injected fetch', async () => {
    const fetchImpl = vi.fn(async () => ({ url: 'https://www.google.com/maps/place/Acme/data=!1s0x1:0xff' }));
    const parts = await parseMapsUrl('https://maps.app.goo.gl/AbC', fetchImpl as any);
    expect(fetchImpl).toHaveBeenCalledWith('https://maps.app.goo.gl/AbC', { redirect: 'follow' });
    expect(parts.cid).toBe('255');
  });
  it('returns nulls for garbage', async () => {
    expect(await parseMapsUrl('not a url', vi.fn() as any)).toEqual({ cid: null, placeId: null, businessQuery: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/gbp/identify.test.ts`
Expected: FAIL, cannot find module `./identify`.

- [ ] **Step 3: Implement**

```ts
// src/gbp/identify.ts
// Turns whatever a member pastes into something DataForSEO can look up.
// Mirrors the URL parsing in routes/local-seo.ts handleResolveGBPUrl, plus the
// path-form data token (/data=!1s0x...:0x...) that long Maps links carry.

export type GbpInput =
  | { kind: 'maps_url'; url: string }
  | { kind: 'place_id'; placeId: string }
  | { kind: 'cid'; cid: string }
  | { kind: 'name'; query: string };

export interface MapsUrlParts {
  cid: string | null;
  placeId: string | null;
  businessQuery: string | null;
}

const MAPS_HOST = /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;
const SHORT_LINK = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co)\//i;

export function classifyGbpInput(raw: string): GbpInput {
  const s = raw.trim();
  if (MAPS_HOST.test(s)) return { kind: 'maps_url', url: /^https?:\/\//i.test(s) ? s : `https://${s}` };
  const cid = s.match(/^cid:?\s*(\d{10,25})$/i) ?? s.match(/^(\d{10,25})$/);
  if (cid) return { kind: 'cid', cid: cid[1] };
  if (/^ChIJ[A-Za-z0-9_-]{10,}$/.test(s)) return { kind: 'place_id', placeId: s };
  return { kind: 'name', query: s };
}

function hexCid(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(':');
  if (parts.length !== 2 || !/^0x[0-9a-f]+$/i.test(parts[1])) return null;
  try { return BigInt(parts[1]).toString(); } catch { return null; }
}

export async function parseMapsUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<MapsUrlParts> {
  let resolved = url;
  if (SHORT_LINK.test(resolved)) {
    const resp = await fetchImpl(resolved, { redirect: 'follow' });
    resolved = resp.url || resolved;
  }
  let parsed: URL;
  try { parsed = new URL(resolved); } catch { return { cid: null, placeId: null, businessQuery: null }; }

  let cid = hexCid(parsed.searchParams.get('ftid'));
  const cidParam = parsed.searchParams.get('cid');
  if (!cid && cidParam && /^\d{10,25}$/.test(cidParam)) cid = cidParam;
  if (!cid) {
    const haystack = `${parsed.searchParams.get('data') ?? ''} ${decodeURIComponent(parsed.pathname)}`;
    const m = haystack.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    if (m) cid = hexCid(m[1]);
  }

  const pid = parsed.searchParams.get('place_id') ?? parsed.searchParams.get('query_place_id');
  const placeId = pid && /^ChIJ/.test(pid) ? pid : null;

  const path = parsed.pathname.match(/\/maps\/place\/([^/@]+)/);
  const businessQuery = path ? decodeURIComponent(path[1].replace(/\+/g, ' ')) : null;

  return { cid, placeId, businessQuery };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/gbp/identify.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/gbp/identify.ts src/gbp/identify.test.ts
git commit -m "feat(gbp): classify member input and parse Maps links

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Full profile normaliser and country to location map

**Files:**
- Create: `src/gbp/normalize.ts`
- Test: `src/gbp/normalize.test.ts`

**Interfaces:**
- Produces: `normalizeGbpProfile(item: any): GbpProfileFull` (shape below).
- Produces: `locationCodeForCountry(countryCode: string | null | undefined): number | null`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/gbp/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeGbpProfile, locationCodeForCountry } from './normalize';

// Shaped like a real business_data/google/my_business_info/live items[0].
const item = {
  type: 'google_business_info', rank_group: 1, rank_absolute: 1, position: 'left',
  title: 'Acme Plumbing', original_title: 'Acme Plumbing', description: 'Emergency plumbers in Melbourne.',
  category: 'Plumber', category_ids: ['plumber'], additional_categories: ['Emergency plumber', 'Gas installation service'],
  cid: '5045675218', feature_id: '0x1:0x2', address: '1 Main St, Richmond VIC 3121, Australia',
  address_info: { borough: 'Richmond', address: '1 Main St', city: 'Richmond', zip: '3121', region: 'Victoria', country_code: 'AU' },
  place_id: 'ChIJ-acme', phone: '+61 3 9000 0000', url: 'https://acme.com.au/', contact_url: 'https://acme.com.au/contact',
  contributor_url: null, book_online_url: 'https://acme.com.au/book', domain: 'acme.com.au',
  logo: 'https://lh3/logo.png', main_image: 'https://lh3/main.jpg', total_photos: 42, snippet: null,
  latitude: -37.8, longitude: 144.9, is_claimed: true, price_level: null, hotel_rating: null, is_directory_item: false,
  rating: { rating_type: 'Max5', value: 4.6, votes_count: 86, rating_max: 5 },
  rating_distribution: { '1': 2, '2': 1, '3': 3, '4': 10, '5': 70 },
  attributes: {
    available_attributes: { accessibility: ['Wheelchair accessible entrance'], service_options: ['Online estimates', 'Onsite services'] },
    unavailable_attributes: { service_options: ['Language assistance'] },
  },
  place_topics: { 'hot water': 12, 'blocked drain': 7 },
  people_also_search: [{ cid: '999', feature_id: '0x9', title: 'Rival Plumbing', rating: { value: 4.9, votes_count: 410 } }],
  work_time: {
    work_hours: {
      timetable: {
        monday: [{ open: { hour: 7, minute: 30 }, close: { hour: 17, minute: 0 } }],
        sunday: null,
      },
      current_status: 'open',
    },
  },
  popular_times: { popular_times_by_days: { monday: [{ time: { hour: 9, minute: 0 }, popular_index: 40 }] } },
  local_business_links: [{ type: 'menu', title: 'Price list', url: 'https://acme.com.au/prices' }],
  services: [{ category: 'Plumber', title: 'Blocked drain clearing', snippet: 'Same day', price: { displayed_price: 'From $150' } }],
  questions_and_answers_count: 3,
  some_new_field: 'x',
};

describe('normalizeGbpProfile', () => {
  const p = normalizeGbpProfile(item);
  it('maps identity, address and contact', () => {
    expect(p.identity).toEqual({ title: 'Acme Plumbing', place_id: 'ChIJ-acme', cid: '5045675218', feature_id: '0x1:0x2', is_claimed: true, is_directory_item: false });
    expect(p.address).toEqual({ full: '1 Main St, Richmond VIC 3121, Australia', street: '1 Main St', city: 'Richmond', region: 'Victoria', postcode: '3121', country_code: 'AU', borough: 'Richmond', latitude: -37.8, longitude: 144.9 });
    expect(p.contact.phone).toBe('+61 3 9000 0000');
    expect(p.contact.website).toBe('https://acme.com.au/');
    expect(p.contact.book_online_url).toBe('https://acme.com.au/book');
  });
  it('maps categories, description, hours, attributes', () => {
    expect(p.categories).toEqual({ primary: 'Plumber', additional: ['Emergency plumber', 'Gas installation service'] });
    expect(p.description).toEqual({ text: 'Emergency plumbers in Melbourne.', length: 32 });
    expect(p.hours.timetable.monday).toEqual([{ open: '07:30', close: '17:00' }]);
    expect(p.hours.timetable.sunday).toEqual([]);
    expect(p.hours.days_with_hours).toBe(1);
    expect(p.hours.current_status).toBe('open');
    expect(p.attributes.available).toEqual([
      { group: 'accessibility', name: 'Wheelchair accessible entrance' },
      { group: 'service_options', name: 'Online estimates' },
      { group: 'service_options', name: 'Onsite services' },
    ]);
    expect(p.attributes.unavailable).toEqual([{ group: 'service_options', name: 'Language assistance' }]);
  });
  it('maps media, reputation, services, links and signals', () => {
    expect(p.media).toEqual({ total_photos: 42, logo_url: 'https://lh3/logo.png', main_image_url: 'https://lh3/main.jpg' });
    expect(p.reputation).toEqual({ rating: 4.6, reviews_count: 86, rating_distribution: { '1': 2, '2': 1, '3': 3, '4': 10, '5': 70 }, questions_count: 3 });
    expect(p.services).toEqual([{ category: 'Plumber', title: 'Blocked drain clearing', description: 'Same day', price: 'From $150' }]);
    expect(p.links).toEqual([{ type: 'menu', title: 'Price list', url: 'https://acme.com.au/prices' }]);
    expect(p.signals.place_topics).toEqual([{ topic: 'hot water', count: 12 }, { topic: 'blocked drain', count: 7 }]);
    expect(p.signals.people_also_search).toEqual([{ title: 'Rival Plumbing', rating: 4.9, reviews_count: 410, cid: '999' }]);
    expect(p.signals.price_level).toBeNull();
    expect(p.signals.popular_times).toEqual(item.popular_times);
  });
  it('lists unmapped keys so nothing is silently lost', () => {
    expect(p.raw_keys).toEqual(['some_new_field']);
  });
  it('tolerates a sparse Maps SERP item', () => {
    const sparse = normalizeGbpProfile({ title: 'X', address: 'Somewhere', rating: { value: 4, votes_count: 3 } });
    expect(sparse.identity.title).toBe('X');
    expect(sparse.hours.timetable.monday).toEqual([]);
    expect(sparse.attributes.available).toEqual([]);
    expect(sparse.services).toEqual([]);
    expect(sparse.reputation.rating).toBe(4);
  });
});

describe('locationCodeForCountry', () => {
  it('maps known countries and returns null otherwise', () => {
    expect(locationCodeForCountry('AU')).toBe(2036);
    expect(locationCodeForCountry('us')).toBe(2840);
    expect(locationCodeForCountry('ZZ')).toBeNull();
    expect(locationCodeForCountry(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/gbp/normalize.test.ts`
Expected: FAIL, cannot find module `./normalize`.

- [ ] **Step 3: Implement**

```ts
// src/gbp/normalize.ts
// Every field DataForSEO my_business_info returns, in a stable shape. The
// SPA card keeps its own 16-field projection in routes/local-seo.ts; this is
// the MCP's full view for models that do the auditing themselves.

export interface HoursSlot { open: string; close: string }
export interface GbpProfileFull {
  identity: { title: string; place_id: string | null; cid: string | null; feature_id: string | null; is_claimed: boolean | null; is_directory_item: boolean | null };
  address: { full: string; street: string | null; city: string | null; region: string | null; postcode: string | null; country_code: string | null; borough: string | null; latitude: number | null; longitude: number | null };
  contact: { phone: string | null; website: string | null; domain: string | null; contact_url: string | null; book_online_url: string | null; contributor_url: string | null };
  categories: { primary: string | null; additional: string[] };
  description: { text: string | null; length: number };
  hours: { timetable: Record<string, HoursSlot[]>; days_with_hours: number; current_status: string | null };
  attributes: { available: Array<{ group: string; name: string }>; unavailable: Array<{ group: string; name: string }> };
  media: { total_photos: number | null; logo_url: string | null; main_image_url: string | null };
  reputation: { rating: number | null; reviews_count: number | null; rating_distribution: Record<string, number> | null; questions_count: number | null };
  services: Array<{ category: string | null; title: string; description: string | null; price: string | null }>;
  links: Array<{ type: string | null; title: string | null; url: string }>;
  signals: { price_level: string | null; hotel_rating: number | null; place_topics: Array<{ topic: string; count: number }>; people_also_search: Array<{ title: string; rating: number | null; reviews_count: number | null; cid: string | null }>; popular_times: unknown | null };
  raw_keys: string[];
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const KNOWN_KEYS = new Set([
  'type', 'rank_group', 'rank_absolute', 'position', 'title', 'original_title', 'description', 'category', 'category_ids',
  'additional_categories', 'cid', 'feature_id', 'address', 'address_info', 'place_id', 'phone', 'url', 'contact_url',
  'contributor_url', 'book_online_url', 'domain', 'logo', 'main_image', 'total_photos', 'snippet', 'latitude', 'longitude',
  'is_claimed', 'price_level', 'hotel_rating', 'is_directory_item', 'rating', 'rating_distribution', 'attributes',
  'place_topics', 'people_also_search', 'work_time', 'popular_times', 'local_business_links', 'services',
  'questions_and_answers_count', 'directory', 'check_url', 'xpath', 'se_domain', 'keyword', 'location_code', 'language_code',
]);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const hhmm = (t: any): string | null => (typeof t?.hour === 'number' ? `${String(t.hour).padStart(2, '0')}:${String(t.minute ?? 0).padStart(2, '0')}` : null);

function attributeList(group: any): Array<{ group: string; name: string }> {
  const out: Array<{ group: string; name: string }> = [];
  if (Array.isArray(group)) {
    for (const a of group) if (typeof a === 'string') out.push({ group: 'general', name: a });
    return out;
  }
  if (group && typeof group === 'object') {
    for (const [g, names] of Object.entries(group)) {
      if (!Array.isArray(names)) continue;
      for (const n of names) if (typeof n === 'string') out.push({ group: g, name: n });
    }
  }
  return out;
}

function timetable(work: any): Record<string, HoursSlot[]> {
  const table = work?.work_hours?.timetable ?? work?.timetable ?? {};
  const out: Record<string, HoursSlot[]> = {};
  for (const day of DAYS) {
    const slots = Array.isArray(table?.[day]) ? table[day] : [];
    out[day] = slots
      .map((s: any) => ({ open: hhmm(s?.open), close: hhmm(s?.close) }))
      .filter((s: any): s is HoursSlot => Boolean(s.open && s.close));
  }
  return out;
}

export function normalizeGbpProfile(item: any): GbpProfileFull {
  const it = item && typeof item === 'object' ? item : {};
  const info = it.address_info ?? {};
  const table = timetable(it.work_time);
  const rating = typeof it.rating === 'number' ? { value: it.rating } : (it.rating ?? {});
  const description = str(it.description) ?? str(it.snippet);
  const links = (Array.isArray(it.local_business_links) ? it.local_business_links : [])
    .flatMap((l: any) => (Array.isArray(l?.items) ? l.items : [l]))
    .filter((l: any) => str(l?.url))
    .map((l: any) => ({ type: str(l.type), title: str(l.title), url: l.url as string }));

  return {
    identity: { title: str(it.title) ?? '', place_id: str(it.place_id), cid: str(it.cid), feature_id: str(it.feature_id), is_claimed: bool(it.is_claimed), is_directory_item: bool(it.is_directory_item) },
    address: { full: str(it.address) ?? '', street: str(info.address), city: str(info.city), region: str(info.region), postcode: str(info.zip), country_code: str(info.country_code), borough: str(info.borough), latitude: num(it.latitude), longitude: num(it.longitude) },
    contact: { phone: str(it.phone), website: str(it.url), domain: str(it.domain), contact_url: str(it.contact_url), book_online_url: str(it.book_online_url), contributor_url: str(it.contributor_url) },
    categories: { primary: str(it.category), additional: (Array.isArray(it.additional_categories) ? it.additional_categories : []).filter((c: unknown) => typeof c === 'string') },
    description: { text: description, length: description?.length ?? 0 },
    hours: { timetable: table, days_with_hours: DAYS.filter((d) => table[d].length > 0).length, current_status: str(it.work_time?.work_hours?.current_status) },
    attributes: { available: attributeList(it.attributes?.available_attributes), unavailable: attributeList(it.attributes?.unavailable_attributes) },
    media: { total_photos: num(it.total_photos), logo_url: str(it.logo), main_image_url: str(it.main_image) },
    reputation: { rating: num(rating?.value), reviews_count: num(rating?.votes_count) ?? num(it.reviews_count), rating_distribution: it.rating_distribution && typeof it.rating_distribution === 'object' ? it.rating_distribution : null, questions_count: num(it.questions_and_answers_count) },
    services: (Array.isArray(it.services) ? it.services : [])
      .filter((s: any) => str(s?.title))
      .map((s: any) => ({ category: str(s.category), title: s.title as string, description: str(s.snippet), price: str(s.price?.displayed_price) ?? (num(s.price?.current) !== null ? String(s.price.current) : null) })),
    links,
    signals: {
      price_level: str(it.price_level),
      hotel_rating: num(it.hotel_rating),
      place_topics: it.place_topics && typeof it.place_topics === 'object' && !Array.isArray(it.place_topics)
        ? Object.entries(it.place_topics).filter(([, c]) => typeof c === 'number').map(([topic, count]) => ({ topic, count: count as number }))
        : [],
      people_also_search: (Array.isArray(it.people_also_search) ? it.people_also_search : [])
        .filter((p: any) => str(p?.title))
        .map((p: any) => ({ title: p.title as string, rating: num(p.rating?.value), reviews_count: num(p.rating?.votes_count), cid: str(p.cid) })),
      popular_times: it.popular_times ?? null,
    },
    raw_keys: Object.keys(it).filter((k) => !KNOWN_KEYS.has(k)),
  };
}

// DataForSEO location codes for the countries members audit most. Anything
// else falls back to the account default at the call site.
const COUNTRY_LOCATION: Record<string, number> = {
  US: 2840, GB: 2826, UK: 2826, CA: 2124, AU: 2036, NZ: 2554, IE: 2372, ES: 2724, MX: 2484, DE: 2276, FR: 2250,
  IT: 2380, NL: 2528, PT: 2620, AR: 2032, CL: 2152, CO: 2170, PE: 2604, ZA: 2710, IN: 2356, SG: 2702, AE: 2784,
};

export function locationCodeForCountry(countryCode: string | null | undefined): number | null {
  if (!countryCode) return null;
  return COUNTRY_LOCATION[countryCode.toUpperCase()] ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/gbp/normalize.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/gbp/normalize.ts src/gbp/normalize.test.ts
git commit -m "feat(gbp): normalise the full my_business_info record

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Review sample summary

**Files:**
- Create: `src/gbp/reviews-summary.ts`
- Test: `src/gbp/reviews-summary.test.ts`

**Interfaces:**
- Produces: `ReviewRow = { rating: number | null; text: string; date: string | null; owner_response: string | null; owner_response_date: string | null; author: string }`.
- Produces: `summarizeReviews(rows: ReviewRow[], now?: Date): ReviewSummary` with `ReviewSummary = { fetched: number; reply_rate_pct: number | null; avg_days_to_reply: number | null; unanswered_low_star: number; newest_date: string | null; oldest_date: string | null; service_mentions_hint: string[] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/gbp/reviews-summary.test.ts
import { describe, it, expect } from 'vitest';
import { summarizeReviews, type ReviewRow } from './reviews-summary';

const row = (o: Partial<ReviewRow>): ReviewRow => ({ rating: 5, text: '', date: null, owner_response: null, owner_response_date: null, author: 'A', ...o });

describe('summarizeReviews', () => {
  it('computes reply rate, reply lag, unanswered low stars and date range', () => {
    const s = summarizeReviews([
      row({ rating: 5, text: 'Fixed our hot water system fast. Hot water back same day.', date: '2026-09-01 10:00:00 +00:00', owner_response: 'Thanks', owner_response_date: '2026-09-03 10:00:00 +00:00' }),
      row({ rating: 2, text: 'Blocked drain still blocked after the visit.', date: '2026-08-20 10:00:00 +00:00' }),
      row({ rating: 4, text: 'Great gas heater install, tidy work.', date: '2026-08-01 10:00:00 +00:00', owner_response: 'Cheers', owner_response_date: '2026-08-01 12:00:00 +00:00' }),
    ]);
    expect(s.fetched).toBe(3);
    expect(s.reply_rate_pct).toBe(67);
    expect(s.avg_days_to_reply).toBe(1);
    expect(s.unanswered_low_star).toBe(1);
    expect(s.newest_date).toBe('2026-09-01 10:00:00 +00:00');
    expect(s.oldest_date).toBe('2026-08-01 10:00:00 +00:00');
  });
  it('ranks frequent words of four or more letters, skipping stopwords', () => {
    const s = summarizeReviews([
      row({ text: 'Hot water repair was quick. Water heater works.' }),
      row({ text: 'They fixed the water leak and the heater.' }),
    ]);
    expect(s.service_mentions_hint.slice(0, 2)).toEqual(['water', 'heater']);
    expect(s.service_mentions_hint).not.toContain('they');
    expect(s.service_mentions_hint).not.toContain('was');
  });
  it('handles an empty sample', () => {
    expect(summarizeReviews([])).toEqual({ fetched: 0, reply_rate_pct: null, avg_days_to_reply: null, unanswered_low_star: 0, newest_date: null, oldest_date: null, service_mentions_hint: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/gbp/reviews-summary.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/gbp/reviews-summary.ts
// Cheap, LLM-free numbers over a review sample. The model does the reading;
// this just saves it from counting.

export interface ReviewRow {
  rating: number | null;
  text: string;
  date: string | null;
  owner_response: string | null;
  owner_response_date: string | null;
  author: string;
}

export interface ReviewSummary {
  fetched: number;
  reply_rate_pct: number | null;
  avg_days_to_reply: number | null;
  unanswered_low_star: number;
  newest_date: string | null;
  oldest_date: string | null;
  service_mentions_hint: string[];
}

const STOPWORDS = new Set(['this', 'that', 'with', 'they', 'them', 'their', 'have', 'been', 'were', 'very', 'from', 'would', 'about',
  'great', 'good', 'nice', 'really', 'highly', 'recommend', 'recommended', 'service', 'services', 'thank', 'thanks', 'best', 'will',
  'when', 'what', 'which', 'there', 'here', 'your', 'just', 'also', 'much', 'more', 'than', 'then', 'these', 'those', 'into',
  'over', 'after', 'before', 'again', 'because', 'could', 'should', 'made', 'make', 'came', 'come', 'went', 'time', 'came',
  'friendly', 'professional', 'excellent', 'amazing', 'awesome', 'team', 'guys', 'staff', 'experience', 'definitely', 'always',
  'every', 'everything', 'thing', 'things', 'work', 'done', 'well', 'were', 'even', 'only', 'some', 'most', 'many', 'such', 'both']);

function parseDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function summarizeReviews(rows: ReviewRow[]): ReviewSummary {
  if (rows.length === 0) {
    return { fetched: 0, reply_rate_pct: null, avg_days_to_reply: null, unanswered_low_star: 0, newest_date: null, oldest_date: null, service_mentions_hint: [] };
  }
  const replied = rows.filter((r) => r.owner_response && r.owner_response.trim());
  const lags: number[] = [];
  for (const r of replied) {
    const a = parseDate(r.date), b = parseDate(r.owner_response_date);
    if (a !== null && b !== null && b >= a) lags.push((b - a) / 86_400_000);
  }
  const dated = rows.map((r) => ({ r, t: parseDate(r.date) })).filter((x): x is { r: ReviewRow; t: number } => x.t !== null).sort((x, y) => y.t - x.t);

  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const w of r.text.toLowerCase().match(/[a-záéíóúñü]{4,}/g) ?? []) {
      if (STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const hint = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15).map(([w]) => w);

  return {
    fetched: rows.length,
    reply_rate_pct: Math.round((replied.length / rows.length) * 100),
    avg_days_to_reply: lags.length ? Math.round(lags.reduce((s, d) => s + d, 0) / lags.length) : null,
    unanswered_low_star: rows.filter((r) => (r.rating ?? 5) <= 3 && !(r.owner_response && r.owner_response.trim())).length,
    newest_date: dated[0]?.r.date ?? null,
    oldest_date: dated.at(-1)?.r.date ?? null,
    service_mentions_hint: hint,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/gbp/reviews-summary.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/gbp/reviews-summary.ts src/gbp/reviews-summary.test.ts
git commit -m "feat(gbp): summarise a review sample without an LLM

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Google posts fetcher (my_business_updates)

**Files:**
- Create: `src/gbp/posts.ts`
- Test: `src/gbp/posts.test.ts`

**Interfaces:**
- Consumes: `dataforseoRequest`, `dataforseoGet` from `../dataforseo/client`, `DataForSeoEnv`.
- Produces: `fetchGbpPosts(env: DataForSeoEnv, opts: { keyword: string; location_code: number; language_code: string; depth?: number; now?: Date; sleep?: (ms: number) => Promise<void> }): Promise<GbpPosts>` with `GbpPosts = { posts_count: number; last_post_date: string | null; days_since_last_post: number | null; posts: Array<{ date: string | null; text: string; url: string | null; image_url: string | null; links: Array<{ title: string | null; url: string }> }> }`.
- Produces: `normalizePosts(items: any[], now: Date): GbpPosts` (pure).

- [ ] **Step 1: Write the failing tests**

```ts
// src/gbp/posts.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dfs = vi.hoisted(() => ({ request: vi.fn(), get: vi.fn() }));
vi.mock('../dataforseo/client', () => ({
  dataforseoRequest: (...a: unknown[]) => dfs.request(...a),
  dataforseoGet: (...a: unknown[]) => dfs.get(...a),
}));

import { fetchGbpPosts, normalizePosts } from './posts';

const kvStore = new Map<string, string>();
const env = {
  KV: { get: async (k: string) => kvStore.get(k) ?? null, put: async (k: string, v: string) => { kvStore.set(k, v); } },
  DATAFORSEO_EMAIL: 'e', DATAFORSEO_PASSWORD: 'p',
} as any;
const now = new Date('2026-09-22T00:00:00Z');
const noSleep = async () => {};

beforeEach(() => { kvStore.clear(); dfs.request.mockReset(); dfs.get.mockReset(); });

describe('normalizePosts', () => {
  it('maps items and computes recency', () => {
    const out = normalizePosts([
      { type: 'google_business_post', post_text: 'Spring special on <b>hot water</b>', snippet: null, url: 'https://acme.com.au/offer', images_url: 'https://lh3/1.jpg', timestamp: '2026-09-15 09:00:00 +00:00', links: [{ type: 'link', title: 'Learn more', url: 'https://acme.com.au/offer' }] },
      { type: 'google_business_post', post_text: 'Older', timestamp: '2026-07-01 09:00:00 +00:00', links: null },
    ], now);
    expect(out.posts_count).toBe(2);
    expect(out.last_post_date).toBe('2026-09-15 09:00:00 +00:00');
    expect(out.days_since_last_post).toBe(7);
    expect(out.posts[0]).toEqual({ date: '2026-09-15 09:00:00 +00:00', text: 'Spring special on hot water', url: 'https://acme.com.au/offer', image_url: 'https://lh3/1.jpg', links: [{ title: 'Learn more', url: 'https://acme.com.au/offer' }] });
    expect(out.posts[1].links).toEqual([]);
  });
  it('handles no posts', () => {
    expect(normalizePosts([], now)).toEqual({ posts_count: 0, last_post_date: null, days_since_last_post: null, posts: [] });
  });
});

describe('fetchGbpPosts', () => {
  it('posts a task with the exact body, polls, normalises and caches', async () => {
    dfs.request.mockResolvedValueOnce({ tasks: [{ id: 'task-1' }] });
    dfs.get
      .mockResolvedValueOnce({ tasks: [{ status_code: 40602 }] })
      .mockResolvedValueOnce({ tasks: [{ status_code: 20000, result: [{ items: [{ type: 'google_business_post', post_text: 'Hi', timestamp: '2026-09-20 00:00:00 +00:00' }] }] }] });
    const out = await fetchGbpPosts(env, { keyword: 'cid:123', location_code: 2036, language_code: 'en', now, sleep: noSleep });
    expect(dfs.request).toHaveBeenCalledWith(env, '/business_data/google/my_business_updates/task_post', [{ keyword: 'cid:123', location_code: 2036, language_code: 'en', depth: 10 }]);
    expect(dfs.get).toHaveBeenLastCalledWith(env, '/business_data/google/my_business_updates/task_get/task-1');
    expect(out.posts_count).toBe(1);
    expect(out.days_since_last_post).toBe(2);
    expect(kvStore.has('gbp-posts:v1:cid:123:10')).toBe(true);

    const again = await fetchGbpPosts(env, { keyword: 'cid:123', location_code: 2036, language_code: 'en', now, sleep: noSleep });
    expect(again.posts_count).toBe(1);
    expect(dfs.request).toHaveBeenCalledTimes(1);
  });
  it('throws a plain error when the task never completes', async () => {
    dfs.request.mockResolvedValueOnce({ tasks: [{ id: 'task-2' }] });
    dfs.get.mockResolvedValue({ tasks: [{ status_code: 40602 }] });
    await expect(fetchGbpPosts(env, { keyword: 'cid:1', location_code: 2840, language_code: 'en', now, sleep: noSleep })).rejects.toThrow('Google posts task timed out');
  });
  it('throws when no task id comes back', async () => {
    dfs.request.mockResolvedValueOnce({ tasks: [] });
    await expect(fetchGbpPosts(env, { keyword: 'cid:1', location_code: 2840, language_code: 'en', now, sleep: noSleep })).rejects.toThrow('Failed to create Google posts task');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/gbp/posts.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/gbp/posts.ts
// Google Business posts via DataForSEO my_business_updates. Async only
// (task_post then task_get), the same flow routes/local-seo.ts uses for
// reviews. Results are cached in KV for a day per business.
import { dataforseoRequest, dataforseoGet, type DataForSeoEnv } from '../dataforseo/client';
import { stripHtml } from '../mcp/shape';

export interface GbpPost { date: string | null; text: string; url: string | null; image_url: string | null; links: Array<{ title: string | null; url: string }> }
export interface GbpPosts { posts_count: number; last_post_date: string | null; days_since_last_post: number | null; posts: GbpPost[] }

const POLL_DELAYS_MS = [2000, 2000, 3000, 3000, 4000];
const TTL_SECONDS = 86400;

export function normalizePosts(items: any[], now: Date): GbpPosts {
  const posts: GbpPost[] = (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it === 'object')
    .map((it) => ({
      date: typeof it.timestamp === 'string' ? it.timestamp : (typeof it.post_date === 'string' ? it.post_date : null),
      text: stripHtml([it.post_text, it.snippet].filter((t) => typeof t === 'string' && t.trim()).join(' ')),
      url: typeof it.url === 'string' ? it.url : null,
      image_url: typeof it.images_url === 'string' ? it.images_url : null,
      links: (Array.isArray(it.links) ? it.links : []).filter((l: any) => typeof l?.url === 'string').map((l: any) => ({ title: typeof l.title === 'string' ? l.title : null, url: l.url })),
    }));
  const dated = posts.map((p) => (p.date ? Date.parse(p.date) : NaN)).filter((t) => Number.isFinite(t));
  const last = dated.length ? Math.max(...dated) : null;
  const lastPost = last !== null ? posts.find((p) => p.date && Date.parse(p.date) === last) ?? null : null;
  return {
    posts_count: posts.length,
    last_post_date: lastPost?.date ?? null,
    days_since_last_post: last !== null ? Math.max(0, Math.round((now.getTime() - last) / 86_400_000)) : null,
    posts,
  };
}

export async function fetchGbpPosts(env: DataForSeoEnv, opts: {
  keyword: string; location_code: number; language_code: string; depth?: number; now?: Date; sleep?: (ms: number) => Promise<void>;
}): Promise<GbpPosts> {
  const depth = opts.depth ?? 10;
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cacheKey = `gbp-posts:v1:${opts.keyword}:${depth}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) return normalizePosts(JSON.parse(cached), now);

  const post = await dataforseoRequest(env, '/business_data/google/my_business_updates/task_post', [{
    keyword: opts.keyword, location_code: opts.location_code, language_code: opts.language_code, depth,
  }]);
  const taskId = post?.tasks?.[0]?.id;
  if (!taskId) throw new Error('Failed to create Google posts task');

  for (const delay of POLL_DELAYS_MS) {
    await sleep(delay);
    const got = await dataforseoGet(env, `/business_data/google/my_business_updates/task_get/${taskId}`);
    const task = got?.tasks?.[0];
    if (task?.status_code === 20000 && Array.isArray(task?.result)) {
      const items = task.result[0]?.items ?? [];
      await env.KV.put(cacheKey, JSON.stringify(items), { expirationTtl: TTL_SECONDS });
      return normalizePosts(items, now);
    }
  }
  throw new Error('Google posts task timed out');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/gbp/posts.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/gbp/posts.ts src/gbp/posts.test.ts
git commit -m "feat(gbp): fetch Google Business posts via my_business_updates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `datawise_gbp_profile` tool, budget line, registry position 15

**Files:**
- Create: `src/mcp/tools/gbp-profile.ts`
- Test: `src/mcp/tools/gbp-profile.test.ts`
- Modify: `src/mcp/budget.ts` (add constants + case)
- Modify: `src/mcp/tools/registry.ts` (append)

**Interfaces:**
- Consumes: `classifyGbpInput`, `parseMapsUrl` (Task 1); `normalizeGbpProfile`, `locationCodeForCountry` (Task 2); `summarizeReviews`, `ReviewRow` (Task 3); `fetchGbpPosts` (Task 4); `pickMyBusinessInfo`, `handleReviews` from `../../routes/local-seo`; `dataforseoRequest`, `dataforseoRequestCached` from `../../dataforseo/client`; `callJson`, `HandlerError`; `defineTool`, `shapeFor`; `toolResult`, `toolError`, `compact`.
- Produces: `gbpProfile: ToolDef` exported from `src/mcp/tools/gbp-profile.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/mcp/tools/gbp-profile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const dfs = vi.hoisted(() => ({ request: vi.fn(), cached: vi.fn(), get: vi.fn() }));
vi.mock('../../dataforseo/client', () => ({
  dataforseoRequest: (...a: unknown[]) => dfs.request(...a),
  dataforseoRequestCached: (...a: unknown[]) => dfs.cached(...a),
  dataforseoGet: (...a: unknown[]) => dfs.get(...a),
}));

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
const reviews = vi.fn(async (_req: Request) => json({
  rating: 4.6, reviews_count: 86, place_id: 'ChIJ-acme', rating_distribution: { '5': 70 },
  reviews: [
    { rating: 5, text: 'Hot water fixed', author: 'A', date: '2026-09-01 10:00:00 +00:00', owner_response: 'Thanks', owner_response_date: '2026-09-02 10:00:00 +00:00' },
    { rating: 2, text: 'Drain still blocked', author: 'B', date: '2026-08-20 10:00:00 +00:00', owner_response: null, owner_response_date: null },
  ],
}));
vi.mock('../../routes/local-seo', async (importActual) => {
  const actual = await importActual<typeof import('../../routes/local-seo')>();
  return { ...actual, handleReviews: (req: Request, env: unknown, uid?: string) => reviews(req) };
});

import { gbpProfile } from './gbp-profile';
import { ALL_TOOLS } from './registry';
import { estimateCostUsd } from '../budget';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

const businessItem = {
  title: 'Acme Plumbing', place_id: 'ChIJ-acme', cid: '123', category: 'Plumber', additional_categories: ['Emergency plumber'],
  address: '1 Main St, Richmond VIC 3121, Australia', address_info: { address: '1 Main St', city: 'Richmond', zip: '3121', region: 'Victoria', country_code: 'AU' },
  phone: '+61 3 9000 0000', url: 'https://acme.com.au/', rating: { value: 4.6, votes_count: 86 }, is_claimed: true, total_photos: 42,
  work_time: { work_hours: { timetable: { monday: [{ open: { hour: 8, minute: 0 }, close: { hour: 17, minute: 0 } }] } } },
  services: [{ category: 'Plumber', title: 'Blocked drains', snippet: null, price: null }],
};
const infoResponse = { tasks: [{ result: [{ keyword: 'cid:123', items: [businessItem] }] }] };

beforeEach(() => {
  dfs.request.mockReset(); dfs.cached.mockReset(); dfs.get.mockReset(); reviews.mockClear();
  dfs.cached.mockResolvedValue(infoResponse);
  dfs.request.mockImplementation(async (_env: unknown, endpoint: string) => {
    if (endpoint.endsWith('my_business_updates/task_post')) return { tasks: [{ id: 'pt' }] };
    return {};
  });
  dfs.get.mockResolvedValue({ tasks: [{ status_code: 20000, result: [{ items: [{ type: 'google_business_post', post_text: 'Offer', timestamp: '2026-09-20 00:00:00 +00:00' }] }] }] });
});

describe('datawise_gbp_profile', () => {
  it('resolves a cid, fetches the profile with the exact body, infers AU for reviews and posts', async () => {
    const { env } = makeMcpTestEnv();
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'cid:123' }), { env, identity });
    const s = out.structuredContent as any;
    expect(out.isError).toBeFalsy();
    expect(s.resolved_from).toBe('cid');
    expect(dfs.cached).toHaveBeenCalledWith(expect.anything(), '/business_data/google/my_business_info/live', [{ keyword: 'cid:123', location_code: 2840, language_code: 'en' }], { ttlSeconds: 86400 });
    expect(s.profile.identity.title).toBe('Acme Plumbing');
    expect(s.profile.services[0].title).toBe('Blocked drains');
    expect(s.inferred_location_code).toBe(2036);
    // Reviews go through the app handler with the same body the SPA sends.
    const sent = await reviews.mock.calls[0][0].clone().json();
    expect(sent).toEqual({ cid: '123', depth: 20, sort_by: 'newest', location_code: 2036, language_code: 'en' });
    expect(s.reviews.summary.reply_rate_pct).toBe(50);
    expect(s.reviews.items).toHaveLength(2);
    expect(dfs.request).toHaveBeenCalledWith(expect.anything(), '/business_data/google/my_business_updates/task_post', [{ keyword: 'cid:123', location_code: 2036, language_code: 'en', depth: 10 }]);
    expect(s.posts.posts_count).toBe(1);
    expect(out.content[0].text).toContain('Acme Plumbing');
  });

  it('prefers place_id over cid from a Maps link and skips reviews and posts when asked', async () => {
    const { env } = makeMcpTestEnv();
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4', include_reviews: false, include_posts: false }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.resolved_from).toBe('maps_url');
    expect(dfs.cached.mock.calls[0][2]).toEqual([{ keyword: 'place_id:ChIJN1t_tDeuEmsRUsoyG83frY4', location_code: 2840, language_code: 'en' }]);
    expect(reviews).not.toHaveBeenCalled();
    expect(s.reviews).toBeNull();
    expect(s.posts).toBeNull();
  });

  it('name search: returns candidates when the top hit is not a clear match', async () => {
    const { env } = makeMcpTestEnv();
    dfs.request.mockResolvedValueOnce({ tasks: [{ result: [{ items: [
      { type: 'maps_search', title: 'Acme Roofing', place_id: 'p1', cid: 'c1', address: 'A', category: 'Roofer', rating: { value: 4, votes_count: 5 }, url: 'https://roof.example' },
      { type: 'maps_search', title: 'Acme Plumbing Pty', place_id: 'p2', cid: 'c2', address: 'B', category: 'Plumber', rating: { value: 4.6, votes_count: 86 }, url: 'https://acme.com.au' },
    ] }] }] });
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'Acme Plumbing, Melbourne' }), { env, identity });
    const s = out.structuredContent as any;
    expect(dfs.request).toHaveBeenCalledWith(expect.anything(), '/serp/google/maps/live/advanced', [{ keyword: 'Acme Plumbing, Melbourne', location_code: 2840, language_code: 'en', device: 'desktop', os: 'windows', depth: 10 }]);
    expect(s.profile).toBeNull();
    expect(s.candidates).toHaveLength(2);
    expect(s.candidates[1]).toEqual({ title: 'Acme Plumbing Pty', place_id: 'p2', cid: 'c2', address: 'B', category: 'Plumber', rating: 4.6, reviews_count: 86, website: 'https://acme.com.au' });
    expect(dfs.cached).not.toHaveBeenCalled();
    expect(out.content[0].text).toContain('call again');
  });

  it('name search: uses the top hit when its title contains every word of the name', async () => {
    const { env } = makeMcpTestEnv();
    dfs.request.mockResolvedValueOnce({ tasks: [{ result: [{ items: [
      { type: 'maps_search', title: 'Acme Plumbing Pty Ltd', place_id: 'p2', cid: 'c2' },
      { type: 'maps_search', title: 'Other', place_id: 'p3', cid: 'c3' },
    ] }] }] });
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'acme plumbing, Melbourne', include_reviews: false, include_posts: false }), { env, identity });
    expect((out.structuredContent as any).resolved_from).toBe('name_search');
    expect(dfs.cached.mock.calls[0][2]).toEqual([{ keyword: 'cid:c2', location_code: 2840, language_code: 'en' }]);
  });

  it('keeps the profile when reviews or posts fail', async () => {
    const { env } = makeMcpTestEnv();
    reviews.mockResolvedValueOnce(json({ error: 'Reviews task timed out or returned no data' }, 504));
    dfs.get.mockResolvedValue({ tasks: [{ status_code: 40602 }] });
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.profile.identity.title).toBe('Acme Plumbing');
    expect(s.reviews).toBeNull();
    expect(s.reviews_error).toContain('timed out');
    expect(s.posts).toBeNull();
    expect(s.posts_error).toContain('timed out');
  });

  it('returns a tool error when the business is not found', async () => {
    const { env } = makeMcpTestEnv();
    dfs.cached.mockResolvedValue({ tasks: [{ result: [{ items: [] }] }] });
    const out = await gbpProfile.run(gbpProfile.inputSchema.parse({ gbp: 'cid:999' }), { env, identity });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('cid:999');
  });

  it('is registered at position 15 with a budget line', () => {
    expect(ALL_TOOLS[14].name).toBe('datawise_gbp_profile');
    expect(estimateCostUsd('datawise_gbp_profile', { include_reviews: true, reviews_depth: 20, include_posts: true })).toBeCloseTo(0.0054 + 0.003 + 0.003 + 0.01, 5);
    expect(estimateCostUsd('datawise_gbp_profile', { include_reviews: false, include_posts: false })).toBeCloseTo(0.0054 + 0.003, 5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mcp/tools/gbp-profile.test.ts`
Expected: FAIL, cannot find module `./gbp-profile`.

- [ ] **Step 3: Implement the tool**

```ts
// src/mcp/tools/gbp-profile.ts
import { z } from 'zod';
import { defineTool, shapeFor } from './types';
import { callJson, readJson, HandlerError } from '../call-handler';
import { asWorkerEnv } from '../env';
import { toolResult, toolError, compact, stripHtml } from '../shape';
import { dataforseoRequest, dataforseoRequestCached } from '../../dataforseo/client';
import { pickMyBusinessInfo, handleReviews } from '../../routes/local-seo';
import { classifyGbpInput, parseMapsUrl } from '../../gbp/identify';
import { normalizeGbpProfile, locationCodeForCountry } from '../../gbp/normalize';
import { summarizeReviews, type ReviewRow } from '../../gbp/reviews-summary';
import { fetchGbpPosts } from '../../gbp/posts';

// Any business, not only a member's project. The member pastes a Maps link
// (or a name and city) and the tool works out the rest. Data only: no
// scoring, no fix text. The model on the other end does the audit.

const GBP_INFO_TTL = 86400;
const REVIEW_TEXT_CAP = 600;

interface Candidate { title: string; place_id: string | null; cid: string | null; address: string; category: string | null; rating: number | null; reviews_count: number | null; website: string | null }

function candidateFrom(item: any): Candidate {
  return {
    title: item.title ?? '', place_id: item.place_id ?? null, cid: item.cid ?? null, address: item.address ?? '',
    category: item.category ?? null, rating: item.rating?.value ?? null, reviews_count: item.rating?.votes_count ?? null, website: item.url ?? null,
  };
}

function keywordFor(c: { cid?: string | null; place_id?: string | null }): string | null {
  if (c.place_id) return `place_id:${c.place_id}`;
  if (c.cid) return `cid:${c.cid}`;
  return null;
}

// The top Maps hit is a clear match when its title contains every word of
// the part of the query before the first comma.
function clearMatch(query: string, title: string): boolean {
  const words = query.split(',')[0].toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const t = title.toLowerCase();
  return words.length > 0 && words.every((w) => t.includes(w));
}

export const gbpProfile = defineTool({
  name: 'datawise_gbp_profile',
  description:
    'Use this to get everything Google shows about ANY Google Business Profile, not only the member\'s own projects: name, structured address, phone, website, categories, description, hours by day, attributes (available and unavailable), services list, photo count, rating and star distribution, booking and menu links, place topics, similar businesses, plus a sample of recent reviews with owner replies (reply rate, unanswered low-star count) and recent Google posts. ' +
    'Pass gbp as a Google Maps link, a place_id, a CID, or "business name, city". A name search that is not a clear match returns candidates: pick one and call again with its place_id. ' +
    'Cost is about $0.02 (profile $0.005 cached for a day, reviews $0.0015 per 10, posts $0.01). To compare the profile with the business website, call datawise_site_pages next. For a member\'s tracked Local Pack project use datawise_gbp_audit.',
  inputSchema: z.object({
    gbp: z.string().min(2).max(2048).describe('Google Maps link (google.com/maps/place/..., maps.app.goo.gl/...), place_id (ChIJ...), CID (digits), or "business name, city".'),
    include_reviews: z.boolean().default(true).describe('Include the latest reviews with owner replies. Default true.'),
    reviews_depth: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(20).describe('How many reviews to fetch: 10, 20 or 50.'),
    include_posts: z.boolean().default(true).describe('Include recent Google Business posts. Default true.'),
    response_format: z.enum(['concise', 'detailed']).default('concise').describe('concise trims long lists; detailed returns more items and popular times.'),
  }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const shape = shapeFor(args.response_format);
    const locale = { location_code: ctx.identity.defaultLocationCode, language_code: ctx.identity.defaultLanguageCode };
    const input = classifyGbpInput(args.gbp);

    let keyword: string | null = null;
    let query: string | null = null;
    let resolvedFrom: 'maps_url' | 'place_id' | 'cid' | 'name_search' = input.kind === 'name' ? 'name_search' : input.kind;

    if (input.kind === 'place_id') keyword = `place_id:${input.placeId}`;
    else if (input.kind === 'cid') keyword = `cid:${input.cid}`;
    else if (input.kind === 'maps_url') {
      let parts;
      try { parts = await parseMapsUrl(input.url); } catch (err) { return toolError(`Could not open that Maps link: ${(err as Error).message}`); }
      keyword = keywordFor({ place_id: parts.placeId, cid: parts.cid });
      query = parts.businessQuery;
      if (!keyword && !query) return toolError('Could not read a business from that Maps link. Paste the link from the Share button on the Google Maps listing, or pass "business name, city".');
    } else query = input.query;

    if (!keyword && query) {
      const body = [{ keyword: query, ...locale, device: 'desktop', os: 'windows', depth: 10 }];
      const data = await dataforseoRequest(env, '/serp/google/maps/live/advanced', body);
      const hits: any[] = (data?.tasks?.[0]?.result?.[0]?.items ?? []).filter((i: any) => i?.type === 'maps_search');
      if (hits.length === 0) return toolError(`No Google Maps listing found for "${query}". Try "business name, city" or paste the Maps link.`);
      if (hits.length === 1 || clearMatch(query, hits[0].title ?? '')) {
        keyword = keywordFor({ cid: hits[0].cid, place_id: hits[0].place_id });
      } else {
        const candidates = hits.slice(0, 5).map(candidateFrom);
        return toolResult(
          { resolved_from: resolvedFrom, candidates, profile: null, reviews: null, posts: null },
          `${candidates.length} possible matches for "${query}". Pick the right one and call again with its place_id.`,
        );
      }
      if (!keyword) return toolError(`Google Maps returned a listing for "${query}" without an id. Paste the Maps link instead.`);
    }

    const info = await dataforseoRequestCached(env, '/business_data/google/my_business_info/live', [{ keyword, ...locale }], { ttlSeconds: GBP_INFO_TTL });
    const item = pickMyBusinessInfo(info);
    if (!item?.title) return toolError(`Business not found on Google for ${keyword}. Check the link or id and try again.`);
    const profile = normalizeGbpProfile(item);
    if (args.response_format !== 'detailed') profile.signals.popular_times = null;

    const inferred = locationCodeForCountry(profile.address.country_code) ?? locale.location_code;
    const reviewKey = profile.identity.place_id ? { place_id: profile.identity.place_id } : { cid: profile.identity.cid ?? keyword!.replace(/^cid:/, '') };
    const postsKeyword = keywordFor({ cid: profile.identity.cid, place_id: null }) ?? keyword!;

    const [reviewsRes, postsRes] = await Promise.allSettled([
      args.include_reviews
        ? callJson<any>(ctx.env, ctx.identity.userId, (req, e) => handleReviews(req, e), { ...reviewKey, depth: args.reviews_depth, sort_by: 'newest', location_code: inferred, language_code: locale.language_code })
        : Promise.resolve(null),
      args.include_posts
        ? fetchGbpPosts(env, { keyword: postsKeyword, location_code: inferred, language_code: locale.language_code })
        : Promise.resolve(null),
    ]);

    let reviews: Record<string, unknown> | null = null;
    let reviewsError: string | undefined;
    if (reviewsRes.status === 'fulfilled' && reviewsRes.value) {
      const rows: ReviewRow[] = (reviewsRes.value.reviews ?? []).map((r: any) => ({
        rating: typeof r.rating === 'number' ? r.rating : null,
        text: stripHtml(String(r.text ?? '')).slice(0, REVIEW_TEXT_CAP),
        date: r.date ?? null, owner_response: r.owner_response ?? null, owner_response_date: r.owner_response_date ?? null, author: r.author ?? 'Anonymous',
      }));
      reviews = { summary: summarizeReviews(rows), items: compact(rows, { ...shape, maxString: REVIEW_TEXT_CAP, maxArray: Math.max(shape.maxArray, args.reviews_depth) }) };
    } else if (reviewsRes.status === 'rejected') {
      const e = reviewsRes.reason;
      if (!(e instanceof HandlerError) || e.status >= 500 && e.status !== 504) console.error('gbp_profile reviews failed', e);
      reviewsError = e instanceof Error ? e.message : String(e);
    }

    let posts: Record<string, unknown> | null = null;
    let postsError: string | undefined;
    if (postsRes.status === 'fulfilled' && postsRes.value) posts = compact(postsRes.value, shape) as Record<string, unknown>;
    else if (postsRes.status === 'rejected') postsError = postsRes.reason instanceof Error ? postsRes.reason.message : String(postsRes.reason);

    const out = {
      resolved_from: resolvedFrom,
      profile: compact(profile, { ...shape, maxArray: Math.max(shape.maxArray, 60) }),
      reviews, ...(reviewsError ? { reviews_error: reviewsError } : {}),
      posts, ...(postsError ? { posts_error: postsError } : {}),
      inferred_location_code: inferred,
      language_code: locale.language_code,
      fetched_at: new Date().toISOString(),
    };
    const r = profile.reputation;
    const summary =
      `${profile.identity.title}, ${profile.categories.primary ?? 'no category'}, ` +
      `${r.rating ?? '?'} stars from ${r.reviews_count ?? '?'} reviews, ${profile.attributes.available.length} attributes, ` +
      `${profile.services.length} services, ${profile.hours.days_with_hours} days with hours` +
      (posts ? `, ${(posts as any).posts_count} posts, last ${(posts as any).days_since_last_post ?? '?'} days ago` : '') +
      (reviews ? `, review reply rate ${(reviews as any).summary.reply_rate_pct ?? '?'}%` : '') + '.';
    return toolResult(out, summary);
  },
});
```

Note on `readJson`: imported for type parity with other tools; remove the import if the linter flags it unused.

- [ ] **Step 4: Add the budget line**

In `src/mcp/budget.ts`, next to `const REVIEWS_PER_10 = 0.0015;` add:

```ts
const POSTS_TASK = 0.01;
```

and in `estimateCostUsd` before `default:` add:

```ts
    case 'datawise_gbp_profile': {
      // my_business_info + a possible Maps search, then reviews per 10 and one posts task.
      const reviews = args.include_reviews === false ? 0 : REVIEWS_PER_10 * (num(args.reviews_depth, 20) / 10);
      const posts = args.include_posts === false ? 0 : POSTS_TASK;
      return GBP_INFO + SERP_TASK + reviews + posts;
    }
```

- [ ] **Step 5: Register at position 15**

In `src/mcp/tools/registry.ts`:

```ts
import { gbpProfile } from './gbp-profile';
// ...
  peopleAlsoAsk,
  gbpAudit,
  // Added 2026-09-22 (spec docs/superpowers/specs/2026-09-22-mcp-gbp-site-alignment-design.md).
  gbpProfile,
];
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/mcp/tools/gbp-profile.test.ts src/mcp/budget.test.ts`
Expected: PASS. If `budget.test.ts` has an "unknown tool" assertion using a made-up name, it still passes; if any test enumerates tool names, update it to include `datawise_gbp_profile`.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools/gbp-profile.ts src/mcp/tools/gbp-profile.test.ts src/mcp/budget.ts src/mcp/tools/registry.ts
git commit -m "feat(mcp): datawise_gbp_profile, full profile of any business

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Site URL discovery and ranking

**Files:**
- Create: `src/site/discover.ts`
- Test: `src/site/discover.test.ts`

**Interfaces:**
- Produces: `siteOrigin(input: string): string | null` ("https://host", never a path).
- Produces: `normalizeSiteUrl(raw: string, host: string): string | null`.
- Produces: `parseRobotsSitemaps(text: string): string[]`, `parseSitemapXml(xml: string): { sitemaps: string[]; urls: string[] }`.
- Produces: `scoreSiteUrl(url: string, anchor: string | null, fromNav: boolean): number`.
- Produces: `rankSiteUrls(candidates: UrlCandidate[], opts: { host: string; explicit: string[]; max: number }): string[]` with `UrlCandidate = { url: string; anchor?: string | null; fromNav?: boolean }`.
- Produces: `discoverSitemapUrls(origin: string, fetchImpl: typeof fetch, opts?: { maxUrls?: number; timeoutMs?: number }): Promise<{ sitemap_found: boolean; urls: string[] }>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/site/discover.test.ts
import { describe, it, expect, vi } from 'vitest';
import { siteOrigin, normalizeSiteUrl, parseRobotsSitemaps, parseSitemapXml, scoreSiteUrl, rankSiteUrls, discoverSitemapUrls } from './discover';

describe('siteOrigin + normalizeSiteUrl', () => {
  it('reduces any url to the origin', () => {
    expect(siteOrigin('acme.com.au/services/drains?x=1')).toBe('https://acme.com.au');
    expect(siteOrigin('http://www.acme.com.au')).toBe('http://www.acme.com.au');
    expect(siteOrigin('not a url at all')).toBeNull();
  });
  it('keeps same-host html pages and drops junk', () => {
    const h = 'acme.com.au';
    expect(normalizeSiteUrl('https://acme.com.au/services/#top', h)).toBe('https://acme.com.au/services');
    expect(normalizeSiteUrl('https://acme.com.au/about?utm_source=x&id=2', h)).toBe('https://acme.com.au/about?id=2');
    expect(normalizeSiteUrl('/contact', h)).toBe('https://acme.com.au/contact');
    expect(normalizeSiteUrl('https://www.acme.com.au/x', h)).toBe('https://www.acme.com.au/x');
    expect(normalizeSiteUrl('https://other.com/x', h)).toBeNull();
    expect(normalizeSiteUrl('https://acme.com.au/brochure.pdf', h)).toBeNull();
    expect(normalizeSiteUrl('https://acme.com.au/wp-json/x', h)).toBeNull();
    expect(normalizeSiteUrl('https://acme.com.au/tag/x', h)).toBeNull();
    expect(normalizeSiteUrl('mailto:a@b.c', h)).toBeNull();
    expect(normalizeSiteUrl('tel:123', h)).toBeNull();
  });
});

describe('robots + sitemap parsing', () => {
  it('reads Sitemap lines', () => {
    expect(parseRobotsSitemaps('User-agent: *\nDisallow:\nSitemap: https://a.com/sitemap.xml\nsitemap: https://a.com/news.xml')).toEqual(['https://a.com/sitemap.xml', 'https://a.com/news.xml']);
  });
  it('reads urlset and sitemapindex', () => {
    expect(parseSitemapXml('<urlset><url><loc>https://a.com/</loc></url><url><loc> https://a.com/x </loc></url></urlset>')).toEqual({ sitemaps: [], urls: ['https://a.com/', 'https://a.com/x'] });
    expect(parseSitemapXml('<sitemapindex><sitemap><loc>https://a.com/page-sitemap.xml</loc></sitemap></sitemapindex>')).toEqual({ sitemaps: ['https://a.com/page-sitemap.xml'], urls: [] });
  });
});

describe('scoring and ranking', () => {
  it('scores by page kind', () => {
    expect(scoreSiteUrl('https://a.com/', null, false)).toBe(100);
    expect(scoreSiteUrl('https://a.com/contact-us', null, false)).toBe(90);
    expect(scoreSiteUrl('https://a.com/about', 'About', false)).toBe(90);
    expect(scoreSiteUrl('https://a.com/services/hot-water', null, false)).toBe(80);
    expect(scoreSiteUrl('https://a.com/x', 'Our Services', false)).toBe(80);
    expect(scoreSiteUrl('https://a.com/service-areas/richmond', null, false)).toBe(70);
    expect(scoreSiteUrl('https://a.com/anything', null, true)).toBe(60);
    expect(scoreSiteUrl('https://a.com/blog/2024/post', null, false)).toBe(5);
    expect(scoreSiteUrl('https://a.com/random', null, false)).toBe(10);
  });
  it('ranks explicit urls first, then by score, deduplicated and capped', () => {
    const out = rankSiteUrls([
      { url: 'https://a.com/random' }, { url: 'https://a.com/services' }, { url: 'https://a.com/' },
      { url: 'https://a.com/services/' }, { url: 'https://a.com/contact', anchor: 'Contact', fromNav: true }, { url: 'https://a.com/blog/post' },
    ], { host: 'a.com', explicit: ['https://a.com/pricing'], max: 4 });
    expect(out).toEqual(['https://a.com/pricing', 'https://a.com/', 'https://a.com/contact', 'https://a.com/services']);
  });
});

describe('discoverSitemapUrls', () => {
  const res = (body: string, ok = true) => ({ ok, status: ok ? 200 : 404, text: async () => body });
  it('reads robots, follows one index level, caps urls', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://a.com/robots.txt') return res('Sitemap: https://a.com/sitemap_index.xml');
      if (url === 'https://a.com/sitemap_index.xml') return res('<sitemapindex><sitemap><loc>https://a.com/page-sitemap.xml</loc></sitemap></sitemapindex>');
      if (url === 'https://a.com/page-sitemap.xml') return res('<urlset><url><loc>https://a.com/</loc></url><url><loc>https://a.com/services</loc></url></urlset>');
      return res('', false);
    });
    const out = await discoverSitemapUrls('https://a.com', fetchImpl as any, { maxUrls: 1 });
    expect(out.sitemap_found).toBe(true);
    expect(out.urls).toEqual(['https://a.com/']);
  });
  it('falls back to /sitemap.xml and reports none when nothing exists', async () => {
    const fetchImpl = vi.fn(async () => res('', false));
    const out = await discoverSitemapUrls('https://a.com', fetchImpl as any);
    expect(fetchImpl.mock.calls.map((c: any[]) => c[0])).toEqual(['https://a.com/robots.txt', 'https://a.com/sitemap.xml', 'https://a.com/sitemap_index.xml']);
    expect(out).toEqual({ sitemap_found: false, urls: [] });
  });
  it('survives a fetch that throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('boom'); });
    expect(await discoverSitemapUrls('https://a.com', fetchImpl as any)).toEqual({ sitemap_found: false, urls: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/site/discover.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/site/discover.ts
// Finds the pages on a business website that matter for a GBP comparison:
// homepage, contact, about, services, locations. Sitemap and robots are
// fetched directly from the Worker (free). Ranking is a pure function.

export interface UrlCandidate { url: string; anchor?: string | null; fromNav?: boolean }

const SKIP_EXT = /\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|json|xml|txt|zip|mp4|mp3|docx?|xlsx?|pptx?)$/i;
const SKIP_PATH = /(^|\/)(wp-json|wp-admin|wp-content|wp-login|feed|tag|tags|category|categories|author|page\/\d+|cart|checkout|my-account|login|search|cdn-cgi)(\/|$)/i;
const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref$)/i;

export function siteOrigin(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname.includes('.')) return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}

function sameSite(hostA: string, hostB: string): boolean {
  const strip = (h: string) => h.toLowerCase().replace(/^www\./, '');
  return strip(hostA) === strip(hostB);
}

export function normalizeSiteUrl(raw: string, host: string): string | null {
  const s = raw.trim();
  if (!s || /^(mailto|tel|javascript|sms|whatsapp):/i.test(s)) return null;
  let u: URL;
  try { u = new URL(s, `https://${host}`); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, host)) return null;
  if (SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) return null;
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  let out = u.toString();
  if (u.pathname !== '/' && u.pathname.endsWith('/') && !u.search) out = out.replace(/\/$/, '');
  return out;
}

export function parseRobotsSitemaps(text: string): string[] {
  return [...text.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1].trim());
}

export function parseSitemapXml(xml: string): { sitemaps: string[]; urls: string[] } {
  const locs = (block: string) => [...block.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  if (/<sitemapindex/i.test(xml)) return { sitemaps: locs(xml), urls: [] };
  return { sitemaps: [], urls: locs(xml) };
}

const CONTACT = /(^|\/|-|_)(contact|contact-us|contactus|about|about-us|aboutus|our-team|team)(\/|-|_|$)/i;
const SERVICE = /(service|services|what-we-do|treatments|repairs|repair|pricing|prices|menu|products|solutions|specialties|practice-areas)/i;
const LOCATION = /(location|locations|areas|service-area|service-areas|areas-we-serve|near-me|suburbs|cities)/i;
const BLOG = /(^|\/)(blog|news|post|posts|article|articles|resources|insights)(\/|$)|\/20\d\d\//i;

export function scoreSiteUrl(url: string, anchor: string | null, fromNav: boolean): number {
  let path = '/';
  try { path = new URL(url).pathname; } catch { /* keep '/' */ }
  const a = (anchor ?? '').toLowerCase();
  if (path === '/' || path === '') return 100;
  if (CONTACT.test(path) || /^(contact|about)( us)?$/.test(a)) return 90;
  if (SERVICE.test(path) || SERVICE.test(a)) return 80;
  if (LOCATION.test(path) || LOCATION.test(a)) return 70;
  if (fromNav) return 60;
  if (BLOG.test(path)) return 5;
  return 10;
}

export function rankSiteUrls(candidates: UrlCandidate[], opts: { host: string; explicit: string[]; max: number }): string[] {
  const chosen: string[] = [];
  const seen = new Set<string>();
  for (const raw of opts.explicit) {
    const u = normalizeSiteUrl(raw, opts.host);
    if (u && !seen.has(u)) { seen.add(u); chosen.push(u); }
  }
  const scored = new Map<string, { score: number; order: number }>();
  candidates.forEach((c, order) => {
    const u = normalizeSiteUrl(c.url, opts.host);
    if (!u || seen.has(u)) return;
    const score = scoreSiteUrl(u, c.anchor ?? null, Boolean(c.fromNav));
    const prev = scored.get(u);
    if (!prev || score > prev.score) scored.set(u, { score, order: prev?.order ?? order });
  });
  const ranked = [...scored.entries()].sort((a, b) => b[1].score - a[1].score || a[1].order - b[1].order).map(([u]) => u);
  for (const u of ranked) { if (chosen.length >= opts.max) break; chosen.push(u); }
  return chosen.slice(0, opts.max);
}

async function fetchText(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; DataWiseBot/1.0; +https://datawiseseo.com)' }, redirect: 'follow' });
    if (!r.ok) return null;
    return await r.text();
  } catch { return null; } finally { clearTimeout(t); }
}

export async function discoverSitemapUrls(origin: string, fetchImpl: typeof fetch, opts: { maxUrls?: number; timeoutMs?: number } = {}): Promise<{ sitemap_found: boolean; urls: string[] }> {
  const maxUrls = opts.maxUrls ?? 500;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const robots = await fetchText(fetchImpl, `${origin}/robots.txt`, timeoutMs);
  const fromRobots = robots ? parseRobotsSitemaps(robots) : [];
  const queue = fromRobots.length ? fromRobots : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];
  const urls: string[] = [];
  let found = false;
  const visited = new Set<string>();
  let followedIndex = 0;
  while (queue.length && urls.length < maxUrls) {
    const sm = queue.shift()!;
    if (visited.has(sm)) continue;
    visited.add(sm);
    const xml = await fetchText(fetchImpl, sm, timeoutMs);
    if (!xml) continue;
    const parsed = parseSitemapXml(xml);
    if (parsed.urls.length || parsed.sitemaps.length) found = true;
    for (const u of parsed.urls) { if (urls.length >= maxUrls) break; urls.push(u); }
    // One level of index only: children of an index are read, their children are not.
    if (parsed.sitemaps.length && followedIndex < 1) { followedIndex++; queue.push(...parsed.sitemaps.slice(0, 20)); }
    if (found && !fromRobots.length && parsed.urls.length) break;
  }
  return { sitemap_found: found, urls };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/site/discover.test.ts`
Expected: PASS, 9 tests. If the ranking test's expected order differs only by `https://a.com/services` vs `https://a.com/services/` dedup, confirm `normalizeSiteUrl` strips the trailing slash (it should) and fix the implementation, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/site/discover.ts src/site/discover.test.ts
git commit -m "feat(site): discover and rank a business website's key pages

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Page facts extraction from HTML

**Files:**
- Create: `src/site/extract.ts`
- Test: `src/site/extract.test.ts`

**Interfaces:**
- Produces: `PageFacts` (shape in code) and `extractPageFacts(html: string, url: string, statusCode: number | null, opts: { bodyChars: number }): PageFacts`.
- Produces: `extractPhones(text: string): string[]`, `extractAddresses(text: string): string[]`, `extractHoursLines(text: string): string[]` (exported for the DataForSEO fallback in Task 8).

- [ ] **Step 1: Write the failing tests**

```ts
// src/site/extract.test.ts
import { describe, it, expect } from 'vitest';
import { extractPageFacts, extractPhones, extractAddresses, extractHoursLines } from './extract';

const html = `<!doctype html><html><head>
<title>Acme Plumbing | Emergency Plumber Richmond</title>
<meta name="description" content="24/7 plumbers in Richmond VIC.">
<link rel="canonical" href="https://acme.com.au/">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Plumber","name":"Acme Plumbing","telephone":"+61 3 9000 0000","address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Richmond","postalCode":"3121"},"openingHoursSpecification":[{"@type":"OpeningHoursSpecification","dayOfWeek":"Monday","opens":"07:30","closes":"17:00"}]},{"@type":"WebSite","name":"x"}]}</script>
<script type="application/ld+json">not json</script>
<style>.x{}</style></head>
<body><header><nav><a href="/services">Services</a><a href="/contact-us">Contact</a><a href="https://facebook.com/acme">FB</a></nav></header>
<main><h1>Emergency &amp; Blocked Drain Plumbers</h1>
<p>Call <a href="tel:+61390000000">03 9000 0000</a> or (03) 9000 0001 today. Visit us at 1 Main St, Richmond VIC 3121.</p>
<h2>Hot Water Repairs</h2><h2>Blocked Drains</h2><h3>Same day service</h3>
<p>Open Monday to Friday 7:30am - 5pm, Saturday 8am to 12pm. Sunday: Closed.</p>
<script>var x = 1;</script></main>
<footer><a href="/about">About us</a></footer></body></html>`;

describe('extractPageFacts', () => {
  const f = extractPageFacts(html, 'https://acme.com.au/', 200, { bodyChars: 3000 });
  it('reads head fields and headings', () => {
    expect(f.url).toBe('https://acme.com.au/');
    expect(f.status_code).toBe(200);
    expect(f.title).toBe('Acme Plumbing | Emergency Plumber Richmond');
    expect(f.meta_description).toBe('24/7 plumbers in Richmond VIC.');
    expect(f.canonical).toBe('https://acme.com.au/');
    expect(f.headings).toEqual({ h1: ['Emergency & Blocked Drain Plumbers'], h2: ['Hot Water Repairs', 'Blocked Drains'], h3: ['Same day service'] });
  });
  it('reads json-ld, keeping only local business types and tolerating bad blocks', () => {
    expect(f.schema).toHaveLength(1);
    expect(f.schema[0]['@type']).toBe('Plumber');
    expect(f.schema[0].address.postalCode).toBe('3121');
  });
  it('finds phones from tel links and text, addresses, hours', () => {
    expect(f.phones).toEqual(['+61390000000', '03 9000 0000', '(03) 9000 0001', '+61 3 9000 0000']);
    expect(f.addresses).toContain('1 Main St, Richmond VIC 3121');
    expect(f.addresses).toContain('1 Main St, Richmond, 3121');
    expect(f.hours_text).toEqual(['Open Monday to Friday 7:30am - 5pm, Saturday 8am to 12pm. Sunday: Closed.']);
  });
  it('collects nav links (same host only), service terms, body text and word count', () => {
    expect(f.nav_links).toEqual([{ anchor: 'Services', url: 'https://acme.com.au/services' }, { anchor: 'Contact', url: 'https://acme.com.au/contact-us' }, { anchor: 'About us', url: 'https://acme.com.au/about' }]);
    expect(f.service_terms).toEqual(['Emergency & Blocked Drain Plumbers', 'Hot Water Repairs', 'Blocked Drains', 'Same day service', 'Services', 'Contact', 'About us']);
    expect(f.body_text).toContain('Call 03 9000 0000');
    expect(f.body_text).not.toContain('var x');
    expect(f.body_text).not.toContain('.x{}');
    expect(f.word_count).toBeGreaterThan(20);
    expect(f.blocked).toBe(false);
    expect(f.source).toBe('direct');
  });
  it('caps body text', () => {
    expect(extractPageFacts(html, 'https://acme.com.au/', 200, { bodyChars: 40 }).body_text!.length).toBeLessThanOrEqual(40);
  });
  it('flags a bot challenge stub', () => {
    const stub = '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing acme.com.au. Ray ID: abc</body></html>';
    const b = extractPageFacts(stub, 'https://acme.com.au/', 503, { bodyChars: 3000 });
    expect(b.blocked).toBe(true);
    expect(b.body_text).toBeNull();
  });
});

describe('helpers', () => {
  it('extractPhones dedupes and rejects short or long digit runs', () => {
    expect(extractPhones('Call 1300 123 456 or 1300 123 456. Ref 12345. Big 123456789012345678')).toEqual(['1300 123 456']);
  });
  it('extractAddresses finds street lines', () => {
    expect(extractAddresses('Find us at Unit 4/12 Smith Road, Cremorne VIC 3121 near the station.')).toEqual(['Unit 4/12 Smith Road, Cremorne VIC 3121']);
  });
  it('extractHoursLines needs a day and a time or closed', () => {
    expect(extractHoursLines('Mon-Fri 9am-5pm. We love Mondays. Sat: Closed')).toEqual(['Mon-Fri 9am-5pm.', 'Sat: Closed']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/site/extract.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/site/extract.ts
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

const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
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

const STREET = '(?:street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|way|court|ct|highway|hwy|place|pl|parade|pde|crescent|cres|terrace|tce|square|sq|circuit|cct|esplanade|close|cl|grove|gr|calle|avenida|carrera)';
const ADDRESS = new RegExp(`(?:(?:unit|suite|ste|shop|level|lvl)\\s*[\\w/-]+[,\\s]+)?\\d{1,6}[a-z]?(?:\\/\\d+)?\\s+[\\w.'-]+(?:\\s+[\\w.'-]+){0,3}\\s+${STREET}\\b\\.?(?:,?\\s+[\\w.'-]+(?:\\s+[\\w.'-]+){0,3})?(?:,?\\s+[A-Z]{2,3})?(?:,?\\s+\\d{4,5}(?:-\\d{4})?)?`, 'gi');
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
export function extractHoursLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/site/extract.test.ts`
Expected: PASS, 9 tests. Expect to iterate on the phone and address regexes against the fixture; adjust the regexes, not the fixture, until the listed expectations hold. If `phones` order differs (tel links first, then text, then schema), fix the concatenation order.

- [ ] **Step 5: Commit**

```bash
git add src/site/extract.ts src/site/extract.test.ts
git commit -m "feat(site): extract NAP, hours, schema and headings from page html

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Page fetcher with DataForSEO fallback and concurrency helper

**Files:**
- Create: `src/site/fetch-page.ts`
- Test: `src/site/fetch-page.test.ts`

**Interfaces:**
- Consumes: `extractPageFacts`, `extractPhones`, `extractAddresses`, `extractHoursLines`, `PageFacts` (Task 7); `dataforseoRequestCached`, `DataForSeoEnv`; `detectBotChallenge`.
- Produces: `fetchSitePage(env: DataForSeoEnv, url: string, opts: { bodyChars: number; fetchImpl?: typeof fetch; timeoutMs?: number; kvTtlSeconds?: number }): Promise<PageFacts>`.
- Produces: `mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/site/fetch-page.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dfs = vi.hoisted(() => ({ cached: vi.fn() }));
vi.mock('../dataforseo/client', () => ({ dataforseoRequestCached: (...a: unknown[]) => dfs.cached(...a) }));

import { fetchSitePage, mapLimit } from './fetch-page';

const kvStore = new Map<string, string>();
const env = { KV: { get: async (k: string) => kvStore.get(k) ?? null, put: async (k: string, v: string) => { kvStore.set(k, v); } }, DATAFORSEO_EMAIL: 'e', DATAFORSEO_PASSWORD: 'p' } as any;
const page = '<html><head><title>Services | Acme</title></head><body><h1>Hot Water</h1><p>Call 03 9000 0000.</p></body></html>';
const res = (body: string, status = 200, type = 'text/html') => ({ ok: status < 400, status, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? type : null) }, text: async () => body });

beforeEach(() => { kvStore.clear(); dfs.cached.mockReset(); });

describe('fetchSitePage', () => {
  it('uses the direct fetch when it works and caches the facts', async () => {
    const fetchImpl = vi.fn(async () => res(page));
    const f = await fetchSitePage(env, 'https://acme.com.au/services', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(f.source).toBe('direct');
    expect(f.title).toBe('Services | Acme');
    expect(f.headings.h1).toEqual(['Hot Water']);
    expect(fetchImpl.mock.calls[0][1].headers['user-agent']).toContain('Mozilla/5.0');
    expect(dfs.cached).not.toHaveBeenCalled();
    expect(kvStore.has('site-page:v1:https://acme.com.au/services')).toBe(true);
    const again = await fetchSitePage(env, 'https://acme.com.au/services', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(again.title).toBe('Services | Acme');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('falls back to DataForSEO content_parsing on 403 and marks the source', async () => {
    const fetchImpl = vi.fn(async () => res('Forbidden', 403));
    dfs.cached.mockResolvedValue({ tasks: [{ result: [{ items: [{ status_code: 200, page_content: {
      header: { primary_content: [{ text: 'Call 03 9000 0000' }] },
      main_topic: [{ h_title: 'Hot Water', level: 1, primary_content: [{ text: 'Open Monday to Friday 9am-5pm.' }] }, { h_title: 'Drains', level: 2, primary_content: [] }],
    } }] }] }] });
    const f = await fetchSitePage(env, 'https://acme.com.au/x', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(dfs.cached).toHaveBeenCalledWith(env, '/on_page/content_parsing/live', [{ url: 'https://acme.com.au/x', enable_javascript: true }], { ttlSeconds: 86400, timeoutMs: 8000 });
    expect(f.source).toBe('dataforseo');
    expect(f.status_code).toBe(200);
    expect(f.headings).toEqual({ h1: ['Hot Water'], h2: ['Drains'], h3: [] });
    expect(f.phones).toEqual(['03 9000 0000']);
    expect(f.hours_text).toEqual(['Open Monday to Friday 9am-5pm.']);
    expect(f.schema).toEqual([]);
    expect(f.body_text).toContain('Hot Water');
    expect(f.blocked).toBe(false);
  });
  it('falls back when the direct fetch trips the bot challenge detector', async () => {
    const fetchImpl = vi.fn(async () => res('<html><title>Just a moment...</title><body>Checking your browser</body></html>', 200));
    dfs.cached.mockResolvedValue({ tasks: [{ result: [{ items: [{ status_code: 200, page_content: { main_topic: [{ h_title: 'Real', level: 1, primary_content: [{ text: 'content' }] }] } }] }] }] });
    const f = await fetchSitePage(env, 'https://acme.com.au/', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(f.source).toBe('dataforseo');
    expect(f.headings.h1).toEqual(['Real']);
  });
  it('reports blocked when both paths fail', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNRESET'); });
    dfs.cached.mockRejectedValue(new Error('dfs down'));
    const f = await fetchSitePage(env, 'https://acme.com.au/', { bodyChars: 3000, fetchImpl: fetchImpl as any });
    expect(f.fetch_failed).toBe(true);
    expect(f.blocked).toBe(true);
    expect(f.body_text).toBeNull();
    expect(kvStore.size).toBe(0);
  });
  it('treats non-html content as failed without calling DataForSEO', async () => {
    const fetchImpl = vi.fn(async () => res('%PDF', 200, 'application/pdf'));
    const f = await fetchSitePage(env, 'https://acme.com.au/file', { bodyChars: 100, fetchImpl: fetchImpl as any });
    expect(f.fetch_failed).toBe(true);
    expect(dfs.cached).not.toHaveBeenCalled();
  });
});

describe('mapLimit', () => {
  it('runs at most `limit` at once and preserves order', async () => {
    let active = 0, peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--; return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/site/fetch-page.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement**

```ts
// src/site/fetch-page.ts
// Direct Worker fetch first (free). DataForSEO content_parsing when the site
// refuses us or serves a bot challenge. Facts are cached per URL for a day.
import { dataforseoRequestCached, type DataForSeoEnv } from '../dataforseo/client';
import { detectBotChallenge } from '../blueprint/domain/bot-challenge';
import { extractPageFacts, extractPhones, extractAddresses, extractHoursLines, type PageFacts } from './extract';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 DataWiseBot/1.0 (+https://datawiseseo.com)';
const CONTENT_PARSING_TTL = 86400;

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function failed(url: string, statusCode: number | null, source: 'direct' | 'dataforseo', blocked: boolean): PageFacts {
  return {
    url, status_code: statusCode, source, blocked, fetch_failed: true, fetched_at: new Date().toISOString(),
    title: null, meta_description: null, canonical: null, headings: { h1: [], h2: [], h3: [] }, phones: [], addresses: [], hours_text: [],
    schema: [], nav_links: [], service_terms: [], word_count: 0, body_text: null,
  };
}

async function fetchDirect(url: string, fetchImpl: typeof fetch, timeoutMs: number, bodyChars: number): Promise<{ facts: PageFacts | null; retryWithDfs: boolean }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'accept-language': 'en' } });
    const type = r.headers.get('content-type') ?? '';
    if (r.ok && type && !/html|xml|text\/plain/i.test(type)) return { facts: failed(url, r.status, 'direct', false), retryWithDfs: false };
    const html = await r.text();
    if (r.status === 403 || r.status === 429 || r.status >= 500) return { facts: null, retryWithDfs: true };
    if (!r.ok) return { facts: failed(url, r.status, 'direct', false), retryWithDfs: false };
    const facts = extractPageFacts(html, url, r.status, { bodyChars });
    if (facts.blocked) return { facts: null, retryWithDfs: true };
    return { facts, retryWithDfs: false };
  } catch {
    return { facts: null, retryWithDfs: true };
  } finally { clearTimeout(t); }
}

function fromContentParsing(url: string, item: any, bodyChars: number): PageFacts {
  const pc = item?.page_content ?? {};
  const topics: any[] = [...(Array.isArray(pc.main_topic) ? pc.main_topic : []), ...(Array.isArray(pc.secondary_topic) ? pc.secondary_topic : [])];
  const headings = { h1: [] as string[], h2: [] as string[], h3: [] as string[] };
  const blocks: string[] = [];
  const texts = (s: any) => (Array.isArray(s?.primary_content) ? s.primary_content : []).map((n: any) => (typeof n?.text === 'string' ? n.text.trim() : '')).filter(Boolean);
  blocks.push(...texts(pc.header));
  for (const t of topics) {
    const title = typeof t?.h_title === 'string' ? t.h_title.trim() : '';
    const level = typeof t?.level === 'number' ? t.level : 1;
    if (title) { if (level <= 1) headings.h1.push(title); else if (level === 2) headings.h2.push(title); else headings.h3.push(title); }
    blocks.push(...texts(t));
  }
  blocks.push(...texts(pc.footer));
  const text = blocks.join('\n');
  const flat = text.replace(/\s+/g, ' ').trim();
  const statusCode = typeof item?.status_code === 'number' ? item.status_code : null;
  const blocked = detectBotChallenge({ statusCode, textSample: flat.slice(0, 2000), headingCount: headings.h1.length + headings.h2.length + headings.h3.length, contentChars: flat.length });
  const terms = [...headings.h1, ...headings.h2, ...headings.h3].filter((v, i, a) => a.indexOf(v) === i);
  return {
    url, status_code: statusCode, source: 'dataforseo', blocked, fetch_failed: false, fetched_at: new Date().toISOString(),
    title: headings.h1[0] ?? null, meta_description: null, canonical: null, headings,
    phones: extractPhones(flat), addresses: extractAddresses(flat), hours_text: extractHoursLines(text),
    schema: [], nav_links: [], service_terms: terms.slice(0, 80), word_count: flat ? flat.split(/\s+/).length : 0,
    body_text: blocked ? null : flat.slice(0, bodyChars),
  };
}

export async function fetchSitePage(env: DataForSeoEnv, url: string, opts: { bodyChars: number; fetchImpl?: typeof fetch; timeoutMs?: number; kvTtlSeconds?: number }): Promise<PageFacts> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const cacheKey = `site-page:v1:${url}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    const facts = JSON.parse(cached) as PageFacts;
    return { ...facts, body_text: facts.body_text ? facts.body_text.slice(0, opts.bodyChars) : facts.body_text };
  }

  const direct = await fetchDirect(url, fetchImpl, timeoutMs, Math.max(opts.bodyChars, 8000));
  let facts = direct.facts;
  if (!facts && direct.retryWithDfs) {
    try {
      const data = await dataforseoRequestCached(env, '/on_page/content_parsing/live', [{ url, enable_javascript: true }], { ttlSeconds: CONTENT_PARSING_TTL, timeoutMs });
      const item = data?.tasks?.[0]?.result?.[0]?.items?.[0];
      facts = item ? fromContentParsing(url, item, Math.max(opts.bodyChars, 8000)) : failed(url, null, 'dataforseo', true);
    } catch {
      facts = failed(url, null, 'dataforseo', true);
    }
  }
  if (!facts) facts = failed(url, null, 'direct', true);

  if (!facts.fetch_failed && !facts.blocked) {
    await env.KV.put(cacheKey, JSON.stringify(facts), { expirationTtl: opts.kvTtlSeconds ?? 86400 });
  }
  return { ...facts, body_text: facts.body_text ? facts.body_text.slice(0, opts.bodyChars) : facts.body_text };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/site/fetch-page.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/site/fetch-page.ts src/site/fetch-page.test.ts
git commit -m "feat(site): fetch page facts directly with DataForSEO fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `datawise_site_pages` tool, budget line, registry position 16

**Files:**
- Create: `src/mcp/tools/site-pages.ts`
- Test: `src/mcp/tools/site-pages.test.ts`
- Modify: `src/mcp/budget.ts` (add case)
- Modify: `src/mcp/tools/registry.ts` (append)

**Interfaces:**
- Consumes: `siteOrigin`, `rankSiteUrls`, `discoverSitemapUrls` (Task 6); `fetchSitePage`, `mapLimit` (Task 8); `PageFacts` (Task 7); `defineTool`, `shapeFor`, `toolResult`, `toolError`, `compact`, `asWorkerEnv`.
- Produces: `sitePages: ToolDef`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/mcp/tools/site-pages.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const mocks = vi.hoisted(() => ({ discover: vi.fn(), fetchPage: vi.fn() }));
vi.mock('../../site/discover', async (importActual) => {
  const actual = await importActual<typeof import('../../site/discover')>();
  return { ...actual, discoverSitemapUrls: (...a: unknown[]) => mocks.discover(...a) };
});
vi.mock('../../site/fetch-page', async (importActual) => {
  const actual = await importActual<typeof import('../../site/fetch-page')>();
  return { ...actual, fetchSitePage: (...a: unknown[]) => mocks.fetchPage(...a) };
});

import { sitePages } from './site-pages';
import { ALL_TOOLS } from './registry';
import { estimateCostUsd } from '../budget';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

const facts = (url: string, extra: Record<string, unknown> = {}) => ({
  url, status_code: 200, source: 'direct', blocked: false, fetch_failed: false, fetched_at: 'now', title: `T ${url}`, meta_description: null, canonical: null,
  headings: { h1: ['H'], h2: [], h3: [] }, phones: ['03 9000 0000'], addresses: ['1 Main St, Richmond VIC 3121'], hours_text: [], schema: [], nav_links: [],
  service_terms: ['H'], word_count: 50, body_text: 'body', ...extra,
});

beforeEach(() => {
  mocks.discover.mockReset(); mocks.fetchPage.mockReset();
  mocks.discover.mockResolvedValue({ sitemap_found: true, urls: ['https://acme.com.au/', 'https://acme.com.au/blog/post', 'https://acme.com.au/services/hot-water', 'https://acme.com.au/random'] });
  mocks.fetchPage.mockImplementation(async (_env: unknown, url: string) => {
    if (url === 'https://acme.com.au') return facts(url, { nav_links: [{ anchor: 'Contact', url: 'https://acme.com.au/contact' }, { anchor: 'Areas', url: 'https://acme.com.au/service-areas' }], schema: [{ '@type': 'Plumber', telephone: '+61390000000', openingHoursSpecification: [{ dayOfWeek: 'Monday', opens: '08:00', closes: '17:00' }] }] });
    if (url === 'https://acme.com.au/random') return facts(url, { blocked: true, body_text: null });
    return facts(url);
  });
});

describe('datawise_site_pages', () => {
  it('discovers, ranks, fetches with the homepage first and rolls up site facts', async () => {
    const { env } = makeMcpTestEnv();
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'acme.com.au/services/hot-water?utm_source=x', max_pages: 5 }), { env, identity });
    const s = out.structuredContent as any;
    expect(out.isError).toBeFalsy();
    expect(mocks.discover).toHaveBeenCalledWith('https://acme.com.au', expect.any(Function), { maxUrls: 500, timeoutMs: 5000 });
    expect(mocks.fetchPage.mock.calls[0][1]).toBe('https://acme.com.au');
    expect(s.site).toEqual({ url: 'https://acme.com.au', host: 'acme.com.au', sitemap_found: true, pages_discovered: 6, pages_returned: 5 });
    expect(s.pages.map((p: any) => p.url)).toEqual(['https://acme.com.au', 'https://acme.com.au/contact', 'https://acme.com.au/services/hot-water', 'https://acme.com.au/service-areas', 'https://acme.com.au/random']);
    expect(s.blocked_urls).toEqual(['https://acme.com.au/random']);
    expect(s.site_facts.phones).toEqual([{ value: '03 9000 0000', pages: 4 }]);
    expect(s.site_facts.addresses).toEqual([{ value: '1 Main St, Richmond VIC 3121', pages: 4 }]);
    expect(s.site_facts.local_business_schema['@type']).toBe('Plumber');
    expect(s.site_facts.hours_from_schema).toEqual([{ dayOfWeek: 'Monday', opens: '08:00', closes: '17:00' }]);
    expect(out.content[0].text).toContain('acme.com.au: 5 pages');
  });
  it('explicit urls come first and count against the cap', async () => {
    const { env } = makeMcpTestEnv();
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'https://acme.com.au', urls: ['https://acme.com.au/pricing'], max_pages: 2 }), { env, identity });
    const s = out.structuredContent as any;
    expect(s.pages.map((p: any) => p.url)).toEqual(['https://acme.com.au', 'https://acme.com.au/pricing']);
  });
  it('rejects a bad url and reports when the homepage and sitemap both fail', async () => {
    const { env } = makeMcpTestEnv();
    expect((await sitePages.run(sitePages.inputSchema.parse({ url: 'nope' }), { env, identity })).isError).toBe(true);
    mocks.discover.mockResolvedValue({ sitemap_found: false, urls: [] });
    mocks.fetchPage.mockResolvedValue(facts('https://acme.com.au', { fetch_failed: true, blocked: true, body_text: null, nav_links: [] }));
    const out = await sitePages.run(sitePages.inputSchema.parse({ url: 'https://acme.com.au' }), { env, identity });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain('could not be fetched');
  });
  it('is registered at position 16 with a budget line', () => {
    expect(ALL_TOOLS[15].name).toBe('datawise_site_pages');
    expect(ALL_TOOLS).toHaveLength(16);
    expect(estimateCostUsd('datawise_site_pages', { max_pages: 15 })).toBeCloseTo(0.03, 5);
    expect(estimateCostUsd('datawise_site_pages', { max_pages: 25, urls: ['a', 'b'] })).toBeCloseTo(0.05, 5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mcp/tools/site-pages.test.ts`
Expected: FAIL, cannot find module `./site-pages`.

- [ ] **Step 3: Implement the tool**

```ts
// src/mcp/tools/site-pages.ts
import { z } from 'zod';
import { defineTool, shapeFor } from './types';
import { asWorkerEnv } from '../env';
import { toolResult, toolError, compact } from '../shape';
import { siteOrigin, rankSiteUrls, discoverSitemapUrls, type UrlCandidate } from '../../site/discover';
import { fetchSitePage, mapLimit } from '../../site/fetch-page';
import type { PageFacts } from '../../site/extract';

// The business website as structured data, so the model can compare it with
// the Google Business Profile: NAP on every page, hours, LocalBusiness
// schema, and which services have a page. Data only, no judgement.

const CONCURRENCY = 5;

function countValues(pages: PageFacts[], pick: (p: PageFacts) => string[]): Array<{ value: string; pages: number }> {
  const counts = new Map<string, number>();
  for (const p of pages) for (const v of new Set(pick(p))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, n]) => ({ value, pages: n }));
}

function firstLocalBusiness(pages: PageFacts[]): Record<string, any> | null {
  for (const p of pages) for (const s of p.schema) {
    const types = Array.isArray(s['@type']) ? s['@type'] : [s['@type']];
    if (types.some((t: unknown) => typeof t === 'string' && !/^(Service|Product|FAQPage|BreadcrumbList|OpeningHoursSpecification|PostalAddress)$/.test(t))) return s;
  }
  return null;
}

export const sitePages = defineTool({
  name: 'datawise_site_pages',
  description:
    'Use this to read a business website as structured data for a Google Business Profile comparison. Give it any URL on the site: it finds the sitemap and navigation, picks the homepage, contact, about, service and location pages (up to max_pages), and returns for each page the title, meta description, headings, phone numbers, postal addresses, opening-hours text, LocalBusiness / Service / FAQ JSON-LD, navigation links, service terms and trimmed body text, plus a site_facts rollup of phones, addresses and schema across pages. Pages behind a bot wall are listed in blocked_urls. ' +
    'Cost is at most $0.002 per page (free when the site can be read directly), and pages are cached for a day. Call datawise_gbp_profile first, then compare: NAP on the profile versus every page, hours versus schema and hours text, categories and services on the profile versus service pages, and services customers mention in reviews versus pages.',
  inputSchema: z.object({
    url: z.string().min(4).max(2048).describe('Any URL on the business website, for example https://acme.com.au or acme.com.au/services.'),
    urls: z.array(z.string().min(4).max(2048)).max(25).default([]).describe('Optional specific pages to include. They are fetched first and count towards max_pages.'),
    max_pages: z.number().int().min(1).max(25).default(15).describe('How many pages to return, 1 to 25. Default 15.'),
    response_format: z.enum(['concise', 'detailed']).default('concise').describe('concise returns about 3,000 characters of body text per page; detailed about 8,000.'),
  }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const shape = shapeFor(args.response_format);
    const bodyChars = args.response_format === 'detailed' ? 8000 : 3000;
    const origin = siteOrigin(args.url);
    if (!origin) return toolError(`"${args.url}" is not a website URL. Pass something like https://acme.com.au.`);
    const host = new URL(origin).hostname;

    const [sitemap, home] = await Promise.all([
      discoverSitemapUrls(origin, fetch, { maxUrls: 500, timeoutMs: 5000 }),
      fetchSitePage(env, origin, { bodyChars, timeoutMs: 8000 }),
    ]);
    if (home.fetch_failed && !sitemap.sitemap_found && sitemap.urls.length === 0) {
      return toolError(`${host} could not be fetched: the homepage did not load and no sitemap was found. Check the URL, or pass specific page urls.`);
    }

    const candidates: UrlCandidate[] = [
      ...home.nav_links.map((l) => ({ url: l.url, anchor: l.anchor, fromNav: true })),
      ...sitemap.urls.map((u) => ({ url: u })),
    ];
    const explicit = [origin, ...args.urls];
    const selected = rankSiteUrls(candidates, { host, explicit, max: args.max_pages });
    const discovered = new Set([origin, ...args.urls, ...candidates.map((c) => c.url)]).size;

    const pages = await mapLimit(selected, CONCURRENCY, async (u) => (u === origin ? home : fetchSitePage(env, u, { bodyChars, timeoutMs: 8000 })));
    const usable = pages.filter((p) => !p.fetch_failed && !p.blocked);
    const blockedUrls = pages.filter((p) => p.blocked).map((p) => p.url);
    const skipped = pages.filter((p) => p.fetch_failed && !p.blocked).length;
    const lb = firstLocalBusiness(usable);

    const out = {
      site: { url: origin, host, sitemap_found: sitemap.sitemap_found, pages_discovered: discovered, pages_returned: pages.length },
      pages: pages.map((p) => compact({ ...p, schema: p.schema.slice(0, 5) }, { ...shape, maxString: Math.max(shape.maxString, bodyChars), maxArray: Math.max(shape.maxArray, 60) })),
      blocked_urls: blockedUrls,
      skipped_urls_count: skipped,
      site_facts: {
        phones: countValues(usable, (p) => p.phones),
        addresses: countValues(usable, (p) => p.addresses),
        local_business_schema: lb,
        hours_from_schema: lb?.openingHoursSpecification ?? lb?.openingHours ?? null,
      },
      fetched_at: new Date().toISOString(),
    };
    const serviceLike = usable.filter((p) => /service|location|area|treatment|repair|pricing|menu/i.test(p.url)).length;
    return toolResult(out, `${host}: ${pages.length} pages (${serviceLike} service/location, ${blockedUrls.length} blocked), ${out.site_facts.phones.length} phone(s), ${out.site_facts.addresses.length} address(es), LocalBusiness schema ${lb ? 'yes' : 'no'}.`);
  },
});
```

- [ ] **Step 4: Budget line and registry**

In `src/mcp/budget.ts` next to `POSTS_TASK` add `const PAGE_FETCH = 0.002;` and before `default:`:

```ts
    case 'datawise_site_pages': {
      // Direct fetches are free; this is the worst case where every page falls back to content_parsing.
      const explicit = Array.isArray(args.urls) ? args.urls.length : 0;
      return PAGE_FETCH * Math.min(25, num(args.max_pages, 15) + explicit);
    }
```

In `src/mcp/tools/registry.ts`:

```ts
import { sitePages } from './site-pages';
// ...
  gbpProfile,
  sitePages,
];
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/mcp/tools/site-pages.test.ts src/mcp/tools/gbp-profile.test.ts`
Expected: PASS. Note the second `estimateCostUsd` assertion: `min(25, 25 + 2) * 0.002 = 0.05`.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/site-pages.ts src/mcp/tools/site-pages.test.ts src/mcp/budget.ts src/mcp/tools/registry.ts
git commit -m "feat(mcp): datawise_site_pages, a business website as structured data

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Registry order guard, Settings copy, full suite, typecheck

**Files:**
- Create: `src/mcp/tools/registry.test.ts`
- Modify: `../src/components/settings/McpAccessCard.tsx:114` (one sentence)
- Modify: `../../DEPLOY.md` only if it lists MCP tools by count (grep first; if it does not, leave it)

- [ ] **Step 1: Write the registry order test**

```ts
// src/mcp/tools/registry.test.ts
import { describe, it, expect } from 'vitest';
import { ALL_TOOLS } from './registry';

// Clients cache tools/list by position and prompt caches key on it. New
// tools are appended; existing positions never move.
describe('MCP tool registry', () => {
  it('keeps the published order', () => {
    expect(ALL_TOOLS.map((t) => t.name)).toEqual([
      'datawise_keyword_research', 'datawise_keyword_metrics', 'datawise_domain_overview', 'datawise_ranked_keywords',
      'datawise_competitors', 'datawise_keyword_gap', 'datawise_backlinks', 'datawise_ai_mentions', 'datawise_rank_tracking',
      'datawise_ai_visibility', 'datawise_local_reviews', 'datawise_search_console', 'datawise_people_also_ask', 'datawise_gbp_audit',
      'datawise_gbp_profile', 'datawise_site_pages',
    ]);
  });
  it('every tool has a description that states cost and a non-empty schema', () => {
    for (const t of ALL_TOOLS) {
      expect(t.description.length).toBeGreaterThan(80);
      expect(Object.keys(t.inputSchema.shape).length).toBeGreaterThan(0);
    }
  });
});
```

Run: `npx vitest run src/mcp/tools/registry.test.ts`
Expected: PASS. If any of the first 14 names differ from the actual registry, fix the test to the actual names (they are the source of truth) and keep the two new names last.

- [ ] **Step 2: Update the Settings card sentence**

In `../src/components/settings/McpAccessCard.tsx` line 114, change the parenthetical list so it reads:

```
(keyword research, People Also Ask, competitors, backlinks, rank tracking, AI visibility, Search Console, Local Pack audits, any Google Business Profile and its website)
```

Keep everything else on that line as is. No other SPA change.

- [ ] **Step 3: Run the whole worker suite and typecheck**

Run from `datawise-seo-insight-main/workers/`:

```bash
npm test
npx tsc --noEmit -p .
```

Expected: all tests pass (previous count plus about 50 new), tsc clean. If `tsc` reports `readJson` unused in `gbp-profile.ts`, remove that import. If `tsc` complains about `import.meta`-free `fetch` typing in `site-pages.ts` (`discoverSitemapUrls(origin, fetch, ...)`), pass `globalThis.fetch`.

Run from `datawise-seo-insight-main/`:

```bash
npx tsc --noEmit
npm test
```

Expected: SPA typecheck and its 49 tests still pass (only a string literal changed).

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/registry.test.ts ../src/components/settings/McpAccessCard.tsx
git commit -m "test(mcp): lock tool order at 16; mention GBP + website tools in Settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Live verification after deploy (controller runs this, not a subagent)

Not code. After the PR merges into `production` and `npm run deploy:mcp` runs from a clean `production` checkout (see DEPLOY.md and memory `project_mcp_server` for the detached-checkout gotcha), verify:

- [ ] **Step 1: tools/list shows 16**

Mint a temporary `dwmcp_` token row in prod D1 (method in memory `project_mcp_server`, 2026-09-11 entry), then:

```bash
curl -s https://mcp.datawiseseo.com/mcp -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"name":"datawise_[a-z_]*"' | wc -l
```

Expected: `16`. Retry once after a minute if it says 14 (propagation).

- [ ] **Step 2: Call both tools on a known business**

```bash
curl -s https://mcp.datawiseseo.com/mcp -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"datawise_gbp_profile","arguments":{"gbp":"<maps link Nico supplies>"}}}' | head -c 3000
curl -s https://mcp.datawiseseo.com/mcp -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"datawise_site_pages","arguments":{"url":"<site url>","max_pages":10}}}' | head -c 3000
```

Expected: profile with `identity.title`, `hours.timetable`, `attributes`, `services`, `reviews.summary`, `posts.posts_count`; site with `pages` and `site_facts.phones`. Check `mcp_calls` rows show `cost_usd` under $0.10 for the pair.

- [ ] **Step 3: Delete the temporary token row**, then hand the member prompt to Nico for the claude.ai test (the prompt is in the final session message).

---

## Self-review

**Spec coverage.** 3.1 to 3.9 (identifier detection, candidates, profile fetch, full shape incl. services and links, reviews, posts, output, cost): Tasks 1 to 5. 4.1 to 4.6 (input, discovery, extraction with direct fetch + content_parsing fallback, output rollup, cost, runtime): Tasks 6 to 9. Section 5 (registry, budget, copy): Tasks 5, 9, 10. Section 6 errors: covered by the error tests in Tasks 5, 8, 9. Section 7 testing: every DataForSEO body asserted exactly (Tasks 4, 5, 8); registry order (Task 10); live verification (Task 11). Section 8 rollout: Task 11 and the final message. The community guide file named in the spec is not on disk any more, so no task edits it; the Settings card sentence carries the announcement.

**Placeholders.** None. Task 11 uses `<maps link Nico supplies>` as a deliberate runtime input, not a plan gap.

**Type consistency.** `PageFacts` fields used in Task 9 (`fetch_failed`, `blocked`, `nav_links`, `schema`, `phones`, `addresses`) match Task 7. `fetchSitePage(env, url, { bodyChars, timeoutMs })` signature matches between Tasks 8 and 9. `rankSiteUrls(candidates, { host, explicit, max })` matches Tasks 6 and 9. `summarizeReviews(rows)` returns `reply_rate_pct` as asserted in Task 5. `fetchGbpPosts(env, { keyword, location_code, language_code })` matches Tasks 4 and 5. Budget constants `POSTS_TASK` and `PAGE_FETCH` are introduced once (Task 5 and Task 9) and used by the cases added in the same tasks.
