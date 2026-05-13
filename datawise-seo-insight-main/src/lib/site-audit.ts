import { api } from './api';

export type AuditStatus = 'pending' | 'running' | 'analyzing' | 'completed' | 'failed';
export type ActionStatus = 'todo' | 'in_progress' | 'done';
export type Priority = 'high' | 'medium' | 'low';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Category =
  | 'performance'
  | 'seo'
  | 'accessibility'
  | 'best_practices'
  | 'meta'
  | 'images'
  | 'content'
  | 'technical';

export interface TitleVerdict {
  rating: 'good' | 'ok' | 'poor';
  current: string;
  length: number;
  issues: string[];
  suggested_rewrite: string;
}
export interface MetaVerdict {
  rating: 'good' | 'ok' | 'poor';
  current: string;
  length: number;
  issues: string[];
  has_cta: boolean;
  suggested_rewrite: string;
}
export interface HeadingsVerdict {
  rating: 'good' | 'ok' | 'poor';
  issues: string[];
  suggested_h1: string;
}
export interface SchemaVerdict {
  rating: 'good' | 'ok' | 'poor';
  missing: string[];
  suggested_faq: { question: string; answer: string }[];
}
export interface ImagesVerdict {
  rating: 'good' | 'ok' | 'poor';
  issues: string[];
  specific_actions: string[];
}

export interface AIAnalysis {
  executive_summary: string;
  business_context: string;
  primary_keyword: string;
  likely_keywords: string[];
  title_verdict: TitleVerdict | null;
  meta_verdict: MetaVerdict | null;
  headings_verdict: HeadingsVerdict | null;
  schema_verdict: SchemaVerdict | null;
  images_verdict: ImagesVerdict | null;
  priority_actions: { title: string; why: string }[];
  quick_wins: { title: string; why: string }[];
}

export interface LoadingSummary {
  score: number;
  seconds: number | null;
  ttfb_ms: number | null;
  total_bytes: number | null;
  verdict: 'fast' | 'ok' | 'slow' | 'very_slow' | 'unknown';
  verdict_text: string;
  sample_count?: number;
  seconds_min?: number | null;
  seconds_max?: number | null;
  score_source?: 'lighthouse_median' | 'onpage_fallback';
  confidence?: 'high' | 'medium' | 'low';
  straddles_lcp_threshold?: boolean;
}

export interface PerfBreakdown {
  images: {
    present: boolean;
    savings_bytes: number;
    savings_items: { url: string; savings_bytes: number }[];
  };
  javascript: { present: boolean; unused_bytes: number };
  css: { present: boolean; unused_bytes: number };
  render_blocking: { present: boolean; count: number; savings_ms: number };
}

export interface TitleAnalysis {
  present: boolean;
  text: string | null;
  length: number;
  status: 'missing' | 'too_short' | 'too_long' | 'ok';
  source: 'meta_tag' | 'google_snippet' | 'h1_fallback' | null;
  issues: string[];
  suggestion: string;
}

export interface MetaDescriptionAnalysis {
  present: boolean;
  text: string | null;
  length: number;
  status: 'missing' | 'too_short' | 'too_long' | 'ok';
  source: 'meta_tag' | 'google_snippet' | null;
  is_google_snippet: boolean;
  has_cta: boolean;
  issues: string[];
  suggestion: string;
}

export interface HeadingsAnalysis {
  h1: string[];
  h2: string[];
  h3: string[];
  issues: string[];
  hierarchy_ok: boolean;
  total_count: number;
  lighthouse_order_score: number | null;
  primary_keyword_in_h1: boolean;
  primary_keyword_in_any_heading: boolean;
  lsi_keyword_coverage: { keyword: string; found_in: string[] }[];
}

export interface KeywordCoverage {
  primary_keyword: string;
  primary_in_title: boolean;
  primary_in_meta: boolean;
  primary_in_h1: boolean;
  primary_in_any_heading: boolean;
  lsi_keywords: { keyword: string; found_in: string[] }[];
  verdict: string;
}

export interface ImagesAnalysis {
  total: number;
  missing_alt: number;
  missing_alt_samples: { src: string }[];
  webp_savings_bytes: number;
  webp_savings_items: { url: string; savings_bytes: number }[];
  lighthouse_alt_score: number | null;
  png_count: number;
  png_samples: { src: string; alt: string }[];
  format_breakdown: { format: string; count: number }[];
}

export interface SchemaAnalysis {
  present: boolean;
  types: string[];
  has_faq: boolean;
  has_local_business: boolean;
  has_organization: boolean;
  has_service: boolean;
  recommended_missing: string[];
}

export interface DataSourceStatus {
  direct_fetch_ok: boolean;
  instant_pages_ok: boolean;
  content_parsing_ok: boolean;
  serp_ok: boolean;
  lighthouse_ok: boolean;
  bot_protection_detected: boolean;
}

export interface StructuredSEO {
  loading: LoadingSummary;
  perf: PerfBreakdown;
  title: TitleAnalysis;
  meta_description: MetaDescriptionAnalysis;
  headings: HeadingsAnalysis;
  images: ImagesAnalysis;
  schema: SchemaAnalysis;
  keyword_coverage?: KeywordCoverage | null;
  data_sources?: DataSourceStatus | null;
}

