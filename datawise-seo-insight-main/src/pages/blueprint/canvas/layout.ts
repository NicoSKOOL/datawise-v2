import type { BlueprintGraphNode } from './types';

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  hGap?: number;
  vGap?: number;
}

// Deterministic tree layout for the Blueprint page graph. Two passes:
// post-order computes each subtree's horizontal width, then pre-order
// assigns each node's center x (and depth-based y) within that width.
// Nodes whose parent id is missing from the input set are treated as roots
// rather than dropped, so a partially-loaded or corrupt graph still renders
// every page.
export function layoutBlueprintTree(nodes: BlueprintGraphNode[], opts: LayoutOptions = {}): Map<string, LayoutNode> {
  const nodeWidth = opts.nodeWidth ?? 200;
  const nodeHeight = opts.nodeHeight ?? 96;
  const hGap = opts.hGap ?? 24;
  const vGap = opts.vGap ?? 60;
  const slotWidth = nodeWidth + hGap;

  const byId = new Map<string, BlueprintGraphNode>();
  for (const node of nodes) byId.set(node.logicalPageId, node);

  const childrenById = new Map<string, BlueprintGraphNode[]>();
  const roots: BlueprintGraphNode[] = [];
  for (const node of nodes) {
    const parentId = node.parentLogicalPageId;
    if (parentId !== null && byId.has(parentId)) {
      const siblings = childrenById.get(parentId) ?? [];
      siblings.push(node);
      childrenById.set(parentId, siblings);
    } else {
      // No parent, or parent id not present in this set: orphan fallback, treat as root.
      roots.push(node);
    }
  }
  for (const siblings of childrenById.values()) {
    siblings.sort((a, b) => a.slug.localeCompare(b.slug));
  }
  roots.sort((a, b) => a.slug.localeCompare(b.slug));

  const subtreeWidth = new Map<string, number>();
  function computeWidth(node: BlueprintGraphNode): number {
    const children = childrenById.get(node.logicalPageId) ?? [];
    const width = children.length === 0 ? slotWidth : Math.max(slotWidth, children.reduce((sum, child) => sum + computeWidth(child), 0));
    subtreeWidth.set(node.logicalPageId, width);
    return width;
  }
  for (const root of roots) computeWidth(root);

  const positions = new Map<string, LayoutNode>();
  function assign(node: BlueprintGraphNode, xStart: number, depth: number): void {
    const children = childrenById.get(node.logicalPageId) ?? [];
    const width = subtreeWidth.get(node.logicalPageId) ?? slotWidth;
    const y = depth * (nodeHeight + vGap);

    if (children.length === 0) {
      positions.set(node.logicalPageId, { id: node.logicalPageId, x: xStart + width / 2, y });
      return;
    }

    const childrenTotalWidth = children.reduce((sum, child) => sum + (subtreeWidth.get(child.logicalPageId) ?? slotWidth), 0);
    let cursor = xStart + Math.max(0, (width - childrenTotalWidth) / 2);
    for (const child of children) {
      const childWidth = subtreeWidth.get(child.logicalPageId) ?? slotWidth;
      assign(child, cursor, depth + 1);
      cursor += childWidth;
    }

    const firstChildX = positions.get(children[0].logicalPageId)!.x;
    const lastChildX = positions.get(children[children.length - 1].logicalPageId)!.x;
    positions.set(node.logicalPageId, { id: node.logicalPageId, x: (firstChildX + lastChildX) / 2, y });
  }

  let rootCursor = 0;
  for (const root of roots) {
    const width = subtreeWidth.get(root.logicalPageId) ?? slotWidth;
    assign(root, rootCursor, 0);
    rootCursor += width;
  }

  return positions;
}
