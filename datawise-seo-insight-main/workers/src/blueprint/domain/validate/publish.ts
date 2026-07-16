import type { PageType, RecommendationStatus } from '../../contracts/enums';
import { PAGE_TYPES } from '../../contracts/enums';
import type { ComposedConsolidation, ComposedPage } from './compose';
import type { PlannedPage } from '../page-plan/types';

// Stage 19 `publish_blueprint`, pure half: given the same composed page set
// validate reasoned over (composeBlueprint's ComposedPage[] plus the overlay
// consolidations) and the plans they were composed from, produce the total page
// ordering, the per-page page_json blob, the revision-hash input, and the
// version summary. Deterministic and side-effect-free: no clock, no random, no
// I/O. The handler loads the artifacts, calls composeBlueprint, and writes rows;
// everything that must be reproducible across two publishes of the same run
// (ordering + hash + summary counts) lives here so it can be unit tested without
// a database.

// Total ordering rank for each page type, by its position in the canonical
// PAGE_TYPES tuple (home first, faq last). Used only as an intra-group tiebreak
// so the order stays total even when volumes and slugs collide.
const PAGE_TYPE_RANK: Record<PageType, number> = Object.fromEntries(
  PAGE_TYPES.map((t, i) => [t, i]),
) as Record<PageType, number>;

// One composed page paired with the PlannedPage it was composed from. The
// composed side carries the overlay-folded recommendation + the graph fields
// blueprint_pages stores in columns; the planned side carries the richer detail
// (h1, sections, score breakdown, evidence refs, addressable volume) that rides
// in page_json. compose maps 1:1 off the plan, so every composed page has a
// planned counterpart; the handler asserts that invariant when it pairs them.
export interface PublishPage {
  composed: ComposedPage;
  planned: PlannedPage;
}

// A page's addressable volume, read off the plan (never re-derived, never
// 0-for-missing: a plan with no metric carries null). Used both as an ordering
// key and in the revision hash.
function pageVolume(p: PublishPage): number | null {
  return p.planned.scores.addressableVolume;
}

// Total, deterministic publish order:
//  1. skeleton structural pages first (home/hub/contact/company with nothing
//     folded), then the dedicated/factual pages;
//  2. dedicated pages by addressable volume DESC (null volume sorts last), so a
//     revision reads top-demand-first;
//  3. page-type rank ASC as a stable intra-group grouping;
//  4. slug ASC, then logicalId ASC as the final tiebreaks. logicalId is globally
//     unique, so two pages never compare equal: the order is total.
// Skeleton pages skip the volume key (a skeleton has no primary keyword, so its
// volume is null and would otherwise all tie at "last").
export function comparePublishPages(a: PublishPage, b: PublishPage): number {
  if (a.composed.isSkeleton !== b.composed.isSkeleton) {
    return a.composed.isSkeleton ? -1 : 1;
  }
  if (!a.composed.isSkeleton) {
    const av = pageVolume(a) ?? -1;
    const bv = pageVolume(b) ?? -1;
    if (av !== bv) return bv - av;
  }
  const ra = PAGE_TYPE_RANK[a.composed.pageType];
  const rb = PAGE_TYPE_RANK[b.composed.pageType];
  if (ra !== rb) return ra - rb;
  if (a.composed.slug !== b.composed.slug) return a.composed.slug < b.composed.slug ? -1 : 1;
  return a.composed.logicalId < b.composed.logicalId ? -1 : 1;
}

// Sorts a copy (never mutates the caller's array) into publish order.
export function orderPublishPages(pages: PublishPage[]): PublishPage[] {
  return [...pages].sort(comparePublishPages);
}

// The blueprint_pages.page_json blob for one page: everything a PlannedPage
// carries that has no dedicated column (h1, sections, meta, score breakdown,
// evidence refs, addressable volume, confidence), plus the overlay match facts
// and the deterministic 0-based order index. Pure JSON (no clock/random), so two
// publishes of the same run write byte-identical blobs.
export function buildPageJson(p: PublishPage, order: number): Record<string, unknown> {
  return {
    order,
    h1: p.planned.h1,
    metaDescription: p.planned.metaDescription,
    sections: p.planned.sections,
    clusterIds: p.planned.clusterIds,
    scoreBreakdown: p.planned.scores.scoreBreakdown,
    addressableVolume: p.planned.scores.addressableVolume,
    confidence: p.planned.scores.confidence,
    evidenceRefs: p.planned.scores.evidenceRefs,
    warnings: p.planned.warnings,
    overlay: {
      matchedUrl: p.composed.matchedUrl,
      matchScore: p.composed.matchScore,
    },
  };
}

