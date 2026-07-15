import type { SearchIntent } from '../../contracts/enums';
import type { ClusterRuleset } from './ruleset';
import type { GraphEdge, KeywordNode, ScoreResult } from './graph';
import { buildKeywordSimilarityGraph, scoreEdge } from './graph';
import { forbiddenEdgeViolations } from './constraints';
import type { ConstraintViolation } from './constraints';
import { assembleClusterDraft, computeClusterCohesion } from './clusters';
import type { ClusterDraft } from './clusters';
import { cosineSimilarity, jaccardSerpOverlap, intentCompatibility } from './similarity';

// Deterministic live-SERP-driven refinement of the provisional clusters from
// stage 10. Pure: no IO, no env, no Date.now, no Math.random, no id generation.
// The caller (refine_clusters handler) supplies every fact -- the current
// clusters, the same keyword nodes stage 10 built, and the live SERP evidence
// stage 11 fetched for cluster representative queries -- and this function
// returns a refined cluster set plus a list of proposed adjudication cases.
// Ambiguity is never guessed: it is surfaced as a `pending`
// (live evidence exists) or `insufficient_evidence` (it does not) adjudication
// for a future AI/human pass (Phase 5). No AI calls, no provider calls.
//
// Everything is total-sorted so double-running produces byte-identical output
// (the determinism suite hashes two runs and compares).

const HARD_BLOCK_VIOLATIONS: ReadonlySet<ConstraintViolation> = new Set([
  'branded_navigational_x_generic',
  'different_services_same_city_only',
  'service_location_x_national_informational',
]);

