import { describe, it, expect } from 'vitest';
import {
  comparePublishPages,
  orderPublishPages,
  buildPageJson,
  buildRevisionHashInput,
  buildBlueprintSummary,
} from './publish';
import type { PublishPage } from './publish';
import type { ComposedPage, ComposedConsolidation } from './compose';
import type { PlannedPage } from '../page-plan/types';
import { hashNormalizedInput } from '../hash';

// Minimal PlannedPage + ComposedPage factories. Only the fields publish.ts reads
// are set; the rest carry inert defaults so a fixture never accidentally depends
// on an unset field.
function planned(over: Partial<PlannedPage> & { logicalId: string }): PlannedPage {
  return {
    logicalId: over.logicalId,
    pageType: over.pageType ?? 'service',
    slug: over.slug ?? over.logicalId,
    title: over.title ?? over.logicalId,
    h1: over.h1 ?? `${over.logicalId} h1`,
    parentLogicalId: over.parentLogicalId ?? null,
    primaryKeywordId: over.primaryKeywordId ?? null,
    primaryKeyword: over.primaryKeyword ?? null,
    clusterIds: over.clusterIds ?? [],
    sections: over.sections ?? [],
    supportingKeywords: over.supportingKeywords ?? [],
    metaDescription: over.metaDescription ?? null,
    recommendation: over.recommendation ?? 'create',
    consolidateTargetLogicalId: over.consolidateTargetLogicalId ?? null,
    scores: over.scores ?? { addressableVolume: null, confidence: null, scoreBreakdown: null, evidenceRefs: [] },
    warnings: over.warnings ?? [],
  };
}

function composed(over: Partial<ComposedPage> & { logicalId: string }): ComposedPage {
  return {
    logicalId: over.logicalId,
    pageType: over.pageType ?? 'service',
    slug: over.slug ?? over.logicalId,
    title: over.title ?? over.logicalId,
    parentLogicalId: over.parentLogicalId ?? null,
    primaryKeyword: over.primaryKeyword ?? null,
    primaryKeywordId: over.primaryKeywordId ?? null,
    recommendation: over.recommendation ?? 'create',
    matchedUrl: over.matchedUrl ?? null,
    matchScore: over.matchScore ?? null,
    consolidateTargetLogicalId: over.consolidateTargetLogicalId ?? null,
    hasEvidence: over.hasEvidence ?? false,
    isSkeleton: over.isSkeleton ?? false,
    confidence: over.confidence ?? null,
    clusterIds: over.clusterIds ?? [],
    ownerClusterId: over.ownerClusterId ?? null,
  };
}

function page(logicalId: string, opts: {
  isSkeleton?: boolean;
  pageType?: ComposedPage['pageType'];
  slug?: string;
  volume?: number | null;
  recommendation?: ComposedPage['recommendation'];
}): PublishPage {
  return {
    composed: composed({
      logicalId,
      pageType: opts.pageType,
      slug: opts.slug ?? logicalId,
      isSkeleton: opts.isSkeleton ?? false,
      recommendation: opts.recommendation,
    }),
    planned: planned({
      logicalId,
      pageType: opts.pageType,
      slug: opts.slug ?? logicalId,
      scores: { addressableVolume: opts.volume ?? null, confidence: null, scoreBreakdown: null, evidenceRefs: [] },
    }),
  };
}

describe('publish ordering', () => {
  it('puts skeleton pages first, then dedicated pages by addressable volume descending', () => {
    const home = page('home', { isSkeleton: true, pageType: 'home' });
    const hub = page('hub', { isSkeleton: true, pageType: 'hub' });
    const svcHigh = page('svc-high', { volume: 900 });
    const svcLow = page('svc-low', { volume: 100 });
    const svcMid = page('svc-mid', { volume: 400 });

    const ordered = orderPublishPages([svcLow, svcHigh, hub, home, svcMid]);
    expect(ordered.map((p) => p.composed.logicalId)).toEqual([
      'home', 'hub', 'svc-high', 'svc-mid', 'svc-low',
    ]);
  });

  it('is a total order: equal-volume dedicated pages fall back to page type, then slug, then logical id', () => {
    const a = page('z-id', { volume: 200, pageType: 'service', slug: 'same-slug' });
    const b = page('a-id', { volume: 200, pageType: 'service', slug: 'same-slug' });
    // Same volume, type, and slug -> logical id ('a-id' < 'z-id') breaks the tie.
    expect(comparePublishPages(a, b)).toBeGreaterThan(0);
    expect(comparePublishPages(b, a)).toBeLessThan(0);
    // A dedicated page with null volume sorts after any page with a real volume.
    const nullVol = page('svc-null', { volume: null });
    const realVol = page('svc-real', { volume: 1 });
    expect(orderPublishPages([nullVol, realVol]).map((p) => p.composed.logicalId)).toEqual(['svc-real', 'svc-null']);
  });

  it('does not mutate the input array', () => {
    const input = [page('b', { volume: 1 }), page('a', { volume: 2 })];
    const before = input.map((p) => p.composed.logicalId);
    orderPublishPages(input);
    expect(input.map((p) => p.composed.logicalId)).toEqual(before);
  });
});

