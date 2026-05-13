export interface SourceCandidate {
  url: string;
  title?: string;
  snippet?: string;
}

export function extractNeverCiteTerms(brandGuidelines: string | null | undefined): string[] {
  if (!brandGuidelines) return [];
  const terms = new Set<string>();

  for (const line of brandGuidelines.split('\n')) {
    const lower = line.toLowerCase();
    if (!lower.includes('never cite as a research source') && !lower.includes('never name')) continue;
    const afterColon = line.split(':').slice(1).join(':');
    if (!afterColon.trim()) continue;
    for (const raw of afterColon.split(',')) {
      const clean = raw
        .replace(/\([^)]*\)/g, '')
        .replace(/\bany blog from\b/gi, '')
        .replace(/\bthe above competitors\b/gi, '')
        .replace(/[.;:]+$/g, '')
        .trim();
      if (clean && clean.length >= 3) terms.add(clean);
      if (clean.includes('/')) {
        for (const part of clean.split('/')) {
          const splitClean = part.trim();
          if (splitClean.length >= 3) terms.add(splitClean);
        }
      }
    }
  }

  return [...terms];
}

export function filterExcludedSources<T extends SourceCandidate>(sources: T[] | undefined, excludedTerms: string[]): {
  sources: T[] | undefined;
  filteredCount: number;
} {
  if (!sources?.length || excludedTerms.length === 0) {
    return { sources, filteredCount: 0 };
  }
  const filtered = sources.filter((source) => !excludedTerms.some((term) => sourceMatchesExcludedTerm(source, term)));
  return { sources: filtered, filteredCount: sources.length - filtered.length };
}

function sourceMatchesExcludedTerm(source: SourceCandidate, term: string): boolean {
  const normalizedTerm = normalizeSourceMatchValue(term);
  if (normalizedTerm.length < 4) return false;
  const haystack = normalizeSourceMatchValue([
    source.title || '',
    source.snippet || '',
    source.url || '',
    safeHostname(source.url || ''),
  ].join(' '));
  return haystack.includes(normalizedTerm);
}

function normalizeSourceMatchValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
