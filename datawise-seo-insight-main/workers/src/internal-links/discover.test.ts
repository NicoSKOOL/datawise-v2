import { afterEach, describe, expect, it, vi } from 'vitest';
import { discoverSitemap, isBlockStatus } from './discover';

const SITEMAP = '<?xml version="1.0"?><urlset><url><loc>https://example.com/a/</loc></url></urlset>';

// Answers by path; anything unlisted gets the fallback status.
function site(routes: Record<string, string>, fallback: number) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    return path in routes ? new Response(routes[path], { status: 200 }) : new Response('<html>no</html>', { status: fallback });
  });
}

describe('discoverSitemap', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports a firewall 403 as blocked with its status', async () => {
    vi.stubGlobal('fetch', site({}, 403));
    const d = await discoverSitemap('example.com');
    expect(d.urls).toEqual([]);
    expect(d.blocked).toBe(true);
    expect(d.blockedStatus).toBe(403);
  });

  it('treats 404s as no sitemap, not a block', async () => {
    vi.stubGlobal('fetch', site({}, 404));
    const d = await discoverSitemap('example.com');
    expect(d.blocked).toBe(false);
    expect(d.blockedStatus).toBeNull();
  });

  it('still finds the sitemap when only some URLs are refused', async () => {
    vi.stubGlobal('fetch', site({ '/sitemap_index.xml': SITEMAP }, 403));
    const d = await discoverSitemap('example.com');
    expect(d.urls).toEqual(['https://example.com/a/']);
  });
});

describe('isBlockStatus', () => {
  it('flags 401, 403 and 429 only', () => {
    expect([401, 403, 429].every(isBlockStatus)).toBe(true);
    expect([0, 200, 404, 500, 503].some(isBlockStatus)).toBe(false);
  });
});
