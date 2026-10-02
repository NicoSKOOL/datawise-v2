// Shapes shared by the Internal Links pipeline stages. Field names follow the
// Python jev-internal-links tool so its run data can be used as fixtures.

export interface CandidateTarget {
  url: string;
  canon: string;
  title: string;
  h1?: string;
  description?: string;
  inbound_links: number;
  sim: number;
}

// One source paragraph plus the pages it might link to (shortlist output).
export interface Candidate {
  source_url: string;
  source_canon: string;
  source_title: string;
  p_i: number;
  text: string;
  targets: CandidateTarget[];
}

export interface ChoiceAnswer {
  choice: string;
  probabilities?: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  noul: number;
}

export interface JevAnswers {
  best_target: ChoiceAnswer;
  link_warranted: NoulAnswer;
  anchor_available: NoulAnswer;
  reader_stage: ChoiceAnswer;
  commercial: NoulAnswer;
}

export interface JevResponse {
  answers?: JevAnswers;
  model?: string;
  usage?: { cost?: number; input_tokens?: number };
}

export interface Judgement {
  candidate: Candidate;
  response: JevResponse;
}

export type LinkAction = 'apply' | 'review';

export interface Allocation {
  score: number;
  final_score: number;
  action: LinkAction;
  source: string;
  source_canon: string;
  source_title: string;
  p_i: number;
  text: string;
  target: string;
  target_canon: string;
  target_title: string;
  target_inbound_before: number;
  confidence: number;
  link_warranted: number;
  anchor_available: number;
  commercial: number;
  reader_stage: string;
  similarity: number;
  is_money_page: boolean;
}

export type FilterRejection =
  | 'api_error'
  | 'model_said_none'
  | 'low_confidence'
  | 'not_warranted'
  | 'no_natural_anchor'
  | 'self_link';

export type CapReason = 'duplicate_pair' | 'source_full' | 'target_full' | 'too_close';

export type Outcome =
  | 'linked_apply'
  | 'linked_review'
  | 'no_anchor'
  | CapReason
  | FilterRejection;
