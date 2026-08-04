import { describe, it, expect } from 'vitest';
import { PAGE_TYPES, type PageType } from '../../contracts/enums';
import { PAGE_PLAN_RULESET_V1 } from './ruleset';
import { buildLogicalId, buildSlug, buildTitle, buildH1, cleanKeywordForNaming, dedupeSlug, type TitleParts } from './titles';

describe('buildLogicalId', () => {
  it('produces stable, prefixed, human-readable ids', () => {
    expect(buildLogicalId('home')).toBe('home');
    expect(buildLogicalId('hub', 'Services')).toBe('hub:services');
    expect(buildLogicalId('service', 'Emergency Plumbing')).toBe('svc:emergency-plumbing');
    expect(buildLogicalId('service_location', 'Emergency Plumbing', 'Austin, TX')).toBe('svcloc:emergency-plumbing:austin-tx');
    expect(buildLogicalId('location', 'Austin')).toBe('loc:austin');
    expect(buildLogicalId('resource', 'How To Unclog A Drain')).toBe('res:how-to-unclog-a-drain');
    expect(buildLogicalId('comparison', 'Copper vs PEX')).toBe('cmp:copper-vs-pex');
    expect(buildLogicalId('company', 'About')).toBe('company:about');
    expect(buildLogicalId('contact')).toBe('contact');
    expect(buildLogicalId('faq', 'Billing')).toBe('faq:billing');
  });

  it('is deterministic and ignores home key parts', () => {
    expect(buildLogicalId('home', 'ignored')).toBe('home');
    expect(buildLogicalId('service', 'Emergency Plumbing')).toBe(buildLogicalId('service', 'emergency   plumbing'));
  });

  it('distinguishes pages that differ only by type or parts (collision-free by construction)', () => {
    expect(buildLogicalId('service', 'plumbing')).not.toBe(buildLogicalId('location', 'plumbing'));
    expect(buildLogicalId('service_location', 'plumbing', 'austin')).not.toBe(buildLogicalId('service_location', 'plumbing', 'dallas'));
  });
});

describe('buildSlug hierarchy convention', () => {
  it('maps each page type to its documented path', () => {
    expect(buildSlug('home', [])).toBe('/');
    expect(buildSlug('hub', ['Services'])).toBe('/services/');
    expect(buildSlug('service', ['Emergency Plumbing'])).toBe('/services/emergency-plumbing/');
    expect(buildSlug('location', ['Austin'])).toBe('/locations/austin/');
    expect(buildSlug('service_location', ['Emergency Plumbing', 'Austin TX'])).toBe('/emergency-plumbing/austin-tx/');
    expect(buildSlug('resource', ['How To Unclog A Drain'])).toBe('/resources/how-to-unclog-a-drain/');
    expect(buildSlug('comparison', ['Copper vs PEX'])).toBe('/compare/copper-vs-pex/');
    expect(buildSlug('company', ['About'])).toBe('/about/');
    expect(buildSlug('contact', ['Contact'])).toBe('/contact/');
    // faq (like company/contact) carries its own leading segment in `parts`.
    expect(buildSlug('faq', ['FAQ', 'Billing'])).toBe('/faq/billing/');
    expect(buildSlug('faq', ['Billing'])).toBe('/billing/');
  });

  it('composes under an explicit parent path when supplied', () => {
    expect(buildSlug('service_location', ['Austin'], '/services/emergency-plumbing/')).toBe('/services/emergency-plumbing/austin/');
    expect(buildSlug('service', ['Drain Cleaning'], '/services/')).toBe('/services/drain-cleaning/');
  });

  it('is deterministic for the same inputs', () => {
    expect(buildSlug('service', ['Emergency Plumbing'])).toBe(buildSlug('service', ['Emergency Plumbing']));
  });
});

describe('dedupeSlug', () => {
  it('returns the candidate when free and records it', () => {
    const seen = new Set<string>();
    expect(dedupeSlug(seen, '/services/plumbing/')).toBe('/services/plumbing/');
    expect(seen.has('/services/plumbing/')).toBe(true);
  });

  it('suffixes -2, -3 on repeated candidates, deterministically', () => {
    const seen = new Set<string>();
    expect(dedupeSlug(seen, '/services/plumbing/')).toBe('/services/plumbing/');
    expect(dedupeSlug(seen, '/services/plumbing/')).toBe('/services/plumbing-2/');
    expect(dedupeSlug(seen, '/services/plumbing/')).toBe('/services/plumbing-3/');
  });

  it('normalizes the candidate before checking for collision', () => {
    const seen = new Set<string>();
    dedupeSlug(seen, '/services/plumbing/');
    expect(dedupeSlug(seen, 'services/plumbing')).toBe('/services/plumbing-2/');
  });

  it('never returns a slug already in the set', () => {
    const seen = new Set<string>(['/a/', '/a-2/']);
    expect(dedupeSlug(seen, '/a/')).toBe('/a-3/');
  });
});

