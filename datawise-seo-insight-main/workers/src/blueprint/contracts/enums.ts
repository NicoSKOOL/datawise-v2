export type ProjectMode = 'greenfield' | 'existing_site';

export type RecommendationStatus = 'create' | 'update' | 'keep' | 'consolidate';

export type ApprovalStatus = 'proposed' | 'approved' | 'rejected' | 'locked';

export type Priority = 'p1' | 'p2' | 'p3';

export const PAGE_TYPES = [
  'home', 'hub', 'service', 'location', 'service_location',
  'resource', 'comparison', 'company', 'contact', 'faq',
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export type SearchIntent =
  | 'transactional' | 'commercial' | 'informational' | 'navigational' | 'unknown';

export type EvidenceProvider = 'dataforseo' | 'openrouter' | 'existing_site' | 'user';

export const EVIDENCE_KINDS = [
  'keyword_metric', 'ranking', 'competitor_page', 'serp_snapshot', 'paa_question',
  'related_search', 'fanout_query', 'parsed_page', 'business_fact', 'ai_decision',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type EvidenceCompleteness = 'pending' | 'partial' | 'complete';
export type ConfidenceLabel = 'low' | 'medium' | 'high';

export type RunStatus =
  | 'draft' | 'estimating' | 'queued' | 'running' | 'partial'
  | 'succeeded' | 'failed' | 'cancel_requested' | 'cancelled';

export type StageStatus =
  | 'pending' | 'queued' | 'running' | 'succeeded' | 'skipped'
  | 'partial' | 'retry_wait' | 'failed' | 'cancelled';

export const BLUEPRINT_STAGES = [
  'validate_intake', 'resolve_market', 'normalize_brief', 'plan_research',
  'collect_keyword_evidence', 'discover_competitors', 'collect_competitor_evidence',
  'normalize_keyword_universe', 'embed_keyword_features', 'build_provisional_clusters',
  'validate_serps_and_questions', 'refine_clusters', 'parse_competitor_pages',
  'collect_us_fanout', 'build_page_plan', 'overlay_existing_site',
  'synthesize_page_briefs', 'validate_blueprint', 'publish_blueprint',
] as const;
export type BlueprintStage = (typeof BLUEPRINT_STAGES)[number];

export type BlueprintErrorCode =
  | 'invalid_input' | 'unsupported_market' | 'provider_auth_failed'
  | 'provider_quota_exhausted' | 'provider_rate_limited' | 'provider_unavailable'
  | 'provider_timeout' | 'provider_invalid_response' | 'budget_exceeded'
  | 'ai_schema_invalid' | 'ai_evidence_reference_invalid' | 'site_fetch_blocked'
  | 'site_fetch_unsafe' | 'stage_conflict' | 'run_cancelled' | 'internal_error';

export const WARNING_CODES = [
  'cannibalization_risk', 'doorway_risk', 'thin_content_risk', 'missing_metrics',
  'weak_serp_distinction', 'missing_local_proof', 'inventory_limited',
  'partial_evidence', 'slug_conflict',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
export type WarningSeverity = 'info' | 'warning' | 'blocking';
