import { describe, it, expect } from 'vitest';
import { buildSeedQueries } from './seeds';
import { parseProjectBrief, normalizeProjectBrief } from './brief';
import { V1_LIMITS } from '../contracts/limits';

async function makeBrief(serviceCount: number, areaCount: number) {
  return normalizeProjectBrief(
    parseProjectBrief({
      businessName: 'Test Co',
      category: 'Plumber',
      countryIso: 'us',
      languageCode: 'en',
      services: Array.from({ length: serviceCount }, (_, i) => ({ clientId: `s${i}`, name: `Service ${i}` })),
      serviceAreas: Array.from({ length: areaCount }, (_, i) => ({ clientId: `a${i}`, city: `City ${i}`, countryIso: 'us', isPrimary: i === 0 })),
    }),
    V1_LIMITS
  );
}

describe('buildSeedQueries', () => {
  it('never generates the full service x area cross product', async () => {
    const brief = await makeBrief(10, 5);
    const plan = buildSeedQueries(brief, { maxTotalSeeds: 200, includePrimaryAreaSeeds: true });
    // category(1) + services(10) + service x PRIMARY area only(10) = 21, not 1 + 10 + 50
    expect(plan.seeds).toHaveLength(21);
    expect(plan.seeds.filter((s) => s.source === 'service_primary_area')).toHaveLength(10);
    expect(plan.truncated).toBe(false);
  });
  it('dedupes and respects the cap', async () => {
    const brief = await makeBrief(10, 5);
    const plan = buildSeedQueries(brief, { maxTotalSeeds: 5, includePrimaryAreaSeeds: true });
    expect(plan.seeds).toHaveLength(5);
    expect(plan.truncated).toBe(true);
    const keys = plan.seeds.map((s) => s.query);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('works with zero service areas', async () => {
    const brief = await makeBrief(2, 0);
    const plan = buildSeedQueries(brief, { maxTotalSeeds: 200, includePrimaryAreaSeeds: true });
    expect(plan.seeds).toHaveLength(3); // category + 2 services
  });
});
