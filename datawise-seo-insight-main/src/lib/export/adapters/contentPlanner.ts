import type { ReportPayload, ReportSection } from '../types';
import {
  STATUS_LABELS,
  STATUS_ORDER,
  INTENT_LABELS,
  type PlannerKeyword,
  type PlannerCluster,
} from '@/lib/planner';
import { cappedTable } from './shared';

interface Args {
  keywords: PlannerKeyword[];
  clusters: PlannerCluster[];
  siteLabel?: string;
}

const TABLE_HEADERS = ['Keyword', 'Intent', 'Status', 'Volume', 'KD', 'CPC', 'Assigned URL'];

function keywordRows(items: PlannerKeyword[]): Array<Array<string | number>> {
  return items.map((k) => [
    k.is_pillar ? `${k.keyword} (pillar)` : k.keyword,
    INTENT_LABELS[k.intent] ?? k.intent,
    STATUS_LABELS[k.status] ?? k.status,
    k.search_volume != null ? k.search_volume.toLocaleString() : '--',
    k.keyword_difficulty ?? '--',
    k.cpc != null ? `$${Number(k.cpc).toFixed(2)}` : '--',
    k.assigned_url || '--',
  ]);
}

export function buildContentPlannerReport({ keywords, clusters, siteLabel }: Args): ReportPayload {
  const sections: ReportSection[] = [];

  sections.push({
    type: 'paragraph',
    text: `Content plan snapshot${siteLabel ? ` for ${siteLabel}` : ''}: ${keywords.length} keyword${keywords.length === 1 ? '' : 's'} across ${clusters.length} cluster${clusters.length === 1 ? '' : 's'}, tracked from backlog through ranking.`,
  });

  // --- Counts by status ---
  sections.push({
    type: 'kpi-grid',
    items: STATUS_ORDER.map((status) => ({
      label: STATUS_LABELS[status],
      value: String(keywords.filter((k) => k.status === status).length),
    })),
  });

  // --- One table per cluster ---
  for (const cluster of clusters) {
    const clusterKeywords = keywords.filter((k) => k.cluster_id === cluster.id);
    sections.push({
      type: 'heading',
      level: 2,
      text: `Cluster: ${cluster.name} (${clusterKeywords.length})`,
    });
    if (cluster.description) {
      sections.push({ type: 'paragraph', text: cluster.description });
    }
    if (clusterKeywords.length === 0) {
      sections.push({ type: 'paragraph', text: 'No keywords in this cluster yet.' });
    } else {
      sections.push(...cappedTable(TABLE_HEADERS, keywordRows(clusterKeywords)));
    }
  }

  // --- Unclustered keywords ---
  const clusterIds = new Set(clusters.map((c) => c.id));
  const unclustered = keywords.filter((k) => !k.cluster_id || !clusterIds.has(k.cluster_id));
  sections.push({ type: 'heading', level: 2, text: `Unclustered Keywords (${unclustered.length})` });
  if (unclustered.length === 0) {
    sections.push({ type: 'paragraph', text: 'Every keyword is assigned to a cluster.' });
  } else {
    sections.push(...cappedTable(TABLE_HEADERS, keywordRows(unclustered)));
  }

  return {
    title: `Content Planner Report${siteLabel ? `: ${siteLabel}` : ''}`,
    subtitle: `${keywords.length} keywords, ${clusters.length} clusters`,
    domain: siteLabel,
    generatedAt: new Date(),
    sections,
  };
}
