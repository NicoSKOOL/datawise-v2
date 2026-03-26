import { api } from './api';
import { getLLMConfig } from './chat';

export interface SitePage {
  url: string;
  slug: string;
  title: string;
}

export interface PostData {
  url: string;
  slug: string;
  title: string;
  headings: Array<{ level: string; text: string }>;
  body_text: string;
  internal_links: Array<{ text: string; href: string }>;
  external_links: Array<{ text: string; href: string }>;
  word_count: number;
  error: string | null;
}

export interface AuditResult {
  thin_sections: string[];
  outdated_claims: string[];
  missing_internal_links: string[];
  missing_external_links: string[];
  overall_word_count: number;
  verdict: 'thin' | 'average' | 'good';
  _parse_error?: string;
}

export interface UsageInfo {
  input_tokens: number;
  output_tokens: number;
}

function requireLLMConfig() {
  const config = getLLMConfig();
  if (!config) throw new Error('NO_LLM_KEY');
  return config;
}

export async function discoverSitemap(domain: string): Promise<{ pages: SitePage[] }> {
  return api<{ pages: SitePage[] }>('/api/content-tools/discover-sitemap', {
    method: 'POST',
    body: { domain },
  });
}

export async function fetchPost(url: string): Promise<PostData> {
  return api<PostData>('/api/content-tools/fetch-post', {
    method: 'POST',
    body: { url },
  });
}

export async function analyzePost(
  post: { title: string; body_text: string; word_count: number },
  sitePages: SitePage[],
  domain: string,
): Promise<{ audit: AuditResult; usage: UsageInfo }> {
  const llmConfig = requireLLMConfig();
  return api<{ audit: AuditResult; usage: UsageInfo }>('/api/content-tools/analyze-post', {
    method: 'POST',
    body: { post, site_pages: sitePages, domain, llm_config: llmConfig },
  });
}

// ---------------------------------------------------------------------------
// Service Page Optimizer types & API
// ---------------------------------------------------------------------------

export interface ServicePageData {
  url: string;
  slug: string;
  title: string;
  meta_title: string;
  meta_description: string;
  canonical: string;
  headings: Array<{ level: string; text: string }>;
  body_text: string;
  internal_links: Array<{ text: string; href: string }>;
  external_links: Array<{ text: string; href: string }>;
  word_count: number;
  schema_json_ld: unknown[];
  images: Array<{ src: string; alt: string }>;
  error: string | null;
}

export interface ServicePageAnalysis {
  service_type: string;
  industry_category: string;
  location: string;
  content_score: 'thin' | 'adequate' | 'comprehensive';
  content_score_pct: number;
  content_word_count: number;
  content_gaps: Array<{ issue: string; severity: string }>;
  swap_test: {
    score: number;
    generic_sections: Array<{
      heading_or_location: string;
      sample_text: string;
      why_generic: string;
      fix: string;
    }>;
  };
  missing_page_sections: Array<{
    section_type: string;
    label: string;
    why_needed: string;
    priority: string;
  }>;
  industry_specific_sections: Array<{
    section_type: string;
    label: string;
    why_relevant: string;
    priority: string;
  }>;
  image_audit: {
    has_images: boolean;
    total_count: number;
    missing_alt_count: number;
    needs_service_area_map: boolean;
    suggestions: string[];
  };
  heading_structure: {
    has_h1: boolean;
    h1_text: string;
    h1_includes_keyword: boolean;
    h1_includes_location: boolean;
    hierarchy_valid: boolean;
    issues: string[];
    suggested_headings: Array<{ current: string; suggested: string; reason: string }>;
  };
  cta_audit: {
    ctas_found: string[];
    score: 'none' | 'weak' | 'strong';
    suggestions: string[];
  };
  trust_signals: {
    found: string[];
    missing: string[];
    score: 'none' | 'weak' | 'strong';
  };
  tone_analysis: string;
  local_content_section: {
    title: string;
    content: string;
    placement: string;
  };
  schema_existing: string[];
  schema_missing: string[];
  schema_generated: unknown;
  faq: Array<{ question: string; answer: string }>;
  meta_title_current: string;
  meta_title_suggested: string;
  meta_description_current: string;
  meta_description_suggested: string;
  additional_recommendations: string[];
  _parse_error?: string;
}

export async function fetchServicePage(url: string): Promise<ServicePageData> {
  return api<ServicePageData>('/api/content-tools/fetch-service-page', {
    method: 'POST',
    body: { url },
  });
}

export async function analyzeServicePage(
  page: Omit<ServicePageData, 'error' | 'slug' | 'internal_links' | 'external_links' | 'canonical'>,
): Promise<{ analysis: ServicePageAnalysis; usage: UsageInfo }> {
  const llmConfig = requireLLMConfig();
  return api<{ analysis: ServicePageAnalysis; usage: UsageInfo }>('/api/content-tools/analyze-service-page', {
    method: 'POST',
    body: { page, llm_config: llmConfig },
  });
}

export async function generateSection(
  sectionType: string,
  serviceType: string,
  location: string,
  tone: string,
  pageUrl: string,
): Promise<{ content: string; usage: UsageInfo }> {
  const llmConfig = requireLLMConfig();
  return api<{ content: string; usage: UsageInfo }>('/api/content-tools/generate-section', {
    method: 'POST',
    body: { section_type: sectionType, service_type: serviceType, location, tone, page_url: pageUrl, llm_config: llmConfig },
  });
}

export async function rewritePost(
  post: { title: string; body_text: string },
  audit: AuditResult,
  sitePages: SitePage[],
  domain: string,
): Promise<{ rewritten: string; usage: UsageInfo }> {
  const llmConfig = requireLLMConfig();
  return api<{ rewritten: string; usage: UsageInfo }>('/api/content-tools/rewrite-post', {
    method: 'POST',
    body: { post, audit, site_pages: sitePages, domain, llm_config: llmConfig },
  });
}
