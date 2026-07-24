import { describe, it, expect } from 'vitest';
import { PAGE_PLAN_RULESET_V1 } from './ruleset';
import { buildPagePlan } from './engine';
import type { PagePlanOptions } from './engine';
import type { PagePlanBriefFacts, PagePlanCluster, PagePlanFacts, PlannedPage } from './types';

const RS = PAGE_PLAN_RULESET_V1;
const BUDGET: PagePlanOptions = { pageBudget: 150 };

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function brief(overrides: Partial<PagePlanBriefFacts> = {}): PagePlanBriefFacts {
  return {
    businessName: 'Acme Plumbing',
    normalizedBusinessName: 'acme plumbing',
    category: 'plumber',
    languageCode: 'en',
    countryIso: 'US',
    services: [],
    serviceAreas: [],
    ...overrides,
  };
}

function svc(id: string, name: string, priority: 'primary' | 'secondary' = 'primary') {
  return { id, name, normalizedName: name.toLowerCase(), priority };
}

function area(id: string, city: string, uniqueProof: string[] = []) {
  return { id, city, region: null, isPrimary: false, uniqueProof };
}

function cluster(overrides: Partial<PagePlanCluster> = {}): PagePlanCluster {
  return {
    clusterId: 'c1',
    label: 'emergency plumbing',
    primaryKeywordId: 'k1',
    primaryKeyword: 'emergency plumbing',
    coreTokens: ['emergency', 'plumbing'],
    intent: 'transactional',
    addressableVolume: 100,
    confidence: 'high',
    serviceId: null,
    serviceAreaId: null,
    hasLocalizedEvidence: false,
    serp: { urls: null },
    competitorPages: [],
    evidenceRefIds: [],
    memberKeywords: [],
    ...overrides,
  };
}

function facts(overrides: Partial<PagePlanFacts> = {}): PagePlanFacts {
  return { brief: brief(), clusters: [], overlay: null, ...overrides };
}

function byType(pages: PlannedPage[], type: string): PlannedPage[] {
  return pages.filter((p) => p.pageType === type);
}
function byLogicalId(pages: PlannedPage[], id: string): PlannedPage | undefined {
  return pages.find((p) => p.logicalId === id);
}

// ---------------------------------------------------------------------------
// Skeleton composition
// ---------------------------------------------------------------------------

