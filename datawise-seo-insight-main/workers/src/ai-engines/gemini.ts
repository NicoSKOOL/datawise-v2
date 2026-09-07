import { extractResult } from '../dataforseo/client';
import type { AnswerSource, EngineAdapter, NormalizedAnswer } from './types';
import { asArray, asString, dedupeSources, stripMarkdown, toSource } from './shared';

// Real Gemini interface answer via DataForSEO's LLM Scraper. Gemini exposes
// cited sources only: no retrieved list, brand entities or ads.
export const geminiAdapter: EngineAdapter = {
  id: 'gemini',
  async buildRequest(_env, query, locale) {
    return {
      endpoint: '/ai_optimization/gemini/llm_scraper/live/advanced',
      body: [{ keyword: query, location_code: locale.location_code, language_code: locale.language_code }],
    };
  },
  parse(raw): NormalizedAnswer {
    const result = (extractResult(raw) ?? {}) as Record<string, unknown>;
    const items = asArray<Record<string, unknown>>(result.items);
    const citedRaw: AnswerSource[] = [];
    for (const s of asArray<Record<string, unknown>>(result.sources)) {
      const src = toSource(s, citedRaw.length + 1);
      if (src) citedRaw.push(src);
    }
    for (const item of items) {
      for (const s of asArray<Record<string, unknown>>(item.sources)) {
        const src = toSource(s, citedRaw.length + 1);
        if (src) citedRaw.push(src);
      }
    }
    const answerMarkdown =
      asString(result.markdown) ??
      items.map((item) => asString(item.markdown) ?? asString(item.original_text) ?? '').filter(Boolean).join('\n\n');
    return {
      engine: 'gemini',
      model: asString(result.model),
      answerText: stripMarkdown(answerMarkdown),
      answerMarkdown,
      cited: dedupeSources(citedRaw),
      retrieved: [],
      brands: [],
      ads: [],
      fanOut: [],
    };
  },
};
