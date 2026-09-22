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
    expect(p.categories).toEqual({ primary: 'Plumber', additional: ['Emergency plumber', 'Gas installation service'], category_ids: ['plumber'] });
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
  it('detects removed SERP-metadata keys in raw_keys to catch drift', () => {
    const drift = normalizeGbpProfile({ ...item, se_domain: 'google.com' });
    expect(drift.raw_keys).toContain('se_domain');
  });
  it('tolerates a sparse Maps SERP item', () => {
    const sparse = normalizeGbpProfile({ title: 'X', address: 'Somewhere', rating: { value: 4, votes_count: 3 } });
    expect(sparse.identity.title).toBe('X');
    expect(sparse.categories.category_ids).toEqual([]);
    expect(sparse.hours.timetable.monday).toEqual([]);
    expect(sparse.attributes.available).toEqual([]);
    expect(sparse.services).toEqual([]);
    expect(sparse.reputation.rating).toBe(4);
  });
  it('handles bare-number rating', () => {
    const bareNum = normalizeGbpProfile({ title: 'X', rating: 4.2, reviews_count: 17 });
    expect(bareNum.reputation.rating).toBe(4.2);
    expect(bareNum.reputation.reviews_count).toBe(17);
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