describe('skeleton composition', () => {
  it('greenfield minimal (1 service, no areas): home, service, contact, company only', () => {
    const { pages, stats } = buildPagePlan(facts({ brief: brief({ services: [svc('s1', 'Plumbing')] }) }), RS, BUDGET);
    expect(pages.map((p) => p.pageType).sort()).toEqual(['company', 'contact', 'home', 'service']);
    expect(byType(pages, 'hub').length).toBe(0);
    expect(byType(pages, 'location').length).toBe(0);
    expect(stats.skeletonPageCount).toBe(4);
    expect(byLogicalId(pages, 'home')!.slug).toBe('/');
  });

  it('adds a services hub only at the ruleset threshold (>= 3 services)', () => {
    const twoServices = buildPagePlan(
      facts({ brief: brief({ services: [svc('s1', 'A'), svc('s2', 'B')] }) }), RS, BUDGET,
    );
    expect(byType(twoServices.pages, 'hub').length).toBe(0);

    const threeServices = buildPagePlan(
      facts({ brief: brief({ services: [svc('s1', 'A'), svc('s2', 'B'), svc('s3', 'C')] }) }), RS, BUDGET,
    );
    const hub = byLogicalId(threeServices.pages, 'hub:services');
    expect(hub).toBeDefined();
    expect(hub!.slug).toBe('/services/');
    // service pages parent to the hub when it exists.
    for (const s of byType(threeServices.pages, 'service')) expect(s.parentLogicalId).toBe('hub:services');
  });

  it('adds a locations hub only at the ruleset threshold (>= 2 areas), plus one location page per area', () => {
    const oneArea = buildPagePlan(
      facts({ brief: brief({ services: [svc('s1', 'A')], serviceAreas: [area('a1', 'Austin')] }) }), RS, BUDGET,
    );
    expect(byLogicalId(oneArea.pages, 'hub:locations')).toBeUndefined();
    expect(byType(oneArea.pages, 'location').length).toBe(1);

    const twoAreas = buildPagePlan(
      facts({ brief: brief({ services: [svc('s1', 'A')], serviceAreas: [area('a1', 'Austin'), area('a2', 'Dallas')] }) }),
      RS, BUDGET,
    );
    expect(byLogicalId(twoAreas.pages, 'hub:locations')).toBeDefined();
    expect(byType(twoAreas.pages, 'location').length).toBe(2);
    for (const loc of byType(twoAreas.pages, 'location')) expect(loc.parentLogicalId).toBe('hub:locations');
  });

  it('every page parentLogicalId references an existing page (parent wiring always valid)', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({
          services: [svc('s1', 'A'), svc('s2', 'B'), svc('s3', 'C')],
          serviceAreas: [area('a1', 'Austin'), area('a2', 'Dallas')],
        }),
        clusters: [cluster({ clusterId: 'c1', serviceId: 's1', addressableVolume: 500, competitorPages: [] })],
      }),
      RS, BUDGET,
    );
    const ids = new Set(pages.map((p) => p.logicalId));
    const roots = pages.filter((p) => p.parentLogicalId === null);
    expect(roots.map((r) => r.logicalId)).toEqual(['home']);
    for (const p of pages) {
      if (p.parentLogicalId !== null) expect(ids.has(p.parentLogicalId)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Placement matrix
// ---------------------------------------------------------------------------

function competitorDedicated() {
  // titleTokens fully cover coreTokens -> competitor_dedicated_pages fires.
  return [
    { competitorDomain: 'r1.com', hasParsedData: true, titleTokens: ['emergency', 'plumbing'], headingTokens: [] },
    { competitorDomain: 'r2.com', hasParsedData: true, titleTokens: ['emergency', 'plumbing', 'help'], headingTokens: [] },
  ];
}

describe('placement matrix', () => {
  it('>= 2 strong signals mints a dedicated page under the structural parent', () => {
    // transactional + service link (unique_conversion) + volume 100 (sufficient_demand) = 2 signals.
    // Keyword is a distinct topic (does not name the "Plumbing" service), so the
    // pp-v3 service-variant rule does not intercept it: it earns its own page.
    const { pages, placements } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [cluster({ clusterId: 'c1', primaryKeyword: 'water heater install', coreTokens: ['water', 'heater', 'install'], serviceId: 's1', intent: 'transactional', addressableVolume: 100 })],
      }),
      RS, BUDGET,
    );
    const decision = placements.find((p) => p.clusterId === 'c1')!;
    expect(decision.placement).toBe('dedicated_page');
    const page = byLogicalId(pages, decision.targetLogicalId)!;
    expect(page.pageType).toBe('resource');
    // parented under the matching service page.
    expect(page.parentLogicalId).toBe('svc:plumbing');
    expect(page.primaryKeyword).toBe('water heater install');
  });

  it('exactly 1 strong signal folds into the parent as a section', () => {
    // informational, no service: only sufficient_demand fires (1).
    const { placements, pages } = buildPagePlan(
      facts({ clusters: [cluster({ clusterId: 'c1', intent: 'informational', serviceId: null, addressableVolume: 100 })] }),
      RS, BUDGET,
    );
    const decision = placements.find((p) => p.clusterId === 'c1')!;
    expect(decision.placement).toBe('section');
    expect(decision.targetLogicalId).toBe('home');
    const home = byLogicalId(pages, 'home')!;
    expect(home.sections.map((s) => s.clusterId)).toContain('c1');
  });

  it('a below-threshold question-led cluster folds as an FAQ entry', () => {
    const { placements } = buildPagePlan(
      facts({
        clusters: [cluster({
          clusterId: 'c1', label: 'how to fix a leak', primaryKeyword: 'how to fix a leak',
          coreTokens: ['fix', 'leak'], intent: 'informational', serviceId: null, addressableVolume: 10,
        })],
      }),
      RS, BUDGET,
    );
    const decision = placements.find((p) => p.clusterId === 'c1')!;
    expect(decision.placement).toBe('faq');
    expect(decision.targetLogicalId).toBe('home');
  });

  it('a strong comparison cluster becomes a dedicated comparison page', () => {
    const { pages, placements } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [cluster({
          clusterId: 'c1', label: 'copper vs pex', primaryKeyword: 'copper vs pex pipes',
          coreTokens: ['copper', 'pex'], intent: 'commercial', serviceId: 's1',
          addressableVolume: 100, competitorPages: competitorDedicated(),
        })],
      }),
      RS, BUDGET,
    );
    const page = byLogicalId(pages, placements[0].targetLogicalId)!;
    expect(page.pageType).toBe('comparison');
    expect(page.slug.startsWith('/compare/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service-location guardrail
// ---------------------------------------------------------------------------

describe('service-location guardrail', () => {
  const localBrief = brief({
    services: [svc('s1', 'Plumbing')],
    serviceAreas: [area('a1', 'Austin', ['licensed in Travis County', 'local 24/7 crew'])],
  });

  it('mints a service_location page when all conditions hold', () => {
    const { pages, placements, stats } = buildPagePlan(
      facts({
        brief: localBrief,
        clusters: [cluster({
          clusterId: 'c1', label: 'emergency plumbing austin', primaryKeyword: 'emergency plumbing austin',
          intent: 'transactional', serviceId: 's1', serviceAreaId: 'a1',
          hasLocalizedEvidence: true, addressableVolume: 200,
        })],
      }),
      RS, BUDGET,
    );
    const page = byLogicalId(pages, placements[0].targetLogicalId)!;
    expect(placements[0].placement).toBe('dedicated_page');
    expect(page.pageType).toBe('service_location');
    // flat conversion-facing slug /{service}/{city}/, not nested under /services/.
    expect(page.slug).toBe('/plumbing/austin/');
    // parented under the service page in the map hierarchy.
    expect(page.parentLogicalId).toBe('svc:plumbing');
    expect(stats.dedicatedPageCount).toBe(1);
  });

  it('never generates a service x location combination no cluster demanded (no cartesian)', () => {
    // Brief has a service AND an area, but the only cluster links the service alone.
    const { pages } = buildPagePlan(
      facts({
        brief: localBrief,
        clusters: [cluster({ clusterId: 'c1', serviceId: 's1', serviceAreaId: null, intent: 'transactional', addressableVolume: 300 })],
      }),
      RS, BUDGET,
    );
    expect(byType(pages, 'service_location').length).toBe(0);
  });

  it('folds to a section with a doorway warning when unique local proof is missing', () => {
    const { pages, placements, warnings } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')], serviceAreas: [area('a1', 'Austin', [])] }),
        clusters: [cluster({
          clusterId: 'c1', label: 'plumbing austin', primaryKeyword: 'plumbing austin',
          intent: 'transactional', serviceId: 's1', serviceAreaId: 'a1',
          hasLocalizedEvidence: true, addressableVolume: 200,
        })],
      }),
      RS, BUDGET,
    );
    expect(byType(pages, 'service_location').length).toBe(0);
    expect(placements[0].placement).toBe('section');
    expect(placements[0].targetLogicalId).toBe('svc:plumbing');
    expect(warnings.some((w) => w.code === 'doorway_risk')).toBe(true);
  });

  it('folds to a section when the cluster carries both links but too few strong signals', () => {
    // Has proof + area, but informational intent + no demand => only unique_local_proof fires (1 signal).
    const { pages, placements } = buildPagePlan(
      facts({
        brief: localBrief,
        clusters: [cluster({
          clusterId: 'c1', label: 'plumbing tips austin', primaryKeyword: 'plumbing tips austin',
          intent: 'informational', serviceId: 's1', serviceAreaId: 'a1',
          hasLocalizedEvidence: true, addressableVolume: 5,
        })],
      }),
      RS, BUDGET,
    );
    expect(byType(pages, 'service_location').length).toBe(0);
    expect(placements[0].placement).toBe('section');
  });
});

