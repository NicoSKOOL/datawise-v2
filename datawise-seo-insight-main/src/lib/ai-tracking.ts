// AI Visibility Tracking (per rank-tracking project) API wrapper.

import { api } from './api';

export type AIEngine = 'google_ai_mode' | 'chatgpt' | 'perplexity';

export const AI_ENGINE_LABELS: Record<AIEngine, string> = {
  google_ai_mode: 'Google AI Mode',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
};

export type AICheckStatus = 'cited' | 'mentioned' | 'absent' | 'no_answer' | 'error';

export interface AIEngineResult {
  status: AICheckStatus;
  citation_position: number | null;
  cited_url: string | null;
  answer_excerpt: string | null;
  checked_at: string;
}

export interface AITrackedQuery {
  id: string;
  query_text: string;
  source: 'keyword' | 'custom';
  keyword_id: string | null;
  created_at: string;
  engines: Partial<Record<AIEngine, AIEngineResult>>;
}

export interface AITrackingSettings {
  enabled: boolean;
  brand_terms: string[];
  engines: AIEngine[];
  max_queries: number;
}

export interface AITrackingData {
  settings: AITrackingSettings;
  queries: AITrackedQuery[];
}

export interface AITrendPoint {
  date: string;
  engine: AIEngine;
  total: number;
  cited: number;
  mentioned: number;
}

export interface AIShareOfVoiceRow {
  domain: string;
  citations: number;
  queries_cited: number;
  is_you: boolean;
}

export interface AIReport {
  trend: AITrendPoint[];
  share_of_voice: AIShareOfVoiceRow[];
  period: number;
}

export async function fetchAITracking(projectId: string) {
  return api(`/api/rank-tracking/projects/${projectId}/ai`) as Promise<AITrackingData>;
}

export async function updateAISettings(projectId: string, params: {
  enabled?: boolean;
  brand_terms?: string[];
  engines?: AIEngine[];
}) {
  return api(`/api/rank-tracking/projects/${projectId}/ai`, { method: 'PATCH', body: params }) as Promise<AITrackingData>;
}

export async function addAIQueries(projectId: string, queries: Array<{ text: string; keyword_id?: string }>) {
  return api(`/api/rank-tracking/projects/${projectId}/ai/queries`, { method: 'POST', body: { queries } }) as Promise<{ added: number; skipped: number; remaining: number }>;
}

export async function deleteAIQuery(queryId: string) {
  return api(`/api/rank-tracking/ai-queries/${queryId}`, { method: 'DELETE' });
}

export async function runAICheck(projectId: string) {
  return api(`/api/rank-tracking/projects/${projectId}/ai/check`, { method: 'POST' }) as Promise<{ checks: number; cited: number; mentioned: number; errors: number; skipped_fresh: number }>;
}

export async function fetchAIReport(projectId: string, period = 90) {
  return api(`/api/rank-tracking/projects/${projectId}/ai/report?period=${period}`) as Promise<AIReport>;
}
