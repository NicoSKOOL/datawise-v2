import { hashNormalizedInput } from '../hash';

// Builds the exact text embed_keyword_features sends to the embedding
// model, and hashes it (together with the model + template id) into a
// stable content hash. Both are pure, versioned by the ruleset's
// `embedding.contextTemplate` id: any change to how the text is assembled
// for a given template id would silently re-embed every keyword with a
// different vector under the same content hash, so a real change to the
// text shape must ship as a NEW template id (e.g. 'kw_v2'), never an edit
// to what 'kw_v1' produces.

export interface EmbeddingInput {
  keywordId: string;
  normalizedKeyword: string;
  text: string;
  contentHash: string;
}

// Minimal keyword/brief shape this needs -- callers pass the full row/brief,
// this only reads the two fields it cares about.
export interface EmbeddingTextKeyword {
  displayKeyword: string;
  coreKeyword: string | null;
}

export interface EmbeddingTextBrief {
  category: string;
}

// 'kw_v1': "<the keyword's most canonical known form> | <business category>".
// coreKeyword (DataForSEO's canonical form for a keyword family, backfilled
// by normalize_keyword_universe) is preferred when present; displayKeyword
// (the user/provider-facing surface form) is the fallback for keywords that
// never got a core_keyword. The category suffix gives the embedding model
// enough context to disambiguate a keyword whose surface form is ambiguous
// out of context (e.g. "drain cleaning" for a Plumber vs. a pool-service
// business), matching the fixed minimal-context intent of this template.
function buildKwV1Text(keyword: EmbeddingTextKeyword, brief: EmbeddingTextBrief): string {
  const canonical = keyword.coreKeyword ?? keyword.displayKeyword;
  return `${canonical} | ${brief.category}`;
}

export function buildEmbeddingText(
  keyword: EmbeddingTextKeyword,
  brief: EmbeddingTextBrief,
  template: string
): string {
  switch (template) {
    case 'kw_v1':
      return buildKwV1Text(keyword, brief);
    default:
      // Fail loudly rather than silently falling back to some default
      // shape: an unrecognized template id means CLUSTER_RULESET_V2 was
      // bumped to reference a template this function was never updated to
      // build, which must surface as a bug, not a quietly-wrong embedding.
      throw new Error(`buildEmbeddingText: unknown context template '${template}'`);
  }
}

// Content hash is over {model, template, text} rather than just `text`:
// the same text embedded under a different model (or ruleset embedding
// config bump) must produce a distinct hash so a batch-reuse check (see
// providers/embeddings/workers-ai.ts) can never mistake a stale vector
// computed by a different model/template for a fresh one.
export async function embeddingContentHash(model: string, template: string, text: string): Promise<string> {
  return hashNormalizedInput({ model, template, text });
}
