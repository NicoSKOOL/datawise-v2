import type { ConfidenceLabel, PageType } from '../../contracts/enums';
import type {
  BlueprintWarning, KeywordClusterSummary, NormalizedProjectBrief,
  PageCandidate, ScoreBreakdown, ScoreComponent,
} from '../../contracts/types';
import {
  detectDoorwayRisk, evaluateServiceLocationPage,
} from '../doorway';
import type { PagePlanRuleset } from './ruleset';
import { evaluateStrongSignals, presentStrongSignals, shouldFold } from './signals';
import { buildH1, buildLogicalId, buildSlug, buildTitle, cleanKeywordForNaming, dedupeSlug } from './titles';
import type {
  PagePlanBriefFacts, PagePlanCluster, PagePlanFacts, ParentCandidate,
  PlacementDecision, PlannedPage, PlannedPageSection, SignalEvaluation, StrongSignal,
  VariantFoldCase,
} from './types';

// Stage 15 `build_page_plan` pure engine. Turns clusters + brief facts + the
// frozen page-plan ruleset into the deterministic site skeleton plus one
// placement decision per cluster. Pure and deterministic: no clock, no random,
// no ids from a generator. Logical ids/slugs/titles come from titles.ts, and
// every ordering is a total order so the same inputs (in any array order)
// always produce byte-identical output. Missing evidence yields absent signals,
// never fabricated values (handoff §2.4).
//
// The engine never imports orchestration/providers/db: it consumes a fully
// assembled PagePlanFacts (the facts loader in orchestration/page-plan-facts.ts
// does the D1/R2 reads) and returns plain data the handler persists.

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export interface PagePlanStats {
  pageCount: number;
  skeletonPageCount: number;
  dedicatedPageCount: number;
  sectionCount: number;
  faqCount: number;
  clustersPlaced: number;
  demotedPageCount: number;
  cannibalizedCount: number;
  serviceLocationBlockedCount: number;
  // Plan-wide addressable demand: each cluster's primary keyword counted once
  // (a cluster's demand lands on exactly one page). null when no placed cluster
  // carried a volume, never 0-for-missing (handoff §2.4).
  totalAddressableVolume: number | null;
  pageBudget: number;
}

export interface PagePlanResult {
  pages: PlannedPage[];
  placements: PlacementDecision[];
  warnings: BlueprintWarning[];
  stats: PagePlanStats;
  // Borderline service-variant folds (spec 3.3a) the engine folded deterministically
  // but flagged for the Phase D adjudicator. Empty on a run with no borderline cases.
  // Deterministic: ordered by cluster id ASC.
  pendingVariantCases: VariantFoldCase[];
}

export interface PagePlanOptions {
  // Per-run USER page budget. Sourced by the facts loader from the normalized
  // brief's maxRecommendedPages (NOT a ruleset constant): the cap is a user
  // choice, not a governed threshold. Skeleton pages are never demoted to honor
  // it; only dedicated cluster pages are.
  pageBudget: number;
}

// ---------------------------------------------------------------------------
// Internal working page shape (mutable during planning, frozen into PlannedPage)
// ---------------------------------------------------------------------------

