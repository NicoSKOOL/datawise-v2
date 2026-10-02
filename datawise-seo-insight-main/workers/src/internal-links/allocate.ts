// Decide which of Jev's proposed links actually get made. No model calls:
// pure rules from InternalLinksConfig applied to the judgements. Port of
// allocate.py; tie-breaking and float arithmetic are kept identical so a run
// allocates exactly the links the Python tool would.

import type { InternalLinksConfig } from './config';
import type { Allocation, CapReason, Candidate, FilterRejection, JevAnswers, Judgement } from './types';

// Python round(x, 4). toFixed rounds the exact binary value, as Python does.
function round4(x: number): number {
  return Number(x.toFixed(4));
}

function canonPath(canon: string): string {
  const slash = canon.indexOf('/');
  return slash === -1 ? '/' : canon.slice(slash);
}

function stripSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, '');
}

/** Exact path match: '/pricing/' matches only that page, never '/x/pricing/'. */
export function isMoneyPage(canon: string, cfg: InternalLinksConfig): boolean {
  const path = canonPath(canon);
  return cfg.money_pages.some((m) => {
    const bare = stripSlashes(m);
    return bare ? path === `/${bare}/` : path === '/';
  });
}

/** The first filter that stops a judgement, or null if it survives. */
export function firstFilterRejection(
  answers: JevAnswers | undefined,
  candidate: Candidate,
  th: InternalLinksConfig['thresholds']
): FilterRejection | null {
  if (!answers) return 'api_error';
  const bt = answers.best_target;
  if (bt.choice === 'none') return 'model_said_none';
  if (bt.confidence < th.min_confidence) return 'low_confidence';
  if (answers.link_warranted.noul < th.min_link_warranted) return 'not_warranted';
  if (answers.anchor_available.noul < th.min_anchor_available) return 'no_natural_anchor';
  if (chosenTarget(answers, candidate)?.canon === candidate.source_canon) return 'self_link';
  return null;
}

export function chosenTarget(answers: JevAnswers | undefined, candidate: Candidate) {
  if (!answers || answers.best_target.choice === 'none') return undefined;
  return candidate.targets[Number(answers.best_target.choice) - 1];
}

export function capKey(sourceCanon: string, pI: number, targetCanon: string): string {
  return `${sourceCanon}|${pI}|${targetCanon}`;
}

// Min-heap of [negScore, index], ordered like Python tuples.
class Heap {
  private items: Array<[number, number]> = [];

  get size(): number {
    return this.items.length;
  }

  private less(a: [number, number], b: [number, number]): boolean {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }

