import type { ConstraintNode } from './constraints';
import { unionHasHardBlock } from './constraints';

// Deterministic hard rails the LLM cluster adjudicator (Phase D) is validated
// against. The model only ever CHOOSES among allowed actions; these predicates
// decide whether the choice is actually applied. The worst case of a bad LLM
// verdict is therefore no worse than today's behavior (the case stays pending /
// the keyword stays in-area), never a forbidden merge or an out-of-area
// exclusion the rules would not have permitted on their own.

// A merge the LLM accepted may only be applied if the union of the involved
// clusters' member nodes passes the SAME hard constraints refine.ts enforces
// (branded/generic, cross-service-same-city, service-location x national
// informational). 'incompatible_intent' is deliberately NOT a hard block: an
// intent_exception case exists precisely so the adjudicator can decide two
// intent-conflicting clusters are the same page intent in practice.
export function mergeAcceptPassesRails(unionNodes: readonly ConstraintNode[]): boolean {
  return !unionHasHardBlock(unionNodes);
}

// A geo exclusion the LLM accepted may only be applied to a keyword that was
// flagged `geo_candidate` in stage 8 (normalize_keyword_universe). Phase B only
// flags a keyword when it names an out-of-area US state/city AND token-matches
// NO brief service area, so membership in the flagged set already encodes both
// of the spec 3.4 conditions ((i) flagged and (ii) matches no brief area). Any
// keywordId the LLM returns that is not in the flagged set (an in-area keyword,
// an unflagged one, or a hallucinated id) is discarded.
export function geoExclusionPassesRails(
  keywordId: string,
  flaggedGeoCandidateIds: ReadonlySet<string>
): boolean {
  return flaggedGeoCandidateIds.has(keywordId);
}