// Every PageType, with inputs that exercise its template branch.
const TITLE_CASES: Array<{ label: string; parts: TitleParts }> = [
  { label: 'home', parts: { pageType: 'home', businessName: 'Acme Plumbing', category: 'plumber' } },
  { label: 'hub', parts: { pageType: 'hub', businessName: 'Acme Plumbing', hubLabel: 'Our Services' } },
  { label: 'service', parts: { pageType: 'service', businessName: 'Acme Plumbing', serviceName: 'Emergency Plumbing' } },
  { label: 'service_location', parts: { pageType: 'service_location', businessName: 'Acme Plumbing', serviceName: 'Emergency Plumbing', cityName: 'Austin' } },
  { label: 'location', parts: { pageType: 'location', businessName: 'Acme Plumbing', category: 'Plumber', cityName: 'Austin' } },
  { label: 'resource', parts: { pageType: 'resource', businessName: 'Acme Plumbing', primaryKeyword: 'how to unclog a drain' } },
  { label: 'comparison', parts: { pageType: 'comparison', businessName: 'Acme Plumbing', primaryKeyword: 'copper vs pex' } },
  { label: 'company', parts: { pageType: 'company', businessName: 'Acme Plumbing', hubLabel: 'About' } },
  { label: 'contact', parts: { pageType: 'contact', businessName: 'Acme Plumbing' } },
  { label: 'faq', parts: { pageType: 'faq', businessName: 'Acme Plumbing', primaryKeyword: 'billing questions' } },
];

describe('buildTitle / buildH1 templates', () => {
  it('covers every PageType in the enum', () => {
    const covered = new Set(TITLE_CASES.map((c) => c.parts.pageType));
    for (const t of PAGE_TYPES) expect(covered.has(t)).toBe(true);
  });

  for (const { label, parts } of TITLE_CASES) {
    it(`produces non-empty title and h1 for ${label}`, () => {
      const title = buildTitle(parts);
      const h1 = buildH1(parts);
      expect(title.length).toBeGreaterThan(0);
      expect(h1.length).toBeGreaterThan(0);
    });
  }

  it('renders representative templates', () => {
    expect(buildTitle({ pageType: 'home', businessName: 'Acme Plumbing', category: 'plumber' })).toBe('Acme Plumbing | Plumber');
    expect(buildTitle({ pageType: 'service', businessName: 'Acme Plumbing', serviceName: 'Emergency Plumbing' })).toBe('Emergency Plumbing | Acme Plumbing');
    expect(buildTitle({ pageType: 'service_location', businessName: 'Acme Plumbing', serviceName: 'Emergency Plumbing', cityName: 'Austin' })).toBe('Emergency Plumbing in Austin | Acme Plumbing');
    expect(buildTitle({ pageType: 'contact', businessName: 'Acme Plumbing' })).toBe('Contact Acme Plumbing');
    expect(buildH1({ pageType: 'service_location', businessName: 'Acme Plumbing', serviceName: 'Emergency Plumbing', cityName: 'Austin' })).toBe('Emergency Plumbing in Austin');
    expect(buildH1({ pageType: 'home', businessName: 'Acme Plumbing', category: 'plumber' })).toBe('Acme Plumbing');
  });

  it('falls back gracefully when optional parts are missing', () => {
    expect(buildTitle({ pageType: 'home', businessName: 'Acme Plumbing' })).toBe('Acme Plumbing');
    expect(buildTitle({ pageType: 'hub', businessName: 'Acme Plumbing' })).toBe('Services | Acme Plumbing');
    expect(buildTitle({ pageType: 'location', businessName: 'Acme Plumbing', cityName: 'Austin' })).toBe('Austin | Acme Plumbing');
    expect(buildTitle({ pageType: 'company', businessName: 'Acme Plumbing' })).toBe('About Acme Plumbing');
  });

  it('caps title at 60 and h1 at 70 chars without a trailing separator', () => {
    const parts: TitleParts = {
      pageType: 'service',
      businessName: 'Acme Plumbing Heating Cooling And Drain Company Of Central Texas',
      serviceName: 'Twenty Four Hour Emergency Plumbing And Drain Cleaning Service',
    };
    const title = buildTitle(parts);
    const h1 = buildH1(parts);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(h1.length).toBeLessThanOrEqual(70);
    expect(title).not.toMatch(/[\s|,\-]$/);
    expect(h1).not.toMatch(/[\s|,\-]$/);
  });

  it('stays under the ruleset hard title cap', () => {
    for (const { parts } of TITLE_CASES) {
      expect(buildTitle(parts).length).toBeLessThanOrEqual(PAGE_PLAN_RULESET_V1.caps.maxTitleChars);
    }
  });

  it('never emits an em dash for any PageType', () => {
    const EM_DASH = String.fromCharCode(0x2014); // no literal em dash in the file
    for (const { parts } of TITLE_CASES) {
      expect(buildTitle(parts)).not.toContain(EM_DASH);
      expect(buildH1(parts)).not.toContain(EM_DASH);
    }
    // Our own separators (| , in) must never be an em dash regardless of input.
    const parts: TitleParts = { pageType: 'service', businessName: 'Acme', serviceName: 'Fast Reliable Plumbing' };
    expect(buildTitle(parts)).not.toContain(EM_DASH);
  });

  it('is deterministic for the same inputs', () => {
    const parts: TitleParts = { pageType: 'service', businessName: 'Acme', serviceName: 'Emergency Plumbing' };
    expect(buildTitle(parts)).toBe(buildTitle(parts));
    expect(buildH1(parts)).toBe(buildH1(parts));
  });
});

