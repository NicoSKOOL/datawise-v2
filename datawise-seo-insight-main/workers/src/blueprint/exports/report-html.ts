// Pure, self-contained HTML renderer for a blueprint export report. No IO, no
// Date.now, no crypto: the caller resolves generatedAt and passes every fact
// in, so calling this twice with the same facts produces byte-identical
// output. Every interpolated value goes through esc() so hostile page titles
// or keywords can never break out of the markup.
import type { BlueprintLatestView, BlueprintGraphNode, BlueprintPageDetail } from '../db/blueprint-reads';

export interface BlueprintReportFacts {
  projectName: string;
  generatedAt: string;
  latest: BlueprintLatestView;
  nodes: BlueprintGraphNode[];
  detailByPageId: Map<string, BlueprintPageDetail>;
}

const FOOTER_URL = 'https://datawiseseo.com';
const FANOUT_LIMITATION = 'US fan-out evidence lands in a later phase.';

function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 2rem; background: #ffffff; color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5; }
  h1, h2, h3, h4 { color: #005232; }
  section { margin-bottom: 3rem; }
  .stat-cards { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 1rem; }
  .stat-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 1rem 1.5rem; min-width: 120px; }
  .stat-value { display: block; font-size: 1.75rem; font-weight: 700; color: #005232; }
  .stat-label { display: block; font-size: 0.85rem; color: #555555; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #e0e0e0; padding: 0.5rem 0.75rem; text-align: left; font-size: 0.9rem; }
  th { background: #f4f7f5; }
  .slug { color: #666666; font-size: 0.85rem; }
  ul { margin: 0.25rem 0; padding-left: 1.25rem; }
  .evidence-page { border-top: 1px solid #e0e0e0; padding-top: 1rem; margin-top: 1rem; }
  footer { border-top: 1px solid #e0e0e0; padding-top: 1rem; margin-top: 2rem; font-size: 0.85rem; color: #555555; }
  footer a { color: #005232; }
  @media print {
    section { page-break-after: always; }
    footer { page-break-after: avoid; }
  }
`;

function renderHead(facts: BlueprintReportFacts): string {
  return `<meta charset="utf-8"><title>${esc(facts.projectName)} - Blueprint Report</title><style>${STYLE}</style>`;
}

const RECOMMENDATIONS = ['create', 'update', 'keep', 'consolidate'] as const;

function keywordsAnalyzedFrom(summary: Record<string, unknown>): number | null {
  const raw = summary['keywordsAnalyzed'];
  return typeof raw === 'number' ? raw : null;
}

function renderCover(facts: BlueprintReportFacts): string {
  const counts: Record<(typeof RECOMMENDATIONS)[number], number> = { create: 0, update: 0, keep: 0, consolidate: 0 };
  for (const node of facts.nodes) {
    if ((RECOMMENDATIONS as readonly string[]).includes(node.recommendation)) {
      counts[node.recommendation as (typeof RECOMMENDATIONS)[number]]++;
    }
  }
  const keywordsAnalyzed = keywordsAnalyzedFrom(facts.latest.summary);

  const statCards = [
    { value: facts.nodes.length, label: 'Pages' },
    { value: counts.create, label: 'Create' },
    { value: counts.update, label: 'Update' },
    { value: counts.keep, label: 'Keep' },
    { value: counts.consolidate, label: 'Consolidate' },
    ...(keywordsAnalyzed !== null ? [{ value: keywordsAnalyzed, label: 'Keywords Analyzed' }] : []),
    { value: facts.latest.completeness, label: 'Completeness' },
  ];

  const cardsHtml = statCards
    .map((card) => `<div class="stat-card"><span class="stat-value">${esc(card.value)}</span><span class="stat-label">${esc(card.label)}</span></div>`)
    .join('');

  return `<section class="cover">
    <h1>${esc(facts.projectName)}</h1>
    <p class="meta">Generated ${esc(facts.generatedAt)}</p>
    <div class="stat-cards">${cardsHtml}</div>
  </section>`;
}

function buildChildrenByParent(nodes: BlueprintGraphNode[]): Map<string, BlueprintGraphNode[]> {
  const map = new Map<string, BlueprintGraphNode[]>();
  for (const node of nodes) {
    if (node.parentLogicalPageId === null) continue;
    const siblings = map.get(node.parentLogicalPageId) ?? [];
    siblings.push(node);
    map.set(node.parentLogicalPageId, siblings);
  }
  return map;
}

// ancestors guards against a cyclical parent chain (should never happen, but
// a broken chain must render something rather than recurse forever).
function renderTreeItem(node: BlueprintGraphNode, childrenByParent: Map<string, BlueprintGraphNode[]>, ancestors: Set<string>): string {
  const children = (childrenByParent.get(node.logicalPageId) ?? []).filter((child) => !ancestors.has(child.logicalPageId));
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(node.logicalPageId);
  const childrenHtml = children.length > 0 ? `<ul>${children.map((child) => renderTreeItem(child, childrenByParent, nextAncestors)).join('')}</ul>` : '';
  return `<li>${esc(node.title)} <span class="slug">/${esc(node.slug)}</span>${childrenHtml}</li>`;
}

function renderSiteTree(nodes: BlueprintGraphNode[]): string {
  const nodeById = new Map(nodes.map((node) => [node.logicalPageId, node]));
  const childrenByParent = buildChildrenByParent(nodes);
  const roots = nodes.filter((node) => node.parentLogicalPageId === null);
  const orphans = nodes.filter((node) => node.parentLogicalPageId !== null && !nodeById.has(node.parentLogicalPageId));

  const rootsHtml = `<ul>${roots.map((node) => renderTreeItem(node, childrenByParent, new Set())).join('')}</ul>`;
  const orphansHtml = orphans.length > 0
    ? `<h3>Detached</h3><p>Pages whose parent no longer exists in this revision:</p><ul>${orphans.map((node) => renderTreeItem(node, childrenByParent, new Set())).join('')}</ul>`
    : '';

  return `<section class="site-tree">
    <h2>Site Structure</h2>
    ${rootsHtml}
    ${orphansHtml}
  </section>`;
}

function renderPageTable(nodes: BlueprintGraphNode[], detailByPageId: Map<string, BlueprintPageDetail>, nodeById: Map<string, BlueprintGraphNode>): string {
  const rows = nodes
    .map((node) => {
      const detail = detailByPageId.get(node.logicalPageId);
      const decisionReason = detail?.page.decisionReason ?? null;
      const parent = node.parentLogicalPageId ? nodeById.get(node.parentLogicalPageId) : null;
      return `<tr>
        <td>${esc(node.slug)}</td>
        <td>${esc(node.title)}</td>
        <td>${esc(node.pageType)}</td>
        <td>${esc(node.primaryKeyword)}</td>
        <td>${esc(node.primaryVolume)}</td>
        <td>${esc(node.primaryIntent)}</td>
        <td>${esc(parent ? parent.slug : '')}</td>
        <td>${esc(node.recommendation)}</td>
        <td>${esc(node.priority)}</td>
        <td>${esc(node.supportingKeywordCount)}</td>
        <td>${esc(decisionReason)}</td>
      </tr>`;
    })
    .join('');

  return `<section class="page-table">
    <h2>Pages</h2>
    <table>
      <thead>
        <tr>
          <th>Slug</th><th>Title</th><th>Page Type</th><th>Primary Keyword</th><th>Volume</th>
          <th>Intent</th><th>Parent Slug</th><th>Recommendation</th><th>Priority</th>
          <th>Supporting Keywords</th><th>Why This Page Exists</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function renderEvidencePage(node: BlueprintGraphNode, detail: BlueprintPageDetail): string {
  const memberItems = (detail.cluster?.members ?? [])
    .map((member) => `<li>${esc(member.keyword)}${member.volume !== null ? ` (${esc(member.volume)})` : ''}${member.intent ? ` - ${esc(member.intent)}` : ''}</li>`)
    .join('');
  // Competitor URLs are never rendered, only domain + position: keeps this a
  // link-free report body with exactly one href, the footer.
  const competitorItems = detail.competitorEvidence
    .map((competitor) => `<li>#${esc(competitor.position)} ${esc(competitor.domain)}</li>`)
    .join('');
  const faqItems = detail.faqs
    .map((faq) => `<li>${esc(faq.question)}${faq.source ? ` <span class="source">(${esc(faq.source)})</span>` : ''}</li>`)
    .join('');

  const primaryKeywordLine = node.primaryKeyword
    ? `${esc(node.primaryKeyword)}${node.primaryVolume !== null ? ` (${esc(node.primaryVolume)} searches/mo${node.primaryIntent ? `, ${esc(node.primaryIntent)}` : ''})` : ''}`
    : 'None';

  return `<article class="evidence-page">
    <h3>${esc(node.title)} <span class="slug">/${esc(node.slug)}</span></h3>
    <p class="primary-keyword">Primary keyword: ${primaryKeywordLine}</p>
    ${memberItems ? `<h4>Top Member Keywords</h4><ul>${memberItems}</ul>` : ''}
    ${competitorItems ? `<h4>Competitor Ranks</h4><ul>${competitorItems}</ul>` : ''}
    ${faqItems ? `<h4>FAQs</h4><ul>${faqItems}</ul>` : ''}
  </article>`;
}

function renderEvidenceAppendix(nodes: BlueprintGraphNode[], detailByPageId: Map<string, BlueprintPageDetail>): string {
  const pages = nodes
    .map((node) => {
      const detail = detailByPageId.get(node.logicalPageId);
      return detail ? renderEvidencePage(node, detail) : '';
    })
    .join('');

  return `<section class="evidence-appendix">
    <h2>Evidence Appendix</h2>
    ${pages}
  </section>`;
}

function renderMethodology(facts: BlueprintReportFacts): string {
  const limitations: string[] = [];
  if (facts.latest.partialReasons.includes('collect_us_fanout')) {
    limitations.push(FANOUT_LIMITATION);
  }

  const evidenceGapPages = facts.nodes.filter((node) => {
    const detail = facts.detailByPageId.get(node.logicalPageId);
    return detail ? !detail.evidenceAvailable : false;
  });

  const limitationItems = limitations.map((reason) => `<li>${esc(reason)}</li>`).join('');
  const gapItems = evidenceGapPages.map((node) => `<li>${esc(node.title)} <span class="slug">/${esc(node.slug)}</span></li>`).join('');

  return `<section class="methodology">
    <h2>Methodology &amp; Limitations</h2>
    <p>Ruleset version: ${esc(facts.latest.rulesetVersion)}</p>
    <p>Run completeness: ${esc(facts.latest.completeness)}</p>
    ${limitationItems ? `<h3>Partial Run Limitations</h3><ul>${limitationItems}</ul>` : ''}
    ${gapItems ? `<h3>Evidence Gaps</h3><p>The following pages do not yet have competitor SERP evidence:</p><ul>${gapItems}</ul>` : ''}
  </section>`;
}

function renderFooter(): string {
  return `<footer><p>Built with <a href="${FOOTER_URL}">DataWise</a></p></footer>`;
}

export function renderBlueprintReportHtml(facts: BlueprintReportFacts): string {
  const nodeById = new Map(facts.nodes.map((node) => [node.logicalPageId, node]));

  return [
    '<!doctype html>',
    '<html lang="en">',
    `<head>${renderHead(facts)}</head>`,
    '<body>',
    renderCover(facts),
    renderSiteTree(facts.nodes),
    renderPageTable(facts.nodes, facts.detailByPageId, nodeById),
    renderEvidenceAppendix(facts.nodes, facts.detailByPageId),
    renderMethodology(facts),
    renderFooter(),
    '</body>',
    '</html>',
  ].join('\n');
}
