import { describe, it, expect } from 'vitest';
import { allocate, isMoneyPage } from './allocate';
import { DEFAULT_CONFIG } from './config';
import type { Judgement } from './types';
import judgements from './__fixtures__/ghlcurso-judgements.json';
import inbound from './__fixtures__/ghlcurso-inbound.json';
import expectedAllocation from './__fixtures__/ghlcurso-expected-allocation.json';
import expectedCapLog from './__fixtures__/ghlcurso-expected-caplog.json';

// Fixture: 404 real Jev judgements (30 source pages of a ghlcurso.com run),
// with the output of the Python allocate.py on the same input as expected.
describe('allocate (parity with allocate.py)', () => {
  const result = allocate(judgements as Judgement[], inbound as number[], DEFAULT_CONFIG);

  it('allocates exactly the same links, in the same order', () => {
    expect(
      result.chosen.map((c) => ({
        source_canon: c.source_canon,
        p_i: c.p_i,
        target_canon: c.target_canon,
        action: c.action,
        final_score: c.final_score,
        score: c.score,
      }))
    ).toEqual(expectedAllocation);
  });

  it('records the same cap reasons', () => {
    expect(result.capLog).toEqual(expectedCapLog);
  });
});

describe('isMoneyPage', () => {
  it('matches exact paths only', () => {
    expect(isMoneyPage('site.com/pricing/', DEFAULT_CONFIG)).toBe(true);
    expect(isMoneyPage('site.com/x/pricing/', DEFAULT_CONFIG)).toBe(false);
    expect(isMoneyPage('site.com/', { ...DEFAULT_CONFIG, money_pages: ['/'] })).toBe(true);
  });
});