function cmpStr(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// One cluster carried in from build_provisional_clusters. `primaryKeywordId`'s
// normalized keyword is how live SERP evidence is keyed, so a cluster with no
// live snapshot for its representative query is simply absent from
// `liveByQuery` (which drives hasLiveEvidence below).
export interface RefineClusterInput {
  clusterId: string;
  memberIds: readonly string[];
  primaryKeywordId: string;
  intent: SearchIntent | null;
}

// Live SERP evidence for one representative query. `relatedSearches` and
// `paaQuestions` arrive already normalized (the same normalizeKeyword the
// cluster's representative query went through), so cross-appearance is a plain
// set-membership test against another cluster's normalized representative query.
export interface LiveSerpEvidence {
  organicUrls: readonly string[];
  relatedSearches: readonly string[];
  paaQuestions: readonly string[];
}

export type AdjudicationCaseType = 'merge' | 'split' | 'intent_exception';

// Only the two non-terminal decisions this deterministic pass may assign.
// 'accepted'/'rejected' are reserved for the Phase 5 adjudicator and never
// written here.
export type AdjudicationDecision = 'pending' | 'insufficient_evidence';

export interface AdjudicationScoreContext {
  reason: string;
  score: number | null;
  semantic: number | null;
  serpOverlap: number | null;
  intent: number | null;
  cohesion: number | null;
  hasLiveEvidence: boolean;
  violations: ConstraintViolation[];
  edgeThreshold: number;
  ambiguousBand: { low: number; high: number };
}

export interface AdjudicationCase {
  caseType: AdjudicationCaseType;
  decision: AdjudicationDecision;
  clusterIds: string[]; // sorted
  keywordIds: string[]; // sorted, union of the involved clusters' members
  scoreContext: AdjudicationScoreContext;
}

export interface RefinedCluster {
  clusterKey: string; // lexicographically smallest member id
  // The existing cluster id when this cluster's member set is unchanged from an
  // input cluster (row left untouched); null when it is a merge/split result
  // that needs a fresh id.
  preservedClusterId: string | null;
  changed: boolean;
  origin: 'unchanged' | 'merge' | 'split';
  draft: ClusterDraft;
  // Live-evidence breakdown persisted onto score_breakdown_json for changed
  // clusters; null for unchanged clusters (their row is not rewritten).
  liveBreakdown: {
    origin: 'merge' | 'split';
    sourceClusterIds: string[];
  } | null;
}

export interface RefineResult {
  clusters: RefinedCluster[];
  adjudications: AdjudicationCase[];
  stats: {
    clustersIn: number;
    clustersOut: number;
    autoMerges: number;
    autoSplits: number;
    adjudicationsPending: number;
    adjudicationsInsufficient: number;
    liveSnapshotCoverage: number;
  };
}

// Order-invariant connected components over a fixed id set and an undirected
// edge list. Components sorted internally by id, and by smallest id between
// components. (A local copy rather than an export from clusters.ts: that
// module's own connectedComponents is keyed to its GraphEdge {a,b} shape and
// private; this generic {a,b} string version keeps refine self-contained.)
function connectedComponents(ids: readonly string[], edges: readonly { a: string; b: string }[]): string[][] {
  const parent = new Map<string, string>();
  for (const id of ids) parent.set(id, id);
  const idSet = new Set(ids);
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  for (const e of edges) {
    if (idSet.has(e.a) && idSet.has(e.b)) union(e.a, e.b);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    let g = groups.get(root);
    if (!g) { g = []; groups.set(root, g); }
    g.push(id);
  }
  const comps = [...groups.values()].map((g) => g.sort(cmpStr));
  comps.sort((x, y) => cmpStr(x[0], y[0]));
  return comps;
}

function normalizedSet(values: readonly string[]): Set<string> {
  return new Set(values);
}

// Combined live "SERP overlap" signal between two clusters' representative
// queries. Only defined when BOTH have a live snapshot. Takes the strongest of:
// live organic-URL jaccard, related-search jaccard (>= the ruleset floor), and
// a literal cross-appearance of one representative query in the other's related
// searches / PAA questions (treated as maximal overlap evidence, 1). Returns
// null when both have snapshots but no signal is measurable (e.g. both organic
// lists empty), which lets scoreEdge renormalize the serp component away rather
// than fabricate a zero.
function liveSerpOverlap(
  aLive: LiveSerpEvidence,
  bLive: LiveSerpEvidence,
  repNormA: string,
  repNormB: string,
  ruleset: ClusterRuleset,
): number | null {
  const signals: number[] = [];
  const organic = jaccardSerpOverlap(aLive.organicUrls, bLive.organicUrls);
  if (organic !== null) signals.push(organic);
  const relatedJaccard = jaccardSerpOverlap(aLive.relatedSearches, bLive.relatedSearches);
  if (relatedJaccard !== null && relatedJaccard >= ruleset.refine.relatedSearchJaccardFloor) {
    signals.push(relatedJaccard);
  }
  const aRelated = normalizedSet([...aLive.relatedSearches, ...aLive.paaQuestions]);
  const bRelated = normalizedSet([...bLive.relatedSearches, ...bLive.paaQuestions]);
  if (bRelated.has(repNormA) || aRelated.has(repNormB)) signals.push(1);
  if (signals.length === 0) return null;
  return round6(Math.max(...signals));
}

interface ClusterEdge {
  score: number | null;
  components: { semantic: number | null; serpOverlap: number | null; intent: number | null };
  hasLiveEvidence: boolean;
}

// Cross-cluster boundary edge: semantic cosine of representative vectors, live
// SERP overlap, and cluster-intent compatibility, scored with stage 10's exact
// weighting/renormalization (scoreEdge). hasLiveEvidence is "both clusters have
// a live snapshot", independent of whether that snapshot yielded an overlap
// number.
function clusterBoundaryEdge(
  a: RefineClusterInput,
  b: RefineClusterInput,
  byId: ReadonlyMap<string, KeywordNode>,
  liveByQuery: ReadonlyMap<string, LiveSerpEvidence>,
  ruleset: ClusterRuleset,
): ClusterEdge {
  const nodeA = byId.get(a.primaryKeywordId) ?? null;
  const nodeB = byId.get(b.primaryKeywordId) ?? null;
  const semantic = cosineSimilarity(nodeA?.vector ?? null, nodeB?.vector ?? null);
  const intent = intentCompatibility(a.intent, b.intent);

  const repNormA = nodeA?.normalizedKeyword ?? null;
  const repNormB = nodeB?.normalizedKeyword ?? null;
  const aLive = repNormA !== null ? liveByQuery.get(repNormA) ?? null : null;
  const bLive = repNormB !== null ? liveByQuery.get(repNormB) ?? null : null;
  const hasLiveEvidence = aLive !== null && bLive !== null;

  let serpOverlap: number | null = null;
  if (aLive !== null && bLive !== null && repNormA !== null && repNormB !== null) {
    serpOverlap = liveSerpOverlap(aLive, bLive, repNormA, repNormB, ruleset);
  }

  const scored: ScoreResult | null = scoreEdge(semantic, serpOverlap, intent, ruleset);
  return {
    score: scored?.score ?? null,
    components: { semantic, serpOverlap, intent },
    hasLiveEvidence,
  };
}

// Every hard-constraint violation introduced by merging two clusters: checked
// across the cross-cluster member pairs (each side was already internally
// clean at stage 10, so only the boundary can introduce a new violation). A
// fixed union so the returned set is order-invariant.
function mergeViolations(
  membersA: readonly string[],
  membersB: readonly string[],
  byId: ReadonlyMap<string, KeywordNode>,
): Set<ConstraintViolation> {
  const out = new Set<ConstraintViolation>();
  for (const aId of membersA) {
    const a = byId.get(aId);
    if (!a) continue;
    for (const bId of membersB) {
      const b = byId.get(bId);
      if (!b) continue;
      for (const v of forbiddenEdgeViolations(a, b)) out.add(v);
    }
  }
  return out;
}

// Every hard-constraint violation across ALL pairs of a member set. Used to
// re-validate a transitive merge component (A-B clean and B-C clean can still
// leave A-C forbidden).
function unionViolations(
  members: readonly string[],
  byId: ReadonlyMap<string, KeywordNode>,
): Set<ConstraintViolation> {
  const out = new Set<ConstraintViolation>();
  for (let i = 0; i < members.length; i++) {
    const a = byId.get(members[i]);
    if (!a) continue;
    for (let j = i + 1; j < members.length; j++) {
      const b = byId.get(members[j]);
      if (!b) continue;
      for (const v of forbiddenEdgeViolations(a, b)) out.add(v);
    }
  }
  return out;
}

function hasHardBlock(violations: ReadonlySet<ConstraintViolation>): boolean {
  for (const v of violations) if (HARD_BLOCK_VIOLATIONS.has(v)) return true;
  return false;
}

// Blocking for cluster merge candidates: a pair is a candidate iff the two
// clusters co-occur in at least one bucket (shared service, service area, core
// keyword or token of the representative keyword, or a shared live organic
// URL). Bounds the O(n^2) pair space the same way graph.ts blocks keyword
// pairs. Returns index pairs into `clusters`, i<j, deduped, total-sorted.
function mergeCandidatePairs(
  clusters: readonly RefineClusterInput[],
  byId: ReadonlyMap<string, KeywordNode>,
  liveByQuery: ReadonlyMap<string, LiveSerpEvidence>,
): Array<[number, number]> {
  const buckets = new Map<string, number[]>();
  const add = (key: string, idx: number) => {
    let list = buckets.get(key);
    if (!list) { list = []; buckets.set(key, list); }
    list.push(idx);
  };
  clusters.forEach((c, idx) => {
    const node = byId.get(c.primaryKeywordId);
    if (node) {
      if (node.coreKeyword !== null) add(`core:${node.coreKeyword}`, idx);
      for (const tok of node.tokens) add(`tok:${tok}`, idx);
      for (const sid of node.serviceIds) add(`svc:${sid}`, idx);
      for (const aid of node.serviceAreaIds) add(`area:${aid}`, idx);
      const live = liveByQuery.get(node.normalizedKeyword);
      if (live) for (const url of live.organicUrls) add(`url:${url}`, idx);
    }
  });
  const pairKeys = new Set<string>();
  for (const key of [...buckets.keys()].sort()) {
    const idxs = [...new Set(buckets.get(key)!)].sort((x, y) => x - y);
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) pairKeys.add(`${idxs[i]}:${idxs[j]}`);
    }
  }
  return [...pairKeys]
    .map((k) => k.split(':').map(Number) as [number, number])
    .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

