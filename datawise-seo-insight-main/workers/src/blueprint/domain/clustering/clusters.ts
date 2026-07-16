import type { SearchIntent } from '../../contracts/enums';
import type { ClusterRuleset } from './ruleset';
import type { GraphEdge, KeywordNode } from './graph';
import { cosineSimilarity, jaccardSerpOverlap } from './similarity';
import { edgeEligibleForMerge } from './graph';

// Deterministic cluster assembly from the similarity graph. Pure: identical
// input produces identical output regardless of array order, because every
// iteration that feeds output runs over sorted keys.

export interface ClusterDraft {
  clusterKey: string; // lexicographically smallest member keywordId
  memberIds: readonly string[]; // sorted by keywordId
  primaryKeywordId: string;
  label: string;
  serviceId: string | null;
  serviceAreaId: string | null;
  intent: SearchIntent | null;
  semanticCohesion: number | null;
  serpOverlapCohesion: number | null;
  membershipScores: Record<string, number>;
  warnings: string[];
}

export interface ClusterBuildResult {
  clusters: ClusterDraft[];
  stats: { clusterCount: number; singletonCount: number; oversizedSplit: number };
}

const COHESION_PAIR_CAP = 300;

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// DESC ordering with nulls last: returns <0 when x should come before y.
function cmpDescNullsLast(x: number | null, y: number | null): number {
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return y - x; // higher value first
}

