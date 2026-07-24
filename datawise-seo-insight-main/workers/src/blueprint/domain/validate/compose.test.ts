import { describe, it, expect } from 'vitest';
import { composeBlueprint } from './compose';
import type { OverlayResult } from './compose';
import type { PlannedPage } from '../page-plan/types';
import type { PageType, RecommendationStatus } from '../../contracts/enums';

// Minimal PlannedPage factory: only the fields compose reads matter; everything
// else gets a benign default.
function page(overrides: Partial<PlannedPage> & { logicalId: string }): PlannedPage {
  return {
    logicalId: overrides.logicalId,
    pageType: (overrides.pageType ?? 'service') as PageType,
    slug: overrides.slug ?? overrides.logicalId,
    title: overrides.title ?? overrides.logicalId,
    h1: overrides.h1 ?? overrides.logicalId,
    parentLogicalId: overrides.parentLogicalId ?? null,
    primaryKeywordId: overrides.primaryKeywordId ?? null,
    primaryKeyword: overrides.primaryKeyword ?? null,
    clusterIds: overrides.clusterIds ?? [],
    sections: overrides.sections ?? [],
    supportingKeywords: overrides.supportingKeywords ?? [],
    metaDescription: overrides.metaDescription ?? null,
    recommendation: (overrides.recommendation ?? 'create') as RecommendationStatus,
    consolidateTargetLogicalId: overrides.consolidateTargetLogicalId ?? null,
    scores: overrides.scores ?? {
      addressableVolume: null,
      confidence: null,
      scoreBreakdown: null,
      evidenceRefs: [],
    },
    warnings: overrides.warnings ?? [],
  };
}

describe('composeBlueprint', () => {
  it('maps each planned page to a BlueprintPageNode (proposed approval, keyword/parent carried)', () => {
    const plan = [
      page({ logicalId: 'home', pageType: 'home', slug: '', parentLogicalId: null }),
      page({ logicalId: 'svc_drain', pageType: 'service', slug: 'drain-cleaning', parentLogicalId: 'home', primaryKeyword: 'drain cleaning', clusterIds: ['c1'] }),
    ];
    const { nodes, pages } = composeBlueprint(plan, null);

    expect(nodes).toHaveLength(2);
    const svcNode = nodes.find((n) => n.id === 'svc_drain')!;
    expect(svcNode).toMatchObject({
      id: 'svc_drain',
      parentId: 'home',
      type: 'service',
      slug: 'drain-cleaning',
      primaryKeywordNormalized: 'drain cleaning',
      approval: 'proposed',
    });
    expect(pages.find((p) => p.logicalId === 'svc_drain')?.ownerClusterId).toBe('c1');
  });

  it('defaults every page to create when there is no overlay', () => {
    const plan = [page({ logicalId: 'a' }), page({ logicalId: 'b' })];
    const { pages, nodes, consolidations } = composeBlueprint(plan, null);
    expect(pages.every((p) => p.recommendation === 'create')).toBe(true);
    expect(nodes.every((n) => n.recommendation === 'create')).toBe(true);
    expect(consolidations).toEqual([]);
  });

  it('folds overlay keep/update/create recommendations onto the matching pages', () => {
    const plan = [
      page({ logicalId: 'keep_me' }),
      page({ logicalId: 'update_me' }),
      page({ logicalId: 'brand_new' }),
    ];
    const overlay: OverlayResult = {
      plannedPages: [
        { logicalId: 'keep_me', recommendation: 'keep', matchedUrl: 'https://x.com/keep', matchScore: 0.9 },
        { logicalId: 'update_me', recommendation: 'update', matchedUrl: 'https://x.com/upd', matchScore: 0.5 },
        // brand_new has no overlay entry -> stays create.
      ],
      consolidations: [],
    };
    const { pages } = composeBlueprint(plan, overlay);
    expect(pages.find((p) => p.logicalId === 'keep_me')).toMatchObject({ recommendation: 'keep', matchedUrl: 'https://x.com/keep', matchScore: 0.9 });
    expect(pages.find((p) => p.logicalId === 'update_me')?.recommendation).toBe('update');
    expect(pages.find((p) => p.logicalId === 'brand_new')?.recommendation).toBe('create');
  });

  it('flattens overlay consolidations (existing URL -> target logical id)', () => {
    const plan = [page({ logicalId: 'svc_drain' })];
    const overlay: OverlayResult = {
      plannedPages: [{ logicalId: 'svc_drain', recommendation: 'keep', matchedUrl: 'https://x.com/drain', matchScore: 0.8 }],
      consolidations: [{ existingUrl: 'https://x.com/old-drain', consolidateTargetLogicalId: 'svc_drain', matchScore: 0.5 }],
    };
    const { consolidations } = composeBlueprint(plan, overlay);
    expect(consolidations).toEqual([{ existingUrl: 'https://x.com/old-drain', targetLogicalId: 'svc_drain' }]);
  });

  it('derives isSkeleton and hasEvidence from the planned page', () => {
    const plan = [
      // Skeleton: no cluster, no primary keyword.
      page({ logicalId: 'home', pageType: 'home', clusterIds: [], primaryKeyword: null }),
      // Factual page with evidence.
      page({
        logicalId: 'svc',
        clusterIds: ['c1'],
        primaryKeyword: 'kw',
        scores: { addressableVolume: 100, confidence: 'high', scoreBreakdown: null, evidenceRefs: ['ev1'] },
      }),
      // Factual page WITHOUT evidence.
      page({ logicalId: 'svc2', clusterIds: ['c2'], primaryKeyword: 'kw2' }),
    ];
    const { pages } = composeBlueprint(plan, null);
    expect(pages.find((p) => p.logicalId === 'home')).toMatchObject({ isSkeleton: true, hasEvidence: false });
    expect(pages.find((p) => p.logicalId === 'svc')).toMatchObject({ isSkeleton: false, hasEvidence: true, confidence: 'high' });
    expect(pages.find((p) => p.logicalId === 'svc2')).toMatchObject({ isSkeleton: false, hasEvidence: false });
  });
});
