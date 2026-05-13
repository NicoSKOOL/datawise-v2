import type { ReportPayload, ReportSection } from '../types';
import type { AuditResult } from '@/lib/content-tools';

export interface RevivalPost {
  url: string;
  title: string;
  audit: AuditResult | null;
  rewritten?: string;
  word_count?: number;
}

interface Args {
  posts: RevivalPost[];
  domain?: string;
}

export function buildContentRevivalReport({ posts, domain }: Args): ReportPayload {
  const sections: ReportSection[] = [];

  const totals = posts.reduce(
    (acc, p) => {
      acc.total += 1;
      if (p.audit?.verdict === 'thin') acc.thin += 1;
      if (p.audit?.verdict === 'average') acc.avg += 1;
      if (p.audit?.verdict === 'good') acc.good += 1;
      return acc;
    },
    { total: 0, thin: 0, avg: 0, good: 0 }
  );

  sections.push({
    type: 'kpi-grid',
    items: [
      { label: 'Posts Analyzed', value: String(totals.total) },
      { label: 'Thin', value: String(totals.thin), tone: 'down' },
      { label: 'Average', value: String(totals.avg), tone: 'neutral' },
      { label: 'Good', value: String(totals.good), tone: 'up' },
    ],
  });

  posts.forEach((post, idx) => {
    if (idx > 0) sections.push({ type: 'divider' });
    sections.push({ type: 'heading', level: 2, text: post.title || post.url });
    sections.push({ type: 'paragraph', text: post.url });

    if (post.audit) {
      sections.push({
        type: 'kpi-grid',
        items: [
          {
            label: 'Verdict',
            value: titleCase(post.audit.verdict),
            tone:
              post.audit.verdict === 'good'
                ? 'up'
                : post.audit.verdict === 'thin'
                  ? 'down'
                  : 'neutral',
          },
          {
            label: 'Word Count',
            value: (post.audit.overall_word_count ?? post.word_count ?? 0).toLocaleString(),
          },
          {
            label: 'Issues',
            value: String(
              (post.audit.thin_sections?.length ?? 0) +
                (post.audit.outdated_claims?.length ?? 0) +
                (post.audit.missing_internal_links?.length ?? 0) +
                (post.audit.missing_external_links?.length ?? 0)
            ),
          },
        ],
      });

      if (post.audit.thin_sections?.length) {
        sections.push({ type: 'heading', level: 3, text: 'Thin Sections' });
        sections.push({ type: 'list', style: 'bullet', items: post.audit.thin_sections });
      }
      if (post.audit.outdated_claims?.length) {
        sections.push({ type: 'heading', level: 3, text: 'Outdated Claims' });
        sections.push({ type: 'list', style: 'bullet', items: post.audit.outdated_claims });
      }
      if (post.audit.missing_internal_links?.length) {
        sections.push({ type: 'heading', level: 3, text: 'Missing Internal Links' });
        sections.push({ type: 'list', style: 'bullet', items: post.audit.missing_internal_links });
      }
      if (post.audit.missing_external_links?.length) {
        sections.push({ type: 'heading', level: 3, text: 'Missing External Links' });
        sections.push({ type: 'list', style: 'bullet', items: post.audit.missing_external_links });
      }
    }

    if (post.rewritten?.trim()) {
      sections.push({ type: 'heading', level: 3, text: 'Rewritten Draft' });
      sections.push({ type: 'markdown', content: post.rewritten });
    }
  });

  return {
    title: 'Content Revival Report',
    subtitle: domain ? `Domain: ${domain}` : `${posts.length} posts analyzed`,
    domain,
    generatedAt: new Date(),
    sections,
  };
}

function titleCase(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
