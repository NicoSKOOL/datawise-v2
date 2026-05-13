import { api } from './api';

export type PlannerIntent =
  | 'transactional'
  | 'informational'
  | 'commercial'
  | 'navigational'
  | 'fan_out';

export type PlannerStatus =
  | 'backlog'
  | 'assigned'
  | 'draft'
  | 'published'
  | 'indexed'
  | 'ranking';

export interface ContentBrief {
  title?: string;
  additional_keywords?: string[];
  outline?: string;
  meta_description?: string;
  target_audience?: string;
  cta?: string;
}

export interface PlannerKeyword {
  id: string;
  keyword: string;
  intent: PlannerIntent;
  status: PlannerStatus;
  assigned_url: string | null;
  notes: string | null;
  search_volume: number | null;
  keyword_difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  source: string | null;
  source_context: unknown;
  content_brief: ContentBrief | null;
  cluster_id: string | null;
  is_pillar: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PlannerCluster {
  id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
  keyword_count?: number;
}

export const CLUSTER_COLORS = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#8b5cf6', // violet
  '#84cc16', // lime
];

export interface PlannerItemInput {
  keyword: string;
  intent?: PlannerIntent;
  search_volume?: number | null;
  keyword_difficulty?: number | null;
  cpc?: number | null;
  competition?: number | null;
  source?: string | null;
  source_context?: unknown;
}

export const INTENT_LABELS: Record<PlannerIntent, string> = {
  transactional: 'Transactional',
  informational: 'Informational',
  commercial: 'Commercial',
  navigational: 'Navigational',
  fan_out: 'Fan-out',
};

export const STATUS_LABELS: Record<PlannerStatus, string> = {
  backlog: 'Backlog',
  assigned: 'Assigned to Page',
  draft: 'Draft',
  published: 'Published',
  indexed: 'Indexed',
  ranking: 'Ranking',
};

export const STATUS_ORDER: PlannerStatus[] = [
  'backlog', 'assigned', 'draft', 'published', 'indexed', 'ranking',
];

export const INTENT_ORDER: PlannerIntent[] = [
  'transactional', 'commercial', 'informational', 'navigational', 'fan_out',
];

export interface PageTypeInfo {
  label: string;
  description: string;
}

export const PAGE_TYPE_BY_INTENT: Record<PlannerIntent, PageTypeInfo> = {
  transactional: {
    label: 'Service page',
    description: 'Money page: service, product, or pricing URL built to convert.',
  },
  commercial: {
    label: 'Comparison post',
    description: 'Conversion-focused blog: listicle, "best of", or X vs Y.',
  },
  informational: {
    label: 'Blog post',
    description: 'Educational article or guide with TL;DR answer capsule.',
  },
  navigational: {
    label: 'Existing page',
    description: "Usually maps to a page you already have — don't write new content.",
  },
  fan_out: {
    label: 'FAQ section',
    description: 'Supporting query — answer inside a pillar post\'s FAQ block.',
  },
};

export async function listPlannerKeywords(propertyId: string): Promise<PlannerKeyword[]> {
  return api<PlannerKeyword[]>(
    `/api/planner/keywords?propertyId=${encodeURIComponent(propertyId)}`
  );
}

export async function addPlannerKeyword(propertyId: string, input: PlannerItemInput) {
  return api<{ id: string; keyword: string; duplicate: boolean }>(
    '/api/planner/keywords',
    { method: 'POST', body: { ...input, property_id: propertyId } }
  );
}

export async function bulkAddPlannerKeywords(
  propertyId: string,
  payload: {
    items: PlannerItemInput[];
    intent?: PlannerIntent;
    source?: string;
    source_context?: unknown;
  }
) {
  return api<{ added: number; skipped: number }>(
    '/api/planner/keywords/bulk',
    { method: 'POST', body: { ...payload, property_id: propertyId } }
  );
}

export async function updatePlannerKeyword(
  id: string,
  patch: Partial<Pick<PlannerKeyword, 'intent' | 'status' | 'assigned_url' | 'notes' | 'position' | 'content_brief' | 'cluster_id' | 'is_pillar'>>
) {
  return api<{ success: true }>(
    `/api/planner/keywords/${id}`,
    { method: 'PATCH', body: patch }
  );
}

export async function deletePlannerKeyword(id: string) {
  return api<{ success: true }>(
    `/api/planner/keywords/${id}`,
    { method: 'DELETE' }
  );
}

// Clusters

export async function listClusters(propertyId: string): Promise<PlannerCluster[]> {
  return api<PlannerCluster[]>(
    `/api/planner/clusters?propertyId=${encodeURIComponent(propertyId)}`
  );
}

export async function createCluster(
  propertyId: string,
  input: {
    name: string;
    description?: string;
    color?: string;
  }
): Promise<PlannerCluster> {
  return api<PlannerCluster>('/api/planner/clusters', {
    method: 'POST',
    body: { ...input, property_id: propertyId },
  });
}

export async function updateCluster(
  id: string,
  patch: Partial<Pick<PlannerCluster, 'name' | 'description' | 'color'>>
) {
  return api<{ success: true }>(`/api/planner/clusters/${id}`, { method: 'PATCH', body: patch });
}

export async function deleteCluster(id: string) {
  return api<{ success: true }>(`/api/planner/clusters/${id}`, { method: 'DELETE' });
}

export async function setClusterPillar(clusterId: string, keywordId: string) {
  return api<{ success: true }>(
    `/api/planner/clusters/${clusterId}/pillar`,
    { method: 'POST', body: { keyword_id: keywordId } }
  );
}
