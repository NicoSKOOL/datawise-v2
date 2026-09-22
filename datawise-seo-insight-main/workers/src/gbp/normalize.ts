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
