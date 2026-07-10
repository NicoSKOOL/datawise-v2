import { describe, it, expect } from 'vitest';
import { parseProjectBrief, normalizeProjectBrief } from './brief';
import { BlueprintValidationError } from './errors';
import { V1_LIMITS } from '../contracts/limits';

const validInput = {
  businessName: '  Aqua Plumbing  ',
  category: 'Plumber',
  websiteUrl: 'https://www.aquaplumbing.com',
  countryIso: 'us',
  languageCode: 'EN',
  services: [
    { clientId: 's1', name: 'Emergency Plumbing' },
    { clientId: 's2', name: 'Drain Cleaning', priority: 'secondary' },
  ],
  serviceAreas: [
    { clientId: 'a1', city: 'Austin', countryIso: 'us', isPrimary: true, uniqueProof: ['Office on South Lamar'] },
    { clientId: 'a2', city: 'Round Rock', countryIso: 'us', isPrimary: false },
  ],
  excludedTopics: ['Jobs', 'jobs'],
  knownCompetitorDomains: ['https://www.rivalplumbing.com/'],
};

describe('parseProjectBrief', () => {
  it('accepts a valid brief', () => {
    expect(parseProjectBrief(validInput).businessName).toBe('Aqua Plumbing');
  });
  it('rejects more than 10 services with a field error', () => {
    const services = Array.from({ length: 11 }, (_, i) => ({ clientId: `s${i}`, name: `Service ${i}` }));
    try {
      parseProjectBrief({ ...validInput, services });
      expect.unreachable('should throw');
    } catch (e) {
      const err = e as BlueprintValidationError;
      expect(err.code).toBe('invalid_input');
      expect(err.fieldErrors.some((f) => f.path.startsWith('services'))).toBe(true);
    }
  });
  it('rejects more than 5 service areas, missing services, bad country code', () => {
    expect(() => parseProjectBrief({ ...validInput, serviceAreas: Array.from({ length: 6 }, (_, i) => ({ clientId: `a${i}`, city: `C${i}`, countryIso: 'us', isPrimary: i === 0 })) })).toThrow(BlueprintValidationError);
    expect(() => parseProjectBrief({ ...validInput, services: [] })).toThrow(BlueprintValidationError);
    expect(() => parseProjectBrief({ ...validInput, countryIso: 'usa' })).toThrow(BlueprintValidationError);
  });
  it('rejects zero or multiple primary areas when areas exist', () => {
    const noPrimary = validInput.serviceAreas.map((a) => ({ ...a, isPrimary: false }));
    const twoPrimary = validInput.serviceAreas.map((a) => ({ ...a, isPrimary: true }));
    expect(() => parseProjectBrief({ ...validInput, serviceAreas: noPrimary })).toThrow(BlueprintValidationError);
    expect(() => parseProjectBrief({ ...validInput, serviceAreas: twoPrimary })).toThrow(BlueprintValidationError);
  });
});

describe('normalizeProjectBrief', () => {
  it('normalizes mode, domains, casing, dedupes, defaults, and hashes', async () => {
    const brief = await normalizeProjectBrief(parseProjectBrief(validInput), V1_LIMITS);
    expect(brief.mode).toBe('existing_site');
    expect(brief.websiteDomain).toBe('aquaplumbing.com');
    expect(brief.countryIso).toBe('US');
    expect(brief.languageCode).toBe('en');
    expect(brief.services[0].normalizedName).toBe('emergency plumbing');
    expect(brief.services[0].priority).toBe('primary');
    expect(brief.knownCompetitorDomains).toEqual(['rivalplumbing.com']);
    expect(brief.excludedTopics).toEqual(['jobs']);
    expect(brief.maxRecommendedPages).toBe(V1_LIMITS.defaultMaxRecommendedPages);
    expect(brief.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('greenfield mode when no website', async () => {
    const { websiteUrl, ...rest } = validInput;
    const brief = await normalizeProjectBrief(parseProjectBrief(rest), V1_LIMITS);
    expect(brief.mode).toBe('greenfield');
    expect(brief.websiteDomain).toBeNull();
  });
  it('same input in different key order produces the same inputHash', async () => {
    const a = await normalizeProjectBrief(parseProjectBrief(validInput), V1_LIMITS);
    const reordered = JSON.parse(JSON.stringify(validInput));
    const b = await normalizeProjectBrief(parseProjectBrief(reordered), V1_LIMITS);
    expect(a.inputHash).toBe(b.inputHash);
  });
});