// ---------------------------------------------------------------------------
// Primary-keyword uniqueness + cannibalization
// ---------------------------------------------------------------------------

describe('query-shaped keyword naming', () => {
  it('a dedicated page minted from a "near me" keyword gets a clean name everywhere but keeps the raw keyword as its SEO target', () => {
    const { pages, placements } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [cluster({
          clusterId: 'c1',
          label: 'drain cleaning service near me',
          primaryKeyword: 'drain cleaning service near me',
          coreTokens: ['drain', 'cleaning', 'service'],
          serviceId: 's1',
          intent: 'transactional',
          addressableVolume: 100,
        })],
      }),
      RS, BUDGET,
    );
    const decision = placements.find((p) => p.clusterId === 'c1')!;
    expect(decision.placement).toBe('dedicated_page');
    const page = byLogicalId(pages, decision.targetLogicalId)!;
    expect(page.title).toBe('Drain Cleaning Service | Acme Plumbing');
    expect(page.h1).toBe('Drain Cleaning Service');
    expect(page.slug).not.toContain('near-me');
    expect(page.logicalId).not.toContain('near-me');
    // The raw query remains the page's SEO target.
    expect(page.primaryKeyword).toBe('drain cleaning service near me');
  });
});

describe('primary-keyword uniqueness', () => {
  it('the first page claims a primary keyword; a later cluster with the same keyword folds in with a cannibalization warning', () => {
    // A distinct topic (does not name the "Plumbing" service) so the pp-v3
    // service-variant rule does not fold it: the mechanic under test is the
    // exact-keyword cannibalization guard, not variant folding.
    const shared = { primaryKeyword: 'water heater repair', coreTokens: ['water', 'heater', 'repair'] };
    const { pages, placements, warnings, stats } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', serviceId: 's1', intent: 'transactional', addressableVolume: 500, ...shared }),
          cluster({ clusterId: 'c2', primaryKeywordId: 'k2', serviceId: 's1', intent: 'transactional', addressableVolume: 100, ...shared }),
        ],
      }),
      RS, BUDGET,
    );
    // c1 (higher volume, processed first) keeps the dedicated page.
    const d1 = placements.find((p) => p.clusterId === 'c1')!;
    const d2 = placements.find((p) => p.clusterId === 'c2')!;
    expect(d1.placement).toBe('dedicated_page');
    expect(d2.placement).toBe('section');
    expect(d2.targetLogicalId).toBe(d1.targetLogicalId);
    expect(warnings.some((w) => w.code === 'cannibalization_risk')).toBe(true);
    expect(stats.cannibalizedCount).toBe(1);
    // Only one active page carries that primary keyword.
    const claimants = pages.filter((p) => p.primaryKeyword === 'water heater repair');
    expect(claimants.length).toBe(1);
  });

  it('all slugs and logical ids are unique even when inputs collide', () => {
    const { pages } = buildPagePlan(
      facts({
        // two services with the same display name -> slug collision handled by dedupeSlug.
        brief: brief({ services: [svc('s1', 'Repair'), svc('s2', 'Repair'), svc('s3', 'Repair')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'drain repair', coreTokens: ['drain', 'repair'], serviceId: 's1', intent: 'transactional', addressableVolume: 200, competitorPages: competitorDedicated() }),
          cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'drain repair guide', coreTokens: ['drain', 'repair'], serviceId: 's2', intent: 'commercial', addressableVolume: 200, competitorPages: competitorDedicated() }),
        ],
      }),
      RS, BUDGET,
    );
    const slugs = pages.map((p) => p.slug);
    const logicalIds = pages.map((p) => p.logicalId);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(logicalIds).size).toBe(logicalIds.length);
  });
});

