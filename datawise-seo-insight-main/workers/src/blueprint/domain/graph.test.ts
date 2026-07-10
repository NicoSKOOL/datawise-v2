import { describe, it, expect } from 'vitest';
import { validateSlugUniqueness, validateBlueprintGraph } from './graph';
import type { BlueprintPageNode } from '../contracts/types';

const page = (id: string, parentId: string | null, slug: string, primary: string | null = null, type: BlueprintPageNode['type'] = 'service'): BlueprintPageNode => ({
  id, parentId, type, title: id, slug, primaryKeywordNormalized: primary,
  recommendation: 'create', approval: 'proposed',
});

const validTree = [
  page('home', null, '/', 'plumber austin', 'home'),
  page('svc', 'home', '/services/', 'plumbing services', 'hub'),
  page('drain', 'svc', '/services/drain-cleaning/', 'drain cleaning austin'),
];

describe('validateSlugUniqueness', () => {
  it('detects conflicts after normalization, excluding the current page', () => {
    expect(validateSlugUniqueness('/services/Drain-Cleaning', validTree)).toEqual({ valid: false, conflictPageIds: ['drain'] });
    expect(validateSlugUniqueness('/services/drain-cleaning/', validTree, 'drain').valid).toBe(true);
    expect(validateSlugUniqueness('/new-page/', validTree).valid).toBe(true);
  });
});

describe('validateBlueprintGraph', () => {
  it('accepts a valid tree', () => {
    expect(validateBlueprintGraph(validTree)).toEqual({ valid: true, errors: [] });
  });
  it('rejects duplicate slugs and duplicate primary keywords', () => {
    const dupSlug = [...validTree, page('x', 'home', '/services/drain-cleaning/')];
    expect(validateBlueprintGraph(dupSlug).errors.some((e) => e.code === 'duplicate_slug')).toBe(true);
    const dupKw = [...validTree, page('y', 'home', '/other/', 'drain cleaning austin')];
    expect(validateBlueprintGraph(dupKw).errors.some((e) => e.code === 'duplicate_primary_keyword')).toBe(true);
  });
  it('rejects cycles, orphans, missing root, multiple roots', () => {
    const cycle = [page('a', 'b', '/a/'), page('b', 'a', '/b/')];
    expect(validateBlueprintGraph(cycle).errors.some((e) => e.code === 'cycle')).toBe(true);
    const orphan = [...validTree, page('lost', 'ghost', '/lost/')];
    expect(validateBlueprintGraph(orphan).errors.some((e) => e.code === 'orphan')).toBe(true);
    expect(validateBlueprintGraph(cycle).errors.some((e) => e.code === 'no_root')).toBe(true);
    const twoRoots = [...validTree, page('root2', null, '/root2/', null, 'home')];
    expect(validateBlueprintGraph(twoRoots).errors.some((e) => e.code === 'multiple_roots')).toBe(true);
  });
  it('attributes cycles to only the cyclic nodes, once, regardless of order', () => {
    const intoCycle = [page('c', 'a', '/c/'), page('a', 'b', '/a/'), page('b', 'a', '/b/')];
    for (const ordering of [intoCycle, [...intoCycle].reverse()]) {
      const result = validateBlueprintGraph(ordering);
      const cycles = result.errors.filter((e) => e.code === 'cycle');
      expect(cycles).toHaveLength(1);
      expect([...cycles[0].pageIds].sort()).toEqual(['a', 'b']);
    }
  });
  it('ignores rejected pages for slug/keyword uniqueness', () => {
    const rejected = { ...page('z', 'home', '/services/drain-cleaning/', 'drain cleaning austin'), approval: 'rejected' as const };
    expect(validateBlueprintGraph([...validTree, rejected]).valid).toBe(true);
  });
});
