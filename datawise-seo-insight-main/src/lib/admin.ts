import { api } from './api';

interface UploadResult {
  success: boolean;
  imported: number;
  granted: number;
  revoked: number;
}

interface CrossReferenceResult {
  total_csv_members: number;
  active_members: Array<{
    id: string;
    email: string;
    name: string;
    subscription_tier: string;
    created_at: string;
    first_name: string;
    last_name: string;
    community_tier: string;
    ltv: number;
    joined_date: string;
  }>;
  non_members: Array<{
    id: string;
    email: string;
    name: string;
    subscription_tier: string;
    is_community_member: number;
    created_at: string;
  }>;
  not_registered: Array<{
    email: string;
    first_name: string;
    last_name: string;
    tier: string;
    ltv: number;
    joined_date: string;
  }>;
}

interface AccessResult {
  success: boolean;
  affected: number;
}

export function uploadMembers(csvText: string): Promise<UploadResult> {
  return api<UploadResult>('/api/admin/upload-members', {
    method: 'POST',
    body: { csv: csvText },
  });
}

export function getCrossReference(): Promise<CrossReferenceResult> {
  return api<CrossReferenceResult>('/api/admin/cross-reference');
}

export function revokeAccess(userIds: string[]): Promise<AccessResult> {
  return api<AccessResult>('/api/admin/revoke-access', {
    method: 'POST',
    body: { user_ids: userIds },
  });
}

export function restoreAccess(userIds: string[]): Promise<AccessResult> {
  return api<AccessResult>('/api/admin/revoke-access', {
    method: 'POST',
    body: { user_ids: userIds, action: 'restore' },
  });
}

export function sendInvites(emails?: string[]): Promise<{ sent: number; failed: number; total: number }> {
  return api('/api/admin/send-invites', {
    method: 'POST',
    body: emails ? { emails } : {},
  });
}

export function addMember(email: string, sendInvite = true): Promise<{ status: string; message: string }> {
  return api('/api/admin/add-member', {
    method: 'POST',
    body: { email, send_invite: sendInvite },
  });
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  subscription_tier: string;
  is_community_member: number;
  is_admin: number;
  credits_used: number;
  created_at: string;
}

export function listUsers(): Promise<{ users: AppUser[] }> {
  return api('/api/admin/users');
}

export function deleteUser(userId: string): Promise<{ success: boolean }> {
  return api('/api/admin/delete-user', {
    method: 'POST',
    body: { user_id: userId },
  });
}

export function toggleMember(userId: string, action: 'grant' | 'revoke', sendEmail = false): Promise<{ success: boolean; email_sent?: boolean }> {
  return api('/api/admin/toggle-member', {
    method: 'POST',
    body: { user_id: userId, action, send_email: sendEmail },
  });
}

// Promo code types
export interface PromoCode {
  id: string;
  code: string;
  label: string;
  duration_hours: number;
  max_redemptions: number | null;
  redemption_count: number;
  conversion_count: number;
  total_ltv: number;
  avg_days_to_convert: number | null;
  is_active: number;
  expires_at: string | null;
  created_at: string;
}

export interface PromoRedemption {
  id: string;
  user_email: string;
  user_name: string;
  activated_at: string;
  expires_at: string;
  is_expired: boolean;
  converted: 0 | 1;
  converted_at: string | null;
}

export interface PromoConversionSummary {
  conversion_count: number;
  total_ltv: number;
}

// Promo code admin functions
export function fetchPromoCodes(): Promise<{
  promo_codes: PromoCode[];
  organic: PromoConversionSummary;
  promo_total: PromoConversionSummary;
}> {
  return api('/api/admin/promo-codes');
}

export function createPromoCode(data: {
  code: string;
  label: string;
  duration_hours?: number;
  max_redemptions?: number;
  expires_at?: string;
}): Promise<{ promo_code: PromoCode }> {
  return api('/api/admin/promo-codes', {
    method: 'POST',
    body: data,
  });
}

export function togglePromoCode(id: string): Promise<{ success: boolean }> {
  return api(`/api/admin/promo-codes/${id}`, {
    method: 'PATCH',
  });
}

export function fetchPromoRedemptions(id: string): Promise<{ redemptions: PromoRedemption[] }> {
  return api(`/api/admin/promo-codes/${id}/redemptions`);
}

// Conversion analytics
export interface ConversionAnalytics {
  overview: {
    free_to_paid: number;
    churned_back: number;
    converted_users: number;
    total_users: number;
    conversion_rate: string;
  };
  promo_funnel: {
    total_promo_users: number;
    promo_then_converted: number;
    promo_conversion_rate: string;
  };
  tier_distribution: Array<{ subscription_tier: string; count: number }>;
  monthly_conversions: Array<{ month: string; conversions: number }>;
  conversions_by_source: Array<{ source: string; count: number }>;
}