// ---------------------------------------------------------------------------
// Cleaned-name collision folds (pp-v3, spec 3.2)
// ---------------------------------------------------------------------------

describe('cleaned-name collision folds', () => {
  it('a second cluster that cleans to the same name under the same parent folds in (no numeric suffix, cannibalization warning)', () => {
    // Both link the "Plumbing" service (so neither is a service-name variant, and
    // both clear the 2-signal floor via unique_conversion + sufficient_demand and
    // reach the mint path). Different RAW keywords, identical CLEANED name.
    const { pages, placements, warnings } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'drain cleaning', coreTokens: ['drain', 'cleaning'], serviceId: 's1', intent: 'transactional', addressableVolume: 90500 }),
          cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'drain cleaning near me', coreTokens: ['drain', 'cleaning'], serviceId: 's1', intent: 'transactional', addressableVolume: 74000 }),
        ],
      }),
      RS, BUDGET,
    );
    const d1 = placements.find((p) => p.clusterId === 'c1')!;
    const d2 = placements.find((p) => p.clusterId === 'c2')!;
    expect(d1.placement).toBe('dedicated_page');
    expect(d2.placement).toBe('section');
    expect(d2.targetLogicalId).toBe(d1.targetLogicalId);
    // No cluster page carries a numeric -2 suffix anywhere.
    expect(pages.every((p) => !/-2\/?$/.test(p.slug))).toBe(true);
    expect(pages.every((p) => !p.logicalId.endsWith('-2'))).toBe(true);
    expect(warnings.some((w) => w.code === 'cannibalization_risk')).toBe(true);
    // The warning names both raw keywords.
    const w = warnings.find((x) => x.code === 'cannibalization_risk')!;
    expect(w.message).toContain('drain cleaning near me');
    expect(w.message).toContain('drain cleaning');
    // Exactly one page owns the cleaned name under that parent.
    const drainPages = pages.filter((p) => p.slug.includes('drain-cleaning'));
    expect(drainPages.length).toBe(1);
  });

  it('same cleaned name under DIFFERENT parents still mints two separate pages', () => {
    // Distinct raw keywords ("best drain guide" vs "drain guide near me") that both
    // clean to "drain guide", linked to two different services. Same cleaned name,
    // different parents -> the collision key differs -> both mint.
    const { placements } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing'), svc('s2', 'Heating')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'best drain guide', coreTokens: ['drain', 'guide'], serviceId: 's1', intent: 'transactional', addressableVolume: 500 }),
          cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'drain guide near me', coreTokens: ['drain', 'guide'], serviceId: 's2', intent: 'transactional', addressableVolume: 400 }),
        ],
      }),
      RS, BUDGET,
    );
    const d1 = placements.find((p) => p.clusterId === 'c1')!;
    const d2 = placements.find((p) => p.clusterId === 'c2')!;
    expect(d1.placement).toBe('dedicated_page');
    expect(d2.placement).toBe('dedicated_page');
    expect(d1.targetLogicalId).not.toBe(d2.targetLogicalId);
  });
});

// ---------------------------------------------------------------------------
// Service-variant folds (pp-v3, spec 3.3a)
// ---------------------------------------------------------------------------