// One page as it contributes to the revision hash: the identity + placement +
// recommendation fields whose change means "the blueprint is materially
// different". Deliberately excludes the page_json detail that does not change
// the page set's shape (sections wording, score breakdown internals) so the hash
// tracks the structural blueprint, not incidental phrasing.
export interface RevisionHashPage {
  order: number;
  logicalId: string;
  pageType: PageType;
  slug: string;
  title: string;
  h1: string;
  parentLogicalId: string | null;
  primaryKeyword: string | null;
  recommendation: RecommendationStatus;
  consolidateTargetLogicalId: string | null;
  addressableVolume: number | null;
}

export interface RevisionHashConsolidation {
  existingUrl: string;
  targetLogicalId: string | null;
}

export interface RevisionHashInput {
  pages: RevisionHashPage[];
  consolidations: RevisionHashConsolidation[];
}

// The value fed to hashNormalizedInput for revision_hash. `ordered` must already
// be in publish order (its index becomes the page's `order`), so a reordering of
// the same page set changes the hash. Consolidations are URL-level proposals
// (not pages); they are sorted by URL here so their array order never depends on
// overlay emission order. canonicalize() sorts object keys but preserves array
// order, which is why both arrays are put in a deterministic order here.
export function buildRevisionHashInput(
  ordered: PublishPage[],
  consolidations: ComposedConsolidation[],
): RevisionHashInput {
  const pages: RevisionHashPage[] = ordered.map((p, i) => ({
    order: i,
    logicalId: p.composed.logicalId,
    pageType: p.composed.pageType,
    slug: p.composed.slug,
    title: p.composed.title,
    h1: p.planned.h1,
    parentLogicalId: p.composed.parentLogicalId,
    primaryKeyword: p.composed.primaryKeyword,
    recommendation: p.composed.recommendation,
    consolidateTargetLogicalId: p.composed.consolidateTargetLogicalId,
    addressableVolume: p.planned.scores.addressableVolume,
  }));
  const cons: RevisionHashConsolidation[] = consolidations
    .map((c) => ({ existingUrl: c.existingUrl, targetLogicalId: c.targetLogicalId }))
    .sort((a, b) => (a.existingUrl < b.existingUrl ? -1 : a.existingUrl > b.existingUrl ? 1 : 0));
  return { pages, consolidations: cons };
}

// blueprint_versions.summary_json: the human/operator-facing rollup of a
// published revision. Counts are computed off the same composed page set the
// rows are materialized from, so summary and rows can never disagree.
export interface BlueprintSummary {
  pageCount: number;
  byRecommendation: { keep: number; update: number; create: number; consolidate: number };
  byPageType: Record<string, number>;
  addressableDemandTotal: number | null;
  warningCount: number;
  partialStages: string[];
}

// Builds summary_json. byRecommendation mirrors validateBlueprintHandler exactly:
// keep/update/create are counted per composed page's folded recommendation, then
// `consolidate` is OVERWRITTEN with the URL-level consolidation-proposal count
// (V1 never sets a planned page's recommendation to 'consolidate'; consolidation
// is always an existing-URL proposal). addressableDemandTotal is the plan's own
// single-count total (each primary keyword once), passed through unchanged.
// partialStages is the run's disclosed gap set, sorted for a stable blob.
export function buildBlueprintSummary(args: {
  pages: ComposedPage[];
  consolidations: ComposedConsolidation[];
  addressableDemandTotal: number | null;
  warningCount: number;
  partialStages: string[];
}): BlueprintSummary {
  const byRecommendation = { keep: 0, update: 0, create: 0, consolidate: 0 };
  for (const p of args.pages) byRecommendation[p.recommendation]++;
  byRecommendation.consolidate = args.consolidations.length;

  const byPageType: Record<string, number> = {};
  for (const p of args.pages) byPageType[p.pageType] = (byPageType[p.pageType] ?? 0) + 1;

  return {
    pageCount: args.pages.length,
    byRecommendation,
    byPageType,
    addressableDemandTotal: args.addressableDemandTotal,
    warningCount: args.warningCount,
    partialStages: [...args.partialStages].sort(),
  };
}