export function fetchConversionAnalytics(): Promise<ConversionAnalytics> {
  return api('/api/admin/conversion-analytics');
}

// Traffic + signup analytics (raw page-view + signup attribution).
export interface TrafficAnalytics {
  range: { from: string; to: string };
  totals: { pageviews: number; sessions: number; logged_in_users: number };
  sources: Array<{ source: string; pageviews: number; sessions: number }>;
  daily: Array<{ day: string; pageviews: number; sessions: number }>;
  top_paths: Array<{ path: string; pageviews: number; sessions: number }>;
  countries: Array<{ country: string; sessions: number }>;
}

export interface SignupAnalytics {
  range: { from: string; to: string };
  totals: { total_signups: number; paid_signups: number; unattributed: number };
  by_source: Array<{
    utm_source: string | null;
    referrer: string | null;
    signups: number;
    paid: number;
  }>;
  by_campaign: Array<{ campaign: string; signups: number; paid: number }>;
  by_medium: Array<{ medium: string; signups: number }>;
  daily: Array<{ day: string; signups: number }>;
  recent_signups: Array<{
    email: string;
    name: string | null;
    subscription_tier: string;
    signup_utm_source: string | null;
    signup_utm_medium: string | null;
    signup_utm_campaign: string | null;
    signup_referrer: string | null;
    signup_landing_path: string | null;
    created_at: string;
  }>;
}

function rangeQuery(from?: string, to?: string): string {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

export function fetchTrafficAnalytics(from?: string, to?: string): Promise<TrafficAnalytics> {
  return api(`/api/admin/analytics/traffic${rangeQuery(from, to)}`);
}

export function fetchSignupAnalytics(from?: string, to?: string): Promise<SignupAnalytics> {
  return api(`/api/admin/analytics/signups${rangeQuery(from, to)}`);
}

// Content Writer prompt admin
export interface ContentWriterPromptVersion {
  id: string;
  prompt_key: string;
  version: number;
  prompt_text: string;
  published_by: string | null;
  published_at: string;
}

export interface ContentWriterPromptConfig {
  prompt_key: string;
  draft_text: string | null;
  published_text: string | null;
  published_version: number;
  updated_by: string | null;
  updated_at: string | null;
  published_by: string | null;
  published_at: string | null;
}

export interface ContentWriterPromptRegistryItem {
  key: string;
  label: string;
  group: string;
  description: string;
  defaultText: string;
  editable: boolean;
  placeholders?: string[];
  config: ContentWriterPromptConfig | null;
  effective: {
    text: string;
    source: 'default' | 'published';
    publishedVersion: number;
  };
  versions: ContentWriterPromptVersion[];
}

export interface PromptPreviewRequest {
  mode?: 'post_step' | 'interview' | 'finalize' | 'website_pages_discovery' | 'kb_auto_draft';
  step?: 'research' | 'outline' | 'draft' | 'review';
  doc_type?: 'sitemap' | 'tone_of_voice' | 'experience_notes' | 'service_details' | 'brand_guidelines';
  post_id?: string;
}

export interface PromptPreviewResponse {
  mode: string;
  step?: string;
  doc_type?: string;
  post_id?: string | null;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  context?: Record<string, string>;
  placeholder_warnings?: string[];
  template_placeholders?: string[];
  metadata: Record<string, unknown>;
}

export function fetchContentWriterPrompts(): Promise<{ prompts: ContentWriterPromptRegistryItem[] }> {
  return api('/api/admin/content-writer-prompts');
}

export function saveContentWriterPromptDraft(promptKey: string, draftText: string): Promise<{ success: boolean }> {
  return api(`/api/admin/content-writer-prompts/${encodeURIComponent(promptKey)}/draft`, {
    method: 'PUT',
    body: { draft_text: draftText },
  });
}

export function publishContentWriterPrompt(promptKey: string): Promise<{ success: boolean; version: number }> {
  return api(`/api/admin/content-writer-prompts/${encodeURIComponent(promptKey)}/publish`, {
    method: 'POST',
  });
}

export function resetContentWriterPrompt(promptKey: string): Promise<{ success: boolean }> {
  return api(`/api/admin/content-writer-prompts/${encodeURIComponent(promptKey)}/reset`, {
    method: 'POST',
  });
}

export function renderContentWriterPrompt(body: PromptPreviewRequest): Promise<PromptPreviewResponse> {
  return api('/api/admin/content-writer-prompts/render', {
    method: 'POST',
    body,
  });
}
