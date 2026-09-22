import type { NormalizedAnswer } from './types';
import { domainsMatch, normalizeDomain } from './shared';

export type CheckStatus = 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'no_answer';

export interface Classification {
  status: CheckStatus;
  citation_position: number | null;
  cited_url: string | null;
  retrieved_url: string | null;
  answer_excerpt: string | null;
  matched_brand: string | null;
}

const EXCERPT_MAX = 300;

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 100);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`.slice(0, EXCERPT_MAX);
}

function leadExcerpt(text: string): string | null {
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, EXCERPT_MAX) : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isVisibleStatus(status: string): boolean {
  return status === 'cited' || status === 'mentioned';
}

// Priority: cited > mentioned > retrieved > no_answer > absent.
// Spec section 4 of docs/superpowers/specs/2026-09-06-ai-engines-v2-design.md.
export function classify(answer: NormalizedAnswer, projectDomain: string, brandTerms: string[]): Classification {
  const none: Classification = { status: 'absent', citation_position: null, cited_url: null, retrieved_url: null, answer_excerpt: null, matched_brand: null };
  const target = normalizeDomain(projectDomain);
  const text = answer.answerText || '';

  if (target) {
    const hit = answer.cited.find((s) => domainsMatch(s.domain, target));
    if (hit) {
      return { ...none, status: 'cited', citation_position: hit.position, cited_url: hit.url, answer_excerpt: leadExcerpt(text) };
    }
  }

  const terms = brandTerms.map((t) => t.trim()).filter((t) => t.length >= 3);
  const termKeys = new Set(terms.map((t) => t.toLowerCase()));
  for (const brand of answer.brands) {
    const byName = termKeys.has(brand.name.trim().toLowerCase());
    const byUrl = !!target && brand.urls.some((u) => { const d = normalizeDomain(u); return !!d && domainsMatch(d, target); });
    if (byName || byUrl) {
      return { ...none, status: 'mentioned', matched_brand: brand.name, answer_excerpt: leadExcerpt(text) };
    }
  }
  for (const term of terms) {
    const match = text.match(new RegExp(`\\b${escapeRegex(term)}\\b`, 'i'));
    if (match && match.index != null) {
      return { ...none, status: 'mentioned', matched_brand: term, answer_excerpt: excerptAround(text, match.index, term.length) };
    }
  }

  if (target) {
    const fetched = answer.retrieved.find((s) => domainsMatch(s.domain, target));
    if (fetched) {
      return { ...none, status: 'retrieved', retrieved_url: fetched.url, answer_excerpt: leadExcerpt(text) };
    }
  }

  if (!text.trim() && answer.cited.length === 0 && answer.retrieved.length === 0) {
    return { ...none, status: 'no_answer' };
  }
  return none;
}
