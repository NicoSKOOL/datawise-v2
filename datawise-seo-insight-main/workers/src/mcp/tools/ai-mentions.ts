import { z } from 'zod';
import { defineTool, localeInputs, domainInput, resolveLocale, shapeFor } from './types';
import { callJson } from '../call-handler';
import { toolResult, compact } from '../shape';
import { handleAggregate, handleCrossAggregate } from '../../routes/llm-mentions';

const bare = (raw: string) => raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');

// DataForSEO LLM Mentions only covers Google (AI Mode / AI Overviews) and
// ChatGPT, and names the latter chat_gpt. Accept the natural spelling too.
const PLATFORMS = ['google', 'chatgpt', 'chat_gpt'] as const;
const dfsPlatform = (p: (typeof PLATFORMS)[number]): 'google' | 'chat_gpt' => (p === 'google' ? 'google' : 'chat_gpt');

// The shape DataForSEO requires for each target, identical to what Brand
// Tracker sends. Plain strings are rejected with "Each 'target' item must be
// an object" (reported by a member on 2026-09-10).
const targetFor = (domain: string) => [{ domain, include_subdomains: true }];

export const aiMentions = defineTool({
  name: 'datawise_ai_mentions',
  description:
    'Use this to see how often a domain is mentioned or cited in AI answers (DataForSEO LLM Mentions), aggregated over the last period. One domain returns its metrics; two to five domains return a side-by-side comparison. ' +
    'Costs about $0.10 per call. Do not use for Google organic rankings or backlinks.',
  inputSchema: z.object({
    domains: z.array(domainInput).min(1).max(5),
    platform: z.enum(PLATFORMS).default('google').describe('AI platform: google (AI Mode / AI Overviews) or chatgpt. DataForSEO LLM Mentions covers only these two.'),
    ...localeInputs,
  }),
  async run(args, ctx) {
    const locale = resolveLocale(args, ctx.identity);
    const domains = args.domains.map(bare);
    const platform = dfsPlatform(args.platform);
    const uid = ctx.identity.userId;
    const res = domains.length === 1
      ? await callJson(ctx.env, uid, handleAggregate, { target: targetFor(domains[0]), platform, ...locale })
      : await callJson(ctx.env, uid, handleCrossAggregate, {
          targets: domains.map((domain) => ({ aggregation_key: domain, target: targetFor(domain) })),
          platform,
          ...locale,
        });
    const metrics = compact(res?.data ?? {}, shapeFor(args.response_format)) as Record<string, unknown>;
    return toolResult(
      { domains, platform, ...locale, metrics },
      `AI mention metrics for ${domains.join(', ')} on ${platform}.`,
    );
  },
});
