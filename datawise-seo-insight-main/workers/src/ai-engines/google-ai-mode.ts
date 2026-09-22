import { extractResult } from '../dataforseo/client';
import type { AnswerAd, AnswerSource, EngineAdapter, NormalizedAnswer } from './types';
import { asArray, asString, dedupeSources, normalizeDomain, stripMarkdown, toSource } from './shared';

const AI_ITEM_TYPES = new Set(['ai_overview', 'ai_mode']);

// Google AI Mode SERP. The answer is one `ai_overview` item whose `references`
// and nested elements' `references` are the citations; `ai_overview_paid`
// elements carry sponsored placements (DataForSEO, 2026-07-30).
export const googleAiModeAdapter: EngineAdapter = {
  id: 'google_ai_mode',
  async buildRequest(_env, query, locale) {
    return {
      endpoint: '/serp/google/ai_mode/live/advanced',
      body: [{ keyword: query, location_code: locale.location_code, language_code: locale.language_code, device: 'desktop', os: 'windows' }],
    };
  },
  parse(raw): NormalizedAnswer {
    const result = (extractResult(raw) ?? {}) as Record<string, unknown>;
    const aiItems = asArray<Record<string, unknown>>(result.items).filter((item) => AI_ITEM_TYPES.has(String(item.type)));

    const citedRaw: AnswerSource[] = [];
    const ads: AnswerAd[] = [];
    const markdownParts: string[] = [];

    const pushRefs = (refs: unknown) => {
      for (const r of asArray<Record<string, unknown>>(refs)) {
        const src = toSource(r, citedRaw.length + 1);
        if (src) citedRaw.push(src);
      }
    };

    for (const item of aiItems) {
      const md = asString(item.markdown);
      if (md) markdownParts.push(md);
      pushRefs(item.references);
      for (const el of asArray<Record<string, unknown>>(item.items)) {
        pushRefs(el.references);
        if (!md) {
          const elText = asString(el.markdown) ?? asString(el.text);
          if (elText) markdownParts.push(elText);
        }
        if (el.type === 'ai_overview_paid') {
          for (const ad of asArray<Record<string, unknown>>(el.items)) {
            ads.push({
              domain: normalizeDomain(asString(ad.url) ?? asString(ad.domain)),
              advertiser: asString(ad.website_name) ?? asString(ad.title),
              rendered: true,
            });
          }
        }
      }
    }

    const answerMarkdown = markdownParts.join('\n\n');
    return {
      engine: 'google_ai_mode',
      model: null,
      answerText: stripMarkdown(answerMarkdown),
      answerMarkdown,
      cited: dedupeSources(citedRaw),
      retrieved: [],
      brands: [],
      ads,
      fanOut: [],
    };
  },
};
