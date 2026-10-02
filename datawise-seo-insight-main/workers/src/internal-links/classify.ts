// One row per Jev decision, naming what happened to it and why. Port of
// decisions.py build_rows(), emitting the compact payload the report UI reads.

import { capKey, chosenTarget, firstFilterRejection } from './allocate';
import type { InternalLinksConfig } from './config';
import type { LinkWithAnchor } from './anchors';
import type { Allocation, CapReason, Judgement, Outcome } from './types';

export const OUTCOME_LABELS: Record<Outcome, string> = {
  linked_apply: 'Linked, high confidence',
  linked_review: 'Linked, needs your review',
  no_anchor: 'Kept, but no clean anchor in the paragraph',
  source_full: 'Source page already got its new links',
  too_close: 'Too close to another new link',
  target_full: 'Target page already got enough new links',
  duplicate_pair: 'Page already links to that target elsewhere',
  model_said_none: 'Jev said none of these pages fit',
  low_confidence: 'Jev was not sure enough',
  not_warranted: "Paragraph doesn't need a link",
  no_natural_anchor: 'No natural anchor phrase',
  self_link: 'Would link to itself',
  api_error: 'API error',
};

export interface DecisionCandidate {
  url: string;
  title: string;
  prob: number;
  sim: number;
  inbound: number;
}

export interface DecisionRow {
  id: number;
  outcome: Outcome;
  source_url: string;
  source_title: string;
  paragraph_no: number;
  paragraph: string;
  jev_choice: string;
  chosen_url: string;
  confidence: number | null;
  prob_none: number;
  candidates: DecisionCandidate[];
  link_warranted: number | null;
  anchor_available: number | null;
  reader_stage: string;
  commercial: number | null;
  anchor: string;
  review_reason?: string;
  target_inbound_before: number | null;
  score: number | null;
}

export function buildDecisionRows(
  judgements: Judgement[],
  allocation: Allocation[],
  links: LinkWithAnchor[],
  capLog: Record<string, CapReason>,
  cfg: InternalLinksConfig
): DecisionRow[] {
  const key = (s: string, p: number) => `${s}|${p}`;
  const allocByKey = new Map(allocation.map((a) => [key(a.source_canon, a.p_i), a]));
  const linkByKey = new Map(links.map((l) => [key(l.source_canon, l.p_i), l]));

  return judgements.map((r, n) => {
    const c = r.candidate;
    const ans = r.response?.answers;
    const k = key(c.source_canon, c.p_i);
    const chosen = chosenTarget(ans, c);
    const link = linkByKey.get(k);
    const alloc = allocByKey.get(k);

    let outcome: Outcome | null = firstFilterRejection(ans, c, cfg.thresholds);
    if (outcome === null) {
      if (link) outcome = link.action === 'apply' ? 'linked_apply' : 'linked_review';
      else if (alloc) outcome = 'no_anchor';
      else outcome = capLog[capKey(c.source_canon, c.p_i, chosen!.canon)] ?? 'source_full';
    }

    const probs = ans?.best_target.probabilities ?? {};
    return {
      id: n + 1,
      outcome,
      source_url: c.source_url,
      source_title: c.source_title,
      paragraph_no: c.p_i,
      paragraph: c.text,
      jev_choice: ans?.best_target.choice ?? '',
      chosen_url: chosen?.url ?? '',
      confidence: ans?.best_target.confidence ?? null,
      prob_none: probs.none ?? 0,
      candidates: c.targets.map((t, i) => ({
        url: t.url,
        title: t.title,
        prob: probs[String(i + 1)] ?? 0,
        sim: t.sim,
        inbound: t.inbound_links,
      })),
      link_warranted: ans?.link_warranted.noul ?? null,
      anchor_available: ans?.anchor_available.noul ?? null,
      reader_stage: ans?.reader_stage.choice ?? '',
      commercial: ans?.commercial.noul ?? null,
      anchor: link?.anchor ?? '',
      review_reason: link?.review_reason,
      target_inbound_before: chosen?.inbound_links ?? null,
      score: (link ?? alloc)?.final_score ?? null,
    };
  });
}