describe('cleanKeywordForNaming', () => {
  it('strips proximity query modifiers anywhere in the keyword', () => {
    expect(cleanKeywordForNaming('drain cleaning service near me')).toBe('drain cleaning service');
    expect(cleanKeywordForNaming('plumber near you')).toBe('plumber');
    expect(cleanKeywordForNaming('emergency plumber in my area')).toBe('emergency plumber');
    expect(cleanKeywordForNaming('water heater repair nearby')).toBe('water heater repair');
    expect(cleanKeywordForNaming('electrician close to me')).toBe('electrician');
  });

  it('strips leading search modifiers', () => {
    expect(cleanKeywordForNaming('best drain cleaning service')).toBe('drain cleaning service');
    expect(cleanKeywordForNaming('cheap plumber austin')).toBe('plumber austin');
    expect(cleanKeywordForNaming('top best plumber')).toBe('plumber');
    expect(cleanKeywordForNaming('cheapest water heater repair')).toBe('water heater repair');
  });

  it('strips trailing year tokens', () => {
    expect(cleanKeywordForNaming('best crm software 2026')).toBe('crm software');
  });

  it('does not strip modifier words mid-keyword where they are part of the topic', () => {
    expect(cleanKeywordForNaming('best practices for seo')).toBe('practices for seo');
    expect(cleanKeywordForNaming('drain cleaning')).toBe('drain cleaning');
    expect(cleanKeywordForNaming('how to unclog a drain')).toBe('how to unclog a drain');
  });

  it('falls back to the original keyword when stripping would empty it', () => {
    expect(cleanKeywordForNaming('near me')).toBe('near me');
    expect(cleanKeywordForNaming('best')).toBe('best');
    expect(cleanKeywordForNaming('')).toBe('');
  });

  it('is deterministic', () => {
    expect(cleanKeywordForNaming('best plumber near me')).toBe(cleanKeywordForNaming('best plumber near me'));
  });
});

describe('query-shaped keywords never surface in titles or H1s', () => {
  it('cleans the primaryKeyword fallback in titles', () => {
    expect(buildTitle({ pageType: 'service', businessName: 'Acme Plumbing', primaryKeyword: 'drain cleaning service near me' }))
      .toBe('Drain Cleaning Service | Acme Plumbing');
  });

  it('cleans the primaryKeyword fallback in H1s', () => {
    expect(buildH1({ pageType: 'service', businessName: 'Acme Plumbing', primaryKeyword: 'best drain cleaning near me' }))
      .toBe('Drain Cleaning');
  });

  it('cleans the primaryKeyword fallback on service_location pages', () => {
    expect(buildTitle({ pageType: 'service_location', businessName: 'Acme Plumbing', primaryKeyword: 'drain cleaning near me', cityName: 'Austin' }))
      .toBe('Drain Cleaning in Austin | Acme Plumbing');
  });

  it('leaves explicit service names alone (only keywords are query-shaped)', () => {
    expect(buildTitle({ pageType: 'service', businessName: 'Acme Plumbing', serviceName: 'Emergency Plumbing', primaryKeyword: 'emergency plumber near me' }))
      .toBe('Emergency Plumbing | Acme Plumbing');
  });
});

// Type-level guard: buildLogicalId accepts exactly the PageType union.
const _allTypes: PageType[] = [...PAGE_TYPES];
void _allTypes;
