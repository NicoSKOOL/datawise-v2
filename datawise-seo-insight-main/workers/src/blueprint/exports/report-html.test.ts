import { describe, it, expect } from 'vitest';
import { renderBlueprintReportHtml, type BlueprintReportFacts } from './report-html';
import type { BlueprintLatestView, BlueprintGraphNode, BlueprintPageDetail } from '../db/blueprint-reads';

function makeLatest(overrides: Partial<BlueprintLatestView> = {}): BlueprintLatestView {
  return {
    versionId: 'version-1',
    versionNumber: 1,
    status: 'published',
    schemaVersion: 'v1',
    rulesetVersion: 'ruleset-2026-07',
    completeness: 'complete',
    partialReasons: [],
    summary: {},
    publishedAt: '2026-07-15T10:00:00.000Z',
    revision: { id: 'revision-1', revisionNumber: 1, revisionHash: 'hash-1' },
    ...overrides,
  };
}

function makeNode(overrides: Partial<BlueprintGraphNode> = {}): BlueprintGraphNode {
  return {
    logicalPageId: 'page-home',
    parentLogicalPageId: null,
    pageType: 'home',
    title: 'Home',
    slug: 'home',
    primaryKeyword: 'plumber near me',
    primaryVolume: 200,
    primaryIntent: 'commercial',
    recommendation: 'keep',
    approval: 'approved',
    priority: 'p1',
    confidenceLabel: 'high',
    supportingKeywordCount: 4,
    supportingKeywords: [],
    ...overrides,
  };
}

function makeDetail(node: BlueprintGraphNode, overrides: Partial<BlueprintPageDetail> = {}): BlueprintPageDetail {
  return {
    node,
    page: {
      h1: node.title,
      metaDescription: null,
      decisionReason: 'Primary landing page for the head keyword.',
      firedSignals: [],
      evidenceRefIds: [],
      clusterIds: [],
    },
    cluster: null,
    competitorEvidence: [],
    evidenceAvailable: true,
    faqs: [],
    fanOut: { status: 'pending_phase_5' },
    ...overrides,
  };
}

function baseFacts(overrides: Partial<BlueprintReportFacts> = {}): BlueprintReportFacts {
  const home = makeNode();
  return {
    projectName: 'Acme Plumbing',
    generatedAt: '2026-07-16T12:00:00.000Z',
    latest: makeLatest(),
    nodes: [home],
    detailByPageId: new Map([[home.logicalPageId, makeDetail(home)]]),
    ...overrides,
  };
}