export interface CrawlDiagnostics {
  reason_code: string;
  user_message: string;
  technical_message?: string | null;
  task_status_message?: string | null;
  crawl_progress?: string | null;
  crawl_stop_reason?: string | null;
  extended_crawl_status?: string | null;
  crawl_gateway_address?: string | null;
  pages_crawled?: number | null;
  max_crawl_pages?: number | null;
  domain_server?: string | null;
  domain_ip?: string | null;
  checks?: Record<string, unknown> | null;
}

export interface SiteAudit {
  id: string;
  user_id: string;
  domain: string;
  start_url: string;
  status: AuditStatus;
  pages_crawled: number;
  score: number | null;
  perf_score: number | null;
  seo_score: number | null;
  a11y_score: number | null;
  best_practices_score: number | null;
  lighthouse_data: unknown | null;
  ai_analysis: AIAnalysis | null;
  seo_analysis: StructuredSEO | null;
  error_message: string | null;
  crawl_diagnostics?: CrawlDiagnostics | null;
  created_at: string;
  completed_at: string | null;
}

export interface SiteAuditListItem {
  id: string;
  domain: string;
  start_url: string;
  status: AuditStatus;
  score: number | null;
  perf_score: number | null;
  seo_score: number | null;
  a11y_score: number | null;
  best_practices_score: number | null;
  pages_crawled: number;
  error_message: string | null;
  crawl_diagnostics?: CrawlDiagnostics | null;
  created_at: string;
  completed_at: string | null;
  total_items: number;
  done_items: number;
}

export interface FindingEvidenceItem {
  url: string;
  size_bytes: number;
}

export interface FindingEvidence {
  score: number | null;
  display_value: string | null;
  how_to_fix: string;
  impact: 'quick_win' | 'high_impact' | 'normal' | 'advanced';
  items?: FindingEvidenceItem[];
}

export interface AuditFinding {
  id: string;
  audit_id: string;
  category: Category;
  severity: Severity;
  code: string;
  title: string;
  description: string;
  page_url: string | null;
  evidence: FindingEvidence | null;
  created_at: string;
}

export interface Subtask {
  id: string;
  text: string;
  done: boolean;
  url?: string;
}

export interface Attachment {
  url: string;
  name?: string;
  content_type?: string;
}

export type TaskSource = 'audit' | 'manual';

export interface ActionItem {
  id: string;
  audit_id: string | null;
  property_id: string | null;
  finding_id: string | null;
  source: TaskSource;
  title: string;
  how_to_fix: string;
  category: Category | string | null;
  url: string | null;
  priority: Priority;
  status: ActionStatus;
  position: number;
  due_date: string | null;
  // Stored as JSON strings server-side; clients should parse.
  subtasks: string | Subtask[] | null;
  attachments: string | Attachment[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export function parseSubtasks(item: Pick<ActionItem, 'subtasks'>): Subtask[] {
  const v = item.subtasks;
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseAttachments(item: Pick<ActionItem, 'attachments'>): Attachment[] {
  const v = item.attachments;
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createAudit(domain: string): Promise<SiteAudit> {
  return api<SiteAudit>('/api/site-audit/audits', { method: 'POST', body: { domain } });
}

export function listAudits(): Promise<SiteAuditListItem[]> {
  return api<SiteAuditListItem[]>('/api/site-audit/audits');
}

export function getAudit(
  id: string
): Promise<{ audit: SiteAudit; findings: AuditFinding[] }> {
  return api(`/api/site-audit/audits/${id}`);
}

export function deleteAudit(id: string): Promise<{ success: boolean }> {
  return api(`/api/site-audit/audits/${id}`, { method: 'DELETE' });
}

export function listActionItems(auditId: string): Promise<ActionItem[]> {
  return api(`/api/site-audit/audits/${auditId}/action-items`);
}

export function listPropertyTasks(propertyId: string, auditId?: string): Promise<ActionItem[]> {
  const qs = auditId ? `?audit_id=${encodeURIComponent(auditId)}` : '';
  return api(`/api/site-audit/properties/${propertyId}/tasks${qs}`);
}

export interface TaskPatch {
  status?: ActionStatus;
  priority?: Priority;
  position?: number;
  notes?: string | null;
  title?: string;
  how_to_fix?: string;
  category?: string | null;
  url?: string | null;
  due_date?: string | null;
  subtasks?: Subtask[] | null;
  attachments?: Attachment[] | null;
}

export function updateActionItem(id: string, patch: TaskPatch): Promise<ActionItem> {
  return api(`/api/site-audit/action-items/${id}`, { method: 'PATCH', body: patch });
}

export interface CreateTaskBody {
  property_id: string;
  audit_id?: string | null;
  title: string;
  how_to_fix?: string;
  category?: string | null;
  url?: string | null;
  priority?: Priority;
  status?: ActionStatus;
  due_date?: string | null;
  subtasks?: Subtask[];
  attachments?: Attachment[];
  notes?: string | null;
}

export function createTask(body: CreateTaskBody): Promise<ActionItem> {
  return api('/api/site-audit/tasks', { method: 'POST', body });
}

export function deleteActionItem(id: string): Promise<{ success: boolean }> {
  return api(`/api/site-audit/action-items/${id}`, { method: 'DELETE' });
}

export async function uploadTaskAttachment(
  file: File
): Promise<{ url: string; name: string; content_type: string }> {
  const token = localStorage.getItem('datawise_session_token');
  const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/api/site-audit/attachments`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  return res.json();
}