interface WorkingPage {
  logicalId: string;
  pageType: PageType;
  slug: string;
  title: string;
  h1: string;
  parentLogicalId: string | null;
  primaryKeywordId: string | null;
  primaryKeyword: string | null;
  isSkeleton: boolean;
  // The cluster that owns this page's identity (dedicated pages) or was promoted
  // onto it (skeleton pages that adopted a folded cluster's primary keyword).
  ownerClusterId: string | null;
  // clusters whose demand lands on this page (dedicated owner + folded sections).
  clusterIds: string[];
  sections: PlannedPageSection[];
  scoreBreakdown: ScoreBreakdown | null;
  scoreConfidence: ConfidenceLabel | null;
  // Deciding cluster's fired-signal count, retained for deterministic demotion.
  firedSignalCount: number;
  // Owner cluster's own addressable volume, retained for deterministic demotion
  // ranking (full per-page demand is recomputed at freeze time).
  ownVolume: number | null;
  warnings: BlueprintWarning[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CONFIDENCE_RANK: Record<ConfidenceLabel, number> = { high: 3, medium: 2, low: 1 };

function confidenceRank(label: ConfidenceLabel | null): number {
  return label === null ? 0 : CONFIDENCE_RANK[label];
}

function warn(
  code: BlueprintWarning['code'],
  severity: BlueprintWarning['severity'],
  message: string,
  relatedPageIds: string[] = [],
): BlueprintWarning {
  return { code, severity, message, relatedPageIds, evidenceRefIds: [] };
}

// Returns a logical id not already in `existing`, suffixing -2, -3, ... until
// free, and records it. Mirrors dedupeSlug's mutate-the-registry contract so
// every page's logical id is collision-free by construction even when two
// pages would otherwise share one (e.g. two services with the same normalized
// name, or two clusters mapping to the same key parts). Deterministic: same
// registry + same candidate sequence => same results.
function dedupeLogicalId(existing: Set<string>, candidate: string): string {
  if (!existing.has(candidate)) {
    existing.add(candidate);
    return candidate;
  }
  for (let n = 2; ; n++) {
    const suffixed = `${candidate}-${n}`;
    if (!existing.has(suffixed)) {
      existing.add(suffixed);
      return suffixed;
    }
  }
}

// Total order over clusters: addressable volume DESC (nulls last), then
// confidence DESC, then cluster id ASC. Ids are globally unique so no two
// clusters ever compare equal -> a stable, shuffle-proof processing order.
function compareClusters(a: PagePlanCluster, b: PagePlanCluster): number {
  const va = a.addressableVolume;
  const vb = b.addressableVolume;
  if (va !== vb) {
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va;
  }
  const ca = confidenceRank(a.confidence);
  const cb = confidenceRank(b.confidence);
  if (ca !== cb) return cb - ca;
  return a.clusterId < b.clusterId ? -1 : a.clusterId > b.clusterId ? 1 : 0;
}

// Deterministic demotion order for the page cap: lowest addressable volume
// first (nulls treated as lowest), then lowest fired-signal count, then lowest
// confidence, then cluster id DESC. The FIRST entries are demoted first, so the
// weakest dedicated pages give up their URL first.
function compareForDemotion(a: WorkingPage, b: WorkingPage): number {
  const va = pageOwnVolume(a);
  const vb = pageOwnVolume(b);
  const na = va === null ? -1 : va;
  const nb = vb === null ? -1 : vb;
  if (na !== nb) return na - nb;
  if (a.firedSignalCount !== b.firedSignalCount) return a.firedSignalCount - b.firedSignalCount;
  const ca = confidenceRank(a.scoreConfidence);
  const cb = confidenceRank(b.scoreConfidence);
  if (ca !== cb) return ca - cb;
  const ida = a.ownerClusterId ?? '';
  const idb = b.ownerClusterId ?? '';
  return ida < idb ? 1 : ida > idb ? -1 : 0;
}

// A dedicated page's own addressable volume (its owner cluster's), used only for
// demotion ranking. Full per-page addressable demand (owner + folded sections)
// is computed at freeze time in pageAddressableVolume.
function pageOwnVolume(page: WorkingPage): number | null {
  return page.ownVolume;
}

// ScoreBreakdown from a cluster's six signal evaluations: each signal is an
// equally weighted component (1/6), contributing its weight when present. total
// is the clamped fired-fraction. Absent signals are kept (rawValue 0) so the
// breakdown explains the call either way (handoff: score_breakdown carries the
// full evaluation, present AND absent).
//
// Note the effective cap: two of the six signals (distinct_intent,
// low_serp_overlap) can only fire when the parent carries its own intent/SERP,
// but clusters are compared against STRUCTURAL parents (home/service/location),
// which never do (see toParentCandidate). So today at most four signals are
// reachable and total tops out near 4/6 (~0.67). This is intentional for v1
// (all six weigh equally so the breakdown stays comparable if sibling-page
// parents later make the other two reachable); it is a documented cap, not a
// bug. minStrongSignals (2) is unaffected: it counts fired signals, not total.
function scoreBreakdownFrom(evals: SignalEvaluation[]): ScoreBreakdown {
  const weight = evals.length > 0 ? 1 / evals.length : 0;
  const components: ScoreComponent[] = evals.map((e) => ({
    key: e.kind,
    weight,
    rawValue: e.present ? 1 : 0,
    contribution: e.present ? weight : 0,
  }));
  const total = components.reduce((sum, c) => sum + c.contribution, 0);
  return { total: Math.min(1, Math.max(0, total)), components };
}

const COMPARISON_TOKENS = new Set(['vs', 'versus', 'compare', 'comparison']);

function tokens(keyword: string): string[] {
  return keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function leadsWithQuestionWord(keyword: string, questionWords: readonly string[]): boolean {
  const lead = tokens(keyword)[0] ?? '';
  return lead !== '' && questionWords.includes(lead);
}

function hasComparisonToken(keyword: string): boolean {
  return tokens(keyword).some((t) => COMPARISON_TOKENS.has(t));
}

// The pageType a cluster's DEDICATED page would take. Clusters never mint a
// duplicate home/hub/service/location page (those are skeleton, from the brief);
// a strong cluster earns an ADDITIONAL page under its structural parent:
//   both service + area link -> service_location (conversion landing page);
//   comparison keyword (vs/versus/compare) -> comparison;
//   question-led keyword (how/what/...) -> faq;
//   everything else -> resource (guide/topic page).
function mapDedicatedPageType(cluster: PagePlanCluster, ruleset: PagePlanRuleset): PageType {
  if (cluster.serviceId !== null && cluster.serviceAreaId !== null) return 'service_location';
  if (hasComparisonToken(cluster.primaryKeyword)) return 'comparison';
  if (leadsWithQuestionWord(cluster.primaryKeyword, ruleset.fold.questionWords)) return 'faq';
  return 'resource';
}

// ---------------------------------------------------------------------------
// Skeleton builder
// ---------------------------------------------------------------------------

interface Skeleton {
  pages: WorkingPage[];
  home: WorkingPage;
  servicesHub: WorkingPage | null;
  locationsHub: WorkingPage | null;
  servicePageByServiceId: Map<string, WorkingPage>;
  locationPageByAreaId: Map<string, WorkingPage>;
}

function newSkeletonPage(
  init: Pick<WorkingPage, 'logicalId' | 'pageType' | 'slug' | 'title' | 'h1' | 'parentLogicalId'>,
): WorkingPage {
  return {
    ...init,
    primaryKeywordId: null,
    primaryKeyword: null,
    isSkeleton: true,
    ownerClusterId: null,
    clusterIds: [],
    sections: [],
    scoreBreakdown: null,
    scoreConfidence: null,
    firedSignalCount: 0,
    ownVolume: null,
    warnings: [],
  };
}

// Builds the structural skeleton from the brief BEFORE any cluster placement.
// Order of creation is fixed (home, services hub, service pages, locations hub,
// location pages, contact, company) so the shared slug registry assigns suffixes
// deterministically. Services/areas are iterated in id order for shuffle-proof
// determinism (their brief array order is not relied upon).
function buildSkeleton(
  brief: PagePlanBriefFacts,
  ruleset: PagePlanRuleset,
  slugRegistry: Set<string>,
  logicalIds: Set<string>,
): Skeleton {
  const pages: WorkingPage[] = [];
  const businessName = brief.businessName;
  const mkId = (pageType: PageType, ...keyParts: string[]): string =>
    dedupeLogicalId(logicalIds, buildLogicalId(pageType, ...keyParts));

  const home = newSkeletonPage({
    logicalId: mkId('home'),
    pageType: 'home',
    slug: dedupeSlug(slugRegistry, buildSlug('home', [])),
    title: buildTitle({ pageType: 'home', businessName, category: brief.category }),
    h1: buildH1({ pageType: 'home', businessName }),
    parentLogicalId: null,
  });
  pages.push(home);

  const services = brief.services.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const areas = brief.serviceAreas.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  let servicesHub: WorkingPage | null = null;
  if (services.length >= ruleset.hubs.serviceHubMinChildren) {
    servicesHub = newSkeletonPage({
      logicalId: mkId('hub', 'services'),
      pageType: 'hub',
      slug: dedupeSlug(slugRegistry, buildSlug('hub', ['Services'])),
      title: buildTitle({ pageType: 'hub', businessName, hubLabel: 'Services' }),
      h1: buildH1({ pageType: 'hub', businessName, hubLabel: 'Services' }),
      parentLogicalId: home.logicalId,
    });
    pages.push(servicesHub);
  }

  const servicePageByServiceId = new Map<string, WorkingPage>();
  for (const service of services) {
    const page = newSkeletonPage({
      logicalId: mkId('service', service.normalizedName || service.name),
      pageType: 'service',
      slug: dedupeSlug(slugRegistry, buildSlug('service', [service.name])),
      title: buildTitle({ pageType: 'service', businessName, serviceName: service.name }),
      h1: buildH1({ pageType: 'service', businessName, serviceName: service.name }),
      parentLogicalId: (servicesHub ?? home).logicalId,
    });
    servicePageByServiceId.set(service.id, page);
    pages.push(page);
  }

  let locationsHub: WorkingPage | null = null;
  const locationPageByAreaId = new Map<string, WorkingPage>();
  if (areas.length > 0) {
    if (areas.length >= ruleset.hubs.locationHubMinChildren) {
      locationsHub = newSkeletonPage({
        logicalId: mkId('hub', 'locations'),
        pageType: 'hub',
        slug: dedupeSlug(slugRegistry, buildSlug('hub', ['Locations'])),
        title: buildTitle({ pageType: 'hub', businessName, hubLabel: 'Locations' }),
        h1: buildH1({ pageType: 'hub', businessName, hubLabel: 'Locations' }),
        parentLogicalId: home.logicalId,
      });
      pages.push(locationsHub);
    }
    for (const area of areas) {
      const page = newSkeletonPage({
        logicalId: mkId('location', area.city),
        pageType: 'location',
        slug: dedupeSlug(slugRegistry, buildSlug('location', [area.city])),
        title: buildTitle({ pageType: 'location', businessName, cityName: area.city, category: brief.category }),
        h1: buildH1({ pageType: 'location', businessName, cityName: area.city, category: brief.category }),
        parentLogicalId: (locationsHub ?? home).logicalId,
      });
      locationPageByAreaId.set(area.id, page);
      pages.push(page);
    }
  }

  const contact = newSkeletonPage({
    logicalId: mkId('contact'),
    pageType: 'contact',
    slug: dedupeSlug(slugRegistry, buildSlug('contact', ['contact'])),
    title: buildTitle({ pageType: 'contact', businessName }),
    h1: buildH1({ pageType: 'contact', businessName }),
    parentLogicalId: home.logicalId,
  });
  pages.push(contact);

  const company = newSkeletonPage({
    logicalId: mkId('company'),
    pageType: 'company',
    slug: dedupeSlug(slugRegistry, buildSlug('company', ['about'])),
    title: buildTitle({ pageType: 'company', businessName, hubLabel: 'About' }),
    h1: buildH1({ pageType: 'company', businessName, hubLabel: 'About' }),
    parentLogicalId: home.logicalId,
  });
  pages.push(company);

  return { pages, home, servicesHub, locationsHub, servicePageByServiceId, locationPageByAreaId };
}

// ---------------------------------------------------------------------------
// Doorway-guardrail adapters (build the exact shapes doorway.ts expects)
// ---------------------------------------------------------------------------

function clusterSummary(cluster: PagePlanCluster): KeywordClusterSummary {
  return {
    id: cluster.clusterId,
    label: cluster.label,
    keywordCount: 1,
    totalSearchVolume: cluster.addressableVolume,
    hasLocalizedEvidence: cluster.hasLocalizedEvidence,
  };
}

// doorway.ts's Service/ServiceArea are the NormalizedProjectBrief shapes; the
// engine only has the PagePlanBriefFacts projection, so fill the fields those
// evaluators never read (description/synonyms, countryIso/radiusKm) with safe
// defaults. Only name/uniqueProof/city actually drive the decision.
function serviceForDoorway(svc: PagePlanBriefFacts['services'][number]): NormalizedProjectBrief['services'][number] {
  return {
    id: svc.id,
    name: svc.name,
    normalizedName: svc.normalizedName,
    description: null,
    synonyms: [],
    priority: svc.priority,
  };
}

function areaForDoorway(
  area: PagePlanBriefFacts['serviceAreas'][number],
  countryIso: string,
): NormalizedProjectBrief['serviceAreas'][number] {
  return {
    id: area.id,
    city: area.city,
    region: area.region,
    countryIso,
    radiusKm: null,
    isPrimary: area.isPrimary,
    uniqueProof: area.uniqueProof,
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

interface PlanState {
  pages: WorkingPage[];
  pageByLogicalId: Map<string, WorkingPage>;
  claimedPrimaryKeyword: Map<string, string>; // normalized keyword -> owning logicalId
  // Cluster-minted pages keyed by (parentLogicalId + cleaned display name), so a
  // later cluster that cleans to the same name under the same parent folds into
  // the existing page instead of minting a numeric-suffixed twin (pp-v3, spec 3.2).
  dedicatedByParentName: Map<string, WorkingPage>;
  slugRegistry: Set<string>;
  logicalIds: Set<string>;
  serviceLocationCandidates: PageCandidate[];
  // Borderline service-variant folds surfaced for the Phase D adjudicator (spec 3.3a).
  pendingVariantCases: VariantFoldCase[];
  // Count of clusters that carried BOTH a service and area link but were denied a
  // service_location URL by the guardrail (evaluateServiceLocationPage /
  // detectDoorwayRisk / signal floor). Distinct from cannibalization/demotion
  // folds: this counts ONLY guardrail blocks, so a reviewer can tell "the doorway
  // guardrail suppressed N combinations" from other fold reasons.
  serviceLocationBlocked: number;
}

function toParentCandidate(page: WorkingPage, cluster: PagePlanCluster): ParentCandidate {
  // A structural parent carries no intent/SERP of its own (those pages are
  // brief-derived, not cluster-derived), so distinct_intent/low_serp_overlap
  // stay null-safe absent against it. A dedicated parent that owns a cluster
  // lends that cluster's shape so a child cluster is compared against a real
  // sibling page.
  return {
    logicalId: page.logicalId,
    pageType: page.pageType,
    intent: page.ownerClusterId === cluster.clusterId ? cluster.intent : null,
    serpUrls: null,
    serviceId: page.pageType === 'service_location' || page.pageType === 'service'
      ? serviceIdOf(page)
      : null,
    serviceAreaId: page.pageType === 'service_location' || page.pageType === 'location'
      ? serviceAreaIdOf(page)
      : null,
  };
}

// Structural pages do not track service/area ids on themselves; the parent
// selection maps clusters to them, so a parent's own link is only meaningful for
// unique_conversion, which compares service ids. Kept null here: the signal then
// treats "distinct service" as satisfied whenever the cluster has a service link
// the parent cannot claim, which is the correct default for a structural parent.
function serviceIdOf(_page: WorkingPage): string | null {
  return null;
}
function serviceAreaIdOf(_page: WorkingPage): string | null {
  return null;
}

// Deterministic best structural/planned parent for a cluster (documented in the
// engine header): a service+area cluster hangs under its service page, a
// service-only cluster under its service page, an area-only cluster under its
// location page, everything else under home. Hubs and home are the fallbacks
// when the specific structural page does not exist.
function selectParent(cluster: PagePlanCluster, skeleton: Skeleton): WorkingPage {
  const svc = cluster.serviceId !== null ? skeleton.servicePageByServiceId.get(cluster.serviceId) : undefined;
  const loc = cluster.serviceAreaId !== null ? skeleton.locationPageByAreaId.get(cluster.serviceAreaId) : undefined;

  if (cluster.serviceId !== null && cluster.serviceAreaId !== null) {
    return svc ?? loc ?? skeleton.servicesHub ?? skeleton.home;
  }
  if (cluster.serviceId !== null) {
    return svc ?? skeleton.servicesHub ?? skeleton.home;
  }
  if (cluster.serviceAreaId !== null) {
    return loc ?? skeleton.locationsHub ?? skeleton.home;
  }
  return skeleton.home;
}

// Folds a cluster into an existing page as a section or FAQ entry. For a DEDICATED
// page with no keyword yet (rare) it may promote the cluster's keyword, but for
// SKELETON pages (home/hub/service/location/contact/company) it never claims the
// primary keyword: pp-v3 (spec 3.3b) assigns those best-fit in a second pass
// (assignSkeletonKeywords) rather than first-come-first-served, which used to hand
// the page whichever cluster folded first regardless of fit (the D2/D4 defects).
function foldInto(
  page: WorkingPage,
  cluster: PagePlanCluster,
  as: 'section' | 'faq',
  evals: SignalEvaluation[],
  state: PlanState,
): void {
  page.clusterIds.push(cluster.clusterId);
  page.sections.push({
    heading: cluster.label,
    clusterId: cluster.clusterId,
    keywordIds: [cluster.primaryKeywordId],
  });
  const claimedBy = state.claimedPrimaryKeyword.get(cluster.primaryKeyword);
  if (!page.isSkeleton && page.primaryKeyword === null && claimedBy === undefined) {
    page.primaryKeyword = cluster.primaryKeyword;
    page.primaryKeywordId = cluster.primaryKeywordId;
    page.ownerClusterId = cluster.clusterId;
    page.scoreBreakdown = scoreBreakdownFrom(evals);
    page.scoreConfidence = cluster.confidence;
    page.firedSignalCount = presentStrongSignals(evals).length;
    page.ownVolume = cluster.addressableVolume;
    state.claimedPrimaryKeyword.set(cluster.primaryKeyword, page.logicalId);
  }
}

interface PlacedCluster {
  cluster: PagePlanCluster;
  evals: SignalEvaluation[];
  fired: StrongSignal[];
}

type VariantVerdict =
  | { kind: 'none' }
  | { kind: 'fold' }
  | { kind: 'borderline'; extraToken: string };

const NUMBER_TOKEN = /^\d+$/;

// Service-variant classification (pp-v3, spec 3.3a). A commercial/transactional
// cluster linked to a service (and NOT to an area: area-linked clusters follow
// the service_location guardrail) is a "variant" of that service page when its
// cleaned keyword tokens are covered by the service's name tokens plus the
// ruleset's generic modifier tokens. Number tokens ("24", "7") never count as an
// extra. Zero non-number extras -> a clean fold; exactly one -> a borderline case
// the adjudicator resolves; two or more -> a genuinely distinct offering (none).
function classifyServiceVariant(
  cluster: PagePlanCluster,
  service: PagePlanBriefFacts['services'][number],
  ruleset: PagePlanRuleset,
): VariantVerdict {
  if (cluster.intent !== 'commercial' && cluster.intent !== 'transactional') return { kind: 'none' };
  const serviceTokens = new Set<string>([...tokens(service.normalizedName), ...tokens(cleanKeywordForNaming(service.name))]);
  const clusterTokens = tokens(cleanKeywordForNaming(cluster.primaryKeyword));
  const clusterTokenSet = new Set(clusterTokens);
  // The keyword must actually NAME the service (every service-name token appears
  // in it); otherwise "drain repair" would look like a variant of "Plumbing" just
  // because "repair" is a generic modifier. A variant is the service plus modifiers.
  for (const t of serviceTokens) {
    if (!clusterTokenSet.has(t)) return { kind: 'none' };
  }
  const allowed = new Set<string>([...ruleset.variantFold.genericTokens, ...serviceTokens]);
  const nonNumberExtras = clusterTokens.filter((t) => !allowed.has(t) && !NUMBER_TOKEN.test(t));
  if (nonNumberExtras.length === 0) return { kind: 'fold' };
  if (nonNumberExtras.length === 1) return { kind: 'borderline', extraToken: nonNumberExtras[0] };
  return { kind: 'none' };
}

// One cluster's placement decision, appended to state. Returns the
// PlacementDecision for write-back. The order of guards is spec-critical:
// primary-keyword cannibalization first (a claimed keyword can never mint a
// second page), then the service-location guardrail, then the general
// signal-count separate-vs-fold rule.
function placeCluster(
  placed: PlacedCluster,
  parent: WorkingPage,
  facts: PagePlanFacts,
  ruleset: PagePlanRuleset,
  state: PlanState,
  warnings: BlueprintWarning[],
): PlacementDecision {
  const { cluster, evals, fired } = placed;
  const reasons: string[] = [];

  // Cannibalization: a later cluster whose primary keyword another page already
  // claims folds into that page as a section (never a second URL for the same
  // query). Uniqueness-by-construction for primary keywords.
  const claimedBy = state.claimedPrimaryKeyword.get(cluster.primaryKeyword);
  if (claimedBy !== undefined) {
    const owner = state.pageByLogicalId.get(claimedBy)!;
    foldInto(owner, cluster, 'section', evals, state);
    reasons.push(`Primary keyword "${cluster.primaryKeyword}" already claimed by ${owner.logicalId}; folded as a section.`);
    warnings.push(warn(
      'cannibalization_risk', 'warning',
      `Cluster "${cluster.label}" shares primary keyword "${cluster.primaryKeyword}" with ${owner.logicalId}; folded in to avoid two pages targeting one query.`,
      [owner.logicalId],
    ));
    return { clusterId: cluster.clusterId, placement: 'section', targetLogicalId: owner.logicalId, strongSignals: fired, reasons };
  }

  // Service-variant fold (spec 3.3a): a commercial/transactional cluster whose
  // cleaned tokens are covered by its service's name + generic modifiers is a
  // variant of the service page, never a new /resources/ page. Runs before the
  // strong-signal separate decision (folds regardless of signal count) and only
  // for area-less service clusters (area-linked clusters follow the
  // service_location guardrail below). A borderline verdict still folds but is
  // surfaced to the Phase D adjudicator instead of being minted or silently kept.
  if (cluster.serviceId !== null && cluster.serviceAreaId === null) {
    const service = facts.brief.services.find((s) => s.id === cluster.serviceId);
    if (service !== undefined) {
      const verdict = classifyServiceVariant(cluster, service, ruleset);
      if (verdict.kind === 'fold' || verdict.kind === 'borderline') {
        foldInto(parent, cluster, 'section', evals, state);
        if (verdict.kind === 'borderline') {
          state.pendingVariantCases.push({
            clusterId: cluster.clusterId,
            serviceId: service.id,
            keyword: cluster.primaryKeyword,
            extraToken: verdict.extraToken,
          });
          reasons.push(`Service variant of "${service.name}" (borderline: extra token "${verdict.extraToken}"); folded as a section on ${parent.logicalId}, pending adjudication.`);
        } else {
          reasons.push(`Service variant of "${service.name}"; folded as a section on ${parent.logicalId}.`);
        }
        return { clusterId: cluster.clusterId, placement: 'section', targetLogicalId: parent.logicalId, strongSignals: fired, reasons };
      }
    }
  }

  const pageType = mapDedicatedPageType(cluster, ruleset);
  const meetsSignalFloor = fired.length >= ruleset.separate.minStrongSignals;

  // Service-location guardrail (spec-critical, handoff §2.3): a service_location
  // URL is minted ONLY when the cluster carries BOTH links, clears the signal
  // floor, AND passes evaluateServiceLocationPage + detectDoorwayRisk. Anything
  // short of that becomes a section on the service page with a warning; a
  // service x location combination no cluster demanded is never generated.
  if (pageType === 'service_location') {
    const service = facts.brief.services.find((s) => s.id === cluster.serviceId);
    const area = facts.brief.serviceAreas.find((a) => a.id === cluster.serviceAreaId);
    const parentForFold = parent;
    if (service === undefined || area === undefined) {
      foldInto(parentForFold, cluster, 'section', evals, state);
      reasons.push('Service or area link does not resolve to a brief entry; folded as a section.');
      return { clusterId: cluster.clusterId, placement: 'section', targetLogicalId: parentForFold.logicalId, strongSignals: fired, reasons };
    }
    const decision = evaluateServiceLocationPage(
      serviceForDoorway(service), areaForDoorway(area, facts.brief.countryIso), clusterSummary(cluster), ruleset.doorway,
    );
    const candidateTitle = buildTitle({ pageType: 'service_location', businessName: facts.brief.businessName, serviceName: service.name, cityName: area.city });
    const candidate: PageCandidate = {
      clientId: cluster.clusterId,
      type: 'service_location',
      title: candidateTitle,
      proposedSlug: buildSlug('service_location', [service.name, area.city]),
      serviceId: service.id,
      serviceAreaId: area.id,
      primaryKeywordNormalized: cluster.primaryKeyword,
      uniqueProof: area.uniqueProof,
    };
    const doorwayWarnings = detectDoorwayRisk(candidate, state.serviceLocationCandidates, {} as NormalizedProjectBrief, ruleset.doorway);
    const hardDoorway = doorwayWarnings.some((w) => w.code === 'doorway_risk' || w.code === 'thin_content_risk');

    if (decision.allowed && meetsSignalFloor && !hardDoorway) {
      state.serviceLocationCandidates.push(candidate);
      const page = createDedicatedPage(placed, 'service_location', parent, service.name, area.city, facts, state);
      reasons.push(`Service-location page earned: ${fired.length} strong signals, unique local proof present, doorway checks passed.`);
      for (const w of decision.warnings) warnings.push(w);
      return { clusterId: cluster.clusterId, placement: 'dedicated_page', targetLogicalId: page.logicalId, strongSignals: fired, reasons };
    }

    foldInto(parentForFold, cluster, 'section', evals, state);
    state.serviceLocationBlocked++;
    const why = !decision.allowed ? decision.reasons.join(', ') || 'guardrail not satisfied'
      : !meetsSignalFloor ? `only ${fired.length} strong signal(s), needs ${ruleset.separate.minStrongSignals}`
        : 'doorway risk detected';
    reasons.push(`Service-location page not justified (${why}); folded as a section on ${parentForFold.logicalId}.`);
    warnings.push(warn(
      'doorway_risk', 'warning',
      `"${candidateTitle}" was not created as a separate page (${why}); covered as a section on ${parentForFold.logicalId} instead.`,
      [parentForFold.logicalId],
    ));
    for (const w of decision.warnings) warnings.push(w);
    for (const w of doorwayWarnings) warnings.push(w);
    return { clusterId: cluster.clusterId, placement: 'section', targetLogicalId: parentForFold.logicalId, strongSignals: fired, reasons };
  }

  // General separate-vs-fold: >= minStrongSignals -> dedicated page; else fold
  // as the section/FAQ shouldFold picks.
  if (meetsSignalFloor) {
    // Cleaned-name collision (spec 3.2): if a cluster page under this same parent
    // already carries this cleaned name, fold in rather than mint a numeric-suffixed
    // twin (the /resources/drain-cleaning-2/ defect). Distinct from primary-keyword
    // cannibalization above: those keywords differ raw but clean to one name.
    const cleanedName = cleanKeywordForNaming(cluster.primaryKeyword);
    const twin = state.dedicatedByParentName.get(cleanedNameKey(parent.logicalId, [cleanedName]));
    if (twin !== undefined) {
      foldInto(twin, cluster, 'section', evals, state);
      reasons.push(`Cleaned page name "${cleanedName}" already used by ${twin.logicalId} under the same parent; folded as a section rather than minting a duplicate.`);
      warnings.push(warn(
        'cannibalization_risk', 'warning',
        `Cluster "${cluster.label}" (keyword "${cluster.primaryKeyword}") cleans to the same page name as ${twin.logicalId} (keyword "${twin.primaryKeyword ?? cleanedName}"); folded in to avoid two pages for one query intent.`,
        [twin.logicalId],
      ));
      return { clusterId: cluster.clusterId, placement: 'section', targetLogicalId: twin.logicalId, strongSignals: fired, reasons };
    }
    const page = createDedicatedPage(placed, pageType, parent, cleanedName, null, facts, state);
    reasons.push(`${fired.length} strong signals cleared the separate-page floor (${ruleset.separate.minStrongSignals}); ${fired.join(', ')}.`);
    return { clusterId: cluster.clusterId, placement: 'dedicated_page', targetLogicalId: page.logicalId, strongSignals: fired, reasons };
  }

  const fold = shouldFold(cluster, toParentCandidate(parent, cluster), facts, ruleset);
  foldInto(parent, cluster, fold.as, evals, state);
  reasons.push(`Below the ${ruleset.separate.minStrongSignals}-signal floor (${fired.length} fired); ${fold.reason}`);
  return { clusterId: cluster.clusterId, placement: fold.as, targetLogicalId: parent.logicalId, strongSignals: fired, reasons };
}

// Collision key for the cleaned-name fold registry (spec 3.2): a parent logical
// id plus the lowercased cleaned display parts a page was minted from. Two
// cluster pages collide only when they share a parent AND clean to the same
// name, which is exactly the duplicate-intent case that must fold, never suffix.
function cleanedNameKey(parentLogicalId: string, nameParts: string[]): string {
  return [parentLogicalId, ...nameParts.map((p) => p.trim().toLowerCase())].join(' ');
}

// Mints a dedicated page for a cluster: unique logical id + slug by construction
// (shared registries), primary keyword claimed, score breakdown attached.
function createDedicatedPage(
  placed: PlacedCluster,
  pageType: PageType,
  parent: WorkingPage,
  namePart: string,
  cityPart: string | null,
  facts: PagePlanFacts,
  state: PlanState,
): WorkingPage {
  const { cluster, evals, fired } = placed;
  const businessName = facts.brief.businessName;

  const keyParts = cityPart !== null ? [namePart, cityPart] : [namePart];
  const logicalId = dedupeLogicalId(state.logicalIds, buildLogicalId(pageType, ...keyParts));

  const slugParts = cityPart !== null ? [namePart, cityPart] : [namePart];
  const slug = dedupeSlug(state.slugRegistry, buildSlug(pageType, slugParts));

  const titleParts = {
    pageType, businessName,
    serviceName: pageType === 'service_location' ? namePart : null,
    cityName: cityPart,
    primaryKeyword: cluster.primaryKeyword,
  };
  const page: WorkingPage = {
    logicalId,
    pageType,
    slug,
    title: buildTitle(titleParts),
    h1: buildH1(titleParts),
    parentLogicalId: parent.logicalId,
    primaryKeywordId: cluster.primaryKeywordId,
    primaryKeyword: cluster.primaryKeyword,
    isSkeleton: false,
    ownerClusterId: cluster.clusterId,
    clusterIds: [cluster.clusterId],
    sections: [],
    scoreBreakdown: scoreBreakdownFrom(evals),
    scoreConfidence: cluster.confidence,
    firedSignalCount: fired.length,
    ownVolume: cluster.addressableVolume,
    warnings: [],
  };
  state.pages.push(page);
  state.pageByLogicalId.set(logicalId, page);
  state.claimedPrimaryKeyword.set(cluster.primaryKeyword, logicalId);
  state.dedicatedByParentName.set(cleanedNameKey(parent.logicalId, keyParts), page);
  return page;
}

// ---------------------------------------------------------------------------
// Page-cap demotion
// ---------------------------------------------------------------------------

// Demotes the weakest dedicated pages to sections on their parent until the plan
// fits pageBudget. Skeleton pages are never demoted. A demoted page's cluster
// folds into its parent (its primary-keyword claim released), earning an
// inventory_limited warning.
function applyPageBudget(
  state: PlanState,
  clusterById: Map<string, PagePlanCluster>,
  evalsByCluster: Map<string, SignalEvaluation[]>,
  pageBudget: number,
  warnings: BlueprintWarning[],
): number {
  let demoted = 0;
  while (state.pages.length > pageBudget) {
    const dedicated = state.pages.filter((p) => !p.isSkeleton);
    if (dedicated.length === 0) break; // only skeleton left; cannot demote further
    dedicated.sort(compareForDemotion);
    const victim = dedicated[0];
    const parent = victim.parentLogicalId !== null ? state.pageByLogicalId.get(victim.parentLogicalId) : undefined;
    const target = parent ?? state.pageByLogicalId.get(state.pages[0].logicalId)!; // home is pages[0]

    // Release the victim's page and re-home every cluster it carried onto the
    // parent as sections. Its owner cluster's primary-keyword claim moves too.
    state.pages = state.pages.filter((p) => p.logicalId !== victim.logicalId);
    state.pageByLogicalId.delete(victim.logicalId);
    for (const w of warnings) {
      w.relatedPageIds = w.relatedPageIds.filter((id) => id !== victim.logicalId);
    }
    for (const clusterId of victim.clusterIds) {
      state.claimedPrimaryKeyword.delete(clusterById.get(clusterId)?.primaryKeyword ?? '');
    }
    for (const clusterId of victim.clusterIds) {
      const cluster = clusterById.get(clusterId);
      if (cluster === undefined) continue;
      foldInto(target, cluster, 'section', evalsByCluster.get(clusterId) ?? [], state);
    }
    warnings.push(warn(
      'inventory_limited', 'warning',
      `Page budget ${pageBudget} reached; "${victim.title}" demoted to a section on ${target.logicalId}.`,
      [target.logicalId],
    ));
    demoted++;
  }
  return demoted;
}

// ---------------------------------------------------------------------------
// Best-fit skeleton keyword assignment (pp-v3, spec 3.3b)
// ---------------------------------------------------------------------------

// Assigns each skeleton service/location/home page its best-fit primary keyword
// AFTER all placement + demotion, replacing pp-v2's first-come-first-served claim.
// Rules (spec 3.3b):
//   - service page: highest-volume folded keyword whose tokens contain every
//     service-name token (so /services/drain-cleaning/ gets "drain cleaning");
//   - location page: highest-volume folded keyword carrying the city token AND at
//     least one category/service token (never bare "shower installation austin");
//   - home: a folded keyword that token-matches the category AND a service-area
//     city ("plumber austin"); never a bare head term like "plumber".
// Global claim-uniqueness is preserved: dedicated pages already registered their
// keywords in claimedPrimaryKeyword, and each assignment registers its pick so no
// two pages claim one keyword. Deterministic: pages are processed services-by-slug,
// then locations-by-slug, then home, and candidates break ties by volume DESC,
// keyword ASC, cluster id ASC.
function assignSkeletonKeywords(
  state: PlanState,
  skeleton: Skeleton,
  brief: PagePlanBriefFacts,
  clusterById: Map<string, PagePlanCluster>,
  evalsByCluster: Map<string, SignalEvaluation[]>,
): void {
  const claimed = state.claimedPrimaryKeyword;
  const categoryTokens = new Set(tokens(brief.category));
  const allServiceTokens = new Set<string>();
  for (const s of brief.services) {
    for (const t of tokens(s.normalizedName)) allServiceTokens.add(t);
    for (const t of tokens(cleanKeywordForNaming(s.name))) allServiceTokens.add(t);
  }
  const areaCityTokens = new Set<string>();
  for (const a of brief.serviceAreas) for (const t of tokens(a.city)) areaCityTokens.add(t);

  const pickBest = (page: WorkingPage, predicate: (c: PagePlanCluster) => boolean): PagePlanCluster | undefined => {
    const candidates = page.clusterIds
      .map((id) => clusterById.get(id))
      .filter((c): c is PagePlanCluster => c !== undefined && c.primaryKeyword !== '' && !claimed.has(c.primaryKeyword) && predicate(c));
    candidates.sort((a, b) => {
      const va = a.addressableVolume ?? -1;
      const vb = b.addressableVolume ?? -1;
      if (va !== vb) return vb - va;
      if (a.primaryKeyword !== b.primaryKeyword) return a.primaryKeyword < b.primaryKeyword ? -1 : 1;
      return a.clusterId < b.clusterId ? -1 : 1;
    });
    return candidates[0];
  };

  const assign = (page: WorkingPage, cluster: PagePlanCluster): void => {
    const evals = evalsByCluster.get(cluster.clusterId) ?? [];
    page.primaryKeyword = cluster.primaryKeyword;
    page.primaryKeywordId = cluster.primaryKeywordId;
    page.ownerClusterId = cluster.clusterId;
    page.scoreBreakdown = scoreBreakdownFrom(evals);
    page.scoreConfidence = cluster.confidence;
    page.firedSignalCount = presentStrongSignals(evals).length;
    page.ownVolume = cluster.addressableVolume;
    claimed.set(cluster.primaryKeyword, page.logicalId);
  };

  const containsAll = (keyword: string, need: Set<string>): boolean => {
    const kt = new Set(tokens(keyword));
    for (const t of need) if (!kt.has(t)) return false;
    return true;
  };
  const containsAny = (keyword: string, options: Set<string>): boolean => {
    for (const t of tokens(keyword)) if (options.has(t)) return true;
    return false;
  };

  const servicePages = [...skeleton.servicePageByServiceId.entries()]
    .map(([sid, page]) => ({ page, service: brief.services.find((s) => s.id === sid) }))
    .filter((x): x is { page: WorkingPage; service: PagePlanBriefFacts['services'][number] } => x.service !== undefined)
    .sort((a, b) => (a.page.slug < b.page.slug ? -1 : a.page.slug > b.page.slug ? 1 : 0));
  for (const { page, service } of servicePages) {
    if (page.primaryKeyword !== null) continue;
    const svcTokens = new Set<string>([...tokens(service.normalizedName), ...tokens(cleanKeywordForNaming(service.name))]);
    const best = pickBest(page, (c) => containsAll(c.primaryKeyword, svcTokens));
    if (best !== undefined) assign(page, best);
  }

  const locationPages = [...skeleton.locationPageByAreaId.entries()]
    .map(([aid, page]) => ({ page, area: brief.serviceAreas.find((a) => a.id === aid) }))
    .filter((x): x is { page: WorkingPage; area: PagePlanBriefFacts['serviceAreas'][number] } => x.area !== undefined)
    .sort((a, b) => (a.page.slug < b.page.slug ? -1 : a.page.slug > b.page.slug ? 1 : 0));
  for (const { page, area } of locationPages) {
    if (page.primaryKeyword !== null) continue;
    const cityTokens = new Set(tokens(area.city));
    const best = pickBest(page, (c) =>
      containsAny(c.primaryKeyword, cityTokens)
      && (containsAny(c.primaryKeyword, categoryTokens) || containsAny(c.primaryKeyword, allServiceTokens)));
    if (best !== undefined) assign(page, best);
  }

  if (skeleton.home.primaryKeyword === null) {
    const best = pickBest(skeleton.home, (c) =>
      containsAny(c.primaryKeyword, categoryTokens) && containsAny(c.primaryKeyword, areaCityTokens));
    if (best !== undefined) assign(skeleton.home, best);
  }
}

// ---------------------------------------------------------------------------
// Freeze: WorkingPage[] -> PlannedPage[]
// ---------------------------------------------------------------------------

// Per-page addressable demand: sum of the non-null volumes of the clusters that
// landed on the page (owner + folded sections), each counted once. null when the
// page carries no cluster with a volume (never 0-for-missing).
function pageAddressableVolume(page: WorkingPage, clusterById: Map<string, PagePlanCluster>): number | null {
  let sum = 0;
  let sawVolume = false;
  for (const clusterId of page.clusterIds) {
    const v = clusterById.get(clusterId)?.addressableVolume ?? null;
    if (v !== null) {
      sum += v;
      sawVolume = true;
    }
  }
  return sawVolume ? sum : null;
}

// The evidence-ref ids a page's decision rests on: the deduped, sorted union of
// every cluster placed on the page (dedicated owner + folded sections). A
// skeleton-only page (home/hub/contact/company with no cluster) keeps [] with no
// warning: it is brief-derived structure, not an evidence-backed page decision,
// so there is no evidence to cite.
function pageEvidenceRefs(page: WorkingPage, clusterById: Map<string, PagePlanCluster>): string[] {
  const refs = new Set<string>();
  for (const clusterId of page.clusterIds) {
    for (const ref of clusterById.get(clusterId)?.evidenceRefIds ?? []) refs.add(ref);
  }
  return [...refs].sort();
}

// A page's ranked secondary keywords (spec 3.7): the member keywords of every
// cluster on the page (owner + folded sections), minus the page's primary keyword,
// deduped (keeping each keyword's highest observed volume), volume DESC then
// keyword ASC, capped at storeCap. Deterministic.
function pageSupportingKeywords(
  page: WorkingPage,
  clusterById: Map<string, PagePlanCluster>,
  storeCap: number,
): string[] {
  const byKeyword = new Map<string, number | null>();
  for (const clusterId of page.clusterIds) {
    const cluster = clusterById.get(clusterId);
    if (cluster === undefined) continue;
    for (const member of cluster.memberKeywords) {
      if (member.keyword === '' || member.keyword === page.primaryKeyword) continue;
      const existing = byKeyword.get(member.keyword);
      if (existing === undefined || (member.volume ?? -1) > (existing ?? -1)) {
        byKeyword.set(member.keyword, member.volume);
      }
    }
  }
  return [...byKeyword.entries()]
    .sort((a, b) => {
      const va = a[1] ?? -1;
      const vb = b[1] ?? -1;
      if (va !== vb) return vb - va;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .slice(0, storeCap)
    .map(([keyword]) => keyword);
}

function freeze(page: WorkingPage, clusterById: Map<string, PagePlanCluster>, ruleset: PagePlanRuleset): PlannedPage {
  return {
    logicalId: page.logicalId,
    pageType: page.pageType,
    slug: page.slug,
    title: page.title,
    h1: page.h1,
    parentLogicalId: page.parentLogicalId,
    primaryKeywordId: page.primaryKeywordId,
    primaryKeyword: page.primaryKeyword,
    clusterIds: page.clusterIds.slice(),
    sections: page.sections.slice(),
    supportingKeywords: pageSupportingKeywords(page, clusterById, ruleset.supporting.storeCap),
    metaDescription: null,
    recommendation: 'create',
    // build_page_plan only ever proposes new pages; overlay_existing_site (stage 16)
    // is where a consolidate target would later be attached.
    consolidateTargetLogicalId: null,
    scores: {
      addressableVolume: pageAddressableVolume(page, clusterById),
      confidence: page.scoreConfidence,
      scoreBreakdown: page.scoreBreakdown,
      evidenceRefs: pageEvidenceRefs(page, clusterById),
    },
    warnings: page.warnings.slice(),
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildPagePlan(
  facts: PagePlanFacts,
  ruleset: PagePlanRuleset,
  options: PagePlanOptions,
): PagePlanResult {
  const warnings: BlueprintWarning[] = [];
  const slugRegistry = new Set<string>();
  const logicalIds = new Set<string>();
  const skeleton = buildSkeleton(facts.brief, ruleset, slugRegistry, logicalIds);

  const state: PlanState = {
    pages: skeleton.pages.slice(),
    pageByLogicalId: new Map(skeleton.pages.map((p) => [p.logicalId, p])),
    claimedPrimaryKeyword: new Map(),
    dedicatedByParentName: new Map(),
    slugRegistry,
    logicalIds,
    serviceLocationCandidates: [],
    pendingVariantCases: [],
    serviceLocationBlocked: 0,
  };

  const clusterById = new Map(facts.clusters.map((c) => [c.clusterId, c]));
  const evalsByCluster = new Map<string, SignalEvaluation[]>();
  const placements: PlacementDecision[] = [];

  const ordered = facts.clusters.slice().sort(compareClusters);
  for (const cluster of ordered) {
    const parent = selectParent(cluster, skeleton);
    const evals = evaluateStrongSignals(cluster, toParentCandidate(parent, cluster), facts, ruleset);
    evalsByCluster.set(cluster.clusterId, evals);
    const fired = presentStrongSignals(evals);
    placements.push(placeCluster({ cluster, evals, fired }, parent, facts, ruleset, state, warnings));
  }

  const demotedPageCount = applyPageBudget(state, clusterById, evalsByCluster, options.pageBudget, warnings);

  // Best-fit primary keyword for each skeleton service/location/home page, over
  // the final (post-demotion) page membership (pp-v3, spec 3.3b).
  assignSkeletonKeywords(state, skeleton, facts.brief, clusterById, evalsByCluster);

  if (facts.clusters.length === 0) {
    warnings.push(warn('partial_evidence', 'info', 'No clusters available; emitted the brief-derived skeleton only.'));
  }

  const pages = state.pages.map((p) => freeze(p, clusterById, ruleset));

  // Plan-wide addressable demand: each cluster counted once (it lands on exactly
  // one page), summing only non-null volumes. null when nothing carried a volume.
  let totalVolume = 0;
  let sawVolume = false;
  for (const cluster of facts.clusters) {
    if (cluster.addressableVolume !== null) {
      totalVolume += cluster.addressableVolume;
      sawVolume = true;
    }
  }

  const dedicatedPageCount = state.pages.filter((p) => !p.isSkeleton).length;
  const sectionCount = placements.filter((p) => p.placement === 'section').length;
  const faqCount = placements.filter((p) => p.placement === 'faq').length;
  const cannibalizedCount = warnings.filter((w) => w.code === 'cannibalization_risk').length;
  // Only clusters the service-location guardrail actually denied a URL (tracked
  // at the block site), NOT every service+area cluster that folded for some other
  // reason (cannibalization, page-cap demotion).
  const serviceLocationBlockedCount = state.serviceLocationBlocked;

  const stats: PagePlanStats = {
    pageCount: pages.length,
    skeletonPageCount: pages.length - dedicatedPageCount,
    dedicatedPageCount,
    sectionCount,
    faqCount,
    clustersPlaced: facts.clusters.length,
    demotedPageCount,
    cannibalizedCount,
    serviceLocationBlockedCount,
    totalAddressableVolume: sawVolume ? totalVolume : null,
    pageBudget: options.pageBudget,
  };

  const pendingVariantCases = state.pendingVariantCases
    .slice()
    .sort((a, b) => (a.clusterId < b.clusterId ? -1 : a.clusterId > b.clusterId ? 1 : 0));

  return { pages, placements, warnings, stats, pendingVariantCases };
}