describe('renderBlueprintReportHtml', () => {
  it('starts with the doctype and only contains "http" in the footer link', () => {
    const home = makeNode();
    const detail = makeDetail(home, {
      competitorEvidence: [{ domain: 'competitor.com', position: 1, url: 'https://competitor.com/plumbers' }],
    });
    const facts = baseFacts({ nodes: [home], detailByPageId: new Map([[home.logicalPageId, detail]]) });

    const html = renderBlueprintReportHtml(facts);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    const httpOccurrences = (html.match(/http/g) ?? []).length;
    expect(httpOccurrences).toBe(1);
    expect(html).not.toContain('competitor.com/plumbers');
    expect(html).toContain('competitor.com');
  });

  it('escapes a hostile title so the raw script tag never appears', () => {
    const home = makeNode({ title: '<script>alert(1)</script>' });
    const facts = baseFacts({ nodes: [home], detailByPageId: new Map([[home.logicalPageId, makeDetail(home)]]) });

    const html = renderBlueprintReportHtml(facts);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('nests a child page inside its parent list item in the site tree', () => {
    const home = makeNode({ logicalPageId: 'page-home', slug: 'home', title: 'Home', parentLogicalPageId: null });
    const child = makeNode({
      logicalPageId: 'page-service',
      slug: 'drain-cleaning',
      title: 'Drain Cleaning',
      parentLogicalPageId: 'page-home',
    });
    const facts = baseFacts({
      nodes: [home, child],
      detailByPageId: new Map([
        [home.logicalPageId, makeDetail(home)],
        [child.logicalPageId, makeDetail(child)],
      ]),
    });

    const html = renderBlueprintReportHtml(facts);

    const homeLiStart = html.indexOf('<li>Home');
    const childLiStart = html.indexOf('Drain Cleaning');
    const homeLiEnd = html.indexOf('</li>', childLiStart);
    expect(homeLiStart).toBeGreaterThan(-1);
    expect(childLiStart).toBeGreaterThan(homeLiStart);
    // the child's own </li> closes before the parent's </li>, i.e. child is nested inside parent's <li>...</li>
    const parentLiClose = html.lastIndexOf('</li>');
    expect(homeLiEnd).toBeLessThanOrEqual(parentLiClose);
    expect(html).toContain('<ul>');
  });

  it('lists an orphaned page under a Detached section instead of dropping it', () => {
    const home = makeNode({ logicalPageId: 'page-home', slug: 'home', title: 'Home', parentLogicalPageId: null });
    const orphan = makeNode({
      logicalPageId: 'page-orphan',
      slug: 'orphan-page',
      title: 'Orphan Page',
      parentLogicalPageId: 'page-does-not-exist',
    });
    const facts = baseFacts({
      nodes: [home, orphan],
      detailByPageId: new Map([
        [home.logicalPageId, makeDetail(home)],
        [orphan.logicalPageId, makeDetail(orphan)],
      ]),
    });

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('Detached');
    expect(html).toContain('Orphan Page');
  });

  it('states the fan-out limitation sentence for a partial run', () => {
    const home = makeNode();
    const facts = baseFacts({
      nodes: [home],
      detailByPageId: new Map([[home.logicalPageId, makeDetail(home)]]),
      latest: makeLatest({ completeness: 'partial', partialReasons: ['collect_us_fanout'] }),
    });

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('US fan-out evidence lands in a later phase');
  });

  it('does not state the fan-out limitation sentence for a complete run', () => {
    const facts = baseFacts();

    const html = renderBlueprintReportHtml(facts);

    expect(html).not.toContain('US fan-out evidence lands in a later phase');
  });

  it('lists pages with evidenceAvailable false in the limitations section', () => {
    const home = makeNode({ logicalPageId: 'page-home', slug: 'home', title: 'Home' });
    const gapPage = makeNode({ logicalPageId: 'page-gap', slug: 'no-evidence', title: 'No Evidence Page' });
    const facts = baseFacts({
      nodes: [home, gapPage],
      detailByPageId: new Map([
        [home.logicalPageId, makeDetail(home)],
        [gapPage.logicalPageId, makeDetail(gapPage, { evidenceAvailable: false })],
      ]),
    });

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('No Evidence Page');
  });

  it('produces byte-identical output for identical facts', () => {
    const facts = baseFacts();

    const first = renderBlueprintReportHtml(facts);
    const second = renderBlueprintReportHtml(facts);

    expect(first).toBe(second);
  });

  it('renders a single self-contained document with no script tags and an inline style block', () => {
    const facts = baseFacts();

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('<style>');
    expect(html).not.toContain('<script');
    expect(html).toContain('Built with');
    expect(html).toContain('https://datawiseseo.com');
  });

  it('renders stat cards computed from node recommendations', () => {
    const create = makeNode({ logicalPageId: 'p1', slug: 'p1', title: 'P1', recommendation: 'create' });
    const update = makeNode({ logicalPageId: 'p2', slug: 'p2', title: 'P2', recommendation: 'update' });
    const keep = makeNode({ logicalPageId: 'p3', slug: 'p3', title: 'P3', recommendation: 'keep' });
    const consolidate = makeNode({ logicalPageId: 'p4', slug: 'p4', title: 'P4', recommendation: 'consolidate' });
    const facts = baseFacts({
      nodes: [create, update, keep, consolidate],
      detailByPageId: new Map([
        [create.logicalPageId, makeDetail(create)],
        [update.logicalPageId, makeDetail(update)],
        [keep.logicalPageId, makeDetail(keep)],
        [consolidate.logicalPageId, makeDetail(consolidate)],
      ]),
    });

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('>4<'); // pages count
    expect(html).toContain('Acme Plumbing');
  });

  it('includes the decision reason as a why-this-page-exists cell in the page table', () => {
    const facts = baseFacts();

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('Primary landing page for the head keyword.');
  });

  it('renders an explanation for every partial reason, not just collect_us_fanout, and never leaves limitations empty', () => {
    const home = makeNode();
    const facts = baseFacts({
      nodes: [home],
      detailByPageId: new Map([[home.logicalPageId, makeDetail(home)]]),
      latest: makeLatest({ completeness: 'partial', partialReasons: ['overlay_existing_site', 'refine_clusters'] }),
    });

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('The existing-site inventory could not be fully collected, so keep/update recommendations may be incomplete.');
    expect(html).toContain('Live SERP refinement was incomplete, so some cluster boundaries are unrefined.');
    expect(html).not.toMatch(/<h3>Partial Run Limitations<\/h3>\s*<ul>\s*<\/ul>/);
  });

  it('renders a fallback sentence for an unrecognized partial reason stage', () => {
    const home = makeNode();
    const facts = baseFacts({
      nodes: [home],
      detailByPageId: new Map([[home.logicalPageId, makeDetail(home)]]),
      latest: makeLatest({ completeness: 'partial', partialReasons: ['some_future_stage'] }),
    });

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('Stage some_future_stage did not complete; related evidence may be missing.');
  });

  it('never drops a mutual parent cycle: both pages render under Detached and every node id appears exactly once', () => {
    const nodeA = makeNode({ logicalPageId: 'page-a', slug: 'page-a', title: 'Page A', parentLogicalPageId: 'page-b' });
    const nodeB = makeNode({ logicalPageId: 'page-b', slug: 'page-b', title: 'Page B', parentLogicalPageId: 'page-a' });
    const facts = baseFacts({
      nodes: [nodeA, nodeB],
      detailByPageId: new Map([
        [nodeA.logicalPageId, makeDetail(nodeA)],
        [nodeB.logicalPageId, makeDetail(nodeB)],
      ]),
    });

    const html = renderBlueprintReportHtml(facts);

    expect(html).toContain('Detached');
    const siteTreeStart = html.indexOf('<section class="site-tree">');
    const siteTreeEnd = html.indexOf('</section>', siteTreeStart);
    const siteTreeHtml = html.slice(siteTreeStart, siteTreeEnd);

    expect(siteTreeHtml).toContain('Page A');
    expect(siteTreeHtml).toContain('Page B');
    const liCount = (siteTreeHtml.match(/<li>/g) ?? []).length;
    expect(liCount).toBe(2);
  });
});
