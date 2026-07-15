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
    const { pages, placements } = buildPagePlan(
      facts({
        brief: brief({ services: [svc('s1', 'Plumbing')] }),
        clusters: [cluster({ clusterId: 'c1', serviceId: 's1', intent: 'transactional', addressableVolume: 100 })],
      }),
      RS, BUDGET,
    );
    const decision = placements.find((p) => p.clusterId === 'c1')!;
    expect(decision.placement).toBe('dedicated_page');
    const page = byLogicalId(pages, decision.targetLogicalId)!;
    expect(page.pageType).toBe('resource');
    // parented under the matching service page.
    expect(page.parentLogicalId).toBe('svc:plumbing');
    expect(page.primaryKeyword).toBe('emergency plumbing');
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

describe('primary-keyword uniqueness', () => {
  it('the first page claims a primary keyword; a later cluster with the same keyword folds in with a cannibalization warning', () => {
    const shared = { primaryKeyword: 'emergency plumbing', coreTokens: ['emergency', 'plumbing'] };
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
    const claimants = pages.filter((p) => p.primaryKeyword === 'emergency plumbing');
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
      cluster({ clusterId: 'c1', primaryKeywordId: 'k1', primaryKeyword: 'drain cleaning austin', coreTokens: ['drain', 'cleaning'], serviceId: 's1', serviceAreaId: 'a1', hasLocalizedEvidence: true, intent: 'transactional', addressableVolume: 400 }),
      cluster({ clusterId: 'c2', primaryKeywordId: 'k2', primaryKeyword: 'water heater repair', coreTokens: ['water', 'heater'], serviceId: 's2', intent: 'commercial', addressableVolume: 250, competitorPages: [{ competitorDomain: 'r.com', hasParsedData: true, titleTokens: ['water', 'heater'], headingTokens: [] }] }),
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