describe('service-variant folds', () => {
  const epBrief = brief({ services: [svc('s1', 'Emergency Plumbing')] });

  function variantCluster(id: string, keyword: string, volume: number): PagePlanCluster {
    return cluster({
      clusterId: id, primaryKeywordId: `k-${id}`, primaryKeyword: keyword,
      coreTokens: keyword.split(' '), serviceId: 's1', intent: 'transactional', addressableVolume: volume,
    });
  }

  it('clean subset variants fold into the service page as sections, minting no /resources/ page and emitting no adjudication case', () => {
    const { pages, placements, pendingVariantCases } = buildPagePlan(
      facts({
        brief: epBrief,
        clusters: [
          variantCluster('c1', 'emergency plumbing services', 900),
          variantCluster('c2', 'emergency plumbing repair', 800),
          variantCluster('c3', '24 7 emergency plumbing services', 700),
        ],
      }),
      RS, BUDGET,
    );
    for (const id of ['c1', 'c2', 'c3']) {
      const d = placements.find((p) => p.clusterId === id)!;
      expect(d.placement).toBe('section');
      expect(d.targetLogicalId).toBe('svc:emergency-plumbing');
      expect(d.reasons.some((r) => r.toLowerCase().includes('service variant'))).toBe(true);
    }
    // No dedicated resource page minted for any variant.
    expect(byType(pages, 'resource').length).toBe(0);
    expect(pendingVariantCases.length).toBe(0);
    // All three folded onto the service page.
    const svcPage = byLogicalId(pages, 'svc:emergency-plumbing')!;
    expect(svcPage.sections.map((s) => s.clusterId).sort()).toEqual(['c1', 'c2', 'c3']);
  });

  it('a one-extra-token borderline variant folds AND records a variant_fold adjudication case', () => {
    const { placements, pendingVariantCases } = buildPagePlan(
      facts({
        brief: epBrief,
        clusters: [
          variantCluster('c1', 'commercial emergency plumbing service', 500),
          variantCluster('c2', '24 hour emergency plumbing', 400),
        ],
      }),
      RS, BUDGET,
    );
    // Both fold as sections on the service page.
    for (const id of ['c1', 'c2']) {
      expect(placements.find((p) => p.clusterId === id)!.placement).toBe('section');
      expect(placements.find((p) => p.clusterId === id)!.targetLogicalId).toBe('svc:emergency-plumbing');
    }
    // Each surfaces a borderline case with the single offending token.
    expect(pendingVariantCases.map((c) => c.clusterId)).toEqual(['c1', 'c2']);
    const c1Case = pendingVariantCases.find((c) => c.clusterId === 'c1')!;
    expect(c1Case).toMatchObject({ serviceId: 's1', keyword: 'commercial emergency plumbing service', extraToken: 'commercial' });
    const c2Case = pendingVariantCases.find((c) => c.clusterId === 'c2')!;
    expect(c2Case).toMatchObject({ serviceId: 's1', keyword: '24 hour emergency plumbing', extraToken: 'hour' });
  });

  it('a genuinely distinct offering (two-plus extra tokens) does not variant-fold and follows normal placement', () => {
    const { pages, placements, pendingVariantCases } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s2', 'Drain Cleaning')] }),
        clusters: [
          cluster({
            clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'sewer drain jet cleaning service',
            coreTokens: ['sewer', 'drain', 'jet', 'cleaning'], serviceId: 's2', intent: 'commercial', addressableVolume: 600,
          }),
        ],
      }),
      RS, BUDGET,
    );
    const d = placements.find((p) => p.clusterId === 'c1')!;
    // 2 strong signals (unique_conversion + sufficient_demand) -> normal dedicated page, not a variant fold.
    expect(d.placement).toBe('dedicated_page');
    expect(pendingVariantCases.length).toBe(0);
    const page = byLogicalId(pages, d.targetLogicalId)!;
    expect(page.pageType).toBe('resource');
  });

  it('area-linked clusters are untouched by the variant rule (service_location guardrail still applies)', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({
          services: [svc('s1', 'Emergency Plumbing')],
          serviceAreas: [area('a1', 'Austin', ['licensed in Travis County', 'local 24/7 crew'])],
        }),
        clusters: [cluster({
          clusterId: 'c1', label: 'emergency plumbing austin', primaryKeyword: 'emergency plumbing austin',
          coreTokens: ['emergency', 'plumbing'], intent: 'transactional', serviceId: 's1', serviceAreaId: 'a1',
          hasLocalizedEvidence: true, addressableVolume: 200,
        })],
      }),
      RS, BUDGET,
    );
    // Still mints a service_location page, not folded as a service variant.
    expect(byType(pages, 'service_location').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Supporting keywords (pp-v3, spec 3.7)
// ---------------------------------------------------------------------------

describe('supporting keywords', () => {
  it('a page collects its clusters member keywords minus the primary, deduped, volume DESC, capped', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Drain Cleaning')] }),
        clusters: [
          cluster({
            clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'drain cleaning', coreTokens: ['drain', 'cleaning'],
            serviceId: 's1', intent: 'transactional', addressableVolume: 91000,
            memberKeywords: [
              { keyword: 'drain cleaning', volume: 90500 },
              { keyword: 'drain cleaning cost', volume: 500 },
              { keyword: 'clogged drain', volume: 300 },
            ],
          }),
          cluster({
            clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'drain cleaning near me', coreTokens: ['drain', 'cleaning'],
            serviceId: 's1', intent: 'transactional', addressableVolume: 74000,
            memberKeywords: [
              { keyword: 'drain cleaning near me', volume: 74000 },
              { keyword: 'clogged drain', volume: 300 },
              { keyword: 'drain snake', volume: null },
            ],
          }),
        ],
      }),
      RS, BUDGET,
    );
    // Both variant-fold onto the service page; best-fit assignment gives it "drain cleaning".
    const svcPage = byLogicalId(pages, 'svc:drain-cleaning')!;
    expect(svcPage.primaryKeyword).toBe('drain cleaning');
    // Supporting = union of member keywords minus the primary, deduped (clogged
    // drain once), volume DESC, null volume last.
    expect(svcPage.supportingKeywords).toEqual([
      'drain cleaning near me',
      'drain cleaning cost',
      'clogged drain',
      'drain snake',
    ]);
  });

  it('caps the supporting list at ruleset.supporting.storeCap', () => {
    const members = Array.from({ length: 30 }, (_, i) => ({ keyword: `member ${String(i).padStart(2, '0')}`, volume: 1000 - i }));
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [cluster({
          clusterId: 'c1', primaryKeyword: 'water heater install', coreTokens: ['water', 'heater', 'install'],
          serviceId: 's1', intent: 'transactional', addressableVolume: 500, memberKeywords: members,
        })],
      }),
      RS, BUDGET,
    );
    const page = pages.find((p) => p.pageType === 'resource')!;
    expect(page.supportingKeywords.length).toBe(RS.supporting.storeCap);
    expect(page.supportingKeywords[0]).toBe('member 00');
  });
});