function cmpStr(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

// Connected components over a fixed id set and an edge list, deterministic and
// order-invariant. Each component is sorted by id; components are sorted by
// their smallest id.
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
    // Attach the larger root under the smaller so representatives are stable.
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

interface RecutResult { members: string[]; warn: boolean }

// Splits an oversized component by raising a local edge threshold in fixed
// increments. The step budget is global across the recursion: sub-components
// inherit the current step rather than restarting, so a deeply nested split can
// still exhaust the budget. On exhaustion the component is kept intact and
// flagged (warn=true) for a 'weak_serp_distinction' warning.
function recut(
  members: string[],
  step: number,
  strongEdges: readonly GraphEdge[],
  ruleset: ClusterRuleset,
): RecutResult[] {
  if (members.length <= ruleset.clusters.maxClusterSize) return [{ members, warn: false }];
  if (step >= ruleset.clusters.oversizeRecutMaxSteps) return [{ members, warn: true }];

  const localThreshold = ruleset.edgeThreshold + (step + 1) * ruleset.clusters.oversizeRecutIncrement;
  const memberSet = new Set(members);
  const localEdges = strongEdges.filter(
    (e) => e.score >= localThreshold && memberSet.has(e.a) && memberSet.has(e.b),
  );
  const subs = connectedComponents(members, localEdges);

  if (subs.length === 1) {
    // Raising the threshold did not split anything; advance to the next step.
    return recut(members, step + 1, strongEdges, ruleset);
  }
  const out: RecutResult[] = [];
  for (const sub of subs) out.push(...recut(sub, step + 1, strongEdges, ruleset));
  return out;
}

function mostFrequentId(lists: readonly (readonly string[])[]): string | null {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: string | null = null;
  let bestCount = -1;
  // Iterate sorted keys with a strict >, so ties resolve to the smallest id.
  for (const key of [...counts.keys()].sort(cmpStr)) {
    const c = counts.get(key)!;
    if (c > bestCount) { bestCount = c; best = key; }
  }
  return best;
}

function majorityIntent(members: readonly KeywordNode[], primary: KeywordNode): SearchIntent | null {
  const counts = new Map<SearchIntent, number>();
  for (const m of members) {
    if (m.intent !== null) counts.set(m.intent, (counts.get(m.intent) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let maxCount = 0;
  for (const c of counts.values()) if (c > maxCount) maxCount = c;
  const top = [...counts.keys()].filter((k) => counts.get(k) === maxCount);
  if (top.length === 1) return top[0];
  return primary.intent; // tie -> primary's intent
}

function meanPairwise(
  members: readonly KeywordNode[],
  pick: (n: KeywordNode) => boolean,
  score: (a: KeywordNode, b: KeywordNode) => number | null,
): number | null {
  const eligible = members.filter(pick).slice().sort((a, b) => cmpStr(a.keywordId, b.keywordId));
  if (eligible.length < 2) return null;
  let sum = 0;
  let valued = 0; // pairs that produced a non-null value (the average denominator)
  let sampled = 0; // pairs visited (bounded by COHESION_PAIR_CAP)
  outer: for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      if (sampled >= COHESION_PAIR_CAP) break outer;
      sampled++;
      const s = score(eligible[i], eligible[j]);
      if (s !== null) { sum += s; valued++; }
    }
  }
  return valued === 0 ? null : round6(sum / valued);
}

// Semantic + SERP-overlap cohesion of a member set, using the exact sampling
// convention (COHESION_PAIR_CAP, member-id-sorted iteration, round6) the
// cluster assembly below relies on. Exported so refine_clusters (Task 12) can
// recompute cohesion for merged/split clusters without duplicating this math.
export function computeClusterCohesion(
  members: readonly KeywordNode[],
): { semanticCohesion: number | null; serpOverlapCohesion: number | null } {
  const semanticCohesion = meanPairwise(
    members,
    (n) => n.vector !== null,
    (a, b) => cosineSimilarity(a.vector, b.vector),
  );
  const serpOverlapCohesion = meanPairwise(
    members,
    (n) => n.serpUrls !== null && n.serpUrls.size > 0,
    (a, b) => jaccardSerpOverlap(a.serpUrls, b.serpUrls),
  );
  return { semanticCohesion, serpOverlapCohesion };
}

// Assembles one ClusterDraft from a member set, the node lookup, and the
// clean strong-edge list that governs membership scores. This is the exact
// per-cluster body buildDeterministicClusters used to inline; extracted (Task
// 12) so refine_clusters can reassemble a merged/split cluster with identical
// primary-selection, intent, service/area, cohesion, and membership-score
// semantics rather than re-deriving them. memberIds may arrive in any order;
// the returned draft's memberIds are id-sorted, so clusterKey (memberIds[0])
// is always the lexicographically smallest member id.
export function assembleClusterDraft(input: {
  memberIds: readonly string[];
  byId: ReadonlyMap<string, KeywordNode>;
  strongEdges: readonly GraphEdge[];
  displayKeywords: ReadonlyMap<string, string>;
  warn?: boolean;
}): ClusterDraft {
  const memberIds = input.memberIds.slice().sort(cmpStr);
  const memberNodes = memberIds.map((id) => input.byId.get(id)!);

  // Primary: relevance DESC nulls last, volume DESC nulls last, normalizedKeyword ASC.
  const primary = memberNodes.slice().sort((a, b) =>
    cmpDescNullsLast(a.relevance, b.relevance) ||
    cmpDescNullsLast(a.volume, b.volume) ||
    cmpStr(a.normalizedKeyword, b.normalizedKeyword),
  )[0];

  const serviceId = mostFrequentId(memberNodes.map((n) => n.serviceIds));
  const serviceAreaId = mostFrequentId(memberNodes.map((n) => n.serviceAreaIds));
  const intent = majorityIntent(memberNodes, primary);

  const { semanticCohesion, serpOverlapCohesion } = computeClusterCohesion(memberNodes);

  // Membership score: mean of a member's incident strong-edge scores that stay
  // inside this cluster. Members with no in-cluster edge (singletons, or nodes
  // isolated by a recut) score 1.0.
  const memberSet = new Set(memberIds);
  const incident = new Map<string, number[]>();
  for (const id of memberIds) incident.set(id, []);
  for (const e of input.strongEdges) {
    if (memberSet.has(e.a) && memberSet.has(e.b)) {
      incident.get(e.a)!.push(e.score);
      incident.get(e.b)!.push(e.score);
    }
  }
  const membershipScores: Record<string, number> = {};
  for (const id of memberIds) {
    const scores = incident.get(id)!;
    membershipScores[id] = scores.length === 0
      ? 1
      : round6(scores.reduce((s, v) => s + v, 0) / scores.length);
  }

  const warnings = input.warn ? ['weak_serp_distinction'] : [];

  return {
    clusterKey: memberIds[0],
    memberIds,
    primaryKeywordId: primary.keywordId,
    label: input.displayKeywords.get(primary.keywordId) ?? primary.normalizedKeyword,
    serviceId,
    serviceAreaId,
    intent,
    semanticCohesion,
    serpOverlapCohesion,
    membershipScores,
    warnings,
  };
}

export function buildDeterministicClusters(input: {
  nodes: readonly KeywordNode[];
  edges: readonly GraphEdge[];
  displayKeywords: ReadonlyMap<string, string>;
  ruleset: ClusterRuleset;
}): ClusterBuildResult {
  const { nodes, edges, displayKeywords, ruleset } = input;

  const byId = new Map<string, KeywordNode>();
  for (const n of nodes) byId.set(n.keywordId, n);

  // Only violation-free edges that pass the merge gate drive clustering:
  // score >= edgeThreshold, and pairs without measured SERP overlap must
  // additionally clear the semantic-only floor (edgeEligibleForMerge).
  const strongEdges = edges
    .filter((e) => e.violations.length === 0 && edgeEligibleForMerge(e, ruleset))
    .slice()
    .sort((x, y) => cmpStr(x.a, y.a) || cmpStr(x.b, y.b));

  // Nodes pre-sorted by normalizedKeyword then keywordId for a stable order.
  const sortedNodeIds = nodes
    .map((n) => n.keywordId)
    .sort((x, y) => {
      const nx = byId.get(x)!;
      const ny = byId.get(y)!;
      return cmpStr(nx.normalizedKeyword, ny.normalizedKeyword) || cmpStr(x, y);
    });

  const baseComponents = connectedComponents(sortedNodeIds, strongEdges);
  let oversizedSplit = 0;

  const finalClusters: RecutResult[] = [];
  for (const comp of baseComponents) {
    if (comp.length > ruleset.clusters.maxClusterSize) oversizedSplit++;
    finalClusters.push(...recut(comp, 0, strongEdges, ruleset));
  }

  const drafts: ClusterDraft[] = finalClusters.map(({ members, warn }) =>
    assembleClusterDraft({ memberIds: members, byId, strongEdges, displayKeywords, warn }),
  );

  drafts.sort((x, y) => cmpStr(x.clusterKey, y.clusterKey));

  const singletonCount = drafts.filter((d) => d.memberIds.length === 1).length;

  return {
    clusters: drafts,
    stats: { clusterCount: drafts.length, singletonCount, oversizedSplit },
  };
}
