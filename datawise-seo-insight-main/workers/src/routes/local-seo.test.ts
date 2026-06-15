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
