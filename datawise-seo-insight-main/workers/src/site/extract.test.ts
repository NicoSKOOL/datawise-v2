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
    expect(extractHoursLines('Mon-Fri 9am-5pm.\nWe love Mondays.\nSat: Closed')).toEqual(['Mon-Fri 9am-5pm.', 'Sat: Closed']);
  });
});
