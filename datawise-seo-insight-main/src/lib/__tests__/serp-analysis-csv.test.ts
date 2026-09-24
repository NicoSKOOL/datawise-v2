import { describe, it, expect } from 'vitest';
import { escapeCsv, serpAnalysisToCsv, type SerpCsvRow } from '../serp-analysis-csv';

const row: SerpCsvRow = {
  position: 1,
  title: 'Pressure Washing, Sydney | "Best"',
  url: 'https://a.test/',
  domain: 'a.test',
  isHomepage: true,
  inLocalPack: false,
  rating: null,
  titleMatch: 'exact',
  urlMatch: 'partial',
  page: { rank: 3, backlinks: 20, referringDomains: 10 },
  site: { rank: 19, backlinks: 900, referringDomains: 178, localLinkShare: 0.93, firstSeen: '2016-01-01 00:00:00 +00:00' },
  pageTraffic: null,
  siteTraffic: { etv: 685, keywords: 192, localPackEtv: 2112 },
  reasons: [{ kind: 'strength', label: 'Homepage ranking' }, { kind: 'weakness', label: 'Small link profile' }],
  beatable: false,
};

describe('serpAnalysisToCsv', () => {
  it('writes one header + one line per result with quoting, traffic and reasons', () => {
    const csv = serpAnalysisToCsv([row]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Est. site traffic/mo');
    expect(lines[1]).toContain('"Pressure Washing, Sydney | ""Best"""');
    expect(lines[1]).toContain(',685,192,2112,');
    expect(lines[1]).toContain(',93,2016-01-01,');
    expect(lines[1]).toContain(',Homepage ranking,Small link profile');
  });
});

describe('escapeCsv', () => {
  it('neutralises spreadsheet formulas', () => {
    expect(escapeCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsv('-5')).toBe("'-5");
  });
});
