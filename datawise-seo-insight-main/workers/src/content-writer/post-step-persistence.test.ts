import { describe, it, expect } from 'vitest';
import { buildPostStepPersistenceUpdate } from './post-step-persistence';

describe('buildPostStepPersistenceUpdate', () => {
  it('review persists the report into review_json', () => {
    const u = buildPostStepPersistenceUpdate('review', '{"text":"ok"}', 'p1');
    expect(u.sql).toContain('review_json = ?');
    expect(u.params).toEqual(['{"text":"ok"}', 'p1']);
    expect(u.sql).not.toContain('seo_title');
    expect(u.sql).not.toContain('seo_meta_description');
  });

  it('upstream steps clear the stale review report', () => {
    for (const step of ['research', 'outline', 'draft'] as const) {
      const u = buildPostStepPersistenceUpdate(step, 'x', 'p1');
      expect(u.sql).toContain('review_json = NULL');
      expect(u.sql).toContain('seo_title = NULL');
      expect(u.sql).toContain('seo_meta_description = NULL');
    }
  });
});
