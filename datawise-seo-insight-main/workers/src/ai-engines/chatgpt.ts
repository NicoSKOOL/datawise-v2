import { extractResult } from '../dataforseo/client';
import type { AnswerAd, AnswerBrand, AnswerSource, EngineAdapter, NormalizedAnswer } from './types';
import { asArray, asString, dedupeSources, normalizeDomain, stripMarkdown, toSource } from './shared';

// Real ChatGPT interface answer via DataForSEO's LLM Scraper. `sources` are
// what ChatGPT attributed the answer to; `search_results` are pages it fetched
// while answering. force_web_search keeps citations and brand entities present
// (verified 2026-09-06: without it both are often empty).
export const chatgptAdapter: EngineAdapter = {
  id: 'chatgpt',
  async buildRequest(_env, query, locale) {
    return {
      endpoint: '/ai_optimization/chat_gpt/llm_scraper/live/advanced',
      body: [{ keyword: query, location_code: locale.location_code, language_code: locale.language_code, force_web_search: true }],
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
    const cited = dedupeSources(citedRaw);
    const citedKeys = new Set(cited.map((s) => s.url || s.domain));

    const retrievedRaw: AnswerSource[] = [];
    for (const s of asArray<Record<string, unknown>>(result.search_results)) {
      const src = toSource(s, retrievedRaw.length + 1);
      if (src && !citedKeys.has(src.url || src.domain)) retrievedRaw.push(src);
    }
    const retrieved = dedupeSources(retrievedRaw);

    const brandInputs = [
      ...asArray<Record<string, unknown>>(result.brand_entities),
      ...items.flatMap((item) => asArray<Record<string, unknown>>(item.brand_entities)),
    ];
    const brandsByName = new Map<string, AnswerBrand>();
    for (const b of brandInputs) {
      const name = asString(b.title) ?? asString(b.markdown);
      if (!name) continue;
      const key = name.toLowerCase();
      const urls = asArray<Record<string, unknown>>(b.urls).map((u) => asString(u.url)).filter((u): u is string => !!u);
      const existing = brandsByName.get(key);
      if (existing) {
        for (const u of urls) if (!existing.urls.includes(u)) existing.urls.push(u);
      } else {
        brandsByName.set(key, { name, category: asString(b.category), urls });
      }
    }

    const ads: AnswerAd[] = items
      .filter((item) => item.type === 'chat_gpt_ad')
      .map((item) => {
        const advertiser = item.advertiser as Record<string, unknown> | undefined;
        return {
          domain: normalizeDomain(asString(item.url) ?? asString(item.domain)),
          advertiser: asString(advertiser?.name) ?? null,
          rendered: item.is_rendered === true,
        };
      });

    const answerMarkdown =
      asString(result.markdown) ??
      items.map((item) => asString(item.markdown) ?? asString(item.text) ?? '').filter(Boolean).join('\n\n');

    return {
      engine: 'chatgpt',
      model: asString(result.model),
      answerText: stripMarkdown(answerMarkdown),
      answerMarkdown,
      cited,
      retrieved,
      brands: Array.from(brandsByName.values()),
      ads,
      fanOut: asArray<unknown>(result.fan_out_queries).filter((q): q is string => typeof q === 'string' && !!q.trim()),
    };
  },
};
