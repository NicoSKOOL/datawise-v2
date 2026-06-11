import type { ReportPayload, ReportSection } from '../types';
import { cappedTable, excerpt } from './shared';

export interface AIVisibilitySource {
  title?: string;
  url?: string;
  domain?: string;
  snippet?: string;
  isBrand?: boolean;
}

export interface AIVisibilityEngineInput {
  /** Display name of the engine, for example "Google AI Mode". */
  engine: string;
  keyword: string;
  brandDomain?: string;
  /** null when no brand domain was provided, so brand metrics were not computed. */
  brandCited: boolean | null;
  citationCount: number | null;
  citationPosition: number | null;
  topCompetitors: string[];
  answerText: string;
  sources: AIVisibilitySource[];
}

export function buildAIVisibilityReport(input: AIVisibilityEngineInput): ReportPayload {
  const sections: ReportSection[] = [];

  sections.push({
    type: 'paragraph',
    text: `${input.engine} response analysis for the query "${input.keyword}"${input.brandDomain ? `, tracking citations of ${input.brandDomain}` : ''}.`,
  });

  sections.push({
    type: 'kpi-grid',
    items: [
      {
        label: 'Brand Mentioned',
        value: input.brandCited == null ? '--' : input.brandCited ? 'Yes' : 'No',
        tone: input.brandCited == null ? 'neutral' : input.brandCited ? 'up' : 'down',
      },
      {
        label: 'Brand Citations',
        value: input.citationCount == null ? '--' : String(input.citationCount),
      },
      {
        label: 'Citation Position',
        value: input.citationPosition ? `#${input.citationPosition}` : '--',
      },
      { label: 'Sources Cited', value: String(input.sources.length) },
    ],
  });

  if (input.topCompetitors.length > 0) {
    sections.push({
      type: 'callout',
      tone: 'info',
      text: `Competing domains cited in this answer: ${input.topCompetitors.join(', ')}.`,
    });
  }

  if (input.sources.length > 0) {
    sections.push({ type: 'heading', level: 2, text: `Sources Cited (${input.sources.length})` });
    sections.push(
      ...cappedTable(
        ['#', 'Title', 'Domain', 'URL', 'Your Brand'],
        input.sources.map((s, i) => [
          i + 1,
          excerpt(s.title, 120) || s.domain || '(untitled)',
          s.domain || '--',
          s.url || '--',
          s.isBrand ? 'Yes' : '',
        ])
      )
    );
  }

  if (input.answerText) {
    sections.push({ type: 'heading', level: 2, text: `${input.engine} Answer` });
    sections.push({ type: 'markdown', content: input.answerText });
  }

  return {
    title: `AI Visibility Report: ${input.engine}`,
    subtitle: `Query: "${input.keyword}"`,
    domain: input.brandDomain || undefined,
    generatedAt: new Date(),
    sections,
  };
}