// ---------------------------------------------------------------------------
// Best-fit skeleton keyword assignment (pp-v3, spec 3.3b)
// ---------------------------------------------------------------------------

describe('best-fit skeleton keyword assignment', () => {
  it('a service page takes its highest-volume folded keyword that names the service, not whichever folded first', () => {
    // "austin drain" (vol 200, informational) folds onto the service page FIRST
    // (higher volume, processed first) but lacks the "cleaning" service token; the
    // commercial head term "drain cleaning" (vol 100) is the best fit and wins.
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Drain Cleaning')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'austin drain', coreTokens: ['austin', 'drain'], serviceId: 's1', intent: 'informational', addressableVolume: 200 }),
          cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'drain cleaning', coreTokens: ['drain', 'cleaning'], serviceId: 's1', intent: 'commercial', addressableVolume: 100 }),
        ],
      }),
      RS, BUDGET,
    );
    const svcPage = byLogicalId(pages, 'svc:drain-cleaning')!;
    expect(svcPage.primaryKeyword).toBe('drain cleaning');
  });

  it('the highest-volume service-token match wins even when a smaller variant folded first', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Drain Cleaning')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'drain cleaning near me', coreTokens: ['drain', 'cleaning'], serviceId: 's1', intent: 'transactional', addressableVolume: 74000 }),
          cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'drain cleaning', coreTokens: ['drain', 'cleaning'], serviceId: 's1', intent: 'transactional', addressableVolume: 90500 }),
        ],
      }),
      RS, BUDGET,
    );
    const svcPage = byLogicalId(pages, 'svc:drain-cleaning')!;
    expect(svcPage.primaryKeyword).toBe('drain cleaning');
  });

  it('a location page never claims a folded keyword that lacks a category/service token (only the city)', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ category: 'plumber', services: [svc('s1', 'Plumbing')], serviceAreas: [area('a1', 'Austin')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'shower installation austin', coreTokens: ['shower', 'installation'], serviceId: null, serviceAreaId: 'a1', intent: 'informational', addressableVolume: 10 }),
        ],
      }),
      RS, BUDGET,
    );
    const loc = byLogicalId(pages, 'loc:austin')!;
    expect(loc.primaryKeyword).toBeNull();
  });

  it('a location page claims a folded keyword carrying both the city and a category/service token', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ category: 'plumber', services: [svc('s1', 'Plumbing')], serviceAreas: [area('a1', 'Austin')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'plumber austin', coreTokens: ['plumber', 'austin'], serviceId: null, serviceAreaId: 'a1', intent: 'informational', addressableVolume: 300 }),
        ],
      }),
      RS, BUDGET,
    );
    const loc = byLogicalId(pages, 'loc:austin')!;
    expect(loc.primaryKeyword).toBe('plumber austin');
  });

  it('home never claims a bare head term (category token but no service-area city)', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ category: 'plumber', services: [svc('s1', 'Plumbing')], serviceAreas: [area('a1', 'Austin')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'plumber', coreTokens: ['plumber'], serviceId: null, serviceAreaId: null, intent: 'informational', addressableVolume: 550000 }),
        ],
      }),
      RS, BUDGET,
    );
    const home = byLogicalId(pages, 'home')!;
    expect(home.primaryKeyword).toBeNull();
  });

  it('home claims a category-plus-city keyword when present', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ category: 'plumber', services: [svc('s1', 'Plumbing')], serviceAreas: [area('a1', 'Austin')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'plumber austin', coreTokens: ['plumber', 'austin'], serviceId: null, serviceAreaId: null, intent: 'informational', addressableVolume: 400 }),
        ],
      }),
      RS, BUDGET,
    );
    const home = byLogicalId(pages, 'home')!;
    expect(home.primaryKeyword).toBe('plumber austin');
  });
});

