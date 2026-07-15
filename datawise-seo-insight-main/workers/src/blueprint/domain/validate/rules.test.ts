import { describe, it, expect } from 'vitest';
import { validateComposed } from './rules';
import type { ValidateContext, ServiceLocationCheck } from './rules';
import type { ComposedBlueprint, ComposedPage } from './compose';
import { PAGE_PLAN_RULESET_V1 } from '../page-plan/ruleset';
import type { BlueprintPageNode, BlueprintWarning, NormalizedProjectBrief } from '../../contracts/types';
import type { PageType, RecommendationStatus, ConfidenceLabel } from '../../contracts/enums';

// ---------- composed builders ----------

function cpage(overrides: Partial<ComposedPage> & { logicalId: string }): ComposedPage {
  return {
    logicalId: overrides.logicalId,
    pageType: (overrides.pageType ?? 'service') as PageType,
    slug: overrides.slug ?? overrides.logicalId,
    title: overrides.title ?? overrides.logicalId,
    parentLogicalId: overrides.parentLogicalId ?? null,
    primaryKeyword: overrides.primaryKeyword ?? null,
    primaryKeywordId: overrides.primaryKeywordId ?? null,
    recommendation: (overrides.recommendation ?? 'create') as RecommendationStatus,
    matchedUrl: overrides.matchedUrl ?? null,
    matchScore: overrides.matchScore ?? null,
    consolidateTargetLogicalId: overrides.consolidateTargetLogicalId ?? null,
    hasEvidence: overrides.hasEvidence ?? true,
    isSkeleton: overrides.isSkeleton ?? false,
    confidence: (overrides.confidence ?? 'high') as ConfidenceLabel | null,
    clusterIds: overrides.clusterIds ?? [],
    ownerClusterId: overrides.ownerClusterId ?? null,
  };
}

function nodeOf(p: ComposedPage): BlueprintPageNode {
  return {
    id: p.logicalId,
    parentId: p.parentLogicalId,
    type: p.pageType,
    title: p.title,
    slug: p.slug,
    primaryKeywordNormalized: p.primaryKeyword,
    recommendation: p.recommendation,
    approval: 'proposed',
  };
}

function composed(pages: ComposedPage[], consolidations: ComposedBlueprint['consolidations'] = []): ComposedBlueprint {
  return { pages, nodes: pages.map(nodeOf), consolidations };
}

function ctx(overrides: Partial<ValidateContext> = {}): ValidateContext {
  return {
    pageBudget: 30,
    engineWarnings: [],
    gapStages: [],
    overlayPresent: true,
    mode: 'greenfield',
    serviceLocationChecks: [],
    ...overrides,
  };
}

// A minimal valid tree: one root + one child, both active, distinct slugs/keywords.
function validPages(): ComposedPage[] {
  return [
    cpage({ logicalId: 'home', pageType: 'home', slug: 'home', parentLogicalId: null, isSkeleton: true, hasEvidence: false }),
    cpage({ logicalId: 'svc_drain', pageType: 'service', slug: 'drain-cleaning', parentLogicalId: 'home', primaryKeyword: 'drain cleaning', clusterIds: ['c1'], ownerClusterId: 'c1', hasEvidence: true }),
  ];
}

const RULES = PAGE_PLAN_RULESET_V1;