function decisionFor(hasLiveEvidence: boolean): AdjudicationDecision {
  return hasLiveEvidence ? 'pending' : 'insufficient_evidence';
}

export function refineClusters(input: {
  clusters: readonly RefineClusterInput[];
  nodes: readonly KeywordNode[];
  displayKeywords: ReadonlyMap<string, string>;
  liveByQuery: ReadonlyMap<string, LiveSerpEvidence>;
  ruleset: ClusterRuleset;
}): RefineResult {
  const { clusters, nodes, displayKeywords, liveByQuery, ruleset } = input;
  const byId = new Map<string, KeywordNode>();
  for (const n of nodes) byId.set(n.keywordId, n);

  const { edgeThreshold } = ruleset;
  const band = ruleset.clusters.ambiguousBand;
  const splitThreshold = ruleset.clusters.lowCohesionSplitThreshold;

  // Normalized representative query per cluster (for live lookups) + coverage.
  const repNorm = new Map<string, string | null>();
  const hasLive = new Map<string, boolean>();
  let liveSnapshotCoverage = 0;
  for (const c of clusters) {
    const node = byId.get(c.primaryKeywordId);
    const nk = node?.normalizedKeyword ?? null;
    repNorm.set(c.clusterId, nk);
    const covered = nk !== null && liveByQuery.has(nk);
    hasLive.set(c.clusterId, covered);
    if (covered) liveSnapshotCoverage += 1;
  }

  // Recomputed cohesion per input cluster (same sampling convention as
  // clusters.ts). Drives split candidacy. semanticCohesion preferred, falling
  // back to serpOverlapCohesion when semantic is unmeasurable.
  const cohesionByCluster = new Map<string, number | null>();
  for (const c of clusters) {
    const memberNodes = c.memberIds.map((id) => byId.get(id)).filter((n): n is KeywordNode => !!n);
    const { semanticCohesion, serpOverlapCohesion } = computeClusterCohesion(memberNodes);
    cohesionByCluster.set(c.clusterId, semanticCohesion ?? serpOverlapCohesion);
  }

  // A low-cohesion cluster (>= 2 members) is a split candidate and is excluded
  // from merge participation: an internally weak cluster should be split or
  // split-adjudicated, never merged into another. Everything else is mergeable.
  const isSplitCandidate = new Map<string, boolean>();
  for (const c of clusters) {
    const cohesion = cohesionByCluster.get(c.clusterId) ?? null;
    isSplitCandidate.set(
      c.clusterId,
      cohesion !== null && cohesion < splitThreshold && c.memberIds.length >= 2,
    );
  }

  const mergeable = clusters.filter((c) => !isSplitCandidate.get(c.clusterId));
  const splitCandidates = clusters.filter((c) => isSplitCandidate.get(c.clusterId));

  const adjudications: AdjudicationCase[] = [];

  // ---- Merge pass over mergeable clusters ----
  const mergeEdges: Array<{ a: string; b: string }> = [];
  const pairs = mergeCandidatePairs(mergeable, byId, liveByQuery);
  for (const [i, j] of pairs) {
    const A = mergeable[i];
    const B = mergeable[j];
    const edge = clusterBoundaryEdge(A, B, byId, liveByQuery, ruleset);
    if (edge.score === null) continue; // no signal at all

    const violations = mergeViolations(A.memberIds, B.memberIds, byId);
    const hardBlock = hasHardBlock(violations);
    const intentConflict = violations.has('incompatible_intent');
    const hasLiveEvidence = edge.hasLiveEvidence;

    const clusterIds = [A.clusterId, B.clusterId].sort(cmpStr);
    const keywordIds = [...new Set([...A.memberIds, ...B.memberIds])].sort(cmpStr);

    // A definitively-forbidden pair (branded/different-service/service-location)
    // is neither merged nor adjudicated: it is not ambiguous, it is forbidden.
    if (hardBlock) continue;

    // An intent-only conflict never auto-applies (Phase 4 has no adjudicator);
    // it is surfaced as an intent_exception, but only when the pair is similar
    // enough (>= the ambiguous-band floor) for the intent conflict to be the
    // deciding factor rather than flooding adjudications for unrelated pairs.
    if (intentConflict) {
      if (edge.score >= band.low) {
        adjudications.push({
          caseType: 'intent_exception',
          decision: decisionFor(hasLiveEvidence),
          clusterIds,
          keywordIds,
          scoreContext: {
            reason: 'intent_exception',
            score: edge.score,
            semantic: edge.components.semantic,
            serpOverlap: edge.components.serpOverlap,
            intent: edge.components.intent,
            cohesion: null,
            hasLiveEvidence,
            violations: [...violations].sort(cmpStr),
            edgeThreshold,
            ambiguousBand: band,
          },
        });
      }
      continue;
    }

    // Constraint-clean from here.
    if (edge.score >= edgeThreshold && hasLiveEvidence) {
      mergeEdges.push({ a: A.clusterId, b: B.clusterId });
    } else if (edge.score >= band.low) {
      // Ambiguous band with live evidence -> pending; any score the auto-merge
      // gate rejected only for want of live evidence -> insufficient_evidence.
      adjudications.push({
        caseType: 'merge',
        decision: decisionFor(hasLiveEvidence),
        clusterIds,
        keywordIds,
        scoreContext: {
          reason: hasLiveEvidence ? 'ambiguous_band' : 'no_live_evidence',
          score: edge.score,
          semantic: edge.components.semantic,
          serpOverlap: edge.components.serpOverlap,
          intent: edge.components.intent,
          cohesion: null,
          hasLiveEvidence,
          violations: [],
          edgeThreshold,
          ambiguousBand: band,
        },
      });
    }
  }

  // Apply merges as connected components over the auto-merge edges.
  const mergeableIds = mergeable.map((c) => c.clusterId);
  const mergeComponents = connectedComponents(mergeableIds, mergeEdges);
  const clusterById = new Map(clusters.map((c) => [c.clusterId, c]));
  const consumed = new Set<string>();

  interface FinalSet {
    members: string[];
    origin: 'unchanged' | 'merge' | 'split';
    sourceClusterIds: string[];
  }
  const finalSets: FinalSet[] = [];
  let autoMerges = 0;

  for (const component of mergeComponents) {
    if (component.length < 2) continue; // untouched cluster, handled as leftover
    const unionMembers = [
      ...new Set(component.flatMap((cid) => [...clusterById.get(cid)!.memberIds])),
    ].sort(cmpStr);

    // Re-validate the full union: a transitive conflict (each pairwise edge was
    // clean, the union is not) is genuinely ambiguous, so demote to a pending
    // merge adjudication instead of silently merging a forbidden set.
    const uViolations = unionViolations(unionMembers, byId);
    if (uViolations.size > 0) {
      adjudications.push({
        caseType: 'merge',
        decision: 'pending', // auto-merge edges required live evidence on both sides
        clusterIds: [...component].sort(cmpStr),
        keywordIds: unionMembers,
        scoreContext: {
          reason: 'transitive_constraint_conflict',
          score: null,
          semantic: null,
          serpOverlap: null,
          intent: null,
          cohesion: null,
          hasLiveEvidence: true,
          violations: [...uViolations].sort(cmpStr),
          edgeThreshold,
          ambiguousBand: band,
        },
      });
      continue; // leave the constituent clusters unchanged
    }

    for (const cid of component) consumed.add(cid);
    finalSets.push({ members: unionMembers, origin: 'merge', sourceClusterIds: [...component].sort(cmpStr) });
    autoMerges += 1;
  }

  // ---- Split pass over split-candidate clusters ----
  let autoSplits = 0;
  for (const c of splitCandidates) {
    const memberNodes = c.memberIds.map((id) => byId.get(id)).filter((n): n is KeywordNode => !!n);
    const cohesion = cohesionByCluster.get(c.clusterId) ?? null;
    const clusterHasLive = hasLive.get(c.clusterId) ?? false;

    // Recompute the intra-cluster keyword graph and cut on clean strong edges.
    const memberGraph = buildKeywordSimilarityGraph({ nodes: memberNodes, ruleset });
    const cleanEdges = memberGraph.edges.filter(
      (e: GraphEdge) => e.violations.length === 0 && e.score >= edgeThreshold,
    );
    const components = connectedComponents(
      memberNodes.map((n) => n.keywordId),
      cleanEdges,
    );

    // Auto-split only requires (a) a clean 2-cut and (b) live evidence for this
    // cluster (a split without live SERP support stays an adjudication, which
    // is also what keeps a zero-coverage run change-free).
    if (components.length === 2 && clusterHasLive) {
      for (const part of components) {
        finalSets.push({ members: [...part].sort(cmpStr), origin: 'split', sourceClusterIds: [c.clusterId] });
      }
      consumed.add(c.clusterId);
      autoSplits += 1;
    } else {
      adjudications.push({
        caseType: 'split',
        decision: decisionFor(clusterHasLive),
        clusterIds: [c.clusterId],
        keywordIds: [...c.memberIds].sort(cmpStr),
        scoreContext: {
          reason: components.length === 2 ? 'no_live_evidence' : 'low_cohesion_no_clean_cut',
          score: null,
          semantic: null,
          serpOverlap: null,
          intent: null,
          cohesion: cohesion === null ? null : round6(cohesion),
          hasLiveEvidence: clusterHasLive,
          violations: [],
          edgeThreshold,
          ambiguousBand: band,
        },
      });
      // Cluster stays unchanged (handled as leftover below).
    }
  }

  // ---- Leftover (untouched) clusters ----
  for (const c of clusters) {
    if (consumed.has(c.clusterId)) continue;
    finalSets.push({ members: [...c.memberIds].sort(cmpStr), origin: 'unchanged', sourceClusterIds: [c.clusterId] });
  }

  // Identity: a final member set identical to an input cluster's set preserves
  // that cluster's id (row untouched). Merge unions and split parts get fresh
  // ids (preservedClusterId null).
  const inputSetKeyToId = new Map<string, string>();
  for (const c of clusters) {
    inputSetKeyToId.set([...c.memberIds].slice().sort(cmpStr).join(' '), c.clusterId);
  }

  const outClusters: RefinedCluster[] = finalSets.map((fs) => {
    const memberNodes = fs.members.map((id) => byId.get(id)).filter((n): n is KeywordNode => !!n);
    const memberGraph = buildKeywordSimilarityGraph({ nodes: memberNodes, ruleset });
    const strongEdges = memberGraph.edges.filter(
      (e: GraphEdge) => e.violations.length === 0 && e.score >= edgeThreshold,
    );
    const draft = assembleClusterDraft({ memberIds: fs.members, byId, strongEdges, displayKeywords });
    const setKey = fs.members.slice().sort(cmpStr).join(' ');
    const preservedClusterId = inputSetKeyToId.get(setKey) ?? null;
    const changed = preservedClusterId === null;
    return {
      clusterKey: draft.clusterKey,
      preservedClusterId,
      changed,
      origin: changed ? fs.origin : 'unchanged',
      draft,
      liveBreakdown: changed && fs.origin !== 'unchanged'
        ? { origin: fs.origin, sourceClusterIds: fs.sourceClusterIds }
        : null,
    };
  });

  outClusters.sort((x, y) => cmpStr(x.clusterKey, y.clusterKey));
  adjudications.sort(
    (x, y) =>
      cmpStr(x.caseType, y.caseType) ||
      cmpStr(x.clusterIds.join(' '), y.clusterIds.join(' ')) ||
      cmpStr(x.scoreContext.reason, y.scoreContext.reason),
  );

  const adjudicationsPending = adjudications.filter((a) => a.decision === 'pending').length;
  const adjudicationsInsufficient = adjudications.filter((a) => a.decision === 'insufficient_evidence').length;

  return {
    clusters: outClusters,
    adjudications,
    stats: {
      clustersIn: clusters.length,
      clustersOut: outClusters.length,
      autoMerges,
      autoSplits,
      adjudicationsPending,
      adjudicationsInsufficient,
      liveSnapshotCoverage,
    },
  };
}
