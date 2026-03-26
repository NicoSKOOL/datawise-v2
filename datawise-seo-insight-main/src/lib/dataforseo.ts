// DataForSEO API wrapper for the frontend
// Replaces all supabase.functions.invoke() calls

import { api } from './api';

// --- Keyword Research ---

export async function fetchRelatedKeywords(params: {
  keyword: string;
  location_code: number;
  language_code: string;
  limit: number;
}) {
  return api('/api/keywords/related', { method: 'POST', body: params });
}

export async function fetchKeywordSuggestions(params: {
  keyword: string;
  location_code: number;
  language_code: string;
  limit: number;
}) {
  return api('/api/keywords/suggestions', { method: 'POST', body: params });
}

export async function fetchKeywordIdeas(params: {
  keyword: string;
  location_code: number;
  language_code: string;
}) {
  return api('/api/keywords/ideas', { method: 'POST', body: params });
}

export async function fetchKeywordDifficulty(params: {
  keywords: string[];
  location_code: number;
  language_code: string;
}) {
  return api('/api/keywords/difficulty', { method: 'POST', body: params });
}

export async function fetchKeywordOverview(params: {
  keyword: string;
  location_code: number;
  language_code: string;
}) {
  return api('/api/keywords/overview', { method: 'POST', body: params });
}

// --- Competitor Analysis ---

export async function fetchRankedKeywords(params: {
  target: string;
  location_code: number;
  language_code: string;
  limit: number;
}) {
  return api('/api/competitors/ranked-keywords', { method: 'POST', body: params });
}

export async function fetchDomainRankOverview(params: {
  target?: string;
  targets?: string[];
  location_code: number;
  language_code: string;
}) {
  return api('/api/competitors/domain-rank', { method: 'POST', body: params });
}

export async function fetchKeywordGapAnalysis(params: {
  my_domain: string;
  competitor_domain: string;
  location_code: number;
  language_code: string;
}) {
  return api('/api/competitors/gap-analysis', { method: 'POST', body: params });
}

export async function fetchBulkTrafficEstimation(params: {
  targets: string[];
  location_code: number;
  language_code: string;
}) {
  return api('/api/competitors/traffic', { method: 'POST', body: params });
}

export async function fetchCompetitorsDomain(params: {
  target: string;
  location_code: number;
  language_code: string;
}) {
  return api('/api/competitors/domains', { method: 'POST', body: params });
}

// --- AI / SERP Analysis ---

export async function fetchGoogleAIMode(params: {
  keyword: string;
  location_name: string;
  device: string;
  os: string;
}) {
  return api('/api/ai/google-ai-mode', { method: 'POST', body: params });
}

export async function fetchChatGPTSearch(params: { keyword: string }) {
  return api('/api/ai/chatgpt-search', { method: 'POST', body: params });
}

export async function fetchPerplexitySearch(params: {
  keyword: string;
  location_code: number;
}) {
  return api('/api/ai/perplexity', { method: 'POST', body: params });
}

export async function fetchPeopleAlsoAsk(params: {
  keyword: string;
  location: string;
  language: string;
  depth?: number;
}) {
  return api('/api/ai/people-also-ask', { method: 'POST', body: params });
}

export async function fetchLighthouseSEO(params: { url: string }) {
  return api('/api/ai/lighthouse-seo', { method: 'POST', body: params });
}

export async function fetchGeoAnalyzer(params: {
  url: string;
  businessName?: string;
  targetLocation?: string;
  primaryService?: string;
}) {
  return api('/api/ai/geo-analyzer', { method: 'POST', body: params });
}

// --- Rank Tracking ---

export async function fetchRankProjects() {
  return api('/api/rank-tracking/projects');
}

export async function createRankProject(params: { name: string; domain: string; location_code?: number }) {
  return api('/api/rank-tracking/projects', { method: 'POST', body: params });
}

export async function deleteRankProject(projectId: string) {
  return api(`/api/rank-tracking/projects/${projectId}`, { method: 'DELETE' });
}

export async function fetchProjectKeywords(projectId: string) {
  return api(`/api/rank-tracking/projects/${projectId}/keywords`);
}

export async function addProjectKeywords(projectId: string, params: { keywords: string[]; location_code?: number; language_code?: string; initial_positions?: Record<string, number> }) {
  return api(`/api/rank-tracking/projects/${projectId}/keywords`, { method: 'POST', body: params });
}

export async function deleteTrackedKeyword(keywordId: string) {
  return api(`/api/rank-tracking/keywords/${keywordId}`, { method: 'DELETE' });
}

export async function checkProjectRankings(projectId: string) {
  return api(`/api/rank-tracking/projects/${projectId}/check`, { method: 'POST' });
}

export async function fetchKeywordHistory(keywordId: string) {
  return api(`/api/rank-tracking/keywords/${keywordId}/history`);
}

export async function fetchProjectReport(projectId: string, period = 30) {
  return api(`/api/rank-tracking/projects/${projectId}/report?period=${period}`);
}

export async function fetchDashboardSummary() {
  return api('/api/rank-tracking/dashboard-summary');
}
