import type {
  BlueprintWarning, KeywordClusterSummary, NormalizedProjectBrief, PageCandidate,
} from '../../contracts/types';
import type { ProjectMode } from '../../contracts/enums';
import { validateBlueprintGraph } from '../graph';
import { detectDoorwayRisk, evaluateServiceLocationPage } from '../doorway';
import type { PagePlanRuleset } from '../page-plan/ruleset';
import type { ComposedBlueprint, ComposedPage } from './compose';

// Stage 18 `validate_blueprint`, part 2 of 2: the pure rule set. Runs
// validateBlueprintGraph first, then the manual rules the deterministic
// validators list (handoff Manual §Stage 16 `validate_blueprint`), classifying
// each finding as BLOCKING (the output is structurally unsound or violates a
// spec guardrail, so it must never publish) or WARNING (suboptimal but
// publishable, surfaced on the published blueprint). No I/O, no clock, no
// random: the handler resolves every fact (page budget, engine warnings, gap
// stages, doorway inputs) and passes them in.

export type ValidationSeverity = 'blocking' | 'warning';

// One validation finding. `subject` is the logical id (or the existing URL, for
// a consolidation) the finding is about, or '-' for a plan-wide finding.
export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  subject: string;
  message: string;
}

// A resolved service_location page ready for the doorway re-check. The handler
// maps each service_location composed page back to its owner cluster's service +
// area + cluster summary (the exact inputs build_page_plan fed
// evaluateServiceLocationPage); a page whose service/area/cluster cannot be
// resolved is simply omitted, so an unresolvable page never blocks (absence is
// never a violation), only a positively-detected guardrail breach does.
export interface ServiceLocationCheck {
  logicalId: string;
  service: NormalizedProjectBrief['services'][number];
  area: NormalizedProjectBrief['serviceAreas'][number];
  cluster: KeywordClusterSummary | null;
}

export interface ValidateContext {
  // Per-run USER page budget (normalized brief maxRecommendedPages), from the
  // plan artifact's stats. The engine caps to this, so a violation is an engine
  // invariant break, not a user error.
  pageBudget: number;
  // Warnings build_page_plan already computed (cannibalization, doorway/thin,
  // missing proof, ...): exposed here as blueprint warnings rather than
  // recomputed (single source of truth).
  engineWarnings: BlueprintWarning[];
  // Upstream stages that ended skipped/partial (loadGapStageNames), disclosed as
  // warnings so the published blueprint states its own gaps.
  gapStages: string[];
  // Whether a stage 16 overlay artifact was present. Absent on an existing-site
  // brief means the existing-site inventory was unavailable (a disclosed gap).
  overlayPresent: boolean;
  mode: ProjectMode;
  serviceLocationChecks: ServiceLocationCheck[];
}

function issue(code: string, severity: ValidationSeverity, subject: string, message: string): ValidationIssue {
  return { code, severity, subject, message };
}

// Rebuilds the PageCandidate shape detectDoorwayRisk compares siblings on, from
// a composed service_location page + its resolved service/area. Mirrors the
// candidate build_page_plan constructs at mint time so the re-check sees the
// same inputs.
function toDoorwayCandidate(page: ComposedPage, check: ServiceLocationCheck): PageCandidate {
  return {
    clientId: page.logicalId,
    type: 'service_location',
    title: page.title,
    proposedSlug: page.slug,
    serviceId: check.service.id,
    serviceAreaId: check.area.id,
    primaryKeywordNormalized: page.primaryKeyword,
    uniqueProof: check.area.uniqueProof,
  };
}

// Total order over issues: code, then subject, then message. Makes the output
// deterministic regardless of the order rules fired.
function compareIssues(a: ValidationIssue, b: ValidationIssue): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

// Sorts and drops exact (code, subject, message) duplicates so a finding two
// validators reach the same way is reported once.
function normalizeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const sorted = [...issues].sort(compareIssues);
  const out: ValidationIssue[] = [];
  for (const it of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.code === it.code && prev.subject === it.subject && prev.message === it.message) continue;
    out.push(it);
  }
  return out;
}

