import type {
  BlueprintWarning, KeywordClusterSummary, NormalizedProjectBrief, PageCandidate,
} from '../contracts/types';

type Service = NormalizedProjectBrief['services'][number];
type ServiceArea = NormalizedProjectBrief['serviceAreas'][number];

export interface DoorwayGuardrailRules {
  requireLocalEvidence: boolean;
  requireUniqueProof: boolean;
  minClusterVolume: number | null;
}

export interface ServiceLocationDecision {
  allowed: boolean;
  reasons: string[];
  warnings: BlueprintWarning[];
}

function warn(code: BlueprintWarning['code'], severity: BlueprintWarning['severity'], message: string): BlueprintWarning {
  return { code, severity, message, relatedPageIds: [], evidenceRefIds: [] };
}

// A service x location page must EARN its URL: local demand evidence plus
// unique local proof. Combinations are never generated automatically.
export function evaluateServiceLocationPage(
  service: Service,
  area: ServiceArea,
  cluster: KeywordClusterSummary | null,
  rules: DoorwayGuardrailRules
): ServiceLocationDecision {
  const reasons: string[] = [];
  const warnings: BlueprintWarning[] = [];

  if (cluster === null) {
    if (rules.requireLocalEvidence) reasons.push('no_local_demand_evidence');
  } else if (rules.minClusterVolume !== null) {
    if (cluster.totalSearchVolume === null) {
      warnings.push(warn('missing_metrics', 'info', `No volume data for "${service.name}" in ${area.city}; volume floor not applied.`));
    } else if (cluster.totalSearchVolume < rules.minClusterVolume) {
      reasons.push('below_volume_floor');
    }
  }

  if (rules.requireUniqueProof && area.uniqueProof.length === 0) {
    reasons.push('missing_unique_proof');
    warnings.push(warn('missing_local_proof', 'warning', `${area.city} has no unique local proof; a "${service.name}" page there risks being a doorway page.`));
  }

  return { allowed: reasons.length === 0, reasons, warnings };
}

export function detectDoorwayRisk(
  candidate: PageCandidate,
  siblingCandidates: PageCandidate[],
  _brief: NormalizedProjectBrief,
  rules: DoorwayGuardrailRules
): BlueprintWarning[] {
  if (candidate.type !== 'service_location') return [];
  const warnings: BlueprintWarning[] = [];

  const locationSwapSiblings = siblingCandidates.filter(
    (s) =>
      s.type === 'service_location' &&
      s.clientId !== candidate.clientId &&
      s.serviceId === candidate.serviceId &&
      s.serviceAreaId !== candidate.serviceAreaId
  );

  if (locationSwapSiblings.length > 0 && candidate.uniqueProof.length === 0) {
    warnings.push(
      warn('doorway_risk', 'warning',
        `"${candidate.title}" differs from ${locationSwapSiblings.length} sibling page(s) only by location and has no unique local content.`)
    );
  }
  if (rules.requireUniqueProof && candidate.uniqueProof.length === 0) {
    warnings.push(warn('thin_content_risk', 'warning', `"${candidate.title}" has no unique local proof to build distinct content from.`));
  }
  return warnings;
}
