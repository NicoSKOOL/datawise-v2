import type { AnswerSource } from './types';

export function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).trim().replace(/^sc-domain:/i, '');
  if (!cleaned) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
  try {
    const host = new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export function domainsMatch(candidate: string, target: string): boolean {
  return candidate === target || candidate.endsWith(`.${target}`) || target.endsWith(`.${candidate}`);
}

interface SourceLike { url?: unknown; domain?: unknown; title?: unknown }

export function toSource(input: SourceLike | null | undefined, position: number): AnswerSource | null {
  if (!input || typeof input !== 'object') return null;
  const url = typeof input.url === 'string' && input.url ? input.url : null;
  const domain = normalizeDomain(url) ?? normalizeDomain(typeof input.domain === 'string' ? input.domain : null);
  if (!domain) return null;
  const title = typeof input.title === 'string' && input.title.trim() ? input.title.trim() : null;
  return { url, domain, title, position };
}

export function dedupeSources(list: AnswerSource[]): AnswerSource[] {
  const seen = new Set<string>();
  const out: AnswerSource[] = [];
  for (const source of list) {
    const key = source.url || source.domain;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...source, position: out.length + 1 });
  }
  return out;
}

// Plain text for brand-term matching. Keeps words, drops markdown syntax.
export function stripMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~>|]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
