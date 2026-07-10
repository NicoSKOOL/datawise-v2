import type { BlueprintPageNode } from '../contracts/types';
import { normalizeSlug } from './slug';

export interface SlugValidation {
  valid: boolean;
  conflictPageIds: string[];
}

export interface GraphError {
  code: 'no_root' | 'multiple_roots' | 'orphan' | 'cycle' | 'duplicate_slug' | 'duplicate_primary_keyword';
  pageIds: string[];
  message: string;
}

const isActive = (p: BlueprintPageNode) => p.approval !== 'rejected';

export function validateSlugUniqueness(
  slug: string,
  pages: readonly BlueprintPageNode[],
  currentPageId?: string
): SlugValidation {
  const normalized = normalizeSlug(slug);
  const conflictPageIds = pages
    .filter((p) => p.id !== currentPageId && isActive(p) && normalizeSlug(p.slug) === normalized)
    .map((p) => p.id);
  return { valid: conflictPageIds.length === 0, conflictPageIds };
}

export function validateBlueprintGraph(pages: readonly BlueprintPageNode[]): { valid: boolean; errors: GraphError[] } {
  const errors: GraphError[] = [];
  const byId = new Map(pages.map((p) => [p.id, p]));

  const roots = pages.filter((p) => p.parentId === null);
  if (roots.length === 0) errors.push({ code: 'no_root', pageIds: [], message: 'Blueprint has no root page.' });
  if (roots.length > 1) errors.push({ code: 'multiple_roots', pageIds: roots.map((r) => r.id), message: 'Blueprint has more than one root page.' });

  for (const p of pages) {
    if (p.parentId !== null && !byId.has(p.parentId)) {
      errors.push({ code: 'orphan', pageIds: [p.id], message: `Page ${p.id} references missing parent ${p.parentId}.` });
    }
  }

  const inCycle = new Set<string>();
  for (const p of pages) {
    if (inCycle.has(p.id)) continue;
    const seen = new Set<string>([p.id]);
    let cursor = p.parentId;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        for (const id of seen) inCycle.add(id);
        errors.push({ code: 'cycle', pageIds: [...seen], message: `Hierarchy cycle involving ${[...seen].join(', ')}.` });
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  const bySlug = new Map<string, string[]>();
  const byPrimaryKeyword = new Map<string, string[]>();
  for (const p of pages.filter(isActive)) {
    const slugKey = normalizeSlug(p.slug);
    bySlug.set(slugKey, [...(bySlug.get(slugKey) ?? []), p.id]);
    if (p.primaryKeywordNormalized) {
      byPrimaryKeyword.set(p.primaryKeywordNormalized, [...(byPrimaryKeyword.get(p.primaryKeywordNormalized) ?? []), p.id]);
    }
  }
  for (const [slug, ids] of bySlug) {
    if (ids.length > 1) errors.push({ code: 'duplicate_slug', pageIds: ids, message: `Slug ${slug} is used by ${ids.length} active pages.` });
  }
  for (const [keyword, ids] of byPrimaryKeyword) {
    if (ids.length > 1) errors.push({ code: 'duplicate_primary_keyword', pageIds: ids, message: `Primary keyword "${keyword}" is assigned to ${ids.length} active pages.` });
  }

  return { valid: errors.length === 0, errors };
}
