import { describe, it, expect } from 'vitest';
import { scorePageMatch, assignMatches } from './match';
import type { ExistingPageInput, OverlayMatchThresholds } from './match';
import type { PlannedPage } from '../page-plan/types';
import { PAGE_PLAN_RULESET_V1 } from '../page-plan/ruleset';

const THRESHOLDS: OverlayMatchThresholds = {
  keepMatchScoreMin: PAGE_PLAN_RULESET_V1.overlay.keepMatchScoreMin,
  matchScoreMin: PAGE_PLAN_RULESET_V1.overlay.matchScoreMin,
};

function plannedPage(over: Partial<PlannedPage> & { logicalId: string; slug: string }): PlannedPage {
  return {
    logicalId: over.logicalId,
    pageType: over.pageType ?? 'service',
    slug: over.slug,
    title: over.title ?? '',
    h1: over.h1 ?? '',
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

describe('scorePageMatch', () => {
  it('is path-only (renormalized) when the existing page has no title', () => {
    const score = scorePageMatch(
      { url: 'https://ex.com/foo-bar', title: null },
      plannedPage({ logicalId: 'p', slug: '/foo-bar/' })
    );
    expect(score).toBe(1);
  });

  it('blends path and title when a title is present', () => {
    // path jaccard 1.0, title jaccard 0 (planned has no title tokens) -> 0.6.
    const score = scorePageMatch(
      { url: 'https://ex.com/foo-bar', title: 'Completely Different Words' },
      plannedPage({ logicalId: 'p', slug: '/foo-bar/' })
    );
    expect(score).toBeCloseTo(0.6, 10);
  });

  it('hits exactly the keep boundary (0.75)', () => {
    const score = scorePageMatch(
      { url: 'https://ex.com/a/b/c', title: null },
      plannedPage({ logicalId: 'p', slug: '/a/b/c/d/' })
    );
    expect(score).toBe(0.75);
  });

  it('hits exactly the match/update boundary (0.4)', () => {
    const score = scorePageMatch(
      { url: 'https://ex.com/a/b', title: null },
      plannedPage({ logicalId: 'p', slug: '/a/b/c/d/e/' })
    );
    expect(score).toBe(0.4);
  });
});

describe('assignMatches classification boundaries', () => {
  it('classifies exactly 0.75 as keep', () => {
    const res = assignMatches(
      [{ url: 'https://ex.com/a/b/c', title: null }],
      [plannedPage({ logicalId: 'p', slug: '/a/b/c/d/' })],
      THRESHOLDS
    );
    expect(res.plannedPages[0].recommendation).toBe('keep');
  });

  it('classifies exactly 0.4 as update', () => {
    const res = assignMatches(
      [{ url: 'https://ex.com/a/b', title: null }],
      [plannedPage({ logicalId: 'p', slug: '/a/b/c/d/e/' })],
      THRESHOLDS
    );
    expect(res.plannedPages[0].recommendation).toBe('update');
  });

  it('leaves a below-floor existing URL unmatched with no consolidate target', () => {
    const res = assignMatches(
      [{ url: 'https://ex.com/about-us', title: null }],
      [plannedPage({ logicalId: 'p', slug: '/emergency-plumbing/' })],
      THRESHOLDS
    );
    expect(res.plannedPages[0].recommendation).toBe('create');
    expect(res.existingPages[0]).toMatchObject({
      matchedLogicalPageId: null,
      matchScore: null,
      consolidateTargetLogicalId: null,
    });
  });
});

describe('assignMatches full scenario', () => {
  const planned = [
    plannedPage({ logicalId: 'plumbing', slug: '/emergency-plumbing/' }),
    plannedPage({ logicalId: 'drain', slug: '/drain-cleaning/' }),
    plannedPage({ logicalId: 'roofing', slug: '/roof-repair/' }),
  ];
  const existing: ExistingPageInput[] = [
    { url: 'https://ex.com/emergency-plumbing', title: null }, // keep plumbing (1.0)
    { url: 'https://ex.com/drain-cleaning-services', title: null }, // update drain (0.667)
    { url: 'https://ex.com/emergency-plumbing-24-hour', title: null }, // consolidate -> plumbing (0.5)
    { url: 'https://ex.com/about-us', title: null }, // unmatched
  ];

  it('assigns keep/update/create and consolidate one-to-one', () => {
    const res = assignMatches(existing, planned, THRESHOLDS);

    const byId = Object.fromEntries(res.plannedPages.map((p) => [p.logicalId, p]));
    expect(byId.plumbing).toMatchObject({ recommendation: 'keep', matchedUrl: 'https://ex.com/emergency-plumbing' });
    expect(byId.drain.recommendation).toBe('update');
    expect(byId.roofing).toMatchObject({ recommendation: 'create', matchedUrl: null, matchScore: null });

    const byUrl = Object.fromEntries(res.existingPages.map((e) => [e.url, e]));
    expect(byUrl['https://ex.com/emergency-plumbing'].matchedLogicalPageId).toBe('plumbing');
    expect(byUrl['https://ex.com/drain-cleaning-services'].matchedLogicalPageId).toBe('drain');
    // Second plumbing-ish URL lost the one-to-one race and consolidates into plumbing.
    expect(byUrl['https://ex.com/emergency-plumbing-24-hour']).toMatchObject({
      matchedLogicalPageId: null,
      consolidateTargetLogicalId: 'plumbing',
    });
    expect(byUrl['https://ex.com/about-us']).toMatchObject({
      matchedLogicalPageId: null,
      consolidateTargetLogicalId: null,
      matchScore: null,
    });
  });

  it('is deterministic regardless of input order', () => {
    const base = assignMatches(existing, planned, THRESHOLDS);
    const shuffled = assignMatches(
      [existing[2], existing[0], existing[3], existing[1]],
      [planned[2], planned[0], planned[1]],
      THRESHOLDS
    );
    const norm = (r: ReturnType<typeof assignMatches>) => ({
      planned: [...r.plannedPages].sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
      existing: [...r.existingPages].sort((a, b) => a.url.localeCompare(b.url)),
    });
    expect(norm(shuffled)).toEqual(norm(base));
  });

  it('never proposes a consolidate target that is the URL match itself', () => {
    const res = assignMatches(existing, planned, THRESHOLDS);
    for (const e of res.existingPages) {
      if (e.consolidateTargetLogicalId !== null) {
        expect(e.matchedLogicalPageId).toBeNull();
      }
    }
  });
});