describe('buildPageJson', () => {
  it('carries the full PlannedPage detail plus overlay match facts and the order index', () => {
    const p: PublishPage = {
      composed: composed({ logicalId: 'svc', matchedUrl: 'https://x.com/svc', matchScore: 0.8 }),
      planned: planned({
        logicalId: 'svc',
        h1: 'Service H1',
        metaDescription: 'meta',
        sections: [{ heading: 'S1', keywordIds: ['k1'] }],
        clusterIds: ['c1'],
        scores: { addressableVolume: 500, confidence: 'high', scoreBreakdown: null, evidenceRefs: ['ev1'] },
      }),
    };
    const json = buildPageJson(p, 3);
    expect(json).toMatchObject({
      order: 3,
      h1: 'Service H1',
      metaDescription: 'meta',
      addressableVolume: 500,
      confidence: 'high',
      evidenceRefs: ['ev1'],
      clusterIds: ['c1'],
      overlay: { matchedUrl: 'https://x.com/svc', matchScore: 0.8 },
    });
    expect(json.sections).toEqual([{ heading: 'S1', keywordIds: ['k1'] }]);
  });
});

describe('buildRevisionHashInput + hash', () => {
  it('is stable for the same ordered page set and changes when the plan changes', async () => {
    const set = [page('home', { isSkeleton: true, pageType: 'home' }), page('svc', { volume: 300 })];
    const orderedA = orderPublishPages(set);
    const hashA1 = await hashNormalizedInput(buildRevisionHashInput(orderedA, []));
    const hashA2 = await hashNormalizedInput(buildRevisionHashInput(orderPublishPages(set), []));
    expect(hashA1).toBe(hashA2);

    // Different page set (an added page) -> different hash.
    const setB = [...set, page('svc2', { volume: 200 })];
    const hashB = await hashNormalizedInput(buildRevisionHashInput(orderPublishPages(setB), []));
    expect(hashB).not.toBe(hashA1);

    // A changed recommendation on the same pages also changes the hash.
    const setC = [page('home', { isSkeleton: true, pageType: 'home' }), page('svc', { volume: 300, recommendation: 'update' })];
    const hashC = await hashNormalizedInput(buildRevisionHashInput(orderPublishPages(setC), []));
    expect(hashC).not.toBe(hashA1);
  });

  it('folds consolidation proposals in and sorts them by url so overlay emission order does not matter', async () => {
    const set = [page('svc', { volume: 300 })];
    const consA: ComposedConsolidation[] = [
      { existingUrl: 'https://b.com', targetLogicalId: 'svc' },
      { existingUrl: 'https://a.com', targetLogicalId: 'svc' },
    ];
    const consReordered: ComposedConsolidation[] = [
      { existingUrl: 'https://a.com', targetLogicalId: 'svc' },
      { existingUrl: 'https://b.com', targetLogicalId: 'svc' },
    ];
    const h1 = await hashNormalizedInput(buildRevisionHashInput(orderPublishPages(set), consA));
    const h2 = await hashNormalizedInput(buildRevisionHashInput(orderPublishPages(set), consReordered));
    expect(h1).toBe(h2);
    const hNone = await hashNormalizedInput(buildRevisionHashInput(orderPublishPages(set), []));
    expect(hNone).not.toBe(h1);
  });
});

describe('buildBlueprintSummary', () => {
  it('counts pages by recommendation and page type, single-counts addressable demand, and overwrites consolidate with the url-proposal count', () => {
    const pages: ComposedPage[] = [
      composed({ logicalId: 'home', pageType: 'home', recommendation: 'keep', isSkeleton: true }),
      composed({ logicalId: 'svc1', pageType: 'service', recommendation: 'update' }),
      composed({ logicalId: 'svc2', pageType: 'service', recommendation: 'create' }),
      composed({ logicalId: 'res1', pageType: 'resource', recommendation: 'create' }),
    ];
    const consolidations: ComposedConsolidation[] = [
      { existingUrl: 'https://old.com/a', targetLogicalId: 'svc1' },
      { existingUrl: 'https://old.com/b', targetLogicalId: 'svc1' },
    ];
    const summary = buildBlueprintSummary({
      pages,
      consolidations,
      addressableDemandTotal: 800,
      warningCount: 3,
      partialStages: ['refine_clusters', 'collect_us_fanout'],
    });
    expect(summary.pageCount).toBe(4);
    expect(summary.byRecommendation).toEqual({ keep: 1, update: 1, create: 2, consolidate: 2 });
    expect(summary.byPageType).toEqual({ home: 1, service: 2, resource: 1 });
    expect(summary.addressableDemandTotal).toBe(800);
    expect(summary.warningCount).toBe(3);
    // partialStages sorted for a stable blob.
    expect(summary.partialStages).toEqual(['collect_us_fanout', 'refine_clusters']);
  });

  it('preserves a null addressable demand total (never coerced to 0)', () => {
    const summary = buildBlueprintSummary({
      pages: [composed({ logicalId: 'home', pageType: 'home', recommendation: 'create', isSkeleton: true })],
      consolidations: [],
      addressableDemandTotal: null,
      warningCount: 0,
      partialStages: [],
    });
    expect(summary.addressableDemandTotal).toBeNull();
    expect(summary.byRecommendation.consolidate).toBe(0);
  });
});
