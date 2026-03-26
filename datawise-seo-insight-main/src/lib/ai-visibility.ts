import { api } from './api';

export interface VisibilitySummary {
  domain: string;
  keywords_checked: string[];
  results: Array<{
    keyword: string;
    google_ai: boolean;
    chatgpt: boolean;
    perplexity: boolean;
  }>;
  engines_visible: number;
  engines_total: number;
  checked_at: string;
}

export async function fetchVisibilitySummary(domain: string) {
  return api<{ cached: boolean; data: VisibilitySummary | null }>(
    `/api/ai/visibility-summary?domain=${encodeURIComponent(domain)}`
  );
}

export async function runVisibilityCheck(domain: string, keywords: string[]) {
  return api<VisibilitySummary>('/api/ai/visibility-check', {
    method: 'POST',
    body: { domain, keywords },
  });
}
