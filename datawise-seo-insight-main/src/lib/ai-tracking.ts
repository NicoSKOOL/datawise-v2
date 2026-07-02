// AI Visibility Tracking (per rank-tracking project) API wrapper.

import { api } from './api';

export type AIEngine = 'google_ai_mode' | 'chatgpt' | 'perplexity';

export const AI_ENGINE_LABELS: Record<AIEngine, string> = {
  google_ai_mode: 'Google AI Mode',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
};

export type AICheckStatus = 'cited' | 'mentioned' | 'absent' | 'no_answer' | 'error';

export interface AICitation {
  domain: string;
  url: string | null;
  position: number;
}

export interface AIRecommendation {
  title: string;
  body: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AIEngineResult {
  status: AICheckStatus;
  citation_position: number | null;
  cited_url: string | null;
  answer_excerpt: string | null;
  checked_at: string;
  check_id?: number;
  citations?: AICitation[];
}

export interface AITrackedQuery {
  id: string;
  query_text: string;
  source: 'keyword' | 'custom' | 'discovery';
  keyword_id: string | null;
  created_at: string;
  engines: Partial<Record<AIEngine, AIEngineResult>>;
  recommendation?: AIRecommendation;
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
  score?: number;
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

export async function addAIQueries(projectId: string, queries: Array<{ text: string; keyword_id?: string; source?: string }>) {
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

export async function fetchAIAnswer(checkId: number) {
  return api(`/api/rank-tracking/ai/checks/${checkId}/answer`) as Promise<{ answer_text: string | null }>;
}

// --- Project selection ------------------------------------------------------

export function cleanTrackingDomain(value: string): string {
  return value.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase();
}

// A user can have several rank-tracking projects on the same domain. When the
// AI Performance tab (or the Track dialog) has to pick one, prefer the project
// that is actually set up for AI tracking: tracking enabled beats disabled,
// configured brand terms beat defaults, and the oldest project (the original,
// not an accidental duplicate) wins ties.
export function rankProjectsForAITracking<T extends { created_at: string; ai_tracking_enabled?: number; ai_brand_terms?: string | null }>(projects: T[]): T[] {
  return [...projects].sort((a, b) => {
    const enabled = (b.ai_tracking_enabled ? 1 : 0) - (a.ai_tracking_enabled ? 1 : 0);
    if (enabled !== 0) return enabled;
    const configured = (b.ai_brand_terms ? 1 : 0) - (a.ai_brand_terms ? 1 : 0);
    if (configured !== 0) return configured;
    return a.created_at.localeCompare(b.created_at);
  });
}
