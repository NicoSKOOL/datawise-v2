import type { ReportPayload, ReportSection } from '../types';
import type { ServicePageAnalysis } from '@/lib/content-tools';

interface Args {
  analysis: ServicePageAnalysis;
  pageUrl: string;
  pageTitle?: string;
  generatedSections?: Record<string, string>;
}

export function buildServicePageOptimizerReport({
  analysis,
  pageUrl,
  pageTitle,
  generatedSections = {},
}: Args): ReportPayload {
  const sections: ReportSection[] = [];

  sections.push({
    type: 'kpi-grid',
    items: [
      {
        label: 'Content Score',
        value: `${analysis.content_score_pct}%`,
        delta: analysis.content_score,
        tone:
          analysis.content_score === 'comprehensive'
            ? 'up'
            : analysis.content_score === 'thin'
              ? 'down'
              : 'neutral',
      },
      {
        label: 'Word Count',
        value: analysis.content_word_count.toLocaleString(),
      },
      {
        label: 'Swap Test',
        value: `${analysis.swap_test?.score ?? 0}/10`,
        tone:
          (analysis.swap_test?.score ?? 0) >= 7
            ? 'up'
            : (analysis.swap_test?.score ?? 0) <= 4
              ? 'down'
              : 'neutral',
      },
      {
        label: 'CTA Strength',
        value: titleCase(analysis.cta_audit?.score ?? 'none'),
        tone:
          analysis.cta_audit?.score === 'strong'
            ? 'up'
            : analysis.cta_audit?.score === 'none'
              ? 'down'
              : 'neutral',
      },
      {
        label: 'Trust Signals',
        value: titleCase(analysis.trust_signals?.score ?? 'none'),
        tone:
          analysis.trust_signals?.score === 'strong'
            ? 'up'
            : analysis.trust_signals?.score === 'none'
              ? 'down'
              : 'neutral',
      },
      {
        label: 'H1 Valid',
        value: analysis.heading_structure?.has_h1 ? 'Yes' : 'No',
        tone: analysis.heading_structure?.has_h1 ? 'up' : 'down',
      },
    ],
  });

  sections.push({
    type: 'paragraph',
    text: `Service type: ${analysis.service_type || '—'}  ·  Industry: ${analysis.industry_category || '—'}  ·  Location: ${analysis.location || '—'}`,
  });

  if (analysis.content_gaps?.length) {
    sections.push({ type: 'heading', level: 2, text: 'Content Gaps' });
    sections.push({
      type: 'table',
      headers: ['Issue', 'Severity'],
      rows: analysis.content_gaps.map((g) => [g.issue, titleCase(g.severity)]),
    });
  }

  if (analysis.swap_test?.generic_sections?.length) {
    sections.push({ type: 'heading', level: 2, text: 'Swap Test Findings' });
    sections.push({
      type: 'callout',
      tone: (analysis.swap_test.score ?? 0) >= 7 ? 'success' : 'warn',
      text: `Swap test score: ${analysis.swap_test.score}/10 — lower scores mean the copy could belong to any competitor and needs specificity.`,
    });
    sections.push({
      type: 'table',
      headers: ['Location', 'Why Generic', 'Fix'],
      rows: analysis.swap_test.generic_sections.map((s) => [
        s.heading_or_location,
        s.why_generic,
        s.fix,
      ]),
    });
  }

  if (analysis.missing_page_sections?.length) {
    sections.push({ type: 'heading', level: 2, text: 'Missing Page Sections' });
    sections.push({
      type: 'table',
      headers: ['Section', 'Why Needed', 'Priority'],
      rows: analysis.missing_page_sections.map((s) => [
        s.label,
        s.why_needed,
        titleCase(s.priority),
      ]),
    });
  }

  if (analysis.industry_specific_sections?.length) {
    sections.push({ type: 'heading', level: 2, text: 'Industry-Specific Sections' });
    sections.push({
      type: 'table',
      headers: ['Section', 'Why Relevant', 'Priority'],
      rows: analysis.industry_specific_sections.map((s) => [
        s.label,
        s.why_relevant,
        titleCase(s.priority),
      ]),
    });
  }

  if (analysis.heading_structure) {
    sections.push({ type: 'heading', level: 2, text: 'Heading Structure' });
    const hs = analysis.heading_structure;
    sections.push({
      type: 'paragraph',
      text: `H1: "${hs.h1_text || '—'}" · Keyword in H1: ${yesNo(hs.h1_includes_keyword)} · Location in H1: ${yesNo(hs.h1_includes_location)} · Hierarchy valid: ${yesNo(hs.hierarchy_valid)}`,
    });
    if (hs.issues?.length) {
      sections.push({ type: 'list', style: 'bullet', items: hs.issues });
    }
    if (hs.suggested_headings?.length) {
      sections.push({
        type: 'table',
        headers: ['Current', 'Suggested', 'Reason'],
        rows: hs.suggested_headings.map((h) => [h.current || '—', h.suggested, h.reason]),
      });
    }
  }

  if (analysis.cta_audit) {
    sections.push({ type: 'heading', level: 2, text: 'CTA Audit' });
    if (analysis.cta_audit.ctas_found?.length) {
      sections.push({
        type: 'paragraph',
        text: 'CTAs found on page:',
      });
      sections.push({ type: 'list', style: 'bullet', items: analysis.cta_audit.ctas_found });
    }
    if (analysis.cta_audit.suggestions?.length) {
      sections.push({ type: 'heading', level: 3, text: 'Suggestions' });
      sections.push({ type: 'list', style: 'bullet', items: analysis.cta_audit.suggestions });
    }
  }

  if (analysis.trust_signals) {
    sections.push({ type: 'heading', level: 2, text: 'Trust Signals' });
    if (analysis.trust_signals.found?.length) {
      sections.push({ type: 'heading', level: 3, text: 'Found' });
      sections.push({ type: 'list', style: 'bullet', items: analysis.trust_signals.found });
    }
    if (analysis.trust_signals.missing?.length) {
      sections.push({ type: 'heading', level: 3, text: 'Missing' });
      sections.push({ type: 'list', style: 'bullet', items: analysis.trust_signals.missing });
    }
  }

  if (analysis.image_audit) {
    sections.push({ type: 'heading', level: 2, text: 'Image Audit' });
    sections.push({
      type: 'paragraph',
      text: `Has images: ${yesNo(analysis.image_audit.has_images)} · Total: ${analysis.image_audit.total_count} · Missing alt: ${analysis.image_audit.missing_alt_count} · Needs service-area map: ${yesNo(analysis.image_audit.needs_service_area_map)}`,
    });
    if (analysis.image_audit.suggestions?.length) {
      sections.push({ type: 'list', style: 'bullet', items: analysis.image_audit.suggestions });
    }
  }

  sections.push({ type: 'heading', level: 2, text: 'Meta' });
  sections.push({
    type: 'table',
    headers: ['', 'Current', 'Suggested'],
    rows: [
      ['Title', analysis.meta_title_current || '—', analysis.meta_title_suggested || '—'],
      ['Description', analysis.meta_description_current || '—', analysis.meta_description_suggested || '—'],
    ],
  });

  if (analysis.faq?.length) {
    sections.push({ type: 'heading', level: 2, text: 'Suggested FAQ' });
    analysis.faq.forEach((f) => {
      sections.push({ type: 'heading', level: 3, text: f.question });
      sections.push({ type: 'paragraph', text: f.answer });
    });
  }

  if (analysis.schema_existing?.length || analysis.schema_missing?.length) {
    sections.push({ type: 'heading', level: 2, text: 'Schema Markup' });
    if (analysis.schema_existing?.length) {
      sections.push({ type: 'heading', level: 3, text: 'Existing' });
      sections.push({ type: 'list', style: 'bullet', items: analysis.schema_existing });
    }
    if (analysis.schema_missing?.length) {
      sections.push({ type: 'heading', level: 3, text: 'Missing' });
      sections.push({ type: 'list', style: 'bullet', items: analysis.schema_missing });
    }
  }

  if (analysis.additional_recommendations?.length) {
    sections.push({ type: 'heading', level: 2, text: 'Additional Recommendations' });
    sections.push({ type: 'list', style: 'bullet', items: analysis.additional_recommendations });
  }

  const generated = Object.entries(generatedSections).filter(([, v]) => v?.trim());
  if (generated.length) {
    sections.push({ type: 'divider' });
    sections.push({ type: 'heading', level: 1, text: 'Generated Sections' });
    generated.forEach(([key, content]) => {
      sections.push({ type: 'heading', level: 2, text: titleCase(key.replace(/[-_]/g, ' ')) });
      sections.push({ type: 'markdown', content });
    });
  }

  return {
    title: pageTitle ? `Service Page Audit: ${pageTitle}` : 'Service Page Audit',
    subtitle: pageUrl,
    domain: safeHost(pageUrl),
    generatedAt: new Date(),
    sections,
  };
}

function titleCase(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function yesNo(b: boolean | undefined): string {
  return b ? 'Yes' : 'No';
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
