// CSV export for the SERP Analysis tab. Shapes mirror the worker response
// (workers/src/routes/serp-analysis.ts).

export interface SerpCsvRow {
  position: number;
  title: string;
  url: string;
  domain: string;
  isHomepage: boolean;
  inLocalPack: boolean;
  rating: { value: number; votes: number } | null;
  titleMatch: string;
  urlMatch: string;
  page: { rank: number; backlinks: number; referringDomains: number } | null;
  site: { rank: number; backlinks: number; referringDomains: number; localLinkShare: number | null; firstSeen: string | null } | null;
  pageTraffic: { etv: number; keywords: number } | null;
  siteTraffic: { etv: number; keywords: number; localPackEtv: number } | null;
  reasons: Array<{ kind: 'strength' | 'weakness'; label: string }>;
  beatable: boolean;
}

const HEADER = [
  'Position', 'Title', 'URL', 'Domain',
  'Domain Rank', 'Page Rank', 'Referring domains (page)', 'Backlinks (page)',
  'Referring domains (site)', 'Backlinks (site)', 'Local link share %', 'Link profile since',
  'Est. site traffic/mo', 'Site ranking keywords', 'Est. Local Pack traffic/mo', 'Est. page traffic/mo', 'Page ranking keywords',
  'Keyword in title', 'Keyword in URL', 'Homepage', 'In Local Pack', 'Rating', 'Reviews',
  'Weak spot', 'Why it ranks', 'Vulnerabilities',
];

export function escapeCsv(value: string | number | boolean | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  // Leading =,+,-,@ would run as a formula in Excel/Sheets (page titles are untrusted).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function serpAnalysisToCsv(rows: SerpCsvRow[]): string {
  const lines = [HEADER.map(escapeCsv).join(',')];
  for (const r of rows) {
    lines.push([
      r.position, r.title, r.url, r.domain,
      r.site?.rank, r.page?.rank, r.page?.referringDomains, r.page?.backlinks,
      r.site?.referringDomains, r.site?.backlinks,
      r.site?.localLinkShare != null ? Math.round(r.site.localLinkShare * 100) : null,
      r.site?.firstSeen ? r.site.firstSeen.slice(0, 10) : null,
      r.siteTraffic?.etv, r.siteTraffic?.keywords, r.siteTraffic?.localPackEtv, r.pageTraffic?.etv, r.pageTraffic?.keywords,
      r.titleMatch, r.urlMatch, r.isHomepage ? 'Yes' : 'No', r.inLocalPack ? 'Yes' : 'No',
      r.rating?.value, r.rating?.votes,
      r.beatable ? 'Yes' : 'No',
      r.reasons.filter((x) => x.kind === 'strength').map((x) => x.label).join('; '),
      r.reasons.filter((x) => x.kind === 'weakness').map((x) => x.label).join('; '),
    ].map(escapeCsv).join(','));
  }
  return lines.join('\n');
}