// ---------------------------------------------------------------------------
// Page-cap demotion
// ---------------------------------------------------------------------------

describe('page-cap demotion', () => {
  function manyStrongClusters(n: number): PagePlanCluster[] {
    return Array.from({ length: n }, (_, i) =>
      cluster({
        clusterId: `c${i}`,
        primaryKeywordId: `k${i}`,
        primaryKeyword: `service topic ${i}`,
        coreTokens: ['service', 'topic'],
        serviceId: 's1',
        intent: 'transactional',
        addressableVolume: (i + 1) * 100, // c0 weakest, c{n-1} strongest
      }),
    );
  }

  it('demotes the lowest-scoring dedicated pages to sections until the plan fits the budget; skeleton is never demoted', () => {
    // Skeleton = home, service, contact, company = 4. Budget 6 -> at most 2 dedicated pages.
    const { pages, warnings, stats } = buildPagePlan(
      facts({ brief: brief({ services: [svc('s1', 'Plumbing')] }), clusters: manyStrongClusters(5) }),
      RS, { pageBudget: 6 },
    );
    expect(pages.length).toBe(6);
    expect(stats.dedicatedPageCount).toBe(2);
    expect(stats.demotedPageCount).toBe(3);
    expect(warnings.some((w) => w.code === 'inventory_limited')).toBe(true);
    // the two strongest clusters (c4, c3) keep their pages.
    const dedicatedKeywords = pages.filter((p) => p.pageType === 'resource').map((p) => p.primaryKeyword);
    expect(dedicatedKeywords).toContain('service topic 4');
    expect(dedicatedKeywords).toContain('service topic 3');
    // skeleton pages survive.
    expect(byLogicalId(pages, 'home')).toBeDefined();
    expect(byLogicalId(pages, 'svc:plumbing')).toBeDefined();
  });

  it('demotion is deterministic across repeated runs', () => {
    const input = facts({ brief: brief({ services: [svc('s1', 'Plumbing')] }), clusters: manyStrongClusters(5) });
    const a = buildPagePlan(input, RS, { pageBudget: 6 });
    const b = buildPagePlan(input, RS, { pageBudget: 6 });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// Addressable demand
// ---------------------------------------------------------------------------

describe('addressable demand', () => {
  it('counts each primary keyword once and treats missing volume as null, never 0', () => {
    const { pages, stats } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'a topic', coreTokens: ['topic'], serviceId: 's1', intent: 'transactional', addressableVolume: 300 }),
          // no-volume, single-signal cluster -> folds onto home as a section, contributes null.
          cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'b topic', coreTokens: ['topic'], serviceId: null, intent: 'informational', addressableVolume: null }),
        ],
      }),
      RS, BUDGET,
    );
    expect(stats.totalAddressableVolume).toBe(300);
    const home = byLogicalId(pages, 'home')!;
    // home only carries the null-volume cluster -> addressableVolume null (not 0).
    expect(home.scores.addressableVolume).toBeNull();
    const dedicated = pages.find((p) => p.pageType === 'resource')!;
    expect(dedicated.scores.addressableVolume).toBe(300);
  });

  it('plan total is null when no cluster carried a volume', () => {
    const { stats } = buildPagePlan(
      facts({ clusters: [cluster({ clusterId: 'c1', addressableVolume: null, serviceId: null, intent: 'informational' })] }),
      RS, BUDGET,
    );
    expect(stats.totalAddressableVolume).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Zero clusters + determinism
// ---------------------------------------------------------------------------

describe('evidence refs', () => {
  it('a dedicated page carries its owning cluster evidence refs, deduped and sorted', () => {
    const { pages, placements } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [cluster({ clusterId: 'c1', serviceId: 's1', intent: 'transactional', addressableVolume: 200, evidenceRefIds: ['evr_b', 'evr_a', 'evr_b'] })],
      }),
      RS, BUDGET,
    );
    const page = byLogicalId(pages, placements[0].targetLogicalId)!;
    expect(page.scores.evidenceRefs).toEqual(['evr_a', 'evr_b']);
  });

  it('a page that absorbs folded clusters unions their evidence refs with the owner', () => {
    const { pages } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [
          // dedicated owner on the service page.
          cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'drain repair', coreTokens: ['drain', 'repair'], serviceId: 's1', intent: 'transactional', addressableVolume: 400, evidenceRefIds: ['evr_owner'] }),
          // a weak cluster that folds onto home as a section.
          cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'plumbing faq', coreTokens: ['plumbing', 'faq'], serviceId: null, intent: 'informational', addressableVolume: 5, evidenceRefIds: ['evr_folded'] }),
        ],
      }),
      RS, BUDGET,
    );
    const home = byLogicalId(pages, 'home')!;
    expect(home.scores.evidenceRefs).toContain('evr_folded');
    const dedicated = pages.find((p) => p.pageType === 'resource')!;
    expect(dedicated.scores.evidenceRefs).toEqual(['evr_owner']);
  });

  it('skeleton-only pages carry no evidence refs and no warning', () => {
    const { pages, warnings } = buildPagePlan(facts({ brief: brief({ services: [svc('s1', 'Plumbing')] }) }), RS, BUDGET);
    for (const p of pages) expect(p.scores.evidenceRefs).toEqual([]);
    expect(warnings.every((w) => w.code !== 'missing_metrics')).toBe(true);
  });
});

