import type { PagePlanRuleset } from './ruleset';
import type {
  CompetitorPageFact, FoldDecision, PagePlanCluster, PagePlanFacts,
  ParentCandidate, SignalEvaluation, StrongSignal,
} from './types';

// Pure strong-signal + fold evaluators for the page-plan engine (stage 15).
// Each function reports evidence (present/absent + a reason string) and never
// makes the separate-vs-fold decision itself: that >= minStrongSignals call
// belongs to the engine (Task 16). Everything here is deterministic and
// null-safe: missing evidence yields "signal absent", never an assumed value.

// ---------------------------------------------------------------------------
// SERP overlap (Jaccard) with explicit "not computable" semantics
// ---------------------------------------------------------------------------

function normalizeUrl(u: string): string {
  return u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

// Jaccard of two SERP URL sets. Returns null (not computable) when either set is
// missing or, after normalization, empty. A null overlap can never satisfy a
// "< threshold" or ">= threshold" test, so missing SERP data is always absent.
function serpJaccard(a: string[] | null, b: string[] | null): number | null {
  if (a === null || b === null) return null;
  const sa = new Set(a.map(normalizeUrl).filter(Boolean));
  const sb = new Set(b.map(normalizeUrl).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return null;
  let intersection = 0;
  for (const url of sa) if (sb.has(url)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? null : intersection / union;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ---------------------------------------------------------------------------
// Competitor dedicated-page match heuristic
// ---------------------------------------------------------------------------

// A parsed competitor page is treated as "dedicated to this cluster" when its
// title names the whole topic: every one of the cluster's core tokens appears in
// the page's title tokens. A dedicated page puts its subject in the title, so
// full title coverage is a deterministic, threshold-free proxy. When the parsed
// page has no title tokens at all, fall back to the same all-tokens test over
// its heading tokens. No core tokens => no basis to match => false.
function competitorPageIsDedicated(page: CompetitorPageFact, coreTokens: string[]): boolean {
  if (coreTokens.length === 0) return false;
  const title = new Set(page.titleTokens);
  if (coreTokens.every((t) => title.has(t))) return true;
  if (page.titleTokens.length === 0) {
    const headings = new Set(page.headingTokens);
    return coreTokens.every((t) => headings.has(t));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Individual signal evaluators
// ---------------------------------------------------------------------------

function evalDistinctIntent(cluster: PagePlanCluster, parent: ParentCandidate): SignalEvaluation {
  if (cluster.intent === null || parent.intent === null) {
    return {
      kind: 'distinct_intent',
      present: false,
      reason: `Intent comparison not possible (cluster=${cluster.intent ?? 'unknown'}, parent=${parent.intent ?? 'unknown'}).`,
    };
  }
  const present = cluster.intent !== parent.intent;
  return {
    kind: 'distinct_intent',
    present,
    reason: present
      ? `Cluster intent "${cluster.intent}" differs from parent intent "${parent.intent}".`
      : `Cluster shares the parent's intent "${cluster.intent}".`,
  };
}

function evalLowSerpOverlap(
  cluster: PagePlanCluster, parent: ParentCandidate, ruleset: PagePlanRuleset,
): SignalEvaluation {
  const overlap = serpJaccard(cluster.serp.urls, parent.serpUrls);
  const max = ruleset.separate.lowSerpOverlapMax;
  if (overlap === null) {
    return {
      kind: 'low_serp_overlap',
      present: false,
      reason: 'SERP overlap not computable (missing SERP data for cluster or parent).',
    };
  }
  const present = overlap < max;
  return {
    kind: 'low_serp_overlap',
    present,
    reason: present
      ? `SERP overlap ${round2(overlap)} is below ${max}; cluster ranks apart from the parent.`
      : `SERP overlap ${round2(overlap)} is at or above ${max}; cluster shares the parent's SERP.`,
  };
}

function evalCompetitorDedicatedPages(
  cluster: PagePlanCluster, ruleset: PagePlanRuleset,
): SignalEvaluation {
  const parsed = cluster.competitorPages.filter((p) => p.hasParsedData);
  if (parsed.length === 0) {
    return {
      kind: 'competitor_dedicated_pages',
      present: false,
      reason: 'No parsed competitor pages available for this cluster.',
    };
  }
  const matches = parsed.filter((p) => competitorPageIsDedicated(p, cluster.coreTokens));
  const ratio = matches.length / parsed.length;
  const min = ruleset.separate.dedicatedCompetitorRatioMin;
  const present = ratio >= min;
  return {
    kind: 'competitor_dedicated_pages',
    present,
    reason: `${matches.length}/${parsed.length} parsed competitors (${round2(ratio)}) give this topic a dedicated page; threshold ${min}.`,
  };
}

function evalUniqueConversion(cluster: PagePlanCluster, parent: ParentCandidate): SignalEvaluation {
  const conversionIntent = cluster.intent === 'transactional' || cluster.intent === 'commercial';
  const distinctService = cluster.serviceId !== null && cluster.serviceId !== parent.serviceId;
  const present = conversionIntent && distinctService;
  let reason: string;
  if (!conversionIntent) {
    reason = `Cluster intent "${cluster.intent ?? 'unknown'}" is not a conversion intent.`;
  } else if (!distinctService) {
    reason = cluster.serviceId === null
      ? 'Cluster has a conversion intent but no distinct service link.'
      : `Cluster's service link matches the parent's (${cluster.serviceId}).`;
  } else {
    reason = `Cluster drives a distinct conversion (service ${cluster.serviceId}) apart from the parent.`;
  }
  return { kind: 'unique_conversion', present, reason };
}

function evalSufficientDemand(cluster: PagePlanCluster, ruleset: PagePlanRuleset): SignalEvaluation {
  const min = ruleset.separate.minDemandVolume;
  if (cluster.addressableVolume === null) {
    return {
      kind: 'sufficient_demand',
      present: false,
      reason: 'Addressable volume is missing; demand floor not applied.',
    };
  }
  const present = cluster.addressableVolume >= min;
  return {
    kind: 'sufficient_demand',
    present,
    reason: `Addressable volume ${cluster.addressableVolume} ${present ? 'meets' : 'is below'} the demand floor ${min}.`,
  };
}

function evalUniqueLocalProof(cluster: PagePlanCluster, facts: PagePlanFacts): SignalEvaluation {
  if (cluster.serviceAreaId === null) {
    return {
      kind: 'unique_local_proof',
      present: false,
      reason: 'Cluster is not tied to a service area.',
    };
  }
  if (!cluster.hasLocalizedEvidence) {
    return {
      kind: 'unique_local_proof',
      present: false,
      reason: `Cluster ties to area ${cluster.serviceAreaId} but carries no localized evidence.`,
    };
  }
  const area = facts.brief.serviceAreas.find((a) => a.id === cluster.serviceAreaId);
  const hasProof = area !== undefined && area.uniqueProof.length > 0;
  return {
    kind: 'unique_local_proof',
    present: hasProof,
    reason: hasProof
      ? `Area ${cluster.serviceAreaId} has ${area!.uniqueProof.length} unique local proof point(s).`
      : `Area ${cluster.serviceAreaId} has no unique local proof to build a distinct page from.`,
  };
}

// ---------------------------------------------------------------------------
// Public evaluators
// ---------------------------------------------------------------------------

// Evaluates all six strong signals for a cluster against the parent it would
// attach to. Returns one entry per signal in a stable order (present AND absent,
// each with a reason) so the engine can both count fired signals and explain the
// absent ones in score_breakdown. Choosing a placement from these belongs to the
// engine, not here.
export function evaluateStrongSignals(
  cluster: PagePlanCluster,
  parentCandidate: ParentCandidate,
  facts: PagePlanFacts,
  ruleset: PagePlanRuleset,
): SignalEvaluation[] {
  return [
    evalDistinctIntent(cluster, parentCandidate),
    evalLowSerpOverlap(cluster, parentCandidate, ruleset),
    evalCompetitorDedicatedPages(cluster, ruleset),
    evalUniqueConversion(cluster, parentCandidate),
    evalSufficientDemand(cluster, ruleset),
    evalUniqueLocalProof(cluster, facts),
  ];
}

// Convenience: the names of the signals that fired, in evaluation order.
export function presentStrongSignals(evaluations: SignalEvaluation[]): StrongSignal[] {
  return evaluations.filter((e) => e.present).map((e) => e.kind);
}

// Decides whether a cluster should fold into its parent and, if so, as a section
// or an FAQ. Question-word-led clusters fold as FAQ (checked first: a question
// keyword is the more specific signal, and it holds even with no SERP data).
// Otherwise a high SERP overlap (>= highSerpOverlapMin) folds as a section. The
// separate-page decision is the engine's; this only reports fold candidacy.
// `facts` is part of the evaluator contract but unused by the current rules.
export function shouldFold(
  cluster: PagePlanCluster,
  parentCandidate: ParentCandidate,
  facts: PagePlanFacts,
  ruleset: PagePlanRuleset,
): FoldDecision {
  void facts;
  const leadToken = cluster.primaryKeyword.trim().split(/\s+/)[0] ?? '';
  const questionWords: readonly string[] = ruleset.fold.questionWords;
  if (leadToken !== '' && questionWords.includes(leadToken)) {
    return {
      fold: true,
      as: 'faq',
      reason: `Primary keyword leads with question word "${leadToken}"; fold as an FAQ entry.`,
    };
  }
  const overlap = serpJaccard(cluster.serp.urls, parentCandidate.serpUrls);
  const min = ruleset.fold.highSerpOverlapMin;
  if (overlap !== null && overlap >= min) {
    return {
      fold: true,
      as: 'section',
      reason: `SERP overlap ${round2(overlap)} is at or above ${min}; fold as a section under the parent.`,
    };
  }
  return {
    fold: false,
    as: 'section',
    reason: 'No fold condition met (not question-led; SERP overlap below threshold or not computable).',
  };
}
