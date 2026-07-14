import type { SearchIntent } from '../../contracts/enums';

// Hard constraints that forbid an edge regardless of its similarity score. These
// are pure predicates over caller-provided node facts (brand-token detection is
// the caller's job in Task 10; here isBranded arrives as an input flag).

export type ConstraintViolation =
  | 'branded_navigational_x_generic'
  | 'different_services_same_city_only'
  | 'service_location_x_national_informational'
  | 'incompatible_intent';

export interface ConstraintNode {
  isBranded: boolean;
  intent: SearchIntent | null;
  serviceIds: readonly string[];
  serviceAreaIds: readonly string[];
}

function isBrandedNavigational(n: ConstraintNode): boolean {
  return n.isBranded && n.intent === 'navigational';
}

function isServiceLocation(n: ConstraintNode): boolean {
  return n.serviceIds.length > 0 && n.serviceAreaIds.length > 0;
}

function isNationalInformational(n: ConstraintNode): boolean {
  return n.intent === 'informational' && n.serviceAreaIds.length === 0;
}

function disjoint(a: readonly string[], b: readonly string[]): boolean {
  const setB = new Set(b);
  for (const x of a) if (setB.has(x)) return false;
  return true;
}

function sharesAny(a: readonly string[], b: readonly string[]): boolean {
  const setB = new Set(b);
  for (const x of a) if (setB.has(x)) return true;
  return false;
}

/**
 * Returns every hard-constraint violation for the unordered pair (a, b). A
 * non-empty result means the edge is forbidden: it is excluded from clustering
 * but kept in the graph for reporting. Rules are evaluated in a fixed order so
 * the returned array is deterministic.
 */
export function forbiddenEdgeViolations(a: ConstraintNode, b: ConstraintNode): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  // 1. A branded-navigational node never pairs with a non-branded node.
  if (
    (isBrandedNavigational(a) && !b.isBranded) ||
    (isBrandedNavigational(b) && !a.isBranded)
  ) {
    violations.push('branded_navigational_x_generic');
  }

  // 2. Both have services, the service sets are disjoint, and they share a
  //    service area. A shared city alone is not enough to merge different
  //    services. If they share no area either, there is no affinity claim to
  //    forbid (the low edge score handles it), so this rule does not fire.
  if (
    a.serviceIds.length > 0 &&
    b.serviceIds.length > 0 &&
    disjoint(a.serviceIds, b.serviceIds) &&
    sharesAny(a.serviceAreaIds, b.serviceAreaIds)
  ) {
    violations.push('different_services_same_city_only');
  }

  // 3. One node is a localized service-location page; the other is national
  //    (informational intent with no service area). These do not belong in the
  //    same cluster.
  if (
    (isServiceLocation(a) && isNationalInformational(b)) ||
    (isServiceLocation(b) && isNationalInformational(a))
  ) {
    violations.push('service_location_x_national_informational');
  }

  // 4. Transactional or commercial intent is incompatible with informational.
  //    Unknown/null sides never trigger this.
  if (
    ((a.intent === 'transactional' || a.intent === 'commercial') && b.intent === 'informational') ||
    ((b.intent === 'transactional' || b.intent === 'commercial') && a.intent === 'informational')
  ) {
    violations.push('incompatible_intent');
  }

  return violations;
}
