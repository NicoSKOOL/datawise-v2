import { api } from './api';

export interface MetaCheckRow {
  url: string;
  status_code: number | null;
  title: string | null;
  title_length: number | null;
  description: string | null;
  description_length: number | null;
  error: string | null;
}

export interface MetaCheckResponse {
  rows: MetaCheckRow[];
  count: number;
  truncated_at: number;
}

export function checkMeta(urls: string[]): Promise<MetaCheckResponse> {
  return api<MetaCheckResponse>('/api/site-audit/meta-check', {
    method: 'POST',
    body: { urls },
  });
}

export interface SitemapDiscoverResponse {
  pages: { url: string; slug?: string; title?: string }[];
}

// Smart sitemap loader: if the user pastes a full sitemap URL (ending in .xml),
// fetch that directly (handles sitemap indexes). Otherwise fall back to the
// content-tools discovery endpoint which checks robots.txt + common paths.
export async function discoverSitemap(input: string): Promise<SitemapDiscoverResponse> {
  const trimmed = input.trim();
  if (!trimmed) return { pages: [] };

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL | null = null;
  try {
    parsed = new URL(withProto);
  } catch {
    // fall through to discovery; backend will reject if invalid
  }

  const looksLikeSitemapUrl =
    parsed != null && /\.xml(\?|#|$)/i.test(parsed.pathname);

  if (looksLikeSitemapUrl) {
    return api<SitemapDiscoverResponse>('/api/site-audit/fetch-sitemap', {
      method: 'POST',
      body: { url: withProto },
    });
  }

  // Pass bare domain (origin only) to the discovery endpoint so it can probe
  // /robots.txt and common sitemap paths without trying to treat a full URL
  // as a base.
  const domain = parsed ? parsed.origin : withProto;
  return api<SitemapDiscoverResponse>('/api/content-tools/discover-sitemap', {
    method: 'POST',
    body: { domain },
  });
}

// ---- Issue classification (pure, runs in browser) ----

export const TITLE_MAX = 60;
export const TITLE_MIN = 30;
export const META_MAX = 160;
export const META_MIN = 70;

export type TitleStatus =
  | 'ok'
  | 'missing'
  | 'too_long'
  | 'too_short'
  | 'duplicate';

export type DescStatus = 'ok' | 'missing' | 'too_long' | 'too_short';

export interface ClassifiedRow extends MetaCheckRow {
  title_status: TitleStatus;
  description_status: DescStatus;
  has_issue: boolean;
}

export function classifyRows(rows: MetaCheckRow[]): ClassifiedRow[] {
  // Count duplicates case-insensitively on trimmed titles.
  const titleCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.title && r.title.trim()) {
      const key = r.title.trim().toLowerCase();
      titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
    }
  }

  return rows.map((r) => {
    const titleLen = r.title_length ?? 0;
    let titleStatus: TitleStatus;
    if (r.error && !r.title) titleStatus = 'missing';
    else if (!r.title || titleLen === 0) titleStatus = 'missing';
    else if (titleLen > TITLE_MAX) titleStatus = 'too_long';
    else if (titleLen < TITLE_MIN) titleStatus = 'too_short';
    else {
      const key = r.title.trim().toLowerCase();
      titleStatus = (titleCounts.get(key) || 0) > 1 ? 'duplicate' : 'ok';
    }

    const descLen = r.description_length ?? 0;
    let descStatus: DescStatus;
    if (!r.description || descLen === 0) descStatus = 'missing';
    else if (descLen > META_MAX) descStatus = 'too_long';
    else if (descLen < META_MIN) descStatus = 'too_short';
    else descStatus = 'ok';

    return {
      ...r,
      title_status: titleStatus,
      description_status: descStatus,
      has_issue: titleStatus !== 'ok' || descStatus !== 'ok',
    };
  });
}

export interface IssueGroup {
  key: string;
  title: string;
  how_to_fix: string;
  category: 'meta';
  priority: 'high' | 'medium' | 'low';
  rows: ClassifiedRow[];
}

// Group problem rows into action-board-ready buckets. Each bucket becomes one
// task with URL subtasks.
export function buildIssueGroups(rows: ClassifiedRow[]): IssueGroup[] {
  const groups: IssueGroup[] = [];

  const push = (
    key: string,
    title: string,
    how_to_fix: string,
    priority: 'high' | 'medium' | 'low',
    filter: (r: ClassifiedRow) => boolean
  ) => {
    const matched = rows.filter(filter);
    if (matched.length === 0) return;
    groups.push({
      key,
      title: title.replace('{N}', String(matched.length)),
      how_to_fix,
      category: 'meta',
      priority,
      rows: matched,
    });
  };

  push(
    'missing_title',
    'Add missing title tags ({N} pages)',
    'Every page needs a unique <title> with the primary keyword near the front. Aim for 50–60 characters.',
    'high',
    (r) => r.title_status === 'missing'
  );
  push(
    'long_title',
    'Shorten {N} long title tags',
    'Titles over 60 characters get truncated in Google results. Rewrite each to fit 50–60 chars, keeping the primary keyword near the front.',
    'medium',
    (r) => r.title_status === 'too_long'
  );
  push(
    'short_title',
    'Lengthen {N} too-short title tags',
    'Titles under 30 characters usually leave keyword opportunities on the table. Expand with a qualifier (location, benefit, brand) while staying under 60.',
    'low',
    (r) => r.title_status === 'too_short'
  );
  push(
    'duplicate_title',
    'Deduplicate {N} duplicate title tags',
    'Google treats pages with identical titles as potential duplicates. Rewrite each to reflect the unique topic of that page.',
    'medium',
    (r) => r.title_status === 'duplicate'
  );
  push(
    'missing_desc',
    'Add missing meta descriptions ({N} pages)',
    'Without a meta description Google auto-generates the snippet — usually poorly. Write 140–160 characters per page: what the page offers, where, and a soft CTA.',
    'high',
    (r) => r.description_status === 'missing'
  );
  push(
    'long_desc',
    'Shorten {N} long meta descriptions',
    'Descriptions over 160 characters get truncated with "…". Rewrite each to fit 140–160 chars, leading with the benefit and ending with a soft CTA.',
    'medium',
    (r) => r.description_status === 'too_long'
  );
  push(
    'short_desc',
    'Lengthen {N} too-short meta descriptions',
    'Descriptions under 70 characters leave space unused. Expand to 140–160 chars with the benefit, a differentiator, and a soft CTA.',
    'low',
    (r) => r.description_status === 'too_short'
  );

  return groups;
}
