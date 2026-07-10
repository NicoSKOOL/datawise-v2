import type {
  ProjectMode, RecommendationStatus, ApprovalStatus, PageType,
  WarningCode, WarningSeverity,
} from './enums';

export interface ServiceInput {
  clientId: string;
  name: string;
  description?: string;
  priority?: 'primary' | 'secondary';
}

export interface ServiceAreaInput {
  clientId: string;
  city: string;
  region?: string;
  countryIso: string;
  radiusKm?: number;
  isPrimary: boolean;
  uniqueProof?: string[];
}

export interface ProjectBriefInput {
  businessName: string;
  category: string;
  websiteUrl?: string;
  countryIso: string;
  languageCode: string;
  services: ServiceInput[];
  serviceAreas: ServiceAreaInput[];
  targetCustomers?: string[];
  differentiators?: string[];
  knownCompetitorDomains?: string[];
  excludedDomains?: string[];
  excludedTopics?: string[];
  goals?: Array<'leads' | 'local_visibility' | 'authority'>;
  maxRecommendedPages?: number;
  enableUsFanout?: boolean;
}

export interface NormalizedProjectBrief {
  mode: ProjectMode;
  businessName: string;
  normalizedBusinessName: string;
  category: string;
  websiteDomain: string | null;
  websiteUrl: string | null;
  countryIso: string;
  languageCode: string;
  services: Array<{
    id: string;
    name: string;
    normalizedName: string;
    description: string | null;
    synonyms: string[];
    priority: 'primary' | 'secondary';
  }>;
  serviceAreas: Array<{
    id: string;
    city: string;
    region: string | null;
    countryIso: string;
    radiusKm: number | null;
    isPrimary: boolean;
    uniqueProof: string[];
  }>;
  targetCustomers: string[];
  differentiators: Array<{ id: string; text: string }>;
  knownCompetitorDomains: string[];
  excludedDomains: string[];
  excludedTopics: string[];
  goals: Array<'leads' | 'local_visibility' | 'authority'>;
  maxRecommendedPages: number;
  enableUsFanout: boolean;
  inputHash: string;
}

// Missing metrics are null, NEVER 0 (handoff acceptance rule).
export interface KeywordMetrics {
  searchVolume: number | null;
  cpcUsd: number | null;
  difficulty: number | null;
}

export interface KeywordCandidate {
  keyword: string;
  source: string; // e.g. 'keyword_ideas', 'suggestions', 'fixture'
  metrics: KeywordMetrics;
  evidenceRefs: string[];
}

export interface MergedKeyword {
  normalizedKeyword: string;
  variants: string[];
  sources: string[];
  metrics: KeywordMetrics;
  evidenceRefs: string[];
}

export interface KeywordUniverse {
  keywords: MergedKeyword[];
}

// Alias: scoring consumes merged evidence-backed keywords.
export type KeywordEvidence = MergedKeyword;

export interface ScoreComponent {
  key: string;
  weight: number;
  rawValue: number;
  contribution: number;
}

export interface ScoreBreakdown {
  total: number; // clamped 0..1
  components: ScoreComponent[];
}

export interface BlueprintWarning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  relatedPageIds: string[];
  evidenceRefIds: string[];
}

export interface BlueprintPageNode {
  id: string;
  parentId: string | null;
  type: PageType;
  title: string;
  slug: string;
  primaryKeywordNormalized: string | null;
  recommendation: RecommendationStatus;
  approval: ApprovalStatus;
}

export interface PageCandidate {
  clientId: string;
  type: PageType;
  title: string;
  proposedSlug: string;
  serviceId: string | null;
  serviceAreaId: string | null;
  primaryKeywordNormalized: string | null;
  uniqueProof: string[];
}

// Minimal cluster surface needed by Phase 1 guardrails; full model lands Phase 4.
export interface KeywordClusterSummary {
  id: string;
  label: string;
  keywordCount: number;
  totalSearchVolume: number | null;
  hasLocalizedEvidence: boolean;
}
