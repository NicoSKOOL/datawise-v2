import type { ReportPayload, ReportSection } from '../types';
import { cappedTable, excerpt } from './shared';

export interface BrandTrackerPlatformStat {
  label: string;
  mentions: number;
  impressions: number;
  ai_search_volume: number;
}

export interface BrandTrackerAnswerRow {
  question?: string;
  platform?: string;
  model_name?: string;
  answer?: string;
  ai_search_volume?: number;
  sources?: unknown[];
  last_response_at?: string;
}

interface Args {
  domain: string;
  platforms: BrandTrackerPlatformStat[];
  citingDomains: number;
  rows: BrandTrackerAnswerRow[];
  charts?: {
    trendPng?: string | null;
  };
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString();
}

function platformLabel(platform: string | undefined): string {
  if (platform === 'google') return 'Google AIO';
  if (platform === 'chat_gpt') return 'ChatGPT';
  return platform || 'Unknown';
}

export function buildBrandTrackerReport({
  domain,
  platforms,
  citingDomains,
  rows,
  charts,
}: Args): ReportPayload {
  const sections: ReportSection[] = [];

  const totalMentions = platforms.reduce((s, p) => s + p.mentions, 0);
  const totalImpressions = platforms.reduce((s, p) => s + p.impressions, 0);
  const totalVolume = platforms.reduce((s, p) => s + p.ai_search_volume, 0);

  sections.push({
    type: 'paragraph',
    text: `How AI search engines mention and cite ${domain}. Mentions count LLM answers that reference the domain; impressions estimate how often those answers are seen.`,
  });

  sections.push({
    type: 'kpi-grid',
    items: [
      { label: 'Total Mentions', value: fmtNum(totalMentions) },
      { label: 'AI Impressions', value: fmtNum(totalImpressions) },
      { label: 'AI Search Volume', value: fmtNum(totalVolume) },
      { label: 'Citing Domains', value: fmtNum(citingDomains) },
    ],
  });

  if (platforms.length > 1) {
    sections.push({ type: 'heading', level: 2, text: 'Mentions by Platform' });
    sections.push({
      type: 'table',
      headers: ['Platform', 'Mentions', 'AI Impressions', 'AI Search Volume'],
      rows: platforms.map((p) => [
        p.label,
        fmtNum(p.mentions),
        fmtNum(p.impressions),
        fmtNum(p.ai_search_volume),
      ]),
    });
  }

  if (charts?.trendPng) {
    sections.push({ type: 'heading', level: 2, text: 'Mentions Over Time' });
    sections.push({
      type: 'chart',
      pngDataUrl: charts.trendPng,
      caption: 'LLM answers mentioning the domain, bucketed by date',
    });
  }

  sections.push({ type: 'heading', level: 2, text: `AI Answers (${rows.length})` });
  if (rows.length === 0) {
    sections.push({
      type: 'paragraph',
      text: 'No LLM answers mentioning this domain were found for the selected platforms.',
    });
  } else {
    sections.push(
      ...cappedTable(
        ['Question', 'Platform', 'Model', 'AI Volume', 'Sources', 'Last Seen', 'Answer Excerpt'],
        rows.map((r) => [
          excerpt(r.question, 160) || '(no question)',
          platformLabel(r.platform),
          r.model_name || '--',
          r.ai_search_volume != null ? fmtNum(r.ai_search_volume) : '--',
          r.sources?.length ?? 0,
          r.last_response_at ? new Date(r.last_response_at).toLocaleDateString() : '--',
          excerpt(r.answer, 300),
        ])
      )
    );
  }

  return {
    title: `Brand Tracker Report: ${domain}`,
    subtitle: platforms.map((p) => p.label).join(' + ') || undefined,
    domain,
    generatedAt: new Date(),
    sections,
  };
}
