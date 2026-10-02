import { api } from './api';
import { getLLMConfig, syncLLMConfigToServer } from './chat';

// Internal Links (Jev). Runs execute on the Worker in slices; polling a run's
// status is also what advances it while this page is open.

export type RunStage = 'crawl' | 'shortlist' | 'score' | 'allocate' | 'anchors' | 'report' | 'done';
export type RunStatus = 'running' | 'awaiting_confirmation' | 'completed' | 'failed';

export interface RunProgress {
  pages_total?: number;
  pages_done?: number;
  pages_failed?: number;
  sitemap_pages?: number;
  passages?: number;
  shortlisted?: number;
  candidates?: number;
  judged?: number;
  api_errors?: number;
  allocated?: number;
  anchors_done?: number;
  anchored?: number;
  tokens?: number;
  jev_model?: string;
}

export interface RunSummary {
  pages: number;
  decisions: number;
  links: number;
  apply: number;
  review: number;
  orphans: number;
}

export interface InternalLinkRun {
  id: string;
  site_url: string;
  sitemap_url: string | null;
  status: RunStatus;
  stage: RunStage;
  cursor: number;
  total: number;
  progress: RunProgress;
  summary: RunSummary | null;
  cost_usd: number;
  max_cost_usd: number;
  estimated_cost_usd: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type Outcome =
  | 'linked_apply' | 'linked_review' | 'no_anchor'
  | 'source_full' | 'too_close' | 'target_full' | 'duplicate_pair'
  | 'model_said_none' | 'low_confidence' | 'not_warranted' | 'no_natural_anchor' | 'self_link' | 'api_error';

export interface ReportRow {
  i: number;
  o: Outcome;
  s: number;
  p: number;
  t: string;
  a: string;
  c: number | null;
  n: number;
  k: Array<[number, number, number, number]>;
  j: string;
  w: number | null;
  v: number | null;
  r: string;
  m: number | null;
  rr?: string;
}

export interface ReportPage {
  u: number;
  inbound: number;
  new_links: number;
  passages: number;
  word_count: number;
}

export interface InternalLinksReport {
  version: 1;
  summary: {
    site: string;
    generated_at: string;
    jev_model: string;
    anchor_model: string;
    pages: number;
    failed_pages: number;
    decisions: number;
    links: number;
    cost_usd: number;
    tokens: number;
    thresholds: { min_confidence: number; min_link_warranted: number; min_anchor_available: number; auto_approve_confidence: number };
    caps: { max_new_links_per_source: number; max_new_links_per_target: number; target_decay: number; min_passages_between: number };
  };
  urls: Array<[string, string]>;
  rows: ReportRow[];
  pages: ReportPage[];
}

export type Approval = 'approved' | 'rejected';

export const OUTCOME_LABELS: Record<Outcome, string> = {
  linked_apply: 'Linked, high confidence',
  linked_review: 'Linked, needs your review',
  no_anchor: 'Kept, but no clean anchor in the paragraph',
  source_full: 'Source page already got its new links',
  too_close: 'Too close to another new link',
  target_full: 'Target page already got enough new links',
  duplicate_pair: 'Page already links to that target elsewhere',
  model_said_none: 'Jev said none of these pages fit',
  low_confidence: 'Jev was not sure enough',
  not_warranted: "Paragraph doesn't need a link",
  no_natural_anchor: 'No natural anchor phrase',
  self_link: 'Would link to itself',
  api_error: 'API error',
};

export const isLinked = (o: Outcome) => o === 'linked_apply' || o === 'linked_review';

export async function startRun(siteUrl: string): Promise<{ run: InternalLinkRun; truncated: boolean }> {
  // Background slices read the key from the account's encrypted backup, so
  // make sure the backup matches this browser's key before starting.
  const local = getLLMConfig();
  if (local) await syncLLMConfigToServer(local);
  return api('/api/internal-links/runs', { method: 'POST', body: { site_url: siteUrl } });
}

export const listRuns = () => api<{ runs: InternalLinkRun[] }>('/api/internal-links/runs');
export const getRun = (id: string) => api<{ run: InternalLinkRun }>(`/api/internal-links/runs/${id}`);
// Does up to ~45s of work on the server, then returns fresh status.
export const advanceRun = (id: string) =>
  api<{ run: InternalLinkRun | null; advanced: boolean }>(`/api/internal-links/runs/${id}/advance`, { method: 'POST' });
export const deleteRun = (id: string) => api(`/api/internal-links/runs/${id}`, { method: 'DELETE' });
export const confirmRun = (id: string) => api<{ run: InternalLinkRun }>(`/api/internal-links/runs/${id}/confirm`, { method: 'POST' });
export const resumeRun = (id: string) => api<{ run: InternalLinkRun }>(`/api/internal-links/runs/${id}/resume`, { method: 'POST' });
export const getReport = (id: string) =>
  api<{ report: InternalLinksReport; approvals: Record<string, Approval> }>(`/api/internal-links/runs/${id}/report`);
export const setApproval = (id: string, rowId: number, value: Approval | null) =>
  api<{ approvals: Record<string, Approval> }>(`/api/internal-links/runs/${id}/approvals`, {
    method: 'PATCH',
    body: { id: rowId, value },
  });
