import { describe, it, expect } from 'vitest';
import { summarizeReviews, type ReviewRow } from './reviews-summary';

const row = (o: Partial<ReviewRow>): ReviewRow => ({ rating: 5, text: '', date: null, owner_response: null, owner_response_date: null, author: 'A', ...o });

describe('summarizeReviews', () => {
  it('computes reply rate, reply lag, unanswered low stars and date range', () => {
    const s = summarizeReviews([
      row({ rating: 5, text: 'Fixed our hot water system fast. Hot water back same day.', date: '2026-09-01 10:00:00 +00:00', owner_response: 'Thanks', owner_response_date: '2026-09-03 10:00:00 +00:00' }),
      row({ rating: 2, text: 'Blocked drain still blocked after the visit.', date: '2026-08-20 10:00:00 +00:00' }),
      row({ rating: 4, text: 'Great gas heater install, tidy work.', date: '2026-08-01 10:00:00 +00:00', owner_response: 'Cheers', owner_response_date: '2026-08-01 12:00:00 +00:00' }),
    ]);
    expect(s.fetched).toBe(3);
    expect(s.reply_rate_pct).toBe(67);
    expect(s.avg_days_to_reply).toBe(1);
    expect(s.unanswered_low_star).toBe(1);
    expect(s.newest_date).toBe('2026-09-01 10:00:00 +00:00');
    expect(s.oldest_date).toBe('2026-08-01 10:00:00 +00:00');
  });
  it('ranks frequent words of four or more letters, skipping stopwords', () => {
    const s = summarizeReviews([
      row({ text: 'Hot water repair was quick. Water heater works.' }),
      row({ text: 'They fixed the water leak and the heater.' }),
    ]);
    expect(s.service_mentions_hint.slice(0, 2)).toEqual(['water', 'heater']);
    expect(s.service_mentions_hint).not.toContain('they');
    expect(s.service_mentions_hint).not.toContain('was');
  });
  it('handles an empty sample', () => {
    expect(summarizeReviews([])).toEqual({ fetched: 0, reply_rate_pct: null, avg_days_to_reply: null, unanswered_low_star: 0, newest_date: null, oldest_date: null, service_mentions_hint: [] });
  });
});