describe('zero clusters', () => {
  it('emits a valid skeleton-only plan (never empty), with a partial_evidence note', () => {
    const { pages, placements, warnings, stats } = buildPagePlan(
      facts({ brief: brief({ services: [svc('s1', 'Plumbing')] }) }), RS, BUDGET,
    );
    expect(pages.length).toBe(4);
    expect(placements.length).toBe(0);
    expect(stats.clustersPlaced).toBe(0);
    expect(warnings.some((w) => w.code === 'partial_evidence')).toBe(true);
  });
});

describe('determinism', () => {
  const richFacts = facts({
    brief: brief({
      services: [svc('s1', 'Drain Cleaning'), svc('s2', 'Water Heater'), svc('s3', 'Leak Repair')],
      serviceAreas: [area('a1', 'Austin', ['travis county']), area('a2', 'Dallas', ['dallas county'])],
    }),
    clusters: [
      cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'drain cleaning austin', coreTokens: ['drain', 'cleaning'], serviceId: 's1', serviceAreaId: 'a1', hasLocalizedEvidence: true, intent: 'transactional', addressableVolume: 400, evidenceRefIds: ['evr_2', 'evr_1'] }),
      cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'water heater repair', coreTokens: ['water', 'heater'], serviceId: 's2', intent: 'commercial', addressableVolume: 250, competitorPages: [{ competitorDomain: 'r.com', hasParsedData: true, titleTokens: ['water', 'heater'], headingTokens: [] }], evidenceRefIds: ['evr_3'] }),
      cluster({ clusterId: 'c3', primaryKeywordId: 'k3', primaryKeyword: 'how to fix a leak', coreTokens: ['fix', 'leak'], serviceId: null, intent: 'informational', addressableVolume: 30 }),
      cluster({ clusterId: 'c4', primaryKeywordId: 'k4', primaryKeyword: 'leak repair cost', coreTokens: ['leak', 'repair'], serviceId: 's3', intent: 'commercial', addressableVolume: 90 }),
    ],
  });

  it('produces identical output regardless of cluster input order (shuffle-proof)', () => {
    const inOrder = buildPagePlan(richFacts, RS, BUDGET);
    const shuffled = buildPagePlan(
      { ...richFacts, clusters: [richFacts.clusters[2], richFacts.clusters[0], richFacts.clusters[3], richFacts.clusters[1]] },
      RS, BUDGET,
    );
    expect(JSON.stringify(shuffled)).toEqual(JSON.stringify(inOrder));
  });

  it('produces identical output regardless of brief service/area input order', () => {
    const inOrder = buildPagePlan(richFacts, RS, BUDGET);
    const reordered = buildPagePlan(
      {
        ...richFacts,
        brief: {
          ...richFacts.brief,
          services: [richFacts.brief.services[2], richFacts.brief.services[0], richFacts.brief.services[1]],
          serviceAreas: [richFacts.brief.serviceAreas[1], richFacts.brief.serviceAreas[0]],
        },
      },
      RS, BUDGET,
    );
    expect(JSON.stringify(reordered)).toEqual(JSON.stringify(inOrder));
  });
});