describe('validateComposed - valid blueprint', () => {
  it('a well-formed blueprint has zero blocking issues (and no spurious warnings)', () => {
    const { blocking, warnings } = validateComposed(composed(validPages()), RULES, ctx());
    expect(blocking).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('validateComposed - BLOCKING rules', () => {
  it('validateBlueprintGraph failure (duplicate slug) surfaces as blocking', () => {
    const pages = [
      cpage({ logicalId: 'home', pageType: 'home', slug: 'x', parentLogicalId: null, isSkeleton: true, hasEvidence: false }),
      cpage({ logicalId: 'a', slug: 'dup', parentLogicalId: 'home', primaryKeyword: 'ka' }),
      cpage({ logicalId: 'b', slug: 'dup', parentLogicalId: 'home', primaryKeyword: 'kb' }),
    ];
    const { blocking } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking.some((i) => i.code === 'graph_duplicate_slug')).toBe(true);
  });

  it('validateBlueprintGraph failure (duplicate primary keyword) surfaces as blocking', () => {
    const pages = [
      cpage({ logicalId: 'home', pageType: 'home', slug: 'home', parentLogicalId: null, isSkeleton: true, hasEvidence: false }),
      cpage({ logicalId: 'a', slug: 'a', parentLogicalId: 'home', primaryKeyword: 'same kw' }),
      cpage({ logicalId: 'b', slug: 'b', parentLogicalId: 'home', primaryKeyword: 'same kw' }),
    ];
    const { blocking } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking.some((i) => i.code === 'graph_duplicate_primary_keyword')).toBe(true);
  });

  it('a missing parent (orphan) is blocking', () => {
    const pages = [
      cpage({ logicalId: 'home', pageType: 'home', slug: 'home', parentLogicalId: null, isSkeleton: true, hasEvidence: false }),
      cpage({ logicalId: 'child', slug: 'child', parentLogicalId: 'ghost', primaryKeyword: 'k' }),
    ];
    const { blocking } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking.some((i) => i.code === 'graph_orphan')).toBe(true);
  });

  it('a hierarchy cycle is blocking', () => {
    // No root at all (both point at each other) also trips no_root; the cycle is
    // the finding under test.
    const pages = [
      cpage({ logicalId: 'a', slug: 'a', parentLogicalId: 'b', primaryKeyword: 'ka' }),
      cpage({ logicalId: 'b', slug: 'b', parentLogicalId: 'a', primaryKeyword: 'kb' }),
    ];
    const { blocking } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking.some((i) => i.code === 'graph_cycle')).toBe(true);
  });

  it('a consolidate page whose target does not exist is blocking', () => {
    const pages = [
      ...validPages(),
      cpage({ logicalId: 'old', slug: 'old', parentLogicalId: 'home', primaryKeyword: 'old kw', recommendation: 'consolidate', consolidateTargetLogicalId: 'ghost' }),
    ];
    const { blocking } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking.some((i) => i.code === 'consolidate_target_missing' && i.subject === 'old')).toBe(true);
  });

  it('a self-consolidating page is blocking', () => {
    const pages = [
      ...validPages(),
      cpage({ logicalId: 'loop', slug: 'loop', parentLogicalId: 'home', primaryKeyword: 'loop kw', recommendation: 'consolidate', consolidateTargetLogicalId: 'loop' }),
    ];
    const { blocking } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking.some((i) => i.code === 'consolidate_target_self' && i.subject === 'loop')).toBe(true);
  });

  it('an overlay consolidation targeting a non-existent page is blocking', () => {
    const bp = composed(validPages(), [{ existingUrl: 'https://x.com/old', targetLogicalId: 'ghost' }]);
    const { blocking } = validateComposed(bp, RULES, ctx());
    expect(blocking.some((i) => i.code === 'consolidate_target_missing' && i.subject === 'https://x.com/old')).toBe(true);
  });

  it('a valid overlay consolidation (target is a real page) is NOT blocking', () => {
    const bp = composed(validPages(), [{ existingUrl: 'https://x.com/old', targetLogicalId: 'svc_drain' }]);
    const { blocking } = validateComposed(bp, RULES, ctx());
    expect(blocking).toEqual([]);
  });

  it('page count over budget is blocking', () => {
    const { blocking } = validateComposed(composed(validPages()), RULES, ctx({ pageBudget: 1 }));
    expect(blocking.some((i) => i.code === 'page_budget_exceeded')).toBe(true);
  });

  it('a slug over the length cap is blocking', () => {
    const pages = [
      ...validPages(),
      cpage({ logicalId: 'long', slug: 'a'.repeat(RULES.caps.maxSlugChars + 1), parentLogicalId: 'home', primaryKeyword: 'long kw' }),
    ];
    const { blocking } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking.some((i) => i.code === 'slug_too_long' && i.subject === 'long')).toBe(true);
  });

  it('a title over the length cap is blocking', () => {
    const pages = [
      ...validPages(),
      cpage({ logicalId: 'long', slug: 'long', title: 'T'.repeat(RULES.caps.maxTitleChars + 1), parentLogicalId: 'home', primaryKeyword: 'long kw' }),
    ];
    const { blocking } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking.some((i) => i.code === 'title_too_long' && i.subject === 'long')).toBe(true);
  });

  it('a service_location survivor that fails the doorway guardrail (no unique proof) is blocking', () => {
    const pages = [
      cpage({ logicalId: 'home', pageType: 'home', slug: 'home', parentLogicalId: null, isSkeleton: true, hasEvidence: false }),
      cpage({ logicalId: 'sl', pageType: 'service_location', slug: 'drain-austin', parentLogicalId: 'home', primaryKeyword: 'drain austin', clusterIds: ['c1'], ownerClusterId: 'c1' }),
    ];
    const check: ServiceLocationCheck = {
      logicalId: 'sl',
      service: { id: 's1', name: 'Drain', normalizedName: 'drain', description: null, synonyms: [], priority: 'primary' },
      // uniqueProof empty -> evaluateServiceLocationPage denies (missing_unique_proof).
      area: { id: 'a1', city: 'Austin', region: null, countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: [] },
      cluster: { id: 'c1', label: 'drain austin', keywordCount: 1, totalSearchVolume: 100, hasLocalizedEvidence: true },
    };
    const { blocking } = validateComposed(composed(pages), RULES, ctx({ serviceLocationChecks: [check] }));
    expect(blocking.some((i) => i.code === 'service_location_doorway' && i.subject === 'sl')).toBe(true);
    expect(blocking.some((i) => i.code === 'service_location_thin_content' && i.subject === 'sl')).toBe(true);
  });

  it('a service_location survivor that PASSES the doorway guardrail is NOT blocking', () => {
    const pages = [
      cpage({ logicalId: 'home', pageType: 'home', slug: 'home', parentLogicalId: null, isSkeleton: true, hasEvidence: false }),
      cpage({ logicalId: 'sl', pageType: 'service_location', slug: 'drain-austin', parentLogicalId: 'home', primaryKeyword: 'drain austin', clusterIds: ['c1'], ownerClusterId: 'c1' }),
    ];
    const check: ServiceLocationCheck = {
      logicalId: 'sl',
      service: { id: 's1', name: 'Drain', normalizedName: 'drain', description: null, synonyms: [], priority: 'primary' },
      area: { id: 'a1', city: 'Austin', region: null, countryIso: 'US', radiusKm: null, isPrimary: true, uniqueProof: ['Office on South Lamar'] },
      cluster: { id: 'c1', label: 'drain austin', keywordCount: 1, totalSearchVolume: 100, hasLocalizedEvidence: true },
    };
    const { blocking } = validateComposed(composed(pages), RULES, ctx({ serviceLocationChecks: [check] }));
    expect(blocking).toEqual([]);
  });
});

