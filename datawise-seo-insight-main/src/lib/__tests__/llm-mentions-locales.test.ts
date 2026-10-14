import { describe, expect, it } from 'vitest';
import { isChatGptMarket, marketLabel, normalizeMarket } from '../llm-mentions-locales';

describe('normalizeMarket', () => {
  it('keeps a supported pair', () => {
    expect(normalizeMarket(2724, 'es')).toEqual({ locationCode: 2724, languageCode: 'es' });
    expect(normalizeMarket(2840, 'es')).toEqual({ locationCode: 2840, languageCode: 'es' });
  });

  it('snaps an unsupported language to the location default', () => {
    expect(normalizeMarket(2724, 'en')).toEqual({ locationCode: 2724, languageCode: 'es' });
  });

  it('falls back to US English for unknown or invalid locations', () => {
    expect(normalizeMarket(9999, 'es')).toEqual({ locationCode: 2840, languageCode: 'en' });
    expect(normalizeMarket(NaN, '')).toEqual({ locationCode: 2840, languageCode: 'en' });
  });
});

describe('market helpers', () => {
  it('flags only US English as a ChatGPT market', () => {
    expect(isChatGptMarket({ locationCode: 2840, languageCode: 'en' })).toBe(true);
    expect(isChatGptMarket({ locationCode: 2840, languageCode: 'es' })).toBe(false);
    expect(isChatGptMarket({ locationCode: 2724, languageCode: 'es' })).toBe(false);
  });

  it('labels a market', () => {
    expect(marketLabel({ locationCode: 2724, languageCode: 'es' })).toBe('Spain · Spanish');
  });
});
