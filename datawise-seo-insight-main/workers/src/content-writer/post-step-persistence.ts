import type { PostStep } from './prompts';

export interface PostStepPersistenceUpdate {
  sql: string;
  params: unknown[];
}

export function buildPostStepPersistenceUpdate(
  step: PostStep,
  output: string,
  postId: string,
): PostStepPersistenceUpdate {
  const now = `datetime('now')`;
  switch (step) {
    case 'research':
      return {
        sql: `UPDATE content_writer_posts SET sources_json = ?, outline_json = NULL, body_md = NULL, body_html = NULL, review_json = NULL, seo_title = NULL, seo_meta_description = NULL, status = 'researched', updated_at = ${now} WHERE id = ?`,
        params: [output, postId],
      };
    case 'outline':
      return {
        sql: `UPDATE content_writer_posts SET outline_json = ?, body_md = NULL, body_html = NULL, review_json = NULL, seo_title = NULL, seo_meta_description = NULL, status = 'outlined', updated_at = ${now} WHERE id = ?`,
        params: [output, postId],
      };
    case 'draft':
      return {
        sql: `UPDATE content_writer_posts SET body_md = ?, body_html = NULL, review_json = NULL, seo_title = NULL, seo_meta_description = NULL, status = 'written', updated_at = ${now} WHERE id = ?`,
        params: [output, postId],
      };
    case 'review':
      return {
        sql: `UPDATE content_writer_posts SET review_json = ?, updated_at = ${now} WHERE id = ?`,
        params: [output, postId],
      };
  }
}

const DOWNSTREAM_STEPS: Record<PostStep, PostStep[]> = {
  research: ['outline', 'draft', 'review'],
  outline: ['draft', 'review'],
  draft: ['review'],
  review: [],
};

export function pruneDownstreamStepUsage<T>(
  step: PostStep,
  usageMap: Partial<Record<PostStep, T>>,
): Partial<Record<PostStep, T>> {
  const next = { ...usageMap };
  for (const downstream of DOWNSTREAM_STEPS[step]) {
    delete next[downstream];
  }
  return next;
}
