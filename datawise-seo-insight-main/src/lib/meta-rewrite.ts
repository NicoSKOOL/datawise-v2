import { api } from './api';
import { getLLMConfig } from './chat';

export type MetaRewriteIssueType =
  | 'missing_title'
  | 'long_title'
  | 'short_title'
  | 'duplicate_title'
  | 'missing_desc'
  | 'long_desc'
  | 'short_desc';

export interface MetaRewritePageContext {
  h1?: string;
  h2s?: string[];
  body_excerpt?: string;
  keywords?: string;
}

export interface MetaRewriteRequest {
  url: string;
  current_title?: string | null;
  current_description?: string | null;
  issue_type: MetaRewriteIssueType;
  target_keyword?: string;
  context?: MetaRewritePageContext;
}

export interface MetaRewriteResponse {
  title: string;
  title_length: number;
  description: string;
  description_length: number;
  target_keyword: string;
  reasoning: string;
  length_warning?: boolean;
  usage: { input_tokens: number; output_tokens: number };
}

export async function rewriteMeta(req: MetaRewriteRequest): Promise<MetaRewriteResponse> {
  const llm_config = getLLMConfig();
  if (!llm_config) throw new Error('NO_LLM_KEY');
  return api<MetaRewriteResponse>('/api/site-audit/meta-rewrite', {
    method: 'POST',
    body: { ...req, llm_config },
  });
}
