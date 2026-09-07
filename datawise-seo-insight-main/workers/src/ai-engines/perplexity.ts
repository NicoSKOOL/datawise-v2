import { extractResult } from '../dataforseo/client';
import { resolveModel } from '../dataforseo/llm-models';
import { countryCodeForLocation } from './country-codes';
import type { AnswerSource, EngineAdapter, NormalizedAnswer } from './types';
import { asArray, asString, dedupeSources, toSource } from './shared';

// Perplexity has no scraper; this stays on the LLM Responses API. Model comes
// from the live catalog (PR #137), the country from the project's location.
export const perplexityAdapter: EngineAdapter = {
  id: 'perplexity',
  async buildRequest(env, query, locale) {
    return {
      endpoint: '/ai_optimization/perplexity/llm_responses/live',
      body: [{
        user_prompt: query,
        model_name: await resolveModel(env, 'perplexity'),
        web_search_country_iso_code: countryCodeForLocation(locale.location_code),
        max_output_tokens: 2048,
      }],
    };
  },
  parse(raw): NormalizedAnswer {
    const result = (extractResult(raw) ?? {}) as Record<string, unknown>;
    const texts: string[] = [];
    const citedRaw: AnswerSource[] = [];
    for (const item of asArray<Record<string, unknown>>(result.items)) {
      if (item.type === 'reasoning') continue;
      for (const section of asArray<Record<string, unknown>>(item.sections)) {
        const text = asString(section.text);
        if (text) texts.push(text);
        for (const a of asArray<Record<string, unknown>>(section.annotations)) {
          const src = toSource(a, citedRaw.length + 1);
          if (src) citedRaw.push(src);
        }
      }
    }
    const answerText = texts.join('\n\n');
    return {
      engine: 'perplexity',
      model: asString(result.model_name),
      answerText,
      answerMarkdown: answerText,
      cited: dedupeSources(citedRaw),
      retrieved: [],
      brands: [],
      ads: [],
      fanOut: asArray<unknown>(result.fan_out_queries).filter((q): q is string => typeof q === 'string' && !!q.trim()),
    };
  },
};
