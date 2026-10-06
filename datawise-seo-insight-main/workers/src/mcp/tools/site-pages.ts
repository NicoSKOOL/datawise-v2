import { z } from 'zod';
import { defineTool, shapeFor } from './types';
import { asWorkerEnv } from '../env';
import { toolResult, toolError, compact } from '../shape';
import { siteOrigin, normalizeSiteUrl, rankSiteUrls, discoverSitemapUrls, type UrlCandidate } from '../../site/discover';
import { fetchSitePage, failedPageFacts, mapLimit } from '../../site/fetch-page';
import { LOCAL_BUSINESS_TYPES, type PageFacts } from '../../site/extract';

// The business website as structured data, so the model can compare it with
// the Google Business Profile: NAP on every page, hours, LocalBusiness
// schema, and which services have a page. Data only, no judgement.

const CONCURRENCY = 5;
// Wall-clock budget for the whole tool call: at most 8s direct + 8s
// DataForSEO fallback per page, 25 pages at 5-way concurrency can otherwise
// run to ~80s. Pages not started before the deadline come back as a
// fetch_failed placeholder instead of being fetched.
export const SITE_PAGES_DEADLINE_MS = 60_000;

function countValues(pages: PageFacts[], pick: (p: PageFacts) => string[]): Array<{ value: string; pages: number }> {
  const counts = new Map<string, number>();
  for (const p of pages) for (const v of new Set(pick(p))) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value, n]) => ({ value, pages: n }));
}

function firstLocalBusiness(pages: PageFacts[]): Record<string, any> | null {
  for (const p of pages) for (const s of p.schema) {
    const types = Array.isArray(s['@type']) ? s['@type'] : [s['@type']];
    if (types.some((t: unknown) => typeof t === 'string' && LOCAL_BUSINESS_TYPES.test(t))) return s;
  }
  return null;
}

export const sitePages = defineTool({
  name: 'datawise_site_pages',
  description:
    'Use this to read a business website as structured data for a Google Business Profile comparison. Give it any URL on the site: it finds the sitemap and navigation, picks the homepage, contact, about, service and location pages (up to max_pages), and returns for each page the title, meta description, headings, phone numbers, postal addresses, opening-hours text, LocalBusiness / Service / FAQ JSON-LD, navigation links, service terms and trimmed body text, plus a site_facts rollup of phones, addresses and schema across pages. Pages behind a bot wall are listed in blocked_urls. ' +
    'Cost is at most $0.002 per page (free when the site can be read directly), and pages are cached for a day. Call datawise_gbp_profile first, then compare: NAP on the profile versus every page, hours versus schema and hours text, categories and services on the profile versus service pages, and services customers mention in reviews versus pages.',
  inputSchema: z.object({
    url: z.string().min(4).max(2048).describe('Any URL on the business website, for example https://acme.com.au or acme.com.au/services.'),
    urls: z.array(z.string().min(4).max(2048)).max(25).default([]).describe('Optional specific pages to include. They are fetched first and count towards max_pages.'),
    max_pages: z.number().int().min(1).max(25).default(15).describe('How many pages to return, 1 to 25. Default 15.'),
    response_format: z.enum(['concise', 'detailed']).default('concise').describe('concise returns about 3,000 characters of body text per page; detailed about 8,000.'),
  }),
  async run(args, ctx) {
    const deadline = Date.now() + SITE_PAGES_DEADLINE_MS;
    const env = asWorkerEnv(ctx.env);
    const shape = shapeFor(args.response_format);
    const bodyChars = args.response_format === 'detailed' ? 8000 : 3000;
    const origin = siteOrigin(args.url);
    if (!origin) return toolError(`"${args.url}" is not a website URL. Pass something like https://acme.com.au.`);
    const host = new URL(origin).hostname;
    // rankSiteUrls normalises every URL it sees (including the explicit list)
    // through normalizeSiteUrl, which turns a bare origin into its slashed
    // form. Fetch and short-circuit on that same normalised value so the
    // homepage isn't fetched twice under two different spellings.
    const homeUrl = normalizeSiteUrl(origin, host) ?? origin;

    const [sitemap, home] = await Promise.all([
      discoverSitemapUrls(origin, fetch, { maxUrls: 500, timeoutMs: 5000 }),
      fetchSitePage(env, homeUrl, { bodyChars, timeoutMs: 8000 }),
    ]);
    if (home.fetch_failed && !sitemap.sitemap_found && sitemap.urls.length === 0) {
      return toolError(`${host} could not be fetched: the homepage did not load and no sitemap was found. Check the URL, or pass specific page urls.`);
    }

    const candidates: UrlCandidate[] = [
      ...home.nav_links.map((l) => ({ url: l.url, anchor: l.anchor, fromNav: true })),
      ...sitemap.urls.map((u) => ({ url: u })),
    ];
    const explicit = [homeUrl, ...args.urls];
    const selected = rankSiteUrls(candidates, { host, explicit, max: args.max_pages });
    const discovered = new Set(
      [homeUrl, ...args.urls, ...candidates.map((c) => c.url)]
        .map((u) => normalizeSiteUrl(u, host))
        .filter((u): u is string => u != null),
    ).size;

    const pages = await mapLimit(selected, CONCURRENCY, async (u) => {
      if (u === homeUrl) return home;
      if (Date.now() > deadline) return failedPageFacts(u);
      return fetchSitePage(env, u, { bodyChars, timeoutMs: 8000 });
    });
    const usable = pages.filter((p) => !p.fetch_failed && !p.blocked);
    const blockedUrls = pages.filter((p) => p.blocked).map((p) => p.url);
    const skipped = pages.filter((p) => p.fetch_failed && !p.blocked).length;
    const lb = firstLocalBusiness(usable);

    const out = {
      site: { url: origin, host, sitemap_found: sitemap.sitemap_found, pages_discovered: discovered, pages_returned: pages.length },
      pages: pages.map((p) => compact({ ...p, schema: p.schema.slice(0, 5) }, { ...shape, maxString: Math.max(shape.maxString, bodyChars), maxArray: Math.max(shape.maxArray, 60) })),
      blocked_urls: blockedUrls,
      skipped_urls_count: skipped,
      site_facts: {
        phones: countValues(usable, (p) => p.phones),
        addresses: countValues(usable, (p) => p.addresses),
        local_business_schema: lb,
        hours_from_schema: lb?.openingHoursSpecification ?? lb?.openingHours ?? null,
      },
      fetched_at: new Date().toISOString(),
    };
    const serviceLike = usable.filter((p) => /service|location|area|treatment|repair|pricing|menu/i.test(p.url)).length;
    return toolResult(out, `${host}: ${pages.length} pages (${serviceLike} service/location, ${blockedUrls.length} blocked), ${out.site_facts.phones.length} phone(s), ${out.site_facts.addresses.length} address(es), LocalBusiness schema ${lb ? 'yes' : 'no'}.`);
  },
});
