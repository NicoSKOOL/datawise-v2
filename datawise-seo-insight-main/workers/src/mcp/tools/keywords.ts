import { z } from 'zod';
import { defineTool, localeInputs, resolveLocale } from './types';
import { callJson } from '../call-handler';
import { toolResult, compact, DETAILED } from '../shape';
import {
  handleRelatedKeywords, handleKeywordSuggestions, handleKeywordIdeas,
  handleKeywordDifficulty,
} from '../../routes/keywords';
import { dataforseoRequestCached } from '../../dataforseo/client';

interface KeywordRow {
  keyword: string;
  search_volume: number;
  cpc: number;
  competition_level: string;
  difficulty?: number;
  intent?: string;
}

const items = (envelope: any): any[] => envelope?.tasks?.[0]?.result?.[0]?.items ?? [];

// /api/keywords/related re-wraps rows under keyword_data; suggestions, ideas
// and overview return DataForSEO's flat Labs item shape.
function fromRelated(item: any): KeywordRow {
  const kd = item.keyword_data ?? {};
  const ki = kd.keyword_info ?? {};
  return { keyword: kd.keyword, search_volume: ki.search_volume ?? 0, cpc: ki.cpc ?? 0, competition_level: ki.competition_level ?? 'UNKNOWN' };
}

function fromLabs(item: any): KeywordRow {
  const ki = item.keyword_info ?? {};
  const row: KeywordRow = {
    keyword: item.keyword,
    search_volume: ki.search_volume ?? 0,
    cpc: ki.cpc ?? 0,
    competition_level: ki.competition_level ?? 'UNKNOWN',
  };
  const kd = item.keyword_properties?.keyword_difficulty;
  if (typeof kd === 'number') row.difficulty = kd;
  const intent = item.search_intent_info?.main_intent;
  if (typeof intent === 'string') row.intent = intent;
  return row;
}

export const keywordResearch = defineTool({
  name: 'datawise_keyword_research',
  description:
    'Use this to discover keywords around a seed term with monthly search volume, CPC and competition. ' +
    'mode=related (default) blends related keywords and keyword ideas sorted by volume; mode=suggestions returns long-tail phrases containing the seed with difficulty and intent; mode=ideas returns broader topic ideas. ' +
    'Do not use for metrics on keywords you already have (use datawise_keyword_metrics) or for what a domain ranks for (use datawise_ranked_keywords).',
  inputSchema: z.object({
    keyword: z.string().min(1).max(200).describe('Seed keyword, e.g. "local seo services".'),
    mode: z.enum(['related', 'suggestions', 'ideas']).default('related'),
    limit: z.number().int().min(1).max(100).default(25).describe('Rows to return, max 100.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const uid = ctx.identity.userId;
    const body = { keyword: args.keyword, limit: args.limit, ...locale };
    let rawItems: any[];
    let rows: KeywordRow[];
    if (args.mode === 'related') {
      rawItems = items(await callJson(ctx.env, uid, handleRelatedKeywords, body));
      rows = rawItems.map(fromRelated);
    } else if (args.mode === 'suggestions') {
      rawItems = items(await callJson(ctx.env, uid, handleKeywordSuggestions, body));
      rows = rawItems.map(fromLabs);
    } else {
      rawItems = items(await callJson(ctx.env, uid, handleKeywordIdeas, body));
      rows = rawItems.map(fromLabs);
    }
    // Keep the raw source in step with rows through the same filter+slice, so
    // detailed mode's raw payload matches the flat keywords rows one-to-one.
    const kept = rows
      .map((row, i) => ({ row, source: args.mode === 'related' ? rawItems[i]?.keyword_data ?? {} : rawItems[i] }))
      .filter((x) => x.row.keyword)
      .slice(0, args.limit);
    rows = kept.map((x) => x.row);

    const structured: Record<string, unknown> = { seed: args.keyword, mode: args.mode, ...locale, keywords: rows };
    if (args.response_format === 'detailed') {
      structured.raw = compact(kept.map((x) => x.source), DETAILED);
    }
    return toolResult(
      structured,
      `${rows.length} keywords for "${args.keyword}" (${args.mode}, location ${locale.location_code}).`,
    );
  },
});

export const keywordMetrics = defineTool({
  name: 'datawise_keyword_metrics',
  description:
    'Use this to get search volume, CPC, competition, keyword difficulty and search intent for keywords you already have (up to 50 per call). ' +
    'Do not use to discover new keywords; use datawise_keyword_research for that.',
  inputSchema: z.object({
    keywords: z.array(z.string().min(1).max(200)).min(1).max(50),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const uid = ctx.identity.userId;
    // Bypass handleKeywordOverview (one keyword per DataForSEO task) and call the
    // client directly with the whole batch in a single task, since the estimate
    // in budget.ts assumes one overview task per call, not one per keyword.
    const [overview, difficulty] = await Promise.all([
      dataforseoRequestCached(ctx.env, '/dataforseo_labs/google/keyword_overview/live', [{
        keywords: args.keywords,
        location_code: locale.location_code,
        language_code: locale.language_code,
      }], { ttlSeconds: 86400 }),
      callJson(ctx.env, uid, handleKeywordDifficulty, { keywords: args.keywords, ...locale }),
    ]);
    const kdByKeyword = new Map<string, number>();
    for (const it of items(difficulty)) kdByKeyword.set(String(it.keyword).toLowerCase(), it.keyword_difficulty);

    const overviewByKeyword = new Map<string, any>();
    for (const it of items(overview)) overviewByKeyword.set(String(it.keyword).toLowerCase(), it);

    const rows: KeywordRow[] = args.keywords.map((keyword) => {
      const item = overviewByKeyword.get(keyword.toLowerCase());
      const row: KeywordRow = item ? fromLabs(item) : { keyword, search_volume: 0, cpc: 0, competition_level: 'UNKNOWN' };
      const kd = kdByKeyword.get(keyword.toLowerCase());
      return { ...row, keyword, difficulty: kd ?? row.difficulty };
    });

    const structured: Record<string, unknown> = { ...locale, keywords: rows };
    if (args.response_format === 'detailed') {
      const rawOverviews = args.keywords.map((keyword) => overviewByKeyword.get(keyword.toLowerCase()) ?? null);
      structured.raw = compact(rawOverviews, DETAILED);
    }
    return toolResult(
      structured,
      `Metrics for ${rows.length} keywords (location ${locale.location_code}).`,
    );
  },
});
