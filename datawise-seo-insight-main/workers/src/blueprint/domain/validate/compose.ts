import type { BlueprintPageNode } from '../../contracts/types';
import type { ConfidenceLabel, PageType, RecommendationStatus } from '../../contracts/enums';
import type { PlannedPage } from '../page-plan/types';

// Stage 18 `validate_blueprint`, part 1 of 2: the pure composer. Folds stage
// 15's page plan (PlannedPage[]) and stage 16's overlay (OverlayResult | null)
// into the final blueprint shape the validators (rules.ts) reason over: the
// BlueprintPageNode[] validateBlueprintGraph expects, plus a per-page
// ComposedPage carrying the folded recommendation and the evidence/skeleton
// facts the manual rules need. Deterministic and side-effect-free: no clock, no
// random, no I/O. The handler loads the artifacts; this only transforms them.

// ---------------------------------------------------------------------------
// Overlay artifact shape (as written by overlay_existing_site, Task 18)
// ---------------------------------------------------------------------------

// One planned page's overlay verdict: keep / update / create against the
// existing site, plus the URL it matched (null when unmatched -> create).
export interface OverlayPlannedPage {
  logicalId: string;
  recommendation: RecommendationStatus;
  matchedUrl: string | null;
  matchScore: number | null;
}

// A leftover existing URL that overlaps a planned page above the floor but did
// not win a one-to-one match: a proposal to consolidate that URL INTO the named
// planned page. consolidateTargetLogicalId is that planned page's logical id.
export interface OverlayConsolidation {
  existingUrl: string;
  consolidateTargetLogicalId: string | null;
  matchScore: number | null;
}

export interface OverlayResult {
  rulesetVersion?: string;
  plannedPages: OverlayPlannedPage[];
  consolidations: OverlayConsolidation[];
}

// ---------------------------------------------------------------------------
// Composed shapes
// ---------------------------------------------------------------------------

// A planned page after the overlay recommendation is folded on, plus the facts
// the manual rules read directly off it (no re-derivation in rules.ts):
//  - isSkeleton: a brief-derived structural page that carries no cluster and no
//    primary keyword (home / hub / contact / company with nothing folded). Such
//    a page legitimately has no evidence refs, so the evidence-gap warning skips
//    it; a page that DOES own a keyword or fold clusters is "factual" and is
//    expected to carry evidence.
//  - ownerClusterId: the cluster a dedicated page was minted from (its first
//    clusterId), used by the handler to resolve a service_location page back to
//    its service/area for the doorway re-check. null for skeleton pages.
export interface ComposedPage {
  logicalId: string;
  pageType: PageType;
  slug: string;
  title: string;
  parentLogicalId: string | null;
  primaryKeyword: string | null;
  primaryKeywordId: string | null;
  recommendation: RecommendationStatus;
  matchedUrl: string | null;
  matchScore: number | null;
  consolidateTargetLogicalId: string | null;
  hasEvidence: boolean;
  isSkeleton: boolean;
  confidence: ConfidenceLabel | null;
  clusterIds: string[];
  ownerClusterId: string | null;
}

// A consolidation proposal lifted from the overlay, flattened for validation:
// an existing URL folding into a planned page (targetLogicalId).
export interface ComposedConsolidation {
  existingUrl: string;
  targetLogicalId: string | null;
}

export interface ComposedBlueprint {
  nodes: BlueprintPageNode[];
  pages: ComposedPage[];
  // Overlay consolidation proposals, flattened. Kept alongside nodes/pages
  // (a documented superset of the brief's `{ nodes, pages }`) so rules.ts can
  // validate every consolidation target without re-reading the overlay.
  consolidations: ComposedConsolidation[];
}

// A page is "factual" (and therefore expected to carry evidence) when it owns a
// primary keyword or folds at least one cluster. Everything else is a skeleton
// structural page for which absent evidence is correct, not a gap.
function isSkeletonPage(page: PlannedPage): boolean {
  return page.clusterIds.length === 0 && page.primaryKeyword === null;
}

export function composeBlueprint(plan: PlannedPage[], overlay: OverlayResult | null): ComposedBlueprint {
  // Overlay recommendation lookup by logical id. Absent overlay (greenfield or
  // overlay skipped) -> every page defaults to 'create'.
  const overlayByLogicalId = new Map<string, OverlayPlannedPage>();
  for (const op of overlay?.plannedPages ?? []) overlayByLogicalId.set(op.logicalId, op);

  const pages: ComposedPage[] = plan.map((p) => {
    const ov = overlayByLogicalId.get(p.logicalId);
    return {
      logicalId: p.logicalId,
      pageType: p.pageType,
      slug: p.slug,
      title: p.title,
      parentLogicalId: p.parentLogicalId,
      primaryKeyword: p.primaryKeyword,
      primaryKeywordId: p.primaryKeywordId,
      // Recommendation is authoritative from the overlay (which never mutates
      // page-plan.json); default 'create' when no overlay entry exists.
      recommendation: ov?.recommendation ?? 'create',
      matchedUrl: ov?.matchedUrl ?? null,
      matchScore: ov?.matchScore ?? null,
      consolidateTargetLogicalId: p.consolidateTargetLogicalId,
      hasEvidence: p.scores.evidenceRefs.length > 0,
      isSkeleton: isSkeletonPage(p),
      confidence: p.scores.confidence,
      clusterIds: p.clusterIds,
      ownerClusterId: p.clusterIds.length > 0 ? p.clusterIds[0] : null,
    };
  });

  const nodes: BlueprintPageNode[] = pages.map((p) => ({
    id: p.logicalId,
    parentId: p.parentLogicalId,
    type: p.pageType,
    title: p.title,
    slug: p.slug,
    primaryKeywordNormalized: p.primaryKeyword,
    recommendation: p.recommendation,
    // Freshly composed, not-yet-published pages are 'proposed'. validateBlueprintGraph
    // treats only 'rejected' as inactive; 'proposed' pages are all active, which
    // is what we want (every planned page participates in the graph checks).
    approval: 'proposed',
  }));

  const consolidations: ComposedConsolidation[] = (overlay?.consolidations ?? []).map((c) => ({
    existingUrl: c.existingUrl,
    targetLogicalId: c.consolidateTargetLogicalId,
  }));

  return { nodes, pages, consolidations };
}
