import { z } from 'zod';
import { defineTool, localeInputs, resolveLocale, shapeFor } from './types';
import { callJson, HandlerError } from '../call-handler';
import { toolResult, toolError, compact, stripHtml } from '../shape';
import { handlePeopleAlsoAsk } from '../../routes/ai';

// The app's People Also Ask explorer: a breadth-first walk of Google's PAA
// accordion starting from one keyword. depth 1 is a single SERP; depth 2
// follows each question once (up to 10 SERPs); depth 3 goes one level further
// (up to 25 SERPs). Each SERP is about $0.003, so depth 2 is about $0.03.

export const peopleAlsoAsk = defineTool({
  name: 'datawise_people_also_ask',
  description:
    'Use this to collect the People Also Ask questions Google shows around a keyword, with the answer snippet and source page for each, plus related searches and a topic map grouping the questions. ' +
    'depth=1 is one search (about $0.003); depth=2 (default) follows each question once, up to 10 searches (about $0.03); depth=3 goes one level deeper, up to 25 searches (about $0.08). ' +
    'Use it to plan FAQ sections, answer capsules and fan-out coverage. Do not use for search volume (datawise_keyword_metrics) or to discover keywords by volume (datawise_keyword_research).',
  inputSchema: z.object({
    keyword: z.string().min(1).max(200).describe('Seed keyword or question, e.g. "emergency plumber melbourne".'),
    depth: z.number().int().min(1).max(3).default(2).describe('How many levels of questions to follow: 1, 2 or 3.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const shape = shapeFor(args.response_format);
    let res: any;
    try {
      // The handler reads `location` (string) and `language`, not the
      // location_code / language_code names the other tools use.
      res = await callJson(ctx.env, ctx.identity.userId, (req, env) => handlePeopleAlsoAsk(req, env), {
        keyword: args.keyword,
        location: String(locale.location_code),
        language: locale.language_code,
        depth: args.depth,
      });
    } catch (err) {
      if (err instanceof HandlerError && err.status < 500) return toolError(err.message);
      throw err;
    }
    const rows: any[] = Array.isArray(res?.data) ? res.data : [];
    const questions = rows.map((r) => ({
      question: stripHtml(String(r.question ?? '')),
      answer: stripHtml(String(r.answer ?? '')),
      source_url: r.source_url ?? '',
      source_domain: r.source_domain ?? '',
      source_type: r.source_type ?? 'people_also_ask',
      depth: r.depth_level ?? 1,
      parent: r.parent_keyword ?? args.keyword,
    }));
    const out = {
      keyword: args.keyword,
      depth: args.depth,
      ...locale,
      api_calls_made: res?.api_calls_made ?? null,
      source_stats: res?.source_stats ?? {},
      questions: compact(questions, { ...shape, maxArray: Math.max(shape.maxArray, 60) }),
      content_map: compact(res?.content_map ?? null, shape),
    };
    return toolResult(out, `${questions.length} People Also Ask items for "${args.keyword}" at depth ${args.depth}.`);
  },
});
