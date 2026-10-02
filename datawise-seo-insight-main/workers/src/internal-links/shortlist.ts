// For each source paragraph, shortlist the few pages it might sensibly link
// to. Port of shortlist.py, with Workers AI bge-m3 (multilingual) in place of
// the local sentence-transformers models.

import type { InternalLinksConfig } from './config';
import type { ParsedPage } from './parse-html';
import type { Candidate } from './types';

export const EMBED_MODEL = '@cf/baai/bge-m3';
export const EMBED_BATCH = 50;

export interface CrawledPage extends ParsedPage {
  inbound_links: number;
}

export interface SourcePassage {
  page_i: number;
  p_i: number;
  text: string;
}

/** What a target page is 'about', for matching purposes. */
export function targetText(p: ParsedPage): string {
  const bits = [p.title, p.h1, p.description];
  if (p.passages.length) bits.push(p.passages[0].text.slice(0, 300));
  return bits.filter(Boolean).join(' ');
}

function pathOf(canon: string): string {
  const slash = canon.indexOf('/');
  return slash === -1 ? '/' : canon.slice(slash);
}

/** Every passage that may host a link; excluded pages are still targets. */
export function sourcePassages(pages: ParsedPage[], cfg: InternalLinksConfig): SourcePassage[] {
  const exclude = cfg.exclude_sources.map((p) => new RegExp(p));
  const out: SourcePassage[] = [];
  pages.forEach((p, page_i) => {
    const path = pathOf(p.canon);
    if (exclude.some((rx) => rx.test(path))) return;
    for (const ps of p.passages) {
      if (ps.text.split(/\s+/).filter(Boolean).length >= cfg.shortlist.min_words) {
        out.push({ page_i, p_i: ps.i, text: ps.text });
      }
    }
  });
  return out;
}

export function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function embed(ai: any, texts: string[]): Promise<number[][]> {
  const res = (await ai.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
  if (!Array.isArray(res?.data) || res.data.length !== texts.length) {
    throw new Error('Embedding model returned an unexpected response');
  }
  return res.data.map(normalize);
}

/**
 * Pick candidates for one batch of embedded passages. Never proposes the page
 * itself or a target it already links to.
 */
export function shortlistBatch(
  sources: SourcePassage[],
  sourceVecs: number[][],
  pages: CrawledPage[],
  targetVecs: number[][],
  cfg: InternalLinksConfig
): { candidates: Candidate[]; topSims: number[] } {
  const candidates: Candidate[] = [];
  const topSims: number[] = [];
  sources.forEach((s, n) => {
    const page = pages[s.page_i];
    const linked = new Set(page.outlinks);
    const scored: Array<[number, number]> = [];
    targetVecs.forEach((tv, ti) => {
      if (ti === s.page_i || linked.has(pages[ti].canon)) return;
      scored.push([dot(sourceVecs[n], tv), ti]);
    });
    scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    if (scored.length) topSims.push(scored[0][0]);
    const picks = scored
      .slice(0, cfg.shortlist.candidates_per_paragraph)
      .filter(([sim]) => sim >= cfg.shortlist.min_similarity);
    if (!picks.length) return;
    candidates.push({
      source_url: page.url,
      source_canon: page.canon,
      source_title: page.title,
      p_i: s.p_i,
      text: s.text,
      targets: picks.map(([sim, i]) => ({
        url: pages[i].url,
        canon: pages[i].canon,
        title: pages[i].title,
        h1: pages[i].h1,
        description: pages[i].description,
        inbound_links: pages[i].inbound_links,
        sim: Math.round(sim * 1000) / 1000,
      })),
    });
  });
  return { candidates, topSims };
}

/** Inbound counts drive the "prioritise under-linked pages" rule later. */
export function withInboundCounts(pages: ParsedPage[]): CrawledPage[] {
  const inbound = new Map(pages.map((p) => [p.canon, 0]));
  for (const p of pages) {
    for (const t of p.outlinks) {
      if (inbound.has(t) && t !== p.canon) inbound.set(t, inbound.get(t)! + 1);
    }
  }
  return pages.map((p) => ({ ...p, inbound_links: inbound.get(p.canon) ?? 0 }));
}
