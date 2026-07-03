// Deterministic source-quality tiers for the Content Writer research panel.
// Citation power ranks primary research and official documentation above
// commercial blogs (feedback 16d1a7c3: "all sources were competitor sites").

export type SourceTier = 'primary' | 'official' | 'general';

const PRIMARY_SUFFIXES = ['.gov', '.edu', '.gov.uk', '.gov.au', '.ac.uk', '.edu.au', '.int'];
const PRIMARY_HOSTS = [
  'pubmed.ncbi.nlm.nih.gov', 'nih.gov', 'who.int', 'europa.eu', 'nature.com',
  'sciencedirect.com', 'jstor.org', 'arxiv.org', 'census.gov', 'bls.gov',
  'oecd.org', 'worldbank.org', 'ourworldindata.org', 'statcan.gc.ca', 'abs.gov.au',
];
const OFFICIAL_HOSTS = ['developer.mozilla.org', 'learn.microsoft.com', 'cloud.google.com'];
const OFFICIAL_PREFIXES = ['docs.', 'developer.', 'developers.', 'support.', 'help.', 'learn.'];

export function classifySourceTier(url: string | null | undefined): SourceTier {
  if (!url) return 'general';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'general';
  }
  if (PRIMARY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'primary';
  if (PRIMARY_SUFFIXES.some((s) => host.endsWith(s))) return 'primary';
  if (OFFICIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'official';
  if (OFFICIAL_PREFIXES.some((p) => host.startsWith(p))) return 'official';
  return 'general';
}

export function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
