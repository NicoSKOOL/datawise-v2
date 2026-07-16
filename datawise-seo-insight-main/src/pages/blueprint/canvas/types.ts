// Local mirrors of the worker's Blueprint Canvas read contracts
// (workers/src/blueprint/db/blueprint-reads.ts). Frontend and worker are
// separate build targets, so these are copied, not imported. Keep field
// names and shapes in sync with that file when either side changes.

export interface BlueprintLatestView {
  versionId: string;
  versionNumber: number;
  status: string;
  schemaVersion: string;
  rulesetVersion: string;
  completeness: string;
  partialReasons: string[];
  summary: Record<string, unknown>;
  publishedAt: string | null;
  revision: { id: string; revisionNumber: number; revisionHash: string };
}

export interface BlueprintGraphNode {
  logicalPageId: string;
  parentLogicalPageId: string | null;
  pageType: string;
  title: string;
  slug: string;
  primaryKeyword: string | null;
  primaryVolume: number | null;
  primaryIntent: string | null;
  recommendation: string;
  approval: string;
  priority: string | null;
  confidenceLabel: string | null;
  supportingKeywordCount: number;
}

export interface BlueprintGraphResponse {
  revisionId: string;
  nodes: BlueprintGraphNode[];
}

export interface BlueprintPageDetail {
  node: BlueprintGraphNode;
  page: {
    h1: string | null;
    metaDescription: string | null;
    decisionReason: string | null;
    firedSignals: string[];
    evidenceRefIds: string[];
    clusterIds: string[];
  };
  cluster: {
    members: { keyword: string; volume: number | null; intent: string | null }[];
    totalMembers: number;
    semanticCohesion: number | null;
    serpOverlapCohesion: number | null;
  } | null;
  competitorEvidence: { domain: string; position: number; url: string }[];
  evidenceAvailable: boolean;
  faqs: { question: string; source: string | null }[];
  fanOut: { status: 'pending_phase_5' };
}

// Response envelope every Blueprint API route returns: { requestId, data }.
export interface ApiSuccess<T> {
  requestId: string;
  data: T;
}