  push(item: [number, number]): void {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(h[i], h[parent])) break;
      [h[i], h[parent]] = [h[parent], h[i]];
      i = parent;
    }
  }

  pop(): [number, number] {
    const h = this.items;
    const top = h[0];
    const last = h.pop()!;
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

export interface AllocationResult {
  chosen: Allocation[];
  // capKey(source, p_i, target) -> which cap dropped that candidate.
  capLog: Record<string, CapReason>;
  rejected: Partial<Record<FilterRejection, number>>;
  capped: Partial<Record<CapReason, number>>;
}

export function allocate(
  judgements: Judgement[],
  inboundCounts: number[],
  cfg: InternalLinksConfig
): AllocationResult {
  const { thresholds: th, weights: w, caps } = cfg;
  const maxInbound = Math.max(0, ...inboundCounts) || 1;

  const pool: Omit<Allocation, 'final_score' | 'action'>[] = [];
  const rejected: AllocationResult['rejected'] = {};
  for (const r of judgements) {
    const ans = r.response?.answers;
    const c = r.candidate;
    const rejection = firstFilterRejection(ans, c, th);
    if (rejection) {
      rejected[rejection] = (rejected[rejection] ?? 0) + 1;
      continue;
    }
    const a = ans!;
    const bt = a.best_target;
    const tgt = chosenTarget(a, c)!;

    // Fewer existing inbound links means a bigger win from a new one.
    const orphan = 1 - tgt.inbound_links / maxInbound;
    const money = isMoneyPage(tgt.canon, cfg);
    const ready = a.reader_stage.choice === 'ready';

    // Same left-to-right summation order as allocate.py.
    const score =
      w.confidence * bt.confidence +
      w.link_warranted * a.link_warranted.noul +
      w.anchor_available * a.anchor_available.noul +
      w.similarity * tgt.sim +
      w.orphan_boost * orphan +
      (money && ready ? w.money_page_match : 0) +
      w.commercial_penalty * a.commercial.noul;

    pool.push({
      score: round4(score),
      source: c.source_url,
      source_canon: c.source_canon,
      source_title: c.source_title,
      p_i: c.p_i,
      text: c.text,
      target: tgt.url,
      target_canon: tgt.canon,
      target_title: tgt.title,
      target_inbound_before: tgt.inbound_links,
      confidence: bt.confidence,
      link_warranted: a.link_warranted.noul,
      anchor_available: a.anchor_available.noul,
      commercial: a.commercial.noul,
      reader_stage: a.reader_stage.choice,
      similarity: tgt.sim,
      is_money_page: money,
    });
  }

  // Greedy allocation with diminishing returns. A target's 2nd link is worth
  // decay x its 1st, so after a few the next candidate elsewhere wins.
  const heap = new Heap();
  pool.forEach((c, n) => heap.push([-c.score, n]));

  const perSource = new Map<string, number>();
  const perTarget = new Map<string, number>();
  const usedPassages = new Set<string>();
  const usedPairs = new Set<string>();
  const placedIdx = new Map<string, number[]>();
  const chosen: Allocation[] = [];
  const capped: AllocationResult['capped'] = {};
  const capLog: Record<string, CapReason> = {};

  const drop = (reason: CapReason, c: (typeof pool)[number]) => {
    capped[reason] = (capped[reason] ?? 0) + 1;
    capLog[capKey(c.source_canon, c.p_i, c.target_canon)] = reason;
  };

  while (heap.size > 0) {
    const [neg, n] = heap.pop();
    const c = pool[n];
    const eff = -neg;
    const decayed = c.score * caps.target_decay ** (perTarget.get(c.target_canon) ?? 0);
    // If decay changed its value, re-queue at the true value and continue,
    // so the heap always pops the genuinely best remaining candidate.
    if (Math.abs(decayed - eff) > 1e-9) {
      heap.push([-decayed, n]);
      continue;
    }

    const passageKey = `${c.source_canon}|${c.p_i}`;
    if (usedPassages.has(passageKey)) continue;
    const pair = `${c.source_canon}|${c.target_canon}`;
    if (usedPairs.has(pair)) {
      drop('duplicate_pair', c);
      continue;
    }
    if ((perSource.get(c.source_canon) ?? 0) >= caps.max_new_links_per_source) {
      drop('source_full', c);
      continue;
    }
    if ((perTarget.get(c.target_canon) ?? 0) >= caps.max_new_links_per_target) {
      drop('target_full', c);
      continue;
    }
    const placed = placedIdx.get(c.source_canon) ?? [];
    if (placed.some((q) => Math.abs(c.p_i - q) < caps.min_passages_between)) {
      drop('too_close', c);
      continue;
    }

    chosen.push({
      ...c,
      final_score: round4(decayed),
      action: c.confidence >= th.auto_approve_confidence ? 'apply' : 'review',
    });
    usedPassages.add(passageKey);
    usedPairs.add(pair);
    perSource.set(c.source_canon, (perSource.get(c.source_canon) ?? 0) + 1);
    perTarget.set(c.target_canon, (perTarget.get(c.target_canon) ?? 0) + 1);
    placedIdx.set(c.source_canon, [...placed, c.p_i]);
  }

  // Array.prototype.sort is stable, matching Python's sorted().
  chosen.sort((a, b) => b.final_score - a.final_score);
  return { chosen, capLog, rejected, capped };
}
