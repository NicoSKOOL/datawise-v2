import { z } from 'zod';
import { defineTool, localeInputs, domainInput, resolveLocale, shapeFor } from './types';
import { callJson } from '../call-handler';
import { toolResult, compact } from '../shape';
import { handleAggregate, handleCrossAggregate } from '../../routes/llm-mentions';

const bare = (raw: string) => raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');

export const aiMentions = defineTool({
  name: 'datawise_ai_mentions',
  description:
    'Use this to see how often a domain is mentioned or cited in AI answers (DataForSEO LLM Mentions), aggregated over the last period. One domain returns its metrics; two to five domains return a side-by-side comparison. ' +
    'Costs about $0.10 per call. Do not use for Google organic rankings or backlinks.',
  inputSchema: z.object({
    domains: z.array(domainInput).min(1).max(5),
    platform: z.string().min(2).max(30).default('google').describe('AI platform: google (AI Mode / AI Overviews), chatgpt, gemini, perplexity.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domains = args.domains.map(bare);
    const uid = ctx.identity.userId;
    const res = domains.length === 1
      ? await callJson(ctx.env, uid, handleAggregate, { target: domains, platform: args.platform, ...locale })
      : await callJson(ctx.env, uid, handleCrossAggregate, { targets: domains, platform: args.platform, ...locale });
    const metrics = compact(res?.data ?? {}, shapeFor(args.response_format)) as Record<string, unknown>;
    return toolResult(
      { domains, platform: args.platform, ...locale, metrics },
      `AI mention metrics for ${domains.join(', ')} on ${args.platform}.`,
    );
  },
});
