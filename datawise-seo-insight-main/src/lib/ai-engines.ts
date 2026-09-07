import { api } from './api';
import { cleanTrackingDomain, type AIEngine } from './ai-tracking';

// Mirror of workers/src/ai-engines/types.ts + classify.ts. Keep in sync.

export type EngineId = AIEngine;

export interface AnswerSource { url: string | null; domain: string; title: string | null; position: number }
export interface AnswerBrand { name: string; category: string | null; urls: string[] }
export interface AnswerAd { domain: string | null; advertiser: string | null; rendered: boolean }

export interface NormalizedAnswer {
  engine: EngineId;
  model: string | null;
  answerText: string;
  answerMarkdown: string;
  cited: AnswerSource[];
  retrieved: AnswerSource[];
  brands: AnswerBrand[];
  ads: AnswerAd[];
  fanOut: string[];
}

export interface Classification {
  status: 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'no_answer';
  citation_position: number | null;
  cited_url: string | null;
  retrieved_url: string | null;
  answer_excerpt: string | null;
  matched_brand: string | null;
}

export interface EngineCheckResponse {
  engine: EngineId;
  locale: { location_code: number; language_code: string };
  answer: NormalizedAnswer;
  classification: Classification | null;
}

export async function fetchEngineCheck(params: {
  engine: EngineId;
  query: string;
  location_code?: number;
  language_code?: string;
  brand_domain?: string;
  brand_terms?: string[];
}) {
  return api<EngineCheckResponse>('/api/ai/engine-check', { method: 'POST', body: params });
}

export type VerdictTone = 'cited' | 'mentioned' | 'retrieved' | 'absent' | 'none';

export function verdictFor(c: Classification | null, engineLabel: string): { label: string; tone: VerdictTone } {
  if (!c) return { label: 'Add your domain to see a verdict', tone: 'none' };
  switch (c.status) {
    case 'cited':
      return { label: `Cited by ${engineLabel}${c.citation_position ? ` at #${c.citation_position}` : ''}`, tone: 'cited' };
    case 'mentioned':
      return { label: `Mentioned by ${engineLabel}${c.matched_brand ? ` as "${c.matched_brand}"` : ''}, not linked`, tone: 'mentioned' };
    case 'retrieved':
      return { label: `${engineLabel} fetched your page but did not cite it`, tone: 'retrieved' };
    case 'no_answer':
      return { label: `${engineLabel} returned no answer`, tone: 'absent' };
    default:
      return { label: `Not in the ${engineLabel} answer`, tone: 'absent' };
  }
}

export function competitorDomains(answer: NormalizedAnswer, brandDomain: string): Array<{ domain: string; count: number }> {
  const me = cleanTrackingDomain(brandDomain);
  const counts = new Map<string, number>();
  for (const s of answer.cited) {
    if (me && (s.domain === me || s.domain.endsWith(`.${me}`) || me.endsWith(`.${s.domain}`))) continue;
    counts.set(s.domain, (counts.get(s.domain) || 0) + 1);
  }
  return Array.from(counts, ([domain, count]) => ({ domain, count })).sort((a, b) => b.count - a.count);
}
