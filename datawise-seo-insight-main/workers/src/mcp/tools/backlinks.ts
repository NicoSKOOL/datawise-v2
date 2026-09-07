import { z } from 'zod';
import { defineTool, localeInputs, domainInput } from './types';
import { callJson } from '../call-handler';
import { toolResult, stripHtml, compact, DETAILED } from '../shape';
import { handleBacklinksSummary, handleBacklinksList, handleReferringDomains, handleAnchors } from '../../routes/backlinks';

const bare = (raw: string) => raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '');
const rows = (res: any): any[] => res?.data?.items ?? [];

export const backlinks = defineTool({
  name: 'datawise_backlinks',
  description:
    'Use this for backlink data on a domain. view=summary (default): totals, referring domains, domain rank, broken links. view=list: individual backlinks, one per referring domain, newest first. view=referring_domains: referring domains with their rank. view=anchors: anchor text distribution. ' +
    'Do not use for organic keywords or traffic (datawise_domain_overview).',
  inputSchema: z.object({
    domain: domainInput,
    view: z.enum(['summary', 'list', 'referring_domains', 'anchors']).default('summary'),
    limit: z.number().int().min(1).max(100).default(25).describe('Rows for list, referring_domains and anchors views.'),
    offset: z.number().int().min(0).default(0),
    response_format: localeInputs.response_format,
  }),
  async run(args, ctx) {
    const domain = bare(args.domain);
    const uid = ctx.identity.userId;
    if (args.view === 'summary') {
      const res = await callJson(ctx.env, uid, handleBacklinksSummary, { target: domain });
      const d = res?.data ?? {};
      const summary = { total: d.backlinks ?? 0, referring_domains: d.referring_domains ?? 0, referring_main_domains: d.referring_main_domains ?? 0, domain_rank: d.rank ?? 0, broken: d.broken_backlinks ?? 0 };
      const structured: Record<string, unknown> = { domain, view: 'summary', summary };
      if (args.response_format === 'detailed') structured.raw = compact(d, DETAILED);
      return toolResult(structured, `${domain}: ${summary.total} backlinks from ${summary.referring_domains} referring domains, domain rank ${summary.domain_rank}.`);
    }
    if (args.view === 'list') {
      const res = await callJson(ctx.env, uid, handleBacklinksList, { target: domain, limit: args.limit, offset: args.offset, mode: 'one_per_domain', order_by: ['first_seen,desc'] });
      const rawItems = rows(res);
      const list = rawItems.map((it: any) => ({
        url_from: stripHtml(String(it.url_from ?? '')),
        url_to: stripHtml(String(it.url_to ?? '')),
        domain_from: it.domain_from ?? null,
        anchor: stripHtml(String(it.anchor ?? '')),
        dofollow: Boolean(it.dofollow),
        domain_rank: it.domain_from_rank ?? it.rank ?? null,
        first_seen: it.first_seen ?? null,
        last_seen: it.last_seen ?? null,
      }));
      const structured: Record<string, unknown> = { domain, view: 'list', offset: args.offset, backlinks: list };
      if (args.response_format === 'detailed') structured.raw = compact(rawItems, DETAILED);
      return toolResult(structured, `${list.length} backlinks for ${domain} (one per referring domain).`);
    }
    if (args.view === 'referring_domains') {
      const res = await callJson(ctx.env, uid, handleReferringDomains, { target: domain, limit: args.limit, offset: args.offset });
      const rawItems = rows(res).slice(0, args.limit);
      const list = rawItems.map((it: any) => ({
        domain: it.domain, domain_rank: it.rank ?? null, backlinks: it.backlinks ?? 0, referring_pages: it.referring_pages ?? 0, first_seen: it.first_seen ?? null,
      }));
      const structured: Record<string, unknown> = { domain, view: 'referring_domains', offset: args.offset, referring_domains: list };
      if (args.response_format === 'detailed') structured.raw = compact(rawItems, DETAILED);
      return toolResult(structured, `${list.length} referring domains for ${domain}.`);
    }
    const res = await callJson(ctx.env, uid, handleAnchors, { target: domain, limit: args.limit });
    const rawItems = rows(res).slice(0, args.limit);
    const list = rawItems.map((it: any) => ({
      anchor: stripHtml(String(it.anchor ?? '')), backlinks: it.backlinks ?? 0, referring_domains: it.referring_domains ?? 0,
    }));
    const structured: Record<string, unknown> = { domain, view: 'anchors', anchors: list };
    if (args.response_format === 'detailed') structured.raw = compact(rawItems, DETAILED);
    return toolResult(structured, `${list.length} anchor texts for ${domain}.`);
  },
});