describe('validateComposed - WARNING rules (never blocking)', () => {
  it('carries engine cannibalization warnings as exposed warnings', () => {
    const engineWarnings: BlueprintWarning[] = [
      { code: 'cannibalization_risk', severity: 'warning', message: 'two pages fight for one query', relatedPageIds: ['svc_drain'], evidenceRefIds: [] },
    ];
    const { blocking, warnings } = validateComposed(composed(validPages()), RULES, ctx({ engineWarnings }));
    expect(blocking).toEqual([]);
    expect(warnings.some((w) => w.code === 'engine_cannibalization_risk' && w.subject === 'svc_drain')).toBe(true);
  });

  it('discloses partial upstream stages as warnings', () => {
    const { warnings } = validateComposed(composed(validPages()), RULES, ctx({ gapStages: ['overlay_existing_site', 'collect_us_fanout'] }));
    expect(warnings.filter((w) => w.code === 'upstream_partial').map((w) => w.subject)).toEqual(['collect_us_fanout', 'overlay_existing_site']);
  });

  it('warns on a factual page with no evidence refs (skeleton pages exempt)', () => {
    const pages = [
      cpage({ logicalId: 'home', pageType: 'home', slug: 'home', parentLogicalId: null, isSkeleton: true, hasEvidence: false }),
      cpage({ logicalId: 'svc', slug: 'svc', parentLogicalId: 'home', primaryKeyword: 'k', clusterIds: ['c1'], hasEvidence: false }),
    ];
    const { blocking, warnings } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking).toEqual([]);
    expect(warnings.filter((w) => w.code === 'evidence_missing').map((w) => w.subject)).toEqual(['svc']);
  });

  it('warns when an existing-site brief has no overlay artifact', () => {
    const { warnings } = validateComposed(composed(validPages()), RULES, ctx({ mode: 'existing_site', overlayPresent: false }));
    expect(warnings.some((w) => w.code === 'overlay_absent')).toBe(true);
  });

  it('does NOT warn about overlay absence on a greenfield brief', () => {
    const { warnings } = validateComposed(composed(validPages()), RULES, ctx({ mode: 'greenfield', overlayPresent: false }));
    expect(warnings.some((w) => w.code === 'overlay_absent')).toBe(false);
  });

  it('warns on a low-confidence dedicated page', () => {
    const pages = [
      cpage({ logicalId: 'home', pageType: 'home', slug: 'home', parentLogicalId: null, isSkeleton: true, hasEvidence: false }),
      cpage({ logicalId: 'weak', slug: 'weak', parentLogicalId: 'home', primaryKeyword: 'k', clusterIds: ['c1'], confidence: 'low' }),
    ];
    const { blocking, warnings } = validateComposed(composed(pages), RULES, ctx());
    expect(blocking).toEqual([]);
    expect(warnings.some((w) => w.code === 'low_confidence_page' && w.subject === 'weak')).toBe(true);
  });
});

describe('validateComposed - determinism', () => {
  it('total-orders issues by code then subject and dedupes exact repeats', () => {
    const engineWarnings: BlueprintWarning[] = [
      { code: 'cannibalization_risk', severity: 'warning', message: 'm', relatedPageIds: ['z'], evidenceRefIds: [] },
      { code: 'cannibalization_risk', severity: 'warning', message: 'm', relatedPageIds: ['a'], evidenceRefIds: [] },
      // exact duplicate of the first -> deduped.
      { code: 'cannibalization_risk', severity: 'warning', message: 'm', relatedPageIds: ['z'], evidenceRefIds: [] },
    ];
    const { warnings } = validateComposed(composed(validPages()), RULES, ctx({ engineWarnings, gapStages: ['refine_clusters'] }));
    const cann = warnings.filter((w) => w.code === 'engine_cannibalization_risk');
    expect(cann.map((w) => w.subject)).toEqual(['a', 'z']); // sorted, deduped
    // Distinct codes stay in code order: engine_* sorts before upstream_partial.
    const codes = warnings.map((w) => w.code);
    expect([...codes]).toEqual([...codes].sort());
  });

  it('is a pure function: same inputs -> identical output', () => {
    const bp = composed(validPages());
    const c = ctx({ gapStages: ['a', 'b'] });
    expect(validateComposed(bp, RULES, c)).toEqual(validateComposed(bp, RULES, c));
  });
});
