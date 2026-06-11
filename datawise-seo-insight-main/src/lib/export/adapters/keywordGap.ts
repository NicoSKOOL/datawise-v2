import type { ReportPayload, ReportSection } from '../types';
import { cappedTable } from './shared';

export interface KeywordGapRow {
  keyword: string;
  search_volume: number;
  cpc: number;
  competition: number;
  my_position?: number | null;
  competitor_position?: number | null;
  opportunity_score: number;
  priority_level: string;
  intent: string;
}

interface Args {
  myDomain: string;
  competitorDomain: string;
  gaps: KeywordGapRow[];
  bothRanking: KeywordGapRow[];
  advantages: KeywordGapRow[];
}

function gapRows(
  rows: KeywordGapRow[],
  positions: 'competitor' | 'both' | 'mine'
): Array<Array<string | number>> {
  return rows.map((k) => {
    const base: Array<string | number> = [
      k.keyword,
      k.search_volume.toLocaleString(),
      `$${k.cpc.toFixed(2)}`,
      `${Math.round(k.competition * 100)}%`,
      Math.round(k.opportunity_score),
      k.priority_level.replace(/-/g, ' '),
      k.intent,
    ];
    if (positions === 'competitor') base.push(k.competitor_position ?? '--');
    else if (positions === 'mine') base.push(k.my_position ?? '--');
    else base.push(k.my_position ?? '--', k.competitor_position ?? '--');
    return base;
  });
}

const BASE_HEADERS = [
  'Keyword',
  'Search Volume',
  'CPC',
  'Competition',
  'Opportunity Score',
  'Priority',
  'Intent',
];

export function buildKeywordGapReport({
  myDomain,
  competitorDomain,
  gaps,
  bothRanking,
  advantages,
}: Args): ReportPayload {
  const sections: ReportSection[] = [];

  sections.push({
    type: 'paragraph',
    text: `Keyword gap analysis comparing ${myDomain} against ${competitorDomain}. Gaps are keywords only the competitor ranks for, shared keywords are competitive overlap, and advantages are keywords only ${myDomain} ranks for.`,
  });

  sections.push({
    type: 'kpi-grid',
    items: [
      { label: 'Keyword Gaps', value: String(gaps.length), tone: 'down' },
      { label: 'Shared Keywords', value: String(bothRanking.length), tone: 'neutral' },
      { label: 'Your Advantages', value: String(advantages.length), tone: 'up' },
    ],
  });

  sections.push({ type: 'heading', level: 2, text: `Keyword Gaps (${gaps.length})` });
  sections.push({
    type: 'paragraph',
    text: `Keywords ${competitorDomain} ranks for and ${myDomain} does not.`,
  });
  if (gaps.length === 0) {
    sections.push({ type: 'paragraph', text: 'No gap keywords found.' });
  } else {
    sections.push(...cappedTable([...BASE_HEADERS, 'Competitor Position'], gapRows(gaps, 'competitor')));
  }

  sections.push({ type: 'heading', level: 2, text: `Shared Keywords (${bothRanking.length})` });
  sections.push({
    type: 'paragraph',
    text: `Keywords both ${myDomain} and ${competitorDomain} rank for.`,
  });
  if (bothRanking.length === 0) {
    sections.push({ type: 'paragraph', text: 'No shared keywords found.' });
  } else {
    sections.push(
      ...cappedTable(
        [...BASE_HEADERS, 'Your Position', 'Competitor Position'],
        gapRows(bothRanking, 'both')
      )
    );
  }

  sections.push({ type: 'heading', level: 2, text: `Your Advantages (${advantages.length})` });
  sections.push({
    type: 'paragraph',
    text: `Keywords ${myDomain} ranks for and ${competitorDomain} does not.`,
  });
  if (advantages.length === 0) {
    sections.push({ type: 'paragraph', text: 'No advantage keywords found.' });
  } else {
    sections.push(...cappedTable([...BASE_HEADERS, 'Your Position'], gapRows(advantages, 'mine')));
  }

  return {
    title: `Keyword Gap Analysis: ${myDomain} vs ${competitorDomain}`,
    domain: myDomain,
    generatedAt: new Date(),
    sections,
  };
}
