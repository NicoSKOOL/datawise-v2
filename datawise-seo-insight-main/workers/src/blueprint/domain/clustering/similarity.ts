import type { SearchIntent } from '../../contracts/enums';

// Pure similarity primitives for the clustering engine. No IO, no env access.
// Every function returns null (never NaN) when the signal is unavailable, so the
// graph layer can renormalize edge weights over the present components only.

/**
 * Cosine similarity of two numeric vectors, clamped to [-1, 1].
 * Returns null when either vector is null, empty, of mismatched length, or has
 * zero norm (which would otherwise produce NaN via a divide-by-zero).
 */
export function cosineSimilarity(
  a: ArrayLike<number> | null | undefined,
  b: ArrayLike<number> | null | undefined,
): number | null {
  if (a == null || b == null) return null;
  const n = a.length;
  if (n === 0 || n !== b.length) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return null;

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!(denom > 0)) return null;

  const cos = dot / denom;
  if (Number.isNaN(cos)) return null;
  // Guard against float overshoot beyond the mathematical [-1, 1] range.
  if (cos > 1) return 1;
  if (cos < -1) return -1;
  return cos;
}

function toUrlSet(input: ReadonlySet<string> | readonly string[] | null | undefined): Set<string> | null {
  if (input == null) return null;
  const set = input instanceof Set ? input : new Set(input);
  return set.size === 0 ? null : set;
}

/**
 * Jaccard overlap (|A intersection B| / |A union B|) of two SERP URL sets.
 * Returns null when either side has no URLs (null or empty), because there is
 * no overlap signal to measure. Never returns NaN.
 */
export function jaccardSerpOverlap(
  a: ReadonlySet<string> | readonly string[] | null | undefined,
  b: ReadonlySet<string> | readonly string[] | null | undefined,
): number | null {
  const setA = toUrlSet(a);
  const setB = toUrlSet(b);
  if (setA === null || setB === null) return null;

  let intersection = 0;
  // Iterate the smaller set for the membership test; result is order-invariant.
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
  for (const url of small) {
    if (large.has(url)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return null;
  return intersection / union;
}

function isUnknown(intent: SearchIntent | null | undefined): boolean {
  return intent == null || intent === 'unknown';
}

/**
 * Intent compatibility score.
 * - 1.0 when both sides share the same known intent.
 * - 0.5 when exactly one side is unknown/null (partial information).
 * - 0.5 for the commercial <-> transactional pairing (adjacent buying intent).
 * - 0 for any other pair of known, differing intents.
 * - null when both sides are unknown/null (no information at all); this lets the
 *   graph layer drop the intent component from weight renormalization.
 */
export function intentCompatibility(
  a: SearchIntent | null | undefined,
  b: SearchIntent | null | undefined,
): number | null {
  const aUnknown = isUnknown(a);
  const bUnknown = isUnknown(b);
  if (aUnknown && bUnknown) return null;
  if (aUnknown || bUnknown) return 0.5;
  if (a === b) return 1;
  if (
    (a === 'commercial' && b === 'transactional') ||
    (a === 'transactional' && b === 'commercial')
  ) {
    return 0.5;
  }
  return 0;
}
