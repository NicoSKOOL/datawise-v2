import { describe, it, expect } from 'vitest';
import { verdictFor, competitorDomains, type NormalizedAnswer } from '../ai-engines';
import { AI_ENGINE_ORDER, AI_OUTCOME_COLORS } from '../ai-tracking';

const answer: NormalizedAnswer = {
  engine: 'chatgpt', model: null, answerText: '', answerMarkdown: '',
  cited: [
    { url: 'https://a.com/1', domain: 'a.com', title: null, position: 1 },
    { url: 'https://a.com/2', domain: 'a.com', title: null, position: 2 },
    { url: 'https://me.com/x', domain: 'me.com', title: null, position: 3 },
  ],
  retrieved: [], brands: [], ads: [], fanOut: [],
};

describe('engine constants', () => {
  it('lists four engines in order and a retrieved outcome color', () => {
    expect(AI_ENGINE_ORDER).toEqual(['google_ai_mode', 'chatgpt', 'gemini', 'perplexity']);
    expect(AI_OUTCOME_COLORS.retrieved).toBeTruthy();
  });
});

describe('verdictFor', () => {
  it('describes each status', () => {
    expect(verdictFor({ status: 'cited', citation_position: 2, cited_url: 'u', retrieved_url: null, answer_excerpt: null, matched_brand: null }, 'ChatGPT'))
      .toEqual({ label: 'Cited by ChatGPT at #2', tone: 'cited' });
    expect(verdictFor({ status: 'mentioned', citation_position: null, cited_url: null, retrieved_url: null, answer_excerpt: null, matched_brand: 'DataWise' }, 'Gemini'))
      .toEqual({ label: 'Mentioned by Gemini as "DataWise", not linked', tone: 'mentioned' });
    expect(verdictFor({ status: 'retrieved', citation_position: null, cited_url: null, retrieved_url: 'u', answer_excerpt: null, matched_brand: null }, 'ChatGPT'))
      .toEqual({ label: 'ChatGPT fetched your page but did not cite it', tone: 'retrieved' });
    expect(verdictFor({ status: 'absent', citation_position: null, cited_url: null, retrieved_url: null, answer_excerpt: null, matched_brand: null }, 'Perplexity'))
      .toEqual({ label: 'Not in the Perplexity answer', tone: 'absent' });
    expect(verdictFor(null, 'ChatGPT')).toEqual({ label: 'Add your domain to see a verdict', tone: 'none' });
  });
});

describe('competitorDomains', () => {
  it('counts cited domains excluding the brand, most cited first', () => {
    expect(competitorDomains(answer, 'https://www.me.com')).toEqual([{ domain: 'a.com', count: 2 }]);
  });
});
