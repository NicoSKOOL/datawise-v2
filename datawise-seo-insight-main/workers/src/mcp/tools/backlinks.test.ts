import { describe, it, expect, vi } from 'vitest';
import { makeMcpTestEnv } from '../test-support';
import type { McpIdentity } from '../env';

const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
vi.mock('../../routes/backlinks', () => ({
  handleBacklinksSummary: vi.fn(async () => json({ data: { backlinks: 10, referring_domains: 4, referring_main_domains: 4, rank: 50, broken_backlinks: 0, referring_ips: 3 }, cost: 0.02 })),
  handleBacklinksList: vi.fn(async (req: Request) => {
    const b = await req.clone().json() as any;
    return json({ data: { items: Array.from({ length: Math.min(b.limit, 3) }, (_, i) => ({
      url_from: `https://from${i}.com/<b>p</b>`, url_to: 'https://t.com/', domain_from: `from${i}.com`, anchor: 'click', dofollow: i !== 1,
      domain_from_rank: 100 + i, first_seen: '2026-01-0' + (i + 1), last_seen: '2026-09-01', extra: 'x',
    })) }, cost: 0.03 });
  }),
  handleReferringDomains: vi.fn(async () => json({ data: { items: [{ domain: 'ref.com', rank: 70, backlinks: 5, referring_pages: 3, first_seen: '2026-02-01' }] }, cost: 0.02 })),
  handleAnchors: vi.fn(async () => json({ data: { items: [{ anchor: 'brand', backlinks: 9, referring_domains: 4, rank: 60 }] }, cost: 0.02 })),
}));

import { backlinks } from './backlinks';
import * as bl from '../../routes/backlinks';

const identity: McpIdentity = { userId: 'u1', email: 'a@b.c', tier: 'pro', isAdmin: false, isCommunityMember: false, defaultLocationCode: 2840, defaultLanguageCode: 'en', tokenId: 't', tokenName: 'n', authKind: 'api_token' };

describe('datawise_backlinks', () => {
  it('summary is the default view', async () => {
    const { env } = makeMcpTestEnv();
    const out = await backlinks.run(backlinks.inputSchema.parse({ domain: 'T.com' }), { env, identity });
    expect((out.structuredContent as any).summary).toEqual({ total: 10, referring_domains: 4, referring_main_domains: 4, domain_rank: 50, broken: 0 });
    expect(JSON.stringify(out.structuredContent)).not.toContain('cost');
  });

  it('list view flattens rows, strips html, and passes one_per_domain', async () => {
    const { env } = makeMcpTestEnv();
    const out = await backlinks.run(backlinks.inputSchema.parse({ domain: 't.com', view: 'list', limit: 2 }), { env, identity });
    const rows = (out.structuredContent as any).backlinks;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ url_from: 'https://from0.com/p', url_to: 'https://t.com/', domain_from: 'from0.com', anchor: 'click', dofollow: true, domain_rank: 100, first_seen: '2026-01-01', last_seen: '2026-09-01' });
    const sent = await (bl.handleBacklinksList as any).mock.calls[0][0].json();
    expect(sent).toMatchObject({ target: 't.com', limit: 2, mode: 'one_per_domain' });
  });

  it('referring_domains and anchors views', async () => {
    const { env } = makeMcpTestEnv();
    const rd = await backlinks.run(backlinks.inputSchema.parse({ domain: 't.com', view: 'referring_domains' }), { env, identity });
    expect((rd.structuredContent as any).referring_domains[0]).toEqual({ domain: 'ref.com', domain_rank: 70, backlinks: 5, referring_pages: 3, first_seen: '2026-02-01' });
    const an = await backlinks.run(backlinks.inputSchema.parse({ domain: 't.com', view: 'anchors' }), { env, identity });
    expect((an.structuredContent as any).anchors[0]).toEqual({ anchor: 'brand', backlinks: 9, referring_domains: 4 });
  });

  it('detailed response_format adds raw to list view (aligned with returned rows); concise summary has none', async () => {
    const { env } = makeMcpTestEnv();
    const list = await backlinks.run(backlinks.inputSchema.parse({ domain: 't.com', view: 'list', limit: 2, response_format: 'detailed' }), { env, identity });
    const listStructured = list.structuredContent as any;
    expect(listStructured.raw).toBeDefined();
    expect(listStructured.raw).toHaveLength(listStructured.backlinks.length);

    const summary = await backlinks.run(backlinks.inputSchema.parse({ domain: 't.com', view: 'summary' }), { env, identity });
    expect((summary.structuredContent as any).raw).toBeUndefined();
  });
});
