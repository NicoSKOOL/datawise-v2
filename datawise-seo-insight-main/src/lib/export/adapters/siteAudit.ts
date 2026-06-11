import type { ReportPayload, ReportSection } from '../types';
import type { SiteAudit, AuditFinding, Category } from '@/lib/site-audit';
import { cappedTable, excerpt } from './shared';

interface Args {
  audit: SiteAudit;
  findings: AuditFinding[];
}

const CATEGORY_LABELS: Record<Category, string> = {
  performance: 'Performance',
  seo: 'SEO',
  accessibility: 'Accessibility',
  best_practices: 'Best Practices',
  meta: 'Meta Tags',
  images: 'Images',
  content: 'Content',
  technical: 'Technical',
};

const CATEGORY_ORDER: Category[] = [
  'performance',
  'seo',
  'accessibility',
  'best_practices',
  'meta',
  'images',
  'technical',
  'content',
];

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function scoreValue(score: number | null): string {
  return score == null ? '--' : String(score);
}

function scoreTone(score: number | null): 'up' | 'down' | 'neutral' {
  if (score == null) return 'neutral';
  if (score >= 70) return 'up';
  if (score < 50) return 'down';
  return 'neutral';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function buildSiteAuditReport({ audit, findings }: Args): ReportPayload {
  const sections: ReportSection[] = [];

  // --- Score KPIs ---
  sections.push({
    type: 'kpi-grid',
    items: [
      { label: 'Overall Score', value: scoreValue(audit.score), tone: scoreTone(audit.score) },
      { label: 'Performance', value: scoreValue(audit.perf_score), tone: scoreTone(audit.perf_score) },
      { label: 'SEO', value: scoreValue(audit.seo_score), tone: scoreTone(audit.seo_score) },
      { label: 'Accessibility', value: scoreValue(audit.a11y_score), tone: scoreTone(audit.a11y_score) },
      { label: 'Best Practices', value: scoreValue(audit.best_practices_score), tone: scoreTone(audit.best_practices_score) },
    ],
  });

  // --- AI analysis summary ---
  const ai = audit.ai_analysis;
  if (ai) {
    sections.push({ type: 'heading', level: 2, text: 'AI Analysis' });
    if (ai.executive_summary) {
      sections.push({ type: 'markdown', content: ai.executive_summary });
    }
    if (ai.primary_keyword) {
      sections.push({
        type: 'callout',
        tone: 'info',
        text: `Primary keyword: "${ai.primary_keyword}"${ai.likely_keywords?.length ? `. Related targets: ${ai.likely_keywords.join(', ')}.` : '.'}`,
      });
    }
    if (ai.priority_actions?.length) {
      sections.push({ type: 'heading', level: 3, text: 'Priority Actions' });
      sections.push({
        type: 'list',
        style: 'numbered',
        items: ai.priority_actions.map((a) => `${a.title}: ${a.why}`),
      });
    }
    if (ai.quick_wins?.length) {
      sections.push({ type: 'heading', level: 3, text: 'Quick Wins' });
      sections.push({
        type: 'list',
        style: 'bullet',
        items: ai.quick_wins.map((a) => `${a.title}: ${a.why}`),
      });
    }
  }

  // --- Structured SEO details ---
  const seo = audit.seo_analysis;
  if (seo) {
    sections.push({ type: 'heading', level: 2, text: 'On-Page SEO Details' });

    if (seo.title) {
      sections.push({ type: 'heading', level: 3, text: 'Title Tag' });
      const titleLines: string[] = [
        `Current: ${seo.title.text ? `"${excerpt(seo.title.text, 200)}"` : '(missing)'} (${seo.title.length} chars, ${seo.title.status.replace(/_/g, ' ')})`,
      ];
      for (const issue of seo.title.issues || []) titleLines.push(`Issue: ${issue}`);
      if (seo.title.suggestion) titleLines.push(`Suggestion: ${seo.title.suggestion}`);
      sections.push({ type: 'list', style: 'bullet', items: titleLines });
    }

    if (seo.meta_description) {
      const md = seo.meta_description;
      sections.push({ type: 'heading', level: 3, text: 'Meta Description' });
      const mdLines: string[] = [
        `Current: ${md.text ? `"${excerpt(md.text, 250)}"` : '(missing)'} (${md.length} chars, ${md.status.replace(/_/g, ' ')})`,
        `Has call to action: ${md.has_cta ? 'yes' : 'no'}`,
      ];
      for (const issue of md.issues || []) mdLines.push(`Issue: ${issue}`);
      if (md.suggestion) mdLines.push(`Suggestion: ${md.suggestion}`);
      sections.push({ type: 'list', style: 'bullet', items: mdLines });
    }

    if (seo.headings) {
      const h = seo.headings;
      sections.push({ type: 'heading', level: 3, text: 'Headings' });
      const headingLines: string[] = [
        `H1: ${h.h1.length ? h.h1.map((t) => `"${excerpt(t, 120)}"`).join(', ') : '(none)'}`,
        `Structure: ${h.total_count} headings total, hierarchy ${h.hierarchy_ok ? 'looks correct' : 'has problems'}`,
        `Primary keyword in H1: ${h.primary_keyword_in_h1 ? 'yes' : 'no'}`,
      ];
      for (const issue of h.issues || []) headingLines.push(`Issue: ${issue}`);
      sections.push({ type: 'list', style: 'bullet', items: headingLines });
    }

    if (seo.schema) {
      const sch = seo.schema;
      sections.push({ type: 'heading', level: 3, text: 'Schema Markup' });
      sections.push({
        type: 'list',
        style: 'bullet',
        items: [
          `Structured data present: ${sch.present ? 'yes' : 'no'}`,
          `Types found: ${sch.types.length ? sch.types.join(', ') : '(none)'}`,
          `Recommended additions: ${sch.recommended_missing.length ? sch.recommended_missing.join(', ') : 'none'}`,
        ],
      });
    }
  }

  // --- Findings grouped by category ---
  const visibleFindings = findings.filter((f) => f.evidence?.impact !== 'advanced');
  if (visibleFindings.length > 0) {
    sections.push({ type: 'heading', level: 2, text: `Findings (${visibleFindings.length})` });
    for (const cat of CATEGORY_ORDER) {
      const group = visibleFindings
        .filter((f) => f.category === cat)
        .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
      if (group.length === 0) continue;
      sections.push({ type: 'heading', level: 3, text: `${CATEGORY_LABELS[cat]} (${group.length})` });
      sections.push(
        ...cappedTable(
          ['Severity', 'Issue', 'How to Fix'],
          group.map((f) => [
            f.severity,
            f.title + (f.evidence?.display_value ? ` (${f.evidence.display_value})` : ''),
            excerpt(f.evidence?.how_to_fix || f.description, 240),
          ])
        )
      );
    }
  }

  // --- Images ---
  const images = seo?.images;
  if (images) {
    sections.push({ type: 'heading', level: 2, text: 'Images' });
    sections.push({
      type: 'paragraph',
      text:
        `We found ${images.total} image${images.total === 1 ? '' : 's'} on the audited page. ` +
        `${images.missing_alt} ${images.missing_alt === 1 ? 'is' : 'are'} missing ALT text and ${images.png_count} ${images.png_count === 1 ? 'is a PNG' : 'are PNGs'} that could be converted to WebP` +
        (images.webp_savings_bytes > 0 ? ` (estimated savings: ${formatBytes(images.webp_savings_bytes)})` : '') +
        '.',
    });
    if (images.format_breakdown?.length) {
      sections.push(
        ...cappedTable(
          ['Format', 'Count'],
          images.format_breakdown.map((f) => [f.format, f.count]),
          'Image formats in use'
        )
      );
    }
    if (images.missing_alt_samples?.length) {
      sections.push({ type: 'heading', level: 3, text: 'Missing ALT Text (samples)' });
      sections.push(
        ...cappedTable(
          ['Image URL'],
          images.missing_alt_samples.map((s) => [s.src]),
          'Stored sample of images missing ALT text. The full list may be longer.'
        )
      );
    }
    if (images.png_samples?.length) {
      sections.push({ type: 'heading', level: 3, text: 'PNG Conversion Candidates (samples)' });
      sections.push(
        ...cappedTable(
          ['Image URL', 'ALT Text'],
          images.png_samples.map((s) => [s.src, s.alt || '(none)']),
          'Stored sample of PNG images that could be served as WebP.'
        )
      );
    }
  }

  return {
    title: `Site Audit Report: ${audit.domain}`,
    subtitle: audit.start_url,
    domain: audit.domain,
    generatedAt: new Date(),
    sections,
  };
}