export function validateComposed(
  composed: ComposedBlueprint,
  ruleset: PagePlanRuleset,
  context: ValidateContext,
): { blocking: ValidationIssue[]; warnings: ValidationIssue[] } {
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const pages = composed.pages;
  const idSet = new Set(pages.map((p) => p.logicalId));
  const pageById = new Map(pages.map((p) => [p.logicalId, p]));

  // --- BLOCKING: structural graph (cycle, missing/duplicate root, orphan/
  // missing parent, duplicate slug, duplicate primary keyword). Run first; its
  // failures are always blocking. graph's `orphan` is the canonical
  // parent-existence check ("all parent IDs exist" / "no orphan nodes").
  const graph = validateBlueprintGraph(composed.nodes);
  for (const e of graph.errors) {
    blocking.push(issue(`graph_${e.code}`, 'blocking', e.pageIds.join(',') || '-', e.message));
  }

  // --- BLOCKING: consolidation targets. A page whose own recommendation is
  // 'consolidate' (not produced by the V1 engine, but validated defensively)
  // and every overlay consolidation proposal must target a REAL planned page,
  // never a missing id and never itself.
  for (const page of pages) {
    if (page.recommendation !== 'consolidate') continue;
    const t = page.consolidateTargetLogicalId;
    if (t === null) {
      blocking.push(issue('consolidate_target_missing', 'blocking', page.logicalId, `Page ${page.logicalId} is marked consolidate but names no target.`));
    } else if (t === page.logicalId) {
      blocking.push(issue('consolidate_target_self', 'blocking', page.logicalId, `Page ${page.logicalId} consolidates into itself.`));
    } else if (!idSet.has(t)) {
      blocking.push(issue('consolidate_target_missing', 'blocking', page.logicalId, `Page ${page.logicalId} consolidates into non-existent page ${t}.`));
    }
  }
  for (const c of composed.consolidations) {
    if (c.targetLogicalId === null) {
      blocking.push(issue('consolidate_target_missing', 'blocking', c.existingUrl, `Consolidation of ${c.existingUrl} names no target page.`));
    } else if (!idSet.has(c.targetLogicalId)) {
      blocking.push(issue('consolidate_target_missing', 'blocking', c.existingUrl, `Consolidation of ${c.existingUrl} targets non-existent page ${c.targetLogicalId}.`));
    }
  }

  // --- BLOCKING: page count must not exceed the budget the engine caps to.
  if (pages.length > context.pageBudget) {
    blocking.push(issue('page_budget_exceeded', 'blocking', '-', `Page count ${pages.length} exceeds the page budget ${context.pageBudget}.`));
  }

  // --- BLOCKING: field limits (slug/title length caps).
  for (const page of pages) {
    if (page.slug.length > ruleset.caps.maxSlugChars) {
      blocking.push(issue('slug_too_long', 'blocking', page.logicalId, `Slug for ${page.logicalId} is ${page.slug.length} chars (max ${ruleset.caps.maxSlugChars}).`));
    }
    if (page.title.length > ruleset.caps.maxTitleChars) {
      blocking.push(issue('title_too_long', 'blocking', page.logicalId, `Title for ${page.logicalId} is ${page.title.length} chars (max ${ruleset.caps.maxTitleChars}).`));
    }
  }

  // --- BLOCKING: service_location doorway re-check. The engine mints a
  // service_location URL ONLY after evaluateServiceLocationPage + detectDoorwayRisk
  // pass, so a survivor that FAILS either is an engine invariant break and must
  // never publish silently. Re-run both against the resolved inputs.
  const candidates = context.serviceLocationChecks
    .map((chk) => {
      const page = pageById.get(chk.logicalId);
      return page ? { chk, page, candidate: toDoorwayCandidate(page, chk) } : null;
    })
    .filter((x): x is { chk: ServiceLocationCheck; page: ComposedPage; candidate: PageCandidate } => x !== null);
  const allCandidates = candidates.map((x) => x.candidate);
  for (const { chk, candidate } of candidates) {
    const decision = evaluateServiceLocationPage(chk.service, chk.area, chk.cluster, ruleset.doorway);
    if (!decision.allowed) {
      blocking.push(issue('service_location_doorway', 'blocking', chk.logicalId, `Service-location page ${chk.logicalId} fails the doorway guardrail (${decision.reasons.join(', ') || 'guardrail not satisfied'}).`));
    }
    const siblings = allCandidates.filter((c) => c.clientId !== candidate.clientId);
    const risks = detectDoorwayRisk(candidate, siblings, {} as NormalizedProjectBrief, ruleset.doorway);
    if (risks.some((r) => r.code === 'doorway_risk' || r.code === 'thin_content_risk')) {
      blocking.push(issue('service_location_thin_content', 'blocking', chk.logicalId, `Service-location page ${chk.logicalId} survived with an unresolved doorway/thin-content risk.`));
    }
  }

  // --- WARNING: engine-computed warnings (cannibalization + doorway/thin/proof
  // etc.) exposed on the blueprint ("doorway/cannibalization warnings are
  // resolved or exposed").
  for (const w of context.engineWarnings) {
    const subject = w.relatedPageIds.join(',') || '-';
    warnings.push(issue(`engine_${w.code}`, 'warning', subject, w.message));
  }

  // --- WARNING: partial upstream stages disclosed.
  for (const stage of context.gapStages) {
    warnings.push(issue('upstream_partial', 'warning', stage, `Upstream stage ${stage} did not fully complete; the blueprint discloses the gap.`));
  }

  // --- WARNING: factual page carrying no evidence refs (decision traceability
  // gap). Skeleton structural pages are exempt.
  for (const page of pages) {
    if (!page.isSkeleton && !page.hasEvidence) {
      warnings.push(issue('evidence_missing', 'warning', page.logicalId, `Page ${page.logicalId} carries a factual recommendation with no evidence refs.`));
    }
  }

  // --- WARNING: existing-site brief with no overlay artifact (inventory
  // unavailable).
  if (context.mode === 'existing_site' && !context.overlayPresent) {
    warnings.push(issue('overlay_absent', 'warning', '-', 'Existing-site brief but no overlay artifact; existing-site inventory was unavailable.'));
  }

  // --- WARNING: low-confidence cluster placed as a dedicated page.
  for (const page of pages) {
    if (!page.isSkeleton && page.confidence === 'low') {
      warnings.push(issue('low_confidence_page', 'warning', page.logicalId, `Dedicated page ${page.logicalId} was placed on low-confidence evidence.`));
    }
  }

  return { blocking: normalizeIssues(blocking), warnings: normalizeIssues(warnings) };
}
