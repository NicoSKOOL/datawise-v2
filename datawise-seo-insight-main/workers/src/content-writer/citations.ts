// External-citation guard for the draft step.
//
// Roughly one in four drafts came back with internal links only, even when
// the prompt carried 5 to 11 approved source URLs (census of 59 written posts,
// July to September 2026: 14 had zero external links). The prompt asks for
// inline citations but nothing enforced it. These helpers make the outcome
// deterministic: count what the model produced, and when it produced no
// external link at all while approved sources exist, drive one corrective
// turn and validate that the repair only added links.

const MD_LINK_RE = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL_RE = /https?:\/\/[^\s)\]>"']+/g;
const REFERENCES_HEADING_RE = /^#{1,6}\s*(references|sources|citations|bibliography|further reading)\b/im;

export interface MarkdownLinkCounts {
  external: number;
  internal: number;
  externalUrls: string[];
}

export type CitationRepairValidation =
  | { ok: true; externalLinks: number }
  | { ok: false; reason: string; externalLinks: number };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function normalizeSiteHost(siteUrl: string | null | undefined): string | null {
  const raw = (siteUrl || '').trim();
  if (!raw) return null;
  return hostOf(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
}

function isInternalUrl(url: string, siteHost: string | null): boolean {
  if (!siteHost) return false;
  const host = hostOf(url);
  if (!host) return false;
  return host === siteHost || host.endsWith(`.${siteHost}`);
}

function linesOutsideFences(markdown: string): string[] {
  let inFence = false;
  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

export function countMarkdownLinks(markdown: string, siteUrl: string | null | undefined): MarkdownLinkCounts {
  const siteHost = normalizeSiteHost(siteUrl);
  const counts: MarkdownLinkCounts = { external: 0, internal: 0, externalUrls: [] };
  for (const line of linesOutsideFences(markdown || '')) {
    for (const match of line.matchAll(MD_LINK_RE)) {
      const url = match[1];
      if (isInternalUrl(url, siteHost)) {
        counts.internal += 1;
      } else {
        counts.external += 1;
        counts.externalUrls.push(url);
      }
    }
  }
  return counts;
}

export function extractApprovedSourceUrls(sourcesText: string | null | undefined, siteUrl: string | null | undefined): string[] {
  if (!sourcesText) return [];
  const siteHost = normalizeSiteHost(siteUrl);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of sourcesText.match(BARE_URL_RE) || []) {
    const url = raw.replace(/[.,;:!?)\]'"]+$/, '');
    if (!url || seen.has(url) || isInternalUrl(url, siteHost)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function shouldRepairMissingCitations(input: { externalLinks: number; approvedUrls: number }): boolean {
  return input.approvedUrls > 0 && input.externalLinks === 0;
}

export function citationTarget(approvedUrlCount: number): number {
  return Math.max(1, Math.min(3, approvedUrlCount));
}

export function buildCitationRepairPrompt(approvedUrls: string[]): string {
  const target = citationTarget(approvedUrls.length);
  return [
    'The draft you just wrote contains no external citations, so it is incomplete. Revise it so the factual claims that come from the approved sources are cited inline.',
    '',
    'Approved source URLs (use only these):',
    ...approvedUrls.map((url) => `- ${url}`),
    '',
    'Rules:',
    `- Add at least ${target} inline citations, spread across different sections, each as a markdown link on a short contextual anchor: [anchor text](https://full-url). Anchor text is 1 to 3 words taken from the sentence itself.`,
    '- Link only URLs from the list above. Never invent a URL.',
    '- NEVER add a references list, footnotes, bracketed numbers like [1], or superscripts.',
    '- Change nothing else: keep every heading, paragraph, table, list and internal link exactly as written. Only wrap existing words in links.',
    '- Return the full post in markdown, starting with the # title. No preamble, no commentary, no code fence.',
  ].join('\n');
}

function proseLength(markdown: string): number {
  return markdown.replace(MD_LINK_RE, (match) => match.slice(1, match.indexOf('](')) ).trim().length;
}

function headingCount(markdown: string): number {
  return linesOutsideFences(markdown).filter((line) => /^\s*#{1,6}\s/.test(line)).length;
}

export function validateCitationRepair(
  original: string,
  repaired: string,
  siteUrl: string | null | undefined,
): CitationRepairValidation {
  const counts = countMarkdownLinks(repaired, siteUrl);
  const externalLinks = counts.external;
  if (externalLinks === 0) {
    return { ok: false, reason: 'no external links after repair', externalLinks };
  }
  if (!/^\s*#\s/.test(repaired)) {
    return { ok: false, reason: 'title heading missing', externalLinks };
  }
  if (!REFERENCES_HEADING_RE.test(original) && REFERENCES_HEADING_RE.test(repaired)) {
    return { ok: false, reason: 'references list added', externalLinks };
  }
  if (headingCount(original) !== headingCount(repaired)) {
    return { ok: false, reason: 'heading structure changed', externalLinks };
  }
  const before = proseLength(original);
  const after = proseLength(repaired);
  if (before > 0) {
    const ratio = after / before;
    if (ratio < 0.9 || ratio > 1.15) {
      return { ok: false, reason: `prose length changed (${Math.round(ratio * 100)}% of original)`, externalLinks };
    }
  }
  return { ok: true, externalLinks };
}

export function missingCitationsWarning(approvedUrlCount: number): string {
  return `Draft contains no external citations even though ${approvedUrlCount} approved sources were available. Re-run the draft or add source links by hand.`;
}
