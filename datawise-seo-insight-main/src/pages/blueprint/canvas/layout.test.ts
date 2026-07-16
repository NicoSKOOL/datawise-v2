import { describe, it, expect } from 'vitest';
import { layoutBlueprintTree } from './layout';
import type { BlueprintGraphNode } from './types';

function makeNode(overrides: Partial<BlueprintGraphNode> & { logicalPageId: string; slug: string }): BlueprintGraphNode {
  return {
    logicalPageId: overrides.logicalPageId,
    parentLogicalPageId: overrides.parentLogicalPageId ?? null,
    pageType: overrides.pageType ?? 'service',
    title: overrides.title ?? overrides.logicalPageId,
    slug: overrides.slug,
    primaryKeyword: overrides.primaryKeyword ?? null,
    primaryVolume: overrides.primaryVolume ?? null,
    primaryIntent: overrides.primaryIntent ?? null,
    recommendation: overrides.recommendation ?? 'keep',
    approval: overrides.approval ?? 'pending',
    priority: overrides.priority ?? null,
    confidenceLabel: overrides.confidenceLabel ?? null,
    supportingKeywordCount: overrides.supportingKeywordCount ?? 0,
  };
}

describe('layoutBlueprintTree', () => {
  it('is deterministic: same input laid out twice produces deep-equal maps', () => {
    const nodes: BlueprintGraphNode[] = [
      makeNode({ logicalPageId: 'home', slug: 'home', parentLogicalPageId: null }),
      makeNode({ logicalPageId: 'plumbing', slug: 'plumbing', parentLogicalPageId: 'home' }),
      makeNode({ logicalPageId: 'drains', slug: 'drains', parentLogicalPageId: 'plumbing' }),
      makeNode({ logicalPageId: 'heating', slug: 'heating', parentLogicalPageId: 'home' }),
    ];

    const first = layoutBlueprintTree(nodes);
    const second = layoutBlueprintTree(nodes);

    expect(second).toEqual(first);
  });

  it('orders children by slug ascending, left to right (x ascending)', () => {
    const nodes: BlueprintGraphNode[] = [
      makeNode({ logicalPageId: 'home', slug: 'home', parentLogicalPageId: null }),
      makeNode({ logicalPageId: 'c-page', slug: 'zebra', parentLogicalPageId: 'home' }),
      makeNode({ logicalPageId: 'a-page', slug: 'alpha', parentLogicalPageId: 'home' }),
      makeNode({ logicalPageId: 'b-page', slug: 'mid', parentLogicalPageId: 'home' }),
    ];

    const positions = layoutBlueprintTree(nodes);

    const alphaX = positions.get('a-page')!.x;
    const midX = positions.get('b-page')!.x;
    const zebraX = positions.get('c-page')!.x;

    expect(alphaX).toBeLessThan(midX);
    expect(midX).toBeLessThan(zebraX);
  });

  it('treats a node whose parent id is not present in the set as a root (orphan fallback), never dropping it', () => {
    const nodes: BlueprintGraphNode[] = [
      makeNode({ logicalPageId: 'home', slug: 'home', parentLogicalPageId: null }),
      makeNode({ logicalPageId: 'orphan', slug: 'orphan', parentLogicalPageId: 'missing-parent' }),
    ];

    const positions = layoutBlueprintTree(nodes);

    expect(positions.size).toBe(2);
    expect(positions.has('orphan')).toBe(true);
    // Orphan is a root: same depth (y) as the other root.
    expect(positions.get('orphan')!.y).toBe(positions.get('home')!.y);
  });

  it('centers a single root over its children (root.x equals midpoint of children xs)', () => {
    const nodes: BlueprintGraphNode[] = [
      makeNode({ logicalPageId: 'home', slug: 'home', parentLogicalPageId: null }),
      makeNode({ logicalPageId: 'left', slug: 'alpha', parentLogicalPageId: 'home' }),
      makeNode({ logicalPageId: 'right', slug: 'zebra', parentLogicalPageId: 'home' }),
    ];

    const positions = layoutBlueprintTree(nodes);

    const leftX = positions.get('left')!.x;
    const rightX = positions.get('right')!.x;
    const rootX = positions.get('home')!.x;

    expect(rootX).toBe((leftX + rightX) / 2);
  });
});
