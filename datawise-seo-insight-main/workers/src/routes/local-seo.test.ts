import { describe, it, expect } from 'vitest';
import { pickMyBusinessInfo } from './local-seo';

// Regression test for the geo-grid "centers on the wrong location / does not
// find my business" bug. DataForSEO my_business_info/live nests the business
// under result[0].items[0]; result[0] is the keyword wrapper. Reading result[0]
// directly returned an object with no latitude/longitude, so geo-grid centering
// fell back to a loose name search and persisted a wrong center.

describe('pickMyBusinessInfo', () => {
  // Shaped like a real my_business_info/live response: the wrapper carries the
  // keyword/counts, the business lives in items[0].
  const response = {
    tasks: [
      {
        result: [
          {
            keyword: 'place_id:ChIJt7df4x-wYEERXqyQeqWHJr0',
            location_code: 2826,
            items_count: 1,
            items: [
              {
                title: 'Inspire ADHD Coaching',
                latitude: 53.3811,
                longitude: -1.4701,
                description: 'ADHD coaching in Sheffield',
                is_claimed: true,
              },
            ],
          },
        ],
      },
    ],
  };

  it('returns the business object from items[0], not the keyword wrapper', () => {
    const biz = pickMyBusinessInfo(response);
    expect(biz?.title).toBe('Inspire ADHD Coaching');
    expect(biz?.latitude).toBe(53.3811);
    expect(biz?.longitude).toBe(-1.4701);
    expect(biz?.is_claimed).toBe(true);
    // The wrapper has no coordinates — guards against regressing to result[0].
    expect((response.tasks[0].result[0] as any).latitude).toBeUndefined();
  });

  it('returns null when items is empty', () => {
    expect(pickMyBusinessInfo({ tasks: [{ result: [{ items: [] }] }] })).toBeNull();
  });

  it('returns null when result has no items array', () => {
    expect(pickMyBusinessInfo({ tasks: [{ result: [{ keyword: 'x' }] }] })).toBeNull();
  });

  it('returns null for empty / malformed responses', () => {
    expect(pickMyBusinessInfo({})).toBeNull();
    expect(pickMyBusinessInfo({ tasks: [] })).toBeNull();
    expect(pickMyBusinessInfo(null)).toBeNull();
  });
});

import { classifyReviewsTask } from './local-seo';

// Reviews 504s (2026-09 triage): a finished task with no reviews kept polling
// until timeout, and DataForSEO errors were reported as timeouts.
describe('classifyReviewsTask', () => {
  it('treats a finished task with reviews as done', () => {
    const state = classifyReviewsTask({ status_code: 20000, result: [{ reviews_count: 2, items: [{}, {}] }] });
    expect(state.kind).toBe('done');
  });

  it('treats a finished task with no review items as done, not pending', () => {
    const state = classifyReviewsTask({ status_code: 20000, result: [{ reviews_count: 0, items: null }] });
    expect(state).toEqual({ kind: 'done', result: { reviews_count: 0, items: null } });
  });

  it('keeps polling while the task is queued, handed off, or has no result yet', () => {
    expect(classifyReviewsTask({ status_code: 40602, status_message: 'Task In Queue.' }).kind).toBe('pending');
    expect(classifyReviewsTask({ status_code: 40601, status_message: 'Task Handed.' }).kind).toBe('pending');
    expect(classifyReviewsTask({ status_code: 20000, result: null }).kind).toBe('pending');
    expect(classifyReviewsTask(undefined).kind).toBe('pending');
  });

  it('stops on a real DataForSEO error and keeps its message', () => {
    expect(classifyReviewsTask({ status_code: 40102, status_message: 'No Search Results.' }))
      .toEqual({ kind: 'failed', message: 'No Search Results.' });
  });
});
