// Pure validation for a batch of keyword vectors returned by an embedding
// provider (providers/embeddings/workers-ai.ts is the only caller today).
// Nothing here touches D1/R2/env: it exists so a malformed or
// internally-inconsistent embedding response fails loudly, close to where
// it was produced, with a plain, unsanitized Error (these throw inside
// provider code that already runs under the same try/catch process-run.ts
// uses for every other stage, which classifies anything that is not a
// BlueprintApiError/BlueprintValidationError/SerpTasksPendingError as a
// generic internal_error -- exactly the right fate for "the model came back
// with garbage").

export interface KeywordVector {
  keywordId: string;
  normalizedKeyword: string;
  contentHash: string;
  vector: number[];
}

export interface EmbeddingSetMeta {
  model: string;
  dimensions: number;
}

// Throws a plain Error the moment any batch's model or dimensions drifts
// from `meta` (the reference established by the first batch of this run --
// see embedKeywordTexts). A mixed-model or mixed-dimension embedding set is
// not just noise: clustering (Task 9+) computes cosine similarity across
// every retained keyword's vector, which is meaningless (or index-out-of-
// bounds) the moment two vectors do not share the same coordinate space.
export function assertEmbeddingSetCompatible(
  meta: EmbeddingSetMeta,
  batches: Array<{ model: string; dimensions: number }>
): void {
  for (const batch of batches) {
    if (batch.model !== meta.model) {
      throw new Error(
        `assertEmbeddingSetCompatible: mixed embedding models in one run (expected '${meta.model}', got '${batch.model}')`
      );
    }
    if (batch.dimensions !== meta.dimensions) {
      throw new Error(
        `assertEmbeddingSetCompatible: mixed embedding dimensions in one run (expected ${meta.dimensions}, got ${batch.dimensions})`
      );
    }
  }
}

// Validates a batch of vectors straight off the wire (or read back from an
// R2 batch object during reuse): every vector must be a finite-float array,
// every vector in the batch must share the same length, and no keywordId
// may repeat within the batch. Returns the batch's dimensions (the shared
// vector length) on success so the caller does not have to re-derive it.
export function validateVectors(vectors: KeywordVector[]): { dimensions: number } {
  if (vectors.length === 0) {
    throw new Error('validateVectors: empty vector set');
  }

  const seenIds = new Set<string>();
  let dimensions: number | null = null;

  for (const v of vectors) {
    if (seenIds.has(v.keywordId)) {
      throw new Error(`validateVectors: duplicate keywordId '${v.keywordId}'`);
    }
    seenIds.add(v.keywordId);

    if (!Array.isArray(v.vector) || v.vector.length === 0) {
      throw new Error(`validateVectors: keyword '${v.keywordId}' has an empty or non-array vector`);
    }
    if (dimensions === null) {
      dimensions = v.vector.length;
    } else if (v.vector.length !== dimensions) {
      throw new Error(
        `validateVectors: ragged vectors in one batch (expected length ${dimensions}, keyword '${v.keywordId}' has ${v.vector.length})`
      );
    }
    for (const n of v.vector) {
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new Error(`validateVectors: keyword '${v.keywordId}' has a non-finite vector component`);
      }
    }
  }

  return { dimensions: dimensions! };
}
