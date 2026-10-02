// The compact payload the Internal Links report UI reads. URLs are stored
// once and referenced by index (same idea as the Python dashboard), which
// keeps a 3,000-decision report to a few MB.

import type { DecisionRow } from './classify';
import type { InternalLinksConfig } from './config';
import type { CrawledPage } from './shortlist';
import type { Outcome } from './types';

export interface ReportRow {
  i: number; // decision id
  o: Outcome;
  s: number; // source url index
  p: number; // paragraph number on the source page
  t: string; // paragraph text
  a: string; // anchor ('' when not linked)
  c: number | null; // confidence
  n: number; // P(none)
  k: Array<[number, number, number, number]>; // candidates: [url index, prob, sim, inbound]
  j: string; // Jev's choice: '1'..'4', 'none' or ''
  w: number | null; // link warranted
  v: number | null; // anchor available
  r: string; // reader stage
  m: number | null; // commercial
  rr?: string; // review reason
}

export interface ReportPage {
  u: number; // url index
  inbound: number;
  new_links: number;
  passages: number;
  word_count: number;
}

export interface ReportPayload {
  version: 1;
  summary: {
    site: string;
    generated_at: string;
    jev_model: string;
    anchor_model: string;
    pages: number;
    failed_pages: number;
    decisions: number;
    links: number;
    cost_usd: number;
    tokens: number;
    thresholds: InternalLinksConfig['thresholds'];
    caps: InternalLinksConfig['caps'];
  };
  urls: Array<[string, string]>; // [url, title]
  rows: ReportRow[];
  pages: ReportPage[];
}

export function buildReport(args: {
  site: string;
  pages: CrawledPage[];
  failedPages: number;
  rows: DecisionRow[];
  cfg: InternalLinksConfig;
  jevModel: string;
  anchorModel: string;
  costUsd: number;
  tokens: number;
}): ReportPayload {
  const urls: Array<[string, string]> = [];
  const index = new Map<string, number>();
  const idx = (url: string, title: string) => {
    let i = index.get(url);
    if (i === undefined) {
      i = urls.length;
      urls.push([url, title]);
      index.set(url, i);
    }
    return i;
  };
  for (const p of args.pages) idx(p.url, p.title);

  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const r3n = (x: number | null) => (x === null ? null : r3(x));
  const rows: ReportRow[] = args.rows.map((r) => ({
    i: r.id,
    o: r.outcome,
    s: idx(r.source_url, r.source_title),
    p: r.paragraph_no,
    t: r.paragraph,
    a: r.anchor,
    c: r3n(r.confidence),
    n: r3(r.prob_none),
    k: r.candidates.map((c) => [idx(c.url, c.title), r3(c.prob), c.sim, c.inbound] as [number, number, number, number]),
    j: r.jev_choice,
    w: r3n(r.link_warranted),
    v: r3n(r.anchor_available),
    r: r.reader_stage,
    m: r3n(r.commercial),
    ...(r.review_reason ? { rr: r.review_reason } : {}),
  }));

  const newLinks = new Map<number, number>();
  for (const r of rows) {
    if ((r.o === 'linked_apply' || r.o === 'linked_review') && r.j && r.j !== 'none') {
      const target = r.k[Number(r.j) - 1]?.[0];
      if (target !== undefined) newLinks.set(target, (newLinks.get(target) ?? 0) + 1);
    }
  }

  const pages: ReportPage[] = args.pages.map((p) => {
    const u = idx(p.url, p.title);
    return {
      u,
      inbound: p.inbound_links,
      new_links: newLinks.get(u) ?? 0,
      passages: p.passages.length,
      word_count: p.word_count,
    };
  });

  return {
    version: 1,
    summary: {
      site: args.site,
      generated_at: new Date().toISOString(),
      jev_model: args.jevModel,
      anchor_model: args.anchorModel,
      pages: args.pages.length,
      failed_pages: args.failedPages,
      decisions: rows.length,
      links: rows.filter((r) => r.o === 'linked_apply' || r.o === 'linked_review').length,
      cost_usd: Math.round(args.costUsd * 10000) / 10000,
      tokens: args.tokens,
      thresholds: args.cfg.thresholds,
      caps: args.cfg.caps,
    },
    urls,
    rows,
    pages,
  };
}
